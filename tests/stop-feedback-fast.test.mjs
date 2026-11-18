import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// wizard-ux issue 1576 (James, 18 Nov 2026, desktop): Stop on a running chat looked ignored, or the run only showed
// as stopped long after. Stop must say Stopping… on the tap itself, never wait behind a withdrawal, say so when it
// can't be delivered, and notice the settled run in about a second instead of at the next 15 s poll.
const liveSrc = readFileSync(new URL('../web/live.js', import.meta.url), 'utf8');
const chatsSrc = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
const between = (a, b) => { const i = liveSrc.indexOf(a), j = liveSrc.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return liveSrc.slice(i, j); };

// The real STOPPING helpers and L.stop method from live.js in a vm, with a fake request and list refresh.
function harness({ deliver = async () => {}, settleAfter = 1, settles = true } = {}) {
  const helpers = between('  const STOPPING = new Map();', '  const PEND_MAX =');
  const stop = between('    async stop(runId) {', '\n    },') + '\n    },';
  const ctx = { Date, Promise, setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 5)), AbortSignal, globalThis: {},
    WORKING: new Set(['submitting', 'queued', 'running', 'stopping']), calls: [], emits: [], refreshes: 0 };
  ctx.globalThis = ctx;
  ctx.rq = () => '';
  ctx.req = async (path, init) => { ctx.calls.push({ path, init, at: ctx.row.status }); await deliver(); return {}; };
  ctx.applyLocal = s => { const st = ctx.STOPPING.get(s.runId); if (st && ctx.WORKING.has(s.status)) s.status = 'stopping'; };
  vm.createContext(ctx);
  vm.runInContext(`${helpers}\nthis.STOPPING = STOPPING;\nthis.L = {
    sessions: [], agentSessions: {}, emit() { emits.push(this.sessions.map(s => s.status).join()); },
    async refresh() { refreshes++; if (${settles} && refreshes >= ${settleAfter}) for (const s of this.sessions) s.status = 'cancelled'; },
${stop} };`, ctx);
  ctx.row = { id: 'wizard_t', runId: 'run_1', status: 'running' };
  ctx.L.sessions = [ctx.row];
  return ctx;
}

test('Stop says Stopping… on the tap, before the stop request has answered', async () => {
  let answer; const held = new Promise(r => { answer = r; });
  const h = harness({ deliver: () => held });
  const done = h.L.stop('run_1');
  assert.equal(h.row.status, 'stopping', 'the row says Stopping… at once');
  assert.equal(h.emits[0], 'stopping', 'and the shell is told before the network answers');
  assert.ok(h.calls[0].init.signal, 'the stop request has a deadline, so a lost Stop is reported');
  answer(); await done;
  assert.equal(h.row.status, 'stopping');
});

test('a Stop that cannot be delivered puts the row back and throws, so the shell says so', async () => {
  const h = harness({ settles: false, deliver: async () => { throw Object.assign(new Error('HTTP 502'), { status: 502 }); } });
  await assert.rejects(h.L.stop('run_1'), /502/);
  assert.equal(h.row.status, 'running', 'no false Stopping… after a failed Stop');
  assert.equal(h.STOPPING.has('run_1'), false);
});

test('after a delivered Stop the list is re-read within a second until the run has settled', async () => {
  const h = harness({ settleAfter: 2 });
  await h.L.stop('run_1');
  for (let i = 0; i < 200 && h.row.status !== 'cancelled'; i++) await new Promise(r => setTimeout(r, 5));
  assert.equal(h.row.status, 'cancelled');
  assert.equal(h.refreshes, 2, 'stops re-reading once settled');
  assert.equal(h.STOPPING.has('run_1'), false);
  const gaps = liveSrc.match(/STOP_FOLLOW_MS = \[([^\]]+)\]/)[1].split(',').map(Number);
  assert.ok(gaps[0] <= 1000, 'first re-read within a second, not the 15 s poll');
});

test('Stop on a thread stops its known run before withdrawing queued sends (a steer in flight answers late)', () => {
  const body = between('  L.cancelSend = async', '  const resync = () =>');
  const stopAt = body.indexOf('known.map(id => L.stop(id)'), withdrawAt = body.indexOf('await withdrawSends(');
  assert.ok(stopAt > 0 && withdrawAt > stopAt, 'L.stop(runId) starts before the withdrawals are awaited');
});

test('the Stop button answers on the tap: disabled, greyed and labelled Stopping…', () => {
  const click = chatsSrc.slice(chatsSrc.indexOf("if (e.target.closest('[data-chstop]'))")).slice(0, 400);
  assert.match(click, /stopTapped\(sb\)/);
  const fn = chatsSrc.match(/function stopTapped\(b\) \{[^\n]+/)[0];
  assert.match(fn, /disabled = true/); assert.match(fn, /is-stopping/); assert.match(fn, /Stopping…/);
  assert.match(readFileSync(new URL('../web/core/chats.css', import.meta.url), 'utf8'), /\.ch-stop\.is-stopping \{/);
});
