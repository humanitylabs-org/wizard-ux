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
