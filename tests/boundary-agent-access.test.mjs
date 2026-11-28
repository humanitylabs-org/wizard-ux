// Agent access under the browser boundary (wizard-ux issue 1668, on for everyone): Connected
// accounts, sandboxed, asks the shell which agents may use an account app and changes it with a real tap. The real
// app-services.js runs in a vm with a stand-in boundary and Agent Service; the real boundary ends (browser-boundary.js
// and browser-boundary-client.js) carry the request and shape the answer. Real Chromium with the real Connected
// accounts page: tests/qa-browser-boundary-agent-access.cjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { withServicesParts } from './fixtures/app-services-parts.mjs';
import { boundaryPair } from './fixtures/r7A-boundary-harness.mjs';

const read = p => readFileSync(new URL('../web/' + p, import.meta.url), 'utf8');
const SWITCH = 'wizard/boundary-agent-access';
const clone = v => JSON.parse(JSON.stringify(v));

function shell({ tweaks = 'wizard/desktop-chats', appId = 'connected-accounts', source = 'apps.json', visible = true } = {}) {
  const origin = 'https://wizard.example', calls = [];
  const ticks = { messenger: { hermes: true, oscar: false } };
  const win = { location: new URL(origin + '/' + appId + '/') };
  const frame = { tagName: 'IFRAME', isConnected: true, src: win.location.href, contentWindow: win, addEventListener() {}, removeEventListener() {},
    hasAttribute: n => n === 'sandbox', getAttribute: () => frame.src };
  const app = { id: appId, kind: 'wizard', name: 'App', url: '/' + appId + '/', source };
  const root = { dataset: { tweaks } };
  let served = null;
  const reply = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => clone(body) });
  const c = { URL, console, JSON, Date, Promise, location: new URL(origin + '/wizard-os-home/'),
    document: { readyState: 'complete', hidden: false, documentElement: root, querySelectorAll: () => [frame], addEventListener() {} },
    MutationObserver: class { observe() {} disconnect() {} }, WizCore: { apps: () => ({ APPS: [app] }) }, navigator: {}, dispatchEvent() {},
    CustomEvent: class {}, setInterval() {}, setTimeout, clearTimeout() {}, addEventListener() {},
    WizBrowserBoundary: { enabled: true, attach: () => () => {}, serve: fn => { served = fn; }, ready: () => true, gen: () => 1, onReset() {}, owns: () => true, notice() {} },
    fetch: async (url, init = {}) => {
      calls.push([init.method || 'GET', url, init.body || '', init.redirect || '']);
      const id = decodeURIComponent(url.split('/')[4]);
      if (!ticks[id]) return reply(404, { error: 'app_not_found', check: 'app.id' });
      if (init.method === 'PUT') { const want = JSON.parse(init.body).agents; for (const a of Object.keys(ticks[id])) ticks[id][a] = want.includes(a); }
      return reply(200, { app_id: id, kind: 'wizard_apps', secret: 'x', agents: Object.entries(ticks[id]).map(([a, en]) => ({ id: a, label: a.toUpperCase(), privacy: 'standard', enabled: en, extra: 1 })) });
    } };
  c.window = c; vm.createContext(c);
  vm.runInContext(withServicesParts(read('core/app-services.js')), c);
  const view = { visible };
  c.WizAppServices.attach(frame, { appId, path: app.url, isVisible: () => view.visible });
  const call = (method, args, ctx = { tapped: false }) => Promise.resolve().then(() => served(frame, method, args, ctx));
  return { c, calls, ticks, call, view, root };
}

test('Connected accounts reads an account app\'s ticks; the shell asks the Agent Service itself', async () => {
  const s = shell();
  const v = await s.call('agents.read', { app: 'messenger' });
  assert.equal(v.access.state, 'ok');
  assert.deepEqual(v.access.agents.map(a => a.id + ':' + a.enabled), ['hermes:true', 'oscar:false']);
  assert.deepEqual(s.calls, [['GET', '/wizard/v1/apps/messenger/agents', '', 'error']]);
  // An account app that is not installed: absent, as the Agent Service says.
  assert.deepEqual(clone(await s.call('agents.read', { app: 'wizard-google' })), { access: { state: 'absent' } });
});

test('a change needs a real tap in the window, then PUTs exactly the ids', async () => {
  const s = shell();
  await assert.rejects(s.call('agents.set', { app: 'messenger', agents: [] }), /needs a tap/);
  assert.equal(s.calls.length, 0);
  const v = await s.call('agents.set', { app: 'messenger', agents: ['oscar', 'oscar'] }, { tapped: true });
  assert.deepEqual(s.calls.map(x => x.slice(0, 3)), [['PUT', '/wizard/v1/apps/messenger/agents', '{"agents":["oscar"]}']]);
  assert.deepEqual(s.ticks.messenger, { hermes: false, oscar: true });
  assert.deepEqual(v.access.agents.map(a => a.id + ':' + a.enabled), ['hermes:false', 'oscar:true']);
  for (const bad of [null, 'oscar', ['Oscar!'], ['../x'], Array.from({ length: 65 }, (_, i) => 'a' + i), [7]]) {
    await assert.rejects(s.call('agents.set', { app: 'messenger', agents: bad }, { tapped: true }), /Invalid agent list/, JSON.stringify(bad));
  }
  assert.equal(s.calls.length, 1);
});

test('the shell decides who may ask and for which apps', async () => {
  // Another installed app may not ask.
  const notes = shell({ appId: 'notes' });
  await assert.rejects(notes.call('agents.read', { app: 'messenger' }), /Only Connected accounts/);
  await assert.rejects(notes.call('agents.set', { app: 'messenger', agents: [] }, { tapped: true }), /Only Connected accounts/);
  // A page claiming the id but not from the box's installed list.
  const fake = shell({ source: 'local' });
  await assert.rejects(fake.call('agents.read', { app: 'messenger' }), /Only Connected accounts/);
  // Only apps that hold accounts.
  const s = shell();
  for (const app of ['notes', 'wizard-agent-service', '', '../wizard', undefined]) await assert.rejects(s.call('agents.read', { app }), /holds accounts/);
  // Only while its window is on screen.
  s.view.visible = false;
  await assert.rejects(s.call('agents.read', { app: 'messenger' }), /Open the app/);
  assert.equal(notes.calls.length + fake.calls.length + s.calls.length, 0);
});

test('on for everyone: answered with no switch in the mix, and the removed switch is gone from the catalog', async () => {
  const s = shell({ tweaks: '' });
  const v = await s.call('agents.read', { app: 'messenger' });
  assert.deepEqual(v.access.agents.map(a => a.id + ':' + a.enabled), ['hermes:true', 'oscar:false']);
  await s.call('agents.set', { app: 'messenger', agents: ['hermes', 'oscar'] }, { tapped: true });
  assert.deepEqual(s.ticks.messenger, { hermes: true, oscar: true });
  const cat = JSON.parse(read('tweaks/catalog.json'));
  assert.ok(!cat.tweaks.includes(SWITCH)); assert.ok(!(cat.defaults || []).includes(SWITCH));
});

test('the boundary carries agents.read / agents.set and only the ticks cross back', async () => {
  const served = [];
  const pair = await boundaryPair((el, method, args) => {
    served.push([method, clone(args)]);
    return Promise.resolve({ access: { state: 'ok', secret: 'x', agents: [{ id: 'hermes', label: 'Hermes', enabled: true, privacy: 'private', token: 't' }, { label: 'no id' }] } });
  });
  const v = await pair.client.request('agents.read', { app: 'messenger' }, 2000);
  assert.deepEqual(clone(v), { access: { state: 'ok', agents: [{ id: 'hermes', label: 'Hermes', privacy: 'private', enabled: true }] } });
  await pair.client.request('agents.set', { app: 'messenger', agents: ['hermes'] }, 2000);
  assert.deepEqual(served, [['agents.read', { app: 'messenger' }], ['agents.set', { app: 'messenger', agents: ['hermes'] }]]);
});
