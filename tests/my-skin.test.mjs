// My skin (web/core/my-skin.js): the owner's own CSS, kept on the box in Files (Skins/My skin.css) and served by
// the Agent Service at /wizard/v1/my-skin, layered last on top of whichever skin is picked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const SRC = read('web/core/my-skin.js');

function fakeDom() {
  const mk = tag => ({
    tagName: tag, dataset: {}, id: '', textContent: '', parentNode: null, attrs: new Set(),
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    toggleAttribute(n, on) { if (on) this.attrs.add(n); else this.attrs.delete(n); },
  });
  const head = { children: [], get lastElementChild() { return this.children.at(-1) || null; },
    appendChild(el) { this.removeChild(el); this.children.push(el); el.parentNode = this; return el; },
    removeChild(el) { const i = this.children.indexOf(el); if (i >= 0) this.children.splice(i, 1); el.parentNode = null; } };
  head.children.push({ tagName: 'LINK', href: 'core/skins.css', parentNode: head }, { tagName: 'LINK', href: 'skins/obsidian/skin.css', parentNode: head });
  const listeners = {};
  return { head, documentElement: mk('HTML'), createElement: mk, visibilityState: 'visible',
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); }, listeners };
}

async function boot({ responses = [], cached = null, search = '' } = {}) {
  const document = fakeDom();
  const store = new Map(cached ? [['wos.myskin.v1', cached]] : []);
  const calls = [];
  const queue = [...responses];
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET' });
    if (String(url).includes('format=json')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ path: 'Skins/My skin.css', empty: false }) };
    const r = queue.length ? queue.shift() : { status: 200, type: 'text/css', body: '' };
    if (r.throw) throw new TypeError('offline');
    return { ok: r.status >= 200 && r.status < 300, status: r.status, headers: { get: () => r.type }, text: async () => r.body };
  };
  const ctx = { document, fetch, location: { search }, URLSearchParams,
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) } };
  ctx.window = ctx;
  vm.runInNewContext(SRC, ctx);
  await new Promise(r => setTimeout(r, 5));
  const style = () => document.head.children.find(c => c.id === 'wosMySkin') || null;
  return { ctx, document, store, calls, style, M: ctx.WosMySkin };
}

test('empty My skin adds nothing: the picked skin renders exactly as its author made it', async () => {
  const b = await boot({ responses: [{ status: 200, type: 'text/css; charset=utf-8', body: '\n' }] });
  assert.equal(b.style(), null);
  assert.equal(b.M.state.empty, true);
  assert.equal(b.document.documentElement.attrs.has('data-my-skin'), false);
  assert.equal(b.calls[0].url, '/wizard/v1/my-skin');
});

test('a My skin rule is applied last in <head>, after the base skin and its package stylesheet', async () => {
  const css = 'html[data-skin] body { letter-spacing: .02em; }';
  const b = await boot({ responses: [{ status: 200, type: 'text/css; charset=utf-8', body: css }] });
  assert.equal(b.style()?.textContent, css);
  assert.equal(b.document.head.lastElementChild, b.style());
  assert.equal(b.document.documentElement.attrs.has('data-my-skin'), true);
  assert.equal(b.store.get('wos.myskin.v1'), css, 'cached for a flash-free first paint next time');
});

test('the cached copy paints at once; an unreachable service keeps it', async () => {
  const b = await boot({ cached: '.dock{opacity:.5}', responses: [{ throw: true }] });
  assert.equal(b.style()?.textContent, '.dock{opacity:.5}');
});

test('a box without My skin (404, older Agent Service) or a non-CSS answer falls back to the base skin', async () => {
  for (const r of [{ status: 404, type: 'application/json', body: '{"error":"not_found"}' }, { status: 200, type: 'text/html', body: '<!doctype html>' }, { status: 503, type: 'application/json', body: '{}' }]) {
    const b = await boot({ cached: '.dock{opacity:.5}', responses: [r] });
    assert.equal(b.style(), null, `${r.status} ${r.type}`);
    assert.equal(b.store.has('wos.myskin.v1'), false);
  }
});

test('?myskin=off skips the layer for one load (a broken sheet can always be fixed)', async () => {
  const b = await boot({ search: '?myskin=off', cached: 'body{display:none}' });
  assert.equal(b.style(), null);
  assert.equal(b.calls.length, 0);
  assert.equal(b.M.state.off, true);
});

test('Reset empties My skin through the Agent Service and removes the layer', async () => {
  const b = await boot({ responses: [{ status: 200, type: 'text/css', body: 'a{color:red}' }, { status: 200, type: 'text/css', body: '' }, { status: 200, type: 'text/css', body: '' }] });
  assert.ok(b.style());
  await b.M.reset();
  assert.ok(b.calls.some(c => c.method === 'DELETE' && c.url === '/wizard/v1/my-skin'));
  assert.equal(b.style(), null);
});

test('CSS stays non-executable, loads last in both shells, and scripts use the shared host', () => {
  assert.doesNotMatch(SRC, /\bimport\(|\beval\(|new Function|innerHTML|createElement\('script'\)/);
  assert.match(SRC, /crypto\.subtle\.digest\('SHA-256', bytes\)/);
  assert.match(SRC, /host\.loadPersonal\(v\.bytes/);
  for (const f of ['web/index.html', 'web/desktop.html']) {
    const head = read(f).split('</head>')[0];
    const at = head.indexOf('core/my-skin.js');
    assert.ok(at > 0, `${f} loads core/my-skin.js`);
    assert.ok(at > head.lastIndexOf('stylesheet'), `${f}: My skin comes after every stylesheet in <head>`);
  }
  const inv = JSON.parse(read('docs/responsive-feature-inventory.json'));
  assert.ok(inv.sharedAssets.includes('core/my-skin.js'));
});

test('Settings › Look offers My skin with Edit and Reset', () => {
  const s = read('web/core/settings.js');
  assert.match(s, /<b>My skin<\/b>/);
  assert.match(s, /data-myskin="edit"/);
  assert.match(s, /data-myskin="reset"/);
  assert.match(s, /your changes on top of \$\{base\}/);
});

test('Launch: Nebula is the default skin, My skin leads Look and invites the first change', () => {
  const k = read('web/core/skins.js');
  // A fresh profile (no wos.skin) wears SKINS[0], which must be Nebula.
  assert.match(k, /const SKINS = \[\s*\{ id: 'nebula'/);
  assert.match(k, /const idxOf = id => Math\.max\(0, SKINS\.findIndex/);
  const s = read('web/core/settings.js');
  // My skin is the grid's last tile; while it is empty the invite sits right under the grid.
  assert.match(s, /\$\{tiles\}\$\{myTile\(\)\}<\/div>/);
  assert.match(s, /const invite = M && !myOpen && M\.state\.empty \?/);
  assert.match(s, /Everything you see is customizable/);
  // Reset only when there is something to reset.
  assert.match(s, /const reset = st\.empty \? '' :/);
  // No skin marketplace or community shelf for launch (comes later with Nostr IDs).
  assert.doesNotMatch(s, /browse skins|get skins|skin store|community skins/i);
});
