// Personal modules: exact-byte consent, fail-closed transport, and the shared hook lifecycle.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
const source = p => readFileSync(new URL('../web/core/' + p, import.meta.url), 'utf8');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const tick = () => new Promise(r => setTimeout(r, 10));
const CODE = '// café 🌙\r\nexport default api => () => {};\r\n';

async function boot({ code = CODE, approved = null, header, metaHash, type = 'application/javascript', search = '', oversized = false } = {}) {
  const bytes = new TextEncoder().encode(code), sha = hash(bytes), store = new Map(approved ? [['wos.myskin.js.ok', approved === true ? sha : approved]] : []);
  const calls = [], loaded = []; let stopped = 0;
  const ctx = { URLSearchParams, Uint8Array, TextDecoder, crypto: webcrypto, location: { search },
    localStorage: { getItem: k => store.get(k) || null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    WosSkinHost: { personalState: { ready: true }, scriptProblem: () => null, stopPersonal() { stopped++; }, async loadPersonal(b, allowed) { if (allowed()) loaded.push(b); } },
    fetch: async url => {
      calls.push(url);
      if (url.endsWith('format=json')) return { ok: true, json: async () => ({ script: { exists: code !== null, sha256: metaHash || sha, bytes: oversized ? 65537 : bytes.length } }) };
      if (url.endsWith('/script')) return { ok: true, headers: { get: k => k.toLowerCase() === 'content-type' ? type : header || sha }, arrayBuffer: async () => bytes.buffer };
      return { ok: true, headers: { get: () => 'text/css' }, text: async () => '' };
    },
  };
  ctx.window = ctx;
  vm.runInNewContext(source('my-skin.js'), ctx);
  await ctx.WosMySkin.refresh(); // await the real async digest; no wall-clock sleep under concurrent test load
  return { M: ctx.WosMySkin, ctx, bytes, sha, calls, loaded, store, get stopped() { return stopped; } };
}

test('unapproved personal module is never imported and synthetic/agent consent is refused', async () => {
  const b = await boot();
  assert.equal(b.loaded.length, 0);
  assert.equal(b.M.state.script.valid, true);
  assert.equal(b.M.turnOn(), false);
  assert.equal(b.M.turnOn({ isTrusted: true, type: 'click', target: { closest: () => ({ isConnected: true, dataset: { myskinHash: b.sha } }) } }), false);
  assert.equal(b.store.has('wos.myskin.js.ok'), false);
});

test('approved hash imports the exact fetched UTF-8/CRLF bytes, once across refreshes, without a second URL import', async () => {
  const b = await boot({ approved: true });
  assert.equal(b.loaded.length, 1);
  assert.deepEqual(new Uint8Array(b.loaded[0]), b.bytes);
  assert.equal(b.calls.filter(u => u.endsWith('/script')).length, 1);
  await b.M.refresh();
  assert.equal(b.loaded.length, 1, 'no duplicate hooks on visibility refresh');
  b.M.turnOff();
  assert.equal(b.store.has('wos.myskin.js.ok'), false);
  assert.equal(b.M.state.script.approved, false);
  assert.ok(b.stopped > 0);
});

test('new file version revokes the previous device approval', async () => {
  const b = await boot({ approved: hash('previous version') });
  assert.equal(b.loaded.length, 0);
  assert.equal(b.store.has('wos.myskin.js.ok'), false);
});

test('mismatched metadata/header, non-JS, missing script and excessive bytes all fail closed', async () => {
  for (const opts of [{ header: '0'.repeat(64) }, { metaHash: '0'.repeat(64) }, { type: 'text/html' }, { code: null }, { oversized: true }]) {
    const b = await boot({ approved: true, ...opts });
    assert.equal(b.loaded.length, 0, JSON.stringify(opts));
    assert.equal(b.M.state.script.approved, false);
  }
});

test('?myskin=off fetches and imports nothing even with a saved script approval', async () => {
  const b = await boot({ approved: true, search: '?myskin=off' });
  await b.M.refresh(); await b.M.startScript();
  assert.equal(b.calls.length, 0); assert.equal(b.loaded.length, 0);
  assert.equal(b.store.get('wos.myskin.js.ok'), b.sha, 'escape hatch does not destroy consent');
});

function hostPage() {
  const imported = [], toasts = [], revoked = [], blobs = new Map(), handlers = new Map(); let seq = 0, torn = 0;
  const target = { addEventListener(t, fn) { handlers.set(fn, t); }, removeEventListener(t, fn) { handlers.delete(fn); } };
  const ctx = { URL: { createObjectURL(b) { const id = 'blob:verified-' + ++seq; blobs.set(id, b); return id; }, revokeObjectURL(u) { revoked.push(u); } }, Blob,
    console: { warn() {} }, matchMedia: () => ({ matches: true }), navigator: { userAgent: 'Android' },
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    WosSkin: { current: 'fixture', pkgOf: () => ({ dir: 'fixture', js: true, when: 'always' }), list: [] },
  };
  ctx.window = ctx; vm.runInNewContext(source('skin-host.js'), ctx);
  const H = ctx.WosSkinHost, order = [];
  let personalApi;
  H._test.setImporter(async url => {
    imported.push(url);
    if (url.startsWith('skins/')) { await tick(); return { default() { order.push('package'); return () => order.push('package off'); } }; }
    return { default(api) { order.push('personal'); personalApi = api; api.listen(target, 'click', () => {}); return () => { torn++; }; } };
  });
  const adapter = { route: () => ({ view: 'desk' }), root: () => target, toast: t => toasts.push(t) };
  return { H, ctx, adapter, order, imported, blobs, revoked, handlers, toasts, get api() { return personalApi; }, get torn() { return torn; } };
}

test('personal layer reuses package hooks, waits for the package, revokes Blob URLs, and never starts in preview', async () => {
  const p = hostPage(); p.H.preview('fixture'); await tick(); assert.equal(p.imported.length, 0);
  p.H.attach(p.adapter);
  const bytes = new TextEncoder().encode(CODE);
  assert.equal(await p.H.loadPersonal(bytes, () => true), true);
  assert.deepEqual(p.order, ['package', 'personal']);
  assert.deepEqual(new Uint8Array(await p.blobs.get(p.imported[1]).arrayBuffer()), bytes);
  assert.deepEqual(p.revoked, [p.imported[1]]);
  assert.equal(p.handlers.size, 1);
  p.H.stopPersonal(); assert.equal(p.torn, 1); assert.equal(p.handlers.size, 0);
  assert.equal(p.H.state.active, 'fixture', 'turning personal off does not unload package');
});

test('stale/revoked personal loads cannot execute after waiting for package setup', async () => {
  const p = hostPage(); p.H.attach(p.adapter);
  const pending = p.H.loadPersonal(new Uint8Array([1]), () => true);
  p.H.stopPersonal();
  assert.equal(await pending, false);
  assert.equal(p.imported.filter(u => u.startsWith('blob:')).length, 0);
  assert.equal(await p.H.loadPersonal(new Uint8Array([1]), () => false), false);
});

test('three guarded errors unload only personal hooks with one toast naming the file and no automatic retry', async () => {
  const p = hostPage(); p.H.attach(p.adapter);
  await p.H.loadPersonal(new Uint8Array([1]), () => true);
  p.api.on('render', () => { throw new Error('broken'); });
  p.api.gesture.claim(42);
  for (let i = 0; i < 4; i++) p.H.rendered('thread', {});
  assert.equal(p.H.personalState.active, false); assert.equal(p.H.personalState.disabled, true);
  assert.equal(p.H.state.active, 'fixture'); assert.equal(p.handlers.size, 0); assert.equal(p.H.claimed(42), false);
  assert.equal(p.torn, 1); assert.equal(p.toasts.length, 1); assert.match(p.toasts[0], /Skins\/My skin\/skin\.js/);
  assert.equal(await p.H.loadPersonal(new Uint8Array([1]), () => true), false);
});

test('personal module lint enforces package banned APIs and disallows unapproved module dependencies', () => {
  const p = hostPage();
  assert.equal(p.H.scriptProblem(CODE), null);
  for (const code of ['fetch("/x")', 'window.localStorage.getItem("x")', 'api.part("dock").addEventListener("click", fn)', 'setTimeout(fn, 1)', 'requestAnimationFrame(fn)', 'eval("x")', 'history.back()', 'window.__wos', 'el.innerHTML = "x"', 'import("/x.js")', 'import x from "/x.js"', 'export {x} from "/x.js"']) assert.ok(p.H.scriptProblem(code), code);
});

test('production and QA CSP support byte-verified Blob modules without inline/eval permission', () => {
  for (const file of ['packaging/static.conf', 'tools/qa-origin.cjs', 'server.py']) {
    const text = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
    assert.match(text, /script-src 'self' blob:;/);
    assert.doesNotMatch(text, /script-src[^;]*(?:unsafe-inline|unsafe-eval)/);
  }
});
