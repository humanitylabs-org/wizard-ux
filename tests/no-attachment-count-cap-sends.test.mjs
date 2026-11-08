// James, 6 Nov 2026: Wizard never caps how many attachments one message carries; only real per-file size and the
// inline image budget limit anything. The orb/voice send (web/app.js) and a thread's composer-mic voice reply
// (web/core/chat-power.js) used to keep only the first eight files with a silent `.slice(0, 8)`.
// Both paths below get 12 files (some from the take, some from the thread's composer) and must deliver all 12.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const file = n => ({ id: `up_${String(n).padStart(32, '0')}`, name: `shot-${n}.png`, mime: 'image/png', bytes: 10 });
const take = Array.from({ length: 7 }, (_, n) => file(n + 1));
const composer = Array.from({ length: 5 }, (_, n) => file(n + 8));
const twelve = [...take, ...composer].map(f => f.id);
const ids = list => [...list].map(f => f.id); // copy out of the vm realm before comparing

test('orb and voice sends (web/app.js) keep all 12 files, each once', () => {
  const src = read('web/app.js');
  const line = src.split('\n').find(l => l.includes('const withSealFiles = '));
  assert.ok(line, 'app.js joins the take files and the composer files through one helper');
  const ctx = {}; vm.runInNewContext(line.trim().replace(/^const withSealFiles =/, 'this.withSealFiles ='), ctx);
  const seal = { files: [...composer, take[0]] }; // a file in both places goes once
  assert.deepEqual(ids(ctx.withSealFiles(take, seal)), twelve);
  assert.deepEqual(ids(ctx.withSealFiles(take, null)), ids(take));
  // Both send sites use it: the recording kept for later (outbox) and the take sent now with words.
  assert.match(src, /files: withSealFiles\(fl, sl\)/, 'kept recording carries every file');
  assert.match(src, /const all = withSealFiles\(files, seal\);/, 'take with words carries every file');
  assert.doesNotMatch(src, /seal\.files : \[\]\)\][^;\n]*\.slice\(0, *\d+\)/, 'no count cap on the joined files');
});

test('a voice reply recorded in a thread (web/core/chat-power.js) enqueues all 12 files', async () => {
  const src = read('web/core/chat-power.js');
  const start = src.indexOf('  async function sendVoiceTo('), end = src.indexOf('  function paintMic(', start);
  assert.ok(start > 0 && end > start, 'sendVoiceTo found');
  const queued = [];
  const w = { thread: 'sid-1' }, c = {};
  const ctx = {
    OUTBOX: { enqueue: async it => { queued.push(it); return { id: 'o1', sessionId: 'sid-1' }; } },
    H: { win: () => w, viewContext: () => '' },
    ch: () => c,
    LIVE: { session: () => ({ status: 'idle' }), holdSend: () => null, releaseSend() {} },
    follow() {},
    A: { isWorking: () => false, takeComposer: () => ({ key: 'k', text: '', files: [...composer, take[0]], done() {}, putBack() {} }),
      leaveAfterSend: () => null, renderChats() {}, winAgent: () => '', openChat() {} },
  };
  vm.runInNewContext(src.slice(start, end) + ';this.sendVoiceTo=sendVoiceTo;', ctx);
  await ctx.sendVoiceTo('w1', 'sid-1', new Blob(['a']), take, true);
  assert.equal(queued.length, 1);
  assert.deepEqual(ids(queued[0].files), twelve);
});

test('the run request never trims file ids by count (web/live.js)', () => {
  assert.doesNotMatch(read('web/live.js'), /fileIds\.slice\(0, *\d+\)/);
});
<<<<<<< HEAD
=======

// Routed parity (AGENTS.md): the same 12 files reach the run for the main agent and for every routed runtime kind:
// a new thread, a reply that starts a run, and a steer of a working run, each on that thread's own route.
const ROUTES = {
  main: ['wizard_1793157258294_34b4a71ae61a', ''],
  'host-profile': ['20261028_101500_ab12cd', 'qa-host-profile'],
  container: ['agent-research:20261028_101501_ef34', 'agent-research'],
  restricted: ['restricted.vault_20261028-101502', 'restricted.vault'],
};
function liveRequests() {
  const src = read('web/live.js');
  const start = src.indexOf('    async send(input, opts = {}) {');
  const endMark = '      return { steered: false, runId };\n    },';
  const end = src.indexOf(endMark, start) + endMark.length;
  assert.ok(start > 0 && end > start, 'WizLive send/reply found');
  const calls = [], AGENT_OF = new Map();
  const ctx = {
    window: { WosModels: { resolveRoute: async () => ({ model: 'm', provider: 'p' }), snapshot: () => ({}), matchesRuntime: () => true } },
    otherAgent: a => !!a && a !== 'hermes', AGENT_OF, J: {}, WORKING: new Set(['running']), setTimeout() {},
    aq: id => { const a = AGENT_OF.get(id) || ''; return a ? `?agent=${encodeURIComponent(a)}` : ''; },
    req: async (path, init = {}) => { calls.push({ path, body: init.body ? JSON.parse(init.body) : null }); return { json: async () => ({ run_id: 'r1', runtime: 'x' }) }; },
    crypto: { randomUUID: () => '00000000-0000-0000-0000-000000000000' }, Date, Error, Object, Set, String, JSON, encodeURIComponent,
  };
  vm.runInNewContext(`this.L = {\n${src.slice(start, end)}\n sessions: [], agentSessions: {}, emit() {}, refresh() {}, rows: {}, session(id) { return this.rows[id] || null; } };`, ctx);
  return { L: ctx.L, calls, AGENT_OF };
}
const withDupes = [...twelve, twelve[0], twelve[11]];
for (const [kind, [sid, agent]] of Object.entries(ROUTES)) {
  test(`${kind}: new thread, reply and steer all carry the 12 file ids, each once, on the thread's own route`, async () => {
    const { L, calls, AGENT_OF } = liveRequests();
    await L.send('look', { agent, fileIds: withDupes });
    const run = calls.find(c => c.path.startsWith('/wizard/hermes/v1/runs'));
    assert.deepEqual([...run.body.wizard_file_ids], twelve);
    assert.equal(run.path.includes(`agent=${encodeURIComponent(agent)}`), !!agent, 'new run on the chosen agent');
    if (agent) AGENT_OF.set(sid, agent);
    calls.length = 0; L.rows[sid] = { id: sid, status: 'completed' };
    await L.reply(sid, 'and these', { fileIds: withDupes });
    assert.deepEqual([...calls.at(-1).body.wizard_file_ids], twelve);
    assert.equal(calls.at(-1).path, `/wizard/hermes/v1/runs${agent ? `?agent=${encodeURIComponent(agent)}` : ''}`);
    calls.length = 0; L.rows[sid] = { id: sid, status: 'running', runId: 'run-9' };
    await L.reply(sid, 'one more', { fileIds: withDupes });
    const steer = calls.find(c => c.path.includes('/steer'));
    assert.deepEqual([...steer.body.wizard_file_ids], twelve);
    assert.equal(steer.path.endsWith(agent ? `?agent=${encodeURIComponent(agent)}` : '/steer'), true);
  });
}

for (const [kind, [sid, agent]] of Object.entries(ROUTES)) {
  test(`${kind}: a voice reply (web/core/chat-power.js) queues all 12 files in that thread, and a new voice thread on that agent`, async () => {
    const src = read('web/core/chat-power.js');
    const start = src.indexOf('  async function sendVoiceTo('), end = src.indexOf('  function paintMic(', start);
    const queued = [], w = { thread: sid }, c = {};
    const ctx = {
      OUTBOX: { enqueue: async it => { queued.push(it); return { id: 'o1', sessionId: it.sessionId || 'new-1' }; } },
      H: { win: () => w, viewContext: () => '' }, ch: () => c, follow() {},
      LIVE: { session: () => ({ status: 'idle' }), holdSend: () => null, releaseSend() {} },
      A: { isWorking: () => false, takeComposer: () => ({ key: 'k', text: '', files: [...composer, take[0]], done() {}, putBack() {} }),
        leaveAfterSend: () => null, renderChats() {}, winAgent: () => agent, openChat() {} },
    };
    vm.runInNewContext(src.slice(start, end) + ';this.sendVoiceTo=sendVoiceTo;', ctx);
    await ctx.sendVoiceTo('w1', sid, new Blob(['a']), take, true);
    assert.equal(queued[0].sessionId, sid); assert.deepEqual(ids(queued[0].files), twelve);
    await ctx.sendVoiceTo('w1', '__new__', new Blob(['a']), take, true);
    assert.deepEqual(ids(queued[1].files), twelve);
    assert.equal(queued[1].agent, agent || undefined, 'a new voice thread starts on the window\'s agent');
  });
}
>>>>>>> origin/main
