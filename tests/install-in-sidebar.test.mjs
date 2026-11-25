import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
// An app being installed shows in the Apps column (wizard-os#682, switch wizard/install-in-sidebar): the real
// core/apps.js in a vm. The Store posts `wizard:app-installing`; WizCore.installs follows the App Manager job itself
// (GET store-install/<id>), so it keeps going with the Store closed, and becomes ready once the app is in the list.
const source = readFileSync(new URL('../web/core/apps.js', import.meta.url), 'utf8');
const ORIGIN = 'https://wizard.example', SWITCH = 'wizard/install-in-sidebar';
function shell({ on = true, jobs = {}, stored = null } = {}) {
  const listeners = [], winListeners = [], storage = new Map(), reads = [], events = [];
  if (stored) storage.set('wos.installs.v1', JSON.stringify(stored));
  const apps = [];
  const root = { dataset: { tweaks: on ? `wizard/desktop-chats ${SWITCH}` : 'wizard/desktop-chats' } };
  const window = { WizCore: { norm: s => String(s).toLowerCase() }, WizConfig: { endpoint: () => '/wizard/v1/apps' },
    dispatchEvent: e => events.push(e.type), addEventListener: (t, fn) => winListeners.push([t, fn]),
    localStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) } };
  const fast = fn => setImmediate(fn);
  const ctx = { window, CustomEvent: class { constructor(type) { this.type = type; } }, URL, location: new URL(ORIGIN + '/wizard-os-home/desktop.html'), AbortSignal,
    setTimeout: fast, clearTimeout() {}, setInterval() {},
    fetch: async url => {
      const u = new URL(String(url), ORIGIN);
      if (u.pathname.includes('/app-logos')) return { ok: false };
      if (u.pathname.startsWith('/wizard-os-home/store-install/')) {
        const id = decodeURIComponent(u.pathname.split('/').pop()); reads.push(id);
        const j = jobs[id]; const next = Array.isArray(j) ? (j.length > 1 ? j.shift() : j[0]) : j;
        if (!next) return { ok: false, status: 404, json: async () => ({ error: 'no install for that app' }) };
        if (next.state === 'installed' && next.list) apps.push(...next.list.splice(0));
        return { ok: true, status: 200, json: async () => next };
      }
      return { ok: true, status: 200, json: async () => ({ apps: apps.slice() }) };
    },
    addEventListener: (type, fn) => listeners.push([type, fn]),
    document: { addEventListener() {}, visibilityState: 'visible', documentElement: root, currentScript: { src: ORIGIN + '/wizard-os-home/core/apps.js' } },
    localStorage: window.localStorage };
  vm.runInNewContext(source, ctx);
  const send = (origin, data) => { for (const [t, fn] of listeners) if (t === 'message') fn({ origin, data }); };
  const settle = async (n = 40) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
  const clone = v => JSON.parse(JSON.stringify(v));
  return { window, I: window.WizCore.installs, send, settle, reads, storage, events, root, winListeners, list: () => clone(window.WizCore.installs.list()) };
}
const tracker = { id: 'wizardos-tracker', name: 'WizardOS Tracker', url: '/wizardos-tracker/' };

test('switch off: a Store Get changes nothing (no row, no read, nothing saved)', async () => {
  const s = shell({ on: false, jobs: { 'wizardos-tracker': { state: 'installing' } } });
  await s.window.WizCore.appsLoaded(); await s.settle();
  s.send(ORIGIN, { type: 'wizard:app-installing', id: 'wizardos-tracker', job: 'wizardos-tracker', name: 'WizardOS Tracker', view: true });
  await s.settle();
  assert.deepEqual(s.list(), []);
  assert.deepEqual(s.reads, []);
  assert.equal(s.storage.has('wos.installs.v1'), false);
  assert.equal(s.events.includes('wizard:installs'), false);
});

test('switch on: the Get shows at once, is followed on the box without the Store, and turns into the app', async () => {
  const s = shell({ jobs: { 'wizardos-tracker': [{ state: 'installing' }, { state: 'installing' }, { state: 'installed', list: [tracker] }] } });
  await s.window.WizCore.appsLoaded(); await s.settle();
  s.send('https://evil.example', { type: 'wizard:app-installing', id: 'wizardos-tracker', name: 'x' });
  assert.deepEqual(s.list(), [], 'another origin cannot add a row');
  s.send(ORIGIN, { type: 'wizard:app-installing', id: 'wizardos-tracker', job: 'wizardos-tracker', name: 'WizardOS Tracker', view: true });
  const first = s.list();
  assert.equal(first.length, 1); assert.equal(first[0].state, 'installing'); assert.equal(first[0].name, 'WizardOS Tracker');
  assert.ok(s.events.includes('wizard:installs'), 'layouts are told to repaint');
  await s.settle(200);
  assert.ok(s.reads.length >= 3, 'the shell read the job itself: ' + s.reads.length);
  assert.deepEqual(s.list().map(r => [r.id, r.state]), [['wizardos-tracker', 'ready']]);
  assert.equal(s.window.WizCore.apps('desktop').APP['wizardos-tracker'].url, '/wizardos-tracker/', 'the app is in the list to open');
  s.I.dismiss('wizardos-tracker');
  assert.deepEqual(s.list(), []);
  assert.deepEqual(JSON.parse(s.storage.get('wos.installs.v1')), []);
});

test('a failed job says so; a screenless app leaves the column once installed; bad ids are refused', async () => {
  const s = shell({ jobs: { broken: [{ state: 'installing' }, { state: 'failed', error: 'image pull failed' }], helper: [{ state: 'installed' }] } });
  await s.window.WizCore.appsLoaded(); await s.settle();
  s.send(ORIGIN, { type: 'wizard:app-installing', id: 'broken', job: 'broken', name: 'Broken', view: true });
  s.send(ORIGIN, { type: 'wizard:app-installing', id: 'helper', job: 'helper', name: 'Helper', view: false });
  s.send(ORIGIN, { type: 'wizard:app-installing', id: '../x', name: 'Bad' });
  await s.settle(200);
  assert.deepEqual(s.list().map(r => [r.id, r.state, r.error]), [['broken', 'failed', 'image pull failed']]);
});

test('after a reload a saved install keeps being followed (once the switch is on)', async () => {
  const s = shell({ stored: [{ id: 'wizardos-tracker', job: 'wizardos-tracker', name: 'WizardOS Tracker', view: true, at: Date.now() - 5000, state: 'installing' }],
    jobs: { 'wizardos-tracker': [{ state: 'installing' }, { state: 'installed', list: [tracker] }] } });
  await s.window.WizCore.appsLoaded(); await s.settle(200);
  assert.deepEqual(s.list().map(r => [r.id, r.state]), [['wizardos-tracker', 'ready']]);
  const off = shell({ on: false, stored: [{ id: 'wizardos-tracker', job: 'wizardos-tracker', name: 'WizardOS Tracker', view: true, at: Date.now() - 5000, state: 'installing' }] });
  await off.window.WizCore.appsLoaded(); await off.settle(50);
  assert.deepEqual(off.reads, [], 'switch off: nothing is read');
  off.root.dataset.tweaks = SWITCH;
  for (const [t, fn] of off.winListeners) if (t === 'wos:experience') fn();
  await off.settle(20);
  assert.ok(off.reads.length >= 1, 'switch turned on: it is followed');
});
