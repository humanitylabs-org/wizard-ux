import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../web/core/chat-power.js', import.meta.url), 'utf8');
function harness(doc = false) {
  const state = { lid: 'reply', posFor: 'thread', show: 120 }, w = { id: 'win', thread: 'thread' }, storage = {}, hooks = {};
  let shown = true, top = 400, writes = 0;
  const sc = { scrollHeight: 2000, clientHeight: 500, get scrollTop() { return top; }, set scrollTop(n) { writes++; top = n; } };
  const host = { dataset: { chats: 'win' }, querySelector: () => ({ hidden: true }) };
  const row = { dataset: { morphKey: 'row' }, getBoundingClientRect: () => ({ top: 440 - top, height: 150 }) };
  const nb = { ...(!doc ? sc : {}), isConnected: true, querySelectorAll: () => [row], closest: s => s === '[data-chats]' ? host : { querySelector: () => ({ getBoundingClientRect: () => ({ bottom: 100 }) }) }, getBoundingClientRect: () => ({ top: 100 }) };
  if (!doc) Object.defineProperty(nb, 'scrollTop', { get: () => sc.scrollTop, set: n => { sc.scrollTop = n; } });
  const ctx = { console, Date, setTimeout: () => 1, clearTimeout() {}, addEventListener: (n, f) => { hooks[n] = f; }, document: { addEventListener() {} }, localStorage: { getItem: k => storage[k], setItem: (k, v) => { storage[k] = v; } }, WizCore: { esc: String }, WosModels: {}, WizLive: { session: () => ({ status: 'completed' }) } };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(source, ctx);
  const api = ctx.WosChatPower({ ch: () => state, CH: { win: state }, H: { win: () => w }, threadOnScreen: () => shown, scrollBox: () => doc ? sc : nb, isWorking: () => false });
  return { api, nb, sc, hooks, storage, row, setShown: b => { shown = b; }, writes: () => writes };
}
test('other tabs merge newest places without discarding an unflushed local scroll', () => {
  const h = harness(), key = 'wizard.mobile.reading-positions.v1'; h.api.capture(h.nb);
  const own = h.api.RP.read('thread'), remote = { ...own, sessionId: 'other-thread', savedAt: own.savedAt + 1 };
  h.storage[key] = JSON.stringify({ 'other-thread': remote }); h.hooks.pagehide();
  const flushed = JSON.parse(h.storage[key]); assert.equal(flushed.thread.anchor.key, 'row'); assert.equal(flushed['other-thread'].sessionId, 'other-thread');
  h.hooks.storage({ key, newValue: JSON.stringify({ thread: { ...own, scrollTop: 123, savedAt: own.savedAt + 2 } }) });
  assert.equal(h.api.RP.read('thread').scrollTop, 123);
});
for (const doc of [false, true]) {
  test(`one synchronous eye-line place, hidden scroll ignored, lifecycle flushed (${doc ? 'document' : 'box'})`, () => {
    const h = harness(doc); h.api.capture(h.nb);
    const saved = h.api.RP.read('thread'); assert.equal(saved.anchor.key, 'row'); assert.equal(saved.anchor.off, -60); assert.equal(saved.atBottom, false);
    h.setShown(false); h.sc.scrollTop = 0; h.api.capture(h.nb); assert.equal(h.api.RP.read('thread'), saved);
    h.hooks.pagehide(); assert.equal(JSON.parse(Object.values(h.storage)[0]).thread.anchor.key, 'row');
  });
  test(`one restore anchors rows and never reassigns unchanged scrollTop (${doc ? 'document' : 'box'})`, () => {
    const h = harness(doc); h.api.capture(h.nb); const saved = h.api.RP.read('thread'), writes = h.writes();
    h.api.restore(h.nb, saved); assert.equal(h.writes(), writes);
    h.sc.scrollTop = 600; h.api.restore(h.nb, saved); assert.equal(h.sc.scrollTop, 400);
    h.api.restore(h.nb, { atBottom: true }); assert.equal(h.sc.scrollTop, 1500);
    const pinnedWrites = h.writes(); h.api.restore(h.nb, { atBottom: true }); assert.equal(h.writes(), pinnedWrites);
    h.setShown(false); assert.equal(h.api.restore(h.nb, saved), false); assert.equal(h.writes(), pinnedWrites);
  });
  test(`previous-version latest-reply record still restores (${doc ? 'document' : 'box'})`, () => {
    const h = harness(doc); h.api.restore(h.nb, { anchorOffset: -40, scrollTop: 123 }); assert.equal(h.sc.scrollTop, 380);
  });
}
