import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as router from '../web/store/store-router.js';
import { installRelease } from '../web/store/store-install.js';
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const provider = { id: 'wizard-tinfoil', name: 'Wizard Tinfoil', provides: ['live-transcription'], private: true, models: [{ id: 'flash', tier: 'fast' }] };
const service = { slot: 'live-transcription', required: true, purpose: 'Words appear as you speak', recommend: provider.id, private_data: true, status: 'missing' };
async function harness(result) {
  const listeners = {}, sandbox = { URL, console, setTimeout, Map, Set, Promise, location: { href: 'https://fixture.test/wizard-os-home/' },
    document: { currentScript: { src: 'https://fixture.test/wizard-os-home/core/app-setup.js' }, addEventListener: (e, f) => listeners[e] = f }, addEventListener: (e, f) => listeners[e] = f,
    load: async url => url.includes('store-router') ? { ...router, routerNeeds: async () => typeof result === 'function' ? result() : result } : { installRelease } };
  sandbox.window = sandbox;
  vm.runInNewContext(read('web/core/app-setup.js').replace(/\bimport\(/g, 'load('), sandbox);
  await sandbox.WosAppSetup.ready; return sandbox.WosAppSetup;
}
test('all ready needs open directly without constructing a checklist', async () => {
  const data = { ready_to_open: true, models: [], services: [{ ...service, status: 'ready' }] };
  const setup = await harness({ data }); let opens = 0;
  assert.equal(setup.needsSetup(data), false); assert.equal(setup.canContinue(data), true);
  setup.gate({ id: 'recorder' }, () => opens++); await new Promise(setImmediate); assert.equal(opens, 1);
});
test('missing required service has recommended setup, purpose and no Continue admission', async () => {
  const data = { ready_to_open: false, models: [], services: [service] }, setup = await harness({ data });
  assert.equal(setup.needsSetup(data), true); assert.equal(setup.canContinue(data), false);
  const html = setup.html('recorder', data, { storeApps: [provider] });
  assert.match(html, /Set up Tinfoil/); assert.match(html, /Words appear as you speak/); assert.match(html, /Required/); assert.match(html, /Use another/);
  assert.match(html, /data-mc-installed="0"/);
  assert.match(setup.html('recorder', data, { storeApps: [provider], isInstalled: () => true }), /data-mc-installed="1">Connect/);
});
test('private_data blocked is explicit and other-provider choices exclude public and unknown privacy', async () => {
  const data = { models: [], services: [{ ...service, status: 'blocked', error: { message: 'The selected provider is not private.' } }], providers: [provider, { ...provider, id: 'public', private: false }, { ...provider, id: 'unknown', private: undefined }] };
  const setup = await harness({ data }); assert.equal(setup.canContinue(data), false);
  assert.match(setup.html('recorder', data), /Blocked/); assert.match(setup.html('recorder', data), /not private/);
  assert.deepEqual(Array.from(setup.choices(service, data), p => p.id), [provider.id]);
});
test('only optional gaps permit Continue anyway; omitted required is conservatively required', async () => {
  const setup = await harness({});
  assert.equal(setup.canContinue({ services: [{ ...service, required: false }] }), true);
  assert.equal(setup.needsSetup({ ready_to_open: true, services: [{ ...service, required: false }] }), true);
  assert.equal(setup.canContinue({ services: [{ status: 'missing' }] }), false);
});
test('model checklist shows a single named approval and never silently swaps strict models', async () => {
  const setup = await harness({}); const model = { feature: 'recap', required: true, tier: 'fast', tested_on: 'flash', status: 'needs_owner', swap: 'ask', offered: { provider: 'local', model: 'local-fast', tier: 'fast' } };
  let html = setup.html('recorder', { models: [model] });
  assert.match(html, /Approve swap to local-fast/); assert.doesNotMatch(html, /data-mc-connect/);
  html = setup.html('recorder', { models: [{ ...model, swap: 'never' }] }); assert.doesNotMatch(html, /data-mc-approve/);
});
test('Router 404/501 and network failure do not block app opening', async () => {
  for (const result of [{ error: 'outdated', status: 501 }, { error: 'unavailable', status: 404 }, { error: 'unavailable' }]) {
    const setup = await harness(result); let opens = 0; setup.gate({ id: 'recorder' }, () => opens++); await new Promise(setImmediate); assert.equal(opens, 1);
  }
});
test('Back cancels an in-flight needs read and a newer launch supersedes the older one', async () => {
  let release; const setup = await harness(() => new Promise(resolve => { release = resolve; })); let opens = 0;
  setup.gate({ id: 'recorder' }, () => opens++); await new Promise(setImmediate);
  assert.equal(setup.back(), true); release({ data: { models: [], services: [], ready_to_open: true } });
  await new Promise(setImmediate); assert.equal(opens, 0);
});
test('routerNeeds uses the shared owner proxy and handles an old Router 501', async () => {
  const previous = globalThis.fetch;
  try { globalThis.fetch = async (url, options) => { assert.match(url, /store-data\/router\/v1\/needs\/recorder$/); assert.ok(options.signal); return { ok: false, status: 501, json: async () => ({}) }; }; assert.deepEqual(await router.routerNeeds('recorder'), { error: 'outdated', status: 501 }); }
  finally { globalThis.fetch = previous; }
});
test('shared Store release transaction sends and verifies the exact qualified selection', async () => {
  const previous = globalThis.fetch, a = { id: provider.id, source: 'standard', repo: 'https://github.com/qa/tinfoil', commit: 'a'.repeat(40) };
  try {
    let calls = 0;
    globalThis.fetch = async (url, opts) => { calls++; assert.match(url, /store-install\/wizard-tinfoil$/); assert.equal(opts.headers['X-Wizard-Store'], '1'); const selection = JSON.parse(opts.body); assert.deepEqual(selection, { source: a.source, repo: a.repo, commit: a.commit, operation: 'install' }); return { ok: true, status: 200, json: async () => ({ state: 'installed', selection }) }; };
    await installRelease(a); assert.equal(calls, 1);
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ state: 'installed', selection: { ...a, operation: 'install', commit: 'b'.repeat(40) } }) });
    await assert.rejects(() => installRelease(a), /different release/);
  } finally { globalThis.fetch = previous; }
});
test('both launchers put admission before window creation; Back peels setup before window/root handling', () => {
  for (const file of ['web/app.js', 'web/desktop/desktop.js']) {
    const src = read(file), start = src.indexOf('  function openApp('), gate = src.indexOf('WosAppSetup.gate', start), next = src.indexOf('\n  function ', start + 5);
    assert.ok(gate > start && gate < next); assert.match(src.slice(start, gate + 140), /setupChecked: true/);
    const back = src.indexOf("return 'app-setup'"); assert.ok(back > 0);
  }
  const store = read('web/store/store.js'); assert.match(store, /Setup\.html\(routerId\(a\)/); assert.match(store, /Setup\.html\(id/); assert.match(store, /await installRelease\(/);
});
