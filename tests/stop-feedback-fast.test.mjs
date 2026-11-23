import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createDocument } from './fixtures/mini-dom.mjs';
import { cascade } from './fixtures/mini-css.mjs';
import { withParts } from './fixtures/chats-parts.mjs';
import { withLiveParts } from './fixtures/live-parts.mjs';
import { runWithChatsModel } from './fixtures/chats-list-model.mjs'; // chats.js parts moved out verbatim (issue 1665)

// wizard-ux issue 1576 (James, 18 Nov 2026, desktop): Stop on a running chat looked ignored, or the run only showed
// as stopped long after. Stop must say Stopping… on the tap itself, never wait behind a withdrawal, say so when it
// can't be delivered, and notice the settled run in about a second instead of at the next 15 s poll.
const liveSrc = readFileSync(new URL('../web/live.js', import.meta.url), 'utf8');
const chatsSrc = withParts(readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8'));
const between = (a, b) => { const i = liveSrc.indexOf(a), j = liveSrc.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return liveSrc.slice(i, j); };

// The real STOPPING helpers and L.stop method from live.js in a vm, with a fake request and list refresh.
function harness({ deliver = async () => {}, settleAfter = 1, settles = true } = {}) {
  const helpers = between('  const STOPPING = new Map();', '  const PEND_MAX =');
  const stop = between("    async stop(runId, sid = '') {", '\n    },') + '\n    },';
  const ctx = { Date, Promise, setTimeout: (fn, ms) => setTimeout(() => { ctx.firing = ms; try { fn(); } finally { ctx.firing = null; } }, Math.min(ms, 5)), clearTimeout, refreshAfter: [], AbortController, AbortSignal, globalThis: {},
    DETAIL: new Map(), SPACE_ROWS: new Map(),
    WORKING: new Set(['submitting', 'queued', 'running', 'stopping']), calls: [], emits: [], refreshes: 0 };
  ctx.globalThis = ctx;
  ctx.rq = () => '';
  ctx.req = async (path, init) => { ctx.calls.push({ path, init, at: ctx.row.status }); await deliver(init); return {}; };
  ctx.applyLocal = s => { const st = ctx.STOPPING.get(s.runId); if (st && ctx.WORKING.has(s.status)) s.status = 'stopping'; };
  vm.createContext(ctx);
  vm.runInContext(`${helpers}\nthis.STOPPING = STOPPING;\nthis.L = {
    sessions: [], agentSessions: {}, emit() { emits.push(this.sessions.map(s => s.status).join()); },
    async refresh() { refreshes++; refreshAfter.push(firing); if (${settles} && refreshes >= ${settleAfter}) for (const s of this.sessions) s.status = 'cancelled'; },
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
  // the delays the real follow-up asked its timers for (the harness runs them at once)
  assert.ok(h.refreshAfter[0] > 0 && h.refreshAfter[0] <= 1000, `first re-read within a second, not the 15 s poll (${h.refreshAfter[0]} ms)`);
  assert.ok(h.refreshAfter.every(ms => ms <= 15000), 'never slower than the poll it replaces');
});

// The real cancelSend block (live.js with its moved-out parts), with a stub outbox and L.stop that log their order.
test('Stop on a thread stops its known run before withdrawing queued sends (a steer in flight answers late)', async () => {
  const live = withLiveParts(liveSrc);
  const body = live.slice(live.indexOf('  const STOPPABLE = '), live.indexOf('  const resync = () =>'));
  const order = [], items = new Map([['steer', { id: 'steer', sessionId: 't1', agent: '', kind: 'reply', state: 'queued', steerRunId: 'run_1', createdAt: Date.now() - 1000 }]]);
  const ctx = { PEND: new Map(), TAPS: new Map(), RELEASED: new Set(), CANCELLING: new Set(), Date, Promise, setTimeout, resync() {},
    L: { 'stop': id => { order.push('stop ' + id); return new Promise(r => setTimeout(r, 5)); }, emit() {} },
    window: { WosOutbox: { _items: items, cancel: async id => { order.push('withdraw ' + id); const it = items.get(id); it.state = 'held'; return { outcome: 'cancelled', item: it }; } } } };
  runWithChatsModel(body, ctx);
  const r = await ctx.L.cancelSend('t1', 'run_1');
  assert.deepEqual(order, ['stop run_1', 'withdraw steer'], 'L.stop(runId) starts before the withdrawals');
  assert.equal(r.outcome, 'stopped');
});

test('the Stop button answers on the tap: disabled, greyed and labelled Stopping…', () => {
  // The thread's Stop click calls stopTapped first: covered by tests/stop-before-run.test.mjs 'composer shows Stop for a pending send without a run id; every Stop goes through cancelSend with the run id'.
  const fn = chatsSrc.match(/function stopTapped\(b\) \{[^\n]+/)[0];
  const cls = new Set(['ch-stop']), attrs = {};
  const b = { disabled: false, textContent: 'Stop', innerHTML: 'Stop', title: '', classList: { add: c => cls.add(c), contains: c => cls.has(c) }, setAttribute: (k, v) => { attrs[k] = v; } };
  vm.runInNewContext(`${fn}\nstopTapped(b);`, { b });
  assert.equal(b.disabled, true);
  assert.ok(cls.has('is-stopping'), 'greyed by .is-stopping');
  assert.match([b.textContent, b.innerHTML, b.title, attrs['aria-label'] || ''].join(' '), /Stopping…/);
  // the real button in a composer (mini-dom), tapped, then cascaded with the real chats.css: greyed
  const doc = createDocument(); doc.body.innerHTML = '<form class="ch-compose"><button type="button" class="ch-stop">Stop</button></form>';
  const btn = doc.querySelector('.ch-stop'), css = readFileSync(new URL('../web/core/chats.css', import.meta.url), 'utf8');
  const before = cascade(btn, css).opacity?.value;
  vm.runInNewContext(`${fn}\nstopTapped(b);`, { b: btn });
  const after = cascade(btn, css).opacity?.value;
  assert.notEqual(after, before, 'the tap changes how it looks'); assert.ok(Number(after) < 1, `greyed (opacity ${after})`);
});

test('a Stop the box never answers gives up after its deadline (no AbortSignal.timeout needed) and says so', async () => {
  const h = harness({ settles: false, deliver: init => new Promise((_, no) => init.signal.addEventListener('abort', () => no(new Error('aborted')))) });
  h.AbortSignal = undefined; // iOS 16.0-16.3 WebViews
  await assert.rejects(h.L.stop('run_1'), /aborted/);
  assert.equal(h.row.status, 'running');
});

test('a thread opened from search (not in the lists) also says Stopping… and is followed until it settles', async () => {
  const h = harness({ settles: false });
  h.L.sessions = []; h.DETAIL.set('wizard_t', h.row);
  let answer; const held = new Promise(r => { answer = r; });
  const h2 = harness({ settles: false, deliver: () => held });
  h2.L.sessions = []; h2.L.session = id => (id === 'wizard_t' ? h2.row : null);
  const done = h2.L.stop('run_1', 'wizard_t');
  assert.equal(h2.row.status, 'stopping', 'the tapped thread says Stopping… even outside the lists');
  answer(); await done;
  await h.L.stop('run_1');
  assert.equal(h.row.status, 'stopping', 'a search/detail row is marked too');
});
