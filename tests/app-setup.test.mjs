import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as router from '../web/store/store-router.js';
import { installRelease } from '../web/store/store-install.js';
import { withDesktopParts } from './fixtures/desktop-parts.mjs';
import { withShellParts } from './fixtures/shell-parts.mjs';
const read = p => withShellParts(fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8'));
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
  const previous = globalThis.fetch, a = { id: 'wizard-tinfoil', source: 'standard', repo: 'https://github.com/qa/tinfoil', commit: 'a'.repeat(40) };
  try {
    let calls = 0;
    globalThis.fetch = async (to, sent) => { calls++; assert.match(to, /store-install\/wizard-tinfoil$/); assert.equal(sent.headers['X-Wizard-Store'], '1'); const selection = JSON.parse(sent.body); assert.deepEqual(selection, { source: a.source, repo: a.repo, commit: a.commit, operation: 'install' }); return { ok: true, status: 200, json: async () => ({ state: 'installed', selection }) }; };
    await installRelease(a); assert.equal(calls, 1);
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ state: 'installed', selection: { ...a, operation: 'install', commit: 'b'.repeat(40) } }) });
    await assert.rejects(() => installRelease(a), /different release/);
  } finally { globalThis.fetch = previous; }
});
// The shells' real openApp, setup init and install-link code (app-search.js / desktop-resize.js, app-boot.js /
// desktop-links.js), sliced out and run with small stand-ins for the shell names they use.
const sliceFn = (src, start) => { const i = src.indexOf(start); assert.ok(i >= 0, start); const j = src.indexOf('\n  }\n', i); assert.ok(j > i); return src.slice(i, j + 4); };
function launcher(file) {
  const src = read(file), phone = file === 'web/app.js';
  const log = [], gates = [], inits = [];
  const ctx = vm.createContext({ log, APP: {}, appVars: { idx: 0, W: {} }, desktopVars: { ws: [] }, HOME: 0,
    window: { WosAppSetup: { init: o => inits.push(o), gate: (a, open, o) => { gates.push({ a, open, o }); log.push('gate:' + a.id); return 'gated'; } } },
    openingEnd: id => log.push('openingEnd:' + id), closeSheets() {}, framePage() {}, renderDesk() {}, go: () => true,
    placeApp: (match, w) => { log.push('window:' + w.appId); }, newWin: w => log.push('window:' + w.appId), findWin: () => null, focusWin() {},
    focusedWin: () => ({ appId: 'notes' }), focused: () => ({ appId: 'notes' }), CHATS: { views: { defaultId: () => 'c', providerFor: () => 'c' } } });
  const init = phone ? "  window.WosAppSetup?.init({ getApp: id => APP[id], isFront: id => focusedWin()?.appId === id });" : "  window.WosAppSetup?.init({ getApp: id => APP[id], isFront: id => focused()?.appId === id });";
  assert.ok(src.includes(init), file);
  vm.runInContext(init + '\n' + sliceFn(src, phone ? '  function openApp(a, extra = {}, opts = {}) {' : '  function openApp(a, opts = {}) {') + '\nthis.openApp = openApp;', ctx);
  return { ctx, log, gates, inits };
}

test('both launchers put admission before window creation; Back peels setup before window/root handling', () => {
  for (const file of ['web/app.js', 'web/desktop/desktop.js']) {
    const L = launcher(file), notes = { id: 'notes', kind: 'wizard', url: '/notes/' };
    assert.equal(L.ctx.openApp(notes), 'gated', file);
    assert.deepEqual(L.log, ['gate:notes'], `${file}: the setup check runs before any window exists`);
    L.gates[0].open();
    assert.deepEqual(L.log, ['gate:notes', 'window:notes'], `${file}: once admitted (setupChecked), the window opens without a second check`);
    assert.equal(L.gates.length, 1);
    // A late setup sheet only lands on the app still in front, on the phone and on desktop.
    assert.equal(L.inits.length, 1); assert.equal(L.inits[0].isFront('notes'), true); assert.equal(L.inits[0].isFront('recorder'), false, `${file} passes isFront`);
    // Troubleshooter never waits for setup.
    L.log.length = 0; L.ctx.openApp({ id: 'troubleshooter', kind: 'wizard', url: '/troubleshoot/' }); assert.deepEqual(L.log, ['window:troubleshooter']);
  }
  // Back: the one owner catalog both shells install (WizEscapeBack.installOwners) peels setup with WosAppSetup.back().
  let open = true, backs = 0;
  const W = { WosAppSetup: { isOpen: () => open, back: () => { backs++; open = false; return 'setup'; } } };
  const EB = escapeBackOn(W), stack = EB.create();
  EB.installOwners(stack, { chats: () => ({}), links: () => null });
  let roots = 0; const fallback = () => (roots++, 'root');
  assert.equal(stack.run({ fallback, surface: () => false }), 'setup');
  assert.equal(backs, 1); assert.equal(roots, 0, 'the window/root is not touched while setup is open');
  assert.equal(stack.run({ fallback, surface: () => false }), 'root');
  assert.equal(backs, 1);
  // (both shells install that catalog: back-owners.test.mjs runs each shell's own installOwners call)
});

// the real core/escape-back.js on `window`
function escapeBackOn(window) {
  const ctx = vm.createContext({ window, document: { addEventListener() {} }, addEventListener() {}, setTimeout, clearTimeout, queueMicrotask, MutationObserver: class { observe() {} disconnect() {} } });
  vm.runInContext(read('web/core/escape-back.js'), ctx);
  return window.WizEscapeBack;
}

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
  for (const file of ['web/app.js', 'web/desktop/desktop.js']) {
    const src = withDesktopParts(read(file)), at = src.indexOf("      if (v === 'install') {");
    const block = src.slice(at, src.indexOf('\n      }\n', at) + 8);
    const log = [], iframe = { tag: 'iframe' }, store = { id: 'app-store' };
    const win = { id: 'w1', appId: 'app-store' };
    const W = {}, ctx = vm.createContext({ log, APP: { 'app-store': store }, W, appVars: { W }, installQuery: 'id=x',
      window: { WosAppSetup: { close: () => log.push('close') }, WizCore: { deeplink: { installInFrame: (f, q) => (log.push(['frame', f, q]), 'ok') } } },
      C: { deeplink: { installInFrame: (f, q) => (log.push(['frame', f, q]), 'ok') } },
      openApp: (a, x, y) => { log.push(['open', a.id, (y || x).setupChecked === true]); W.w1 = win; },
      findWin: fn => (W.w1 && fn(win) ? win : null), winEl: () => ({ querySelector: () => iframe }),
      document: { querySelector: s => (s === '[data-win="w1"] iframe' ? iframe : null) } });
    vm.runInContext(`this.view = v => {\n${block}\n};`, ctx);
    assert.equal(ctx.view('install'), 'ok', file);
    assert.equal(log[0], 'close', `${file} cancels an earlier pending setup gate first`);
    assert.deepEqual(log[1], ['open', 'app-store', true], `${file} skips the async setup gate for the install link`);
    assert.equal(log[2][1], iframe, `${file}: the link reaches the Store frame opened in the same call`);
    assert.equal(log[2][2], 'id=x');
  }
});
