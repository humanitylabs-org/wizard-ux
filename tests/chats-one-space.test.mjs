// A chat is in at most one Space of its agent (James, 29 Oct 2026: "A message should only be in one space. It should
// read, move to space, if already in a space"). The row sheet (phone long-press/swipe and desktop right-click share
// it) says "Add to a Space…" only for an unfiled chat and "Move to Space…" otherwise; choosing another Space moves it,
// the same Space changes nothing, Remove leaves it unfiled, and another agent's Spaces are never touched.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { sharedBox, liveDevice } from './two-devices.mjs'

const chats = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8')
const cut = (from, to) => { const a = chats.indexOf(from), b = chats.indexOf(to, a); assert.ok(a >= 0 && b > a, from); return chats.slice(a, b) }
const SPACES = 'wos.chats.spaces.v1', at = '2026-10-29T00:00:00.000Z'
const space = (id, threads = [], agent) => ({ id, name: 'Space ' + id, threads, createdAt: at, ...(agent ? { agent } : {}) })
const members = spaces => Object.fromEntries(spaces.map(s => [s.id, s.threads]))
const start = () => [space('a', ['t1', 'keep']), space('b', ['other']), space('phil', ['t1'], 'philosopher')]

// Chats' real Space code and row sheet, on one device running the real live.js preferences code.
function device(box, agents = { t1: 'hermes', fresh: 'hermes' }) {
  const dev = liveDevice(box, { [SPACES]: JSON.stringify(box.state.spaces) }), toasts = [], sheets = []
  const el = { insertAdjacentHTML: (_, html) => sheets.push(html), querySelector: () => null }
  const env = { LIVE: { ...dev, agentOf: sid => agents[sid] || '', workGroups: () => ({ ready: [] }), isNew: () => false }, localStorage: dev.ctx.localStorage,
    window: dev.ctx.window, Event: dev.ctx.Event, AGS: () => ({ defaultId: () => 'hermes' }), focusAgents: () => [{ id: 'hermes' }, { id: 'philosopher' }],
    toast: (...a) => toasts.push(a[1]), W: {}, esc: s => String(s), PIN_SVG: '', RENAME_SVG: '', PIN: { has: () => false }, topicOn: () => false,
    ACT: {}, threadActions: () => [], rowOf: (_, sid) => ({ sessionId: sid, title: sid }), track: { querySelector: () => el }, closeRowSheet() {}, vib() {},
    isWorking: () => false, actionLabel: () => '' }
  vm.createContext(env)
  vm.runInContext(cut("  const SPACE = { one: 'Space'", '  /* A Space open in front') + cut('  let rowSheet = null;', '  const emojiCategoryHtml')
    + '\nthis.api = { spaces, fileInSpace, spaceMember, openRowSheet };', env)
  const sheet = sid => { sheets.length = 0; env.api.openRowSheet('w', sid); return sheets.at(-1) }
  const done = () => dev.prefOps([])
  return { ...env.api, dev, toasts, sheet, done, local: () => members(JSON.parse(dev.store.get(SPACES))) }
}
const label = html => html.match(/data-rsspacepicker>([^<]*)</)[1]
const removes = html => [...html.matchAll(/Remove from Space · ([^<]*)</g)].map(m => m[1])

test('row sheet reads Add to a Space… only for an unfiled chat and Move to Space… once filed', () => {
  const d = device(sharedBox({ spaces: start() }))
  assert.equal(label(d.sheet('fresh')), 'Add to a Space…'); assert.deepEqual(removes(d.sheet('fresh')), [])
  const filed = d.sheet('t1')
  assert.equal(label(filed), 'Move to Space…'); assert.doesNotMatch(filed, /Add to a Space/)
  assert.deepEqual(removes(filed), ['Space a']) // the other agent's Space holding the same id is not this chat's
})

test('moving A to B leaves only B on the box and this device, and survives a reload', async () => {
  const box = sharedBox({ spaces: start() }), d = device(box)
  assert.equal(d.fileInSpace('b', 't1'), true); await d.done()
  const want = { a: ['keep'], b: ['other', 't1'], phil: ['t1'] }
  assert.deepEqual(d.local(), want); assert.deepEqual(members(box.state.spaces), want)
  assert.equal(d.toasts.at(-1), 'Moved to Space b')
  const reloaded = device(box); await reloaded.dev.pullPrefs()
  assert.deepEqual(reloaded.local(), want); assert.equal(label(reloaded.sheet('t1')), 'Move to Space…'); assert.deepEqual(removes(reloaded.sheet('t1')), ['Space b'])
})

test('the same Space again changes nothing; Remove leaves the chat unfiled and Add again', async () => {
  const box = sharedBox({ spaces: start() }), d = device(box), before = JSON.stringify(box.state)
  assert.equal(d.fileInSpace('a', 't1'), false); await d.done()
  assert.equal(JSON.stringify(box.state), before); assert.equal(d.toasts.at(-1), 'Already in Space a')
  assert.equal(d.spaceMember('a', 't1', false), true); await d.done()
  assert.deepEqual(members(box.state.spaces), { a: ['keep'], b: ['other'], phil: ['t1'] })
  assert.equal(label(d.sheet('t1')), 'Add to a Space…')
  assert.equal(d.fileInSpace('b', 't1'), true); await d.done(); assert.equal(d.toasts.at(-1), 'Added to Space b')
})

test('a new Space created with a chat takes it from that agent’s other Spaces only', async () => {
  const box = sharedBox({ spaces: start() }), d = device(box)
  await d.dev.prefOps([{ op: 'add', key: 'spaces', item: space('c', ['t1']) }])
  assert.deepEqual(members(box.state.spaces), { a: ['keep'], b: ['other'], phil: ['t1'], c: ['t1'] })
})

test('a chat an older box left in two Spaces reads Move and lists both, and one move repairs it', async () => {
  const box = sharedBox({ spaces: [space('a', ['t1']), space('b', ['t1']), space('c')] }), d = device(box)
  assert.equal(label(d.sheet('t1')), 'Move to Space…'); assert.deepEqual(removes(d.sheet('t1')), ['Space a', 'Space b'])
  assert.equal(d.fileInSpace('a', 't1'), true); await d.done() // in two: choosing one of them is a real move, not "Already in"
  assert.deepEqual(members(box.state.spaces), { a: ['t1'], b: [], c: [] })
})
