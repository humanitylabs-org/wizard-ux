// ux#1646: an app cached as page-less (installed or renamed while its page was not up yet) keeps opening its
// "Which agents can use <App>?" sheet after its page appears. The tap decides from the live list: an app that has a
// page now opens; a tile drawn as an agent app reads the box's list once first, and opens the page if it appeared.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const apps = readFileSync(new URL('../web/core/apps.js', import.meta.url), 'utf8');
const kindsJs = readFileSync(new URL('../web/core/app-kinds.js', import.meta.url), 'utf8');
const appJs = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');

const pageless = { id: 'tg-style', name: 'TG style', desc: 'Telegram look', source: 'apps.json', type: 'view', category: 'app' };
const withPage = { ...pageless, url: '/tg-style/' };

async function shell(first) {
  const storage = new Map();
  let snapshot = first;
  const routed = [];
  const window = { WizCore: { norm: s => s.toLowerCase() }, WizConfig: { endpoint: () => '/apps' }, dispatchEvent() {},
    WosAppRoute: { open: (id, o) => routed.push([id, o.name]) } };
  const ctx = { window, document: { hidden: false, addEventListener() {} }, CustomEvent: class {}, URL, location: new URL('https://wizard.test/'),
    localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) }, setTimeout, Promise,
    addEventListener() {}, fetch: async () => ({ ok: true, json: async () => snapshot }) };
  vm.runInNewContext(apps, ctx);
  vm.runInNewContext(kindsJs, ctx);
  await window.WizCore.appsLoaded();
  const { APPS, APP } = window.WizCore.apps('mobile');
  return { window, APPS, APP, routed, setSnapshot: s => { snapshot = s; } };
}

test('a tile drawn page-less opens the app once the box lists its page (no settings sheet)', async () => {
  const s = await shell({ apps: [pageless] });
  assert.ok(s.window.WosAppKinds.kinds(s.APPS, s.APP).apps.some(a => a.id === 'tg-style'));
  assert.equal(s.APP['tg-style'], undefined, 'no page yet: only a backend tile');
  s.setSnapshot({ apps: [withPage] });   // the page came up; this device has not read the list again yet
  const opened = await new Promise(ok => {
    s.window.WosAppKinds.pageOrSheet(s.APP, 'tg-style', 'TG style', a => ok(a.id));
    setTimeout(() => ok(null), 2000);
  });
  assert.equal(opened, 'tg-style');
  assert.deepEqual(s.routed, []);
  // openRow (desktop selector, the Orb's sheet) takes the same path.
  let viaRow = null;
  assert.equal(s.window.WosAppKinds.openRow(s.APPS, s.APP, 'tg-style', id => { viaRow = id; }), true);
  assert.equal(viaRow, 'tg-style');
});

test('an app that really has no page still shows its settings sheet', async () => {
  const s = await shell({ apps: [pageless] });
  await new Promise(ok => { s.window.WosAppKinds.pageOrSheet(s.APP, 'tg-style', 'TG style', () => ok('opened')); setTimeout(ok, 1200); });
  assert.deepEqual(s.routed, [['tg-style', 'TG style']]);
});

test('the phone shell decides at the tap and redraws the New desk when the list changes', () => {
  assert.match(appJs, /function openAppInfo\(el, fromSheet\) \{ AK\.pageOrSheet\(APP, el\.dataset\.appinfo/);
  assert.match(appJs, /window\.addEventListener\('wizard:apps', \(\) => \{ try \{ repaintNewDesks\(true\); \} catch \(_\) \{\} \}\);/);
});
