// Clear chat notifications (wizard-ux issue 1276, switch wizard/clear-chat-notifications): an app in front tells the
// shell a chat was read, and the shell hands it to the WizardOS Android app's notification listener only while the
// switch is on. The real app-services.js + android-relay.js run in a vm with a stand-in native bridge.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { withServicesParts } from './fixtures/app-services-parts.mjs';
import { boundaryPair } from './fixtures/r7A-boundary-harness.mjs';
import { appClient } from './fixtures/app-client-harness.mjs';

const read = p => readFileSync(new URL('../web/' + p, import.meta.url), 'utf8');
const SWITCH = 'wizard/clear-chat-notifications';

function el(tag) {
  const e = { tagName: tag.toUpperCase(), children: [], dataset: {}, attrs: {}, hidden: false, textContent: '', listeners: {},
    append(...k) { e.children.push(...k); }, appendChild(k) { e.children.push(k); return k; }, setAttribute(n, v) { e.attrs[n] = v; },
    addEventListener(n, f) { (e.listeners[n] ||= []).push(f); } };
  return e;
}

function fixture({ on = false, access = false, visible = true, native = true, provides = ['messaging'], appId = 'messenger' } = {}) {
  const origin = 'https://wizard.example', calls = [], winListeners = {}, docListeners = {}, timers = [], observers = [];
  const replies = [], source = { location: new URL(origin + '/messenger/'), document: { documentElement: {} }, addEventListener() {}, postMessage: (m, o) => replies.push([JSON.parse(JSON.stringify(m)), o]) };
  const frame = { tagName: 'IFRAME', isConnected: true, src: source.location.href, contentWindow: source, addEventListener() {}, removeEventListener() {}, hasAttribute: () => false, getAttribute: () => frame.src };
  const app = { id: appId, kind: 'wizard', name: 'Messenger', url: '/messenger/', source: 'apps.json', provides };
  const root = { dataset: { tweaks: on ? 'wizard/desktop-chats ' + SWITCH : 'wizard/desktop-chats' } };
  const body = el('body'), byId = {};
  const state = { access };
  const c = { URL, console, JSON, Date, location: new URL(origin + '/wizard-os-home/'),
    document: { readyState: 'complete', hidden: false, documentElement: root, body, querySelectorAll: () => [frame],
      createElement: t => el(t), getElementById: id => byId[id] || body.children.find(k => k.id === id) || null,
      addEventListener: (n, f) => (docListeners[n] ||= []).push(f) },
    MutationObserver: class { constructor(fn) { this.fn = fn; observers.push(this); } observe(t, o) { this.t = t; this.o = o; } },
    WizCore: { apps: () => ({ APPS: [app] }) }, navigator: {}, dispatchEvent() {}, CustomEvent: class {},
    setInterval() {}, setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
    addEventListener: (n, f) => (winListeners[n] ||= []).push(f) };
  if (native) c.WizardOSNative = {
    chatNotifyState: () => { calls.push(['state']); return JSON.stringify({ enabled: true, access: state.access, connected: state.access }); },
    chatNotifySwitch: v => calls.push(['switch', v]),
    chatNotifyAccess: () => calls.push(['access']),
    chatNotifyRead: j => { calls.push(['read', JSON.parse(j)]); return 1; },
  };
  c.window = c; vm.createContext(c);
  vm.runInContext(withServicesParts(read('core/app-services.js')), c); vm.runInContext(read('core/android-relay.js'), c);
  const view = { visible };
  c.WizAppServices.attach(frame, { appId: app.id, path: app.url, isVisible: () => view.visible });
  const service = c.WizAppServices.connect(source, {});
  const flip = v => { root.dataset.tweaks = v ? 'wizard/desktop-chats ' + SWITCH : 'wizard/desktop-chats'; for (const o of observers) o.fn([]); };
  const settle = () => { for (const t of timers.filter(t => t.ms === 5000)) t.fn(); };
  const bar = () => body.children.find(k => k.id === 'wosChatNotify') || null;
  // An app's request over the message transport (an app without same-origin services), and the shell's replies.
  const post = async (op, args, id = 'r1') => { for (const fn of winListeners.message || []) await fn({ data: { type: 'wizard:app:request', version: 1, op, id, args }, origin, source }); };
  return { c, calls, service, view, state, flip, settle, bar, docListeners, post, replies };
}
const reads = f => f.calls.filter(x => x[0] === 'read');

test('off by default: a chat read reaches nothing and the listener is never turned on', () => {
  const f = fixture();
  assert.equal(f.service.notifications.chatRead({ network: 'line', names: ['Mike'] }), false);
  assert.deepEqual(reads(f), []);
  assert.ok(!f.calls.some(x => x[0] === 'switch' && x[1] === true));
  assert.equal(f.bar(), null);
});

test('on: the listener is enabled and a read in front goes to the Android app with network and names only', () => {
  const f = fixture({ on: true, access: true });
  assert.deepEqual(f.calls.filter(x => x[0] === 'switch'), [['switch', true]]);
  assert.equal(f.service.notifications.chatRead({ network: 'line', names: ['Mike Tanaka', 'mike.t'], text: 'secret', at: 5 }), true);
  assert.deepEqual(reads(f), [['read', { network: 'line', names: ['Mike Tanaka', 'mike.t'] }]]);
  assert.ok(!f.bar() || f.bar().hidden, 'no access bar once access is given');
});

test('a read from an app window that is not on screen is refused', () => {
  const f = fixture({ on: true, access: true, visible: false });
  assert.equal(f.service.notifications.chatRead({ network: 'line', names: ['Mike'] }), false);
  f.view.visible = true; f.c.document.hidden = true;
  assert.equal(f.service.notifications.chatRead({ network: 'line', names: ['Mike'] }), false);
  assert.deepEqual(reads(f), []);
});

test('only an app that declares messaging may ask, whatever its id', () => {
  for (const f of [fixture({ on: true, access: true, provides: [] }), fixture({ on: true, access: true, provides: ['chats'], appId: 'notes' })]) {
    assert.equal(f.service.notifications.chatRead({ network: 'line', names: ['Mike'] }), false);
    assert.deepEqual(reads(f), []);
  }
  const other = fixture({ on: true, access: true, appId: 'my-chat-app' });
  assert.equal(other.service.notifications.chatRead({ network: 'line', names: ['Mike'] }), true);
});

test('malformed reads never reach native, and a burst is capped', () => {
  const f = fixture({ on: true, access: true });
  for (const bad of [null, 'line', {}, { network: 'LINE!', names: ['x'] }, { network: 'line', names: [] }, { network: 'line', names: [' ', 3] }, { network: 'line', names: ['x'.repeat(201)] }]) {
    assert.equal(f.service.notifications.chatRead(bad), false, JSON.stringify(bad));
  }
  assert.deepEqual(reads(f), []);
  let ok = 0; for (let i = 0; i < 40; i++) if (f.service.notifications.chatRead({ network: 'line', names: ['n' + i] })) ok++;
  assert.equal(ok, 30);
  assert.equal(f.service.notifications.chatRead({ network: 'line', names: Array.from({ length: 20 }, (_, i) => 'p' + i) }), false);
});

test('names are capped at eight before they cross', () => {
  const f = fixture({ on: true, access: true });
  assert.equal(f.service.notifications.chatRead({ network: 'whatsapp', names: Array.from({ length: 12 }, (_, i) => 'p' + i) }), true);
  assert.equal(reads(f)[0][1].names.length, 8);
});

test('on without access: one bar with Allow opens Android Notification access; Later hides it', () => {
  const f = fixture({ on: true, access: false });
  const bar = f.bar();
  assert.ok(bar && !bar.hidden);
  assert.match(bar.children[0].textContent, /Notification access/);
  const allow = bar.children.find(k => k.dataset.chatNotify === 'allow');
  bar.listeners.click[0]({ target: { closest: () => allow } });
  assert.ok(f.calls.some(x => x[0] === 'access'));
  assert.equal(bar.hidden, true);
  f.state.access = true;
  for (const fn of f.docListeners.visibilitychange || []) fn();
  assert.equal(bar.hidden, true);
});

test('turning the switch off disables the listener, but only once the switches have settled', () => {
  const f = fixture({ on: false });
  assert.deepEqual(f.calls.filter(x => x[0] === 'switch'), [], 'a start never sends off before the switches are painted');
  f.flip(true);
  assert.deepEqual(f.calls.filter(x => x[0] === 'switch'), [['switch', true]]);
  f.settle(); f.flip(false);
  assert.deepEqual(f.calls.filter(x => x[0] === 'switch'), [['switch', true], ['switch', false]]);
  assert.equal(f.service.notifications.chatRead({ network: 'line', names: ['Mike'] }), false);
  const g = fixture({ on: false }); g.settle();
  assert.deepEqual(g.calls.filter(x => x[0] === 'switch'), [['switch', false]], 'an off left from another device is applied after settling');
});

test('without the Android app (a browser, an older APK) nothing happens', () => {
  const f = fixture({ on: true, native: false });
  assert.equal(f.service.notifications.chatRead({ network: 'line', names: ['Mike'] }), false);
  assert.equal(f.bar(), null);
});

test('the switch is in the catalog, off by default, and every host serves notify.chatRead', async () => {
  const cat = JSON.parse(read('tweaks/catalog.json'));
  assert.ok(cat.tweaks.includes(SWITCH));
  assert.ok(!cat.defaults.includes(SWITCH));
  const m = JSON.parse(read('tweaks/wizard/clear-chat-notifications/manifest.json'));
  assert.equal(m.id, SWITCH); assert.match(m.description, /Notification access/);
  const data = { network: 'line', names: ['Mike'] };
  // The shell's message transport (app-services.js) serves it, through the same checks.
  const f = fixture({ on: true, access: true });
  await f.post('notify.chatRead', data);
  assert.deepEqual(f.replies.map(([r]) => [r.type, r.id, r.value]), [['wizard:app:reply', 'r1', true]]);
  assert.deepEqual(reads(f), [['read', data]]);
  // The browser boundary: a sandboxed app's request crosses both ends (client and shell method lists) to the server.
  const served = [];
  const pair = await boundaryPair((el, method, args) => { served.push([method, JSON.parse(JSON.stringify(args))]); return true; });
  assert.equal(await pair.client.request('notify.chatRead', data, 2000), true);
  assert.deepEqual(served, [['notify.chatRead', data]]);
  await assert.rejects(pair.client.request('orb.set', {}, 2000), e => e.code === 'unavailable', 'an unlisted method never crosses');
  // The app SDK asks over whichever host it has: same-origin services, or a request to the shell.
  const got = [];
  const same = appClient({ service: { notifications: { chatRead: d => { got.push(d); return true; } } } });
  assert.equal(await same.api.notifications.chatRead(data), true); assert.equal(got.length, 1);
  const msg = appClient();
  await msg.hello();
  const answer = msg.api.notifications.chatRead(data);
  await new Promise(r => setTimeout(r, 0));
  const req = msg.requests('notify.chatRead');
  assert.equal(req.length, 1); assert.deepEqual(JSON.parse(JSON.stringify(req[0].args)), data);
  msg.reply(req[0], true);
  assert.equal(await answer, true);
});
