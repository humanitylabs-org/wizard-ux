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
test('an early empty stream disconnect retries the same read with backoff, bounded', () => {
  const h = harness();
  h.L.openRunStream('sid', '', 'rid', () => {});
  h.timers.shift(); // leave the independent completion poll out of this test
  for (let i = 0; i < 21; i++) {
    h.sources.at(-1).onerror();
    const retry = h.timers.shift();
    if (i < 20) { assert.ok(retry); retry(); } else assert.equal(retry, undefined);
  }
  assert.equal(h.sources.length, 21);
  assert.ok(h.sources.every(s => s.url === '/wizard/hermes/v1/runs/rid/events'));
  assert.equal(h.calls.length, 0, 'no admission or send was made');
});
for (const agent of ['', 'philosopher']) test(`a numbered stream resumes after a drop mid-answer: replayed frames are skipped, words never doubled (${agent || 'main'})`, () => {
  const h = harness(); let snap;
  h.L.openRunStream('sid', agent, 'rid', r => snap = r);
  h.timers.shift(); // the completion poll
  const frames = [{ event: 'message.delta', delta: 'Hello', seq: 0 }, { event: 'tool.started', tool: 'terminal', seq: 1 }, { event: 'message.delta', delta: ' there', seq: 2 }];
  for (const f of frames) h.sources[0].emit(f);
  h.sources[0].onerror(); assert.equal(h.sources[0].closed, true);
  h.timers.shift()(); assert.equal(h.sources.length, 2, 'a numbered stream reconnects even after answer text');
  for (const f of frames) h.sources[1].emit(f); // the new read replays the run from its first frame
  h.sources[1].emit({ event: 'message.delta', delta: '!', seq: 3 });
  h.paint();
  assert.equal(snap.text, 'Hello there!');
  assert.equal(JSON.stringify(snap.steps.map(s => s.tool)), JSON.stringify(['terminal']), 'steps survive a numbered reconnect');
  assert.equal(h.sources[1].url, `/wizard/hermes/v1/runs/rid/events${agent ? '?agent=' + agent : ''}`, 'the same read of the same run');
  assert.equal(h.calls.length, 0, 'no admission or send was made');
});
test('a replay that lost frames drops the partial words instead of showing a hole; the run end still lands', () => {
  const h = harness(); let snap;
  h.L.openRunStream('sid', '', 'rid', r => snap = r);
  h.timers.shift();
  h.sources[0].emit({ event: 'message.delta', delta: 'Part one', seq: 0 });
  h.sources[0].onerror(); h.timers.shift()();
  h.sources[1].emit({ event: 'replay.truncated', oldest_retained_seq: 5 }, 'replay.truncated');
  h.sources[1].emit({ event: 'message.delta', delta: 'part six', seq: 5 });
  h.paint(); assert.equal(snap.text, ''); assert.equal(snap.gap, true);
  h.sources[1].emit({ event: 'run.completed', seq: 6 }); h.paint();
  assert.equal(snap.terminal, true);
});
test('offline waits for the network instead of burning retries, then reads again at once', async () => {
  const h = harness(), on = {};
  h.c.window.navigator = { onLine: false };
  h.c.window.addEventListener = (n, fn) => { on[n] = fn; };
  h.c.window.removeEventListener = (n, fn) => { if (on[n] === fn) delete on[n]; };
  const handle = h.L.openRunStream('sid', '', 'rid', () => {});
  h.timers.shift();
  h.sources[0].emit({ event: 'message.delta', delta: 'Hi', seq: 0 });
  h.sources[0].onerror();
  assert.equal(h.timers.length, 0, 'no retry timer while offline');
  h.c.window.navigator.onLine = true; on.online();
  assert.equal(h.sources.length, 2, 'back online reads again immediately');
  handle.close(); assert.equal(on.online, undefined, 'listeners leave with the stream');
});
test('a silent half-open stream is replaced once the status read proves Wizard reachable', async () => {
  const h = harness(); let t = 1000;
  h.c.Date = { now: () => t };
  h.L.openRunStream('sid', '', 'rid', () => {});
  const poll = h.timers.shift();
  h.sources[0].onopen(); h.sources[0].emit({ event: 'message.delta', delta: 'Hi', seq: 0 });
  h.c.receipt = { run_id: 'rid', session_id: 'sid', status: 'running' };
  t += 30000; await poll(); assert.equal(h.sources.length, 1, 'quiet for 30 s is normal (a long tool)');
  t += 100000; await h.timers.shift()(); assert.equal(h.sources.length, 2, 'silent past the stall window: read again');
  assert.equal(h.sources[0].closed, true);
});
test('a replacement stream on a slow link gets the whole stall window to open', async () => {
  const h = harness(); let t = 1000;
  h.c.Date = { now: () => t };
  h.L.openRunStream('sid', '', 'rid', () => {});
  let poll = h.timers.shift();
  h.sources[0].onopen(); h.sources[0].emit({ event: 'message.delta', delta: 'Hi', seq: 0 });
  h.c.receipt = { run_id: 'rid', session_id: 'sid', status: 'running' };
  t += 100000; await poll(); assert.equal(h.sources.length, 2, 'stalled: replaced');
  // The replacement has not opened yet; the next polls (1.5 s apart while not live) must leave it alone.
  for (let i = 0; i < 5; i++) { t += 1500; await h.timers.shift()(); }
  assert.equal(h.sources.length, 2, 'never closed before it could open');
  assert.equal(h.sources[1].closed, undefined);
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
  const turns = [{ u: { text: 'hi' }, notes: ["Now I'll save the rule."], a: { at: 5, text: answer, final: true } }];
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
test('a new run that only ends like the previous short answer keeps streaming (main and routed threads)', () => {
  for (const agent of ['', 'philosopher']) {
    const w = { id: 'w', thread: 'sid' }, c = {}, row = {};
    let callback;
    const ctx = { LIVE: { pendingRun: () => 'rid', session: () => row, openRunStream: (_s, _a, _r, cb) => (callback = cb, { close() {} }) },
      WORKING_ST: new Set(['running']), W: { w }, elOf: () => ({}), agentRec: () => ({ privacy: 'standard' }), clip: (s, n) => s.slice(0, n),
      esc: s => s, md: s => `<p>${s}</p>`, renderThreadLive: () => {}, loadThread: async () => {}, setTimeout: () => 1, clearTimeout: () => {} };
    vm.runInNewContext(chats.slice(chats.indexOf('  const assistantStamp ='), chats.indexOf('  function renderThread(w, el, keep)')), ctx);
    const turns = [{ notes: [], a: { at: 5, text: 'Yes.', final: true } }];
    ctx.syncStream(w, c, turns, agent);
    callback({ text: 'I checked the request. Yes.', steps: [], terminal: false });
    assert.match(ctx.syncStream(w, c, turns, agent), /I checked the request/, `agent=${agent || 'main'}`);
    assert.equal(c.stream.landed, false);
    // The same thread reopened after that answer landed: the replay is retired on both routes.
    const c2 = {}, landed = [...turns, { notes: [], a: { at: 9, text: 'I checked the request. Yes.', final: true } }];
    ctx.syncStream(w, c2, landed, agent);
    callback({ text: 'I checked the request. Yes.', steps: [], terminal: true });
    assert.equal(ctx.syncStream(w, c2, landed, agent), '', `agent=${agent || 'main'}`);
  }
});
test('interim words the transcript already shows mid-run are not drawn again under Replying (main and routed)', () => {
  for (const agent of ['', 'host-profile', 'container', 'restricted']) {
    const w = { id: 'w', thread: 'sid' }, c = {}, row = { status: 'running' };
    let callback;
    const ctx = { LIVE: { pendingRun: () => 'rid', session: () => row, openRunStream: (_s, _a, _r, cb) => (callback = cb, { close() {} }) },
      WORKING_ST: new Set(['running']), W: { w }, elOf: () => ({}), agentRec: () => ({ privacy: 'standard' }), clip: (s, n) => s.slice(0, n),
      esc: s => s, md: s => `<p>${s}</p>`, renderThreadLive: () => {}, loadThread: async () => {}, setTimeout: () => 1, clearTimeout: () => {} };
    vm.runInNewContext(chats.slice(chats.indexOf('  const assistantStamp ='), chats.indexOf('  function renderThread(w, el, keep)')), ctx);
    const interim = "You're right, I should have read the code first. Doing that now.";
    const turns = [{ u: { text: 'read the code' }, notes: [], a: { at: 5, text: interim, final: false } }];
    ctx.syncStream(w, c, turns, agent);
    callback({ text: interim, steps: [], terminal: false });
    assert.equal(ctx.syncStream(w, c, turns, agent), '', `agent=${agent || 'main'}: interim line shown once`);
    assert.equal(c.stream.landed, false, 'the run keeps streaming');
    callback({ text: interim + '\n\nThe onboarding code lives in setup.js.', steps: [], terminal: false });
    const html = ctx.syncStream(w, c, turns, agent);
    assert.match(html, /The onboarding code lives in setup\.js\./);
    assert.doesNotMatch(html, /Doing that now/);
    // Earlier interim lines moved into notes still count as shown.
    const later = [{ u: { text: 'read the code' }, notes: [interim], a: { at: 7, text: 'Reading setup.js next.', final: false } }];
    callback({ text: interim + 'Reading setup.js next.' + 'Found it.', steps: [], terminal: false });
    assert.match(ctx.syncStream(w, c, later, agent), /<p>Found it\.<\/p>/);
    // Words that do not continue the transcript are never trimmed.
    callback({ text: 'Different words entirely.', steps: [], terminal: false });
    assert.match(ctx.syncStream(w, c, turns, agent), /Different words entirely\./);
  }
});
test('a reply with a mid-reply MEDIA line shows once: no raw path while streaming, retired once its thumbnail lands (main and routed)', () => {
  for (const agent of ['', 'host-profile', 'container', 'restricted']) {
    const w = { id: 'w', thread: 'sid' }, c = {}, row = { status: 'running' };
    let callback, closed = 0;
    const ctx = { LIVE: { pendingRun: () => 'rid', session: () => row, openRunStream: (_s, _a, _r, cb) => (callback = cb, { close: () => closed++ }) },
      WORKING_ST: new Set(['running']), W: { w }, elOf: () => ({}), agentRec: () => ({ privacy: 'standard' }), clip: (s, n) => s.slice(0, n),
      esc: s => s, md: s => `<p>${s}</p>`, renderThreadLive: () => {}, loadThread: async () => {}, setTimeout: () => 1, clearTimeout: () => {} };
    vm.runInNewContext(chats.slice(chats.indexOf('  const assistantStamp ='), chats.indexOf('  function renderThread(w, el, keep)')), ctx);
    const intro = 'I redid the mockup in a cleaner style. It now has five screens.';
    const outro = 'The proposal for James now has the new image.';
    const streamed = `${intro}\n\nMEDIA:/home/oscar/.hermes/cache/images/friendly-sharing-v2.png\n\n${outro}`;
    const before = [{ u: { text: 'redo it' }, notes: [], a: { at: 5, text: 'Older answer.', final: true } }];
    ctx.syncStream(w, c, before, agent);
    // Half-typed and complete MEDIA lines never show as text while streaming.
    for (const part of [`${intro}\n\nME`, `${intro}\n\nMEDIA:/home/oscar/.her`, streamed]) {
      callback({ text: part, steps: [], terminal: false });
      const html = ctx.syncStream(w, c, before, agent);
      assert.doesNotMatch(html, /MEDIA|\.hermes|<p>ME/, `agent=${agent || 'main'}: ${part.slice(-12)}`);
      assert.match(html, /five screens/);
    }
    assert.match(ctx.syncStream(w, c, before, agent), /new image/);
    // A subscriber opened after the reply landed (baseline already includes it) replays the whole run with the raw
    // line, while the transcript shows the thumbnail in its place (chat-kit helm() markdown). Same reply: one copy.
    const thumb = '![Image](/wizard/attachments/3a22b57edb70bd0c03514042ac7bfa13 "wizard-inline-0")';
    const landed = [...before, { u: { text: 'again' }, notes: [], a: { at: 9, text: `${intro}\n\n${thumb}\n\n${outro}`, final: true } }];
    const c2 = {};
    assert.equal(ctx.syncStream(w, c2, landed, agent), '');
    callback({ text: streamed, steps: [], terminal: true });
    assert.equal(ctx.syncStream(w, c2, landed, agent), '', `agent=${agent || 'main'}: no Finishing copy under the landed reply`);
    assert.equal(c2.stream.landed, true);
    // A picture the service could not show lands as its unavailable line; still the same reply.
    const c3 = {}, gone = [...before, { u: { text: 'again' }, notes: [], a: { at: 9, text: `${intro}\n\n[file: friendly-sharing-v2.png unavailable]\n\n${outro}`, final: true } }];
    ctx.syncStream(w, c3, gone, agent);
    callback({ text: streamed, steps: [], terminal: true });
    assert.equal(ctx.syncStream(w, c3, gone, agent), '');
  }
});
