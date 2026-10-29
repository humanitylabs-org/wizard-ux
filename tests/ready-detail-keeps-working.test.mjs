import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

// A Working thread must not drop into Ready while its history loads: the detail read has no run status.
const live = readFileSync(new URL('../web/live.js', import.meta.url), 'utf8')
const body = live.slice(live.indexOf('    async sessionInfo(id) {'), live.indexOf('    /* ---- thread actions ---- */'))
async function hydrate(listRow, detail) {
  const L = { agentSessions: {}, sessions: [listRow], windows: {}, agentOf: () => '' }
  const ctx = { L, AGENT_OF: new Map(), DETAIL: new Map(), otherAgent: () => false, normalize: () => detail, aq: () => '', applyLocal() {}, req: async () => ({ json: async () => ({ id: detail.id, wizard_retry_input: '' }) }) }
  vm.runInNewContext(`L.sessionInfo=({${body}}).sessionInfo`, ctx)
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
