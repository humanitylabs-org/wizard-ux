// Archive in a background task's thread clears its Inbox row (wizard-ux issue 1928). The real agent inbox reader (cut
// out of live-channels.js) against a fake box with the box's own archive / snooze rules, and the real
// chats-inboxrows.js part deciding which waiting records the Inbox draws. Browser proof: tests/qa-inbox-archive-record.cjs.
// Run: node --test tests/inbox-archive-record.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { modelContext } from './fixtures/chats-list-model.mjs';
import { withLiveParts } from './fixtures/live-parts.mjs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const J = v => JSON.parse(JSON.stringify(v));
const M = modelContext({}).WizChatsListModel;
const RID = c => 'inbox_' + c.repeat(24);
const tick = () => new Promise(r => setTimeout(r, 0));

const live = withLiveParts(read('web/live.js'));
const slice = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); assert.ok(i > 0 && j > i, a); return src.slice(i, j); };
function reader(records) {
  const calls = [], ctx = {}; vm.createContext(ctx);
  vm.runInContext(slice(live, '  /* ---- agent inbox (wizard-ux issue 1569)', '/* ---- end agent inbox ---- */') + '\nthis.agentInbox = agentInbox;', ctx);
  const req = async (path, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path, method: init.method || 'GET', body });
    if ((init.method || 'GET') === 'PATCH') {
      // wizard-agent-service server/agent-inbox.mjs patch(): archive → archived, snooze → back to new.
      const r = records.find(x => x.id === path.split('/').pop());
      if (body.action === 'archive') r.state = 'archived'; else if (body.action === 'snooze') r.state = 'new';
      return { json: async () => ({ record: r }) };
    }
    return { json: async () => ({ records: records.filter(r => r.state === 'new'), check: null, stay: [] }) };
  };
  return { inbox: ctx.agentInbox({ req, emit: () => {} }), calls };
}
const box = () => [
  { id: RID('1'), kind: 'needs_you', state: 'new', agent: 'hermes', thread_id: 'bg1', title: 'Fix archive navigation', last_update: 'Which way?', updated_at: 2000 },
  { id: RID('2'), kind: 'needs_you', state: 'new', agent: 'hermes', thread_id: 'bg2', title: 'Order ink', last_update: 'Black only?', updated_at: 1000 },
];

test('archiving a thread archives its waiting record; Undo (restore) sets it back to waiting', async () => {
  const records = box(), { inbox, calls } = reader(records);
  await inbox.readNeeds();
  const job = inbox.archiveThread('bg1');
  assert.deepEqual(J(inbox.needs('hermes').map(r => r.thread)), ['bg2'], 'gone on the tap frame');
  await job;
  assert.ok(calls.some(c => c.method === 'PATCH' && c.path === `/wizard/v1/agent-inbox/${RID('1')}` && c.body.action === 'archive'), 'the record archive went to the box');
  assert.equal(records[0].state, 'archived');
  const back = inbox.restoreThread('bg1');
  await tick();
  assert.deepEqual(J(inbox.needs('hermes').map(r => r.thread)), ['bg1', 'bg2'], 'back at once');
  await back; await tick();
  assert.ok(calls.some(c => c.method === 'PATCH' && c.path === `/wizard/v1/agent-inbox/${RID('1')}` && c.body.action === 'snooze'), 'the box puts it back to new');
  assert.equal(records[0].state, 'new');
  assert.deepEqual(J(await inbox.restoreThread('bg1')), [], 'a second restore does nothing');
});

test('a thread with no waiting record (or a restore with no archive here) writes nothing', async () => {
  const { inbox, calls } = reader(box());
  await inbox.readNeeds();
  const before = calls.length;
  assert.deepEqual(J(await inbox.archiveThread('other')), []);
  assert.deepEqual(J(await inbox.restoreThread('bg2')), []);
  assert.equal(calls.length, before);
});

function part({ tweaks = '', records, threads = {}, peek, extra = {} }) {
  const ctx = vm.createContext({ console, Date, Promise, String, Number, Set, Map, Array, Object, JSON, setTimeout });
  ctx.window = ctx; ctx.globalThis = ctx;
  ctx.document = { documentElement: { dataset: { tweaks } } };
  ctx.WizChatsListModel = M; ctx.WizCore = { chatsParts: {} };
  vm.runInContext(read('web/core/chats-inboxrows.js'), ctx);
  let emits = 0;
  const LIVE = { quietReply: () => false, cardAt: () => new Date().toISOString(), workGroups: rows => ({ working: [], ready: rows, deferred: [], archive: [] }),
    chanDaily: { state: () => ({}) }, sentLog: { state: () => ({ ok: true, rows: [] }) }, agentInbox: { needs: () => records },
    session: id => threads[id] || null, ...(peek ? { peekSession: peek } : {}), emit: () => { emits++; }, ...extra };
  const api = ctx.WizCore.chatsParts.inboxrows({ actMark: () => '', actNeeds: () => false, actUnread: () => false, AGS: () => ({ sigil: () => '', defaultId: () => 'hermes' }), agentName: id => id || 'Wizard', agentRec: id => ({ id }),
    ago: () => '', attOf: s => s.attention || null, chanAt: () => 0, chanFace: n => ({ emoji: '💬', label: n, own: false }), chanStore: () => ({ channels: [] }), chatVars: { readyOrder: 'newest', secOpen: {} }, ch: () => ({}),
    clip: (s, n) => String(s).slice(0, n), elOf: () => null, esc: s => String(s ?? ''), isWorking: () => false, LIVE, noteAt: () => 0, noteRow: () => '', renderChatList: () => {}, rowAgent: () => 'hermes',
    spacesOf: () => [], threadAct: () => {}, toast: () => {}, W: {}, winAgent: () => '' });
  return { api, ctx, emits: () => emits };
}
const rec = (c, thread, extra = {}) => ({ id: RID(c), agent: 'hermes', thread, title: 'T ' + thread, ask: 'ask', updatedAt: Date.now(), ...extra });
const drawn = (api, ctx) => { const html = api.inboxRowsBody({ id: 'w' }, [], { awake: [], later: [] }); return { ids: [...html.matchAll(/data-morph-key="ibrec:(inbox_[a-f0-9]+)"/g)].map(m => m[1]), extra: ctx.WizCore.inboxRowsFacts().extra([]) }; };

test('the Inbox leaves out a record whose thread is archived or snoozed, on this device or elsewhere', async () => {
  const threads = { bg1: { id: 'bg1', hidden: true, archived: true }, bg2: { id: 'bg2', hidden: true, deferred: true, deferredAt: new Date().toISOString() }, bg3: { id: 'bg3', hidden: true } };
  const { api, ctx } = part({ records: [rec('1', 'bg1'), rec('2', 'bg2'), rec('3', 'bg3')], threads });
  const d = drawn(api, ctx);
  assert.deepEqual(d.ids, [RID('3')]);
  assert.equal(d.extra, 1, 'the count and badges agree');
  threads.bg1.archived = false; // Undo / Restore
  assert.deepEqual(drawn(api, ctx).ids.sort(), [RID('1'), RID('3')]);
});

test('a thread snoozed on another device (the box\'s snooze record) keeps its task out; a later restore brings it back', () => {
  const threads = { bg8: { id: 'bg8', runtime: 'direct', hidden: true } }, disp = { 'direct:bg8': { deferred: true, updatedAt: new Date().toISOString() } };
  const { api, ctx } = part({ records: [rec('8', 'bg8')], threads });
  const live = { dispositionOf: s => disp[`${s.runtime}:${s.id}`] || null };
  const p2 = part({ records: [rec('8', 'bg8')], threads, extra: live });
  assert.deepEqual(drawn(p2.api, p2.ctx).ids, [], 'snoozed elsewhere: out');
  disp['direct:bg8'] = { deferred: false, updatedAt: new Date().toISOString() };
  assert.deepEqual(drawn(p2.api, p2.ctx).ids, [RID('8')], 'restored: back');
  assert.deepEqual(drawn(api, ctx).ids, [RID('8')], 'no snooze record: shown');
});

test('a hidden thread never opened here is read by id; hidden while that first read is out; shown when it fails', async () => {
  const peeks = []; let answer = { bg5: { id: 'bg5', hidden: true, archived: true }, bg6: { id: 'bg6', hidden: true } };
  const peek = async id => { peeks.push(id); if (id === 'bg7') throw new Error('HTTP 500'); return answer[id] || null; };
  const { api, ctx, emits } = part({ records: [rec('5', 'bg5'), rec('6', 'bg6'), rec('7', 'bg7')], peek });
  assert.deepEqual(drawn(api, ctx).ids, [], 'nothing drawn until its thread is known');
  await tick(); await tick();
  assert.deepEqual(peeks.sort(), ['bg5', 'bg6', 'bg7'], 'one read each');
  assert.ok(emits() >= 3, 'each read repaints');
  assert.deepEqual(drawn(api, ctx).ids.sort(), [RID('6'), RID('7')], 'archived elsewhere: out; a failed read shows the record as before');
  assert.equal(peeks.length, 3, 'no second read within the minute');
  answer = {};
});

// Issue 1977 (reverses 1928's check rule): a check waits on his judgment, so its record is in the Inbox with the switch on too.
test('Smart inbox on: a record whose thread says check is in the Inbox (issue 1977); off: it is, as before', () => {
  const threads = { c1: { id: 'c1', hidden: true, attention: { state: 'check', ask: 'Check it' } }, n1: { id: 'n1', hidden: true, attention: { state: 'needs_you', ask: 'A or B?' } } };
  const records = [rec('a', 'c1'), rec('b', 'n1'), rec('c', 'c1', { failed: true })];
  const on = part({ tweaks: 'wizard/smart-inbox', records, threads });
  assert.deepEqual(drawn(on.api, on.ctx).ids.sort(), [RID('a'), RID('b'), RID('c')], 'the check, the needs you and the failed task all stay');
  const off = part({ tweaks: '', records, threads });
  assert.deepEqual(drawn(off.api, off.ctx).ids.sort(), [RID('a'), RID('b'), RID('c')]);
});

test('Smart inbox: check is not Needs you (no amber dot); needs_you, approval and unknown are; off: unchanged', () => {
  const src = read('web/core/chats-done.js'), line = src.split('\n').find(l => l.trim().startsWith('const chanNeeds ='));
  const run = tweaks => {
    const ctx = vm.createContext({ document: { documentElement: { dataset: { tweaks } } } }); ctx.window = ctx; ctx.WizChatsListModel = M;
    vm.runInContext(`const isWorking = s => s.status === 'running'; const attOf = s => s.attention || null;\n${line}\nthis.f = chanNeeds;`, ctx);
    return s => ctx.f(s);
  };
  const S = { check: { status: 'completed', attention: { state: 'check' } }, needs: { status: 'completed', attention: { state: 'needs_you' } }, appr: { status: 'waiting_for_approval' }, unk: { status: 'unknown' }, done: { status: 'completed', attention: { state: 'done' } } };
  const on = run('wizard/smart-inbox'), off = run('');
  assert.deepEqual(Object.fromEntries(Object.entries(S).map(([k, s]) => [k, on(s)])), { check: false, needs: true, appr: true, unk: true, done: false });
  assert.deepEqual(Object.fromEntries(Object.entries(S).map(([k, s]) => [k, off(s)])), { check: true, needs: true, appr: true, unk: true, done: false });
});
