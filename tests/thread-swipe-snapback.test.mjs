// A swipe-back released short of Back snaps the thread fully back (James, 23 Oct 2026: "it stays indented").
// Loads the real built-in with a fake skin API whose frames are deferred like requestAnimationFrame.
import test from 'node:test';
import assert from 'node:assert/strict';

let setup = null;
globalThis.window = { WosSkinHost: { builtin: (_n, fn) => { setup = fn; } }, getSelection: () => '' };
await import('../web/core/thread-swipe-back.js');

function harness() {
  const handlers = {}, queued = []; let backs = 0, now = 0;
  const thread = { style: {} };
  const root = { querySelector: () => thread };
  const realNow = performance.now; performance.now = () => now;
  setup({
    part: n => (n === 'thread' ? root : null), route: () => ({ view: 'thread' }), env: { edgeInset: 24 },
    listen: (_el, type, fn) => { handlers[type] = fn; }, frame: fn => queued.push(fn), on() {},
    nav: { back: () => { backs++; return true; } },
  });
  const swipe = (dx, dy, ms) => {
    const before = backs; now = 0; const x = 150, y = 400;
    handlers.touchstart({ touches: [{ clientX: x, clientY: y }], target: { closest: () => null } });
    for (let i = 1; i <= 8; i++) { now = ms * i / 8; handlers.touchmove({ touches: [{ clientX: x + dx * i / 8, clientY: y + dy * i / 8 }] }); }
    handlers.touchend({ type: 'touchend', changedTouches: [{ clientX: x + dx, clientY: y + dy }] });
    while (queued.length) queued.shift()();
    performance.now = realNow;
    return backs > before;
  };
  return { swipe, thread };
}

test('a drag released short snaps back with no leftover indent', () => {
  const h = harness();
  assert.equal(h.swipe(100, 5, 600), false, 'not far enough to go back');
  assert.equal(h.thread.style.transform, '', 'no leftover indent');
  assert.equal(h.thread.style.opacity, '', 'no leftover fade');
});

test('an intentional swipe still goes back', () => {
  const h = harness();
  assert.equal(h.swipe(150, 5, 400), true);
});
