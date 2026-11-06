import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Execute the owning function, not a second shortcut implementation. This tiny
// propagation model checks the window -> document capture boundary; real browser
// coverage is qa-desktop-frame-hotkeys.cjs on the admitted forum worker.
const source = fs.readFileSync(process.env.QA_DESKTOP_SOURCE || new URL('../web/desktop/desktop.js', import.meta.url), 'utf8');
const start = source.indexOf('  function watchFrame(f, el) {');
const end = source.indexOf('\n  function render()', start);
assert(start >= 0 && end > start);
class Target {
  listeners = new Map();
  addEventListener(type, fn) { const a = this.listeners.get(type) || []; a.push(fn); this.listeners.set(type, a); }
  fire(type, e = {}) { for (const fn of this.listeners.get(type) || []) fn(e); }
}
function fixture({ opaque = false, blocked = true } = {}) {
  const frameWindow = new Target(), doc = new Target(), frame = new Target();
  doc.defaultView = frameWindow;
  // Never enumerate child frames / read editor or private field contents.
  Object.defineProperty(doc, 'querySelectorAll', { get() { throw Error('nested document inspection'); } });
  frame.contentDocument = opaque ? null : doc;
  frame.contentWindow = frameWindow;
  frame.style = {}; const calls = [], ups = [], hidden = [];
  const el = { dataset: { win: 'fixture' }, querySelector: selector => selector === 'iframe' ? frame : null, classList: { remove() {} }, style: { setProperty() {} } };
  const focused = [];
  const sandbox = { window: {}, W: {}, APP: {}, LINKS: null, fields: () => ({ bind() {} }), desktopHost: { focus: (id, opts) => focused.push({ id, ...opts }) }, onKey: (e, inside) => calls.push({ e, inside }), keyHints: { up: e => ups.push(e), hide: () => hidden.push(true) } };
  vm.runInNewContext(source.slice(start, end) + '\nthis.watchFrame = watchFrame;', sandbox);
  // Common app/modal capture handler: blocks propagation to document, but not
  // other listeners on this same window. This is actual DOM stopPropagation
  // semantics, NOT stopImmediatePropagation (which remains owned by the app).
  if (blocked) for (const type of ['keydown', 'keyup']) frameWindow.addEventListener(type, e => e.stopPropagation());
  sandbox.watchFrame(frame, el); frame.fire('load');
  function key(type = 'keydown', props = {}) {
    const e = { key: '3', code: 'Digit3', altKey: true, stopped: false, defaultPrevented: false, stopPropagation() { this.stopped = true; }, preventDefault() { this.defaultPrevented = true; }, ...props };
    frameWindow.fire(type, e); if (!e.stopped) doc.fire(type, e); return e;
  }
  return { frameWindow, doc, frame, key, calls, ups, hidden, focused };
}
test('first iframe pointerdown focuses synchronously through host without stealing app focus', () => {
  const f = fixture(); f.doc.fire('pointerdown');
  assert.deepEqual(f.focused, [{ id: 'fixture', scroll: false }]);
});
test('desktop chords reach the owning dispatcher past app window capture stopPropagation', () => {
  const f = fixture(); const e = f.key();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].e, e); assert.equal(f.calls[0].inside, true);
});
test('keyup still reaches modifier hint cleanup past app capture', () => {
  const f = fixture(); const e = f.key('keyup', { key: 'Alt', code: 'AltLeft', altKey: false });
  assert.deepEqual(f.ups, [e]);
});
test('leaving an app frame clears held-key hints without a desktop click', () => {
  const f = fixture(); f.frameWindow.fire('blur'); assert.equal(f.hidden.length, 1);
});
test('unblocked chords are dispatched once, even after repeated load callbacks', () => {
  const f = fixture({ blocked: false }); f.frame.fire('load'); f.frame.fire('load'); f.key();
  assert.equal(f.calls.length, 1);
});
test('ordinary app typing is forwarded unchanged, never synthesized or consumed by the bridge', () => {
  const f = fixture({ blocked: false }); const e = f.key('keydown', { key: 'x', code: 'KeyX', altKey: false, target: { localName: 'input' } });
  assert.equal(f.calls[0].e, e); assert.equal(e.defaultPrevented, false); assert.equal(e.stopped, false);
});
test('opaque frames remain uninspected and receive no keyboard hooks', () => {
  const f = fixture({ opaque: true, blocked: false }); f.key(); assert.equal(f.calls.length, 0); assert.equal(f.frameWindow.listeners.size, 0);
});
test('replacement documents get one fresh hook while nested frames are not traversed', () => {
  const f = fixture({ blocked: false }); const next = new Target(); next.defaultView = new Target();
  f.frame.contentDocument = next; f.frame.contentWindow = next.defaultView; f.frame.fire('load'); f.frame.fire('load');
  next.defaultView.fire('keydown', { code: 'KeyO', altKey: true }); assert.equal(f.calls.length, 1);
});
