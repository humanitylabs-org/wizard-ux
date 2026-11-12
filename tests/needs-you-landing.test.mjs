// wizard-ux issue 1331, second AI review: opening a thread with an open Needs you lands on its amber line, and the
// opening restore (chat-power position -> settle -> settleTo, the reading place from issue 1316) must not pull the
// view back to the saved spot or the bottom afterwards. needsLand hands the line to PW.landAt, which makes it the
// reading place, so every later restore keeps it there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../web/core/chat-power.js', import.meta.url), 'utf8');
function harness(doc, working = false) {
  const state = { show: 120 }, w = { id: 'win', thread: 'thread' }, latest = { hidden: true };
  let top = 0, height = 3000, now = 10_000, ro = null, above = 0; // above: growth above the line (an image loading)
  const sc = { get scrollHeight() { return height; }, clientHeight: 500, get scrollTop() { return top; }, set scrollTop(n) { top = n; },
    scrollTo(o) { top = Math.max(0, Math.min(height - 500, o.top)); } };
  const host = { dataset: { chats: 'win' }, querySelector: s => s === '[data-chlatest]' ? latest : null, addEventListener() {}, removeEventListener() {} };
  // The asking reply sits 1700px down; the amber line is right above it (1640..1690). The newest reply is below it.
  const ask = { complete: true, dataset: { morphKey: 'a2' }, getBoundingClientRect: () => ({ top: 1700 + above - top, height: 200 }) };
  const newest = { complete: true, dataset: { morphKey: 'a3' }, getBoundingClientRect: () => ({ top: 2600 + above - top, height: 300 }) };
  const first = { getBoundingClientRect: () => ({ top: 100 - top }) }, last = { getBoundingClientRect: () => ({ bottom: 100 - top + height }) };
  const nb = { isConnected: true, addEventListener() {}, removeEventListener() {}, children: [], querySelector: () => null, firstElementChild: first, lastElementChild: last,
    querySelectorAll: s => s === '.msg.a' ? [ask, newest] : [ask, newest],
    closest: s => s === '[data-incog-thread]' ? null : s === '[data-chats]' ? host : { querySelector: () => ({ getBoundingClientRect: () => ({ bottom: 100 }) }) },
    getBoundingClientRect: () => ({ top: 100 }) };
  if (!doc) Object.defineProperties(nb, { scrollTop: { get: () => sc.scrollTop, set: n => { sc.scrollTop = n; } }, scrollHeight: { get: () => sc.scrollHeight }, clientHeight: { get: () => sc.clientHeight } });
  const line = { dataset: {}, nextElementSibling: ask, closest: s => s === '.ch-msgs' ? nb : null, getBoundingClientRect: () => ({ top: 1640 + above - top }) };
  const ctx = { console, Date: { now: () => now }, setTimeout: () => 1, clearTimeout() {}, addEventListener() {}, document: { addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {} }, WizCore: { esc: String }, WosModels: {}, WizLive: { session: () => ({ status: working ? 'running' : 'idle' }) },
    ResizeObserver: class { constructor(fn) { ro = fn; } observe() {} disconnect() {} } };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(source, ctx);
  const api = ctx.WosChatPower({ ch: () => state, CH: { win: state }, H: { win: () => w }, threadOnScreen: () => true, scrollBox: () => doc ? sc : nb,
    isWorking: () => working, elOf: () => ({ querySelector: () => nb }) });
  // needsLand's place(): the line 8px under the thread's top edge (100).
  const land = () => { sc.scrollTo({ top: top + (line.getBoundingClientRect().top - 100 - 8) }); return api.landAt('win', line); };
  return { api, nb, sc, w, host, line, land, top: () => top, grow: n => { height += n; }, growAbove: n => { above += n; height += n; }, tick: ms => { now += ms; }, settleTick: () => ro?.() };
}
const open = h => h.api.position(h.w, h.host, h.nb, { turns: [{ u: { text: 'q', at: 1 }, a: { text: 'x', at: 2 } }, { u: null, a: { text: 'y', at: 3 } }], working: false });

for (const doc of [false, true]) {
  const mode = doc ? 'document (phone)' : 'box (desktop)';
  test(`a saved bottom place no longer pulls the view off the Needs you line during the opening settle (${mode})`, () => {
    const h = harness(doc);
    h.api.RP.save({ sessionId: 'thread', messageId: '1:3', atBottom: true, working: false, scrollTop: 0, savedAt: 1 });
    open(h); assert.equal(h.top(), 2500, 'the reading-place restore opens at the bottom first');
    assert.equal(h.land(), true);
    assert.equal(h.line.getBoundingClientRect().top, 108, 'landed: the amber line 8px under the top');
    h.settleTick(); h.api.reflow(h.nb); h.grow(200); h.settleTick();
    assert.equal(h.line.getBoundingClientRect().top, 108, 'settleTo keeps the line (it used to restore the bottom)');
    h.tick(4000); h.grow(100); h.api.reflow(h.nb);
    assert.equal(h.line.getBoundingClientRect().top, 108, 'after the settle, repaints keep it too');
    assert.equal(h.api.RP.read('thread').atBottom, false);
  });
  test(`a saved mid-thread spot gives way to the Needs you landing as well (${mode})`, () => {
    const h = harness(doc);
    h.api.RP.save({ sessionId: 'thread', messageId: '1:3', anchor: { key: 'a3', nth: 0, off: 50 }, atBottom: false, working: false, scrollTop: 0, savedAt: 1 });
    open(h); assert.equal(h.top(), 2450);
    h.land(); h.settleTick(); h.api.reflow(h.nb);
    assert.equal(h.line.getBoundingClientRect().top, 108);
  });

  test(`an image loading above the line while the agent is working keeps the line in place (${mode}, Codex P2)`, () => {
    const h = harness(doc, true);
    h.api.RP.save({ sessionId: 'thread', messageId: '1:3', atBottom: false, anchor: { key: 'a3', nth: 0, off: 50 }, working: true, scrollTop: 0, savedAt: 1 });
    open(h); h.land(); assert.equal(h.line.getBoundingClientRect().top, 108);
    h.growAbove(240); h.settleTick();
    assert.equal(h.line.getBoundingClientRect().top, 108, 'the landing is restored even though the thread is working and grew');
    h.grow(400); h.settleTick();
    assert.equal(h.line.getBoundingClientRect().top, 108, 'the reply streaming below does not move it either');
    assert.equal(h.api.RP.read('thread').landed, true);
  });
}

test('landAt refuses a new chat, a hidden thread and a node with no message after it', () => {
  const h = harness(false);
  h.w.thread = '__new__'; assert.equal(h.api.landAt('win', h.line), false);
  h.w.thread = 'thread'; assert.equal(h.api.landAt('win', { dataset: {}, nextElementSibling: null, closest: () => h.nb }), false);
  assert.equal(h.api.landAt('win', { closest: () => null }), false);
});

test('needsLand hands the placed line to PW.landAt', () => {
  const src = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('  function needsLand(w, nav) {'), src.indexOf('  function chanPrefs() {'));
  assert.ok(body.includes("if (typeof PW !== 'undefined') PW?.landAt?.(w.id, line);"));
});
