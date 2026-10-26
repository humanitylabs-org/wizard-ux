// Edge peek (core/edge-peek.js): the edge where the bound view leans in beside a thread is a handle for everyone.
// Loads the real built-in with a fake skin API (the host's own wiring is covered in tweak-packages.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

class El {
  constructor() { this.handlers = {}; this.attrs = {}; const c = this.cls = new Set(); this.classList = { add: k => c.add(k), remove: k => c.delete(k), contains: k => c.has(k), toggle: (k, on = !c.has(k)) => (on ? c.add(k) : c.delete(k), on) }; }
  setAttribute(k, v) { this.attrs[k] = v; }
  setPointerCapture() {}
  get offsetWidth() { return 1; }
}
function load({ shell = 'phone', beside = 0 } = {}) {
  let setup = null, opts = null;
  const window = { WosSkinHost: { builtin: (name, fn, o) => { assert.equal(name, 'edge-peek'); setup = fn; opts = o; } } };
  vm.runInNewContext(read('web/core/edge-peek.js'), { window, document: { createElement: () => new El() }, performance, Math });
  let route = { desk: 1, beside }, onBeside = null, mounted = null, now = 0;
  const gone = [];
  const realNow = performance.now;
  const api = {
    env: { shell }, route: () => route,
    nav: { goDesk: i => { gone.push(i); route = { ...route, desk: i }; } },
    gesture: { intent: (dx, dy, ms) => Math.abs(dx) > 120 || (Math.abs(dx) > 80 && Math.abs(dx) / ms > .6) }, // swipe-intent.js numbers
    listen: (el, type, fn) => { el.handlers[type] = fn; }, mount: el => { mounted = el; }, on: (type, fn) => { assert.equal(type, 'beside'); onBeside = fn; },
  };
  const teardown = setup(api);
  const side = s => { route = { ...route, beside: s }; onBeside?.({ side: s }); };
  const press = (x0, x1, { y1 = 400, ms = 150, type = 'pointerup' } = {}) => {
    performance.now = () => now; const h = mounted.handlers; now = 0;
    h.pointerdown({ clientX: x0, clientY: 400, pointerId: 1 }); now = ms;
    h.pointermove({ clientX: x1, clientY: y1, pointerId: 1 }); h[type]({ type, clientX: x1, clientY: y1, pointerId: 1 });
    performance.now = realNow; return gone.splice(0);
  };
  return { opts, teardown, get el() { return mounted; }, side, press, gone, route: () => route };
}

test('a handle appears on the side the bound view leans in, and glows when it does', () => {
  const t = load(); assert.equal(t.opts.when, 'always'); assert.equal(t.el.hidden, true);
  t.side(1); assert.equal(t.el.hidden, false); assert.ok(t.el.cls.has('right') && t.el.cls.has('glow')); assert.match(t.el.attrs['aria-label'], /view beside/);
  t.el.handlers.animationend(); assert.equal(t.el.cls.has('glow'), false, 'glow ends after its runs');
  t.side(-1); assert.ok(t.el.cls.has('left') && !t.el.cls.has('right') && t.el.cls.has('glow')); assert.match(t.el.attrs['aria-label'], /Back to the thread/);
  t.side(0); assert.equal(t.el.hidden, true); assert.equal(t.el.cls.has('glow'), false);
});

test('tap or an intentional inward swipe moves across; the left edge comes back', () => {
  const t = load({ beside: 1 }); assert.equal(t.el.hidden, false, 'a bound view already beside at load');
  assert.deepEqual(t.press(370, 372), [2], 'tap');
  t.side(-1); assert.deepEqual(t.press(10, 11), [1], 'tap the left edge');
  t.side(1); assert.deepEqual(t.press(370, 200, { ms: 200 }), [2], 'a long swipe toward the middle');
  t.side(-1); assert.deepEqual(t.press(8, 110, { ms: 90 }), [1], 'a fast flick toward the middle');
});

test('short, outward, vertical and cancelled drags do nothing (the OS edge gesture keeps the finger)', () => {
  const t = load({ beside: 1 });
  assert.deepEqual(t.press(370, 330, { ms: 400 }), [], 'a short slow drag');
  assert.deepEqual(t.press(300, 389), [], 'outward');
  assert.deepEqual(t.press(370, 340, { y1: 560 }), [], 'vertical');
  assert.deepEqual(t.press(370, 150, { type: 'pointercancel' }), [], 'cancelled');
  t.side(-1); assert.deepEqual(t.press(5, 200, { type: 'pointercancel' }), [], 'iOS left-edge back swipe takes the finger');
  assert.deepEqual(t.press(150, 6), [], 'outward on the left');
});

test('keyboard Enter (a click with no pointer) moves across; desktop shell mounts nothing', () => {
  const t = load({ beside: 1 }); t.el.handlers.click({ detail: 0 }); assert.deepEqual(t.gone, [2]);
  const d = load({ shell: 'desktop' }); assert.equal(d.el, null); assert.equal(typeof d.teardown, 'function');
});

test('wired for everyone: both shells load it, core CSS is unscoped with reduced motion, the hint names the edge', () => {
  for (const f of ['web/index.html', 'web/desktop.html']) assert.match(read(f), /<script type="module" src="core\/thread-swipe-back\.js"><\/script>\n  <script src="core\/edge-peek\.js"><\/script>/);
  const css = read('web/core/desks.css');
  assert.match(css, /^\.bound-grab \{ position: absolute; z-index: 40;/m, 'not scoped to a skin, tweak or flag');
  assert.match(css, /#device:has\(> \.bound-grab\.right\.glow\) #dotsR > \.ddot:first-child \.dsg/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.bound-grab\.glow::after, #device:has\(> \.bound-grab\.glow\) \.ddot \.dsg \{ animation: none; \} \}/);
  const app = read('web/app.js');
  assert.match(app, /is open beside this thread · tap or swipe the right edge to look/);
  assert.match(app, /<b>Tap the left edge<\/b> or swipe right on the bottom bar to return to the thread/);
  assert.doesNotMatch(read('web/tweaks/catalog.json'), /edge-peek/, 'the Miguel tweak retires once core has it');
  const src = read('web/core/edge-peek.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(src, /addEventListener|preventDefault|setTimeout|dataset\.(mine|skin)|miguel/, 'host-tracked listeners, no default prevented, no gate');
});
