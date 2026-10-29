// web/sw.js: network first, the shell's own files kept for offline starts, nothing private kept.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../web/sw.js', import.meta.url), 'utf8');
const ORIGIN = 'https://box.example';

function harness() {
  const stores = new Map(), on = {}, pending = [];
  let online = true, fetched = [];
  const key = k => typeof k === 'string' ? k : k.url;
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const m = stores.get(name);
      return {
        async put(k, res) { m.delete(key(k)); m.set(key(k), res); },
        async match(k) { return m.get(key(k)); },
        async keys() { return [...m.keys()].map(url => ({ url })); },
        async delete(k) { return m.delete(key(k)); },
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
  };
  const response = (url, body, headers = {}) => ({ ok: true, status: 200, type: 'basic', redirected: false, url, body,
    headers: { get: n => headers[n.toLowerCase()] ?? null }, clone() { return response(url, body, headers); }, async text() { return body; } });
  const files = new Map();
  const fetch = async (req) => {
    const url = key(req); fetched.push(url);
    if (!online) throw new TypeError('Failed to fetch');
    const f = files.get(url.replace(/[?#].*$/, '')) || files.get(url);
    if (!f) return { ok: false, status: 404, type: 'basic', headers: { get: () => null }, clone() { return this; } };
    return response(url, f.body, f.headers);
  };
  const ctx = {
    self: { registration: { scope: ORIGIN + '/wizard-os-home/' }, location: { origin: ORIGIN }, skipWaiting() {}, clients: { claim: async () => {} },
      addEventListener: (n, fn) => { on[n] = fn; } },
    caches, fetch, URL, Set, Promise, TypeError,
  };
  vm.runInNewContext(src, ctx);
  const request = (path, init = {}) => {
    const headers = new Map(Object.entries(init.headers || {}));
    return { url: ORIGIN + path, method: init.method || 'GET', mode: init.mode || 'cors', cache: init.cache || 'default', headers: { has: n => headers.has(n) } };
  };
  async function get(path, init) {
    let answer = null;
    const event = { request: request(path, init), respondWith(p) { answer = p; }, waitUntil(p) { pending.push(p); } };
    on.fetch(event);
    if (!answer) return { passthrough: true };
    try { return await answer; } catch (error) { return { error }; } finally { await Promise.all(pending.splice(0)); }
  }
  return { on, stores, files, get, setOnline: v => { online = v; }, fetched: () => fetched, cached: () => [...(stores.get('wos-shell-v1') || new Map()).keys()],
    page: (release) => ({ body: `<meta charset="utf-8"><meta name="wos-release" content="${release}"><script src="live.js?v=${release}"></script>`, headers: { 'cache-control': 'no-cache' } }),
    flush: () => Promise.all(pending.splice(0)), message: async data => { on.message({ data, waitUntil: p => pending.push(p) }); await Promise.all(pending.splice(0)); } };
}

test('online reads always go to Wizard; the shell files are kept for later', async () => {
  const h = harness();
  h.files.set(ORIGIN + '/wizard-os-home/', h.page('aaa'));
  h.files.set(ORIGIN + '/wizard-os-home/live.js', { body: 'live A', headers: {} });
  const page = await h.get('/wizard-os-home/?thread=x', { mode: 'navigate' });
  assert.match(page.body, /aaa/);
  const js = await h.get('/wizard-os-home/live.js?v=aaa');
  assert.equal(js.body, 'live A');
  assert.deepEqual(h.cached().sort(), [ORIGIN + '/wizard-os-home/', ORIGIN + '/wizard-os-home/live.js?v=aaa']);
  h.files.set(ORIGIN + '/wizard-os-home/live.js', { body: 'live A2', headers: {} });
  assert.equal((await h.get('/wizard-os-home/live.js?v=aaa')).body, 'live A2', 'network first: never a stale copy while online');
});

test('offline: the page (any deep link) and its files open from the saved copy', async () => {
  const h = harness();
  h.files.set(ORIGIN + '/wizard-os-home/desktop.html', h.page('aaa'));
  h.files.set(ORIGIN + '/wizard-os-home/live.js', { body: 'live A', headers: {} });
  await h.get('/wizard-os-home/desktop.html', { mode: 'navigate' });
  await h.get('/wizard-os-home/live.js?v=aaa');
  h.setOnline(false);
  assert.match((await h.get('/wizard-os-home/desktop.html?thread=abc', { mode: 'navigate' })).body, /aaa/);
  assert.equal((await h.get('/wizard-os-home/live.js?v=aaa')).body, 'live A');
  assert.ok((await h.get('/wizard-os-home/live.js?v=bbb')).error, 'never another release\'s file');
});

test('nothing private or explicit no-store is kept; the API stays network-only', async () => {
  const h = harness();
  h.files.set(ORIGIN + '/wizard/hermes/api/sessions', { body: '[]', headers: {} });
  h.files.set(ORIGIN + '/wizard-os-home/ux-version.txt', { body: '1', headers: {} });
  h.files.set(ORIGIN + '/wizard-os-home/private.js', { body: 'x', headers: { 'cache-control': 'no-store' } });
  assert.equal((await h.get('/wizard/hermes/api/sessions')).body, '[]');
  assert.equal((await h.get('/wizard-os-home/ux-version.txt', { cache: 'no-store' })).body, '1');
  await h.get('/wizard-os-home/private.js');
  assert.deepEqual(h.cached(), []);
  assert.deepEqual(await h.get('/wizard/attachments/a.png'), { passthrough: true });
  assert.deepEqual(await h.get('/wizard-os-home/v.mp4', { headers: { range: 'bytes=0-' } }), { passthrough: true });
  assert.deepEqual(await h.get('/wizard-os-home/x', { method: 'POST' }), { passthrough: true });
  h.setOnline(false);
  assert.ok((await h.get('/wizard-os-home/ux-version.txt', { cache: 'no-store' })).error, 'an update check never reads a saved copy');
});

test('a newer release replaces the older one: two releases never mix offline', async () => {
  const h = harness();
  h.files.set(ORIGIN + '/wizard-os-home/', h.page('aaa'));
  h.files.set(ORIGIN + '/wizard-os-home/live.js', { body: 'live', headers: {} });
  await h.get('/wizard-os-home/', { mode: 'navigate' }); await h.get('/wizard-os-home/live.js?v=aaa');
  h.files.set(ORIGIN + '/wizard-os-home/', h.page('bbb'));
  await h.get('/wizard-os-home/', { mode: 'navigate' }); await h.get('/wizard-os-home/live.js?v=bbb');
  assert.deepEqual(h.cached().sort(), [ORIGIN + '/wizard-os-home/', ORIGIN + '/wizard-os-home/live.js?v=bbb']);
});

test('first visit: the page hands over what it loaded, only this scope\'s own files', async () => {
  const h = harness();
  h.files.set(ORIGIN + '/wizard-os-home/', h.page('aaa'));
  h.files.set(ORIGIN + '/wizard-os-home/live.js', { body: 'live', headers: {} });
  h.files.set(ORIGIN + '/wizard/v1/apps', { body: '{}', headers: {} });
  await h.message({ type: 'wos-shell-warm', urls: [ORIGIN + '/wizard-os-home/?thread=1', ORIGIN + '/wizard-os-home/live.js?v=aaa',
    ORIGIN + '/wizard/v1/apps', 'https://elsewhere.example/x.js', ORIGIN + '/wizard-os-home/sw.js', 42] });
  assert.deepEqual(h.cached().sort(), [ORIGIN + '/wizard-os-home/', ORIGIN + '/wizard-os-home/live.js?v=aaa']);
  await h.message({ type: 'other', urls: [ORIGIN + '/wizard-os-home/live.js?v=zzz'] });
  assert.equal(h.cached().length, 2);
});

test('activate clears only this worker\'s older caches', async () => {
  const h = harness();
  for (const n of ['wos-shell-v0', 'wos-shell-v1', 'trackhunt-v1-20260711d']) h.stores.set(n, new Map());
  const pending = [];
  h.on.activate({ waitUntil: p => pending.push(p) }); await Promise.all(pending);
  assert.deepEqual([...h.stores.keys()].sort(), ['trackhunt-v1-20260711d', 'wos-shell-v1']);
});
