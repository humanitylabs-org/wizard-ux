import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// A Messenger voice note lowers Wizard Music (native Media3) and restores it, all shell-owned.
const source = readFileSync(new URL('../web/core/background-audio.js', import.meta.url), 'utf8');
function fixture({native = true, playing = true, volume = 0.8} = {}) {
  const sent = [], state = {sessionId: 'session-one', playing, volume};
  const c = {location: {origin: 'https://wizard.example', href: 'https://wizard.example/wizard-os-home/'}, document: {querySelectorAll: () => []}, URL, console,
    setTimeout: () => 1, clearTimeout: () => {}, addEventListener: () => {}};
  if (native) c.wizardAudioPort = {postMessage: raw => {
    const m = JSON.parse(raw); sent.push(m);
    if (m.method === 'volume') state.volume = m.value;
    queueMicrotask(() => c.wizardAudioPort.onmessage({data: JSON.stringify({id: m.id, ok: true, result: {...state}})}));
  }};
  c.window = c; vm.createContext(c);
  // The pilot grant/native token moved to the explicitly loaded compatibility adapter.
  vm.runInContext(readFileSync(new URL('../web/core/background-audio-legacy.js', import.meta.url), 'utf8'), c);
  vm.runInContext(source, c);
  c.WizBackgroundAudio.init(() => ({'wizard-music': {url: '/wizard-music/'}}), () => true);
  return {c, sent, state, duck: (o, on) => c.WizBackgroundAudio.duck(o, on)};
}
test('voice note ducks playing music and restores the owner volume', async () => {
  const f = fixture(), app = {};
  assert.equal(await f.duck(app, true), true); assert.equal(f.state.volume, 0.25);
  assert.ok(f.sent.every(m => m.appId === 'wizard-music' && m.v === 1));
  assert.equal(f.sent.find(m => m.method === 'volume').sessionId, 'session-one');
  assert.equal(await f.duck(app, false), true); assert.equal(f.state.volume, 0.8);
});
test('two apps ducking: volume returns only when the last lets go', async () => {
  const f = fixture(), a = {}, b = {};
  await f.duck(a, true); await f.duck(b, true); assert.equal(f.state.volume, 0.25);
  assert.equal(f.sent.filter(m => m.method === 'volume').length, 1);
  await f.duck(a, false); assert.equal(f.state.volume, 0.25);
  await f.duck(b, false); assert.equal(f.state.volume, 0.8);
});
test('paused music, browser-only shells and stray releases issue no volume change', async () => {
  const paused = fixture({playing: false}); assert.equal(await paused.duck({}, true), false);
  assert.equal(paused.sent.filter(m => m.method === 'volume').length, 0);
  const web = fixture({native: false}); assert.equal(await web.duck({}, true), false); assert.equal(web.sent.length, 0);
  const stray = fixture(); assert.equal(await stray.duck({}, false), false); assert.equal(stray.sent.length, 0);
});
test('ducking is shared by registry-granted providers, not tied to the pilot app', async () => {
  const f = fixture(), a = {};
  f.c.WizBackgroundAudio.init(() => ({radio: {url: '/radio/', provides: ['background-audio']}}), () => true);
  assert.equal(await f.duck(a, true), true); assert.equal(f.state.volume, 0.25);
  assert.equal(f.sent.filter(m => m.method === 'volume').length, 1);
  assert.ok(f.sent.every(m => m.appId === 'wizard-music' && m.v === 1)); // APK A compatibility token
  assert.equal(await f.duck(a, false), true); assert.equal(f.state.volume, 0.8);
  assert.ok(f.sent.every(m => m.method !== 'volume' || m.sessionId === 'session-one'));
});
test('quiet music is never turned up by ducking', async () => {
  const f = fixture({volume: 0.1}), a = {};
  await f.duck(a, true); assert.equal(f.state.volume, 0.1); await f.duck(a, false); assert.equal(f.state.volume, 0.1);
});
test('a volume the owner picks while ducked is kept on release', async () => {
  const f = fixture(), a = {};
  await f.duck(a, true); assert.equal(f.state.volume, 0.25);
  f.state.volume = 0.05; // owner turned Music down mid-note
  assert.equal(await f.duck(a, false), true); assert.equal(f.state.volume, 0.05);
  assert.equal(f.sent.filter(m => m.method === 'volume').length, 1);
});
test('music that is buffering but meant to play is still ducked', async () => {
  const f = fixture({playing: false}), a = {}; f.state.wantPlaying = true;
  assert.equal(await f.duck(a, true), true); assert.equal(f.state.volume, 0.25);
  assert.equal(await f.duck(a, false), true); assert.equal(f.state.volume, 0.8);
});
