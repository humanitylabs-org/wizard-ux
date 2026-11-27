import { modelContext, runWithChatsModel } from './fixtures/chats-list-model.mjs';
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

// A Working thread must not drop into Ready while its history loads: the detail read has no run status.
const live = readFileSync(new URL('../web/live.js', import.meta.url), 'utf8')
const body = live.slice(live.indexOf('    async sessionInfo(id) {'), live.indexOf('    /* ---- thread actions ---- */'))
async function hydrate(listRow, detail) {
  const L = { agentSessions: {}, sessions: [listRow], windows: {}, agentOf: () => '' }
  const ctx = { L, titleRead:0, applyTitle() {}, AGENT_OF: new Map(), DETAIL: new Map(), otherAgent: () => false, normalize: () => detail, aq: () => '', applyLocal() {}, req: async () => ({ json: async () => ({ id: detail.id, wizard_retry_input: '' }) }) }
  runWithChatsModel(`L.sessionInfo=({${body}}).sessionInfo`, ctx)
  await L.sessionInfo(detail.id)
  return L.sessions[0]
}
for (const status of ['running', 'queued', 'waiting_for_approval'])
  test(`detail without a status keeps a ${status} thread where the list put it`, async () => {
    const row = await hydrate({ id: 'w1', status, queueReason: '', runId: 'r1' }, { id: 'w1', title: 'T', queueReason: '' })
    assert.equal(row.status, status)
    assert.equal(row.detailNeeded, false)
  })
test('detail that reports a status still wins', async () => {
  const row = await hydrate({ id: 'w1', status: 'completed' }, { id: 'w1', status: 'failed', queueReason: '' })
  assert.equal(row.status, 'failed')
})
// wizard-ux issue 2017: on a slow box the detail he opened a thread with can answer after he replied, once a newer list
// read already shows his reply running. That older detail must not put the thread back to finished (back in Inbox).
test('a detail asked before the last list read does not override its run status', async () => {
  const detail = { id: 'w1', status: 'completed', queueReason: '' }
  const L = { agentSessions: {}, sessions: [{ id: 'w1', status: 'completed' }], windows: {}, agentOf: () => '' }
  let answer, gate = new Promise(r => { answer = r })
  const ctx = { L, titleRead: 0, applyTitle() {}, AGENT_OF: new Map(), DETAIL: new Map(), otherAgent: () => false, normalize: () => ({ ...detail }), aq: () => '', applyLocal() {},
    req: async () => { await gate; return { json: async () => ({ id: 'w1', wizard_retry_input: '' }) } } }
  runWithChatsModel(`L.sessionInfo=({${body}}).sessionInfo`, ctx)
  const asked = L.sessionInfo('w1')
  await new Promise(r => setTimeout(r, 5))
  // A list read asked after the detail lands first: the reply's run is running.
  L.sessions = [{ id: 'w1', status: 'running', runId: 'run-1' }]; L.listAskedAt = Date.now()
  answer(); await asked
  assert.equal(L.sessions[0].status, 'running', 'the newer list read wins')
  // A detail asked after that list read still wins as before.
  await L.sessionInfo('w1')
  assert.equal(L.sessions[0].status, 'completed')
})
