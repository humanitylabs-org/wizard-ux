// Agent inbox Running view (switch wizard/agent-inbox, wizard-ux issue 1569): the live.js reader of the box's agent
// inbox, cut out of the file and run against a fake box. Browser proof: tests/qa-agent-inbox-running.cjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { block } from './fixtures/source-slice.mjs';
import { withLiveParts } from './fixtures/live-parts.mjs'; // live.js parts moved out verbatim (issue 1665)

const src = withLiveParts(readFileSync(new URL('../web/live.js', import.meta.url), 'utf8'));
const start = src.indexOf('  /* ---- agent inbox (wizard-ux issue 1569)'), end = src.indexOf('/* ---- end agent inbox ---- */');
assert.ok(start > 0 && end > start, 'the agent inbox block is in live.js');
const make = (answer, opts = {}) => {
  const calls = [], ctx = { calls };
  vm.createContext(ctx);
  vm.runInContext(src.slice(start, end) + '\nthis.agentInbox = agentInbox;', ctx);
  const clock = { at: 1_000_000 };
  const req = async (path, init) => { calls.push(path); const a = await answer(path, init); if (a.status) { const e = new Error('HTTP ' + a.status); e.status = a.status; throw e; } return { json: async () => a.json }; };
  let emits = 0;
  const inbox = ctx.agentInbox({ req, emit: () => { emits++; }, now: () => clock.at, ...opts });
  return { inbox, calls, clock, emits: () => emits };
};
const rec = (n, extra = {}) => ({ id: 'inbox_' + String(n).repeat(24).slice(0, 24), agent: 'hermes', thread_id: 'wizard_worker_' + n, state: 'running', title: 'Task ' + n, last_update: 'Working on ' + n, created_at: 1000 * n, updated_at: 2000 * n, ...extra });
const clone = v => JSON.parse(JSON.stringify(v));

test('reads running and stale records once, newest news first, and keeps only well-formed ones', async () => {
  const f = make(() => ({ json: { records: [rec(1), rec(3, { state: 'stale' }), rec(2), rec(4, { state: 'new' }), { id: 'bad', thread_id: 'x', state: 'running' }, rec(5, { thread_id: '../etc' })] } }));
  assert.equal(f.inbox.state().ok, false, 'nothing known before the first answer');
  const s = await f.inbox.read();
  assert.deepEqual(f.calls, ['/wizard/v1/agent-inbox?state=running,stale&limit=200']);
  assert.equal(s.ok, true);
  assert.deepEqual(clone(s.records.map(r => [r.thread, r.state])), [['wizard_worker_3', 'stale'], ['wizard_worker_2', 'running'], ['wizard_worker_1', 'running']]);
  assert.deepEqual(clone(s.records[1]), { id: 'inbox_' + '2'.repeat(24), agent: 'hermes', thread: 'wizard_worker_2', title: 'Task 2', update: 'Working on 2', state: 'running', createdAt: 2000, updatedAt: 4000 });
  assert.ok(f.emits() >= 1, 'Chats repaints when the answer lands');
});

test('main versus routed: records stay with their own agent, even with the same thread id', async () => {
  const f = make(() => ({ json: { records: [rec(1), rec(2, { agent: 'host-ops', thread_id: 'wizard_worker_1' }), rec(3, { agent: 'box' }), rec(4, { agent: 'locked' })] } }));
  await f.inbox.read();
  assert.deepEqual(clone(f.inbox.records('hermes').map(r => [r.agent, r.thread])), [['hermes', 'wizard_worker_1']], 'the main Chats list gets only the main agent\'s task');
  assert.deepEqual(clone(f.inbox.records('').map(r => r.agent)), ['hermes'], 'no agent = the main agent');
  for (const kind of ['host-ops', 'box', 'locked']) assert.deepEqual(clone(f.inbox.records(kind).map(r => r.agent)), [kind], kind + ': its own only');
  // The real Running view (core/chats-running.js) on that reader: its row and its list show the main agent's task only.
  const v = runningPart(f.inbox), w = { id: 'w' };
  assert.match(v.runningRow(w), /aria-label="1 running: open the Running view"/, 'one task, not four');
  const body = v.runningBody();
  assert.deepEqual([...body.matchAll(/data-chrunopen="([^"]+)"/g)].map(m => m[1]), ['wizard_worker_1'], 'its rows too: the main agent\'s thread');
  assert.match(body, /<b>Task 1<\/b>/); assert.doesNotMatch(body, /Task [234]/);
});

test('asks again only after its interval, and one read at a time', async () => {
  const f = make(() => ({ json: { records: [rec(1)] } }), { every: 30e3 });
  f.inbox.state(); f.inbox.state();
  await f.inbox.read();
  assert.equal(f.calls.length, 1, 'state() while a read runs never starts a second one');
  f.inbox.state(); assert.equal(f.calls.length, 1, 'fresh enough');
  f.clock.at += 30e3; f.inbox.state(); await f.inbox.read();
  assert.equal(f.calls.length, 2, 'read again after the interval');
  f.inbox.fresh(); f.inbox.state(); await f.inbox.read();
  assert.equal(f.calls.length, 3, 'fresh() asks at the next look');
});

test('a box without the inbox (404) is an empty list, not an error; a failed read keeps what it had', async () => {
  let answer = { json: { records: [rec(1)] } };
  const f = make(() => answer);
  await f.inbox.read();
  answer = { status: 503 };
  f.inbox.fresh(); const kept = await f.inbox.read();
  assert.equal(kept.records.length, 1, 'offline: the last list stays');
  answer = { status: 404 };
  f.inbox.fresh(); const gone = await f.inbox.read();
  assert.deepEqual([gone.ok, gone.gone, gone.records.length], [true, true, 0]);
});

test('Chats reads the inbox only through the switch, and the Running view sits on the main Chats list', () => {
  const chats = withParts(['chats.js', 'chats-running.js'].map(f => readFileSync(new URL('../web/core/' + f, import.meta.url), 'utf8')).join('\n')); // the Running view moved to chats-running.js (issue 1665)
  const part = chats.slice(chats.indexOf('  function inboxSwitchOn() {'), chats.indexOf('  function runningFor(ms)'));
  const html = { dataset: { tweaks: '' } }, listeners = {}, repainted = [], fresh = [];
  const W = { main: { id: 'main', thread: null }, routed: { id: 'routed', thread: null, agent: 'box' }, open: { id: 'open', thread: 't1' } };
  const ctx = { document: { documentElement: html }, window: { addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); } }, winAgent: w => w.agent || '', ch: id => ({ running: id === 'main' }),
    LIVE: { agentInbox: { fresh: () => fresh.push(1) } }, CH: { main: {}, routed: {}, open: {} }, H: { win: id => W[id] }, rerenderList: w => repainted.push(w.id) };
  vm.createContext(ctx); vm.runInContext(part + '\nthis.api = { inboxSwitchOn, runningOn, runningOpen };', ctx);
  const { api } = ctx, flip = t => { html.dataset.tweaks = t; for (const fn of listeners['wos:experience'] || []) fn(); };
  assert.equal(api.inboxSwitchOn(), false); assert.equal(api.runningOn(W.main), false, 'off: no Running row, no inbox read'); assert.equal(api.runningOpen(W.main), false);
  flip('wizard/other wizard/agent-inbox');
  assert.equal(api.inboxSwitchOn(), true); assert.equal(api.runningOn(W.main), true); assert.equal(api.runningOpen(W.main), true, 'the Running view on the main Chats list');
  assert.equal(api.runningOn(W.routed), false, 'the main agent only (the orb dump is main only)');
  assert.deepEqual(repainted, ['main', 'routed'], 'a switch flip repaints the lists at once (not an open thread)'); assert.equal(fresh.length, 1, 'and reads the inbox fresh');
  flip('wizard/other wizard/agent-inbox'); assert.equal(repainted.length, 2, 'no change: no repaint');
  flip(''); assert.equal(repainted.length, 4); assert.equal(fresh.length, 1, 'off: no inbox read');
  // Back from the Running view returns to Chats (channelBack asks runningBack first)
  const back = vm.runInNewContext(`(${block(chats, '  function channelBack(w) {').trim()})`, { runningBack: w => w.id === 'main', W: {}, owner: x => x });
  assert.equal(back({ id: 'main', thread: null }), true); assert.equal(back({ id: 'other', thread: null }), false);
  const catalog = JSON.parse(readFileSync(new URL('../web/tweaks/catalog.json', import.meta.url), 'utf8'));
  assert.ok(catalog.tweaks.includes('wizard/agent-inbox') && !catalog.defaults.includes('wizard/agent-inbox'), 'listed, off by default');
  const manifest = JSON.parse(readFileSync(new URL('../web/tweaks/wizard/agent-inbox/manifest.json', import.meta.url), 'utf8'));
  assert.ok(manifest.issues.includes('humanitylabs-org/wizard-ux#1569'), 'the Tracker finds the switch from the issue');
});

// core/chats-running.js's part factory with the switch on, a main-agent list window and stand-ins for the Chats names.
function runningPart(agentInbox) {
  const window = { WizCore: {}, addEventListener() {} };
  const document = { documentElement: { dataset: { tweaks: 'wizard/agent-inbox' } } };
  vm.runInNewContext(readFileSync(new URL('../web/core/chats-running.js', import.meta.url), 'utf8'), { window, document });
  const CH = { w: {} };
  return window.WizCore.chatsParts.running({ ago: () => '1 min', ch: id => (CH[id] ||= {}), CH, chanStore: () => null, clip: (t, n) => String(t).slice(0, n),
    esc: String, H: { win: () => null }, KIT: null, LIVE: { agentInbox, sessions: [] }, paintListsNow() {}, PIN: {}, renderThreadNow() {}, rerenderList() {},
    STI: {}, storeAgent: () => '', toast() {}, W: {}, winAgent: () => '' });
}
