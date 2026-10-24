import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

test('shared agent visibility excludes hidden discovery choices, not owner settings or explicit routes', async () => {
  const agents = [
    { id: 'hermes', label: 'Archimedes', is_default: true },
    { id: 'philosopher', label: 'Philosopher' },
    { id: 'archimedes-new', label: 'Archimedes (new)', hidden: true },
  ]
  const ctx = { window: {}, document: { documentElement: { dataset: {} }, querySelectorAll: () => [] }, location: { pathname: '/agents/' }, fetch: async () => ({ ok: true, json: async () => ({ agents }) }), console }
  vm.runInNewContext(readFileSync(new URL('../web/core/agents.js', import.meta.url), 'utf8'), ctx)
  const A = ctx.window.WosAgents
  await A.load()
  assert.deepEqual(Array.from(A.visible(), a => a.id), ['hermes', 'philosopher'])
  assert.deepEqual(Array.from(A.others(), a => a.id), ['philosopher'])
  assert.equal(A.list.length, 3, 'owner Settings retains hidden agents')
  assert.equal(A.get('archimedes-new').hidden, true, 'explicit existing routes retain hidden target')
  agents[2].hidden = false
  await A.load(true)
  assert.equal(A.visible().length, 3, 'unhide restores every shared discovery consumer')
})
