import test from 'node:test';
import assert from 'node:assert/strict';
import { helperWorkingHarness, liveSource } from './helpers/helper-working-harness.mjs';

for (const slim of [true, false]) for (const agent of ['', 'helper']) test(`${slim ? 'slim' : 'full'} ${agent || 'main'}: notice + queued owner message stays Working beyond the optimistic timeout`, async () => {
  const at = '2026-11-05T07:13:00Z';
  const ask = { state: 'needs_you', ask: 'An update is waiting. Restart it in Console' };
  const raw = slim ? { listVersion: 1, id: 'synthetic', title: 'Fixture', status: 'completed', runId: 'test-run', lastRunStatus: 'running', lastRunKey: 'test-send', attention: ask, preview: 'Why is this in Ready?', previewRole: 'user', previewAt: at }
    : { id: 'synthetic', title: 'Fixture', status: 'completed', wizard_run_id: 'test-run', wizard_last_run_status: 'running', wizard_last_run_idempotency_key: 'test-send', wizard_attention: ask, latest_message: { role: 'user', content: 'Why is this in Ready?', timestamp: at } };
  const t = helperWorkingHarness({ source: liveSource(), row: raw, detail: {}, agent });
  await t.poll();
  const working = () => {
    const s = t.rows()[0], groups = t.L.workGroups([s]);
    assert.equal(s.status, 'running');
    assert.equal(groups.working.length, 1);
    assert.equal(groups.ready.length + groups.yesterday.length + groups.pastWeek.length, 0);
    // This is the projection both shell adapters/AI apps consume.
    const rows = t.context.WizChatsListModel.sessionList(groups, { live: t.L, chats: { stiKind: () => 'none', threadActions: () => [] } });
    assert.equal(rows.working.length, 1); assert.equal(rows.ready.length, 0);
  };
  working(); t.send(); t.advance(40 * 60e3); await t.poll(); working();
  // The notice may be classified only after the controller says terminal.
  t.setRow(slim ? { ...raw, status: 'completed', runId: '', lastRunStatus: 'completed' } : { ...raw, status: 'completed', wizard_run_id: '', wizard_last_run_status: 'completed' });
  await t.poll();
  assert.equal(t.L.workGroups(t.rows()).working.length, 0);
});

test('run id alone cannot manufacture Working; approval, provider gate and settled receipts retain their meaning', async () => {
  const t = helperWorkingHarness({ source: liveSource(), row: { id: 'synthetic' }, detail: {} });
  const M = t.context.WizChatsListModel;
  assert.equal(M.executionStatus('completed', 'old-run', 'completed'), 'completed');
  assert.equal(M.executionStatus('completed', 'old-run', undefined), 'completed');
  assert.equal(M.executionStatus('completed', '', 'running'), 'completed');
  assert.equal(M.executionStatus('waiting_for_approval', 'live', 'running'), 'waiting_for_approval');
  assert.equal(M.executionStatus('unknown', 'live', 'running'), 'unknown');
  const s = t.api.normalize({ listVersion: 1, id: 'synthetic', status: 'queued', queueReason: 'provider_access', runId: 'live', lastRunStatus: 'queued' });
  assert.equal(t.L.workGroups([s]).working.length, 0);
});
