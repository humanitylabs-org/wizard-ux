// James (8 Nov 2026): a streaming or updating reply must never pull the thread down to the bottom while he reads.
// Growth below keeps his place and shows ↓ Latest; his own send shows his message once; layout-only changes
// (keyboard, composer) keep a bottom place at the bottom.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../web/core/chat-power.js', import.meta.url), 'utf8');
function harness(doc = false) {
  const state = { lid: 'reply', posFor: 'thread', show: 120 }, w = { id: 'win', thread: 'thread' }, latest = { hidden: true };
  let top = 1500, height = 2000, now = 10_000;
  const sc = { get scrollHeight() { return height; }, clientHeight: 500, get scrollTop() { return top; }, set scrollTop(n) { top = n; } };
  const host = { dataset: { chats: 'win' }, querySelector: s => s === '[data-chlatest]' ? latest : null };
  const row = { dataset: { morphKey: 'row' }, getBoundingClientRect: () => ({ top: 1700 - top, height: 150 }) };
  const first = { getBoundingClientRect: () => ({ top: 100 - top }) }, last = { getBoundingClientRect: () => ({ bottom: 100 - top + height }) };
  const nb = { isConnected: true, firstElementChild: first, lastElementChild: last, querySelectorAll: () => [row],
    closest: s => s === '[data-incog-thread]' ? null : s === '[data-chats]' ? host : { querySelector: () => ({ getBoundingClientRect: () => ({ bottom: 100 }) }) },
    getBoundingClientRect: () => ({ top: 100 }) };
  if (!doc) Object.defineProperties(nb, { scrollTop: { get: () => sc.scrollTop, set: n => { sc.scrollTop = n; } }, scrollHeight: { get: () => sc.scrollHeight }, clientHeight: { get: () => sc.clientHeight } });
  const ctx = { console, Date: { now: () => now }, setTimeout: () => 1, clearTimeout() {}, addEventListener() {}, document: { addEventListener() {} },
    localStorage: { getItem: () => null, setItem() {} }, WizCore: { esc: String }, WosModels: {}, WizLive: { session: () => ({ status: 'running' }) } };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(source, ctx);
  const api = ctx.WosChatPower({ ch: () => state, CH: { win: state }, H: { win: () => w }, threadOnScreen: () => true, scrollBox: () => doc ? sc : nb,
    isWorking: () => true, elOf: () => ({ querySelector: () => nb }) });
  return { api, nb, sc, latest, state, top: () => top, grow: n => { height += n; }, tick: ms => { now += ms; } };
}
for (const doc of [false, true]) {
  const mode = doc ? 'document' : 'box';
  test(`a reply growing below never moves a reader who was at the bottom; ↓ Latest appears (${mode})`, () => {
    const h = harness(doc); h.api.capture(h.nb); assert.equal(h.api.RP.read('thread').atBottom, true);
    h.api.reflow(h.nb);                       // first look records the content extent
    for (let i = 0; i < 6; i++) { h.grow(120); h.api.reflow(h.nb); assert.equal(h.top(), 1500, `growth ${i} moved the reader`); }
    assert.equal(h.latest.hidden, false, '↓ Latest shows new content below');
    assert.equal(h.api.RP.read('thread').atBottom, false, 'the saved place is now his reading spot, not the bottom');
  });
  test(`a reader scrolled up stays on the same words while the reply streams (${mode})`, () => {
    const h = harness(doc); h.sc.scrollTop = 900; h.api.capture(h.nb); h.api.reflow(h.nb);
    h.grow(400); h.api.reflow(h.nb); assert.equal(h.top(), 900);
  });
  test(`his own send shows his message once, then the reply streams in without pulling him (${mode})`, () => {
    const h = harness(doc); h.sc.scrollTop = 600; h.api.capture(h.nb); h.api.reflow(h.nb);
    h.grow(80); h.api.follow('win'); assert.equal(h.top(), 1580, 'send lands on his new message');
    h.grow(60); h.api.reflow(h.nb); assert.equal(h.top(), 1640, 'his message keeps painting into view');
    h.tick(2000); h.grow(500); h.api.reflow(h.nb); assert.equal(h.top(), 1640, 'the streaming reply does not yank');
    assert.equal(h.latest.hidden, false);
  });
  test(`the opening last-reply place does not drag the view when that reply grows (${mode})`, () => {
    const h = harness(doc); h.api.RP.save({ sessionId: 'thread', messageId: 'reply', anchor: { key: 'row', nth: 0, off: 8 }, atBottom: false, scrollTop: 0, savedAt: 1 });
    h.api.reflow(h.nb); const at = h.top();
    h.grow(300); h.api.reflow(h.nb); assert.equal(h.top(), at);
  });
  test(`↓ Latest jumps once without starting a follow (${mode})`, () => {
    const h = harness(doc); h.sc.scrollTop = 600; h.api.capture(h.nb); h.api.reflow(h.nb);
    h.api.follow('win', false); assert.equal(h.top(), 1500);
    h.grow(300); h.api.reflow(h.nb); assert.equal(h.top(), 1500);
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
