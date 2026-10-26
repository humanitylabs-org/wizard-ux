import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url).pathname;
const read = p => fs.readFileSync(root + p, 'utf8');
const SELF = 'ai.wizards.os';

function policy() {
  const window = {};
  vm.runInContext(read('web/core/android-apps-policy.js'), vm.createContext({ window }));
  return window.WizAndroidAppsPolicy;
}

test('badge words match what native used to put on each row', () => {
  const P = policy();
  assert.equal(P.badge({ installer: SELF }, SELF), 'Wizard');
  assert.equal(P.badge({ installer: 'dev.imranr.obtainium', owner: SELF }, SELF), 'Wizard');
  assert.equal(P.badge({ installer: 'x', owned: true }, SELF), 'Wizard');
  assert.equal(P.badge({ installer: 'com.android.vending', owner: 'com.android.vending' }, SELF), 'Play');
  assert.equal(P.badge({ installer: 'dev.imranr.obtainium' }, SELF), 'Obtainium');
  assert.equal(P.badge({ installer: 'com.android.shell' }, SELF), 'Other');
  assert.equal(P.badge({ system: true }, SELF), 'System');
  assert.equal(P.badge({ system: true, installer: 'com.android.vending' }, SELF), 'Play');
  assert.equal(P.badge({ system: true, installer: 'com.android.shell' }, SELF), 'System');
  assert.equal(P.badge({ installer: '' }, ''), 'Other');
});

test('decorate adds badges without touching other facts', () => {
  const P = policy();
  const r = P.decorate({ self: SELF, sdk: 35, apps: [{ package: 'a.b', installer: SELF, versionCode: 3 }, { package: 'c.d', installer: 'com.android.vending', badge: 'stale' }] });
  assert.equal(r.sdk, 35);
  assert.deepEqual(r.apps.map(a => a.badge), ['Wizard', 'Play']);
  assert.equal(r.apps[0].versionCode, 3);
  assert.equal(P.decorate(null), null);
  assert.deepEqual(P.decorate({ apps: 'x' }), { apps: 'x' });
});

test('view methods exclude the relay-only scheduleUpdates; v is 1', () => {
  const P = policy();
  assert.equal(P.V, 1);
  assert.ok(P.METHODS.includes('scheduleUpdates'));
  assert.ok(!P.VIEW_METHODS.includes('scheduleUpdates'));
  assert.deepEqual([...P.VIEW_METHODS].sort(), ['appInfo', 'icon', 'install', 'launch', 'list', 'openPlay', 'status', 'uninstall']);
  assert.equal(P.shouldSchedule('list', true, false), true);
  assert.equal(P.shouldSchedule('list', true, true), false);
  assert.equal(P.shouldSchedule('list', false, false), false);
  assert.equal(P.shouldSchedule('icon', true, false), false);
});

test('native methods match AppsPolicy.METHODS exactly', () => {
  const java = read('android/app/src/main/java/ai/wizards/os/apps/AppsPolicy.java');
  const m = java.match(/METHODS = [^(]*\(new HashSet<>\(Arrays\.asList\(([^)]*)\)/);
  const native = [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]).sort();
  assert.deepEqual(native, [...policy().METHODS].sort());
});

// The relay with a fake shell, one Android Apps frame and a fake native port.
function relay({ port = true, nativeBadge = false } = {}) {
  const listeners = [], sent = [], toFrame = [];
  const frameWin = { location: { pathname: '/android-apps/' }, postMessage: m => toFrame.push(m) };
  const window = {
    addEventListener: (t, f) => { if (t === 'message') listeners.push(f); },
  };
  if (port) {
    const p = { onmessage: null, postMessage(s) {
      const m = JSON.parse(s); sent.push(m);
      const apps = [{ package: 'com.beemdevelopment.aegis', installer: SELF, owner: SELF, owned: true, ...(nativeBadge ? { badge: 'Wizard' } : {}) },
        { package: 'com.Slack', installer: 'com.android.vending', owner: 'com.android.vending', owned: false }];
      const res = { list: { apps, self: SELF, sdk: 35 }, launch: true }[m.method];
      queueMicrotask(() => p.onmessage({ data: JSON.stringify(res === undefined ? { id: m.id, ok: false, error: 'unknown method' } : { id: m.id, ok: true, result: res }) }));
    } };
    window.wizardAppsPort = p;
  }
  const ctx = vm.createContext({
    window, location: { origin: 'https://box.example' }, setTimeout: () => 0, JSON, Set, Map, String,
    document: { querySelectorAll: () => [{ contentWindow: frameWin }] },
  });
  vm.runInContext(read('web/core/android-apps-policy.js'), ctx);
  vm.runInContext(read('web/core/android-relay.js'), ctx);
  const fromFrame = d => listeners.forEach(f => f({ data: { type: 'wizard-os:android', ...d }, source: frameWin, origin: 'https://box.example' }));
  return { sent, toFrame, fromFrame, window };
}
const tick = () => new Promise(r => setTimeout(r, 5));

test('relay stamps v:1, badges the list in web, then asks scheduleUpdates once', async () => {
  const R = relay();
  R.fromFrame({ id: 'a1', method: 'list' });
  await tick();
  assert.deepEqual(R.sent.map(m => [m.v, m.method]), [[1, 'list'], [1, 'scheduleUpdates']]);
  assert.equal(R.toFrame.length, 1, 'the relay\'s own call never answers the view');
  assert.deepEqual(R.toFrame[0].result.apps.map(a => a.badge), ['Wizard', 'Play']);
  R.fromFrame({ id: 'a2', method: 'list' });
  await tick();
  assert.equal(R.sent.filter(m => m.method === 'scheduleUpdates').length, 1);
});

test('relay against an older Wizard OS (native badge, no scheduleUpdates) still answers the view', async () => {
  const R = relay({ nativeBadge: true });
  R.fromFrame({ id: 'a1', method: 'list' });
  await tick();
  assert.equal(R.toFrame.length, 1);
  assert.equal(R.toFrame[0].ok, true);
  assert.equal(R.toFrame[0].result.apps[0].badge, 'Wizard');
});

test('the view cannot call scheduleUpdates or unknown methods; no port answers no-bridge', async () => {
  const R = relay();
  R.fromFrame({ id: 'x', method: 'scheduleUpdates' });
  R.fromFrame({ id: 'y', method: 'exec' });
  await tick();
  assert.equal(R.sent.length, 0);
  assert.deepEqual(R.toFrame.map(m => m.error), ['unknown method', 'unknown method']);
  const N = relay({ port: false });
  N.fromFrame({ id: 'z', method: 'list' });
  assert.equal(N.toFrame[0].error, 'no-bridge');
});
