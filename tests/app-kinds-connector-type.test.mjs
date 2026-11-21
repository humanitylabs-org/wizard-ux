// Connectors are decided by the app's declared type (wizard.md `type: external`, projected by the Agent Service),
// end to end: /wizard/v1/apps snapshot → core/apps.js tiles (page and backend-only) → core/app-kinds.js groups.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const apps = readFileSync(new URL('../web/core/apps.js', import.meta.url), 'utf8');
const kindsJs = readFileSync(new URL('../web/core/app-kinds.js', import.meta.url), 'utf8');

async function shell(snapshot, cached = {}) {
  const storage = new Map();
  if (cached.remote) storage.set('wux.apps.v1', JSON.stringify(cached.remote));
  if (cached.backend) storage.set('wux.apps.backend.v1', JSON.stringify(cached.backend));
  const window = { WizCore: { norm: s => s.toLowerCase() }, WizConfig: { endpoint: () => '/apps' }, dispatchEvent() {} };
  const ctx = { window, document: { hidden: false, addEventListener() {} }, CustomEvent: class {}, URL, location: new URL('https://wizard.test/'),
    localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) },
    addEventListener() {}, fetch: async () => ({ ok: snapshot !== null, json: async () => snapshot }) };
  vm.runInNewContext(apps, ctx);
  vm.runInNewContext(kindsJs, ctx);
  await window.WizCore.appsLoaded();
  const { APPS, APP } = window.WizCore.apps('mobile');
  return { window, groups: window.WosAppKinds.kinds(APPS, APP), APP };
}
const ids = list => [...list].map(a => String(a.id)).sort();

test('a type:external app with a non-"Connect" summary lands in Connectors, page or backend-only', async () => {
  const { window, groups, APP } = await shell({ apps: [
    { id: 'wizard-brightdata', name: 'Bright Data', desc: 'Web data for your agent and apps.', url: '/brightdata/', source: 'apps.json', type: 'external', category: 'app' },
    { id: 'wizard-twitterapi', name: 'TwitterAPI.io', desc: 'X (Twitter) search for your agent and apps.', source: 'apps.json', type: 'external', category: 'app' },
    { id: 'transcriber', name: 'Transcriber', desc: 'Local speech-to-text.', source: 'apps.json', type: 'service', category: 'system' },
    { id: 'money', name: 'Money', desc: 'Review transactions.', url: '/money/', source: 'apps.json', type: 'view', category: 'app' },
  ] });
  assert.equal(APP['wizard-brightdata'].type, 'external');
  assert.equal(APP['wizard-brightdata'].category, 'app');
  assert.equal(window.WizCore.backendApps().find(a => a.id === 'wizard-twitterapi').type, 'external');
  assert.deepEqual(ids(groups.conns), ['wizard-brightdata', 'wizard-twitterapi']);
  assert.ok(!groups.apps.some(a => a.id === 'wizard-brightdata'));
  assert.deepEqual(ids(groups.wiz), ['transcriber']);
  assert.ok(groups.apps.some(a => a.id === 'money'));
});

test('internal routing services never enter the owner app registry', async () => {
  const { window, groups, APP } = await shell({ apps: [
    { id: 'wizard-connection-router', name: 'Connection Router', desc: 'Internal model routing.', url: '/wizard-connection-router/', source: 'apps.json', type: 'service', category: 'system' },
    { id: 'wizard-agent-service', name: 'Wizard Agent Service', desc: 'Internal agent bridge.', source: 'apps.json', type: 'service', category: 'system' },
    { id: 'money', name: 'Money', desc: 'Review transactions.', url: '/money/', source: 'apps.json', type: 'view', category: 'app' },
  ] });
  assert.equal(APP['wizard-connection-router'], undefined);
  assert.equal(APP['wizard-agent-service'], undefined);
  assert.ok(!window.WizCore.backendApps().some(a => ['wizard-connection-router', 'wizard-agent-service'].includes(a.id)));
  assert.ok(!Object.values(groups).flat().some(a => ['wizard-connection-router', 'wizard-agent-service'].includes(a?.id)));
  assert.ok(groups.apps.some(a => a.id === 'money'));
});

test('an offline shell drops stale cached routing-service tiles', async () => {
  const router = { id: 'wizard-connection-router', name: 'Connection Router', url: '/wizard-connection-router/', source: 'apps.json', type: 'service', category: 'system' };
  const agentService = { id: 'wizard-agent-service', name: 'Wizard Agent Service', source: 'apps.json', type: 'service', category: 'system' };
  const { window, APP } = await shell(null, { remote: [router], backend: [agentService] });
  assert.equal(APP['wizard-connection-router'], undefined);
  assert.equal(APP['wizard-agent-service'], undefined);
  assert.equal(window.WizCore.backendApps().length, 0);
});

test('a declared type wins over the summary wording and the id list; untyped tiles keep the fallback', async () => {
  const { groups } = await shell({ apps: [
    { id: 'notes', name: 'Notes', desc: 'Connect your thoughts.', url: '/notes/', source: 'apps.json', type: 'view' },
    { id: 'wizard-claude', name: 'Claude', desc: 'Your Claude subscription.', url: '/claude/', source: 'apps.json', type: 'service' },
    // Older Agent Services sent no type: the id list and "Connect…" wording still sort these.
    { id: 'wizard-monarch', name: 'Monarch', desc: 'Read-only finance data.', url: '/monarch/', source: 'apps.json' },
    { id: 'old-bank', name: 'Old bank', desc: 'Connect your bank.', source: 'apps.json' },
    // Unknown type values are dropped by core/apps.js, so they fall back too.
    { id: 'odd', name: 'Odd', desc: 'Sign in to Odd.', url: '/odd/', source: 'apps.json', type: 'External' },
  ] });
  assert.deepEqual(ids(groups.conns), ['odd', 'old-bank', 'wizard-monarch']);
  assert.ok(groups.apps.some(a => a.id === 'notes'));
  assert.ok(groups.apps.some(a => a.id === 'wizard-claude'));
});

test('isConnector: type decides when present', () => {
  const ctx = { window: {} };
  vm.runInNewContext(kindsJs, ctx);
  const { isConnector } = ctx.window.WosAppKinds;
  assert.equal(isConnector({ id: 'x', type: 'external', desc: 'Web data' }), true);
  assert.equal(isConnector({ id: 'x', type: 'service', desc: 'Connect your bank' }), false);
  assert.equal(isConnector({ id: 'wizard-chatgpt', type: 'view' }), false);
  assert.equal(isConnector({ id: 'wizard-chatgpt' }), true);
  assert.equal(isConnector({ id: 'x', desc: 'Sign in to Foo' }), true);
});

test('the App Store is a normal system tile leading Apps, listed once (ux#1493)', async () => {
  const { window, groups } = await shell({ apps: [
    { id: 'money', name: 'Money', desc: 'Review transactions.', url: '/money/', source: 'apps.json', type: 'view', category: 'app' },
  ] });
  const store = groups.apps.filter(a => a.id === 'app-store');
  assert.equal(store.length, 1, 'App Store is in the Apps group exactly once');
  assert.equal(store[0].url, '/wizard-os-home/store/index.html');
  assert.ok(window.WosAppKinds.isSystem(store[0]), 'App Store wears the system tile');
  const order = window.WosAppKinds.sysFirst(groups.apps).map(a => a.id);
  assert.ok(order.indexOf('app-store') < order.indexOf('money'), 'system apps lead Apps');
  for (const k of ['wiz', 'agents', 'conns', 'dev']) assert.ok(!groups[k].some(a => a.id === 'app-store'), `not also in ${k}`);
  const rows = window.WosAppKinds.rows(window.WizCore.apps('mobile').APPS, window.WizCore.apps('mobile').APP, () => '');
  assert.equal(rows.apps.filter(r => r.id === 'app-store').length, 1);
  assert.equal(rows.apps.find(r => r.id === 'app-store').system, true);
});

// ux#1505 (James): "An agent app should only be something that the user doesn't have a UX for."
test('apps with their own screen are Apps, never Agent apps: the main agent chats and a screenless view app', async () => {
  const { groups, window } = await shell({ apps: [
    // Money with its route not published yet: no url, but it declares a screen (type: view).
    { id: 'money', name: 'Money', desc: 'Review transactions.', source: 'apps.json', type: 'view', category: 'app' },
    { id: 'transcriber', name: 'Transcriber', desc: 'Local speech-to-text.', source: 'apps.json', type: 'service', category: 'system' },
    { id: 'wizard-twitterapi', name: 'TwitterAPI.io', desc: 'X search.', source: 'apps.json', type: 'external', category: 'app' },
  ] });
  assert.ok(groups.apps.some(a => a.id === 'wizard'), 'the main agent chats is in Apps');
  assert.ok(!groups.agents.some(a => a.id === 'wizard'), 'not under Agents (For agents)');
  assert.ok(groups.apps.some(a => a.id === 'money'), 'a view app with no page yet is in Apps');
  assert.ok(!groups.wiz.some(a => a.id === 'money'), 'and not an Agent app');
  assert.deepEqual(ids(groups.wiz), ['transcriber'], 'only screenless apps stay Agent apps');
  assert.deepEqual(ids(groups.conns), ['wizard-twitterapi']);
  const { APPS, APP } = window.WizCore.apps('mobile');
  // The layouts' rows keep Chats out (it is their fixed Chats) but list Money with the apps.
  const rows = window.WosAppKinds.rows(APPS, APP, () => '');
  assert.ok(!rows.apps.some(r => r.id === 'wizard') && !rows.agents.some(r => r.id === 'wizard'));
  assert.ok(rows.apps.some(r => r.id === 'money') && !rows.wiz.some(r => r.id === 'money'));
  // Its tile opens the app's settings sheet until the page is there (after one fresh read of the list, ux#1646).
  const opened = [];
  window.WosAppRoute = { open: id => opened.push(id) };
  assert.equal(window.WosAppKinds.openRow(APPS, APP, 'money', () => false), true);
  await window.WizCore.refreshApps(); await new Promise(ok => setImmediate(ok));
  assert.deepEqual(opened, ['money']);
});

test('hasScreen: a declared view is a screen; services, agents and untyped tiles are not', () => {
  const ctx = { window: {} };
  vm.runInNewContext(kindsJs, ctx);
  const { hasScreen } = ctx.window.WosAppKinds;
  assert.equal(hasScreen({ id: 'money', type: 'view' }), true);
  assert.equal(hasScreen({ id: 'x', type: 'service' }), false);
  assert.equal(hasScreen({ id: 'x', type: 'view', category: 'agent' }), false);
  assert.equal(hasScreen({ id: 'x' }), false);
});
