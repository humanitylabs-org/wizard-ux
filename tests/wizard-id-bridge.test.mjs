import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../web/core/bridge.js', import.meta.url), 'utf8');
function fixture(extra = {}) {
  const timers = new Map(), messages = []; let seq = 0;
  const port = { postMessage(m) { messages.push(JSON.parse(m)); } };
  const window = { addEventListener() {}, dispatchEvent() {}, wizardDevicePort: port, ...extra };
  vm.runInNewContext(source, { window, console, CustomEvent: class {}, setTimeout(f, ms) { timers.set(++seq, { f, ms }); return seq; }, clearTimeout(id) { timers.delete(id); } });
  return { window, port, timers, messages, call: window.WizCore.bridge.call };
}
test('identity and capture reuse the existing versioned device port and shared bridge.call', async () => {
  const f = fixture();
  for (const method of ['identity.info', 'identity.setup', 'identity.sign', 'view.capture', 'device.capabilities']) {
    const pending = f.call(method, { event: { kind: 30117 } });
    const request = f.messages.at(-1);
    assert.equal(request.method, method); assert.equal(request.v, 1);
    assert.equal(f.timers.values().next().value.ms, ['identity.setup', 'identity.sign'].includes(method) ? 185000 : 15000);
    f.port.onmessage({ data: JSON.stringify({ v: 1, id: request.id, ok: true, result: { denied: true } }) });
    assert.equal((await pending).denied, true); assert.equal(f.timers.size, 0);
  }
  assert.equal(f.window.WizardNative, undefined);
});
test('native errors, malformed messages and mismatched ids do not resolve a request', async () => {
  const f = fixture(), promise = f.call('identity.sign');
  f.port.onmessage({ data: 'bad json' });
  f.port.onmessage({ data: JSON.stringify({ v: 2, id: f.messages[0].id, ok: true }) });
  f.port.onmessage({ data: JSON.stringify({ v: 1, id: 'other', ok: true }) });
  assert.equal(f.timers.size, 1);
  f.port.onmessage({ data: JSON.stringify({ v: 1, id: f.messages[0].id, ok: false, error: 'invalid request' }) });
  await assert.rejects(promise, /invalid request/); assert.equal(f.timers.size, 0);
});
test('legacy Mac native bridge is unchanged for non-device methods', async () => {
  const sent = [], f = fixture({ webkit: { messageHandlers: { wizardNative: { postMessage: m => sent.push(m) } } } });
  const p = f.call('meeting.info'); assert.equal(sent[0].method, 'meeting.info'); assert.equal(f.messages.length, 0);
  f.window.wizardNativeReply({ id: sent[0].id, result: { ok: true } }); assert.equal((await p).ok, true);
});
test('missing bridge refuses without pretending to create an ID', async () => {
  const f = fixture({ wizardDevicePort: undefined }); await assert.rejects(f.call('identity.setup'), /no native shell/);
});
