import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const live = readFileSync(new URL('../web/live.js', import.meta.url), 'utf8');
const chats = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
const settle = () => new Promise(r => setImmediate(r));
function harness() {
  const sources = [], frames = [], timers = [], calls = [];
  class ES {
    constructor(url) { this.url = url; this.events = {}; sources.push(this); }
    addEventListener(n, fn) { this.events[n] = fn; }
    close() { this.closed = true; }
    emit(d, type = 'message') { (type === 'message' ? this.onmessage : this.events[type])?.({ type, data: JSON.stringify(d) }); }
  }
  const L = {}, c = { L, window: { EventSource: ES, WosAgents: { defaultId: () => 'hermes', get: id => ({ id, privacy: id === 'private' ? 'private' : 'standard' }) } },
    requestAnimationFrame: fn => (frames.push(fn), frames.length), cancelAnimationFrame: () => {},
    setTimeout: fn => (timers.push(fn), timers.length), clearTimeout: () => {}, PEND: new Map(), PEND_MAX: 120000, Date,
    req: async url => { calls.push(url); return { json: async () => c.receipt }; } };
  vm.runInNewContext(live.slice(live.indexOf('  const RUN_STREAMS ='), live.indexOf('  function attachOutbox() {')), c);
  return { c, L, sources, frames, timers, calls, paint: () => { for (const fn of frames.splice(0)) fn(); } };
}
test('Incognito reuses the shared stream with a scoped ephemeral target and no normal read route', async () => {
  const h = harness(), sid = 'incog_' + 'a'.repeat(32), base = '/wizard/v1/agents/private/incognito/' + sid, reads = [];
  let snapshot;
  const handle = h.L.openRunStream(sid, 'private', 'rid', s => snapshot = s, { base, read: async url => { reads.push(url); return { json: async () => ({ run_id: 'rid', session_id: sid, status: 'completed', output: 'final' }) }; } });
  assert.equal(h.sources[0].url, base + '/v1/runs/rid/events');
  h.sources[0].emit({ event: 'message.delta', delta: 'RAM-only answer' });
  h.sources[0].emit({ event: 'tool.started', tool: 'memory', tool_call_id: 'one' }); h.paint();
  assert.equal(snapshot.steps[0].tool, 'memory'); assert.equal(snapshot.text, 'RAM-only answer');
  h.sources[0].emit({ event: 'run.completed' }); await settle(); h.paint();
  assert.equal(snapshot.terminal, true); assert.equal(snapshot.status, 'completed');
  assert.deepEqual(reads, [base + '/v1/runs/rid']); assert.deepEqual(h.calls, []);
  handle.close(); assert.equal(h.sources[0].closed, true);
  assert.equal(h.L.openRunStream(sid, 'private', 'rid', () => {}, { base: '/wizard/hermes' }), null);
});
test('hidden main thread retains its accepted outbox run when absent from session lists', () => {
  const h = harness(), now = Date.now();
  h.c.window.WosOutbox = { forThread: sid => sid === 'sid' ? [
    {state:'sent',runId:'old',createdAt:now-1000,sentAt:now-1000},
    {state:'sent',runId:'new',createdAt:now,sentAt:now},
    {state:'sending',runId:'not-accepted',createdAt:now+1}
  ] : [] };
  assert.equal(h.L.pendingRun('sid'), 'new');
  assert.equal(h.L.pendingRun('other'), '');
});
test('scoped unnamed Hermes deltas coalesce per frame; never expose reasoning', () => {
  const h = harness(), paints = [];
  h.L.openRunStream('sid', 'philosopher', 'rid', r => paints.push(r.text));
  assert.equal(h.sources[0].url, '/wizard/hermes/v1/runs/rid/events?agent=philosopher');
  h.sources[0].emit({ event: 'reasoning.available', text: 'SECRET' });
  h.sources[0].emit({ event: 'message.delta', delta: '**Hello' });
  h.sources[0].emit({ event: 'message.delta', delta: ' world**' });
  h.sources[0].emit({ event: 'message.delta', session_id: 'other', delta: 'WRONG' });
  assert.equal(h.frames.length, 1); h.paint();
  assert.deepEqual(paints, ['**Hello world**']);
});
test('main named events stream; private and unknown agents are excluded', () => {
  const h = harness(); let text;
  h.L.openRunStream('sid', '', 'main', r => text = r.text);
  assert.equal(h.sources[0].url, '/wizard/hermes/v1/runs/main/events');
  h.sources[0].emit({ delta: 'main reply' }, 'message.delta'); h.paint(); assert.equal(text, 'main reply');
  assert.equal(h.L.openRunStream('sid', 'private', 'private-run', () => {}), null);
  h.c.window.WosAgents.get = () => null;
  assert.equal(h.L.openRunStream('sid', 'unknown', 'unknown-run', () => {}), null);
  assert.equal(h.sources.length, 1);
});
test('dropped SSE closes once; exact terminal receipt polling retains words without resending', async () => {
  const h = harness(), paints = [];
  const handle = h.L.openRunStream('sid', 'philosopher', 'rid', r => paints.push([r.text, r.terminal]));
  h.sources[0].emit({ event: 'message.delta', delta: 'retained' }); h.paint();
  h.sources[0].onerror(); assert.equal(h.sources[0].closed, true);
  h.c.receipt = { run_id: 'wrong', session_id: 'sid', status: 'completed' }; await h.timers.shift()(); h.paint();
  assert.equal(handle.snapshot.terminal, false);
  h.c.receipt = { run_id: 'rid', session_id: 'sid', status: 'completed' }; await h.timers.shift()(); h.paint();
  assert.deepEqual(paints.at(-1), ['retained', true]);
  assert.equal(h.sources.length, 1); assert.equal(h.calls.length, 2);
  assert.ok(h.calls.every(url => url === '/wizard/hermes/v1/runs/rid?agent=philosopher'));
});
test('shared subscriber closes only after final watcher leaves; queued paints cannot leak navigation', () => {
  const h = harness(); let painted = 0;
  const a = h.L.openRunStream('sid', '', 'rid', () => painted++);
  const b = h.L.openRunStream('sid', '', 'rid', () => painted++);
  assert.equal(h.sources.length, 1); a.close(); assert.ok(!h.sources[0].closed);
  h.sources[0].emit({ event: 'message.delta', delta: 'x' }); b.close(); h.paint();
  assert.equal(painted, 0); assert.equal(h.sources[0].closed, true);
});
test('hidden raw-session receipt streams without list status; provisional retires atomically on transcript', async () => {
  const w = { id: 'w', thread: 'sid' }, c = {}, row = {};
  let callback, closed = 0, loads = 0;
  const ctx = { LIVE: { pendingRun: () => 'rid', session: () => row, openRunStream: (_s, _a, _r, cb) => (callback = cb, { close: () => closed++ }) },
    WORKING_ST: new Set(['running']), W: { w }, elOf: () => ({}), agentRec: () => ({ privacy: 'standard' }),
    esc: s => s, md: s => `<p>${s}</p>`, renderThreadLive: () => {}, loadThread: async () => loads++, setTimeout: () => 1, clearTimeout: () => {} };
  vm.runInNewContext(chats.slice(chats.indexOf('  const assistantStamp ='), chats.indexOf('  function renderThread(w, el, keep)')), ctx);
  assert.equal(ctx.syncStream(w, c, [], 'philosopher'), '');
  callback({ text: '**Words**', terminal: false });
  assert.match(ctx.syncStream(w, c, [], 'philosopher'), /<p>\*\*Words\*\*<\/p>/);
  callback({ text: '**Words**', terminal: true }); await settle(); assert.equal(loads, 1);
  assert.match(ctx.syncStream(w, c, [], 'philosopher'), /Words/);
  row.status = 'completed';
  assert.equal(ctx.syncStream(w, c, [{ a: { at: 123, text: '**Words**' } }], 'philosopher'), '');
  assert.equal(closed, 1); assert.equal(c.stream.landed, true);
  assert.equal(ctx.syncStream(w, c, [{ a: { at: 123, text: '**Words**' } }], 'philosopher'), '');
  assert.equal(closed, 1, 'transcript replacement retires exactly once');
});
test('protocol trailers and every partial status-marker prefix stay out of streamed answer HTML', () => {
  const ctx = {};
  vm.runInNewContext(chats.slice(chats.indexOf('  const assistantStamp ='), chats.indexOf('  function closeStream(c)')) + '\nglobalThis.cleanStream = streamAnswer;', ctx);
  const marker = '[WIZARD_STATUS_V1]';
  for (let n = 1; n <= marker.length; n++) assert.equal(ctx.cleanStream('Answer\n\n'+marker.slice(0,n)), 'Answer');
  assert.equal(ctx.cleanStream('Answer\n\n'+marker+'{"ask":"not answer"}[/WIZARD_STATUS_V1]'), 'Answer');
  assert.equal(ctx.cleanStream('**Answer** with [a link](https://example.org)'), '**Answer** with [a link](https://example.org)');
});
test('an early empty stream disconnect retries the same read, bounded to three retries', () => {
  const h = harness();
  h.L.openRunStream('sid', '', 'rid', () => {});
  h.timers.shift(); // leave the independent completion poll out of this test
  for (let i = 0; i < 4; i++) {
    h.sources.at(-1).onerror();
    const retry = h.timers.shift();
    if (i < 3) { assert.ok(retry); retry(); } else assert.equal(retry, undefined);
  }
  assert.equal(h.sources.length, 4);
  assert.ok(h.sources.every(s => s.url === '/wizard/hermes/v1/runs/rid/events'));
  assert.equal(h.calls.length, 0, 'no admission or send was made');
});
test('live tool steps stream like the CLI; reconnect replays without duplicates', () => {
  const h = harness(); let snap;
  h.L.openRunStream('sid', '', 'rid', r => snap = r);
  h.sources[0].emit({ event: 'tool.started', tool: 'terminal', preview: 'df -h' }, 'tool.started');
  h.sources[0].emit({ event: 'tool.completed', tool: 'terminal', error: false }, 'tool.completed');
  h.sources[0].emit({ event: 'tool.started', tool: 'mcp__wizard__backup__backup_status', preview: '' }, 'tool.started');
  h.paint();
  assert.equal(JSON.stringify(snap.steps.map(s => [s.tool, s.done])), JSON.stringify([['terminal', true], ['mcp__wizard__backup__backup_status', false]]));
  for (let i = 0; i < 6; i++) h.sources[0].emit({ event: 'tool.started', tool: 't' + i }, 'tool.started');
  h.paint(); assert.equal(snap.steps.length, 4, 'only the latest steps are kept');
  h.timers.shift(); h.sources[0].onerror(); h.timers.shift()();
  assert.equal(snap.steps.length, 0, 'reconnect replays the run from the start');
});
test('same-name concurrent tool completion uses stable step IDs', () => {
  const h = harness(); let snap;
  h.L.openRunStream('sid', '', 'rid', s => { snap = s; });
  const es = h.sources[0];
  es.emit({ event: 'tool.started', step_id: 'a', tool: 'terminal', preview: 'command a' });
  es.emit({ event: 'tool.started', step_id: 'b', tool: 'terminal', preview: 'command b' });
  es.emit({ event: 'tool.completed', step_id: 'a', tool: 'terminal' }); h.paint();
  assert.equal(JSON.stringify(snap.steps.map(s => [s.id, s.done])), JSON.stringify([['a', true], ['b', false]]));
});
test('status poll backs off while the live stream is open', async () => {
  const h = harness(), delays = [];
  h.c.setTimeout = (fn, ms) => (h.timers.push(fn), delays.push(ms), h.timers.length);
  h.L.openRunStream('sid', '', 'rid', () => {});
  h.sources[0].onopen();
  h.c.receipt = { run_id: 'rid', session_id: 'sid', status: 'running' };
  await h.timers.shift()();
  assert.equal(delays.at(-1), 10000);
  h.sources[0].onerror(); h.timers.pop(); delays.pop();
  await h.timers.shift()();
  assert.equal(delays.at(-1), 1500);
});
test('running reply shows one activity section, not two', () => {
  const w = { id: 'w', thread: 'sid' }, c = {}, row = {};
  let callback;
  const ctx = { LIVE: { pendingRun: () => 'rid', session: () => row, openRunStream: (_s, _a, _r, cb) => (callback = cb, { close() {} }) },
    WORKING_ST: new Set(['running']), W: { w }, elOf: () => ({}), agentRec: () => ({ privacy: 'standard' }), clip: (s, n) => s.slice(0, n),
    esc: s => s, md: s => `<p>${s}</p>`, renderThreadLive: () => {}, loadThread: async () => {}, setTimeout: () => 1, clearTimeout: () => {} };
  vm.runInNewContext(chats.slice(chats.indexOf('  const assistantStamp ='), chats.indexOf('  function renderThread(w, el, keep)')), ctx);
  assert.equal(ctx.syncStream(w, c, [], ''), '');
  const work = { window: {} };
  vm.runInNewContext(readFileSync(new URL('../web/core/chat-work.js', import.meta.url), 'utf8'), work);
  const tn = { u: { at: 1000 }, notes: [], work: [
    { at: 2000, calls: [{ id: 'command', label: 'Checked the release state' }] },
    { role: 'tool', at: 3000, callId: 'command' }
  ] };
  const power = readFileSync(new URL('../web/core/chat-power.js', import.meta.url), 'utf8');
  const receipt = { WK: work.window.WosWork, A: { md: s => s }, esc: s => s, clip: s => s };
  vm.runInNewContext(power.slice(power.indexOf('  const turnKey ='), power.indexOf('  /* ================= #11 models')), receipt);
  c.wkOpen = new Set(['1000:0']);
  for (const agent of ['', 'host-profile', 'container', 'restricted']) {
    // The one history-owned disclosure is present before words, during tokens and at completion.
    for (const [text, terminal] of [['', false], ['Checking the release.', false], ['Checked.', true]]) {
      callback({ text, steps: [{ tool: 'terminal', preview: 'git status --short', done: terminal }], terminal });
      const stream = ctx.syncStream(w, c, [], agent), html = receipt.workHtml(c, tn, true) + stream;
      assert.equal((html.match(/<details\b/g) || []).length, 1);
      assert.doesNotMatch(html, /ch-steps/);
      assert.doesNotMatch(stream, /git status --short/);
      if (!terminal) assert.match(html, /wk-preview">git status --short/);
      assert.match(html, /Checked the release state/);
      assert.match(html, /<time>1s<\/time>/);
      assert.equal(stream === '', !text, 'no separate steps-only Working bubble');
      if (text) assert.match(stream, /class="bub"/);
    }
  }
  assert.doesNotMatch(readFileSync(new URL('../web/core/chats.css', import.meta.url), 'utf8'), /\.ch-steps\b/);
});
test('a reopened thread whose answer already landed never shows the replayed run twice', () => {
  const w = { id: 'w', thread: 'sid' }, c = {}, row = {};
  let callback, closed = 0;
  const ctx = { LIVE: { pendingRun: () => 'rid', session: () => row, openRunStream: (_s, _a, _r, cb) => (callback = cb, { close: () => closed++ }) },
    WORKING_ST: new Set(['running']), W: { w }, elOf: () => ({}), agentRec: () => ({ privacy: 'standard' }), clip: (s, n) => s.slice(0, n),
    esc: s => s, md: s => `<p>${s}</p>`, renderThreadLive: () => {}, loadThread: async () => {}, setTimeout: () => 1, clearTimeout: () => {} };
  vm.runInNewContext(chats.slice(chats.indexOf('  const assistantStamp ='), chats.indexOf('  function renderThread(w, el, keep)')), ctx);
  const answer = "**You're right, and that's fixed.**\n\n**What I did:** switched the job.";
  const turns = [{ u: { text: 'hi' }, a: { at: 5, text: answer, final: true } }];
  assert.equal(ctx.syncStream(w, c, turns, ''), '');
  // The run replays from its first event: an interim line, then the same answer with its status trailer.
  callback({ text: "Now I'll save the rule." + answer + '\n\n[WIZARD_STATUS_V1]{"state":"done"}[/WIZARD_STATUS_V1]', steps: [], terminal: false });
  assert.equal(ctx.syncStream(w, c, turns, ''), '', 'no provisional copy under the landed answer');
  assert.equal(c.stream.landed, true); assert.equal(closed, 1);
  // A real new run whose words are not in the transcript yet still streams.
  const c2 = {};
  ctx.LIVE.pendingRun = () => 'rid2';
  assert.equal(ctx.syncStream(w, c2, turns, ''), '');
  callback({ text: 'Fresh words', steps: [], terminal: false });
  assert.match(ctx.syncStream(w, c2, turns, ''), /Fresh words/);
});
test('a terminal provisional that never matches the transcript retires after the reconcile window', async () => {
  const w = { id: 'w', thread: 'sid' }, c = {}, row = {};
  let callback, clock = 1000, timer = null, repaints = 0;
  const ctx = { LIVE: { pendingRun: () => 'rid', session: () => row, openRunStream: (_s, _a, _r, cb) => (callback = cb, { close() {} }) },
    WORKING_ST: new Set(['running']), W: { w }, elOf: () => ({}), agentRec: () => ({ privacy: 'standard' }), clip: (s, n) => s.slice(0, n),
    esc: s => s, md: s => `<p>${s}</p>`, renderThreadLive: () => repaints++, loadThread: async () => {}, setTimeout: fn => (timer = fn, 1), clearTimeout: () => {},
    Date: { now: () => clock } };
  vm.runInNewContext(chats.slice(chats.indexOf('  const assistantStamp ='), chats.indexOf('  function renderThread(w, el, keep)')), ctx);
  const turns = [{ a: { at: 5, text: 'older answer', final: true } }];
  ctx.syncStream(w, c, turns, '');
  callback({ text: 'words never persisted', steps: [], terminal: true }); await settle();
  assert.match(ctx.syncStream(w, c, turns, ''), /Finishing/);
  clock += 61000; await timer(); await settle();
  assert.equal(c.stream.landed, true);
  assert.equal(ctx.syncStream(w, c, turns, ''), '');
});
