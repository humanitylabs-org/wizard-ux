// Skin packages v1 (James, 19 Oct 2026): a collaborator skin carries its own look and behaviour in
// web/skins/<dir>/ and never changes the default shell. These tests hold the contract:
//   - James's skins declare no package, so they load nothing extra;
//   - a skin's files load only for that skin; scripts only after a commit, never while previewing;
//   - switching skins leaves nothing behind; a broken skin script turns itself off;
//   - a skin's Back gesture uses the shell's Back step, so the app never exits;
//   - skin files stay inside their lane (lint below).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const OWNER = ['nebula', 'grove', 'tide', 'ember', 'signal'];

/* ---------- the real SKINS table, read from core/skins.js ---------- */
function skinEntries() {
  const js = read('web/core/skins.js');
  const out = [];
  for (const m of js.matchAll(/\{ id: '([a-z-]+)',(?: pkg: (\{[^}]*\}),)? name: '/g)) {
    out.push({ id: m[1], pkg: m[2] ? vm.runInNewContext('(' + m[2] + ')') : null });
  }
  return out;
}

test('James\'s skins declare no package, so they load no extra CSS or script', () => {
  const S = skinEntries();
  assert.ok(S.length >= 8, 'all skins found');
  for (const id of OWNER) {
    const s = S.find(x => x.id === id); assert.ok(s, id);
    assert.equal(s.pkg, null, `${id} must not declare a skin package`);
  }
});

test('every declared package exists, and every package folder is declared', () => {
  const S = skinEntries().filter(s => s.pkg);
  const dirs = new Set(S.map(s => s.pkg.dir || s.id));
  for (const s of S) {
    const d = s.pkg.dir || s.id;
    if (s.pkg.css) assert.ok(existsSync(new URL(`web/skins/${d}/skin.css`, root)), `${s.id}: web/skins/${d}/skin.css`);
    if (s.pkg.js) assert.ok(existsSync(new URL(`web/skins/${d}/skin.js`, root)), `${s.id}: web/skins/${d}/skin.js`);
    if (s.pkg.when) assert.ok(['touch', 'always'].includes(s.pkg.when), `${s.id}: when`);
  }
  for (const d of readdirSync(new URL('web/skins/', root), { withFileTypes: true }).filter(x => x.isDirectory()).map(x => x.name)) {
    assert.ok(dirs.has(d), `web/skins/${d} is not declared by any skin's pkg`);
  }
});

/* ---------- lint: a package stays in its own lane ---------- */
// Split a selector list on top-level commas only (commas inside :is(...) stay).
const splitTop = s => { const out = []; let d = 0, cur = ''; for (const ch of s) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && !d) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.filter(x => x.trim()); };
const plain = x => JSON.parse(JSON.stringify(x));
const pkgDirs = () => {
  const by = new Map();
  for (const s of skinEntries().filter(x => x.pkg)) { const d = s.pkg.dir || s.id; by.set(d, [...(by.get(d) || []), s.id]); }
  return by;
};

test('skin.css rules apply only under their own skin', () => {
  for (const [dir, ids] of pkgDirs()) {
    const f = `web/skins/${dir}/skin.css`; if (!existsSync(new URL(f, root))) continue;
    const css = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
    const own = sel => {
      const tags = [...sel.matchAll(/html\[data-skin(\^?)=["']([a-z-]+)["']\]/g)];
      if (!tags.length) return false;
      if (!/^\s*(:is\(\s*)?html\[data-skin/.test(sel)) return false;   // must be the leading compound
      if (/:not\(\s*\[data-skin|:not\(html\[data-skin/.test(sel)) return false;
      return tags.every(([, pre, v]) => pre ? ids.every(i => i.startsWith(v)) && skinEntries().filter(s => s.id.startsWith(v)).every(s => ids.includes(s.id)) : ids.includes(v));
    };
    const body = css.replace(/@(font-face|keyframes)[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
    for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      for (const sel of splitTop(m[1])) assert.ok(own(sel.trim()), `${f}: "${sel.trim()}" must start with html[data-skin="${ids.join('|')}"]`);
      if (/\[data-part/.test(m[1])) assert.ok(!/display\s*:\s*none/.test(m[2]), `${f}: a skin may restyle a shell part but not hide it (${m[1].trim()})`);
    }
    assert.ok(!/@import/.test(css), `${f}: no @import`);
  }
});

test('skin.js uses only the skin API', () => {
  const banned = ['addEventListener', 'setTimeout', 'setInterval', 'requestAnimationFrame', 'fetch(', 'XMLHttpRequest',
    '__wos', 'localStorage', 'sessionStorage', 'innerHTML', 'outerHTML', 'history.', 'document.cookie', 'eval(', 'new Function', 'import(', 'WebSocket'];
  const files = [...pkgDirs().keys()].map(d => `web/skins/${d}/skin.js`).filter(f => existsSync(new URL(f, root)));
  files.push('tests/fixtures/skins/fixture/skin.js');
  for (const f of files) {
    const src = read(f).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const b of banned) assert.ok(!src.includes(b), `${f}: "${b}" is not allowed in a skin script; use the skin API (web/skins/README.md)`);
    assert.match(src, /export default function/, `${f}: export default function setup(api)`);
  }
});

/* ---------- the host, in a small fake page ---------- */
function page({ stored = 'nebula', touch = true } = {}) {
  const S = skinEntries().concat([{ id: 'fixture', pkg: { js: true, when: 'touch', dir: 'fixture' } }]);
  const links = [];
  const listeners = new Map(); let live = 0;
  const el = (tag) => ({ tag, dataset: {}, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, parentNode: null });
  const anchor = { href: 'core/skins.css', parentNode: { insertBefore(n) { links.push(n); } } };
  const target = name => ({
    name, querySelector: q => (q.includes('data-part') ? {} : null),
    addEventListener(t, fn) { live++; (listeners.get(name + t) || listeners.set(name + t, new Set()).get(name + t)).add(fn); },
    removeEventListener(t, fn) { if (listeners.get(name + t)?.delete(fn)) live--; },
    fire(t, e) { for (const fn of [...(listeners.get(name + t) || [])]) fn(e); },
  });
  const thread = target('thread'), dock = target('dock');
  const frames = new Map(); let fid = 0;
  const toasts = [], backs = [];
  let route = { view: 'thread', thread: 's1', desk: 1 };
  const ctx = {
    console: { warn() {}, log() {} }, URL, Date, Promise, Set, Map, Object, Array, JSON, Math, Error, String,
    navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7)' },
    matchMedia: () => ({ matches: touch }),
    requestAnimationFrame: fn => { const id = ++fid; frames.set(id, fn); return id; },
    cancelAnimationFrame: id => { frames.delete(id); },
    localStorage: { _: {}, getItem(k) { return this._[k] ?? null; }, setItem(k, v) { this._[k] = String(v); } },
    document: {
      baseURI: 'https://wizard.test/wizard-os-home/', documentElement: { dataset: { shell: 'phone' } },
      createElement: el, head: { appendChild(n) { links.push(n); } },
      querySelector: q => (q.includes('skins.css') ? anchor : null),
      addEventListener() {},
    },
  };
  ctx.window = ctx;
  ctx.window.WosSkin = {
    current: stored, list: S.map(s => ({ id: s.id, name: s.id })),
    pkgOf: id => { const s = S.find(x => x.id === id); return s && s.pkg ? { ...s.pkg } : null; },
  };
  ctx.module = { exports: {} };
  vm.runInNewContext(read('web/core/skin-host.js'), ctx);
  const host = ctx.window.WosSkinHost;
  const imported = [];
  host._test.setImporter(async u => { imported.push(u); const d = u.split('/skins/')[1].split('/')[0]; return import(d === 'fixture' ? new URL('tests/fixtures/skins/fixture/skin.js', root) : new URL(`web/skins/${d}/skin.js`, root)); });
  const adapter = {
    route: () => route, back: () => { backs.push(route.view); const did = route.view === 'thread' ? 'thread' : null; if (did) route = { ...route, view: 'list', thread: null }; return did; },
    openList() {}, openThread() {}, goDesk() {}, deskCount: () => 3,
    root: () => thread, dock: () => dock, locked: () => false, toast: t => toasts.push(t),
  };
  const tick = () => { const f = [...frames.entries()]; frames.clear(); for (const [, fn] of f) fn(0); };
  return { ctx, host, adapter, links, imported, thread, toasts, backs, tick, frames, get live() { return live; }, setRoute: r => { route = r; } };
}
const settle = () => new Promise(r => setTimeout(r, 20));

test('Nebula (stored) loads no skin files at all', async () => {
  const P = page({ stored: 'nebula' });
  P.host.attach(P.adapter); await settle();
  assert.equal(P.links.length, 0); assert.equal(P.imported.length, 0);
  assert.deepEqual(plain(P.host.state.requested), []);
});

test('a stored package skin injects only its own stylesheet, before first paint, in the skins.css slot', async () => {
  const P = page({ stored: 'landscapes' });
  assert.equal(P.links.length, 1, 'stylesheet inserted while <head> is parsing');
  assert.match(P.links[0].href, /\/wizard-os-home\/skins\/landscapes\/skin\.css$/);
  assert.equal(P.links[0].attrs.blocking, 'render');
  P.host.attach(P.adapter); await settle();
  // Landscapes now carries a script (swipe-back): it may load only its own skin.js, never another package's.
  assert.ok(P.imported.every(u => /\/skins\/landscapes\/skin\.js$/.test(u)), 'a package loads only its own script');
});

test('previewing skins in the picker never runs a skin script', async () => {
  const P = page({ stored: 'nebula' });
  P.host.attach(P.adapter);
  P.host.preview('fixture'); P.host.preview('landscapes'); P.host.preview('nebula'); await settle();
  assert.equal(P.imported.length, 0);
  assert.deepEqual(plain(P.host.state.css), ['landscapes'], 'stylesheets only, and only for skins actually previewed');
});

test('committing a skin runs its script; switching away twice leaves zero listeners, frames and handlers', async () => {
  const P = page({ stored: 'nebula' });
  P.host.attach(P.adapter);
  P.host.commit('fixture'); await settle();
  assert.equal(P.host.state.active, 'fixture');
  assert.ok(P.live > 0, 'fixture registered listeners'); assert.ok(P.frames.size > 0);
  P.host.commit('nebula'); await settle();
  P.host.commit('fixture'); await settle();
  P.host.commit('grove'); await settle();
  assert.equal(P.host.state.active, null);
  assert.equal(P.live, 0, 'no listener survives a switch');
  assert.equal(P.frames.size, 0, 'no frame survives a switch');
  assert.equal(globalThis.__fixtureSkin.tornDown, true);
});

test('a touch-only skin script never loads on desktop', async () => {
  const P = page({ stored: 'nebula', touch: false });
  P.host.attach(P.adapter); P.host.commit('fixture'); await settle();
  assert.equal(P.imported.length, 0); assert.equal(P.host.state.active, null);
});

test('a skin swipe-back runs the shell Back step: thread -> list, the app never exits', async () => {
  const P = page({ stored: 'fixture' });
  P.host.attach(P.adapter); await settle();
  assert.equal(P.host.state.active, 'fixture');
  P.thread.fire('pointerdown', { clientX: 40, pointerId: 7 });
  assert.equal(P.host.claimed(7), true, 'the finger is claimed from the dock desk swipe');
  P.thread.fire('pointerup', { clientX: 200, pointerId: 7 });
  assert.deepEqual(P.backs, ['thread']);
  assert.equal(P.adapter.route().view, 'list', 'one in-app step');
  // At the root, a second swipe does nothing (the gesture checks the route; nav.back() returns false).
  P.thread.fire('pointerdown', { clientX: 40, pointerId: 8 });
  P.thread.fire('pointerup', { clientX: 200, pointerId: 8 });
  assert.deepEqual(P.backs, ['thread']);
  // Starting in the OS edge strip belongs to the OS.
  P.setRoute({ view: 'thread', thread: 's2', desk: 1 });
  P.thread.fire('pointerdown', { clientX: 10, pointerId: 9 });
  P.thread.fire('pointerup', { clientX: 200, pointerId: 9 });
  assert.deepEqual(P.backs, ['thread']);
});

test('render and route events reach the skin, and frames are tracked', async () => {
  const P = page({ stored: 'fixture' });
  P.host.attach(P.adapter); await settle();
  P.host.rendered('thread', P.thread); P.host.rendered('thread', P.thread);
  assert.equal(globalThis.__fixtureSkin.renders, 2);
  assert.deepEqual(globalThis.__fixtureSkin.routes, ['thread']);
  P.setRoute({ view: 'list', thread: null, desk: 1 }); P.host.changed();
  assert.deepEqual(globalThis.__fixtureSkin.routes, ['thread', 'list']);
  P.tick(); assert.equal(globalThis.__fixtureSkin.framed, true); assert.equal(P.host.state.frames, 0);
});

test('a broken skin script turns itself off after three errors: one toast, stylesheet kept, no retry', async () => {
  const P = page({ stored: 'nebula' });
  P.host._test.setImporter(async () => ({ default: api => { api.on('render', () => { throw new Error('boom'); }); } }));
  P.host.attach(P.adapter);
  P.host.commit('landscapes'); // css only: stays
  P.host.commit('fixture'); await settle();
  assert.equal(P.host.state.active, 'fixture');
  for (let i = 0; i < 5; i++) P.host.rendered('thread', P.thread);
  assert.equal(P.host.state.active, null, 'script unloaded');
  assert.deepEqual(plain(P.host.state.disabled), ['fixture']);
  assert.equal(P.toasts.length, 1, 'exactly one toast');
  assert.ok(P.host.state.css.includes('landscapes'), 'stylesheets stay');
  P.host.commit('nebula'); P.host.commit('fixture'); await settle();
  assert.equal(P.host.state.active, null, 'no retry on this page');
});

test('the API hands a skin no shell internals', async () => {
  const P = page({ stored: 'nebula' });
  let seen = null;
  P.host._test.setImporter(async () => ({ default: api => { seen = api; } }));
  P.host.attach(P.adapter); P.host.commit('fixture'); await settle();
  // Layout hooks (22 Oct 2026): timers, own controls, agents, the orb's recorder and its idle tap. Still no internals.
  assert.deepEqual(Object.keys(seen).sort(), ['after', 'agents', 'asset', 'env', 'frame', 'gesture', 'listen', 'mount', 'nav', 'on', 'orb', 'part', 'route', 'storage', 'toast', 'voice']);
  assert.ok(Object.isFrozen(seen.agents) && Object.isFrozen(seen.voice) && Object.isFrozen(seen.orb));
  assert.deepEqual(Object.keys(seen.voice).sort(), ['cancel', 'dictate', 'state', 'talk', 'tap']);
  assert.ok(Object.isFrozen(seen) && Object.isFrozen(seen.nav));
  assert.deepEqual(Object.keys(seen.nav).sort(), ['back', 'deskCount', 'goDesk', 'openList', 'openThread']);
  seen.storage.set('x', { a: 1 });
  assert.equal(P.ctx.localStorage._['wos.skin.fixture.x'], '{"a":1}', 'storage is namespaced per skin');
});

test('the shell wires the host: head order, adapter, dock claim, render hooks', () => {
  for (const f of ['web/index.html', 'web/desktop.html']) {
    const h = read(f);
    assert.ok(h.indexOf('core/skins.js') < h.indexOf('core/skins.css') && h.indexOf('core/skins.css') < h.indexOf('core/skin-host.js'), `${f}: skins.js, then skins.css, then skin-host.js`);
  }
  const app = read('web/app.js');
  assert.match(app, /WosSkinHost\?\.attach\(\{/);
  assert.match(app, /back: \(\) => backStep\(\)/, 'skins step back through the shell\'s own Back');
  assert.match(app, /WosSkinHost\?\.claimed\(e\.pointerId\)/, 'dock desk swipe yields to a claimed finger');
  const chats = read('web/core/chats.js');
  assert.match(chats, /WosSkinHost\?\.rendered\('thread', el\)/);
  assert.match(chats, /WosSkinHost\?\.rendered\('list', el\)/);
  for (const p of ['thread', 'list', 'composer']) assert.match(chats, new RegExp(`data-part="${p}"`));
  assert.match(read('web/index.html'), /id="dock" data-part="dock"/);
});

// Tweaks share the package lint surface; behaviour belongs in web/tweaks, not new skin scripts.
import './fixtures/tweak-lint.mjs';
