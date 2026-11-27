// James, 8 Nov 2026: Snooze on the open chat lands exactly where Archive does (desktop: next chat in the drawn list,
// phone: the chats list), under either After-actions setting, through the same leaveFinishedThread helper. A thread opened
// from a link in another thread steps back to that thread on both, like Archive (issue 1902).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { withParts } from './fixtures/chats-parts.mjs';
import { boomerang, openSheet } from './fixtures/s2-boom-picker.mjs';
const src = withParts(readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8'));
const rem = readFileSync(new URL('../web/core/scheduled-reminders.js', import.meta.url), 'utf8');
const slice = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return src.slice(i, j); };
function fixture({ desktop, after = 'stay', ids = ['a', 'b', 'c'], open = 'b', trail = [] }) {
  const w = { id: 'qa', thread: open }, c = { trail, archiveOrder: ids }, toasts = [], listeners = {}, opened = [];
  const rows = new Map([...ids, 'parent'].map(id => [id, { id, title: id }]));
  const section = {}, dom = ids.map(id => ({ dataset: { chopen: id }, closest: () => section }));
  const no = () => {};
  const ctx = vm.createContext({
    W: { qa: w }, CH: { qa: c }, ch: () => c, H: { keepThreadOpen: desktop, changed: no, threadShown: no }, INC: null,
    window: { WizCore: {}, WizConfig: { chatAfterAction: () => after }, WosSkinHost: { chatArchiveOrder: () => null, action: () => false }, addEventListener: (n, f) => { listeners[n] = f; } },
    PHONE: () => !desktop, rowOf: (_, id) => rows.get(id), toast: (...x) => toasts.push(x), snoozeLast: () => false,
    elOf: id => id.endsWith('::list') ? null : ({ querySelectorAll: () => dom }), saveDraft: no, save: no, applyLayout: no, deskOf: x => x, closeHosted: () => false,
    LIVE: { session: id => rows.get(id) }, renderChats: no, closeSwipe: no,
  });
  vm.runInContext(slice('  const keepThreadOpen =', '  // A scheduled Snooze was set'), ctx);
  vm.runInContext(slice('  function archiveListOrder(', '  // Repaint every chats list'), ctx);
  // Real openChat/chatsBack are slices of the same file; record the destination instead of rendering.
  ctx.openChat = (_wid, sid) => { opened.push(sid); w.thread = sid; };
  ctx.chatsBack = x => { x.thread = null; c.trail = []; };
  ctx.threadBack = x => { const up = c.trail.pop(); opened.push('back:' + up); x.thread = up; };
  return { w, c, toasts, listeners, opened, fire: (n, detail) => listeners[n]({ detail }) };
}
for (const after of ['stay', 'list']) for (const desktop of [true, false]) for (const ev of ['wos:snooze-chosen', 'wos:boomerang-set', 'wos:snooze-someday']) {
  test(`${desktop ? 'desktop' : 'phone'} ${ev} (after=${after}) lands like Archive`, () => {
    const f = fixture({ desktop, after }); f.fire(ev, { session: 'b', label: 'Back tomorrow' });
    if (desktop) { assert.equal(f.w.thread, 'c', 'next chat, as Archive'); assert.deepEqual(f.opened, ['c']); }
    else { assert.equal(f.w.thread, null, 'chats list, as Archive'); assert.deepEqual(f.opened, []); }
    const linked = fixture({ desktop, after, trail: ['parent'] }); linked.fire(ev, { session: 'b', label: 'Back tomorrow' });
    assert.equal(linked.w.thread, 'parent', 'opened from a link in parent: back to parent, as Archive'); assert.deepEqual(linked.opened, ['back:parent']);
  });
}
test('desktop last chat steps to the one above; only chat goes to the list; other threads untouched', () => {
  const last = fixture({ desktop: true, open: 'c' }); last.fire('wos:snooze-chosen', { session: 'c' }); assert.equal(last.w.thread, 'b');
  const one = fixture({ desktop: true, ids: ['b'] }); one.fire('wos:snooze-chosen', { session: 'b' }); assert.equal(one.w.thread, null);
  const other = fixture({ desktop: false }); other.fire('wos:snooze-chosen', { session: 'a' }); assert.equal(other.w.thread, 'b');
});
test('commit events fire once and later events do not move the user again; quiet someday does not navigate', () => {
  const f = fixture({ desktop: true }); f.fire('wos:snooze-chosen', { session: 'b' }); f.fire('wos:boomerang-set', { session: 'b', label: 'x' }); f.fire('wos:snooze-someday', { session: 'b' });
  assert.equal(f.w.thread, 'c'); assert.deepEqual(f.opened, ['c']);
  const q = fixture({ desktop: false }); q.fire('wos:snooze-someday', { session: 'b', quiet: true }); assert.equal(q.w.thread, 'b');
});
test('the picker announces the commit before any request returns (paint first)', async () => {
  const calls = [], events = [];
  const ctx = vm.createContext({ window: { dispatchEvent: e => events.push(e.type) }, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail; } } });
  const body = rem.slice(rem.indexOf('const chosen='), rem.indexOf('\n', rem.indexOf('const chosen=')));
  vm.runInContext(body + ';this.chosen=chosen', ctx); ctx.chosen('s1');
  assert.deepEqual(events, ['wos:snooze-chosen']);
  // the whole picker (tests/fixtures/s2-boom-picker.mjs): Someday announces before its Defer answers
  const never = () => new Promise(() => {});
  const lazy = boomerang({ WizLive: { defer: never, session: id => ({ id }) } });
  void lazy.B.someday({ sessionId: 's1' }); // (no await: what it did before its first await)
  assert.deepEqual(lazy.events, ['wos:snooze-chosen'], 'Someday announces before its first await');
  // a timed Snooze announces before its request returns
  const posts = [], timed = boomerang({ WizLive: { defer: never, session: id => ({ id }) },
    fetch: (url, init = {}) => init.method === 'POST' ? (posts.push(url), never()) : Promise.resolve({ ok: true, status: 200, json: async () => ({ schedules: [] }) }) });
  const { form } = openSheet(timed, { sessionId: 's1', title: 'Quote' });
  form.querySelector('[name="timezone"]').value = 'Asia/Bangkok'; form.querySelector('[name="date"]').value = '2099-01-02'; form.querySelector('[name="time"]').value = '09:00';
  void form.onsubmit({ preventDefault() {} });
  assert.equal(posts.length, 1, 'its request is out'); assert.deepEqual(timed.events, ['wos:snooze-chosen'], 'timed Snooze announces before its request');
});
