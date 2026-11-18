// wizard-ux issue 1581 (James, 18 Nov 2026): reading a long reply, tapping a link to another thread and going Back
// must bring the first thread back at his reading place, not at the top of its latest reply.
// Cause: the shell resumes a newly shown thread box with the options of the LAST position call, which were the
// previous thread's turns. That resume placed the new thread with the old thread's latest-reply id, found no matching
// saved place and saved a fresh "top of the latest reply" place over his real one. Real chat-power.js in a vm.
// Browser proof: tests/qa-thread-link-back.cjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../web/core/chat-power.js', import.meta.url), 'utf8');
function harness() {
  const state = {}, w = { id: 'win', thread: 'thread-a' }, storage = {};
  let top = 0;
  const sc = { scrollHeight: 4000, clientHeight: 800, get scrollTop() { return top; }, set scrollTop(n) { top = n; } };
  const on = new Map();
  const host = { dataset: { chats: 'win' }, querySelector: () => ({ hidden: true }), addEventListener: (n, f) => on.set(n, f), removeEventListener: n => on.delete(n) };
  // One latest reply, 3000 px tall, starting 200 px into the thread.
  const row = { dataset: { morphKey: 'reply' }, getBoundingClientRect: () => ({ top: 100 + 200 - top, height: 3000, bottom: 100 + 3200 - top }) };
  const nb = { isConnected: true, querySelectorAll: s => s === 'img' ? [] : [row], addEventListener() {}, removeEventListener() {},
    closest: s => s === '[data-incog-thread]' ? null : s === '[data-chats]' ? host : null,
    getBoundingClientRect: () => ({ top: 100 }), firstElementChild: row, lastElementChild: row, children: [] };
  Object.defineProperties(nb, { scrollTop: { get: () => sc.scrollTop, set: n => { sc.scrollTop = n; } }, scrollHeight: { get: () => sc.scrollHeight }, clientHeight: { get: () => sc.clientHeight } });
  const ctx = { console, Date, setTimeout: () => 1, clearTimeout() {}, addEventListener() {}, document: { addEventListener() {} },
    localStorage: { getItem: k => storage[k], setItem: (k, v) => { storage[k] = v; } }, WizCore: { esc: String }, WosModels: {},
    WizLive: { session: id => ({ id, status: 'completed' }), isNew: () => false } };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(source, ctx);
  const api = ctx.WosChatPower({ ch: () => state, CH: { win: state }, H: { win: () => w }, threadOnScreen: () => true, scrollBox: () => nb, isWorking: () => false });
  const turnsOf = (n, at) => Array.from({ length: n }, (_, i) => ({ u: { text: 'q' + i }, a: { text: 'a' + i, at: at + i } }));
  return { api, nb, host, w, state, sc, turnsOf, top: () => top, setTop: n => { top = n; }, scrollBy: n => { on.get('wheel')?.(); top = n; } };
}
// A shell repaint: the new box shows first (resume, with whatever options the last placement used), then the paint's own placement.
function paint(h, turns) { h.api.resume(h.nb); h.api.position(h.w, h.host, h.nb, { turns, working: false }); }
test('Back from a linked thread restores the reading place, not the top of the latest reply', () => {
  const h = harness(), A = h.turnsOf(5, 1000), B = h.turnsOf(1, 9000);
  h.api.opened('win', 'thread-a'); paint(h, A);
  assert.equal(h.top(), 192, 'a fresh open lands on the first line of the latest reply');
  h.scrollBy(1700); h.api.capture(h.nb);                       // he reads down to the middle of the reply
  const place = h.api.RP.read('thread-a'); assert.equal(place.scrollTop, 1700);
  h.w.thread = 'thread-b'; h.api.opened('win', 'thread-b');  // taps the link
  h.setTop(0); paint(h, B);
  assert.equal(h.api.RP.read('thread-b').messageId, '0:9000', 'the linked thread is placed with its own turns');
  assert.equal(h.api.RP.read('thread-a').scrollTop, 1700, 'opening the linked thread never touches his place in the first');
  h.scrollBy(300); h.api.capture(h.nb);                        // does something there
  h.w.thread = 'thread-a'; h.api.opened('win', 'thread-a');  // Back
  h.setTop(0); paint(h, A);
  assert.equal(h.api.RP.read('thread-a').messageId, '4:1004');
  assert.equal(h.top(), 1700, 'Back lands where he was reading');
});
test('a resume only re-places the thread its options belong to', () => {
  const h = harness(), A = h.turnsOf(5, 1000);
  h.api.opened('win', 'thread-a'); paint(h, A); h.scrollBy(1700); h.api.capture(h.nb);
  h.w.thread = 'thread-b'; h.api.opened('win', 'thread-b');
  h.api.resume(h.nb);                                         // the box shows before thread-b has turns
  assert.equal(h.api.RP.read('thread-b'), null, 'no place is saved for thread-b from thread-a\'s turns');
  assert.equal(h.state.posFor, '', 'thread-b is still unplaced, so its own paint places it');
});
test('a new reply that arrived while he was away still opens at its first line', () => {
  const h = harness(), A = h.turnsOf(5, 1000);
  h.api.opened('win', 'thread-a'); paint(h, A); h.scrollBy(1700); h.api.capture(h.nb);
  h.w.thread = 'thread-b'; h.api.opened('win', 'thread-b'); h.setTop(0); paint(h, h.turnsOf(1, 9000));
  h.w.thread = 'thread-a'; h.api.opened('win', 'thread-a'); h.setTop(0); paint(h, h.turnsOf(6, 1000));
  assert.equal(h.top(), 192, 'a newer latest reply opens at its first line');
});
