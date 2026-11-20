// iPhone media player for Music and Podcasts (wizard-ux issue 1664, switch wizard/lock-screen-player, off by default).
// The Swift player itself is built and tried on a Mac/iPhone; here: the shim the iPhone app injects (it is what the
// switch gates), the shell driving it unchanged, and the native wiring that must not go missing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const SWITCH = 'wizard/lock-screen-player';
const origin = 'https://wizard.example';
const IOS = 'ios/native/App/App/';
const player = read(IOS + 'WizardAudioPlayer.swift');

// The JavaScript between `// shim:begin` and `// shim:end` (a Swift multi-line string, indented 4).
function shimSource() {
  const block = player.split('// shim:begin')[1].split('// shim:end')[0];
  const body = block.split('"""')[1];
  return body.split('\n').map(l => l.replace(/^ {4}/, '')).join('\n');
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

test('Change Wizard: the player drops the old Wizard\'s queue and unsent feedback before serving the new one', () => {
  assert.match(player, /player\.bind\(origin: origin\)/);
  const bind = player.split('func bind(origin new: String)')[1].split('\n    }\n')[0];
  assert.match(bind, /tracks\.removeAll\(\)/);
  assert.match(bind, /reports\.removeAll \{ \$0\["origin"\] as\? String != new \}/);
  assert.match(player, /first\["origin"\] as\? String == origin/);
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

test('iPhone native: background audio mode, both files built, only the shell main frame, exactly Music and Podcasts', () => {
  const plist = read(IOS + 'Info.plist');
  assert.match(plist, /<key>UIBackgroundModes<\/key>\s*<array>\s*<string>audio<\/string>/);
  const project = read('ios/native/App/App.xcodeproj/project.pbxproj');
  for (const file of ['WizardAudioPolicy.swift', 'WizardAudioPlayer.swift']) assert.match(project, new RegExp(file.replace('.', '\\.') + ' in Sources \\*/,'), file);
  const policy = read(IOS + 'WizardAudioPolicy.swift');
  assert.match(policy, /static let apps: Set<String> = \[music, podcasts\]/);
  assert.match(player, /message\.frameInfo\.isMainFrame/);
  assert.match(player, /WizardAudioPolicy\.shell\(web\.url/);
  assert.match(player, /WizardAudioPolicy\.admitted\(app\)/);
  assert.doesNotMatch(player, /wizardNative/, 'that handler name means Wizard for Mac to the shell');
  const vc = read(IOS + 'WizardViewController.swift');
  assert.match(vc, /if !connectMode \{ audioBridge = WizardAudioBridge\.install\(on: web\) \}/);
});

test('iPhone native: lock screen, Control Center, skip 15/30 for Podcasts, interruptions, unplug, progress', () => {
  assert.match(player, /setCategory\(\.playback, mode: WizardAudioPolicy\.spoken\(owner\) \? \.spokenAudio/);
  assert.match(player, /MPNowPlayingInfoCenter\.default\(\)/);
  for (const key of ['MPMediaItemPropertyTitle', 'MPMediaItemPropertyArtist', 'MPMediaItemPropertyArtwork', 'MPMediaItemPropertyPlaybackDuration', 'MPNowPlayingInfoPropertyElapsedPlaybackTime']) assert.ok(player.includes(key), key);
  assert.match(player, /changePlaybackPositionCommand/);
  assert.match(player, /skipBackwardCommand\.preferredIntervals = \[NSNumber\(value: skipBack\)\]/);
  assert.match(player, /skipForwardCommand\.preferredIntervals = \[NSNumber\(value: skipForward\)\]/);
  assert.match(player, /nextTrackCommand\.isEnabled = !skips/);
  assert.match(player, /AVAudioSession\.interruptionNotification/);
  assert.match(player, /options\.contains\(\.shouldResume\)/);
  assert.match(player, /\.oldDeviceUnavailable/);
  assert.match(player, /progressEvery: TimeInterval = 15/);
  assert.match(player, /kind: "progress"/);
  assert.match(player, /completionHandler\(nil\)/, 'no redirects');
});

test('the switch lists this issue too', () => {
  const m = JSON.parse(read('web/tweaks/wizard/lock-screen-player/manifest.json'));
  assert.ok(m.issues.includes('humanitylabs-org/wizard-ux#1664'));
  assert.match(m.description, /iPhone/);
});
