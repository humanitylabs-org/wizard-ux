import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import { withServicesParts } from './fixtures/app-services-parts.mjs';
import { appClient } from './fixtures/app-client-harness.mjs';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const services = withServicesParts(read('web/core/app-services.js')), client = read('web/core/app-client.js'), bridge = read('web/core/bridge.js');

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
const sentSoon = async (f, n) => { for (let i=0;i<40 && f.sent.length<n;i++) await new Promise(r=>setTimeout(r,50)); };
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

test('vault uses the device envelope and retains the already-shipped legacy adapter', async () => {
  // Vault ops are admitted on the message path and go out on the shared device envelope (bridge.js), with the shell's
  // own appId over whatever the caller passed (seal/open, which first wait for the app to stay in front, are run the
  // same way by 'registered frame owns appId on sync service and async message path' below).
  for (const op of ['vault.has', 'vault.forget']) {
    const f = hostedFixture(), replies = []; f.child.postMessage = v => replies.push(v);
    const done = f.events.message({origin: f.child.location.origin, source: f.child, data: {type: 'wizard:app:request', version: 1, id: 'r-' + op, op, args: {appId: 'other', secret: 's', title: 't'}}});
    await sentSoon(f, 1);
    assert.equal(f.sent.length, 1, op); assert.equal(f.sent[0].v, 1); assert.equal(f.sent[0].method, op); assert.equal(f.sent[0].params.appId, 'messenger', op);
    f.reply(f.sent[0], {available: true, saved: true, secret: 's'}); await done;
    assert.equal(replies[0].id, 'r-' + op); assert.equal(replies[0].error, undefined, op);
  }
  assert.doesNotMatch(bridge, /wizardVaultPort/);
  // APK 0.10.8's own wizardVaultPort is still used when it is there.
  const f = hostedFixture(), legacy = [];
  f.window.wizardVaultPort = {postMessage: v => legacy.push(JSON.parse(v))};
  const has = f.service.vault.has();
  assert.equal(f.sent.length, 0); assert.equal(legacy.length, 1); assert.equal(legacy[0].method, 'has'); assert.equal(legacy[0].appId, 'messenger');
  f.window.wizardVaultPort.onmessage({data: JSON.stringify({id: legacy[0].id, ok: true, result: {available: true, saved: false}})});
  assert.equal((await has).available, true);
  // Apps reach it through the SDK: the same-origin service, or a request with the long biometric wait.
  const calls = [], same = appClient({service: {vault: {seal: (...a) => (calls.push(a), Promise.resolve({saved: true}))}}});
  assert.equal((await same.api.vault.seal('secret', 'Unlock')).saved, true); assert.deepEqual(calls, [['secret', 'Unlock']]);
  const framed = appClient(); await framed.hello();
  const opened = framed.api.vault.open('Unlock');
  const req = framed.requests('vault.open')[0];
  assert.deepEqual({...req.args}, {title: 'Unlock'}); assert.ok(framed.delays.includes(130000));
  framed.reply(req, null, 'vault:cancelled');
  await assert.rejects(opened, e => e.code === 'cancelled');
  await assert.rejects(appClient({path: '/x/'}).api.vault.open(), e => e.code === 'unavailable' || /unavailable/.test(e.message));
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
  await sentSoon(f, 1);
  assert.equal(f.sent[0].params.appId, 'messenger'); assert.equal(f.sent[0].params.secret, 'fixture-secret');
  f.reply(f.sent[0]); await saved;
  const replies = []; f.child.postMessage = value => replies.push(value);
  const message = f.events.message({origin: f.child.location.origin, source: f.child, data: {type: 'wizard:app:request', version: 1, id: 'fixture-open', op: 'vault.open', args: {appId: 'other', title: 'Unlock Messenger'}}});
  await sentSoon(f, 2);
  assert.equal(f.sent[1].params.appId, 'messenger');
  f.reply(f.sent[1], {secret: 'fixture-secret'}); await message;
  assert.equal(replies[0].value.secret, 'fixture-secret');
  assert.equal(replies[0].id, 'fixture-open');
});
test('reloaded, closed or foreign documents never receive a late secret', async () => {
  for (const revoke of [f => {f.child.document = {};}, f => {f.detach();}, f => {f.child.location = new URL('https://foreign.example/');}]) {
    const f = hostedFixture(), opened = f.service.vault.open('Unlock Messenger');
    await sentSoon(f, 1);
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
  await sentSoon(f, 1);
  f.reply(f.sent[0], null, 'unknown method'); await assert.rejects(opened, error => error.code === 'unavailable');
});
