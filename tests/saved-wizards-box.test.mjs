// Saved Wizards live on the box (wizard-ux issue 1237): a Wizard added on one device shows in the switcher of every
// device signed into that box. Real web/core/workspaces.js on top of the real live.js preferences code, two devices on
// one fake Agent Service (tests/two-devices.mjs), plus the Android app's remembered Wizards.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { randomUUID } from 'node:crypto'
import { sharedBox, liveDevice, stale, simultaneous, tick } from './two-devices.mjs'

const source = readFileSync(new URL('../web/core/workspaces.js', import.meta.url), 'utf8')
const plain = x => JSON.parse(JSON.stringify(x))
const archie = { id: 'remote-a', name: 'Archimedes', url: 'https://archimedes.test/' }

// One device: live.js against the box, and the switcher module sharing its localStorage and window events.
function device(box, local = {}, { app = null } = {}) {
  const dev = liveDevice(box, local), win = new EventTarget()
  dev.ctx.window.dispatchEvent = e => { dev.events.push(e.type); win.dispatchEvent(new Event(e.type)) }
  win.WizLive = { prefOps: dev.prefOps }
  win.WosResources = { state: { devices: { this: { wizard: 'Phone box' }, managed: [] } } }
  if (app) win.WizardOSNative = app
  const ctx = { window: win, localStorage: dev.ctx.localStorage, URL, CustomEvent: class extends Event { constructor(k, o) { super(k); this.detail = o?.detail } },
    location: { origin: 'https://here.test', hostname: 'here.test', pathname: '/wizard-os-home/', search: '', hash: '' }, history: { state: null, replaceState() {} },
    crypto: { randomUUID }, AbortSignal, fetch: () => { throw new Error('fixture must not fetch') } }
  vm.runInNewContext(source, ctx)
  const W = win.WizWorkspaces
  return { dev, W, names: () => plain(W.snapshot().items.filter(v => v.id !== 'this').map(v => v.name)), store: dev.store, settle: async () => { await tick(); await dev.prefOps([]); await tick() } }
}

test('a Wizard added on desktop shows in the phone switcher; rename and forget on the phone reach desktop', async () => {
  const box = sharedBox({ savedWizards: [] })
  const desktop = device(box); await desktop.settle()
  await desktop.W.add({ url: 'https://archimedes.test', name: 'Archimedes' }); await desktop.settle()
  assert.deepEqual(plain(box.state.savedWizards).map(w => [w.name, w.url]), [['Archimedes', 'https://archimedes.test/']])
  assert.equal(desktop.store.get('wos.workspaces.v1'), undefined, 'nothing is saved only on this device')
  const phone = device(box); await phone.settle()
  assert.deepEqual(phone.names(), ['Archimedes']); assert.equal(phone.W.visible, true, 'the phone shows the switcher')
  const id = box.state.savedWizards[0].id
  await phone.W.rename(id, 'Archie'); await phone.settle()
  await desktop.dev.pullPrefs(); await tick()
  assert.deepEqual(desktop.names(), ['Archie'])
  await phone.W.remove(id); await phone.settle()
  await desktop.dev.pullPrefs(); await tick()
  assert.deepEqual(desktop.names(), []); assert.equal(desktop.W.visible, false)
})

test('a device\'s old local list is uploaded once, then read from the box (a Wizard forgotten elsewhere stays forgotten)', async () => {
  const box = sharedBox({ savedWizards: [], compact: true })
  const desktop = device(box, { 'wos.workspaces.v1': JSON.stringify([{ ...archie, kind: 'remote' }]) })
  await desktop.settle()
  assert.deepEqual(plain(box.state.savedWizards), [archie]); assert.equal(box.state.compact, true)
  assert.ok(!box.log.includes('PUT'), 'uploaded by item operation, never a whole list')
  // Another device with the same old local entry adds nothing twice.
  const laptop = device(box, { 'wos.workspaces.v1': JSON.stringify([{ ...archie, id: 'remote-other', kind: 'remote' }]) }); await laptop.settle()
  assert.equal(box.state.savedWizards.length, 1)
  const phone = device(box); await phone.settle()
  await phone.W.remove('remote-a'); await phone.settle()
  const again = device(box, Object.fromEntries(desktop.store)); await again.settle() // desktop reloads
  assert.deepEqual(box.state.savedWizards, []); assert.deepEqual(again.names(), [])
})

test('the Android app\'s remembered Wizards are added once with their names, no address typed', async () => {
  const box = sharedBox({ savedWizards: [] }), named = []
  const app = { knownWizards: () => JSON.stringify([{ url: 'https://archimedes.test', name: 'Archimedes' }, { url: 'https://quiet.box.test', name: '' }, { url: 'https://here.test', name: 'Me' }, { url: 'javascript:alert(1)', name: 'x' }]),
    nameThisWizard: n => named.push(n) }
  const phone = device(box, {}, { app }); await phone.settle()
  assert.deepEqual(plain(box.state.savedWizards).map(w => [w.name, w.url]), [['Archimedes', 'https://archimedes.test/'], ['quiet', 'https://quiet.box.test/']])
  assert.equal(phone.W.visible, true)
  await phone.W.list(); assert.ok(named.includes('Phone box'), 'the app learns this Wizard\'s name for the next Change Wizard')
  await phone.W.remove(box.state.savedWizards[0].id); await phone.settle()
  const reopened = device(box, Object.fromEntries(phone.store), { app }); await reopened.settle()
  assert.deepEqual(plain(box.state.savedWizards).map(w => w.name), ['quiet'], 'a Wizard the owner forgot is not added back')
})

test('an older Agent Service without savedWizards keeps the list on this device, as before', async () => {
  const box = sharedBox({ compact: false })
  const desktop = device(box); await desktop.settle()
  await desktop.W.add({ url: 'https://archimedes.test', name: 'Archimedes' }); await desktop.settle()
  assert.equal(box.state.savedWizards, undefined); assert.ok(!box.log.includes('PATCH'))
  assert.deepEqual(JSON.parse(desktop.store.get('wos.workspaces.v1')).map(w => w.name), ['Archimedes']); assert.deepEqual(desktop.names(), ['Archimedes'])
})

// AGENTS.md "Synced across devices": a stale device and two devices editing at the same moment both keep their edit.
for (const patch of [true, false]) for (const [name, run] of [['stale device', stale], ['simultaneous edits', simultaneous]]) {
  test(`saved Wizards, ${name}, ${patch ? 'service with item operations' : 'older service (PUT only)'}: both devices' changes survive`, async () => {
    const other = { id: 'remote-b', name: 'Bee', url: 'https://bee.test/' }
    const box = await run({ patch, initial: { savedWizards: [archie, other] }, local: { 'wos.workspaces.box.v1': JSON.stringify([archie]) },
      first: async a => { await a.prefOps([{ op: 'add', key: 'savedWizards', item: { id: 'remote-c', name: 'Desk', url: 'https://desk.test/' } }]) },
      second: async b => { await b.prefOps([{ op: 'set', key: 'savedWizards/remote-a/name', item: 'Archie' }, { op: 'add', key: 'savedWizards', item: { id: 'remote-d', name: 'Phone', url: 'https://phone.test/' } }]) } })
    assert.deepEqual(plain(box.state.savedWizards).map(w => w.name).sort(), ['Archie', 'Bee', 'Desk', 'Phone'])
  })
}
