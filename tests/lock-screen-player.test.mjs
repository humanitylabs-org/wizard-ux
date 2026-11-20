// Phone media player for Music and Podcasts (wizard-ux issue 1661, switch wizard/lock-screen-player, off by default).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const SWITCH = 'wizard/lock-screen-player';
const origin = 'https://wizard.example';
const APPS = {
  'wizard-music': { url: '/wizard-music/', provides: ['background-audio'] },
  'wizard-podcasts': { url: '/wizard-podcasts/', provides: ['background-audio'] },
  'wizard-notes': { url: '/wizard-notes/', provides: ['background-audio'] },
};

function shell({ on = false } = {}) {
  const sent = [], frames = [], listeners = {};
  const root = { dataset: { tweaks: on ? `wizard/thread-tracker ${SWITCH}` : 'wizard/thread-tracker' } };
  const c = { location: { origin, href: origin + '/wizard-os-home/' }, URL, console,
    document: { documentElement: root, querySelectorAll: () => frames },
    setTimeout: () => 1, clearTimeout: () => {}, addEventListener: (name, fn) => { listeners[name] = fn; },
    wizardAudioPort: { postMessage: raw => sent.push(JSON.parse(raw)) } };
  c.window = c; vm.createContext(c);
  vm.runInContext(read('web/core/background-audio-legacy.js'), c);
  vm.runInContext(read('web/core/background-audio.js'), c);
  c.WizBackgroundAudio.init(() => APPS, () => true);
  const frame = id => {
    const win = { location: { href: origin + '/' + id + '/' }, document: { documentElement: {} }, postMessage: () => {} };
    frames.push({ contentWindow: win, isConnected: true, hasAttribute: () => false, getAttribute: () => '/' + id + '/' });
    return win;
  };
  return { c, sent, root, frame };
}

test('switch off: the Android player hears the old single token for every admitted provider (unchanged)', () => {
  const f = shell();
  for (const id of ['wizard-music', 'wizard-podcasts', 'wizard-notes']) {
    const win = f.frame(id);
    assert.equal(f.c.WizBackgroundAudio.frameOk(win, origin), true, id);
    f.c.WizBackgroundAudio.request(win, 'state').catch(() => {});
    assert.equal(f.sent.at(-1).appId, 'wizard-music', id);
  }
});

test('switch on: Music and Podcasts each reach the player under their own id', () => {
  const f = shell({ on: true });
  for (const id of ['wizard-music', 'wizard-podcasts']) {
    const win = f.frame(id);
    assert.equal(f.c.WizBackgroundAudio.frameOk(win, origin), true, id);
    f.c.WizBackgroundAudio.request(win, 'load', { sessionId: 's', queue: [], skip: { back: 15, forward: 30 } }).catch(() => {});
    const m = f.sent.at(-1);
    assert.equal(m.appId, id); assert.equal(m.method, 'load');
    assert.deepEqual({ ...m.skip }, { back: 15, forward: 30 }, 'the skip ask travels to the player unchanged');
  }
});

test('switch on: no other app gets the player, even with provides background-audio', async () => {
  const f = shell({ on: true });
  const win = f.frame('wizard-notes');
  assert.equal(f.c.WizBackgroundAudio.frameOk(win, origin), false);
  await assert.rejects(f.c.WizBackgroundAudio.request(win, 'play'), /refused/);
  assert.equal(f.sent.length, 0);
  assert.equal(f.c.WizBackgroundAudio.canAttach(win), false);
});

test('the switch is read at call time, so flipping it needs no reload', () => {
  const f = shell();
  const win = f.frame('wizard-podcasts');
  f.c.WizBackgroundAudio.request(win, 'state').catch(() => {});
  assert.equal(f.sent.at(-1).appId, 'wizard-music');
  f.root.dataset.tweaks += ' ' + SWITCH;
  f.c.WizBackgroundAudio.request(win, 'state').catch(() => {});
  assert.equal(f.sent.at(-1).appId, 'wizard-podcasts');
});

test('the switch is listed, off by default, linked to its issue', () => {
  const cat = JSON.parse(read('web/tweaks/catalog.json'));
  assert.ok(cat.tweaks.includes(SWITCH));
  assert.ok(!cat.defaults.includes(SWITCH));
  const m = JSON.parse(read('web/tweaks/wizard/lock-screen-player/manifest.json'));
  assert.equal(m.id, SWITCH);
  assert.deepEqual(m.issues, ['humanitylabs-org/wizard-ux#1661']);
  const profile = read('web/tweaks/wizard/profile.json');
  assert.ok(!profile.includes(SWITCH));
});

test('Android: exactly Music and Podcasts, the tap opens the playing app, Podcasts is spoken word with skip buttons', () => {
  const policy = read('android/app/src/main/java/ai/wizards/os/audio/AudioPolicy.java');
  assert.match(policy, /APPS = Set\.of\(MUSIC, PODCASTS\)/);
  const service = read('android/app/src/main/java/ai/wizards/os/audio/BackgroundAudioService.java');
  assert.doesNotMatch(service, /\?open=wizard-music/, 'the notification no longer always opens Music');
  assert.match(service, /AudioPolicy\.openPath\(app\)/);
  assert.match(service, /AUDIO_CONTENT_TYPE_SPEECH/);
  assert.match(service, /COMMAND_SEEK_BACK/); assert.match(service, /COMMAND_SEEK_FORWARD/);
  assert.match(service, /setMediaButtonPreferences/);
  const bridge = read('android/app/src/main/java/ai/wizards/os/audio/BackgroundAudioBridge.java');
  assert.match(bridge, /AudioPolicy\.admitted\(app\)/);
  assert.doesNotMatch(bridge, /"wizard-music"\.equals/);
});
