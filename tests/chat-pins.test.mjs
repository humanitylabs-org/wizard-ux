// Pinned chats, synced per owner through the shared shell preferences. Design: Novaire, wizard-ux #250.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8')
function load({ local = {}, server = [], status = 200, box = null } = {}) {
  const m = new Map(Object.entries(local)), puts = [], events = []
  let shared = server.slice()
  // box: one service shared by several devices; its fetch may interleave their reads and writes.
  if (box) return loadOn(box, m)
  const sandbox = {
    localStorage: { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) },
    Event: class { constructor(t) { this.type = t } }, addEventListener() {}, dispatchEvent: e => events.push(e.type), setTimeout: () => 0, clearTimeout() {},
    fetch: async (url, init = {}) => {
      if (init.method === 'PUT') { const b = JSON.parse(init.body); puts.push(b); if (status === 200) shared = b.pinnedChats; return { ok: status === 200, status } }
      return { ok: status === 200, status, json: async () => ({ pinnedChats: shared }) }
    },
  }
  sandbox.window = sandbox
  vm.runInNewContext(read('web/core/chat-pins.js'), sandbox)
  // Another device editing the shared list directly.
  return { P: sandbox.WosChatPins, m, puts, events, shared: () => shared, setShared: v => { shared = v.slice() } }
}
const settle = P => P.sync()
function loadOn(box, m) {
  const sandbox = {
    localStorage: { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) },
    Event: class { constructor(t) { this.type = t } }, addEventListener() {}, dispatchEvent() {}, setTimeout: () => 0, clearTimeout() {},
    fetch: async (url, init = {}) => {
      await box.gate()
      if (init.method === 'PUT') { box.list = JSON.parse(init.body).pinnedChats; return { ok: true, status: 200 } }
      const snap = box.list.slice(); return { ok: true, status: 200, json: async () => ({ pinnedChats: snap }) }
    },
  }
  sandbox.window = sandbox
  vm.runInNewContext(read('web/core/chat-pins.js'), sandbox)
  return { P: sandbox.WosChatPins, m }
}
// Both devices read before either writes (GET, GET, PUT, PUT), then everything flows.
function racingBox(list = []) {
  const box = { list, n: 0, waiters: [] }
  box.gate = () => box.n++ < 2 ? new Promise(r => { box.waiters.push(r); if (box.waiters.length === 2) box.waiters.splice(0).forEach(f => f()) }) : Promise.resolve()
  return box
}

test('two devices pinning at the same moment both keep their pin', async () => {
  const box = racingBox(), desk = load({ box }), phone = load({ box })
  desk.P.toggle('wizard_desk'); phone.P.toggle('wizard_phone')
  await Promise.all([desk.P.sync(), phone.P.sync()])
  assert.deepEqual([...box.list].sort(), ['wizard_desk', 'wizard_phone'])
  assert.equal(desk.P.pending() + phone.P.pending(), 0)
})

// Agent chat parity: pins key on the row id the list renders, the same for the main agent and every routed kind.
const KINDS = { main: 'wizard_1793157258294_34b4a71ae61a', 'host-profile': '20261028_101500_ab12cd', container: 'agent-research:20261028_101501_ef34', restricted: 'restricted.vault_20261028-101502' }
for (const [kind, id] of Object.entries(KINDS)) test(`${kind} thread: a pin on one device shows on another`, async () => {
  const box = { list: [], gate: () => Promise.resolve() }, desk = load({ box }), phone = load({ box })
  desk.P.toggle(id); await desk.P.sync()
  phone.m.set('wos.chats.pinned.v2', JSON.stringify(box.list)) // what live.js's pull writes on the phone
  const rows = Object.values(KINDS).map(x => ({ id: x }))
  assert.deepEqual([...phone.P.partition(rows).pinned.map(r => r.id)], [id])
  phone.P.toggle(id); await phone.P.sync()
  assert.deepEqual([...box.list], [])
})

test('pins are owner-scoped: every change goes to the shared preferences', async () => {
  const { P, m, shared } = load()
  assert.equal(P.scope, 'owner')
  assert.equal(P.toggle('wizard_a'), true); await settle(P)
  assert.equal(P.toggle('wizard_b'), true); await settle(P)
  assert.equal(P.toggle('wizard_a'), false); await settle(P)
  assert.deepEqual([...shared()], ['wizard_b'])
  assert.equal(m.get('wos.chats.pinned.v2'), '["wizard_b"]')
  assert.equal(P.pending(), 0)
})

test('a device that has not pulled yet never drops a pin made on another device', async () => {
  const { P, shared, setShared } = load({ local: { 'wos.chats.pinned.v2': '[]' } })
  setShared(['wizard_desk']) // pinned on the desktop; this phone still caches []
  P.toggle('wizard_phone'); await settle(P)
  assert.deepEqual([...shared()], ['wizard_desk', 'wizard_phone'])
  assert.deepEqual([...P.ids()], ['wizard_desk', 'wizard_phone'])
})

test('an unpin on another device is not undone by a stale device', async () => {
  const { P, shared, setShared } = load({ local: { 'wos.chats.pinned.v2': '["wizard_x","wizard_y"]' }, server: ['wizard_x', 'wizard_y'] })
  setShared(['wizard_y']) // unpinned elsewhere
  P.toggle('wizard_z'); await settle(P)
  assert.deepEqual([...shared()], ['wizard_y', 'wizard_z'])
})

test('taps made offline stay pinned locally and reach the service later', async () => {
  const box = load({ status: 503 })
  box.P.toggle('wizard_a'); await settle(box.P)
  assert.deepEqual([...box.P.ids()], ['wizard_a'])
  assert.equal(box.P.pending(), 1)
  // Same device storage, service back.
  const later = load({ local: Object.fromEntries(box.m), server: ['wizard_other'] })
  assert.deepEqual([...later.P.ids()], ['wizard_a'])
  await settle(later.P)
  assert.deepEqual([...later.shared()], ['wizard_other', 'wizard_a'])
  assert.equal(later.P.pending(), 0)
})

test('live.js syncs pinnedChats into the cache the pins read, and pulls when a phone comes back', () => {
  const live = read('web/live.js')
  assert.match(live, /pinnedChats: \['wos\.chats\.pinned\.v2'/)
  assert.match(live, /visibilitychange', \(\) => \{ if \(document\.visibilityState === 'visible'\) pullPrefs\(\)/)
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
