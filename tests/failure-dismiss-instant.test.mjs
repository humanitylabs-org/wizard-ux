// Regression (wizard-ux issue 1488): tapping Dismiss on a "Needs retry" card in a routed agent's thread (James's
// Philosopher, a signed-out Claude) toasted "Couldn't dismiss · try again" and the card and the header warning
// stayed. The Agent Service refused the save for any agent but main, and the shell only hid the card after the
// save succeeded (and for two minutes). Now Dismiss hides it at once, keeps it hidden across a reload until a
// newer request or run, and saves it quietly in the background (routed threads name their agent), never a toast.
// Run: node --test tests/failure-dismiss-instant.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const KINDS = [['main', ''], ['host-ops', 'host'], ['box', 'container'], ['locked', 'restricted']];

function storage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), dump: () => Object.fromEntries(m) };
}
// The real web/core/chat-errors.js in a vm with a fake clock, fetch and live store.
function boot({ ls = storage(), answers = [], rows = [] } = {}) {
  const timers = [], posts = [];
  const live = { session: id => rows.find(r => r.id === id) || null, agentOf: id => rows.find(r => r.id === id && r.agent)?.agent || '' };
  const window = { WizLive: live, WosAgents: { isOther: a => !!a && a !== 'hermes' }, addEventListener() {} };
  const fetch = async (url, init) => {
    posts.push({ url, body: JSON.parse(init.body) });
    const status = answers.length ? answers.shift() : 200;
    return { ok: status < 300, status, json: async () => ({}) };
  };
  const ctx = vm.createContext({ window, localStorage: ls, fetch, console, JSON, Date, Map, Set, Object, Array, Promise, encodeURIComponent, isFinite,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {} });
  vm.runInContext(read('web/core/chat-errors.js'), ctx);
  const loadResend = timers.splice(timers.findIndex(t => t.ms === 1500), 1)[0];
  const flush = () => new Promise(r => setImmediate(r));
  const tick = async () => { const t = timers.shift(); if (t) { t.fn(); await flush(); await flush(); } return t; };
  return { E: window.WosErrors, posts, timers, ls, tick, flush, loadResend };
}
const failedRow = (agent, extra = {}) => ({ id: 'wizard_1488', status: 'failed', lastUserAt: '2026-11-17T09:49:00.000Z', runId: 'run_a', agent, ...extra });

for (const [name, agent] of KINDS) {
  test(`${name}: Dismiss hides the failure at once, before Wizard answers`, async () => {
    const row = failedRow(agent), app = boot({ rows: [row] });
    assert.equal(app.E.dismissed(row), false);
    assert.equal(app.E.dismissFailure(row.id, row), true, 'answers at once, no promise to wait for');
    assert.equal(app.E.dismissed(row), true, 'same frame: the card and the header warning go');
    assert.equal(app.E.dismissed(row.id), true, 'by id too (Errors list, header)');
    await app.flush(); await app.flush();
    assert.equal(app.posts.length, 1);
    assert.match(app.posts[0].url, /^\/wizard\/session-failure\/wizard_1488\/dismiss$/);
    assert.deepEqual({ ...app.posts[0].body }, agent ? { agent_id: agent } : {}, 'a routed thread names its own agent');
  });

  test(`${name}: a refused or failed save is retried quietly and the card never comes back`, async () => {
    const row = failedRow(agent), app = boot({ rows: [row], answers: [409, 503, 200] });
    app.E.dismissFailure(row.id, row);
    await app.flush(); await app.flush();
    assert.equal(app.E.dismissed(row), true, 'still hidden after a refusal');
    assert.equal(app.timers.length, 1, 'a quiet retry is scheduled');
    await app.tick();
    assert.equal(app.E.dismissed(row), true);
    await app.tick();
    assert.equal(app.posts.length, 3);
    assert.equal(app.timers.length, 0, 'stops once Wizard took it');
    const saved = JSON.parse(app.ls.getItem('wos.failure-dismissals.v1'));
    assert.equal(Object.values(saved)[0].sent, true);
  });

  test(`${name}: after a reload the failure stays dismissed, and an unsaved dismissal is sent again`, async () => {
    const row = failedRow(agent), first = boot({ rows: [row], answers: [500] });
    first.E.dismissFailure(row.id, row);
    await first.flush(); await first.flush();
    const again = boot({ ls: first.ls, rows: [{ ...row }] });
    assert.equal(again.E.dismissed({ ...row }), true, 'no card after a reload');
    const resend = again.loadResend;
    assert.ok(resend, 'the unsaved dismissal is sent again after load');
    resend.fn(); await again.flush(); await again.flush();
    assert.equal(again.posts.length, 1);
    assert.deepEqual({ ...again.posts[0].body }, agent ? { agent_id: agent } : {});
  });

  test(`${name}: a newer request or run is a new failure and shows again`, () => {
    const row = failedRow(agent), app = boot({ rows: [row] });
    app.E.dismissFailure(row.id, row);
    assert.equal(app.E.dismissed({ ...row }), true);
    assert.equal(app.E.dismissed({ ...row, lastUserAt: '2026-11-17T10:05:00.000Z' }), false, 'newer owner request');
    app.E.dismissFailure(row.id, row);
    assert.equal(app.E.dismissed({ ...row, runId: 'run_b' }), false, 'newer run');
  });
}

test('a routed dismissal never hides a main thread with the same id (and the other way round)', () => {
  const routed = failedRow('host'), main = failedRow('');
  const app = boot({ rows: [routed] });
  app.E.dismissFailure(routed.id, routed);
  assert.equal(app.E.dismissed(routed), true);
  assert.equal(app.E.dismissed(main), false);
  const other = boot();
  other.E.dismissFailure(main.id, main);
  assert.equal(other.E.dismissed(main), true);
  assert.equal(other.E.dismissed(routed), false);
});

test('the shell hides the card and the header warning from the same record, and never toasts on Dismiss', () => {
  const power = read('web/core/chat-power.js'), chats = read('web/core/chats.js');
  assert.match(power, /function dismissThread\(wid, sid\) \{ E\?\.dismissFailure\(sid, rowFor\(wid, sid\)\); rerenderAll\(\); \}/);
  assert.match(power, /if \(t\.closest\('\[data-chdismiss\]'\) && w\?\.thread\) \{ dismissThread\(id, w\.thread\); return true; \}/);
  assert.match(power, /const ed = t\.closest\('\[data-errdismiss\]'\); if \(ed\) \{ dismissThread\(id, ed\.dataset\.errdismiss\); return true; \}/);
  assert.doesNotMatch(power, /Couldn’t dismiss · try again', ok \? 1400 : 2600/);
  assert.match(power, /const failedShown = s => [^\n]*!\(E && E\.dismissed\(s\)\);/);
  assert.match(power, /function errorsFilter\(list\) \{ return E \? list\.filter\(s => !E\.dismissed\(s\)\) : list; \}/);
  const sti = chats.slice(chats.indexOf('  function stiKind(s) {'), chats.indexOf('  const stiBadge'));
  assert.match(sti, /\(s\.status === 'failed' \|\| s\.status === 'interrupted' \|\| s\.queueReason === 'provider_access'\) && !window\.WosErrors\?\.dismissed\?\.\(s\) \? 'failed'/);
});

// Codex P2 on the PR: a Dismiss tap in a routed window must dismiss the row that window shows, not the id-first
// main row. Runs the real chat-power rowFor/dismissThread lines with a window per kind and a main row sharing the id.
test('Dismiss in a window dismisses the row that window shows, for every kind', () => {
  const power = read('web/core/chat-power.js');
  const a = power.indexOf('  const rowFor = (wid, sid) =>'), b = power.indexOf('  function rerenderAll()');
  for (const [name, agent] of KINDS) {
    const main = failedRow(''), routed = failedRow(agent || 'unused');
    const app = boot({ rows: [main] });
    const LIVE = { session: id => (id === main.id ? main : null), sessionFor: (id, ag) => (ag && id === routed.id ? routed : null) };
    const wins = { w1: { id: 'w1', agent } }, calls = [];
    const ctx = { LIVE, E: app.E, H: { win: id => wins[id] }, A: { owner: id => id, winAgent: w => w.agent || '' }, rerenderAll: () => calls.push('paint') };
    vm.runInNewContext(`${power.slice(a, b)}\nthis.dismissThread = dismissThread;`, ctx);
    ctx.dismissThread('w1', main.id);
    const shown = agent ? routed : main, other = agent ? main : null;
    assert.equal(app.E.dismissed(shown), true, `${name}: the shown row is dismissed`);
    if (other) assert.equal(app.E.dismissed(other), false, `${name}: the main row with the same id keeps its card`);
    assert.deepEqual(calls, ['paint'], `${name}: repainted at once`);
  }
});

test('Retry still hides the old failure until the list catches up (WosErrors.cleared)', () => {
  const row = failedRow(''), app = boot({ rows: [row] });
  assert.equal(typeof app.E.cleared?.set, 'function');
  app.E.cleared.set(row.id, Date.now());
  assert.equal(app.E.dismissed(row), true);
  app.E.cleared.set(row.id, Date.now() - 121e3);
  assert.equal(app.E.dismissed(row), false);
  const power = read('web/core/chat-power.js');
  assert.match(power, /E\?\.cleared\.set\(sid, Date\.now\(\)\);/);
});
