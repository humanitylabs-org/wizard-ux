// wizard-ux issue 1653 (James, 20 Nov 2026): in the Daily view he taps a link to another thread and goes Back. Back used
// to reopen that day's thread as a plain thread (the Daily view and its earlier days were gone), so the page he came back
// to was not the page he left. The link trail now keeps, per entry, whether the thread was shown in the Daily view.
// Real chats.js openChat / threadBack / Daily claim in a vm; browser proof: tests/qa-thread-link-back.cjs (QA_KINDS=daily).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { withParts } from './fixtures/chats-parts.mjs'; // chats.js parts moved out verbatim (issue 1665)
const core = withParts(readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8'));
function cut(from, to) { const a = core.indexOf(from), b = core.indexOf(to, a); assert(a >= 0 && b > a, from); return core.slice(a, b); }
function fixture() {
  const w = { id: 'win', thread: null }, c = { readNav: 0, trail: [] }, opened = [];
  const store = { channels: [{ id: 'daily', kind: 'daily', agent: 'hermes', archived: false }] };
  const ctx = {
    clearTimeout() {}, window: { WizCore: {} }, W: { win: w }, INC: null, H: {}, CH: { win: c }, KIT: { drafts: { get: () => ({}), set() {}, clear() {} } },
    ch: () => c, elOf: () => null, listPlace: () => null, archiveListOrder: () => null, saveDraft() {}, closeRowSheet() {}, save() {},
    loadDraft() {}, renderChats() {}, applyLayout() {}, deskOf: () => 0, closeHosted: () => false, hasContent: () => false, draftKey: () => '',
    channelsOn: () => true, chanStore: () => store, localStorage: { getItem: () => null, setItem() {} },
    LIVE: { session: id => ({ id }), markSeen() {}, chanDaily: { state: () => ({ days: [] }) } },
    PW: { opened: (wid, sid, back) => opened.push({ sid, back }) },
  };
  vm.createContext(ctx);
  vm.runInContext(cut('  const dailyChan = id =>', '  // A tap on Daily'), ctx);
  vm.runInContext(cut('  function dailyClaim(', "  // sendChat's hook"), ctx);
  vm.runInContext(cut('  function openChat(', '  /* Unified Chats'), ctx);
  vm.runInContext(cut('  function chatsBack(', '  /* Opt-in Send and go'), ctx);
  // A Daily tap: the open that takes the Daily view (openDaily sets dailyNext, then opens the day's thread).
  const daily = sid => { vm.runInContext(`dailyNext = { sid: ${JSON.stringify(sid)}, daily: { id: 'daily', agent: 'hermes' }, at: Date.now() };`, ctx); ctx.openChat('win', sid); };
  const link = sid => ctx.openChat('win', sid, { via: 'link' });
  const back = () => ctx.threadBack(w);
  const inDaily = () => !!w.daily && w.daily.sid === w.thread;
  return { w, c, daily, link, back, inDaily, opened };
}
test('Back from a thread opened from the Daily view returns to the Daily view, as a step back', () => {
  const f = fixture();
  f.daily('day-1'); assert.ok(f.inDaily(), 'the Daily tap shows the Daily view');
  f.link('child'); assert.equal(f.w.thread, 'child'); assert.ok(!f.inDaily(), 'the linked thread is a plain thread');
  assert.equal(f.back(), 'trail');
  assert.equal(f.w.thread, 'day-1');
  assert.ok(f.inDaily(), 'Back brings the Daily view back (the same earlier days above, so the same place)');
  assert.deepEqual({ ...f.opened.at(-1) }, { sid: 'day-1', back: true }, 'the reading place is told this open is a Back');
});
test('a plain thread on the trail stays plain on Back', () => {
  const f = fixture();
  f.link('a'); f.w.thread = 'a'; f.c.trail = [];
  f.link('b'); assert.equal(f.back(), 'trail');
  assert.equal(f.w.thread, 'a'); assert.ok(!f.inDaily());
});
test('the Daily mark belongs to its trail entry, not to the thread id (Daily A → B → plain A → C, then Back x3)', () => {
  const f = fixture();
  f.daily('day-1'); f.link('b'); f.link('day-1'); assert.ok(!f.inDaily(), 'day-1 opened from a link is plain');
  f.link('c');
  f.back(); assert.equal(f.w.thread, 'day-1'); assert.ok(!f.inDaily(), 'first Back: the plain day-1 it left');
  f.back(); assert.equal(f.w.thread, 'b');
  f.back(); assert.equal(f.w.thread, 'day-1'); assert.ok(f.inDaily(), 'last Back: the Daily view it started from');
});
