// wizard-ux issue 1997: inside a thread that is still working (its run going, or a helper finishing it) the owner can
// Snooze or Archive it, not only Stop it. Archive never cancels the run and says the thread comes back when it's done;
// an approval wait keeps its approval card as the only control. Runs the real thread actions
// (core/chats-threadacts.js), the real working predicates (core/chats-setup.js, core/chats-list-model.js) and the real
// Archive tap (core/chats-rowacts.js) for main, host-profile, container and restricted rows.
// Browser proof: qa/scripts/qa-archive-working-thread.cjs (phone 412 px and desktop).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = p => readFileSync(new URL('../web/' + p, import.meta.url), 'utf8');
const kinds = ['main', 'host-profile', 'container', 'restricted'];

function threadacts(archived = []) {
  const window = { WizCore: {} };
  const ctx = vm.createContext({ window, globalThis: window });
  ctx.globalThis = ctx; ctx.window = ctx; ctx.WizCore = {};
  vm.runInContext(read('core/chats-list-model.js'), ctx);
  // The shell's own run predicate, cut from chats-setup.js (WORKING_ST + isWorking).
  const setup = read('core/chats-setup.js');
  const i = setup.indexOf('  const WORKING_ST = '), j = setup.indexOf('\n', setup.indexOf('  const isWorking = ', i));
  assert.ok(i > 0 && j > i, 'working predicates found');
  vm.runInContext(`${setup.slice(i, j)}\nthis.WORKING_ST = WORKING_ST; this.isWorking = isWorking;`, ctx);
  vm.runInContext(read('core/chats-threadacts.js'), ctx);
  const LIVE = { busy: () => false, workGroups: rows => ({ archive: rows.filter(s => archived.includes(s.id)) }) };
  return ctx.WizCore.chatsParts.threadacts({ isWorking: ctx.isWorking, LIVE, WORKING_ST: ctx.WORKING_ST });
}
const row = (kind, extra) => ({ id: `t-${kind}`, title: `Task ${kind}`, agent: kind === 'main' ? '' : `qa-${kind}`, runtimeKind: kind, archived: false, ...extra });
const answered = [{ a: 'First part done.', media: [] }], none = [{ a: '', media: [] }];

test('a working thread offers Snooze and Archive, for main and every routed kind', () => {
  const T = threadacts();
  for (const kind of kinds) {
    for (const status of ['submitting', 'queued', 'running']) {
      assert.deepEqual([...T.threadActions(row(kind, { status, runId: 'r1' }), answered)], ['snooze', 'done'], `${kind} ${status}, answered`);
      assert.deepEqual([...T.threadActions(row(kind, { status, runId: 'r1' }), none)], ['snooze', 'done'], `${kind} ${status}, no answer yet`);
      assert.deepEqual([...T.threadActions(row(kind, { status, runId: 'r1' }), null)], ['snooze', 'done'], `${kind} ${status}, list row`);
    }
    // A helper still finishing it after the run itself ended, before any answer.
    const helper = row(kind, { status: 'completed', helperStatus: { phase: 'running', pending: 1 } });
    assert.deepEqual([...T.threadActions(helper, none)], ['snooze', 'done'], `${kind}: helper finishing`);
    // A durable follow-up on a working thread keeps its Stop watching beside them.
    assert.deepEqual([...T.threadActions(row(kind, { status: 'completed', helperStatus: { phase: 'running', pending: 1 }, followUp: { active: true, count: 1 } }), none)], ['snooze', 'stop_watch', 'done']);
  }
});

test('approval waits, quiet watcher checks and archived threads keep their own controls', () => {
  for (const kind of kinds) {
    assert.deepEqual([...threadacts().threadActions(row(kind, { status: 'waiting_for_approval', runId: 'r1' }), answered)], [], `${kind}: the approval card stays the only control`);
    assert.deepEqual([...threadacts().threadActions(row(kind, { status: 'unknown' }), answered)], [], `${kind}: unknown`);
    assert.deepEqual([...threadacts().threadActions(row(kind, { status: 'running', runId: 'r1', followUp: { active: true, count: 1 } }), answered)], ['stop_watch'], `${kind}: a watcher check`);
    const archived = row(kind, { status: 'running', runId: 'r1', archived: true });
    assert.deepEqual([...threadacts([archived.id]).threadActions(archived, answered)], ['restore', 'snooze'], `${kind}: archived while working`);
    assert.deepEqual([...threadacts().threadActions(row(kind, { status: 'completed' }), answered)], ['snooze', 'done'], `${kind}: settled, unchanged`);
  }
});

test('Archive on a working thread never stops it and says it comes back when it is done', async () => {
  const T = threadacts();
  for (const kind of kinds) {
    for (const [s, words] of [[row(kind, { status: 'running', runId: 'r1' }), 'Archived · comes back when it’s done'], [row(kind, { status: 'completed' }), 'Archived']]) {
      const log = [], window = { WizCore: {} };
      vm.runInNewContext(read('core/chats-rowacts.js'), { window });
      const W = { w1: { id: 'w1', thread: s.id } };
      const LIVE = { archive: id => (log.push('archive:' + id), Promise.resolve(true)), stop: () => log.push('stop'), cancel: () => log.push('cancel') };
      const part = window.WizCore.chatsParts.rowacts({ ACT: T.ACT, actRestore() {}, actUndo: null, BOOM: () => null, ch: () => ({}), CH: { w1: {} }, closeRowSheet() {},
        followUpActive: T.followUpActive, H: {}, keepThreadOpen: () => true, leaveFinishedThread: () => log.push('leave'), markDone() {}, notifAct() {}, openChannelSheet() {},
        openRowSheet() {}, LIVE, owner: w => w, paintListsNow() {}, rowOf: () => s, threadBack() {}, toast: (i, t) => log.push('toast:' + t), vib() {}, W, workingNow: T.workingNow });
      part.bindLate({ renderChats() {} });
      await part.threadAct('w1', s.id, 'done');
      assert.deepEqual(log, ['leave', 'toast:' + words, 'archive:' + s.id], `${kind} ${s.status}`);
    }
  }
});

test('a new chat archived seconds after sending stays archived while the box does not list it yet', async () => {
  // The real outbox hold (web/live.js, PEND .. commandId) and the real LIVE._archivedNew mark.
  const { runWithChatsModel } = await import('./fixtures/chats-list-model.mjs');
  const live = readFileSync(new URL('../web/live.js', import.meta.url), 'utf8');
  const start = live.indexOf('  const PEND = new Map()'), end = live.indexOf('  const commandId =', start);
  const mark = live.slice(live.indexOf('    _archivedNew(id, on) {'), live.indexOf('\n', live.indexOf('    _archivedNew(id, on) {')));
  for (const kind of kinds) {
    const agent = kind === 'main' ? '' : `qa-${kind}`;
    const L = { sessions: [], agentSessions: agent ? { [agent]: [] } : {} }, OB = { _items: new Map() };
    const c = { L, OB, WORKING: new Set(['submitting', 'queued', 'running', 'stopping']), otherAgent: a => !!a && a !== 'hermes', AGENT_OF: new Map(), Date };
    runWithChatsModel(`${live.slice(start, end)}\nthis.api = { syncPending, LIVE: { ${mark.trim().replace(/,$/, '')} } };`, c);
    const list = () => agent ? L.agentSessions[agent] : L.sessions;
    OB._items.set('send', { id: 'send', sessionId: 'fresh', kind: 'new', createdAt: Date.now(), state: 'sent', sentAt: Date.now(), runId: 'r1', text: 'Plan the launch week', agent });
    c.api.syncPending(OB);
    assert.equal(list()[0].synthetic, true, `${kind}: the stand-in row`);
    c.api.LIVE._archivedNew('fresh', true); // what LIVE.archive does for a stand-in row
    // A list read drops the stand-in rows and builds them again from the outbox hold.
    if (agent) L.agentSessions[agent] = []; else L.sessions = [];
    c.api.syncPending(OB);
    assert.equal(list()[0].archived, true, `${kind}: the rebuilt stand-in row stays archived`);
    // Once the box lists the chat, its own row (and its own archived flag) wins and the mark is dropped.
    if (agent) L.agentSessions[agent] = [{ id: 'fresh', status: 'running', archived: true }]; else L.sessions = [{ id: 'fresh', status: 'running', archived: true }];
    c.api.syncPending(OB);
    if (agent) L.agentSessions[agent] = []; else L.sessions = [];
    c.api.syncPending(OB);
    assert.notEqual(list()[0]?.archived, true, `${kind}: the mark ends once the box listed the chat`);
  }
});
