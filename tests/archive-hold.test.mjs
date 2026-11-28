// Chats Archive works like TG style (wizard-ux issue 2063, switch wizard/archive-hold, off by default).
// The real hold rules (web/live.js holdStart / holdApply) in a vm with a fake clock; the browser proof on a lagging box
// is tests/qa-archive-hold.cjs (phone + desktop, settled + working + long run, owner send, agent message, the tag).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const live = read('web/live.js');
const cut = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i + 1); assert.ok(i >= 0 && j > i, a); return src.slice(i, j); };

function harness({ on = true } = {}) {
  const store = {}, writes = [], clock = { now: Date.parse('2026-11-28T10:00:00Z') };
  const ctx = vm.createContext({
    Date: class extends Date { static now() { return clock.now; } },
    document: { documentElement: { dataset: { tweaks: on ? 'wizard/archive-hold' : '' } } },
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } },
    PEND: new Map(), WORKING: new Set(['submitting', 'queued', 'running', 'stopping']), inWorking: () => false,
    needsApproval: s => ['waiting_for_approval', 'unknown'].includes(s.status), titleScope: s => `${s.agent || 'hermes'}:${s.id}`,
    DAY: 864e5, J: {}, aq: () => '', req: (url, init) => { writes.push({ url, body: JSON.parse(init.body) }); return Promise.resolve({ ok: true }); },
    setTimeout: fn => fn(), isFinite, JSON, Math, Object, Map,
  });
  vm.runInContext(cut(live, '  const ARCHIVE_HOLD =', '  const STOPPING = new Map();') + '\nthis.H = { holdStart, holdApply, holdOn, BACK, HOLD, holdEnd };', ctx);
  const iso = ms => new Date(ms).toISOString();
  // A list row as the box answers it, run through the hold like applyLocal does.
  const t0 = clock.now; // his last send and the agent's last answer were before the archive
  const row = (fields = {}) => { const s = { id: 's1', status: 'completed', runId: 'run-1', archived: false, lastUserAt: iso(t0 - 600e3), lastAssistantAt: iso(t0 - 500e3), ...fields }; ctx.H.holdApply(s); return s; };
  return { ctx, H: ctx.H, clock, writes, store, row, iso, tick: ms => { clock.now += ms; } };
}

test('switch off: Archive holds nothing and the list decides, as today', () => {
  const t = harness({ on: false });
  t.H.holdStart({ id: 's1', status: 'completed', runId: 'run-1' });
  assert.deepEqual(Object.keys(t.H.HOLD), []);
  assert.equal(t.row({ archived: false }).archived, false, 'a lagging list puts it back, unchanged behaviour');
  assert.deepEqual(t.writes, []);
});

test('a settled chat stays archived while the list lags, then follows the box', () => {
  const t = harness();
  t.H.holdStart({ id: 's1', status: 'completed', runId: 'run-1' });
  for (const step of [1000, 4000, 10000, 15000, 29000]) { t.tick(step); assert.equal(t.row({ archived: false }).archived, true, 'held while the list lags'); }
  t.tick(2000); assert.equal(t.row({ archived: true }).archived, true, 'the box has it archived');
  assert.deepEqual(t.writes, [], 'no extra writes for a settled chat');
});

test('his own send lets it back at once, with no tag', () => {
  const t = harness();
  t.H.holdStart({ id: 's1', status: 'completed', runId: 'run-1' });
  t.tick(5000);
  const s = t.row({ archived: false, lastUserAt: t.iso(t.clock.now) });
  assert.equal(s.archived, false);
  assert.deepEqual(Object.keys(t.H.HOLD), []);
  assert.equal(t.H.BACK['hermes:s1'], undefined, 'no "Back" tag for his own send');
  // A send still held on this device counts too.
  t.H.holdStart({ id: 's1', status: 'completed', runId: 'run-1' }); t.tick(1000);
  t.ctx.PEND.set('s1', { at: t.clock.now });
  assert.equal(t.row({ archived: true }).archived, true, 'the box row says archived; the hold no longer forces anything');
  assert.deepEqual(Object.keys(t.H.HOLD), []);
});

test('the reply of the run that was going keeps it archived and writes archived again', () => {
  const t = harness();
  t.H.holdStart({ id: 's1', status: 'running', runId: 'run-w1' });
  assert.equal(t.H.HOLD['hermes:s1'].run, 'run-w1');
  t.tick(5000);
  // The run ends; the Agent Service re-opens the thread with its reply (wizard-ux issue 1997).
  assert.equal(t.row({ archived: false, runId: 'run-w1', lastAssistantAt: t.iso(t.clock.now) }).archived, true, 'held inside 60 s');
  t.tick(60000);
  const s = t.row({ archived: false, runId: 'run-w1', lastAssistantAt: t.iso(t.clock.now - 60000) });
  assert.equal(s.archived, true, 'still archived after the hold: it was the old run');
  assert.deepEqual(t.writes.map(w => w.body), [{ archived: true }], 'archived again on the box, so other devices follow');
  assert.equal(t.H.BACK['hermes:s1'], undefined, 'no tag');
  // While the box catches up with that write, the lagging list still says un-archived: held again.
  t.tick(10000); assert.equal(t.row({ archived: false, runId: 'run-w1', lastAssistantAt: t.iso(t.clock.now - 70000) }).archived, true);
  assert.equal(t.writes.length, 1, 'one write, not one per poll');
});

test('a new agent message from another run brings it back with the tag, until he opens it', () => {
  const t = harness();
  t.H.holdStart({ id: 's1', status: 'completed', runId: 'run-1' });
  t.tick(120000);
  assert.equal(t.row({ archived: true }).archived, true);
  t.tick(600000);
  const s = t.row({ archived: false, runId: 'run-2', lastAssistantAt: t.iso(t.clock.now) });
  assert.equal(s.archived, false, 'back in the list');
  assert.ok(t.H.BACK['hermes:s1'], 'tagged as brought back by the agent');
  assert.ok(t.store['wos.archive-back.v1'].includes('hermes:s1'), 'the tag survives a reload');
  // The working chat's own run done, a later watch writes: same rule.
  const w = harness();
  w.H.holdStart({ id: 's1', status: 'running', runId: 'run-w1' });
  w.tick(70000); w.row({ archived: false, runId: 'run-w1', lastAssistantAt: w.iso(w.clock.now - 1000) });
  w.tick(3600e3);
  assert.equal(w.row({ archived: false, runId: 'run-watch', lastAssistantAt: w.iso(w.clock.now) }).archived, false);
  assert.ok(w.H.BACK['hermes:s1']);
});

test('an approval wait or a Restore on another device lets it back quietly', () => {
  const t = harness();
  t.H.holdStart({ id: 's1', status: 'running', runId: 'run-w1' });
  t.tick(2000);
  assert.equal(t.row({ archived: false, status: 'waiting_for_approval' }).archived, false, 'an approval never stays archived');
  assert.equal(t.H.BACK['hermes:s1'], undefined);
  const r = harness();
  r.H.holdStart({ id: 's1', status: 'completed', runId: 'run-1' });
  r.tick(300000);
  assert.equal(r.row({ archived: false }).archived, false, 'nothing new from anyone: his Restore elsewhere wins');
  assert.deepEqual(Object.keys(r.H.HOLD), []); assert.equal(r.H.BACK['hermes:s1'], undefined); assert.deepEqual(r.writes, []);
});


test('a refused archive write is tried again once after 1.2 s; a second refusal brings the chat back', async () => {
  // The real LIVE._act and archive (web/live.js) with the hold helpers above and fake timers.
  const run = async answers => {
    const t = harness(), timers = [], calls = [];
    const s = { id: 's1', archived: false, status: 'completed', runId: 'run-1' };
    Object.assign(t.ctx, { OVER: new Map(), hasNew: () => false, S: s, Promise, Error, readRestored: () => ({}), writeRestored() {}, encodeURIComponent,
      req: async (url, init) => { calls.push(JSON.parse(init.body)); if (!answers.shift()) throw new Error('HTTP 500'); return { ok: true }; },
      setTimeout: (fn, ms) => { if (ms === 1200) timers.push(fn); return 1; }, clearTimeout() {} });
    const L = vm.runInContext(`({ session: () => S, emit() {}, refresh() {}, seenOf() {}, agentOf: () => '',\n${cut(live, '    busy(id) {', '    // Stop exactly the watcher')} })`, t.ctx);
    const p = L.archive('s1');
    assert.equal(s.archived, true, 'out of the list on the click');
    for (let i = 0; i < 20 && !timers.length && calls.length < 2; i++) await new Promise(r => setImmediate(r));
    if (timers.length) { assert.equal(s.archived, true, 'still out while it waits to try again'); timers.shift()(); }
    return { ok: await p, s, calls, hold: { ...t.H.HOLD } };
  };
  const once = await run([false, true]);
  assert.equal(once.ok, true); assert.equal(once.s.archived, true); assert.equal(once.calls.length, 2, 'tried again once');
  assert.ok(once.hold['hermes:s1'], 'held after the retry worked');
  const twice = await run([false, false]);
  assert.equal(twice.ok, false); assert.equal(twice.s.archived, false, 'back where it was, with the usual error'); assert.equal(twice.calls.length, 2, 'never a third try');
  assert.deepEqual(twice.hold, {}, 'no hold left behind');
});

test('every agent kind: main, host-profile, container and restricted rows hold and come back by the same rules, each on its own agent', () => {
  for (const [agent] of [['hermes'], ['host-ops'], ['box'], ['locked']]) {
    const t = harness(), aqs = [];
    t.ctx.aq = id => { aqs.push(id); return agent === 'hermes' ? '' : `?agent=${agent}`; };
    const routed = agent === 'hermes' ? {} : { agent };
    t.H.holdStart({ id: 's1', status: 'running', runId: 'run-w1', ...routed });
    // The same id on another agent is another chat: never held by this archive.
    const other = { id: 's1', agent: agent === 'hermes' ? 'box' : 'hermes', status: 'completed', archived: false };
    t.ctx.H.holdApply(other); assert.equal(other.archived, false, `${agent}: another agent's chat with the same id is untouched`);
    t.tick(5000); assert.equal(t.row({ archived: false, ...routed }).archived, true, `${agent}: held`);
    t.tick(60000);
    assert.equal(t.row({ archived: false, runId: 'run-w1', lastAssistantAt: t.iso(t.clock.now - 1000), ...routed }).archived, true, `${agent}: old run's reply stays archived`);
    assert.deepEqual(t.writes.map(w => w.url), [`/wizard/hermes/api/sessions/s1${agent === 'hermes' ? '' : `?agent=${agent}`}`], `${agent}: archived again on its own agent`);
    t.tick(600000);
    assert.equal(t.row({ archived: false, runId: 'run-new', lastAssistantAt: t.iso(t.clock.now), ...routed }).archived, false);
    assert.ok(t.H.BACK[`${agent}:s1`], `${agent}: tagged on its own key`);
  }
});

test('browser regression on a lagging box (phone + desktop)', { skip: !process.env.QA_PLAYWRIGHT }, () => {
  const r = spawnSync(process.execPath, [new URL('./qa-archive-hold.cjs', import.meta.url).pathname], { encoding: 'utf8', env: { ...process.env, QA_SWITCH: 'on' } });
  assert.equal(r.status, 0, r.stdout.slice(-3000));
});
