import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const services = read('web/core/app-services.js'), client = read('web/core/app-client.js'), bridge = read('web/core/bridge.js');

function nativeFixture({modern = false} = {}) {
  const sent = [], timers = new Map(), listeners = []; let serial = 0;
  const port = {postMessage: value => sent.push(JSON.parse(value))};
  if (modern) port.addEventListener = (name, fn) => listeners.push(fn);
  const window = {wizardDevicePort: port, addEventListener(){}, dispatchEvent(){}};
  const context = {window, CustomEvent: class {}, console, setTimeout: fn => { timers.set(++serial, fn); return serial; }, clearTimeout: id => timers.delete(id)};
  vm.runInNewContext(bridge, context);
  const reply = (request, value = {saved: true}, error) => {
    const ev = {data: JSON.stringify({v: 1, id: request.id, ok: !error, result: value, error})};
    if (modern) listeners.forEach(fn => fn(ev)); else port.onmessage(ev);
  };
  return {window, sent, timers, reply};
}
function hostedFixture(native = nativeFixture()) {
  const location = new URL('https://wizard.example/wizard-os-home/'), events = {};
  const app = {id: 'messenger', kind: 'wizard', url: '/messenger/'};
  const child = {location: new URL(app.url, location), document: {}, addEventListener(){}, postMessage(){}};
  const frame = {tagName: 'IFRAME', src: child.location.href, isConnected: true, contentWindow: child, hasAttribute: () => false, addEventListener(){}, removeEventListener(){}};
  Object.assign(native.window.WizCore, {apps: () => ({APPS: [app]})});
  vm.runInNewContext(services, {window: native.window, location, URL, addEventListener: (name, fn) => {events[name] = fn;}, setInterval(){}, setTimeout, clearTimeout, document: {hidden: false, readyState: 'loading', addEventListener(){}}, CustomEvent: class {}, navigator: {}});
  const detach = native.window.WizAppServices.attach(frame, {appId: app.id, path: app.url, isVisible: () => true});
  return {...native, child, frame, detach, events, service: native.window.WizAppServices.connect(child, {})};
}

test('vault is a separate allowlisted group using the existing device envelope, not a new port', () => {
  for (const op of ['vault.has', 'vault.seal', 'vault.open', 'vault.forget']) assert.ok(services.includes(`'${op}'`));
  assert.doesNotMatch(services + bridge, /wizardVaultPort/);
  assert.match(services, /\{ \.\.\.extra, appId \}/, 'shell-owned appId overrides caller arguments');
  assert.match(client, /vault: Object\.freeze/);
  assert.match(client, /request\(op, args, 130000\)/);
});
test('without Android, has reports unavailable and open rejects with an error code', async () => {
  const f = hostedFixture(); delete f.window.wizardDevicePort;
  assert.equal((await f.service.vault.has()).available, false);
  await assert.rejects(f.service.vault.open(), error => error.code === 'unavailable');
});
for (const modern of [false, true]) test(`native correlation, error, timeout and concurrent requests (addEventListener=${modern})`, async () => {
  const f = nativeFixture({modern}), call = f.window.WizCore.bridge.call;
  const first = call('vault.open', {appId: 'messenger'}), second = call('vault.has', {appId: 'music'});
  assert.equal(f.sent[0].v, 1); assert.equal(f.sent[0].method, 'vault.open');
  f.reply(f.sent[1], {available: true, saved: true}); assert.equal((await second).saved, true);
  f.reply(f.sent[0], {secret: 'fixture-secret'}); assert.equal((await first).secret, 'fixture-secret');
  assert.equal(f.timers.size, 0);
  const denied = call('vault.open'); f.reply(f.sent[2], null, 'cancelled'); await assert.rejects(denied, /cancelled/);
  const timeout = call('vault.open'); [...f.timers.values()][0](); await assert.rejects(timeout, /timeout/);
});
test('registered frame owns appId on sync service and async message path, including hostile extra args', async () => {
  const f = hostedFixture();
  const saved = f.service.vault.seal('fixture-secret', 'Unlock Messenger');
  assert.equal(f.sent[0].params.appId, 'messenger'); assert.equal(f.sent[0].params.secret, 'fixture-secret');
  f.reply(f.sent[0]); await saved;
  const replies = []; f.child.postMessage = value => replies.push(value);
  const message = f.events.message({origin: f.child.location.origin, source: f.child, data: {type: 'wizard:app:request', version: 1, id: 'fixture-open', op: 'vault.open', args: {appId: 'other', title: 'Unlock Messenger'}}});
  assert.equal(f.sent[1].params.appId, 'messenger');
  f.reply(f.sent[1], {secret: 'fixture-secret'}); await message;
  assert.equal(replies[0].value.secret, 'fixture-secret');
  assert.equal(replies[0].id, 'fixture-open');
});
test('reloaded, closed or foreign documents never receive a late secret', async () => {
  for (const revoke of [f => {f.child.document = {};}, f => {f.detach();}, f => {f.child.location = new URL('https://foreign.example/');}]) {
    const f = hostedFixture(), opened = f.service.vault.open('Unlock Messenger');
    revoke(f); f.reply(f.sent[0], {secret: 'fixture-secret'});
    await assert.rejects(opened, /no longer authorized/);
    await assert.rejects(f.service.vault.open(), /no longer authorized/);
  }
});
test('unregistered child cannot connect to a vault', () => {
  const f = hostedFixture(); assert.equal(f.window.WizAppServices.connect({location: f.child.location, document: {}}, {}), null);
});
test('old native APK missing the vault group maps unknown method to unavailable', async () => {
  const f = hostedFixture(), opened = f.service.vault.open();
  f.reply(f.sent[0], null, 'unknown method'); await assert.rejects(opened, error => error.code === 'unavailable');
});
