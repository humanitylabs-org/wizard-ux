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
function harness(kind = 'main') {
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
    // Main vs routed: a routed thread's row carries its agent and runtime (host-profile, container, restricted) and the
    // same ids as main threads; the place is kept per thread for each.
    WizLive: { session: id => ({ id, status: 'completed', ...(kind === 'main' ? {} : { agent: `qa-${kind}`, runtime: kind }) }), isNew: () => false, agentOf: () => kind === 'main' ? '' : `qa-${kind}` } };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(source, ctx);
  const panes = {}; // another pane's own state (the desktop list pane id::list), never the thread window's
  const api = ctx.WosChatPower({ ch: id => id === 'win' ? state : (panes[id] = panes[id] || {}), owner: id => String(id).replace(/::(list|side)$/, ''), CH: { win: state }, H: { win: () => w }, threadOnScreen: () => true, scrollBox: () => nb, isWorking: () => false });
  const turnsOf = (n, at) => Array.from({ length: n }, (_, i) => ({ u: { text: 'q' + i }, a: { text: 'a' + i, at: at + i } }));
  return { api, nb, host, w, state, sc, turnsOf, top: () => top, setTop: n => { top = n; }, scrollBy: n => { on.get('wheel')?.(); top = n; } };
}
// A shell repaint: the new box shows first (resume, with whatever options the last placement used), then the paint's own placement.
function paint(h, turns) { h.api.resume(h.nb); h.api.position(h.w, h.host, h.nb, { turns, working: false }); }
for (const kind of ['main', 'host-profile', 'container', 'restricted'])
test(`Back from a linked thread restores the reading place, not the top of the latest reply (${kind})`, () => {
  const h = harness(kind), A = h.turnsOf(5, 1000), B = h.turnsOf(1, 9000);
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
// wizard-ux issue 1882 (James, 26 Nov 2026): Back to the list and opening the thread again (or switching threads and
// coming back) lost his place too, because a new reply had landed or the thread was unread: the old rule opened such a
// thread at its newest reply. His newest words replace it: every return restores a mid-thread place from the last hour.
test('a plain reopen keeps his mid-thread place when a new reply landed while he was away (issue 1882)', () => {
  const h = harness(), A = h.turnsOf(5, 1000);
  h.api.opened('win', 'thread-a'); paint(h, A); h.scrollBy(1700); h.api.capture(h.nb);
  h.w.thread = 'thread-b'; h.api.opened('win', 'thread-b'); h.setTop(0); paint(h, h.turnsOf(1, 9000));
  h.w.thread = 'thread-a'; h.api.opened('win', 'thread-a'); h.setTop(0); paint(h, h.turnsOf(6, 1000));
  assert.equal(h.top(), 1700, 'the reopen lands where he was reading, not on the new reply');
  assert.equal(h.api.RP.read('thread-a').scrollTop, 1700, 'and keeps his place saved');
});
test('a plain reopen of a thread that turned unread keeps his mid-thread place (issue 1882)', () => {
  const h = harness(), A = h.turnsOf(5, 1000);
  h.api.opened('win', 'thread-a'); paint(h, A); h.scrollBy(1700); h.api.capture(h.nb);
  h.w.thread = null;
  h.state.unreadOpen = 'thread-a'; h.w.thread = 'thread-a'; h.state.posFor = ''; h.state.backTo = ''; // opened() with LIVE.isNew true
  h.setTop(0); paint(h, h.turnsOf(6, 1000));
  assert.equal(h.top(), 1700, 'an unread thread with a mid-thread place opens at that place');
});
test('a thread he left at the bottom still opens on a new reply\'s first line (issue 1882 keeps this)', () => {
  const h = harness(), A = h.turnsOf(5, 1000);
  h.api.opened('win', 'thread-a'); paint(h, A); h.scrollBy(3200); h.api.capture(h.nb);
  assert.equal(h.api.RP.read('thread-a').atBottom, true);
  h.w.thread = 'thread-b'; h.api.opened('win', 'thread-b'); h.setTop(0); paint(h, h.turnsOf(1, 9000));
  h.w.thread = 'thread-a'; h.api.opened('win', 'thread-a'); h.setTop(0); paint(h, h.turnsOf(6, 1000));
  assert.equal(h.top(), 192, 'a newer latest reply opens at its first line');
});
test('opening from the desktop list pane (id::list) resets the placement of the window it opens in (issue 1882)', () => {
  const h = harness(), A = h.turnsOf(5, 1000);
  h.api.opened('win::list', 'thread-a'); paint(h, A); h.scrollBy(1700); h.api.capture(h.nb);
  h.w.thread = null; h.setTop(0);                                           // Back to the list: the box closes
  h.w.thread = 'thread-a'; h.api.opened('win::list', 'thread-a');          // the same thread again, from the list pane
  assert.equal(h.state.posFor, '', 'the thread window is unplaced, so the fresh box at the top is never saved as his place');
  h.api.capture(h.nb);
  assert.equal(h.api.RP.read('thread-a').scrollTop, 1700, 'a capture before the placement saves nothing');
  paint(h, A);
  assert.equal(h.top(), 1700, 'the reopen lands where he was reading');
});
// wizard-ux issue 1653 (James, 20 Nov 2026): in the Daily thread he taps a link, replies in the linked thread and goes
// Back (or Send and go steps back). The parent came back at the bottom: a new reply had landed there while he was away,
// so his saved place no longer matched the latest reply and was dropped. The place rule reads no agent or runtime field;
// main versus routed (a Claude agent's threads, agent-qualified link) is exercised in the real shell by
// tests/qa-thread-link-back.cjs QA_KINDS=routed.
test('Back keeps his mid-thread place when a new reply landed in the parent while he was away', () => {
  const h = harness(), A = h.turnsOf(5, 1000);
  h.api.opened('win', 'thread-a'); paint(h, A); h.scrollBy(1700); h.api.capture(h.nb);
  h.w.thread = 'thread-b'; h.api.opened('win', 'thread-b'); h.setTop(0); paint(h, h.turnsOf(1, 9000));
  h.api.follow('win', true, 'thread-b');                                    // his reply in the linked thread
  h.w.thread = 'thread-a'; h.api.opened('win', 'thread-a', true); h.setTop(0); paint(h, h.turnsOf(6, 1000)); // Back
  assert.equal(h.top(), 1700, 'Back lands where he was reading, not on the new reply or the bottom');
  assert.equal(h.api.RP.read('thread-a').atBottom, false);
});
test('his own send pins only the thread it went to', () => {
  const h = harness(), A = h.turnsOf(5, 1000);
  h.api.opened('win', 'thread-a'); paint(h, A); h.scrollBy(1700); h.api.capture(h.nb);
  h.api.follow('win', true, 'thread-b');                                    // a take pinned to another thread (orb, voice)
  assert.equal(h.api.RP.read('thread-a').scrollTop, 1700, 'a send to another thread never saves the bottom for this one');
  assert.equal(h.top(), 1700, 'and never moves this one');
  h.w.thread = 'thread-b'; h.api.opened('win', 'thread-b'); h.setTop(0); paint(h, h.turnsOf(1, 9000));
  h.api.follow('win', true, 'thread-b');                                    // his send in the linked thread: pin set for B
  assert.equal(h.state.pinFor, 'thread-b');
  h.w.thread = 'thread-a'; h.api.opened('win', 'thread-a', true); h.setTop(0); paint(h, A);
  assert.equal(h.top(), 1700, 'Back to the parent inside the pin window still lands on his place');
  paint(h, A);                                                              // a repaint while B's pin is still running
  assert.equal(h.top(), 1700, 'the pin set for the linked thread never applies to the parent');
});
