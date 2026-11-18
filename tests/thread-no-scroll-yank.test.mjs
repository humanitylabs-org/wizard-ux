// James (8 Nov 2026): a streaming or updating reply must never pull the thread down to the bottom while he reads.
// Growth below keeps his place and shows ↓ Latest; his own send shows his message once; layout-only changes
// (keyboard, composer) keep a bottom place at the bottom. James (18 Nov 2026, issue 1546): once he scrolls up, no
// chunk moves him; only a thread already at the bottom keeps following the stream.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../web/core/chat-power.js', import.meta.url), 'utf8');
function harness(doc = false, live = { status: 'running' }) {
  const state = { lid: 'reply', posFor: 'thread', show: 120 }, w = { id: 'win', thread: 'thread' }, latest = { hidden: true };
  let top = 1500, height = 2000, now = 10_000;
  const sc = { get scrollHeight() { return height; }, clientHeight: 500, get scrollTop() { return top; }, set scrollTop(n) { top = n; } };
  const host = { dataset: { chats: 'win' }, querySelector: s => s === '[data-chlatest]' ? latest : null, addEventListener() {}, removeEventListener() {} };
  const row = { complete: true, dataset: { morphKey: 'row' }, getBoundingClientRect: () => ({ top: 1700 - top, height: 150 }) };
  const first = { getBoundingClientRect: () => ({ top: 100 - top }) }, last = { getBoundingClientRect: () => ({ bottom: 100 - top + height }) };
  const nb = { isConnected: true, addEventListener() {}, removeEventListener() {}, children: [], querySelector: () => null, firstElementChild: first, lastElementChild: last, querySelectorAll: () => [row],
    closest: s => s === '[data-incog-thread]' ? null : s === '[data-chats]' ? host : { querySelector: () => ({ getBoundingClientRect: () => ({ bottom: 100 }) }) },
    getBoundingClientRect: () => ({ top: 100 }) };
  if (!doc) Object.defineProperties(nb, { scrollTop: { get: () => sc.scrollTop, set: n => { sc.scrollTop = n; } }, scrollHeight: { get: () => sc.scrollHeight }, clientHeight: { get: () => sc.clientHeight } });
  const ctx = { console, Date: { now: () => now }, setTimeout: () => 1, clearTimeout() {}, addEventListener() {}, document: { addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {} }, WizCore: { esc: String }, WosModels: {}, WizLive: { session: () => live } };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(source, ctx);
  const api = ctx.WosChatPower({ ch: () => state, CH: { win: state }, H: { win: () => w }, threadOnScreen: () => true, scrollBox: () => doc ? sc : nb,
    isWorking: () => true, elOf: () => ({ querySelector: () => nb }) });
  return { api, nb, sc, latest, state, top: () => top, grow: n => { height += n; }, tick: ms => { now += ms; } };
}
for (const doc of [false, true]) {
  const mode = doc ? 'document' : 'box';
  test(`a reader at the bottom follows the reply as it grows, until he scrolls up (${mode})`, () => {
    const h = harness(doc); h.api.capture(h.nb); assert.equal(h.api.RP.read('thread').atBottom, true);
    h.api.reflow(h.nb);                       // first look records the content extent
    for (let i = 0; i < 6; i++) { h.grow(120); h.api.reflow(h.nb); assert.equal(h.top(), 1500 + 120 * (i + 1), `growth ${i} left the bottom`); }
    assert.equal(h.latest.hidden, true, 'nothing new below him');
    assert.equal(h.api.RP.read('thread').atBottom, true);
    h.sc.scrollTop = 1600; h.api.capture(h.nb);   // he scrolls up a screen
    for (let i = 0; i < 4; i++) { h.grow(120); h.api.reflow(h.nb); h.api.reflow(h.nb); assert.equal(h.top(), 1600, `growth ${i} moved the reader`); }
    assert.equal(h.latest.hidden, false, '↓ Latest shows new content below');
    assert.equal(h.api.RP.read('thread').atBottom, false, 'the saved place is now his reading spot, not the bottom');
  });
  test(`a reader scrolled up stays on the same words while the reply streams (${mode})`, () => {
    const h = harness(doc); h.sc.scrollTop = 900; h.api.capture(h.nb); h.api.reflow(h.nb);
    h.grow(400); h.api.reflow(h.nb); assert.equal(h.top(), 900);
  });
  // Issue 1546 (James, 18 Nov 2026): a first reply still streaming has no latest-reply id yet. Scrolling up must still save
  // his place, or the opening bottom place came back on the next chunk that grew no line and pulled him down.
  // Main vs routed (Codex P1 on the fix): the thread's own agent row (host-profile, container, restricted; the same id
  // as a main thread) is what the window shows; the rule must hold for each.
  for (const kind of ['main', 'host-profile', 'container', 'restricted'])
  test(`a reader scrolled up mid-stream of a first reply is never moved by any chunk (${mode}, ${kind})`, () => {
    const h = harness(doc, { id: 'thread', status: 'running', runId: 'run-1', ...(kind === 'main' ? {} : { agent: `qa-${kind}`, runtime: kind }) });
    h.state.lid = '';
    h.api.RP.save({ sessionId: 'thread', messageId: '', anchor: null, atBottom: true, working: true, scrollTop: 0, savedAt: 1 });
    h.api.reflow(h.nb); assert.equal(h.top(), 1500, 'at the bottom before he scrolls');
    h.sc.scrollTop = 900; h.api.capture(h.nb);
    for (let i = 0; i < 8; i++) {
      if (i % 2) h.grow(40);   // a chunk that starts a new line
      h.api.reflow(h.nb);       // a chunk that only adds words to the line (no growth), or a plain repaint
      assert.equal(h.top(), 900, `chunk ${i} moved the reader`);
    }
    h.sc.clientHeight = 420; h.api.reflow(h.nb); assert.equal(h.top(), 900, 'a layout change moved the reader');
    assert.equal(h.latest.hidden, false, '↓ Latest shows the reply growing below');
  });
  test(`his own send shows his message, then the reply follows only while he stays at the bottom (${mode})`, () => {
    const h = harness(doc); h.sc.scrollTop = 600; h.api.capture(h.nb); h.api.reflow(h.nb);
    h.grow(80); h.api.follow('win'); assert.equal(h.top(), 1580, 'send lands on his new message');
    h.grow(60); h.api.reflow(h.nb); assert.equal(h.top(), 1640, 'his message keeps painting into view');
    h.tick(2000); h.grow(500); h.api.reflow(h.nb); assert.equal(h.top(), 2140, 'at the bottom the reply is followed');
    assert.equal(h.latest.hidden, true);
    h.sc.scrollTop = 1900; h.api.capture(h.nb); h.grow(300); h.api.reflow(h.nb); assert.equal(h.top(), 1900, 'scrolled up, the reply does not yank');
    assert.equal(h.latest.hidden, false);
  });
  test(`the opening last-reply place does not drag the view when that reply grows (${mode})`, () => {
    const h = harness(doc); h.api.RP.save({ sessionId: 'thread', messageId: 'reply', anchor: { key: 'row', nth: 0, off: 8 }, atBottom: false, scrollTop: 0, savedAt: 1 });
    h.api.reflow(h.nb); const at = h.top();
    h.grow(300); h.api.reflow(h.nb); assert.equal(h.top(), at);
  });
  test(`a working thread just opened does not follow its streaming reply during the opening settle (${mode})`, () => {
    const h = harness(doc); h.api.RP.save({ sessionId: 'thread', messageId: 'reply', atBottom: true, working: false, scrollTop: 0, savedAt: 1 });
    h.state.posFor = null; h.api.position({ id: 'win', thread: 'thread' }, h.nb.closest('[data-chats]'), h.nb, { turns: [{ u: { text: 'hi' }, a: { text: 'x', at: 1 } }], working: true });
    const at = h.top(); h.grow(400); h.api.reflow(h.nb); assert.equal(h.top(), at);
  });
  test(`↓ Latest jumps to the end, and the stream then follows him there (${mode})`, () => {
    const h = harness(doc); h.sc.scrollTop = 600; h.api.capture(h.nb); h.api.reflow(h.nb);
    h.api.follow('win', false); assert.equal(h.top(), 1500);
    h.grow(300); h.api.reflow(h.nb); assert.equal(h.top(), 1800);
  });
  test(`a bottom place survives layout-only changes such as the keyboard (${mode})`, () => {
    const h = harness(doc); h.api.capture(h.nb); h.api.reflow(h.nb);
    h.sc.clientHeight = 300; h.api.reflow(h.nb); assert.equal(h.top(), 1700);
  });
}
test('Incognito keeps the reader’s place on repaint; only opening and his send go to the bottom', () => {
  const src = readFileSync(new URL('../web/core/incognito-chat.js', import.meta.url), 'utf8');
  assert.match(src, /box\.scrollTop = keep == null \? box\.scrollHeight : keep/);
  assert.match(src, /s\.messages\.push\(\{ role: 'user', text \}\); s\.toBottom = true; paint\(wid\)/);
});
