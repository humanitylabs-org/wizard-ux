// wizard-ux issue 1564: Back from a thread in the Android app (document-scrolled thread, `WizardOS-DocScroll`) must be
// one horizontal slide. Two causes of the vertical drop, both pinned here on the real chats.js code:
// 1. Leaving document scroll removed the path classes with transitions live, so the desk track rode in from the side
//    and the window padding / header slid down from the top. The swap now holds every path node's transition.
// 2. The list painted (and restored its place) under document scroll for a frame before the rAF hand-back ran.
//    renderChatList now leaves document scroll in the same paint.
// Browser proof, frame by frame: tests/qa-chat-back-no-vertical.cjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { withParts } from './fixtures/chats-parts.mjs';
import { runRecording } from './fixtures/source-slice.mjs'; // chats.js parts moved out verbatim (issue 1665)

const src = withParts(readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8'));
const body = src.slice(src.indexOf('  function syncDocumentThread() {'), src.indexOf('\n  {\n    const queueDocumentThread'));

function fixture() {
  const log = [];
  const node = (name, parent = null) => {
    const cls = new Set(), n = { name, parentElement: parent, style: { _t: name === 'track' ? 'transform .3s' : '' }, children: [] };
    Object.defineProperty(n.style, 'transition', { get() { return this._t; }, set(v) { log.push([name, 'transition', v]); this._t = v; } });
    n.classList = {
      add: (...c) => c.forEach(x => cls.add(x)), contains: c => cls.has(c), has: c => cls.has(c),
      remove: (...c) => { if (c.some(x => cls.has(x))) log.push([name, 'remove', n.style._t]); c.forEach(x => cls.delete(x)); },
      toggle: (c, on) => { if (on) cls.add(c); else cls.delete(c); },
    };
    n.querySelector = () => null; n.querySelectorAll = () => [];
    n.getClientRects = () => [1];
    return n;
  };
  const root = node('html'), track = node('track', root), win = node('win', track), chats = node('chats', win);
  const all = [track, win, chats];
  let scrollTop = 900, flushed = 0;
  Object.defineProperty(root, 'offsetHeight', { get() { flushed++; log.push(['html', 'flush']); return 915; } });
  const document = {
    documentElement: root,
    get scrollingElement() { return { get scrollTop() { return scrollTop; } }; },
    querySelectorAll: sel => sel === '.wos-doc-path,.wos-doc-thread' ? all.filter(n => n.classList.has('wos-doc-path') || n.classList.has('wos-doc-thread')) : [],
    getElementById: () => null,
  };
  const window = { scrollTo: (x, y) => { log.push(['window', 'scrollTo', y]); scrollTo = y; scrollTop = y; } };
  let scrollTo = null, owner = chats;
  // A thread was open: the document-scroll classes sit on its path.
  chats.classList.add('wos-doc-thread'); for (const n of all) n.classList.add('wos-doc-path'); root.classList.add('wos-doc-scroll');
  const ctx = vm.createContext({ document, window, H: { visible: () => ['w1'] }, elOf: () => chats, androidDocument: true,
    restoreVisibleThreads() {}, PW: null, ResizeObserver: undefined, sizeDocumentChrome() {}, console });
  vm.runInContext(`let docOwner = null, docResize = null, docObserved = [];\n${body}\nglobalThis.sync = syncDocumentThread; globalThis.setOwner = o => { docOwner = o; }; globalThis.owner = () => docOwner;`, ctx);
  ctx.setOwner(owner);
  return { ctx, log, all, root, flushed: () => flushed };
}

test('leaving document scroll swaps the mode with every path transition held, then hands them back', () => {
  const f = fixture();
  f.ctx.sync(); // the thread is gone: no visible window holds a .ch-thread
  assert.equal(f.ctx.owner(), null);
  assert.equal(f.root.classList.has('wos-doc-scroll'), false);
  for (const n of f.all) assert.equal(n.classList.has('wos-doc-path'), false, n.name + ' left the path');
  // Every class removal happened with its transition off.
  const removals = f.log.filter(e => e[1] === 'remove');
  assert.equal(removals.length, 3);
  for (const r of removals) assert.equal(r[2], 'none', `${r[0]} lost its path class with transitions held`);
  // The page scroll goes to the top in the same step, before the style flush, and the flush comes before hand-back.
  const at = k => f.log.findIndex(e => e[0] === k[0] && e[1] === k[1]);
  assert.ok(at(['window', 'scrollTo']) > -1 && at(['window', 'scrollTo']) < at(['html', 'flush']));
  const backIdx = f.log.findIndex((e, i) => i > at(['html', 'flush']) && e[1] === 'transition');
  assert.ok(backIdx > at(['html', 'flush']), 'transitions come back only after the new style is in');
  // The track's own transition is back as it was (the desk swipe still animates later).
  assert.equal(f.all[0].style.transition, 'transform .3s');
  assert.equal(f.all[1].style.transition, '');
});

// The list paint's full-redraw branch of renderChatList (cut from the real chats.js), with every helper it calls
// recorded in order.
function listPaint({ owner = 'list', android = true } = {}) {
  const start = src.indexOf('      const keepSheet = keptSheet(el);\n      clearReading(w.id); el.innerHTML = html;');
  const endMark = "if (restoreListPlace(el.querySelector('.ch-scroll'), place)) c.listPending = null;";
  const end = src.indexOf(endMark, start);
  assert.ok(start > 0 && end > start, 'the list paint in renderChatList');
  const el = { id: 'list-el', innerHTML: '', firstElementChild: { id: 'root' }, querySelector: sel => ({ sel }) };
  const other = { contains: () => false }, parent = { contains: n => n === el };
  const docOwner = owner === 'list' ? el : owner === 'parent' ? parent : owner === 'other' ? other : null;
  const ctx = { el, html: '<div class="ch-scroll">list</div>', c: {}, w: { id: 'w1' }, place: { top: 5 }, docOwner, androidDocument: android };
  runRecording(`{\n${src.slice(start, end + endMark.length)}\n}`, ctx);
  return { names: ctx.calls.map(x => x[0]), el, ctx };
}

test('a list paint over the document-scrolled thread leaves document scroll in the same paint', () => {
  for (const owner of ['list', 'parent']) {
    const p = listPaint({ owner });
    assert.equal(p.el.innerHTML, '<div class="ch-scroll">list</div>', 'the list is drawn');
    const names = p.names;
    assert.ok(names.includes('syncDocumentThread'), `${owner}: document scroll is handed back in this paint`);
    assert.ok(names.indexOf('clearReading') < names.indexOf('syncDocumentThread'), 'after the new list is in');
    assert.ok(names.indexOf('syncDocumentThread') < names.indexOf('restoreListPlace'), 'before the list restores its place');
    assert.ok(names.indexOf('syncDocumentThread') < names.indexOf('restoreSheet'));
  }
  // Nothing to hand back: no owner, an unrelated owner, or not the Android document-scroll app.
  for (const o of [{ owner: null }, { owner: 'other' }, { owner: 'list', android: false }]) {
    const p = listPaint(o);
    assert.ok(!p.names.includes('syncDocumentThread'), JSON.stringify(o));
    assert.ok(p.names.includes('restoreListPlace'));
  }
});
