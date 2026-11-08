import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
// James, 7 Nov 2026: the open list reads oldest reply first, newest last, never grouped by status; anything still
// working waits at the bottom. The first row goes to the oldest open reply and the rest follow down the chat.
const source = readFileSync(new URL('../web/core/thread-tracker.js', import.meta.url), 'utf8');
const model = readFileSync(new URL('../web/core/chats-list-model.js', import.meta.url), 'utf8');
async function fixture(items, { status = 'completed', agent = '' } = {}) {
  const row = { status };
  const doc = { documentElement: { dataset: { tweaks: 'wizard/thread-tracker' } }, addEventListener() {}, querySelectorAll() { return []; } };
  const win = { addEventListener() {}, dispatchEvent() {}, WizLive: { session: () => row, sessionFor: () => row, onChange() {} } };
  const ctx = vm.createContext({ window: win, document: doc, setInterval() {}, setTimeout() {}, CustomEvent: class {}, fetch: async () => ({ ok: true, json: async () => ({ items }) }) });
  vm.runInContext(model, ctx); win.WizChatsListModel = ctx.WizChatsListModel;
  vm.runInContext(source, ctx); const T = win.WosThreadTracker;
  await T.load('t', agent);
  const strip = { dataset: { ttStrip: 't', ttAgent: agent } };
  const tap = attr => ({ target: { closest: sel => sel === '[data-tt-strip]' ? strip : sel === `[${attr}]` ? {} : null } });
  T.click(tap('data-tt-toggle'), { sid: 't', agent });
  return { T, row, doc, tap };
}
const order = html => [...html.matchAll(/data-tt-row="([^"]+)"/g)].map(m => m[1]);
const listOrder = html => order(html.split('tt-ackg')[0]);
// The box lists newest change first; updated_at moves on every state edit, so it must never order the list.
const it = (id, state, at, extra = {}) => ({ id, title: id, state, message_id: String(at), at, created_at: at, updated_at: 9000 - at, seen_at: 0, seen: false, ...extra });

for (const agent of ['', 'profile']) {
  test(`mixed statuses render oldest reply first, not by status: ${agent || 'main'}`, async () => {
    const items = [it('red', 'blocked', 400), it('amber', 'needs_you', 300), it('stopped', 'running', 200), it('green', 'done', 100)];
    const { T } = await fixture(items, { agent });
    const html = T.stripHtml('t', agent);
    assert.deepEqual(listOrder(html), ['green', 'stopped', 'amber', 'red']);
    assert.doesNotMatch(html, /tt-gh|Your move|Finished · not seen/, 'no status sections');
    assert.match(html, /data-tt-row="stopped"[^]*?tt-dot stopped/, 'each row keeps its own status');
    assert.match(html, /data-tt-resume-all/, 'header Resume unchanged');
    assert.match(html, /<span class="tt-tot">4 open<\/span>/);
  });
  test(`rows genuinely running sit at the bottom, themselves oldest first: ${agent || 'main'}`, async () => {
    const items = [it('amber', 'needs_you', 300), it('job-new', 'running', 250), it('green', 'done', 100), it('job-old', 'running', 50)];
    const { T } = await fixture(items, { agent, status: 'running' });
    assert.deepEqual(listOrder(T.stripHtml('t', agent)), ['green', 'amber', 'job-old', 'job-new']);
  });
}
test('a reply with several asks sits at its reply time; without times the chat order of message ids decides', async () => {
  const items = [it('late', 'needs_you', 500), it('a', 'done', 150, { message_id: '150' }), it('b', 'needs_you', 150, { message_id: '150' }), it('early', 'blocked', 120)];
  assert.deepEqual(listOrder((await fixture(items)).T.stripHtml('t', '')), ['early', 'b', 'late']);
  const untimed = [it('m30', 'needs_you', 30), it('m9', 'done', 9), it('m12', 'blocked', 12)].map(({ at, ...i }) => i);
  assert.deepEqual(listOrder((await fixture(untimed)).T.stripHtml('t', '')), ['m9', 'm12', 'm30']);
});
test('acknowledged fold stays last and is chronological too', async () => {
  const items = [it('ack-new', 'done', 700, { seen_at: 9999, seen: true }), it('amber', 'needs_you', 600), it('ack-old', 'done', 10, { seen_at: 9999, seen: true })];
  const { T, tap } = await fixture(items);
  T.click(tap('data-tt-ack'), { sid: 't', agent: '' });
  const html = T.stripHtml('t', '');
  assert.deepEqual(order(html), ['amber', 'ack-old', 'ack-new']);
  assert.ok(html.indexOf('tt-ackg') > html.indexOf('data-tt-row="amber"'));
});
test('tweak off: nothing renders', async () => {
  const { T, doc } = await fixture([it('amber', 'needs_you', 1)]);
  doc.documentElement.dataset.tweaks = '';
  assert.equal(T.stripHtml('t', ''), '');
});
