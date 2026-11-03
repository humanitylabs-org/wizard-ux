// Pages is an agent-facing system utility. It belongs under Agent apps, not the owner's main Apps grid.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const appsJs = readFileSync(new URL('../web/core/apps.js', import.meta.url), 'utf8');
const kindsJs = readFileSync(new URL('../web/core/app-kinds.js', import.meta.url), 'utf8');

async function boot() {
  const storage = new Map();
  const window = {
    WizCore: { norm: s => String(s).toLowerCase() },
    WizConfig: { endpoint: () => '/apps' },
    WosPages: { available: true, ready: Promise.resolve(true) },
    WosSkinHost: { inboxThreads: false },
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
    fetch: async () => ({ ok: true, json: async () => ({ apps: [] }) }),
  };
  vm.runInNewContext(appsJs, context);
  vm.runInNewContext(kindsJs, context);
  await window.WizCore.appsLoaded();
  const { APPS, APP } = window.WizCore.apps('mobile');
  return { page: APP.pages, groups: window.WosAppKinds.kinds(APPS, APP), opens: window.WosAppKinds.opensScreen(APP.pages) };
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
  assert.match(phone, /const kindTile = a => AK\.opensScreen\(a\)/);
  assert.match(phone, /wiz: grp\('wiz', sysSplit\(K\.wiz, kindTile\)\)/);
  assert.match(desktop, /run: o => AK\.opensScreen\(a\) \? openApp\(a, o\)/);
});
