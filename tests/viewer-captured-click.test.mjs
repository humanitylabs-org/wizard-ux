import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Browser-free state-machine regression, NOT native capture or layout proof.
// Execute the actual viewer and registered listeners. This small DOM model only
// supplies geometry/capture retargeting; trusted Chromium acceptance is separate.
const source = fs.readFileSync(new URL('../web/core/chat-kit.js', import.meta.url), 'utf8');
const media = source.slice(source.indexOf('  const TEXTY ='), source.indexOf('  /* ================= approvals'));
function fixture({ phoneSquare = false } = {}) {
  let viewer, stage, image, clock = 1000, timerId = 0;
  const timers = new Map(), captures = new Set(), nodes = new Map();
  const style = () => ({ setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; } });
  class Node {
    constructor(name) { this.className = name; this.handlers = {}; this.style = style(); this.hidden = false; this.dataset = {}; this.clientWidth = 1200; this.clientHeight = 700; this.isConnected = true; this.classes = new Set(name.split(' ')); this.classList = { contains: x => this.classes.has(x), add: (...xs) => xs.forEach(x => this.classes.add(x)), remove: (...xs) => xs.forEach(x => this.classes.delete(x)), toggle: (x, on) => on ? this.classes.add(x) : this.classes.delete(x) }; }
    addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); }
    setAttribute() {}
    appendChild() {}
    focus() {}
    closest(sel) {
      if (sel === '.mv-stage' && (this === stage || this === image)) return stage;
      if (sel === '.mv-menu') return this.inMenu ? nodes.get('.mv-menu') : this.className === 'mv-menu' ? this : null;
      if (sel === '.mv-menu-b') return this.className === 'mv-menu-b' ? this : null;
      if (sel === '[data-mv]') return this.dataset.mv ? this : null;
      if (sel === '[data-mvm]') return this.dataset.mvm ? this : null;
      return null;
    }
    querySelector(sel) {
      if (sel === 'img' || sel === '.mv-stage img') return image;
      if (sel === '.mv-stage') return stage;
      if (!nodes.has(sel)) nodes.set(sel, new Node(sel.slice(1)));
      return nodes.get(sel);
    }
    querySelectorAll() { return []; }
    set innerHTML(value) {
      if (this !== stage) return;
      image = value.startsWith('<img') ? new Node('img') : null;
      if (image) { image.complete = true; image.naturalWidth = phoneSquare ? 800 : 786; image.naturalHeight = phoneSquare ? 800 : 1704; }
    }
    getBoundingClientRect() {
      let left = 0, top = phoneSquare ? 54 : 0, width = phoneSquare ? 412 : 1200, height = phoneSquare ? 721 : 700;
      if (this === image) {
        const s = Number(/scale\(([^)]+)/.exec(this.style.transform)?.[1] || 1);
        const t = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(this.style.transform);
        left += width * (1 - s) / 2 + Number(t?.[1] || 0); top += height * (1 - s) / 2 + Number(t?.[2] || 0); width *= s; height *= s;
      }
      return { left, top, right: left + width, bottom: top + height, width, height };
    }
    setPointerCapture(id) { captures.add(id); }
    hasPointerCapture(id) { return captures.has(id); }
    releasePointerCapture(id) { captures.delete(id); }
  }
  stage = new Node('mv-stage');
  const body = new Node('body');
  const context = vm.createContext({ window: { addEventListener() {} }, document: { documentElement: { dataset: { shell: 'desktop' } }, body, activeElement: body, createElement: () => (viewer = new Node('mviewer')), getElementById: () => null }, navigator: {}, performance: { now: () => clock }, setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id), requestAnimationFrame: () => 1, cancelAnimationFrame() {}, addEventListener() {}, K: { onChange() {}, notify() {} }, esc: x => x });
  vm.runInContext(media + '\nglobalThis.api = viewer; globalThis.debug = V;', context);
  const api = context.api;
  const open = () => api.open([{ url: '/synthetic-a.svg', kind: 'image' }, { url: '/synthetic-b.svg', kind: 'image' }]);
  open();
  function event(type, x = 600, y = 350, id = 1, target = stage, extra = {}) {
    clock += 20;
    const e = { type, clientX: x, clientY: y, pointerId: id, timeStamp: clock, button: 0, detail: 1, target, ...extra };
    if (type === 'click') for (const fn of viewer.handlers.click || []) fn(e);
    else { for (const fn of stage.handlers[type] || []) fn(e); if (type === 'pointerdown') for (const fn of viewer.handlers[type] || []) fn(e); }
    if (type === 'pointerup' || type === 'pointercancel') { captures.delete(id); for (const fn of stage.handlers.lostpointercapture || []) fn({ ...e, type: 'lostpointercapture' }); }
    return e;
  }
  const tap = (x = 600, y = 350) => { event('pointerdown', x, y); event('pointerup', x, y); event('click', x, y); };
  return { api, event, tap, open, timers, stage, captures, debug: context.debug, wait: ms => { clock += ms; }, button(action, menu = false) { const b = new Node('button'); b.inMenu = menu; b.dataset[menu ? 'mvm' : 'mv'] = action; return b; } };
}

test('retargeted stage click on ink stays open; genuine letterbox closes', () => {
  const f = fixture(); f.tap(); assert(f.api.state.open);
  f.wait(400); f.tap(4, 350); assert(!f.api.state.open);
});
test('double tap zoom/reset survives captured click and normal lostcapture', () => {
  const f = fixture(); f.tap(); f.tap(); assert.equal(f.api.state.scale, 2.5); assert(f.api.state.open);
  f.wait(400); f.tap(); f.tap(); assert.equal(f.api.state.scale, 1); assert(f.api.state.open);
});
test('drag click over letterbox is consumed once; fresh press clears suppression', () => {
  const f = fixture(); f.event('pointerdown', 450, 350); f.event('pointermove', 400, 350); f.event('pointerup', 400, 350); f.event('click', 400, 350); assert(f.api.state.open);
  f.tap(400, 350); assert(!f.api.state.open);
});
test('suppression rejects wrong pointer, stale and negative-age events', () => {
  for (const variant of ['wrong', 'stale', 'negative']) {
    const f = fixture(); f.event('pointerdown'); f.event('pointermove', 560); const up = f.event('pointerup', 560);
    f.event('click', 4, 350, variant === 'wrong' ? 9 : 1, f.stage, { timeStamp: up.timeStamp + (variant === 'stale' ? 501 : variant === 'negative' ? -1 : 10) });
    assert(!f.api.state.open, variant);
  }
});
test('menu, control and keyboard action dispatch are not globally suppressed', () => {
  const f = fixture(); f.event('pointerdown'); f.event('pointermove', 560); f.event('pointerup', 560);
  f.event('click', 600, 350, 1, f.button('next'), { detail: 0 }); assert.equal(f.api.state.i, 1);
  f.api.menu(); f.event('click', 600, 350, 1, f.button('cancel', true), { detail: 0 });
  assert(!f.api.state.menu && f.api.state.open); f.api.close(); assert(!f.api.state.open);
});
test('pinch partial lift continues finite pan; no accidental swipe after multi-touch', () => {
  const f = fixture(); f.event('pointerdown', 560, 350, 1); f.event('pointerdown', 640, 350, 2); f.event('pointermove', 700, 350, 2);
  f.event('pointerup', 700, 350, 2); f.event('pointermove', 500, 270, 1); f.event('pointerup', 500, 270, 1); f.event('click', 4, 350);
  assert(f.api.state.open); assert.equal(f.api.state.i, 0); assert(Number.isFinite(f.api.state.x)); assert(Number.isFinite(f.api.state.y));
  assert.equal(f.debug.ptr.size, 0); assert.equal(f.debug.g, null);
});
test('pointercancel and premature lostcapture never navigate, dismiss or double tap', () => {
  for (const type of ['pointercancel', 'lostpointercapture']) {
    const f = fixture(); f.event('pointerdown'); f.event('pointermove', 400); f.event(type, 400);
    assert(f.api.state.open); assert.equal(f.api.state.i, 0); assert.equal(f.debug.ptr.size, 0);
    f.tap(); assert.equal(f.api.state.scale, 1);
  }
});
test('gallery and reopen clear tap/gesture state; non-primary press is ignored', () => {
  const f = fixture(); f.tap(); f.event('click', 600, 350, 1, f.button('next')); f.tap(); assert.equal(f.api.state.scale, 1);
  f.api.close(); f.open(); f.tap(); assert.equal(f.api.state.scale, 1);
  f.event('pointerdown', 600, 350, 1, f.stage, { button: 2 }); assert.equal(f.debug.ptr.size, 0);
});
test('held press lift keeps menu open, and show releases only its active captures', () => {
  const f = fixture(); f.event('pointerdown');
  for (const fn of [...f.timers.values()]) fn();
  f.event('pointerup'); f.event('click'); assert(f.api.state.open && f.api.state.menu);
  f.api.close(); assert(f.api.state.open && !f.api.state.menu);
  f.event('pointerdown'); assert(f.captures.has(1));
  f.open(); assert(!f.captures.has(1)); assert.equal(f.debug.ptr.size, 0); assert.equal(f.debug.g, null);
  f.tap(); assert.equal(f.api.state.scale, 1);
});
test('bubbling child capture handoff does not cancel stable-stage ownership', () => {
  const f = fixture(); f.event('pointerdown');
  f.event('lostpointercapture', 600, 350, 1, { className: 'img' });
  assert.equal(f.debug.ptr.size, 1); assert(f.debug.g);
  f.event('pointermove', 550, 350); f.event('pointerup', 550, 350); f.event('click', 4, 350);
  assert(f.api.state.open); assert.equal(f.debug.ptr.size, 0);
});

test('R5 image-box letterbox pointerup dismisses synchronously without any click', () => {
  const f = fixture({ phoneSquare: true }), img = f.stage.querySelector('img');
  assert.equal(img.getBoundingClientRect().top, 54); // painted square starts at 208.5
  f.event('pointerdown', 206, 131.25, 14, img, { pointerType: 'touch', isPrimary: true });
  assert.equal(f.debug.g.ink, false); assert(f.api.state.open);
  f.event('pointerup', 206, 131.25, 14, f.stage, { pointerType: 'touch', isPrimary: true });
  assert(!f.api.state.open); assert.equal(f.debug.g, null); assert.equal(f.debug.ptr.size, 0);
  assert.equal(f.debug.eatClick, null); assert.equal(f.debug.lastTap, 0);
  f.event('click', 206, 131.25, 14); assert(!f.api.state.open); // duplicate harmless
  f.open(); f.event('pointerdown', 206, 400); f.event('pointerup', 206, 400);
  assert(f.api.state.open); assert.equal(f.api.state.scale, 1);
  f.event('pointerdown', 206, 400); f.event('pointerup', 206, 400);
  assert(f.api.state.open); assert.equal(f.api.state.scale, 2.5);
});
test('outside release requires outside start and end, no movement or zoom', () => {
  for (const variant of ['inside-start', 'inside-end', 'out-and-back', 'release-jump', 'zoom']) {
    const f = fixture({ phoneSquare: true });
    if (variant === 'zoom') f.debug.s = 2.5;
    f.event('pointerdown', 206, variant === 'inside-start' ? 210 : 131.25);
    if (variant === 'out-and-back') { f.event('pointermove', 220, 131.25); f.event('pointermove', 206, 131.25); }
    f.event('pointerup', 206, variant === 'inside-end' ? 210 : variant === 'release-jump' ? 150 : 131.25);
    assert(f.api.state.open, variant);
  }
});
test('outside cancel, held, long, secondary or unmatched release never dismisses', () => {
  for (const variant of ['pointercancel', 'lostpointercapture', 'held', 'long', 'secondary', 'unmatched', 'nonzero-button']) {
    const f = fixture({ phoneSquare: true }); f.event('pointerdown', 206, 131.25);
    if (variant === 'held') for (const fn of [...f.timers.values()]) fn();
    if (variant === 'long') f.wait(301);
    if (variant === 'pointercancel' || variant === 'lostpointercapture') f.event(variant, 206, 131.25);
    f.event('pointerup', 206, 131.25, variant === 'unmatched' ? 99 : 1, f.stage, { isPrimary: variant !== 'secondary', button: variant === 'nonzero-button' ? 2 : 0 });
    assert(f.api.state.open, variant);
  }
});
test('outside multi-touch partial release and unloaded photo never dismiss', () => {
  const f = fixture({ phoneSquare: true });
  f.event('pointerdown', 200, 131.25, 1); f.event('pointerdown', 212, 131.25, 2);
  f.event('pointerup', 212, 131.25, 2); f.event('pointerup', 200, 131.25, 1);
  assert(f.api.state.open); assert.equal(f.debug.ptr.size, 0);
  f.stage.querySelector('img').naturalWidth = 0;
  f.event('pointerdown', 206, 131.25); f.event('pointerup', 206, 131.25); assert(f.api.state.open);
  f.open(); f.event('pointerdown', 206, 131.25);
  f.stage.querySelector('img').naturalWidth = 0;
  f.event('pointerup', 206, 131.25); assert(f.api.state.open);
});
test('final outside oracle requires genuine matching release and hidden viewer, not click', () => {
  const helper = fs.readFileSync(new URL('../tools/viewer-qa-repair.cjs', import.meta.url), 'utf8');
  const begin = helper.indexOf('await p.waitForFunction(({ start, x, y }) => {');
  const callback = helper.slice(begin + 'await p.waitForFunction('.length, helper.indexOf('}, { start: finalTap.start', begin) + 1);
  const down = { type: 'pointerdown', trusted: true, pointerType: 'touch', inViewer: true, x: 206, y: 131.25, id: 14 };
  const up = { ...down, type: 'pointerup', active: 0 };
  function accepts(events, open = false, hidden = true) {
    return vm.runInNewContext('(' + callback + ')({start:0,x:206,y:131.25})', { __viewerTouchInput: events, WosChat: { viewer: { state: { open } } }, document: { querySelector: () => ({ hidden }) } });
  }
  assert(accepts([down, up])); assert(!accepts([down]));
  assert(!accepts([down, { ...up, id: 15 }])); assert(!accepts([down, { ...up, trusted: false }]));
  assert(!accepts([down, { ...up, y: 400 }])); assert(!accepts([down, { ...up, active: 1 }]));
  assert(!accepts([down, { ...up, type: 'pointercancel' }, up]));
  assert(!accepts([down, up], true)); assert(!accepts([down, up], false, false));
});
