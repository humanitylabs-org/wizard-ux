// Pinned chats, synced per owner through the shared shell preferences. Design: Novaire, wizard-ux #250.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8')
function load({ local = {}, server = [], status = 200 } = {}) {
  const m = new Map(Object.entries(local)), puts = [], events = []
  let shared = server.slice()
  const sandbox = {
    localStorage: { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) },
    Event: class { constructor(t) { this.type = t } }, addEventListener() {}, dispatchEvent: e => events.push(e.type), setTimeout: () => 0,
    fetch: async (url, init = {}) => {
      if (init.method === 'PUT') { const b = JSON.parse(init.body); puts.push(b); shared = b.pinnedChats; return { ok: status === 200, status } }
      return { ok: status === 200, status, json: async () => ({ pinnedChats: shared }) }
    },
    WizLive: { putPrefs: patch => puts.push(patch) },
  }
  sandbox.window = sandbox
  vm.runInNewContext(read('web/core/chat-pins.js'), sandbox)
  return { P: sandbox.WosChatPins, m, puts, events, shared: () => shared }
}

test('pins are owner-scoped: every change goes to the shared preferences', () => {
  const { P, puts, m } = load()
  assert.equal(P.scope, 'owner')
  assert.equal(P.toggle('wizard_a'), true)
  assert.equal(P.toggle('wizard_b'), true)
  assert.equal(P.toggle('wizard_a'), false)
  assert.deepEqual(puts.map(p => [...p.pinnedChats]), [['wizard_a'], ['wizard_a', 'wizard_b'], ['wizard_b']])
  assert.equal(m.get('wos.chats.pinned.v2'), '["wizard_b"]')
})

test('live.js syncs pinnedChats into the cache the pins read', () => {
  const live = read('web/live.js')
  assert.match(live, /pinnedChats: \['wos\.chats\.pinned\.v2'/)
})

test('local pins from before sync are merged into the shared list once', async () => {
  const { P, m, shared } = load({ local: { 'wos.chats.pinned.v1': '["wizard_old","wizard_both"]' }, server: ['wizard_both', 'wizard_phone'] })
  await P._migrate()
  assert.deepEqual([...shared()], ['wizard_both', 'wizard_phone', 'wizard_old'])
  assert.equal(m.get('wos.chats.pinned.migrated.v1'), '1')
  assert.equal(m.get('wos.chats.pinned.v1'), undefined)
  assert.deepEqual([...P.ids()], ['wizard_both', 'wizard_phone', 'wizard_old'])
})

test('an older or offline service keeps local pins and retries the migration later', async () => {
  const { P, m } = load({ local: { 'wos.chats.pinned.v1': '["wizard_old"]' }, status: 404 })
  await P._migrate()
  assert.equal(m.get('wos.chats.pinned.migrated.v1'), undefined)
  assert.equal(m.get('wos.chats.pinned.v1'), '["wizard_old"]')
})

test('partition keeps pin order and leaves archived pins where they are', () => {
  const { P } = load({ local: { 'wos.chats.pinned.v2': '["c","a","z"]' } })
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c', archived: true }]
  const { pinned, rest } = P.partition(rows, r => !r.archived)
  assert.deepEqual([...pinned.map(r => r.id)], ['a'])
  assert.deepEqual([...rest.map(r => r.id)], ['b', 'c'])
})

test('rows carry a pin control and the long-press / right-click sheet offers Pin', () => {
  const js = read('web/core/chats.js')
  assert.match(js, /class="ch-pin-toggle" data-chpin=/)
  assert.match(js, /data-rspin>\$\{PIN_SVG\}\$\{PIN\.has\(sid\) \? 'Unpin' : 'Pin'\}/)
  assert.match(js, /data-sec="pinned"/)
})
