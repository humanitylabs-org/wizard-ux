// A reply into a hidden thread lists it at once (wizard-ux issue 1990; James, 27 Nov 2026: "When I reply to a thread in
// my inbox and it jumps back to my inbox screen, that card should immediately disappear from inbox"). A background task
// waiting on him is an Inbox row for its record while its worker thread is hidden; the box un-hides the thread on his
// turn, but the phone only saw it on the next list read (~3 s), so the task's row stayed in Inbox. The live.js outbox
// hold now lists the thread he replied in on the send itself (under Working like any reply), and hides it again when
// the send ends without the box listing it. Browser proof: tests/qa-inbox-reply-leaves.cjs (QA_KIND=record).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { runWithChatsModel } from './fixtures/chats-list-model.mjs';

const live = readFileSync(new URL('../web/live.js', import.meta.url), 'utf8');
const slice = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i > 0 && j > i, `${a} is in live.js`); return src.slice(i, j); };

function harness({ priv = '' } = {}) {
  const applied = [];
  const ctx = { PEND: new Map(), DETAIL: new Map(), applyPend: s => applied.push(s.id), Date };
  ctx.L = { agentInbox: { privateDefault: () => priv }, ownerOf: s => (s.agent && s.agent !== 'hermes' ? s.agent : '') };
  vm.createContext(ctx);
  vm.runInContext(slice(live, '  /* A reply into a hidden thread lists it at once', '  const commandId = ') + '\nthis.addSynthetic = addSynthetic;', ctx);
  return { ctx, applied };
}
const reply = key => ({ key, kind: 'reply', text: 'Book the 9:10 one', at: Date.now(), state: 'sending' });
const shown = list => list.filter(s => !s.hidden).map(s => s.id);

// owner-correction: humanitylabs-org/wizard-ux#1990 · 2026-11-27 · "When I reply to a thread in my inbox and it jumps back to my inbox screen, that card should immediately disappear from inbox. Don't make me wait three seconds before it disappears."
test('a reply into a hidden worker thread lists it on the send, under the hold', () => {
  const { ctx, applied } = harness();
  const worker = { id: 'qa-worker', title: 'Flight options', hidden: true };
  ctx.DETAIL.set(worker.id, worker);
  const list = [{ id: 'qa-other', title: 'Mac app' }];
  ctx.PEND.set('qa-worker', reply('tap:1'));
  ctx.addSynthetic(list, '');
  assert.deepEqual(shown(list), ['qa-worker', 'qa-other'], 'listed at once: the task row (not listed threads only) leaves Inbox');
  assert.equal(worker.hidden, false);
  assert.ok(applied.includes('qa-worker'), 'the outbox hold (Working) applies to it');
  // A stale list read that still leaves it out (the box has not un-hidden it yet) lists it again.
  const stale = [{ id: 'qa-other', title: 'Mac app' }];
  ctx.addSynthetic(stale, '');
  assert.deepEqual(shown(stale), ['qa-worker', 'qa-other'], 'a stale read never drops it while the send is held');
  // The thread was only in the list (a hidden row the shell held, never in the detail cache): a later read that leaves it
  // out still shows it while the send is held (the tester's stale box, issue 1990 round 2).
  const { ctx: c3 } = harness();
  const held = { id: 'qa-held', title: 'Dentist booking', hidden: true }, first = [held, { id: 'qa-other' }];
  c3.PEND.set('qa-held', reply('wos-3')); c3.addSynthetic(first, '');
  assert.deepEqual(shown(first), ['qa-held', 'qa-other']);
  const later = [{ id: 'qa-other' }]; c3.addSynthetic(later, '');
  assert.deepEqual(shown(later), ['qa-held', 'qa-other'], 'not in the detail cache: still listed from the row the hold showed');
  c3.PEND.delete('qa-held'); const after = [{ id: 'qa-other' }]; c3.addSynthetic(after, '');
  assert.deepEqual(shown(after), ['qa-other'], 'once the hold ends it is not put back');
  assert.equal(held.hidden, true);
  // A stale read listing it hidden: shown while held.
  const hiddenRow = { id: 'qa-worker', title: 'Flight options', hidden: true };
  const stale2 = [hiddenRow];
  ctx.addSynthetic(stale2, '');
  assert.deepEqual(shown(stale2), ['qa-worker']);
});

test('a send that ends without the box listing it hides the thread again (its task row comes back)', () => {
  const { ctx } = harness();
  const worker = { id: 'qa-worker', hidden: true };
  ctx.DETAIL.set(worker.id, worker);
  const list = [];
  ctx.PEND.set('qa-worker', reply('wos-1'));
  ctx.addSynthetic(list, '');
  assert.deepEqual(shown(list), ['qa-worker']);
  ctx.PEND.delete('qa-worker'); // refused / withdrawn / released
  ctx.addSynthetic(list, '');
  assert.deepEqual(shown(list), [], 'no longer shown in the list');
  assert.equal(worker.hidden, true, 'hidden again, as the box has it');
  ctx.addSynthetic([], ''); assert.equal(worker.hidden, true, 'and a later read does not show it again');
  // A box row the hold had un-hidden stays in its list, hidden again.
  const row = { id: 'qa-worker', hidden: true }, l2 = [row];
  ctx.PEND.set('qa-worker', reply('wos-2')); ctx.addSynthetic(l2, '');
  assert.equal(row.hidden, false);
  ctx.PEND.delete('qa-worker'); ctx.addSynthetic(l2, '');
  assert.deepEqual(l2.map(s => [s.id, s.hidden]), [['qa-worker', true]]);
});

test('only the agents the box un-hides: main and the private default; never new chats or visible threads', () => {
  const { ctx } = harness({ priv: 'private' });
  ctx.DETAIL.set('qa-routed', { id: 'qa-routed', agent: 'coder', hidden: true });
  ctx.DETAIL.set('qa-private', { id: 'qa-private', agent: 'private', hidden: true });
  ctx.PEND.set('qa-routed', { ...reply('a'), agent: 'coder' }); ctx.PEND.set('qa-private', { ...reply('b'), agent: 'private' }); // the hold names a routed agent
  const main = [], coder = [], mine = [];
  ctx.addSynthetic(main, ''); ctx.addSynthetic(coder, 'coder'); ctx.addSynthetic(mine, 'private');
  assert.deepEqual(main.map(s => s.id), [], 'another agent\'s thread is never put in the main list');
  assert.deepEqual(coder.map(s => s.id), [], 'a routed agent the box does not un-hide: left as it is');
  assert.deepEqual(mine.map(s => s.id), ['qa-private'], 'the private default agent: listed in its own list');
  // A visible thread already listed is left alone (nothing doubled).
  const { ctx: c2 } = harness();
  const row = { id: 'qa-seen', title: 'Seen' }; c2.PEND.set('qa-seen', reply('c'));
  const l = [row]; c2.addSynthetic(l, '');
  assert.deepEqual(l.map(s => s.id), ['qa-seen']); assert.equal(row.sendShown, undefined);
});

// A voice reply (an orb take) is held in Working from the tap; its outbox item was made when the recording started, before
// the tap, so the tap's hold never handed over to it and lasted its full minute: an answer that needed him stayed in
// Working instead of coming back to Inbox. The take's item takes over once it is asked to deliver.
test('an orb take made before the tap takes over the hold once it is asked to deliver', () => {
  const live = readFileSync(new URL('../web/live.js', import.meta.url), 'utf8');
  const now = 1_800_000_000_000, tapAt = now - 1000;
  const L = { sessions: [{ id: 'qa-voice', title: 'Dentist', status: 'completed', runtime: 'direct' }], agentSessions: {}, ownerOf: () => '' };
  const c = { L, WORKING: new Set(['submitting', 'queued', 'running', 'stopping']), otherAgent: a => !!a && a !== 'hermes', AGENT_OF: new Map(), DETAIL: new Map(),
    Date: class extends Date { static now() { return now; } }, WizReach: { restart: () => null } };
  runWithChatsModel(slice(live, '  const PEND = new Map()', '  const commandId =') + '\nthis.api = { syncPending, TAPS, PEND };', c);
  c.api.TAPS.set('qa-voice', { sid: 'qa-voice', at: tapAt, until: tapAt + 60e3 });
  const take = { id: 'wos-take', kind: 'reply', sessionId: 'qa-voice', createdAt: tapAt - 8000, state: 'transcribing', text: '' };
  const OB = { _items: new Map([['wos-take', take]]) };
  c.api.syncPending(OB);
  assert.equal(c.api.PEND.get('qa-voice').key, 'tap:' + tapAt, 'still the tap while the take is only being recorded / transcribed');
  Object.assign(take, { deliveryRequested: true, state: 'queued', text: 'Book Tuesday' });
  c.api.syncPending(OB);
  assert.equal(c.api.TAPS.has('qa-voice'), false, 'the tap hands over');
  assert.equal(c.api.PEND.get('qa-voice').key, 'wos-take', 'the take holds the thread now, so the box\'s finished run releases it');
  assert.equal(L.sessions[0].status, 'submitting', 'still in Working while it is sent');
});
