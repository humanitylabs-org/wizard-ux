// Connectors are decided by the app's declared type (wizard.md `type: external`, projected by the Agent Service),
// end to end: /wizard/v1/apps snapshot → core/apps.js tiles (page and backend-only) → core/app-kinds.js groups.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const apps = readFileSync(new URL('../web/core/apps.js', import.meta.url), 'utf8');
const kindsJs = readFileSync(new URL('../web/core/app-kinds.js', import.meta.url), 'utf8');

async function shell(snapshot) {
  const storage = new Map();
  const window = { WizCore: { norm: s => s.toLowerCase() }, WizConfig: { endpoint: () => '/apps' }, dispatchEvent() {} };
  const ctx = { window, document: { hidden: false, addEventListener() {} }, CustomEvent: class {}, URL, location: new URL('https://wizard.test/'),
    localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) },
    addEventListener() {}, fetch: async () => ({ ok: true, json: async () => snapshot }) };
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
