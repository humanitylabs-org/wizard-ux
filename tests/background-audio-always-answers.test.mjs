// Every wizard:background-audio:v1 request gets a reply (wizard-music#115): a silent drop froze Music's
// player on an old song for 20-22 s, shown as if it were playing. The Android side is AudioReplyTest (JUnit).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const origin = 'https://wizard.example';
const TYPE = 'wizard:background-audio:v1';

function shell({ admitted = true } = {}) {
  const toNative = [], frames = [], listeners = {};
  const c = { location: { origin, href: origin + '/wizard-os-home/' }, URL, console,
    document: { documentElement: { dataset: { tweaks: '' } }, querySelectorAll: () => frames },
    setTimeout: () => 1, clearTimeout: () => {}, addEventListener: (name, fn) => { listeners[name] = fn; },
    wizardAudioPort: { postMessage: raw => toNative.push(JSON.parse(raw)) } };
  c.window = c; vm.createContext(c);
  vm.runInContext(read('web/core/background-audio-legacy.js'), c);
  vm.runInContext(read('web/core/background-audio.js'), c);
  const gate = { admitted };
  c.WizBackgroundAudio.init(() => ({ 'wizard-music': { url: '/wizard-music/', provides: ['background-audio'] } }), () => gate.admitted);
  const replies = [];
  const win = { location: { href: origin + '/wizard-music/' }, document: { documentElement: {} }, postMessage: (m, o) => replies.push({ ...m, to: o }) };
  const frame = { contentWindow: win, isConnected: true, hasAttribute: () => false, getAttribute: () => '/wizard-music/' };
  frames.push(frame);
  const ask = (method, id = 'music-1') => listeners.message({ source: win, origin, data: { type: TYPE, id, method, params: {} } });
  const native = (m, result = { sessionId: 's', index: 1 }) => c.wizardAudioPort.onmessage({ data: JSON.stringify({ id: m.id, ok: true, result }) });
  const settle = () => new Promise(r => setImmediate(r));
  return { c, win, frame, gate, replies, toNative, ask, native, settle, listeners };
}

test('a refused frame gets an error reply instead of silence', async () => {
  const f = shell({ admitted: false });
  f.ask('state');
  await f.settle();
  assert.equal(f.toNative.length, 0, 'nothing reaches the phone player');
  assert.equal(f.replies.length, 1);
  assert.deepEqual({ ...f.replies[0] }, { type: TYPE, id: 'music-1', ok: false, error: 'Audio request refused', to: origin });
});

test('a frame that stops being allowed while its request is out still gets an error reply', async () => {
  const f = shell();
  f.ask('state');
  assert.equal(f.toNative.length, 1);
  f.gate.admitted = false;
  f.native(f.toNative[0]);
  await f.settle();
  assert.equal(f.replies.length, 1);
  assert.equal(f.replies[0].ok, false);
  assert.equal(f.replies[0].id, 'music-1');
  assert.equal('result' in f.replies[0], false, 'the player state never goes to a frame that is no longer allowed');
});

test('an allowed frame still gets the player state', async () => {
  const f = shell();
  f.ask('state');
  f.native(f.toNative[0]);
  await f.settle();
  assert.equal(f.replies.length, 1);
  assert.equal(f.replies[0].ok, true);
  assert.equal(f.replies[0].result.index, 1);
});

test('a page that replaced the frame document is not answered for the old one', async () => {
  const f = shell();
  f.ask('state');
  f.win.document = { documentElement: {} };
  f.native(f.toNative[0]);
  await f.settle();
  assert.equal(f.replies.length, 0);
});

test('a message from a foreign origin is never answered', async () => {
  const f = shell();
  f.listeners.message({ source: f.win, origin: 'https://evil.example', data: { type: TYPE, id: 'x', method: 'state', params: {} } });
  await f.settle();
  assert.equal(f.replies.length, 0);
  assert.equal(f.toNative.length, 0);
});
