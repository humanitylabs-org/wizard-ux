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
import { withShellParts } from './fixtures/shell-parts.mjs';
import { withWebParts } from './fixtures/web-parts.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { listFixture } from './fixtures/chats-list-render.mjs';
import { block, runRecording } from './fixtures/source-slice.mjs';

const root = new URL('../', import.meta.url);
const read = p => withShellParts(withWebParts(readFileSync(new URL(p, root), 'utf8')));
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

// Skins are look only (wizard-ux#1190): a package is a stylesheet; no skin declares a script, and committing one imports
// nothing.
test('no skin package declares a script, and committing a skin imports no skin.js', async () => {
  assert.deepEqual(skinEntries().filter(s => s.pkg?.js).map(s => s.id), []);
  const P = page({ stored: 'nebula' });
  P.ctx.window.WosSkin.pkgOf = x => (x === 'fixture' ? { js: true, when: 'always', dir: 'fixture' } : null);
  P.host.attach(P.adapter); P.host.commit('fixture'); await settle();
  assert.equal(P.host.state.active, null);
  assert.ok(!P.imported.some(u => /skin\.js/.test(u)), 'skin.js never imported');
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
  vm.runInNewContext(withSkinHostParts(read('web/core/skin-host.js')), ctx);
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


test('a touch-only skin script never loads on desktop', async () => {
  const P = page({ stored: 'nebula', touch: false });
  P.host.attach(P.adapter); P.host.commit('fixture'); await settle();
  assert.equal(P.imported.length, 0); assert.equal(P.host.state.active, null);
});





// The phone shell's skin adapter (app-agentorb.js) and its dock desk swipe (app-scrub.js), run with stubs.
const braces = (src, head) => { const i = src.indexOf(head); assert.ok(i >= 0, head); let d = 0; for (let k = src.indexOf('{', i); k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}' && --d === 0) return src.slice(i, k + 1); } return ''; };
function phoneAdapter() {
  const calls = [];
  let adapter = null;
  const ctx = { overviewAdapter: {}, windowRefreshAdapter: {}, backStep: () => (calls.push('backStep'), 'thread'), openChatsList: () => calls.push('list'), goDesk: i => calls.push('desk ' + i),
    appVars: { DS: null, desks: [{}, {}], idx: 0, W: {} } };
  ctx.window = { WosSkinHost: { attach: a => { adapter = a; } } };
  vm.runInNewContext(braces(withShellParts(readFileSync(new URL('web/app-agentorb.js', root), 'utf8')), '  window.WosSkinHost?.attach(') + ');', ctx);
  return { adapter, calls, ctx };
}
function dockSwipe(claimed) {
  const on = {}, dock = { addEventListener: (t, f) => { on[t] = f; }, setPointerCapture() {} }, seen = [];
  const ctx = { $: () => dock, appVars: { DS: null, sheet: null, idx: 0, desks: [{ wins: [] }, { wins: [] }] }, window: { WosSkinHost: { claimed: id => claimed.includes(id) } },
    innerHeight: 800, performance: { now: () => 0 }, endDotHold: () => seen.push('hold'), liftSettings() {}, barScrubLive: () => seen.push('live'), barScrubBack() {}, placeTrack() {},
    barScrubAt: () => 1, barScrubPeek() {}, renderDots() {}, scLabel() {}, vib() {}, CHATS: { beforeNavigate: () => true } };
  const src = withShellParts(readFileSync(new URL('web/app-scrub.js', root), 'utf8'));
  vm.runInNewContext(braces(src, "  $('#dock').addEventListener('pointerdown',") + ');\n' + braces(src, "  $('#dock').addEventListener('pointermove',") + ');', ctx);
  const swipe = id => { on.pointerdown({ target: { closest: () => null }, clientX: 100, clientY: 400, pointerId: id, pointerType: 'touch', timeStamp: 0 });
    on.pointermove({ clientX: 160, clientY: 402, pointerId: id }); return ctx.appVars; };
  return { swipe, seen };
}
test('the shell wires the host: head order, adapter, dock claim, render hooks', () => {
  const parsed = f => { const doc = createDocument(); doc.documentElement.innerHTML = read(f).replace(/^<!doctype html>/i, ''); return doc; };
  for (const f of ['web/index.html', 'web/desktop.html']) {
    // the order the browser loads them in: the parsed page's scripts and stylesheets, in document order
    const order = parsed(f).querySelectorAll('script[src], link[rel="stylesheet"][href]').map(e => (e.getAttribute('src') || e.getAttribute('href')).split('?')[0].replace(/^\.\//, ''));
    const at = n => { const i = order.indexOf(n); assert.ok(i >= 0, `${f} loads ${n}`); return i; };
    assert.ok(at('core/skins.js') < at('core/skins.css') && at('core/skins.css') < at('core/skin-host.js'), `${f}: skins.js, then skins.css, then skin-host.js`);
  }
  // The phone shell attaches its adapter; a skin's Back is the shell's own Back step.
  const A = phoneAdapter();
  assert.ok(A.adapter, 'the shell attaches an adapter');
  for (const k of ['route', 'back', 'openList', 'openThread', 'goDesk', 'deskCount', 'root', 'dock', 'locked', 'toast']) assert.equal(typeof A.adapter[k], 'function', k);
  assert.equal(A.adapter.back(), 'thread');
  assert.deepEqual(A.calls, ['backStep'], 'skins step back through the shell\'s own Back');
  assert.equal(A.adapter.deskCount(), 2);
  A.ctx.appVars.DS = { id: 4, h: true };
  assert.equal(A.adapter.locked(4), true, 'a finger already swiping desks is locked from skins');
  assert.equal(A.adapter.locked(5), false);
  // The dock desk swipe yields to a finger a skin gesture claimed.
  const claimedSwipe = dockSwipe([7]);
  assert.equal(claimedSwipe.swipe(7).DS, null, 'dock desk swipe yields to a claimed finger');
  assert.deepEqual(claimedSwipe.seen, []);
  const free = dockSwipe([]);
  assert.equal(free.swipe(8).DS.h, true, 'an unclaimed finger swipes desks');
  // Chats calls the render hooks on the parts it marks: the real list paint (chats-list-render.mjs) ...
  const hooks = [];
  const list = listFixture(); list.ctx.window.WosSkinHost = { rendered: (part, el) => hooks.push([part, el]) };
  const ld = createDocument(); ld.body.innerHTML = list.render();
  assert.equal(hooks.length, 1); assert.equal(hooks[0][0], 'list'); assert.ok(ld.querySelector('[data-part="list"]'), 'the list part is marked');
  // ... and the real end of the thread paint (chats-threadpaint.js, from its markup on), on a mini-dom element.
  const chats = read('web/core/chats.js'), td = createDocument(), el = td.createElement('div'); td.body.appendChild(el);
  const paint = runRecording('this.paint = function () {\n' + (t => t.slice(t.indexOf('    const threadHTML = `')))(block(chats, '  function renderThread(')), {
    el, TAG: '', NV: null, s: { id: 't1' }, isNew: false, msgs: '', keepTa: null, hadFocus: false, PW: null, msw: '', draft: '', c: { files: [] }, DL: false, keep: false, turns: null,
    dkey: 'k', openContexts: new Set(), esc: String, window: { WizConfig: { agent: () => 'Wizard' }, WosSkinHost: { rendered: (part, at) => hooks.push([part, at]) } }, globalThis: {} });
  paint.paint();
  assert.deepEqual(hooks.slice(1).map(([part, at]) => [part, at === el]), [['thread', true]], 'the thread hook gets the painted element');
  assert.ok(el.querySelector('[data-part="thread"] form[data-part="composer"]'), 'the thread and its composer are marked');
  // The phone dock is marked in the shell page itself.
  assert.ok(parsed('web/index.html').querySelector('#dock[data-part="dock"]'), 'the phone dock is a part');
});

// Tweaks share the package lint surface; behaviour belongs in web/tweaks, not new skin scripts.
import './fixtures/tweak-lint.mjs';
import { withSkinHostParts } from './fixtures/skin-host-parts.mjs';
