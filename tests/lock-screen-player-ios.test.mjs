// iPhone media player for Music and Podcasts (wizard-ux issue 1664, switch wizard/lock-screen-player, off by default).
// Here: the shim the iPhone app injects (it is what the switch gates) run against the real shell modules, and the
// Swift player rules compiled and run (ios/tests/audio). The player on a real iPhone needs a Mac to build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import vm from 'node:vm';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const SWITCH = 'wizard/lock-screen-player';
const origin = 'https://wizard.example';
const IOS = 'ios/native/App/App/';
const player = read(IOS + 'WizardAudioPlayer.swift'); // only to run the JavaScript shim it injects

// The JavaScript between `// shim:begin` and `// shim:end` (a Swift multi-line string, indented 4).
function shimSource() {
  const block = player.split('// shim:begin')[1].split('// shim:end')[0];
  const body = block.split('"""')[1];
  return body.split('\n').map(l => l.replace(/^ {4}/, '')).join('\n');
}

// The JavaScript between `// pause:begin` and `// pause:end`: what the app runs in the shell on going to the background
// while its own player is not playing.
function pauseSource() {
  return player.split('// pause:begin')[1].split('// pause:end')[0].split('"""')[1].split('\n').map(l => l.replace(/^ {4}/, '')).join('\n');
}
function media(paused) { return { paused, pause() { this.paused = true; } }; }
function doc(els, frames = []) {
  return { querySelectorAll: sel => sel === 'iframe' ? frames : els };
}

function phone({ on = false } = {}) {
  const posted = [], frames = [];
  const root = { dataset: { tweaks: on ? `wizard/thread-tracker ${SWITCH}` : 'wizard/thread-tracker' } };
  const c = { location: { origin, href: origin + '/wizard-os-home/' }, URL, console, JSON, Object, String,
    document: { documentElement: root, querySelectorAll: () => frames },
    setTimeout: () => 1, clearTimeout: () => {}, addEventListener: () => {},
    webkit: { messageHandlers: { wizardAudio: { postMessage: raw => posted.push(raw) } } } };
  c.window = c; vm.createContext(c);
  vm.runInContext(shimSource(), c);
  const boot = () => {
    vm.runInContext(read('web/core/background-audio-legacy.js'), c);
    vm.runInContext(read('web/core/background-audio.js'), c);
    c.WizBackgroundAudio.init(() => ({
      'wizard-music': { url: '/wizard-music/', provides: ['background-audio'] },
      'wizard-podcasts': { url: '/wizard-podcasts/', provides: ['background-audio'] },
    }), () => true);
  };
  const frame = id => {
    const win = { location: { href: origin + '/' + id + '/' }, document: { documentElement: {} }, postMessage: () => {} };
    frames.push({ contentWindow: win, isConnected: true, hasAttribute: () => false, getAttribute: () => '/' + id + '/' });
    return win;
  };
  return { c, posted, root, boot, frame };
}

test('switch off: the iPhone shell sees no player port, so Music and Podcasts keep playing in their own pages', () => {
  const f = phone(); f.boot();
  assert.equal(f.c.wizardAudioPort, undefined);
  assert.equal(f.c.WizBackgroundAudio.canAttach(f.frame('wizard-podcasts')), false);
  assert.equal(f.posted.length, 0);
});

test('switch on: Podcasts reaches the iPhone player under its own id with its skip ask, and replies come back', async () => {
  const f = phone({ on: true }); f.boot();
  const win = f.frame('wizard-podcasts');
  assert.equal(f.c.WizBackgroundAudio.canAttach(win), true);
  const reply = f.c.WizBackgroundAudio.request(win, 'load', { sessionId: 's', queue: [{ id: 'ep:1' }], skip: { back: 15, forward: 30 } });
  const sent = JSON.parse(f.posted.at(-1));
  assert.equal(typeof f.posted.at(-1), 'string', 'the native handler gets the same JSON text as Android');
  assert.deepEqual([sent.appId, sent.method, sent.v, { ...sent.skip }], ['wizard-podcasts', 'load', 1, { back: 15, forward: 30 }]);
  f.c.__wizardAudioReply({ id: sent.id, ok: true, result: { sessionId: 's', appId: 'wizard-podcasts', playing: true }, live: true });
  assert.equal((await reply).appId, 'wizard-podcasts');
});

test('the switch is read at call time; a live session keeps the port after it goes off, so the shell can still stop it', () => {
  const f = phone(); f.boot();
  assert.equal(f.c.wizardAudioPort, undefined);
  f.root.dataset.tweaks += ' ' + SWITCH;
  assert.ok(f.c.wizardAudioPort, 'on without a reload');
  f.c.__wizardAudioReply({ live: true });
  f.root.dataset.tweaks = 'wizard/thread-tracker';
  assert.ok(f.c.wizardAudioPort, 'still reachable while the player has a session');
  f.c.__wizardAudioReply({ id: 'x', ok: true, result: {}, live: false });
  assert.equal(f.c.wizardAudioPort, undefined, 'gone once the session ended');
});

test('a load still on its way keeps the port reachable after the switch goes off, until it is answered', () => {
  const f = phone({ on: true });
  f.c.wizardAudioPort.postMessage(JSON.stringify({ id: 'audio-1', v: 1, appId: 'wizard-podcasts', method: 'load' }));
  f.root.dataset.tweaks = 'wizard/thread-tracker';
  assert.ok(f.c.wizardAudioPort, 'the off-edge release can still reach the player');
  f.c.__wizardAudioReply({ id: 'audio-1', ok: true, result: {}, live: false });
  assert.equal(f.c.wizardAudioPort, undefined);
});

test('a live-only push (no id) is not delivered as an answer, and pages cannot replace the port', () => {
  const f = phone({ on: true });
  let got = 0; f.c.wizardAudioPort.onmessage = () => { got++; };
  f.c.__wizardAudioReply({ live: true });
  assert.equal(got, 0);
  const port = f.c.wizardAudioPort, reply = f.c.__wizardAudioReply;
  try { vm.runInContext("window.wizardAudioPort = { postMessage(){} }; window.__wizardAudioReply = () => {};", f.c); } catch (_) {}
  assert.equal(f.c.wizardAudioPort, port);
  assert.equal(f.c.__wizardAudioReply, reply);
});

test('going to the background without the phone player: audio playing inside a page stops, as it does today', () => {
  const shellAudio = media(false), musicAudio = media(false), pausedOne = media(true), video = media(false);
  const crossOrigin = { get contentDocument() { throw new Error('SecurityError'); } };
  const appFrame = { contentDocument: doc([musicAudio, pausedOne], [{ contentDocument: doc([video]) }]) };
  const c = { document: doc([shellAudio], [appFrame, crossOrigin, { contentDocument: null }]), Array };
  vm.createContext(c);
  const stopped = vm.runInContext(pauseSource(), c);
  assert.equal(stopped, 3, 'the shell, an app page and a page inside it');
  assert.ok(shellAudio.paused && musicAudio.paused && video.paused && pausedOne.paused);
  assert.equal(vm.runInContext(pauseSource(), c), 0, 'nothing left playing');
});

// The rules the iPhone player follows (only Music and Podcasts, which URLs it opens, lock-screen buttons, calls,
// headphones out, saving Podcasts' place), compiled and run with Swift wherever a toolchain exists (GitHub's
// ubuntu runners, any Mac). The player itself needs Apple's frameworks: here it is syntax-checked.
const swiftc = spawnSync('swiftc', ['--version'], { encoding: 'utf8' });
test('iPhone native: the player rules compile and pass, and the player parses', { skip: swiftc.status === 0 ? false : 'no Swift toolchain here' }, () => {
  const run = spawnSync('bash', [new URL('../ios/tests/audio/run.sh', import.meta.url).pathname], { encoding: 'utf8', env: { ...process.env, TMPDIR: tmpdir() } });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /audio policy checks passed/);
  assert.match(run.stdout, /player syntax ok/);
});

// static-rule: every Swift file in the iPhone app is compiled into it (a file missing from Sources silently drops the player)
test('iPhone native: every Swift file of the app is in the Xcode project build sources', () => {
  const project = read('ios/native/App/App.xcodeproj/project.pbxproj');
  const files = readdirSync(new URL('../' + IOS, import.meta.url)).filter(f => f.endsWith('.swift'));
  assert.ok(files.includes('WizardAudioPlayer.swift') && files.includes('WizardAudioPolicy.swift'));
  for (const f of files) assert.ok(project.includes(`/* ${f} in Sources */,`), f + ' is built');
});

// static-rule: an app that sets the playback audio session must declare the background audio mode, or iOS stops it on lock
test('iPhone native: playing in the background is declared wherever the app plays', () => {
  const plist = read(IOS + 'Info.plist');
  const modes = /<key>UIBackgroundModes<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(plist)?.[1] || '';
  const plays = readdirSync(new URL('../' + IOS, import.meta.url)).filter(f => f.endsWith('.swift')).some(f => /setCategory\(\.playback/.test(read(IOS + f)));
  assert.ok(plays, 'the iPhone app sets the playback category');
  assert.ok(/<string>audio<\/string>/.test(modes), 'UIBackgroundModes has audio');
});
