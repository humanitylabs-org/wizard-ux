// ux#1646: an app cached as page-less (installed or renamed while its page was not up yet) keeps opening its
// "Which agents can use <App>?" sheet after its page appears. The tap decides from the live list: an app that has a
// page now opens; a tile drawn as an agent app reads the box's list once first, and opens the page if it appeared.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { withShellParts } from './fixtures/shell-parts.mjs';
const apps = withShellParts(readFileSync(new URL('../web/core/apps.js', import.meta.url), 'utf8'));
const kindsJs = withShellParts(readFileSync(new URL('../web/core/app-kinds.js', import.meta.url), 'utf8'));
const appJs = withShellParts(readFileSync(new URL('../web/app.js', import.meta.url), 'utf8'));

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

test('the phone shell decides at the tap and redraws the New desk when the list changes', async () => {
  const cards = readFileSync(new URL('../web/app-cards.js', import.meta.url), 'utf8');
  const lineOf = k => cards.split('\n').find(x => x.includes(k)).trim();
  // the tap (real openAppInfo) asks the real app-kinds pageOrSheet with the live list: a tile whose app has a page now opens it
  const kinds = { window: {} }; vm.runInNewContext(kindsJs, { ...kinds, setTimeout, Promise });
  const opened = [];
  const APP = { 'tg-style': { id: 'tg-style', kind: 'wizard', url: '/tg-style/' } };
  const tap = vm.runInNewContext(`(() => { ${lineOf('function openAppInfo(el, fromSheet)')}\n return openAppInfo; })()`, { AK: kinds.window.WosAppKinds, APP, tapOpen: (a, el, fromSheet) => opened.push([a.id, el.dataset.name, fromSheet]) });
  tap({ dataset: { appinfo: 'tg-style', name: 'TG style' } }, true);
  await new Promise(ok => setImmediate(ok));
  assert.deepEqual(opened, [['tg-style', 'TG style', true]]);
  // the list changing (wizard:apps) redraws the New desk at once, and a failed redraw never breaks the listener
  const on = {}, redraws = [];
  const listen = lineOf("window.addEventListener('wizard:apps',");
  vm.runInNewContext(listen, { window: { addEventListener: (t, f) => { on[t] = f; } }, repaintNewDesks: force => redraws.push(force) });
  on['wizard:apps']();
  assert.deepEqual(redraws, [true]);
  vm.runInNewContext(listen, { window: { addEventListener: (t, f) => { on.bad = f; } }, repaintNewDesks: () => { throw new Error('mid-paint'); } });
  assert.doesNotThrow(() => on.bad());
});

test('a slow read shows the sheet first, then swaps it for the app when the page arrives (Codex review)', async () => {
  const ctx = { window: {} };
  vm.runInNewContext(kindsJs, { ...ctx, setTimeout, Promise });
  const { pageOrSheet } = ctx.window.WosAppKinds;
  const APP = {};
  let finish; const read = new Promise(ok => { finish = ok; });
  let sheetOpen = null; const opened = [];
  ctx.window.WizCore = { refreshApps: () => read };
  ctx.window.WosAppRoute = { open: id => { sheetOpen = id; }, isOpen: () => !!sheetOpen, close: () => { sheetOpen = null; }, get current() { return sheetOpen && { appId: sheetOpen }; } };
  pageOrSheet(APP, 'tg-style', 'TG style', a => opened.push(a.id));
  await new Promise(ok => setTimeout(ok, 1000));
  assert.equal(sheetOpen, 'tg-style', 'sheet shown after the wait');
  APP['tg-style'] = { id: 'tg-style', kind: 'wizard', url: '/tg-style/' };
  finish(true); await new Promise(ok => setImmediate(ok));
  assert.equal(sheetOpen, null, 'sheet closed');
  assert.deepEqual(opened, ['tg-style'], 'app opened');
});
