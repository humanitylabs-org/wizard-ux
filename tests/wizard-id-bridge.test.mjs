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
  for (const method of ['identity.info', 'identity.setup', 'identity.sign', 'identity.nip44_encrypt', 'identity.nip44_decrypt', 'view.capture', 'device.capabilities']) {
    const pending = f.call(method, { event: { kind: 30117 } });
    const request = f.messages.at(-1);
    assert.equal(request.method, method); assert.equal(request.v, 1);
    assert.equal(f.timers.values().next().value.ms, ['identity.setup', 'identity.sign', 'identity.nip44_encrypt', 'identity.nip44_decrypt'].includes(method) ? 185000 : 15000);
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

test('page navigation retains scroll reset and native signer cancellation', () => {
  const activity = readFileSync(new URL('../android/app/src/main/java/ai/wizards/os/MainActivity.java', import.meta.url), 'utf8');
  const pageStarted = activity.split('public void onPageStarted(')[1]?.split('@Override')[0];
  assert.ok(pageStarted, 'MainActivity must keep its navigation lifecycle hook');
  assert.match(pageStarted, /\(\(SelectionWebView\)view\)\.scrollPageStarted\(\)/);
  assert.match(pageStarted, /if \(device != null\) device\.onPageStarted\(\)/);
  const selection = readFileSync(new URL('../android/app/src/main/java/ai/wizards/os/SelectionWebView.java', import.meta.url), 'utf8');
  assert.match(selection, /void scrollPageStarted\(\)\s*\{\s*scrollMetrics = null;\s*cancelScrollCapture\(\);\s*\}/);
});

const servicesSource = readFileSync(new URL('../web/core/app-services.js', import.meta.url), 'utf8');
function appFixture({ native = true, source = 'apps.json', kind = 'wizard' } = {}) {
  const location = new URL('https://wizard.example/wizard-os-home/'), calls = [], replies = [], listeners = {};
  const child = { location: new URL('/profiles/', location), document: {}, addEventListener() {}, postMessage(m) { replies.push(m); } };
  const frame = { tagName: 'IFRAME', src: child.location.href, isConnected: true, contentWindow: child, hasAttribute: () => false, addEventListener() {}, removeEventListener() {} };
  const app = { id: 'profiles', name: 'Profiles', kind, source, url: '/profiles/' };
  const bridge = { async call(method, params) { calls.push({ method, params }); return { approved: true }; } };
  const window = { WizCore: { apps: () => ({ APPS: [app] }), bridge }, wizardDevicePort: native ? {} : null, dispatchEvent() {} };
  vm.runInNewContext(servicesSource, { window, location, URL, addEventListener(t, f) { listeners[t] = f; }, setInterval() {}, setTimeout, clearTimeout, document: { hidden: false, readyState: 'loading', addEventListener() {} }, CustomEvent: class {}, navigator: {} });
  const detach = window.WizAppServices.attach(frame, { appId: app.id, path: app.url });
  const service = window.WizAppServices.connect(child, {});
  const send = (op, args = {}, origin = location.origin) => listeners.message({ source: child, origin, data: { type: 'wizard:app:request', version: 1, id: 'test-' + replies.length, op, args } });
  return { child, frame, app, bridge, calls, replies, window, detach, service, send };
}
test('installed app ops forward through the shared native bridge, with a catalog-owned requester', async () => {
  const f = appFixture();
  for (const op of ['identity.info', 'identity.sign', 'identity.nip44_encrypt', 'identity.nip44_decrypt']) {
    await f.send(op, { event: { kind: 1078 }, pubkey: 'public', plaintext: 'inner event', ciphertext: 'sealed', requester: 'Bank', description: 'Safe login', privateKey: 'not forwarded' });
    const call = f.calls.at(-1); assert.equal(call.method, op); assert.equal(call.params.requester, 'Profiles');
    assert.equal(call.params.description, undefined); assert.equal(call.params.privateKey, undefined);
    assert.equal(f.replies.at(-1).value.approved, true);
  }
  assert.equal(f.calls[1].params.event.kind, 1078);
  assert.equal(f.calls[2].params.plaintext, 'inner event'); assert.equal(f.calls[2].params.ciphertext, undefined);
  assert.equal(f.calls[3].params.ciphertext, 'sealed'); assert.equal(f.calls[3].params.plaintext, undefined);
  await f.send('identity.setup'); assert.equal(f.calls.length, 4); // Apps cannot enroll/export the key.
});
test('desktop returns unavailable and does not invoke a Mac or legacy native bridge', async () => {
  const f = appFixture({ native: false });
  for (const op of ['identity.info', 'identity.sign', 'identity.nip44_encrypt', 'identity.nip44_decrypt']) {
    await f.send(op); assert.equal(f.replies.at(-1).value.unavailable, true);
  }
  assert.equal(f.calls.length, 0);
});
test('owner links, builtin/noninstalled ids, foreign origin, detached and navigated frames have no ID access', async () => {
  for (const options of [{ source: 'owner' }, { source: 'official' }, { kind: 'link' }]) {
    const f = appFixture(options); await assert.rejects(f.service.identity.info(), /installed/); assert.equal(f.calls.length, 0);
  }
  const foreign = appFixture(); await foreign.send('identity.info', {}, 'https://evil.example'); assert.equal(foreign.calls.length, 0);
  for (const mutate of [f => f.detach(), f => { f.child.document = {}; }, f => { f.child.location = new URL('https://evil.example'); }, f => { f.child.location = new URL('https://wizard.example/other/'); }]) {
    const f = appFixture(); mutate(f); await assert.rejects(f.service.identity.info()); assert.equal(f.calls.length, 0);
  }
});
test('pending ID reply stays bound to the exact requesting document, including same-path reload', async () => {
  for (const mutate of [f => { f.child.document = {}; }, f => f.detach(), f => { f.app.source = 'owner'; }]) {
    const f = appFixture(); let finish; f.bridge.call = () => new Promise(resolve => { finish = resolve; });
    const request = f.service.identity.nip44_decrypt({ pubkey: 'public', ciphertext: 'sealed' });
    mutate(f); finish({ plaintext: 'must not reach new document' }); await assert.rejects(request);
  }
  const f = appFixture(); let finish; f.bridge.call = () => new Promise(resolve => { finish = resolve; });
  const pending = f.send('identity.nip44_decrypt'); f.child.document = {}; finish({ plaintext: 'private' }); await pending;
  assert.equal(f.replies.length, 0);
});
test('identity helpers use the existing app-client transport and approval-sized timeout', async () => {
  const sent = [], timers = [], listeners = {}, parent = { postMessage(m) { sent.push(m); } };
  const window = { parent, WizComposerInput: {}, WizAttachChip: {}, addEventListener(t, f) { listeners[t] = f; }, dispatchEvent() {} };
  const document = { hidden: false, readyState: 'loading', referrer: 'https://wizard.example/wizard-os-home/', documentElement: { dataset: {} }, addEventListener() {} };
  vm.runInNewContext(readFileSync(new URL('../web/core/app-client.js', import.meta.url), 'utf8'), { window, parent, document, location: new URL('https://wizard.example/profiles/'), URL, history: { pushState() {}, replaceState() {}, back() {} }, CustomEvent: class {}, addEventListener(t, f) { listeners[t] = f; }, setTimeout(f, ms) { timers.push(ms); return timers.length; }, clearTimeout() {}, console });
  for (const method of ['info', 'sign', 'nip44_encrypt', 'nip44_decrypt']) {
    const pending = window.WizardApp.identity[method]({ kind: 13, pubkey: 'public', plaintext: 'text', ciphertext: 'sealed' });
    const msg = sent.at(-1); assert.equal(msg.op, 'identity.' + method); assert.equal(timers.at(-1), method === 'info' ? 15000 : 190000);
    listeners.message({ source: parent, origin: 'https://wizard.example', data: { type: 'wizard:app:reply', version: 1, id: msg.id, value: { denied: true } } });
    assert.equal((await pending).denied, true);
  }
});
