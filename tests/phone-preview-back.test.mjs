import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
function harness() {
  const w = { id: 'chat', thread: 'child' }, c = { trail: ['parent'], readNav: 0 }, calls = [];
  const ctx = { W: { chat: w }, ch: () => c, LIVE: { session: id => ({ id }), markSeen() {} }, H: { threadShown() {} },
    closeHosted: () => false, saveDraft() {}, closeRowSheet() {}, save() {}, loadDraft() {}, PW: null,
    renderChats: x => calls.push(['render', x.id, x.thread]), applyLayout: () => calls.push(['layout']), deskOf: () => 'desk' };
  vm.createContext(ctx);
  vm.runInContext(source.slice(source.indexOf('  function openChat('), source.indexOf('  /* Send steps back one level')), ctx);
  return { ctx, w, c, calls };
}
test('nested thread Back returns to its parent inside the same app, then root Back shows its list', () => {
  const { ctx, w, c, calls } = harness();
  assert.equal(ctx.threadBack(w), 'trail'); assert.equal(w.thread, 'parent'); assert.equal(c.trail.length, 0);
  assert.equal(ctx.W.chat, w); assert.deepEqual(calls[0], ['render', 'chat', 'parent']);
  assert.equal(ctx.threadBack(w), 'thread'); assert.equal(w.thread, null); assert.equal(ctx.W.chat, w);
  assert.ok(calls.some(x => x[0] === 'render' && x[2] === null));
});
test('missing nested parent falls back to in-app list, never browser history or Home', () => {
  const { ctx, w } = harness(); ctx.LIVE.session = () => null;
  assert.equal(ctx.threadBack(w), 'thread'); assert.equal(w.thread, null); assert.equal(ctx.W.chat, w);
});
test('phone preview has an explicit in-app Back but no custom left-edge navigation interception', () => {
  assert.match(source, /class="ch-back2" data-chback/);
  assert.doesNotMatch(source, /clientX > 40|swipe right from the left edge|dx > 70 && dy < 50/);
});
