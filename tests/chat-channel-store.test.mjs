// Chats channels on the Agent Service channel store (wizard/chat-channels, wizard-ux issue 1261; wizard-agent-service
// issue 440 phase 2, docs/chats-channels.md). Part 1 runs the real live.js channel store on two devices against one
// fake box (tests/two-devices.mjs channelBox): the sort and pins are shared, an edit never erases another device's,
// 404 falls back to Spaces. Part 2 runs Chats' real Space code and Channels block on that store.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { channelBox, channelDevice, tick } from './two-devices.mjs'
import { modelContext } from './fixtures/chats-list-model.mjs'

const clone = v => JSON.parse(JSON.stringify(v))
const ch = (id, name, extra = {}) => ({ id, agent: 'hermes', name, order: 0, createdAt: '2026-11-01T00:00:00.000Z', archived: false, pinned: false, ...extra })
const START = () => [
  ch('alerts', 'Alerts', { pinned: true, pinOrder: 0, kind: 'alerts', order: -1 }), ch('launch', 'Launch'), ch('voice', 'Voice'),
  ch('host-ops', 'Host ops', { agent: 'host' }), ch('box', 'Box', { agent: 'container' }), ch('locked', 'Locked', { agent: 'restricted' }),
]
const settle = async () => { for (let i = 0; i < 4; i++) await tick() }
const pins = st => st.channels.filter(c => c.pinned).sort((a, b) => a.pinOrder - b.pinOrder).map(c => c.id)

test('two devices: a sort and a pin made on one show on the other, and survive a reload', async () => {
  const box = channelBox({ channels: START() }), a = channelDevice(box), b = channelDevice(box)
  await a.pull(); await b.pull()
  assert.equal(a.state().sort, 'az'); assert.deepEqual(pins(b.state()), ['alerts'], 'the seeded Alerts channel is pinned at the top')
  a.patch({ sort: 'za' }); a.patch({ id: 'launch', pinned: true })
  assert.equal(a.state().sort, 'za', 'shown at once on the device that made it'); assert.deepEqual(pins(a.state()), ['alerts', 'launch'])
  await settle()
  assert.equal(box.sort, 'za'); assert.deepEqual(pins({ channels: box.channels }), ['alerts', 'launch'])
  await b.pull()
  assert.equal(b.state().sort, 'za'); assert.deepEqual(pins(b.state()), ['alerts', 'launch'], 'the other device reads them from the box')
  // A reload (same device storage, no network yet) opens on the last list it read.
  const reloaded = channelDevice(box, Object.fromEntries(b.store)); reloaded.offline = true
  assert.deepEqual(pins(reloaded.state()), ['alerts', 'launch']); assert.equal(reloaded.state().sort, 'za')
})

test('two devices pinning at once both keep their pin; a stale device never erases the other one', async () => {
  const box = channelBox({ channels: START() }), a = channelDevice(box), b = channelDevice(box)
  await a.pull(); await b.pull()
  box.race(2)
  a.patch({ id: 'launch', pinned: true }); b.patch({ id: 'voice', pinned: true })
  await settle()
  assert.deepEqual(pins({ channels: box.channels }), ['alerts', 'launch', 'voice'])
  // b never read a's pin before its own edit: its archive is one item edit, never its whole stale list.
  const stale = channelDevice(box, Object.fromEntries(b.store)); stale.offline = true; stale.state(); stale.offline = false
  stale.patch({ id: 'voice', archived: true, pinned: false }); await settle()
  assert.deepEqual(pins({ channels: box.channels }), ['alerts', 'launch'], "a's pin is still there")
  assert.equal(box.channels.find(c => c.id === 'voice').archived, true)
  await a.pull(); assert.equal(a.state().channels.find(c => c.id === 'voice').archived, true)
  assert.ok(box.log.every(l => !/PUT \/wizard\/v1\/ui-preferences/.test(l)), 'nothing is written to ui-preferences')
})

test('a list read that began before an edit never undoes it on screen', async () => {
  const box = channelBox({ channels: START() }), a = channelDevice(box)
  await a.pull()
  let release; box.hold = new Promise(r => { release = r })
  a.clock.t += 31e3; a.state() // a poll starts and hangs
  a.patch({ id: 'voice', pinned: true }) // the PATCH queues behind it on the box
  assert.deepEqual(pins(a.state()), ['alerts', 'voice'])
  box.hold = null; release(); await settle()
  assert.deepEqual(pins(a.state()), ['alerts', 'voice'], 'the old read was dropped; the read after the edit agrees')
  assert.match(box.log.at(-1), /^GET \/wizard\/v1\/channels$/, 'read again once the edit landed')
})

test('store off or an older service (404): no store, so Chats stays on Spaces; the box is asked again later', async () => {
  const box = channelBox({ channels: START(), off: true }), a = channelDevice(box, { 'wos.chats.channels.v1': JSON.stringify({ sort: 'za', channels: START() }) })
  assert.ok(a.state(), 'a list kept from an earlier read shows until the box answers')
  await settle()
  assert.equal(a.state(), null); assert.equal(a.store.has('wos.chats.channels.v1'), false, 'the kept list is dropped')
  assert.equal(a.feed('launch', 'hermes'), null)
  const asked = box.log.length; a.state(); a.clock.t += 60e3; a.state()
  assert.equal(box.log.length, asked, 'not asked on every paint')
  box.off = false; a.clock.t += 5 * 60e3; a.state(); await settle()
  assert.deepEqual(pins(a.state()), ['alerts'], 'turned on later: picked up on the next check')
})

test('offline: the list last read stays; a refused edit is read back from the box', async () => {
  const box = channelBox({ channels: START() }), a = channelDevice(box)
  await a.pull(); a.offline = true; a.clock.t += 31e3; a.state(); await settle()
  assert.deepEqual(pins(a.state()), ['alerts'])
  a.offline = false; box.fail(1, 400)
  a.patch({ id: 'launch', pinned: true }); assert.deepEqual(pins(a.state()), ['alerts', 'launch'])
  await settle()
  assert.deepEqual(pins(a.state()), ['alerts'], 'the box refused it: the box list shows again'); assert.equal(a.errors.length, 1)
})

test('moving a chat is one PUT membership with its own agent, shown at once; a refusal takes it back', async () => {
  const box = channelBox({ channels: START() }), a = channelDevice(box)
  await a.pull()
  a.move('t1', 'launch', 'hermes'); a.move('h1', 'host-ops', 'host')
  assert.deepEqual(clone(a.moves()), [['hermes|t1', 'launch'], ['host|h1', 'host-ops']])
  await settle()
  assert.deepEqual(box.members, { 'hermes|t1': 'launch', 'host|h1': 'host-ops' })
  assert.ok(box.log.some(l => l === 'PUT /wizard/v1/channels/membership {"sessionId":"h1","channelId":"host-ops","agent":"host"}'))
  // A main chat into a routed agent's channel: the box says 409 and the chat stays where it was.
  a.move('t2', 'host-ops', 'hermes'); await settle()
  assert.deepEqual(clone(a.moves().map(m => m[0])), ['hermes|t1', 'host|h1']); assert.equal(box.members['hermes|t2'], undefined)
  a.move('t1', null, 'hermes'); await settle(); assert.equal(box.members['hermes|t1'], undefined, 'null unfiles')
  a.clock.t += 121e3; assert.deepEqual(clone(a.moves()), [], 'kept only until the list rows carry it')
})

test('a channel feed reads the newest posts on the channel agent route; 404 means the channel is gone', async () => {
  const members = {}; for (let i = 0; i < 250; i++) members['hermes|p' + String(i).padStart(3, '0')] = 'launch'
  members['host|h1'] = 'host-ops'
  const box = channelBox({ channels: START(), members }), a = channelDevice(box)
  await a.pull()
  assert.equal(a.feed('launch', 'hermes').busy, true); await settle()
  const f = a.feed('launch', 'hermes')
  assert.equal(f.rows.length, 200); assert.equal(f.rows[0].id, 'p050'); assert.equal(f.rows.at(-1).id, 'p249', 'the newest 200, oldest first')
  assert.ok(box.log.some(l => /channel=launch&limit=100&offset=50&include_children=false&snapshot=snap-launch$/.test(l)), 'jumped to the newest window on one snapshot')
  a.feed('host-ops', 'host'); await settle()
  assert.deepEqual(a.feed('host-ops', 'host').rows.map(s => [s.id, s.agent, s.channel]), [['h1', 'host', 'host-ops']])
  assert.ok(box.log.some(l => /channel=host-ops&.*&agent=host$/.test(l)), "on the channel's own agent route")
  assert.equal(a.find('h1', 'host').id, 'h1'); assert.equal(a.find('h1', 'hermes'), null, 'by agent: never the other agent row')
  box.channels = box.channels.filter(c => c.id !== 'host-ops'); delete box.members['host|h1']
  a.clock.t += 31e3; a.feed('host-ops', 'host'); await settle()
  assert.equal(a.feed('host-ops', 'host').gone, true)
  assert.equal(a.state().channels.some(c => c.id === 'host-ops'), false, 'the list was read again')
})

test('a new channel gets its id from the box', async () => {
  const box = channelBox({ channels: START() }), a = channelDevice(box)
  await a.pull()
  const c = await a.create('Ideas', 'host'); await settle()
  assert.deepEqual([c.id, c.agent, c.name], ['channel-1', 'host', 'Ideas'])
  assert.ok(a.state().channels.some(x => x.id === 'channel-1'))
  assert.ok(box.log.includes('POST /wizard/v1/channels {"name":"Ideas","agent":"host"}'))
})

// ---- Part 2: Chats' real Space code and Channels block on the store ----
const src = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8')
const cut = (a, b) => { const i = src.indexOf(a); assert.ok(i >= 0, a); return src.slice(i, src.indexOf(b, i)) }
const code = cut("  const SPACE = { one: 'Space'", '  /* A Space open in front') + cut('  /* Channels view (switch wizard/chat-channels', '  function clearAll(w)')
const H = 3600e3, NOW = Date.parse('2026-11-11T12:00:00.000Z')
const AG = { t1: '', t2: '', h1: 'host', k1: 'container', r1: 'restricted' }

async function shell({ on = true, off = false, channels = START(), members = {}, rows = [], agentRows = {}, projection = [], local = {} } = {}) {
  const box = channelBox({ channels, members, off }), dev = channelDevice(box), wins = { w: { id: 'w', thread: null, focus: null } }
  await dev.pull()
  const store = new Map(Object.entries({ 'wos.chats.spaces.v1': JSON.stringify(projection), ...local })), toasts = [], prefOps = []
  const env = {
    document: { documentElement: { dataset: { tweaks: on ? 'wizard/chat-channels' : '' } } },
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) }, requestAnimationFrame: () => {},
    W: new Proxy({}, { get: (_, id) => wins[id] }), owner: id => id, save() {}, elOf: () => null, ch: id => (env._c[id] = env._c[id] || {}), _c: {},
    esc: s => String(s ?? ''), toast: (...a) => toasts.push(a[1]), norm: s => String(s).toLowerCase().trim(),
    AGS: () => ({ defaultId: () => 'hermes', isOther: a => !!a && a !== 'hermes', sigil: () => '' }), agentRec: id => ({ id }),
    focusAgents: () => ['hermes', 'host', 'container', 'restricted'].map(id => ({ id })), focusOf: w => w.focus || null,
    setFocus: (w, f) => { w.focus = f; return true; }, rerenderList() {}, renderChatList() {}, holdList: () => false, CH: {}, H: { win: id => wins[id] },
    isWorking: s => s.status === 'running', attOf: () => null, snoozeLast: () => false, deferredOf: () => false,
    rowOf: (wid, sid) => [...env.LIVE.sessions, ...Object.values(env.LIVE.agentSessions).flat()].find(s => s.id === sid) || null,
    LIVE: { sessions: rows, agentSessions: agentRows, chanStore: dev.api, get ticks() { return dev.emits; }, agentOf: id => AG[id] || '', ownerOf: s => s.agent || '',
      cardAt: s => new Date(s.at).toISOString(), isNew: () => false, prefOps: o => { prefOps.push(...o); return Promise.resolve(true); } },
    orderBar: (l, attr, orders, cur) => `<i ${attr}="${cur}"></i>`, window: { WizConfig: { owner: () => 'James' } }, setTimeout: () => 0, clearTimeout() {},
    PIN_SVG: '', RENAME_SVG: '', ACT: { done: { icon: '' } }, track: { querySelector: () => ({ insertAdjacentHTML() {}, querySelector: () => null }) },
    closeRowSheet() { env.rowSheet = null; }, vib() {}, rowSheet: null, toTurns: () => [], KIT: { viewer: { open() {} } },
  }
  vm.createContext(env); modelContext(env)
  vm.runInContext(code + ';this.api={spaces,spaceContains,spaceMember,fileInSpace,spacesOf,chanPrefs,channelsFor,channelOf,channelClick,channelSheetClick,openChannelSheet,chanFeedRows,inChannel,chanArchived,chanStore,chanCarry};', env)
  const click = attrs => ({ target: { closest: sel => { const k = sel.slice(1, -1); return k in attrs ? { dataset: { [k.replace(/^data-/, '').replace(/-./g, m => m[1].toUpperCase())]: attrs[k] } } : null; } } })
  return { ...env.api, env, box, dev, wins, w: wins.w, store, toasts, prefOps, click }
}
const row = (id, agent = '', extra = {}) => ({ id, agent, title: 'T ' + id, status: 'completed', at: NOW - H, ...extra })

test('the channel list is the store: Alerts pinned at the top, the shared sort, archived ones apart', async () => {
  const s = await shell({ channels: [...START(), ch('old', 'Old', { archived: true, archivedAt: '2026-11-10T00:00:00.000Z' })] })
  assert.deepEqual(s.channelsFor(s.w).map(c => c.name), ['Alerts', 'Box', 'Host ops', 'Launch', 'Locked', 'Voice', 'General'])
  assert.deepEqual(s.channelsFor(s.w, { archived: true }).map(c => c.id), ['old'])
  s.box.sort = 'za'; s.dev.clock.t += 31e3; s.dev.state(); await settle()
  assert.deepEqual(s.channelsFor(s.w).map(c => c.name), ['Alerts', 'Voice', 'Locked', 'Launch', 'Host ops', 'Box', 'General'], "another device's sort")
  assert.equal(s.chanArchived('old'), true)
})

test("a chat's channel is its row's `channel`, ahead of the projection; agents never mix", async () => {
  const s = await shell({
    rows: [row('t1', '', { channel: 'voice' }), row('t2')],
    agentRows: { host: [row('h1', 'host', { channel: 'host-ops' })], container: [row('k1', 'container')], restricted: [row('t1', 'restricted', { channel: 'locked' })] },
    projection: [{ id: 'launch', name: 'Launch', threads: ['t1', 't2'] }, { id: 'box', name: 'Box', agent: 'container', threads: ['k1'] }],
  })
  assert.equal(s.channelOf(s.env.LIVE.sessions[0]), 'Voice', 'the row says voice; the older projection said launch')
  assert.equal(s.channelOf(s.env.LIVE.sessions[1]), 'Launch', 'no channel on the row: the projection decides')
  assert.equal(s.channelOf(s.env.LIVE.agentSessions.host[0]), 'Host ops')
  assert.equal(s.channelOf(s.env.LIVE.agentSessions.container[0]), 'Box')
  assert.equal(s.channelOf(s.env.LIVE.agentSessions.restricted[0]), 'Locked', 'a routed thread sharing a main id keeps its own channel')
  assert.equal(s.spaceContains('locked', 't1'), true); assert.equal(s.spaceContains('voice', 't1'), true)
  assert.equal(s.inChannel({ id: 'voice', agent: 'hermes' }, s.env.LIVE.agentSessions.restricted[0]), false)
})

test('filing, moving and removing go through PUT membership with the row agent (main, host-profile, container, restricted)', async () => {
  const s = await shell({ rows: [row('t1', '', { channel: 'launch' }), row('t2')],
    agentRows: { host: [row('h1', 'host')], container: [row('k1', 'container')], restricted: [row('r1', 'restricted')] } })
  assert.equal(s.fileInSpace('voice', 't1'), true); assert.equal(s.toasts.at(-1), 'Moved to Voice')
  assert.equal(s.channelOf(s.env.LIVE.sessions[0]), 'Voice', 'shown at once')
  for (const [sid, agent, cid] of [['h1', 'host', 'host-ops'], ['k1', 'container', 'box'], ['r1', 'restricted', 'locked']]) assert.equal(s.spaceMember(cid, sid, true, agent), true, agent)
  assert.equal(s.spaceMember('host-ops', 't2', true, ''), false, "a main chat never goes into another agent's channel")
  assert.equal(s.spaceMember('voice', 't2', false, ''), false, 'removing from a channel it is not in changes nothing')
  await settle()
  assert.deepEqual(s.box.members, { 'hermes|t1': 'voice', 'host|h1': 'host-ops', 'container|k1': 'box', 'restricted|r1': 'locked' })
  assert.equal(s.spaceMember('voice', 't1', false, ''), true); await settle()
  assert.equal(s.box.members['hermes|t1'], undefined)
  assert.deepEqual(s.prefOps, [], 'never through ui-preferences while the store is on')
})

test('sort, pin, archive and rename are store PATCHes; this device keeps no channel prefs of its own', async () => {
  const s = await shell()
  s.channelClick(s.click({ 'data-chchansort': 'za' }), 'w', s.w)
  s.env.rowSheet = { wid: 'w', chan: 'launch' }; s.channelSheetClick(s.click({ 'data-rschpin': '' }))
  s.env.rowSheet = { wid: 'w', chan: 'launch' }; s.channelSheetClick(s.click({ 'data-rscharch': '' }))
  await settle()
  const sent = s.box.log.filter(l => l.startsWith('PATCH')).map(l => JSON.parse(l.slice(l.indexOf('{'))))
  assert.deepEqual(sent, [{ sort: 'za' }, { id: 'launch', pinned: true }, { id: 'launch', archived: true, pinned: false }])
  assert.equal(s.store.has('wos.chats.channel-prefs.v1'), false)
  assert.equal(s.chanPrefs().sort, 'za'); assert.equal(s.chanArchived('launch'), true); assert.deepEqual(s.chanPrefs().pins, ['alerts'])
})

test("this device's old pins and archive move onto the store once, and only count as moved once they landed", async () => {
  const local = { 'wos.chats.channel-prefs.v1': JSON.stringify({ sort: 'za', pins: ['voice', 'gone'], archived: { box: '2026-11-09T00:00:00.000Z' } }) }
  const s = await shell({ local })
  const patches = () => s.box.log.filter(l => l.startsWith('PATCH')).map(l => JSON.parse(l.slice(l.indexOf('{'))))
  // The box refuses the first write (offline, busy): nothing is marked, and the next try sends what is still missing.
  s.box.fail(1, 503)
  assert.equal(await s.chanCarry(), false); await settle()
  assert.equal(s.store.has('wos.chats.channel-prefs.carried.v1'), false, 'not marked while a write failed')
  assert.equal(await s.chanCarry(), true); await settle()
  assert.equal(s.store.has('wos.chats.channel-prefs.carried.v1'), true)
  assert.equal(await s.chanCarry(), true); await settle()
  assert.deepEqual(patches(), [{ id: 'voice', pinned: true }, { id: 'box', archived: true }, { id: 'voice', pinned: true }], 'the archive landed the first time; only the pin is sent again; nothing after the mark')
  assert.deepEqual(pins({ channels: s.box.channels }), ['alerts', 'voice']); assert.equal(s.box.channels.find(c => c.id === 'box').archived, true)
  assert.equal(s.box.sort, 'az', 'the sort stays the box one')
})

test('the feed adds the channel own list to the live rows, last 30 days, by agent', async () => {
  const s = await shell({ members: { 'hermes|old1': 'launch', 'hermes|t1': 'launch' }, rows: [row('t1', '', { channel: 'launch' })] })
  s.box.threads = {}
  const open = { id: 'launch', name: 'Launch', agent: 'hermes' }
  assert.deepEqual(s.chanFeedRows(open, s.env.LIVE.sessions).map(r => r.id), ['t1'], 'first paint: the live rows')
  await settle()
  s.dev.feed('launch', 'hermes').rows.forEach(r => { r.at = r.id === 'old1' ? NOW - 40 * 24 * H : NOW - 2 * H })
  assert.deepEqual(s.chanFeedRows(open, s.env.LIVE.sessions).map(r => r.id), ['t1'], 'old1 is older than 30 days; t1 is not drawn twice')
  s.dev.feed('launch', 'hermes').rows.find(r => r.id === 'old1').at = NOW - 5 * 24 * H
  assert.deepEqual(s.chanFeedRows(open, s.env.LIVE.sessions).map(r => r.id), ['t1', 'old1'])
  assert.equal(s.spaceContains('launch', 'old1'), true, 'a feed row belongs to its channel')
})

test('store off (404) or the switch off: Spaces exactly as in phase 1', async () => {
  for (const opts of [{ off: true }, { on: false }]) {
    const s = await shell({ ...opts, projection: [{ id: 'launch', name: 'Launch', threads: ['t1'] }] })
    assert.equal(s.chanStore(), null)
    assert.deepEqual(clone(s.spaces()).map(x => x.id), ['launch'])
    assert.equal(s.spaceMember('launch', 't2', true), true)
    assert.deepEqual(clone(s.prefOps), [{ op: 'add', key: 'spaces/launch/threads', item: 't2' }])
    assert.ok(!s.box.log.some(l => /^(PUT|PATCH)/.test(l)))
  }
})
