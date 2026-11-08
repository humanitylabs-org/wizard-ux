import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { modelContext } from './fixtures/chats-list-model.mjs';
const live = fs.readFileSync(new URL('../web/live.js', import.meta.url), 'utf8');
const chats = fs.readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
const nav = fs.readFileSync(new URL('../web/core/workspace-navigation.js', import.meta.url), 'utf8');
const block = (text, a, b) => text.slice(text.indexOf(a), text.indexOf(b, text.indexOf(a)));
const line = (text, token) => text.split('\n').find(l => l.includes(token));
const now = Date.now(), at = new Date(now).toISOString();
const row = extra => ({ id: 'helper', title: 'Messenger settings', status: 'completed', updatedAt: at, lastUserAt: at, previewAt: at, preview: 'A fix is underway', attention: { state: 'needs_you', ask: 'Say what happens when you open Messenger' }, ...extra });
function harness(rows, { layout = 'status', snooze = false } = {}) {
  const c = modelContext({ Date, document: { documentElement: { dataset: {} } }, localStorage: { getItem: key => key === 'wos.chats.layout.v1' ? layout : null },
    window: { WizConfig: { dayStart: n => n - n % 864e5 }, WosSkinHost: { snoozeOrder: snooze ? 'last' : '' } },
    snoozeLast: () => snooze, seenKeyOf: s => s.id, assistantAt: s => s.previewAt, hasNew: () => true, WEEK: 7 * 864e5 });
  vm.runInContext(block(live, '  const DAY = 864e5;', '  // Agent Service owns box-wide preferences.') + block(live, '  const sectionTime =', '  async function fetchDispositions()') + '\nthis.group = groupWork;', c);
  vm.runInContext(`this.L = { deferred: {}, ok: true, sessionsFor: () => input, unified: () => input, seenOf: () => ({}), ${block(live, "    groups(agent = '') {", '    async refresh() {')} ${line(live, '    visibleUnread(rows)')} };`, vm.createContext(Object.assign(c, { input: rows })));
  vm.runInContext(block(chats, '  const WORKING_ST =', '\n  // Same sections') + '\n' + ['const deferredOf =', 'const attOf =', 'const waitsOn ='].map(t => line(chats, t)).join('\n') + '\nthis.needs = ({' + line(chats, '    needs: {') + '}).needs.test; this.waits = waitsOn; this.runWorking = isWorking;', c);
  vm.runInContext(block(nav, '  function chatsCount(live) {', '  function refreshChats(') + '\nthis.orbCount = chatsCount;', c);
  return c;
}
for (const layout of ['day', 'status']) for (const agent of ['', 'host-profile', 'container', 'restricted']) {
  test(`${layout}/${agent || 'main'}: helper ask stays Working, outside Ready/Needs-you/orb; helper completion returns it to Ready`, () => {
    const s = row({ agent, background: 'helper' }); const c = harness([s], { layout });
    assert.equal(c.group([s], now).working.length, 1);
    assert.equal(c.group([s], now).ready.length, 0);
    assert.equal(c.L.groups().working.length, 1);
    assert.equal(c.L.groups().needs.length + c.L.groups().ready.length, 0);
    assert.equal(c.needs(s), false); assert.equal(c.waits(s), false);
    assert.equal(c.orbCount(c.L), 0);
    assert.equal(c.runWorking(s), false, 'a helper must not become a steer/Stop target');
    s.background = '';
    assert.equal(c.group([s], now).working.length, 0);
    assert.equal(c.group([s], now).ready.length, 1);
    assert.equal(c.needs(s), true); assert.equal(c.waits(s), true);
    assert.equal(c.orbCount(c.L), 1);
  });
}
for (const helperStatus of [{ phase: 'stalled', pending: 0, returned: 1 }, { phase: 'failed', failed: true, pending: 0 }]) {
  test(`stopped helper ${helperStatus.phase} is Ready, Needs-you and orb, not Working`, () => {
    const s = row({ status: 'running', waitingOn: 'helper', helperStatus, runId: 'old', lastRunStatus: 'completed' }), c = harness([s]);
    assert.equal(c.group([s], now).working.length, 0);
    assert.equal(c.group([s], now).ready.length, 1);
    assert.equal(c.L.groups().working.length, 0);
    assert.equal(c.needs(s), true); assert.equal(c.waits(s), true); assert.equal(c.orbCount(c.L), 1);
  });
}
for (const extra of [{ background: 'helper' }, { runId: 'live', lastRunStatus: 'running' }, { helperStatus: { phase: 'running', pending: 0 } }, { helperStatus: { phase: 'stalled', pending: 1 } }]) {
  test(`real run or active helper remains Working: ${JSON.stringify(extra)}`, () => {
    const s = row({ status: 'running', waitingOn: 'helper', helperStatus: { phase: 'stalled', pending: 0 }, ...extra }), c = harness([s]);
    assert.equal(c.group([s], now).working.length, 1);
    assert.equal(c.needs(s), false); assert.equal(c.orbCount(c.L), 0);
  });
}
test('plain Needs you and tracker-only running items remain Ready', () => {
  for (const extra of [{}, { tracker: { running: 4 }, items: [{ state: 'running' }], runId: 'old-id' }]) {
    const s = row(extra), c = harness([s]);
    assert.equal(c.group([s], now).ready.length, 1);
    assert.equal(c.group([s], now).working.length, 0);
    assert.equal(c.needs(s), true); assert.equal(c.orbCount(c.L), 1);
  }
});
test('live runs and queues with an ask count only as Working', () => {
  for (const status of ['submitting', 'queued', 'running', 'stopping']) for (const state of ['needs_you', 'check']) {
    const s = row({ status, attention: { state, ask: 'Try Messenger' } }), c = harness([s]);
    assert.equal(c.group([s], now).working.length, 1);
    assert.equal(c.needs(s), false); assert.equal(c.waits(s), false); assert.equal(c.orbCount(c.L), 0);
  }
});
test('archived, snoozed and provider-access-blocked threads retain their existing disposition', () => {
  const archived = row({ archived: true, background: 'helper' });
  assert.equal(harness([archived]).group([archived], now).archive.length, 1);
  const snoozed = row({ deferred: true, deferredAt: at });
  assert.equal(harness([snoozed]).group([snoozed], now).deferred.length, 1);
  assert.equal(harness([snoozed], { snooze: true }).group([snoozed], now).ready.length, 1);
  const blocked = row({ status: 'queued', queueReason: 'provider_access' });
  assert.equal(harness([blocked]).group([blocked], now).errors.length, 1);
});
test('check + heavy helper is Working until helper completion', () => {
  const s = row({ background: 'heavy', attention: { state: 'check', ask: 'Try it' } }), c = harness([s]);
  assert.equal(c.group([s], now).working.length, 1); assert.equal(c.waits(s), false); assert.equal(c.orbCount(c.L), 0);
  s.background = ''; assert.equal(c.group([s], now).ready.length, 1); assert.equal(c.waits(s), true);
});
test('full and slim list projection retain the Working ask and badge in every runtime kind', () => {
  const c = modelContext({});
  vm.runInContext(block(live, '  const READY_OR_ATTENTION', '  /* ---- thread-seen') + '\nthis.normalize = normalize;', c);
  for (const agent of ['', 'host-profile', 'container', 'restricted']) for (const slim of [false, true]) {
    const s = c.normalize(slim ? { ...row({ agent, background: 'helper' }), listVersion: 1 } : { id: 'helper', title: 'Messenger settings', status: 'completed', agent, wizard_attention: row({}).attention, wizard_background: 'helper', last_active: now / 1000 });
    const h = harness([s]);
    assert.equal(h.group([s], now).working.length, 1);
    assert.equal(h.orbCount(h.L), 0);
    const projected = c.WizChatsListModel.sessionList(h.group([s], now), { live: { isNew: () => true }, chats: { threadActions: () => [] } });
    assert.equal(projected.working[0].workingAsk.ask, row({}).attention.ask);
    assert.equal(projected.working[0].background, 'helper');
    assert.equal(projected.ready.length, 0);
  }
});
test('real chat row keeps the amber ask (tracker off) with no helper badge, for helper and live-run cases', () => {
  const c = harness([]);
  Object.assign(c, { LIVE: { isNew: () => true, cardAt: () => at }, esc: s => String(s), clip: s => s, workLabel: () => 'Working', ago: () => 'now',
    topicOn: () => false, privRow: () => false, PIN: { has: () => false, on: () => false }, BOOM: () => null,
    STI: { needs: '!', working: '~' }, STI_TIP: {}, STI_LAB: { needs: 'Needs you' },
    ATT: { needs_you: { cls: 'needs', label: 'Needs you' } }, stiKind: s => s.status === 'running' ? 'working' : 'needs' });
  vm.runInContext(block(chats, '  function chatRow(', '  /* Ready has three orders') + '\nthis.renderRow = chatRow;', c);
  for (const status of ['completed', 'running']) {
    const html = c.renderRow(row({ status, background: 'helper' }));
    assert.doesNotMatch(html, /Helper still working|ch-background/, 'the Working spinner says it (James, 7 Nov 2026)');
    assert.match(html, /<em class="att needs">Needs you:<\/em>/);
    assert.match(html, /Say what happens when you open Messenger/);
  }
});

// James, 7 Nov 2026 ('Wizard OS · Chats #2'): a false Interrupted run filed the thread under
// Errors / inbox Needs you while two helpers it had started were still running. Any running worker
// keeps it in Working, with the error status kept for the thread's card; Errors only once all stop.
const running = { phase: 'running', pending: 2, returned: 0 };
for (const status of ['interrupted', 'failed']) {
  for (const extra of [{ helperStatus: running }, { background: 'helper' }, { background: 'heavy' }]) {
    test(`${status} + running worker ${JSON.stringify(extra)} is Working, outside Errors/Ready/Needs-you/orb`, () => {
      const s = row({ status, attention: { state: 'fyi', ask: 'Two fixes are being built' }, ...extra });
      for (const layout of ['day', 'status']) {
        const c = harness([s], { layout }), g = c.group([s], now);
        assert.equal(g.working.length, 1); assert.equal(g.errors.length + g.ready.length, 0);
        assert.equal(c.L.groups().working.length, 1); assert.equal(c.L.groups().needs.length + c.L.groups().ready.length, 0);
        assert.equal(c.needs(s), false); assert.equal(c.waits(s), false); assert.equal(c.orbCount(c.L), 0);
        assert.equal(c.runWorking(s), false, 'not a steer/Stop target');
        assert.equal(s.status, status, 'the thread keeps its error status for the card');
      }
    });
  }
  for (const helperStatus of [null, { phase: 'stalled', pending: 0, returned: 2 }, { phase: 'uncertain', pending: 1 }]) {
    test(`${status} with ${helperStatus ? helperStatus.phase + ' helper' : 'no helper'} is not Working (Errors / inbox Needs you)`, () => {
      const s = row({ status, helperStatus, attention: { state: 'fyi', ask: 'Two fixes are being built' } }), c = harness([s]);
      const g = c.group([s], now);
      assert.equal(g.working.length, 0); assert.equal(g.errors.length, 1);
      assert.equal(c.L.groups().working.length, 0); assert.equal(c.L.groups().needs.length, 1);
    });
  }
}
test('fyi + running helper is Working; approvals and recovery keep their gate', () => {
  const s = row({ status: 'completed', attention: { state: 'fyi', ask: 'Two fixes are being built' }, helperStatus: running }), c = harness([s]);
  assert.equal(c.group([s], now).working.length, 1); assert.equal(c.group([s], now).ready.length, 0); assert.equal(c.orbCount(c.L), 0);
  for (const status of ['waiting_for_approval', 'unknown']) {
    const gate = row({ status, helperStatus: running }), h = harness([gate]);
    assert.equal(h.group([gate], now).working.length, 0);
    assert.equal(h.L.groups().needs.length, 1);
  }
});
test('slim and full list rows carry the running helper of an interrupted thread into Working', () => {
  const c = modelContext({});
  vm.runInContext(block(live, '  const READY_OR_ATTENTION', '  /* ---- thread-seen') + '\nthis.normalize = normalize;', c);
  const full = c.normalize({ id: 'err', title: 'Wizard OS · Chats', status: 'interrupted', wizard_helper_status: running, last_active: now / 1000 });
  const slim = c.normalize({ ...row({ status: 'interrupted', helperStatus: running }), listVersion: 1 });
  for (const s of [full, slim]) {
    assert.equal(s.status, 'interrupted');
    assert.equal(harness([s]).group([s], now).working.length, 1);
  }
});

// A turn that handed off to a durable background job (a deploy or a heavy job) is waiting on it: Working,
// labelled as such, no Resume. A genuinely dead chat keeps "Stuck" and Resume (James, 8 Nov 2026).
const workScript = fs.readFileSync(new URL('../web/core/chat-work.js', import.meta.url), 'utf8');
const WosWork = (() => { const w = {}; vm.runInNewContext(workScript, { window: w, document: {}, console }); return w.WosWork; })();
const returned = { phase: 'stalled', pending: 0, returned: 2, since: now / 1000 - 258, resumeEligible: true };
for (const layout of ['day', 'status']) {
  test(`${layout}: returned helpers plus a running background job stay Working, not Ready`, () => {
    const s = row({ status: 'running', waitingOn: 'helper', background: 'heavy', attention: { state: 'fyi', ask: 'Background work is still running or waiting to report back.' },
      helperStatus: { ...returned, phase: 'background', resumeEligible: false }, runId: 'old', lastRunStatus: 'completed' }), c = harness([s], { layout });
    assert.equal(c.group([s], now).working.length, 1);
    assert.equal(c.group([s], now).ready.length, 0);
    assert.equal(c.L.groups().working.length, 1);
    assert.equal(c.L.groups().ready.length + c.L.groups().needs.length, 0);
    assert.equal(c.needs(s), false);
    assert.equal(c.orbCount(c.L), 0);
  });
}
test('background-job wait reads as waiting, not stuck, with no Continue; a dead chat still reads Stuck with Continue', () => {
  const wait = WosWork.helperLabel({ ...returned, phase: 'background', resumeEligible: false }, now);
  assert.match(wait, /^Waiting on a background job · /);
  assert.doesNotMatch(wait, /Stuck/);
  assert.match(WosWork.helperDetail({ phase: 'background' }), /nothing is needed from you/);
  assert.match(WosWork.helperLabel(returned, now), /^Stuck · helpers returned, no agent running/);
  assert.match(WosWork.helperDetail(returned), /Continue resumes/);
});
