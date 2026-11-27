// owner-correction: humanitylabs-org/wizard-ux#1902 · 2026-11-26 · "when I'm in a thread and I click a link to another thread and then I hit the archive button it should go back to the thread I clicked the link from, not my inbox."
// Archive and Snooze on a thread opened from a link in another thread step back to that thread, one level, the same place
// Back goes. With no link trail they keep today's landing: phone → chats list, desktop → next chat in the drawn list.
// The real leaveFinishedThread, threadBack and archiveAdvance (chats.js), the Archive row action's landing line
// (chats-rowacts.js) and the Snooze landing (chats-events.js) run here; openChat/chatsBack record where the window went.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { withParts } from './fixtures/chats-parts.mjs';
import { between } from './fixtures/source-slice.mjs';
const src = withParts(readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8'));
const acts = readFileSync(new URL('../web/core/chats-rowacts.js', import.meta.url), 'utf8');

function shell({ phone, trail = [], open = 'b', ids = ['a', 'b', 'c'], gone = [] }) {
  const w = { id: 'qa', thread: open }, c = { trail: [...trail], trailDaily: trail.map(() => null), archiveOrder: ids }, listeners = {}, went = [];
  const rows = new Map([...ids, ...trail].filter(id => !gone.includes(id)).map(id => [id, { id, title: id }]));
  const section = {}, dom = ids.map(id => ({ dataset: { chopen: id }, closest: () => section }));
  const no = () => {};
  const ctx = vm.createContext({
    W: { qa: w }, CH: { qa: c }, ch: () => c, H: { keepThreadOpen: !phone, changed: no, threadShown: no }, INC: null,
    window: { WizCore: {}, WizConfig: { chatAfterAction: () => 'stay' }, WosSkinHost: { chatArchiveOrder: () => null, action: () => false }, addEventListener: (n, f) => { listeners[n] = f; } },
    PHONE: () => phone, rowOf: (_, id) => rows.get(id), toast: no, snoozeLast: () => false, keepThreadOpen: () => !phone,
    elOf: id => id.endsWith('::list') ? null : ({ querySelectorAll: () => dom }), saveDraft: no, save: no, applyLayout: no, deskOf: x => x, closeHosted: () => false,
    LIVE: { session: id => rows.get(id) }, renderChats: no, closeSwipe: no,
  });
  vm.runInContext(between(src, '  const keepThreadOpen =', '  // A scheduled Snooze was set'), ctx);
  vm.runInContext(between(src, '  function archiveListOrder(', '  // Repaint every chats list'), ctx);
  vm.runInContext(between(src, '  function threadBack(w) {', '  /* Stop, Send and go'), ctx);
  ctx.openChat = (_wid, sid, o = {}) => { went.push(o.back ? 'back:' + sid : sid); if (!o.keepTrail) c.trail = []; w.thread = sid; };
  ctx.chatsBack = x => { went.push('list'); c.trail = []; x.thread = null; };
  vm.runInContext(`this.archive = sid => { const a = 'done', w = W.qa; ${between(acts, "    if (a === 'done' && w?.thread === sid) leaveFinishedThread(w, sid);", '    const msg = ')} };`, ctx);
  return { w, c, went, archive: sid => ctx.archive(sid), snooze: sid => listeners['wos:snooze-chosen']({ detail: { session: sid } }) };
}

for (const phone of [true, false]) for (const how of ['archive', 'snooze']) {
  const where = phone ? 'phone' : 'desktop';
  test(`${where} ${how} on a linked thread goes back to the thread whose link was tapped`, () => {
    const f = shell({ phone, trail: ['roundup'] });
    f[how]('b');
    assert.equal(f.w.thread, 'roundup', 'lands on the linking thread, not the list or the next chat');
    assert.deepEqual(f.went, ['back:roundup'], 'one step back, the way Back goes (reading position and draft restored by openChat back)');
  });
  test(`${where} ${how}: nested links step back one thread at a time`, () => {
    const f = shell({ phone, trail: ['roundup', 'a'], open: 'b' });
    f[how]('b'); assert.equal(f.w.thread, 'a', 'C → B');
    assert.deepEqual(f.c.trail, ['roundup'], 'the rest of the trail is kept');
    f[how]('a'); assert.equal(f.w.thread, 'roundup', 'B → A');
    assert.deepEqual(f.c.trail, []);
  });
  test(`${where} ${how} with no link trail keeps today's landing`, () => {
    const f = shell({ phone });
    f[how]('b');
    if (phone) { assert.equal(f.w.thread, null, 'phone: the chats list'); assert.deepEqual(f.went, ['list']); }
    else { assert.equal(f.w.thread, 'c', 'desktop: the next chat in the list'); assert.deepEqual(f.went, ['c']); }
  });
  test(`${where} ${how}: a linking thread that is gone falls back to today's landing`, () => {
    const f = shell({ phone, trail: ['roundup'], gone: ['roundup'] });
    f[how]('b');
    assert.equal(f.w.thread, phone ? null : 'c');
    assert.equal(f.c.trail.length, 0, 'the dead trail is dropped');
  });
}
test('archiving or snoozing a thread that is not open leaves the open one alone', () => {
  const f = shell({ phone: true, trail: ['roundup'] });
  f.archive('a'); f.snooze('a');
  assert.equal(f.w.thread, 'b'); assert.deepEqual(f.went, []);
});
