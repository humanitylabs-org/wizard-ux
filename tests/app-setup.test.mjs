import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as router from '../web/store/store-router.js';
import { installRelease } from '../web/store/store-install.js';
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const provider = { id: 'wizard-tinfoil', name: 'Wizard Tinfoil', provides: ['live-transcription'], private: true, models: [{ id: 'flash', tier: 'fast' }] };
const service = { slot: 'live-transcription', required: true, purpose: 'Words appear as you speak', recommend: provider.id, private_data: true, status: 'missing' };
async function harness(result, store = new Map()) {
  const localStorage = { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)) };
  const listeners = {}, sandbox = { URL, console, setTimeout, clearTimeout, Map, Set, Promise, JSON, localStorage, location: { href: 'https://fixture.test/wizard-os-home/' },
    document: { currentScript: { src: 'https://fixture.test/wizard-os-home/core/app-setup.js' }, addEventListener: (e, f) => listeners[e] = f, querySelectorAll: () => [] }, addEventListener: (e, f) => listeners[e] = f,
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
  assert.match(html, /Set up Tinfoil/); assert.match(html, /Words appear as you speak/); assert.match(html, /<details class="mc-row"/); assert.match(html, /Use another/);
  assert.match(html, /data-mc-installed="0"/);
  assert.match(setup.html('recorder', data, { storeApps: [provider], isInstalled: () => true }), /data-mc-installed="1">Connect/);
  assert.match(setup.controls('recorder', data, { storeApps: [provider] }), /Set up with Tinfoil/);
});
test('private_data blocked is explicit and other-provider choices exclude public and unknown privacy', async () => {
  const data = { models: [], services: [{ ...service, status: 'blocked', error: { message: 'The selected provider is not private.' } }], providers: [provider, { ...provider, id: 'public', private: false }, { ...provider, id: 'unknown', private: undefined }] };
  const setup = await harness({ data }); assert.equal(setup.canContinue(data), false);
  assert.match(setup.html('recorder', data), /aria-label="Not ready"/); assert.match(setup.html('recorder', data), /private provider is required/);
  assert.deepEqual(Array.from(setup.choices(service, data), p => p.id), [provider.id]);
});
test('only optional gaps permit Open app without nagging; omitted required is conservatively required', async () => {
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
// James, 28 Oct 2026: tapping into an app sat for 3-5 s with nothing on screen while the Router check ran.
test('a slow Router check never holds the window: it opens within the short wait, and at once once known ready', async () => {
  const store = new Map(); let release;
  let setup = await harness(() => new Promise(resolve => { release = resolve; }), store); let opens = 0;
  const t0 = Date.now(); setup.gate({ id: 'notes' }, () => opens++);
  await new Promise(r => setTimeout(r, 750)); assert.equal(opens, 1, 'opened before the check answered'); assert.ok(Date.now() - t0 < 1000);
  assert.equal(setup.back(), false, 'Back after the window opened is the window\'s, not the check\'s');
  release({ data: { models: [], services: [], ready_to_open: true } }); await new Promise(setImmediate); assert.equal(opens, 1, 'no second open');
  setup = await harness(() => new Promise(() => {}), store); opens = 0;
  setup.gate({ id: 'notes' }, () => opens++); assert.equal(opens, 1, 'known-ready app opens synchronously');
});
test('a late required gap does not put a sheet over a different app', async () => {
  let release; const setup = await harness(() => new Promise(resolve => { release = resolve; })); let opens = 0;
  setup.init({ isFront: () => false });
  setup.gate({ id: 'recorder' }, () => opens++); await new Promise(r => setTimeout(r, 700)); assert.equal(opens, 1);
  release({ data: { models: [], services: [service], providers: [], ready_to_open: false } }); await new Promise(setImmediate);
  assert.equal(setup.isOpen(), false);
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
    // A late setup sheet only lands on the app still in front, on the phone and on desktop.
    assert.match(src, /WosAppSetup\?\.init\(\{[^}]*isFront: id =>/, `${file} passes isFront`);
  }
  const store = read('web/store/store.js'); assert.match(store, /Setup\.html\(routerId\(a\)/); assert.match(store, /Setup\.html\(id/); assert.match(store, /await installRelease\(/);
});

test('captured Recorder needs share one recommendation even before a signed-out provider lists its models', async () => {
  const setup = await harness({});
  const data = JSON.parse(read('tests/fixtures/recorder-needs-before.json'));
  const registry = [{ ...provider, name: 'Tinfoil', provides: ['live-transcription', 'ai-connection'] }];
  const ctx = { name: 'Recorder', storeApps: registry };
  const rows = setup.html(data.app, data, ctx), controls = setup.controls(data.app, data, ctx);
  assert.equal((rows.match(/<details /g) || []).length, 3);
  assert.deepEqual([...rows.matchAll(/class="mc-name">([^<]+)/g)].map(m => m[1]), ['Live transcription', 'Live summary', 'Recap']);
  assert.doesNotMatch(rows, /Tested on|Your choice|Needs a provider|<[^>]+>Required</);
  assert.equal((controls.match(/data-mc-connect=/g) || []).length, 1);
  assert.match(controls, /Set up with Tinfoil/);
  assert.match(controls, /data-mc-installed="1"/);
  assert.equal(router.connectTarget(data.models[0], data, registry).id, provider.id);
  assert.equal(router.connectTarget(data.models[0], data, [{ ...registry[0], private: false }]), null);
  data.providers = [];
  assert.match(setup.controls(data.app, data, ctx), /data-mc-installed="0"/);
});
test('captured ready and optional-only Recorder needs offer only Open Recorder', async () => {
  const setup = await harness({});
  for (const data of [JSON.parse(read('tests/fixtures/recorder-needs-ready.json')), { models: [], services: [{ ...service, required: false }] }]) {
    const controls = setup.controls('wizard-recorder', data, { name: 'Recorder' });
    assert.match(controls, /Open Recorder/);
    assert.equal((controls.match(/<button /g) || []).length, 1);
    assert.doesNotMatch(controls, /Use another|Set up with|Continue anyway/);
  }
});
test('different recommendations use the first displayed required need and registry display names', async () => {
  const setup = await harness({});
  const data = { models: [], services: [service, { ...service, slot: 'recap', recommend: 'wizard-other' }] };
  const controls = setup.controls('recorder', data, { storeApps: [{ ...provider, name: 'Tinfoil Secure' }] });
  assert.match(controls, /Set up with Tinfoil Secure/);
  assert.doesNotMatch(controls, /Set up with Other/);
});
test('compact disclosures escape need copy and never use purpose as the row name', async () => {
  const setup = await harness({});
  const rows = setup.html('recorder', { models: [], services: [{ ...service, purpose: '<img onerror=alert(1)>' }] });
  assert.match(rows, /class="mc-name">Live transcription/);
  assert.match(rows, /&lt;img onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(rows, /<img/);
});

test('install links open the Store window synchronously so the link reaches its frame (both shells)', () => {
  for (const [file, call] of [['web/app.js', "openApp(APP['app-store'], {}, { setupChecked: true })"], ['web/desktop/desktop.js', "openApp(APP['app-store'], { setupChecked: true })"]]) {
    const src = read(file), at = src.indexOf("if (v === 'install') {");
    assert.ok(at > 0, file); assert.ok(src.slice(at, at + 400).includes(call), `${file} skips the async setup gate for the install link`);
  }
});
