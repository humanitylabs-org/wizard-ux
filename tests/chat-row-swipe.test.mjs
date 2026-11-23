// Chats row swipe (Novairecito / Sepia phone): the real gesture code (web/core/chats-swipe.js) and the real click /
// Back / hold-list code (web/core/chats-bind.js) run in node:vm on a mini-dom row; the real skin CSS is cascaded on
// the tray the code drew (wizard-ux issue 1674: tests run the code).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { cascade } from './fixtures/mini-css.mjs';
import { runPart, scoped } from './fixtures/r5B-parts.mjs';

const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const coreCss = read('web/core/chats.css');
const noirCss = read('web/skins/novairecito/skin.css');
const sepiaCss = read('web/skins/sepia/skin.css');
const ROW_MENU = '.ch-list [data-chopen], .ch-list .ch-notif-row[data-chnotif], .ch-list [data-chchan]';

// One Chats list with one quiet (done-able) thread row, the real gestures bound on it.
function swipeWorld({ skin = 'novairecito', shell = 'phone', actions = ['done'], quiet = '1' } = {}) {
  const doc = scoped(createDocument());
  const proto = Object.getPrototypeOf(doc.body);
  if (!proto.r6aStyle) { // mini-dom styles are plain objects: give them setProperty (custom properties)
    Object.defineProperty(proto, 'style', { configurable: true, get() { return (this._st ||= { setProperty(k, v) { this[k] = String(v); } }); }, set() {} });
    proto.setPointerCapture = proto.releasePointerCapture = () => {};
    proto.r6aStyle = true;
  }
  doc.documentElement.dataset.skin = skin; doc.documentElement.dataset.shell = shell;
  doc.body.innerHTML = `<div data-chats="w1"><div class="ch-list"><div class="ch-scroll"><div class="ch-row-wrap"><div class="ch-row" data-chopen="s1" data-quiet="${quiet}">Plan the trip</div></div></div></div></div>`;
  const calls = [], chatVars = { swipeOpen: null, lp: null, lpHeld: null, lpUntil: 0 };
  const CH = { w1: {} };
  const given = {
    chatVars, CH, ROW_MENU, esc: s => String(s), BOOM: () => ({ open: o => calls.push(['boom', o]) }),
    LIVE: { session: () => ({ title: 'Plan the trip' }) }, threadActions: () => actions,
    ACT: { done: { icon: '✓', label: 'Done', hint: 'Mark done' }, restore: { icon: '↺', label: 'Restore', hint: 'Restore' } },
    threadAct: (...a) => calls.push(['threadAct', ...a]), openRowSheet: (...a) => calls.push(['openRowSheet', ...a]),
    rowMenu: (...a) => calls.push(['rowMenu', ...a]), repaintList: (...a) => calls.push(['repaintList', ...a]),
    rowOf: () => ({}), vib: () => {}, readGuard: () => ({ touches: new Set() }),
  };
  const ctx = { document: doc, window: { WizCore: { chatsParts: {} }, WizComposerInput: { bind() {} } }, setTimeout: f => { f(); return 0; }, clearTimeout: () => {}, requestAnimationFrame: f => f(), Date, Math, String };
  const { out } = runPart('web/core/chats-swipe.js', 'chatsParts', 'swipe', given, ctx);
  out.bindLate({ idOf: t => t.closest('[data-chats]')?.dataset.chats || '', elOf: () => doc.body.firstElementChild });
  const list = doc.querySelector('[data-chats]');
  out.bindGestures(list);
  const row = doc.querySelector('.ch-row'), wrap = doc.querySelector('.ch-row-wrap');
  const ev = (el, type, x = 300, y = 10) => el.dispatchEvent({ type, bubbles: true, button: 0, pointerType: 'touch', pointerId: 1, clientX: x, clientY: y });
  const swipe = (dx, end = 'pointerup') => { ev(row, 'pointerdown'); ev(row, 'pointermove', 300 + dx / 2); ev(row, 'pointermove', 300 + dx); if (end) ev(row, end, 300 + dx); };
  const tray = () => wrap.children.find(c => c.classList.contains('ch-swipe-acts')) || null;
  return { doc, out, calls, chatVars, CH, given, row, wrap, list, ev, swipe, tray };
}

// The real chats-bind part, handed this world's swipe state and closeSwipe.
function bindOf(world, extra = {}) {
  const { out } = runPart('web/core/chats-bind.js', 'chatsParts', 'bind', {
    chatVars: world.chatVars, CH: world.CH, closeSwipe: world.out.closeSwipe, H: { win: () => ({ id: 'w1' }), root: () => world.doc.body },
    LIVE: world.given.LIVE, BOOM: world.given.BOOM, threadAct: world.given.threadAct, ch: id => (world.CH[id] ||= {}),
    openChat: (...a) => world.calls.push(['openChat', ...a]), KIT: { viewer: { close: () => false } }, closeRowSheet: () => false,
    closeSpacePicker: () => false, readingIn: () => false, ...extra,
  }, { document: world.doc, window: { WizCore: { chatsParts: {} } }, Date, Math, setTimeout: () => 0, clearTimeout: () => {}, addEventListener: () => {} });
  return out;
}

test('row action swipe is limited to Novairecito phone palettes', () => {
  for (const skin of ['novairecito', 'sepia']) {
    const w = swipeWorld({ skin });
    w.swipe(-120);
    assert.ok(w.wrap.classList.contains('swiped'), `${skin} phone: the row stays swiped open`);
    assert.ok(w.tray(), `${skin} phone: the tray is drawn`);
    assert.equal(w.row.style.transform, 'translateX(-148px)');
    assert.equal(w.calls.filter(c => c[0] === 'threadAct' || c[0] === 'openRowSheet').length, 0, 'a swipe never acts by itself');
    const css = skin === 'sepia' ? sepiaCss : noirCss;
    assert.equal(cascade(w.tray(), css).position?.value, 'absolute', `${skin} styles the tray it draws`);
  }
  for (const [skin, shell] of [['nebula', 'phone'], ['novairecito', 'desktop']]) {
    const w = swipeWorld({ skin, shell });
    w.swipe(-120);
    assert.equal(w.tray(), null, `${skin}/${shell}: no swipe tray`);
    assert.ok(!w.wrap.classList.contains('swiped'));
  }
  const tray = swipeWorld(); tray.swipe(-120);
  assert.equal(Object.keys(cascade(tray.tray(), coreCss)).length, 0, 'core CSS never styles the tray');
  assert.doesNotMatch(coreCss, /\.ch-swipe-acts/);
});

test('every swipe only reveals explicit accessible actions', () => {
  const w = swipeWorld();
  w.ev(w.row, 'pointerdown'); w.ev(w.row, 'pointermove', 250);
  const tray = w.tray();
  assert.equal(tray.getAttribute('aria-hidden'), 'true', 'mid-swipe the tray is still hidden');
  const btns = tray.querySelectorAll('button');
  assert.deepEqual(btns.map(b => b.dataset.chswipe), ['recall', 'done']);
  assert.deepEqual(btns.map(b => b.getAttribute('aria-label')), ['Recall Plan the trip', 'Mark done: Plan the trip']);
  assert.ok(btns.every(b => b.getAttribute('tabindex') === '-1'), 'drawn out of the tab order');
  w.ev(w.row, 'pointermove', 220); w.ev(w.row, 'pointerup', 220);
  assert.equal(tray.getAttribute('aria-hidden'), 'false', 'open: the buttons are announced');
  assert.ok(btns.every(b => b.tabIndex === 0), 'open: the buttons are reachable');
  // A long, past-half swipe still only opens the tray: no action.
  const far = swipeWorld(); far.swipe(-330);
  assert.ok(far.wrap.classList.contains('swiped'));
  assert.equal(far.calls.filter(c => c[0] === 'threadAct').length, 0);
  // A short swipe springs back and drops the tray.
  const short = swipeWorld(); short.swipe(-40);
  assert.ok(!short.wrap.classList.contains('swiped')); assert.equal(short.tray(), null);
  // The tapped button is the action: Done goes through threadAct.
  const tap = swipeWorld(); tap.swipe(-120);
  const done = tap.tray().querySelector('[data-chswipe="done"]');
  assert.equal(bindOf(tap).click({ target: done }, 'w1'), true);
  assert.deepEqual(tap.calls.filter(c => c[0] === 'threadAct'), [['threadAct', 'w1', 's1', 'done']]);
  assert.doesNotMatch(noirCss + sepiaCss, /\.ch-row-wrap\.commit/);
});

test('cancel, scroll, outside tap and Back close without invoking an action', () => {
  const acted = w => w.calls.filter(c => ['threadAct', 'openRowSheet', 'boom', 'rowMenu', 'openChat'].includes(c[0]));
  // pointercancel mid-swipe
  const c = swipeWorld();
  c.swipe(-120, 'pointercancel');
  assert.ok(!c.wrap.classList.contains('swiped')); assert.equal(c.tray(), null); assert.equal(c.row.style.transform, '');
  assert.deepEqual(acted(c), []);
  // scroll of the list closes an open swipe
  const s = swipeWorld(); s.swipe(-120); assert.ok(s.chatVars.swipeOpen);
  s.doc.querySelector('.ch-scroll').dispatchEvent({ type: 'scroll', bubbles: false });
  assert.equal(s.chatVars.swipeOpen, null); assert.ok(!s.wrap.classList.contains('swiped'));
  assert.deepEqual(acted(s), []);
  // a tap on the row (outside the tray) only closes it
  const t = swipeWorld(); t.swipe(-120); t.chatVars.lpUntil = 0;
  assert.equal(bindOf(t).click({ target: t.row }, 'w1'), true);
  assert.equal(t.chatVars.swipeOpen, null); assert.deepEqual(acted(t), []);
  // Back closes the swipe first and names it
  const k = swipeWorld(); k.swipe(-120);
  assert.equal(bindOf(k).closeOverlay(), 'row-swipe');
  assert.equal(k.chatVars.swipeOpen, null); assert.deepEqual(acted(k), []);
});

test('open swipe holds list repaints while stock and desktop gestures remain', () => {
  const w = swipeWorld(); w.swipe(-120);
  const b = bindOf(w);
  assert.equal(b.holdList('w1'), true, 'an open swipe holds the list');
  assert.equal(w.CH.w1.heldList, true);
  w.out.closeSwipe();
  assert.deepEqual(w.calls.filter(c => c[0] === 'repaintList'), [['repaintList', 'w1']], 'closing repaints the held list');
  assert.equal(b.holdList('w1'), false);
  // Stock skin: the left drag on a quiet row still files it Done; on a busy row it opens the row sheet.
  const stock = swipeWorld({ skin: 'nebula' }); stock.swipe(-80);
  assert.deepEqual(stock.calls.filter(c => c[0] === 'threadAct'), [['threadAct', 'w1', 's1', 'done']]);
  const busy = swipeWorld({ skin: 'nebula', quiet: '0' }); busy.swipe(-80);
  assert.deepEqual(busy.calls.filter(c => c[0] === 'openRowSheet').map(c => c.slice(1, 3)), [['w1', 's1']]);
  // A mouse drag on Novairecito keeps the stock gesture (desktop pointer).
  const mouse = swipeWorld();
  const mev = (type, x) => mouse.row.dispatchEvent({ type, bubbles: true, button: 0, pointerType: 'mouse', pointerId: 2, clientX: x, clientY: 10 });
  mev('pointerdown', 300); mev('pointermove', 220); mev('pointerup', 220);
  assert.equal(mouse.tray(), null);
  assert.deepEqual(mouse.calls.filter(c => c[0] === 'threadAct'), [['threadAct', 'w1', 's1', 'done']]);
});
