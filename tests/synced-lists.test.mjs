// Every shared list a device edits (Spaces and their members, subject order, pins) keeps the other device's edit:
// a stale device and two devices editing at the same moment, with and without Agent Service PATCH support.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { sharedBox, liveDevice, stale, simultaneous, tick } from './two-devices.mjs'

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8')
const chats = read('web/core/chats.js')
const cut = (from, to) => chats.slice(chats.indexOf(from), chats.indexOf(to))
const SPACES = 'wos.chats.spaces.v1', SUBJ = 'wos.chats.subjectOrder.v1'
const at = '2026-10-28T08:00:00.000Z'
// Chats' real Space/subject edit code, bound to one device's live.js.
function chatsOn(dev) {
  const toasts = [], env = { LIVE: dev, localStorage: dev.ctx.localStorage, window: dev.ctx.window, Event: dev.ctx.Event, Date,
    AGS: () => ({ defaultId: () => 'hermes' }), focusAgents: () => [{ id: 'hermes' }], toast: (...a) => toasts.push(a),
    crypto: { randomUUID: () => 'new-space' }, norm: s => s.toLowerCase(), renderSpacePicker() {}, closeSpacePicker() {}, setFocus() {}, W: {}, sendChat: async () => {}, spacePicker: null }
  vm.createContext(env)
  vm.runInContext(cut("  const SPACE = { one: 'Space'", '  /* A Space open in front') + cut('  const SUBJ_ORDER_KEY', '  // A thread James just wrote')
    + cut('  async function createPickerSpace(', '  function bindFocusStrip(') + '\nthis.api = { spaces, spaceMember, moveSubject, createPickerSpace, setPicker(p) { spacePicker = p } };', env)
  const plain = f => (...a) => JSON.parse(JSON.stringify(f(...a)))
  env.api.spaces = plain(env.api.spaces)
  return { ...env.api, toasts }
}
const done = dev => dev.prefOps([]) // waits for this device's queued writes
const space = (id, threads = []) => ({ id, name: 'Space ' + id, threads, createdAt: at })
const ids = (box, id) => box.state.spaces.find(s => s.id === id)?.threads
const cache = (spaces, extra = {}) => ({ [SPACES]: JSON.stringify(spaces), ...extra })

for (const patch of [true, false]) for (const [name, run] of [['stale device', stale], ['simultaneous edits', simultaneous]]) {
  const svc = patch ? 'service with item operations' : 'older service (PUT only)'
  test(`Space members, ${name}, ${svc}: both devices' changes and an agent's filing survive`, async () => {
    // The box already holds wizard_agent (filed by the agent) that neither device has pulled.
    const box = await run({ patch, initial: { spaces: [space('work', ['wizard_old', 'wizard_agent'])], compact: true }, local: cache([space('work', ['wizard_old'])]),
      first: async a => { chatsOn(a).spaceMember('work', 'wizard_desk', true); await done(a) },
      second: async b => { chatsOn(b).spaceMember('work', 'wizard_phone', true); chatsOn(b).spaceMember('work', 'wizard_old', false); await done(b) } })
    assert.deepEqual([...ids(box, 'work')].sort(), ['wizard_agent', 'wizard_desk', 'wizard_phone'])
    assert.equal(box.state.compact, true)
    if (patch) assert.ok(!box.log.includes('PUT'), 'a service with item operations never gets a whole list')
  })
  test(`a new Space and a member edit elsewhere, ${name}, ${svc}: both survive`, async () => {
    const box = await run({ patch, initial: { spaces: [space('work')] }, local: cache([space('work')]),
      first: async a => { const c = chatsOn(a), p = { name: 'Home', agent: 'hermes', sid: 'wizard_1', wid: 'w' }; c.setPicker(p); await c.createPickerSpace(p) },
      second: async b => { chatsOn(b).spaceMember('work', 'wizard_2', true); await done(b) } })
    assert.deepEqual(box.state.spaces.map(s => [s.id, s.threads]), [['work', ['wizard_2']], ['new-space', ['wizard_1']]])
  })
  test(`subject order, ${name}, ${svc}: a subject only the other device placed keeps its place`, async () => {
    const box = await run({ patch, initial: { subjectOrder: ['Home', 'Work', 'Ideas'] }, local: { [SUBJ]: '["Home","Work","Ideas"]' },
      first: async a => { chatsOn(a).moveSubject('Garden', 'top', ['Home', 'Garden']); await done(a) },
      second: async b => { chatsOn(b).moveSubject('Ideas', 'up', ['Home', 'Ideas']); await done(b) } })
    assert.ok(box.state.subjectOrder.includes('Garden'), JSON.stringify(box.state.subjectOrder))
    if (run === stale) assert.deepEqual(box.state.subjectOrder, ['Ideas', 'Home', 'Garden', 'Work'])
  })
}

test('the two-device helper catches the old whole-list write (negative control)', async () => {
  const wholeList = (dev, add) => { const list = JSON.parse(dev.store.get(SPACES)); list[0].threads.push(add); return dev.putPrefs({ spaces: list }) }
  for (const run of [stale, simultaneous]) {
    const box = await run({ patch: false, initial: { spaces: [space('work')] }, local: cache([space('work')]), first: a => wholeList(a, 'wizard_desk'), second: b => wholeList(b, 'wizard_phone') })
    assert.notDeepEqual([...ids(box, 'work')].sort(), ['wizard_desk', 'wizard_phone'])
  }
})

// Agent chat parity: membership keys on the rendered thread id, the same for the main agent and every routed kind.
const KINDS = { main: 'wizard_1793157258294_34b4a71ae61a', 'host-profile': '20261028_101500_ab12cd', container: 'agent-research:20261028_101501_ef34', restricted: 'restricted.vault_20261028-101502' }
for (const [kind, id] of Object.entries(KINDS)) test(`${kind} thread: added to a Space on one device, removed on a stale other, never revived`, async () => {
  const box = sharedBox({ spaces: [space('s')] }), a = liveDevice(box, cache([space('s')])), b = liveDevice(box, cache([space('s')]), { pulled: false })
  await tick(); chatsOn(a).spaceMember('s', id, true); await done(a)
  assert.deepEqual(ids(box, 's'), [id])
  b.store.set(SPACES, JSON.stringify(box.state.spaces)) // what b's next pull writes
  assert.equal(chatsOn(b).spaces()[0].threads.includes(id), true)
  chatsOn(b).spaceMember('s', id, false); await done(b)
  chatsOn(a).spaceMember('s', 'wizard_other', true); await done(a)
  assert.deepEqual(ids(box, 's'), ['wizard_other'])
})

test('an edit made offline is shown at once, kept across a reload and delivered later', async () => {
  const down = { req: async () => ({ ok: false, status: 503, json: async () => ({}) }) }
  const phone = liveDevice(down, cache([space('work')])); await tick()
  chatsOn(phone).spaceMember('work', 'wizard_offline', true); await done(phone)
  assert.deepEqual(chatsOn(phone).spaces()[0].threads, ['wizard_offline'])
  const box = sharedBox({ spaces: [space('work', ['wizard_elsewhere'])] })
  const later = liveDevice(box, Object.fromEntries(phone.store)); await tick(); await done(later)
  assert.deepEqual(ids(box, 'work'), ['wizard_elsewhere', 'wizard_offline'])
  assert.equal(later.store.get('wos.prefs.ops.v1'), '[]')
  assert.deepEqual(chatsOn(later).spaces()[0].threads, ['wizard_elsewhere', 'wizard_offline'])
})

test('a pull while an edit is queued shows the box list plus the edit, not the box list alone', async () => {
  const box = sharedBox({ spaces: [space('work', ['wizard_a'])] }), d = liveDevice(box, cache([space('work')])); await tick()
  d.store.set('wos.prefs.ops.v1', JSON.stringify([{ op: 'add', key: 'spaces/work/threads', item: 'wizard_mine' }]))
  await d.pullPrefs()
  assert.deepEqual(JSON.parse(d.store.get(SPACES))[0].threads, ['wizard_a', 'wizard_mine'])
})

test('an edit the box can never take (400) is dropped and the box list shown again', async () => {
  const box = sharedBox({ spaces: [space('work', ['wizard_a'])] })
  const req = box.req; box.req = async (u, i = {}) => i.method === 'PATCH' ? { ok: false, status: 400, json: async () => ({}) } : req(u, i)
  const swap = liveDevice(box, cache([space('work', ['wizard_a'])])); await tick()
  chatsOn(swap).spaceMember('work', 'wizard_bad', true); await done(swap); await tick()
  assert.equal(swap.store.get('wos.prefs.ops.v1'), '[]')
  assert.ok(swap.events.includes('wos:prefs-error'))
  assert.deepEqual(JSON.parse(swap.store.get(SPACES))[0].threads, ['wizard_a'])
})

test('pins run through the same two-device helper (core/chat-pins.js keeps its own queue)', async () => {
  for (const race of [false, true]) {
    const box = sharedBox({ pinnedChats: [] }, { patch: false }), devices = [0, 1].map(() => {
      const m = new Map(), sandbox = { localStorage: { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) },
        Event: class { constructor(t) { this.type = t } }, addEventListener() {}, dispatchEvent() {}, setTimeout: () => 0, clearTimeout() {}, fetch: box.req }
      sandbox.window = sandbox; vm.runInNewContext(read('web/core/chat-pins.js'), sandbox); return sandbox.WosChatPins
    })
    if (race) box.race(2)
    devices[0].toggle('wizard_desk'); devices[1].toggle('wizard_phone')
    await Promise.all(devices.map(p => p.sync()))
    assert.deepEqual([...box.state.pinnedChats].sort(), ['wizard_desk', 'wizard_phone'])
  }
})

test('Chats never saves a whole Spaces or subject-order list from this device', () => {
  assert.doesNotMatch(chats, /putPrefs\??\.?\(\{ spaces/)
  assert.doesNotMatch(chats, /putPrefs\??\.?\(\{ subjectOrder/)
  assert.match(chats, /LIVE\.prefOps\(\[\{ op: add \? 'add' : 'remove', key: `spaces\/\$\{key\}\/threads`, item: sid \}\]\)/)
  assert.match(chats, /LIVE\.prefOps\(\[\{ op: 'front', key: 'subjectOrder', items: keys \}\]\)/)
  assert.match(read('AGENTS.md'), /stale-device and simultaneous-edit test/)
})
