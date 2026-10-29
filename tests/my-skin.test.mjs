// My skin (web/core/my-skin.js): the owner's own CSS, kept on the box in Files (Skins/My skin.css) and served by
// the Agent Service at /wizard/v1/my-skin, layered last on top of whichever skin is picked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

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

async function boot({ responses = [], cached = null, search = '', saved = null, quota = false } = {}) {
  const document = fakeDom();
  const store = new Map(cached ? [['wos.myskin.v1', cached]] : []);
  if (saved) store.set('wos.own-skins.v1', saved);
  const calls = [];
  const queue = [...responses];
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET' });
    if (String(url).startsWith('/wizard/v1/skins')) return { ok: false, status: 404 };
    if (String(url).includes('format=json')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ path: 'Skins/My skin.css', empty: false }) };
    const r = queue.length ? queue.shift() : { status: 200, type: 'text/css', body: '' };
    if (r.throw) throw new TypeError('offline');
    return { ok: r.status >= 200 && r.status < 300, status: r.status, headers: { get: () => r.type }, text: async () => r.body };
  };
  const events = {}, dispatched = [];
  const ctx = { document, fetch, crypto: webcrypto, Event,
    addEventListener: (name,fn) => { (events[name] ||= []).push(fn); },
    dispatchEvent: e => { dispatched.push(e.type); for (const fn of events[e.type] || []) fn(e); },
    WosSkin: { current: 'nebula', list: [{id:'nebula'},{id:'obsidian-light'}], set(id) { this.current=id; ctx.dispatchEvent(new Event('wos:skin')); } },
    location: { search }, URLSearchParams,
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => { if (quota && k === 'wos.own-skins.v1') throw new Error('Storage full'); store.set(k, String(v)); }, removeItem: k => store.delete(k) } };
  ctx.window = ctx;
  vm.runInNewContext(SRC, ctx);
  await new Promise(r => setTimeout(r, 5));
  const style = () => document.head.children.find(c => c.id === 'wosMySkin') || null;
  return { ctx, document, store, calls, dispatched, style, M: ctx.WosMySkin };
}

test('empty My skin adds nothing: the picked skin renders exactly as its author made it', async () => {
  const b = await boot({ responses: [{ status: 200, type: 'text/css; charset=utf-8', body: '\n' }] });
  assert.equal(b.style(), null);
  assert.equal(b.M.state.empty, true);
  assert.equal(b.document.documentElement.attrs.has('data-my-skin'), false);
  assert.ok(b.calls.some(c => c.url === '/wizard/v1/my-skin'));
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

test('Look offers named recipes, New skin and a Wizard edit hint, never Reset or a missing files id', () => {
  const s = read('web/core/settings.js');
  assert.match(s, /data-newskin/); assert.match(s, /data-ownskin-remove/);
  assert.match(s, /Edit with your Wizard/);
  assert.match(s, /\['wizard-files', 'files'\]\.find/);
  assert.doesNotMatch(s, /data-myskin="reset"|data-myskin-tile/);
  assert.doesNotMatch(s, /browse skins|get skins|skin store|community skins/i);
  assert.match(read('web/core/skins.js'), /const SKINS = \[\s*\{ id: 'nebula'/);
});

test('recipes create multiple, wear immediately, isolate edits, reload and remove/Undo', async () => {
  const b = await boot();
  assert.equal(b.M.recipes.length, 0);
  const first = b.M.create({name:'Quiet',base:'nebula',tweaks:{'wizard/app-borders':true}});
  const second = b.M.create({name:'Bright',base:'obsidian-light',tweaks:{'wizard/app-borders':false}});
  assert.equal(b.M.recipes.length, 2); assert.equal(b.ctx.WosSkin.current, 'obsidian-light');
  b.M.wear(first.id); b.M.update({base:'obsidian-light',tweaks:{'wizard/app-borders':false}});
  assert.equal(b.M.recipes[1].base, 'obsidian-light');
  b.M.wear(second.id);
  const again = await boot({saved:b.store.get('wos.own-skins.v1')});
  assert.equal(again.M.active.id, second.id); assert.equal(again.ctx.WosSkin.current, 'obsidian-light');
  const removed = again.M.remove(second.id);
  assert.equal(again.M.active,null); assert.equal(again.M.recipes.length,1);
  assert.equal(again.ctx.WosSkin.current,'obsidian-light');
  again.M.restore(removed); assert.equal(again.M.active.id,second.id); assert.equal(again.M.recipes.length,2);
  again.M.restore(removed); assert.equal(again.M.recipes.length,2,'Undo is idempotent');
  again.M.leave(); assert.equal(again.M.active,null);
});
test('legacy overlay migrates once; removing never resurrects it or deletes shared files', async () => {
  const b = await boot({cached:'.dock{opacity:.5}',responses:[{throw:true}]});
  assert.equal(b.M.active.name,'My skin'); assert.equal(b.M.active.base,'nebula');
  b.M.remove(b.M.active.id); assert.equal(b.style(),null);
  const again = await boot({cached:'.dock{opacity:.5}',saved:b.store.get('wos.own-skins.v1'),responses:[{throw:true}]});
  assert.equal(again.M.recipes.length,0); assert.equal(again.style(),null);
  assert.equal(again.store.get('wos.myskin.v1'),'.dock{opacity:.5}');
  assert.ok(again.calls.every(c=>c.method==='GET'));
});
test('a late nonempty service overlay announces the migrated own recipe to the tweak loader', async () => {
  const b = await boot({responses:[{status:200,type:'text/css',body:'.dock{opacity:.5}'}]});
  assert.equal(b.M.active.name,'My skin');
  assert.equal(b.dispatched.filter(e=>e==='wos:own-skin').length,1);
  await b.M.refresh(); assert.equal(b.dispatched.filter(e=>e==='wos:own-skin').length,1);
});
test('overlay only applies while own skin is worn, including builtin changes outside Settings', async () => {
  const b = await boot({cached:'.dock{opacity:.5}',responses:[{throw:true}]});
  const id = b.M.active.id; b.M.leave(); assert.equal(b.style(),null);
  b.M.wear(id); assert.ok(b.style());
  b.ctx.WosSkin.set('obsidian-light'); assert.equal(b.M.active,null); assert.equal(b.style(),null);
});
test('bad names, palettes, duplicates and storage failure never claim a created recipe', async () => {
  const b = await boot();
  for (const name of ['', '  ', 'a'.repeat(61)]) assert.throws(()=>b.M.create({name,base:'nebula'}));
  assert.throws(()=>b.M.create({name:'Quiet',base:'unknown'}));
  b.M.create({name:'Quiet',base:'nebula'});
  assert.throws(()=>b.M.create({name:' quiet ',base:'nebula'}));
  assert.equal(b.M.recipes.length,1);
  const full = await boot({quota:true}); assert.throws(()=>full.M.create({name:'Quiet',base:'nebula'}));
  assert.equal(full.M.recipes.length,0); assert.equal(full.M.active,null);
});
