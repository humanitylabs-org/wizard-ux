// Pages is an agent-facing system utility. It belongs under Agent apps, not the owner's main Apps grid.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const appsJs = readFileSync(new URL('../web/core/apps.js', import.meta.url), 'utf8');
const kindsJs = readFileSync(new URL('../web/core/app-kinds.js', import.meta.url), 'utf8');

async function boot({ shell = 'mobile', inboxThreads = false, apps = [], backendApps = [] } = {}) {
  const storage = new Map();
  const window = {
    WizCore: { norm: s => String(s).toLowerCase() },
    WizConfig: { endpoint: () => '/apps' },
    WosPages: { available: true, ready: Promise.resolve(true) },
    WosSkinHost: { inboxThreads },
    dispatchEvent() {},
  };
  const context = {
    window,
    document: { hidden: false, addEventListener() {} },
    CustomEvent: class {},
    URL,
    location: new URL('https://wizard.test/'),
    localStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
    },
    addEventListener() {},
    fetch: async () => ({ ok: true, json: async () => ({ apps }) }),
  };
  vm.runInNewContext(appsJs, context);
  vm.runInNewContext(kindsJs, context);
  await window.WizCore.appsLoaded();
  // Production normalizes backend records to kind:wizard. Exercise that shape and
  // defensive routing for a retained URL or an incomplete registry projection.
  const registeredBackends = window.WizCore.backendApps();
  window.WizCore.backendApps = () => [...registeredBackends, ...backendApps];
  const { APPS, APP } = window.WizCore.apps(shell);
  return { window, APPS, APP, page: APP.pages, groups: window.WosAppKinds.kinds(APPS, APP), opens: window.WosAppKinds.opensScreen(APP.pages) };
}

test('Pages is explicitly grouped with Agent apps and excluded from Apps', async () => {
  const { page, groups, opens } = await boot();
  assert.equal(page.agentApp, true);
  assert.equal(page.screen, true);
  assert.equal(opens, true);
  assert.equal(groups.apps.some(app => app.id === 'pages'), false);
  assert.equal(groups.wiz.some(app => app.id === 'pages'), true);
});

test('Pages stays directly openable from both shell pickers', () => {
  const kinds = readFileSync(new URL('../web/core/app-kinds.js', import.meta.url), 'utf8');
  const phone = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const desktop = readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8');
  assert.match(kinds, /const opensScreen = a =>/);
  assert.match(phone, /const kindTile = a => APP\[a\.id\] && AK\.opensScreen\(a\)/);
  assert.match(phone, /wiz: grp\('wiz', sysSplit\(K\.wiz, kindTile\)\)/);
  assert.match(desktop, /run: o => APP\[a\.id\] && AK\.opensScreen\(a\) \? openApp\(a, o\)/);
});

// Execute the actual grouped picker and opener bodies, not a second copy of their policy.
// DOM layout, skins and physical taps still require the separate browser acceptance hold.
function section(src, start, end) {
  const from = src.indexOf(start), to = src.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `production seam exists: ${start}`);
  return src.slice(from, to);
}

async function picker(shell, inboxThreads, backendApps = []) {
  const state = await boot({ shell, inboxThreads, backendApps, apps: [
    { id: 'notifications', name: 'Notifications', url: '/notifications/' },
    { id: 'calendar', name: 'Calendar', url: '/calendar/' },
    { id: 'screenless', name: 'Screenless' },
  ] });
  const calls = [];
  state.window.WosAppRoute = { open: id => calls.push(['settings', id]) };
  state.window.WosPages.match = url => /^\/pages\/([^/]+)\/?$/.exec(url)?.[1] || null;
  const src = readFileSync(new URL(shell === 'mobile' ? '../web/app.js' : '../web/desktop/desktop.js', import.meta.url), 'utf8');
  const context = {
    ...state, calls, palFold: true, tileN: 0, foldOpen: { agents: true, dev: true },
    esc: s => String(s), ico: () => '', closeSheets() {}, findWin: () => null,
    placeApp: (_match, win) => calls.push(['window', win]),
    newWin: win => calls.push(['window', win]),
  };
  let setup;
  if (shell === 'mobile') {
    setup = section(src, '  const AK = window.WosAppKinds;', '  // "+ Get ..." tiles open')
      + section(src, '  function appTile(', '  function appRow(')
      + section(src, '  function openAppInfo(', '  function renderEmpty(')
      + section(src, '  function openApp(', '  /* Move an open window');
    setup += `
      globalThis.html = kindGroups(['apps', 'wiz', 'agents', 'conns']);
      globalThis.activate = id => {
        const tile = html.match(new RegExp('<button[^>]*data-app(?:info)?="' + id + '"[^>]*>'))?.[0];
        if (!tile) throw new Error('Missing production tile: ' + id);
        if (tile.includes('data-appinfo=')) openAppInfo({ dataset: { appinfo: id } });
        else openApp(APP[id]);
      };`;
  } else {
    setup = section(src, '  function pickKinds()', '  function pickRender()')
      + section(src, '  function openApp(', '  // Prefer this workspace');
    setup += `
      globalThis.blocks = pickKinds();
      globalThis.activate = id => {
        const tile = blocks.flatMap(b => b.items || []).find(it => it.app?.id === id);
        if (!tile) throw new Error('Missing production tile: ' + id);
        tile.run({});
      };`;
  }
  vm.runInNewContext(setup, context);
  return { ...state, calls, context, activate: context.activate };
}

for (const shell of ['mobile', 'desktop']) {
  test(`${shell}: backend-only records open settings even with a stale URL or missing kind`, async () => {
    const apps = [
      { id: 'backend-normal', kind: 'wizard', name: 'Backend normal' },
      { id: 'backend-url', kind: 'wizard', name: 'Backend URL', url: '/old-backend/' },
      { id: 'backend-kindless', name: 'Backend kindless' },
    ];
    const p = await picker(shell, true, apps);
    for (const app of apps) {
      assert.equal(p.APP[app.id], undefined);
      p.activate(app.id);
      assert.equal(p.calls.at(-1)[0], 'settings');
      assert.equal(p.calls.at(-1)[1], app.id);
    }
  });

  test(`${shell}: unified-inbox Notifications tile opens settings, never its legacy URL`, async () => {
    const p = await picker(shell, true);
    assert.ok(p.groups.wiz.some(a => a.id === 'notifications'));
    assert.ok(!p.groups.apps.some(a => a.id === 'notifications'));
    p.activate('notifications');
    assert.equal(p.calls.length, 1);
    assert.equal(p.calls[0][0], 'settings');
    assert.equal(p.calls[0][1], 'notifications');
  });

  test(`${shell}: Pages opens its library while legacy screenless tiles open settings`, async () => {
    const p = await picker(shell, true);
    assert.ok(p.groups.wiz.some(a => a.id === 'pages'));
    assert.ok(!p.groups.apps.some(a => a.id === 'pages'));
    p.activate('pages');
    assert.equal(p.calls[0][0], 'window');
    assert.equal(p.calls[0][1].app, 'pages');
    assert.equal(p.calls[0][1].appId, 'pages');
    p.activate('screenless');
    assert.equal(p.calls[1][0], 'settings');
    assert.equal(p.calls[1][1], 'screenless');
  });

  test(`${shell}: ordinary URL apps and non-unified Notifications still open frames`, async () => {
    const p = await picker(shell, false);
    assert.ok(p.groups.apps.some(a => a.id === 'notifications'));
    for (const id of ['calendar', 'notifications']) {
      p.activate(id);
      const [kind, win] = p.calls.at(-1);
      assert.equal(kind, 'window');
      assert.equal(win.app, 'frame');
      assert.equal(win.appId, id);
    }
    // A skin/tweak switch must change policy without a stale registry or reload.
    p.window.WosSkinHost.inboxThreads = true;
    assert.equal(p.window.WosAppKinds.opensScreen(p.APP.notifications), false);
    p.window.WosSkinHost.inboxThreads = false;
    assert.equal(p.window.WosAppKinds.opensScreen(p.APP.notifications), true);
  });
}

test('agent utilities need an explicit screen opt-in even when they retain a URL', async () => {
  const { window } = await boot();
  const app = { id: 'utility', kind: 'wizard', agentApp: true, url: '/utility/' };
  assert.equal(window.WosAppKinds.opensScreen(app), false);
  assert.equal(window.WosAppKinds.opensScreen({ ...app, screen: true }), true);
  assert.equal(window.WosAppKinds.opensScreen(null), false);
  const notification = { id: 'notifications', kind: 'wizard', screen: true, url: '/notifications/' };
  window.WosSkinHost.inboxThreads = true;
  assert.equal(window.WosAppKinds.opensScreen(notification), false, 'unified inbox wins over screen opt-in');
});
