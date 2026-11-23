// Desktops in the top bar can be rearranged: drag (touch: hold then drag), or ⌥⇧[ / ⌥⇧] for the one in front.
// The real desk code runs here with a small fake top bar (wizard-ux issue 1674: tests run the code).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createDocument } from './fixtures/mini-dom.mjs';
import { cascade } from './fixtures/mini-css.mjs';

const read = f => readFileSync(new URL(`../web/desktop/${f}`, import.meta.url), 'utf8');
const steps = read('desktop-steps.js'), pick = read('desktop-pickany.js');
const between = (s, a, b) => { const i = s.indexOf(a); assert.ok(i >= 0, a); const j = s.indexOf(b, i); assert.ok(j > i, b); return s.slice(i, j); };
const css = readFileSync(new URL('../web/desktop/desktop.css', import.meta.url), 'utf8');

// A top bar with one button per desk (data-ws = its index) and the New desktop button last.
function bar(ids) {
  const list = { kids: [], on: {}, cls: new Set(),
    classList: { add: c => list.cls.add(c), remove: c => list.cls.delete(c), contains: c => list.cls.has(c) },
    addEventListener: (t, f) => { list.on[t] = f; }, setPointerCapture() {},
    insertBefore(n, ref) { list.kids.splice(list.kids.indexOf(n), 1); list.kids.splice(ref ? list.kids.indexOf(ref) : list.kids.length, 0, n); },
    querySelector: s => (s === '[data-newdesk]' ? list.kids.find(k => k.newdesk) : null) };
  const slot = (i, x) => ({ dataset: { ws: String(i) }, isConnected: true, cls: new Set(), classList: { add() {}, remove() {} },
    closest: s => (s === '.ws[data-ws]' ? slot.of[i] : null), getBoundingClientRect: () => ({ left: x, width: 80 }),
    get nextElementSibling() { return list.kids[list.kids.indexOf(this) + 1] || null; } });
  slot.of = ids.map((_, i) => slot(i, i * 100));
  list.kids = [...slot.of, { newdesk: true, getBoundingClientRect: () => ({ left: 900, width: 40 }) }];
  return list;
}

function desks(ids = ['a', 'b', 'c'], { cur = 1, lastWs = 2 } = {}) {
  const list = bar(ids), log = [], timers = [];
  const ctx = { desktopVars: { ws: [...ids], cur, lastWs }, globalThis: {}, save: () => log.push('save'), render: () => log.push('render'),
    paintBar: () => log.push('paintBar'), navigator: {}, Date, setTimeout: f => (timers.push(f), timers.length), clearTimeout: id => { timers[id - 1] = null; },
    $: () => list, $$: () => list.kids.filter(k => !k.newdesk), stepWin: d => log.push('step:' + d) };
  vm.createContext(ctx);
  vm.runInContext(`${between(steps, '  function moveDesk(from, to) {', '  $(\'#logo\')')}
this.moveDesk = moveDesk;
this.key = (code, shift) => { const hit = f => f(); const desktopVars = this.desktopVars;
${between(pick, "    if (code === 'BracketLeft')", "\n", )}
${between(pick, "    if (code === 'BracketRight')", "\n")}
};`, ctx);
  const ev = (o = {}) => ({ button: 0, pointerId: 1, pointerType: 'mouse', clientY: 0, preventDefault() {}, ...o });
  return { ctx, list, log, timers, ev };
}

test('desktops reorder by stable desk, keeping the one in front and the last one', () => {
  const d = desks(['a', 'b', 'c'], { cur: 1, lastWs: 2 });
  assert.equal(d.ctx.moveDesk(1, 0), true);
  assert.deepEqual([...d.ctx.desktopVars.ws], ['b', 'a', 'c']);
  assert.equal(d.ctx.desktopVars.cur, 0, 'the desk in front stays in front');
  assert.equal(d.ctx.desktopVars.lastWs, 2, 'the last desk is still the same desk');
  assert.deepEqual(d.log, ['save', 'render'], 'order is saved (and synced) like any desk change');
  assert.equal(d.ctx.moveDesk(0, 3), false, 'never past the ends');
  assert.equal(d.ctx.moveDesk(1, 1), false);
  d.ctx.globalThis.WosSkinHost = { panelMode: true };
  assert.equal(d.ctx.moveDesk(0, 1), false, 'no desks while a layout holds the panel');
});

test('drag, hold and keys all move the desk in the list', () => {
  // mouse: drag desk a past desk c, drop: a lands last
  const m = desks(['a', 'b', 'c'], { cur: 0, lastWs: 0 });
  m.list.on.pointerdown(m.ev({ target: m.list.kids[0], clientX: 10 }));
  m.list.on.pointermove(m.ev({ clientX: 290 }));
  assert.ok(m.list.cls.has('arranging'), 'a live repaint waits while the desk is being dragged');
  m.list.on.pointerup(m.ev());
  assert.deepEqual([...m.ctx.desktopVars.ws], ['b', 'c', 'a']);
  assert.equal(m.ctx.desktopVars.cur, 2);
  assert.ok(!m.list.cls.has('arranging'));

  // touch: moving before the hold is a scroll, not a drag; after the 400 ms hold it drags
  const t = desks(['a', 'b', 'c']);
  t.list.on.pointerdown(t.ev({ target: t.list.kids[0], clientX: 10, pointerType: 'touch' }));
  t.list.on.pointermove(t.ev({ clientX: 290 }));
  t.list.on.pointerup(t.ev());
  assert.deepEqual([...t.ctx.desktopVars.ws], ['a', 'b', 'c'], 'no hold, no move');
  t.list.on.pointerdown(t.ev({ target: t.list.kids[0], clientX: 10, pointerType: 'touch' }));
  t.timers.filter(Boolean).at(-1)(); // the hold
  t.list.on.pointermove(t.ev({ clientX: 190 }));
  t.list.on.pointerup(t.ev());
  assert.deepEqual([...t.ctx.desktopVars.ws], ['b', 'a', 'c']);

  // ⌥⇧[ / ⌥⇧] move the desk in front; without ⇧ they step windows
  const k = desks(['a', 'b', 'c'], { cur: 1 });
  k.ctx.key('BracketRight', true); assert.deepEqual([...k.ctx.desktopVars.ws], ['a', 'c', 'b']); assert.equal(k.ctx.desktopVars.cur, 2);
  k.ctx.key('BracketLeft', true); assert.deepEqual([...k.ctx.desktopVars.ws], ['a', 'b', 'c']);
  k.ctx.key('BracketLeft', false); assert.ok(k.log.includes('step:-1'));
  // a desk button as the bar draws it (class ws, data-ws) gets touch-action: none from the real desktop.css
  const doc = createDocument(); doc.body.innerHTML = '<nav id="wsList"><button class="ws cur used" data-ws="0"></button><button class="ws ws-add" data-newdesk>+</button></nav>';
  const [desk, add] = doc.body.querySelectorAll('button');
  assert.equal(cascade(desk, css)['touch-action']?.value, 'none', 'touch drags are not taken by the page scroll');
  assert.notEqual(cascade(add, css)['touch-action']?.value, 'none', 'only desks, not the + button');
});
