import { modelContext, runWithChatsModel } from './fixtures/chats-list-model.mjs';
// Two devices, one box: the test every feature that syncs state across devices ships with (AGENTS.md).
// sharedBox() is a fake Agent Service ui-preferences store (PUT = shallow top-level merge, last write wins per key,
// like wizard-agent-service server/ui-preferences.mjs). box.race(n) holds the next n requests until all n arrived,
// so two devices interleave GET, GET, PUT, PUT (or PATCH, PATCH). Each device has its own localStorage.
// Use stale() and simultaneous() for every synced key: an edit on one device must never erase another's.
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8')
export const tick = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)) }
const clone = v => JSON.parse(JSON.stringify(v))
const answer = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => clone(body) })

// patch: false = an older Agent Service without item operations (PATCH answers 405).
export function sharedBox(initial = {}, { patch = true } = {}) {
  const box = { state: clone(initial), log: [], held: 0, waiters: [], apply: null }
  box.race = (n = 2) => { box.held = n }
  box.req = async (url, init = {}) => {
    const method = init.method || 'GET'
    if (method === 'PATCH' && !patch) return answer(405, { error: 'method_not_allowed' }) // instant: the race holds the GET/PUT fallback
    if (box.held > 0) { box.held--; await new Promise(r => { box.waiters.push(r); if (box.held === 0) box.waiters.splice(0).forEach(f => f()) }) }
    box.log.push(method)
    if (method === 'PATCH') {
      box.state = clone(box.apply(box.state, JSON.parse(init.body).ops)) // atomic on the box, as the service applies them
      return answer(200, box.state)
    }
    if (method === 'PUT') { box.state = { ...box.state, ...JSON.parse(init.body) }; return answer(200, box.state) }
    return answer(200, box.state)
  }
  return box
}

// One device running the real live.js preferences code (WizLive.putPrefs / prefOps / pullPrefs) against the box.
// pulled: false = a phone whose first pull never came back (asleep, backgrounded): it edits from its stale cache.
export function liveDevice(box, local = {}, { pulled = true } = {}) {
  const store = new Map(Object.entries(local)), events = []
  let boot = !pulled
  // Like live.js's req(): an HTTP error throws, carrying its status.
  const req = async (url, init) => {
    if (boot) { boot = false; return new Promise(() => {}) }
    const r = await box.req(url, init)
    if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { status: r.status })
    return r
  }
  const ctx = { req, console, Event: class { constructor(type) { this.type = type } }, setInterval() {}, setTimeout: () => 0, clearTimeout() {},
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    addEventListener() {} }
  ctx.window = { dispatchEvent: e => events.push(e.type), addEventListener() {} }
  modelContext(ctx)
  const live = read('web/live.js')
  vm.runInContext(live.slice(live.indexOf('  const PREFS_URL ='), live.indexOf('  const sectionTime =')) + '\nthis.api = { pullPrefs, putPrefs, prefOps, applyPrefOps };', ctx)
  box.apply ||= ctx.api.applyPrefOps
  return { ...ctx.api, ctx, store, events }
}

// The device has not pulled since `local` was cached; it edits, then the box must hold both devices' edits.
export async function stale({ initial, local = {}, first, second, patch = true }) {
  const box = sharedBox(initial, { patch }), a = liveDevice(box, local), b = liveDevice(box, local, { pulled: false })
  await tick(); await first(a); await second(b)
  return box
}
// Both devices read before either writes.
export async function simultaneous({ initial, local = {}, first, second, patch = true }) {
  const box = sharedBox(initial, { patch }), a = liveDevice(box, local), b = liveDevice(box, local)
  await tick(); box.race(2)
  await Promise.all([first(a), second(b)])
  return box
}

// The Agent Service channel store (wizard-agent-service server/channel-store.mjs + session-list-window.mjs, issue 440)
// as one fake box, for Chats channels on the store (wizard-ux issue 1261): GET/POST/PATCH /wizard/v1/channels,
// PUT /wizard/v1/channels/membership and the channel feed (sessions?view=list&channel=). Same rules: each PATCH is one
// item operation applied atomically, pinning appends to that agent's pin order, a thread is in one channel of its
// agent (keyed agent|id), unknown channels are 404, another agent's channel is 409. off: true = the store is off (404).
// box.race(n) and box.fail(n, status) hold or refuse the next requests, like sharedBox.
export function channelBox({ channels = [], sort = 'az', members = {}, threads = {}, off = false } = {}) {
  const box = { channels: clone(channels), sort, members: { ...members }, threads: clone(threads), off, log: [], held: 0, waiters: [], failing: 0, failStatus: 0, hold: null, ids: 0 }
  box.race = (n = 2) => { box.held = n }
  box.fail = (n = 1, status = 503) => { box.failing = n; box.failStatus = status }
  const view = c => ({ ...c, count: Object.values(box.members).filter(x => x === c.id).length })
  const list = () => ({ schema: 'wizard.channels/1', sort: box.sort, migratedAt: null, channels: box.channels.map(view) })
  const bad = (status, error) => answer(status, { error })
  box.req = async (url, init = {}) => {
    const method = init.method || 'GET', u = new URL(url, 'https://box.test'), body = init.body ? JSON.parse(init.body) : null
    if (box.held > 0) { box.held--; await new Promise(r => { box.waiters.push(r); if (box.held === 0) box.waiters.splice(0).forEach(f => f()) }) }
    if (box.hold) await box.hold
    box.log.push(`${method} ${u.pathname}${u.search}${body ? ' ' + JSON.stringify(body) : ''}`)
    if (box.failing > 0) { box.failing--; return bad(box.failStatus, 'unavailable') }
    if (box.off) return bad(404, 'not_found')
    if (u.pathname === '/wizard/v1/channels') {
      if (method === 'GET') return answer(200, list())
      if (method === 'POST') { const c = { id: 'channel-' + (++box.ids), agent: body.agent || 'hermes', name: body.name.trim(), order: box.channels.length, createdAt: '2026-11-11T00:00:00.000Z', archived: false, pinned: false }; box.channels.push(c); return answer(201, view(c)) }
      const keys = Object.keys(body)
      if (keys.length === 1 && keys[0] === 'sort') { box.sort = body.sort; return answer(200, list()) }
      const c = box.channels.find(x => x.id === body.id); if (!c) return bad(404, 'channel_not_found')
      if (typeof body.name === 'string') c.name = body.name.trim()
      if (typeof body.archived === 'boolean' && body.archived !== c.archived) { c.archived = body.archived; if (body.archived) c.archivedAt = '2026-11-11T01:00:00.000Z'; else delete c.archivedAt }
      if (body.pinned === true && !c.pinned) { c.pinned = true; c.pinOrder = box.channels.filter(x => x.agent === c.agent && x.pinned && x !== c).reduce((m, x) => Math.max(m, x.pinOrder), -1) + 1 }
      if (body.pinned === false) { c.pinned = false; delete c.pinOrder }
      return answer(200, view(c))
    }
    if (u.pathname === '/wizard/v1/channels/membership') {
      if (body.channelId === null) { delete box.members[(body.agent || 'hermes') + '|' + body.sessionId]; return answer(200, { sessionId: body.sessionId, agent: body.agent || 'hermes', channel: null }) }
      const c = box.channels.find(x => x.id === body.channelId); if (!c) return bad(404, 'channel_not_found')
      if (body.agent && body.agent !== c.agent) return bad(409, 'agent_mismatch')
      box.members[c.agent + '|' + body.sessionId] = c.id
      return answer(200, { sessionId: body.sessionId, agent: c.agent, channel: c.id })
    }
    if (u.pathname === '/wizard/hermes/api/sessions' && u.searchParams.has('channel')) {
      const id = u.searchParams.get('channel'), agent = u.searchParams.get('agent') || 'hermes', c = box.channels.find(x => x.id === id)
      if (!c || c.agent !== agent) return bad(404, 'not_found')
      const rows = Object.entries(box.members).filter(([k, v]) => v === id && k.startsWith(agent + '|')).map(([k]) => k.slice(agent.length + 1)).sort().map(sid => ({ listVersion: 1, id: sid, title: 'T ' + sid, status: 'completed', ...(box.threads[sid] || {}), channel: id }))
      const offset = Number(u.searchParams.get('offset') || 0), limit = Number(u.searchParams.get('limit') || 100), data = rows.slice(offset, offset + limit)
      return answer(200, { object: 'list', data, offset, limit, has_more: offset + data.length < rows.length, snapshot: 'snap-' + id, window: 'channel', channel: id, order: 'oldest', channel_total: rows.length })
    }
    return bad(404, 'not_found')
  }
  return box
}

// One device running the real live.js channel store (channelStore) against the box, with its own localStorage and
// clock. offline: true = every request fails as if the network were down.
export function channelDevice(box, local = {}, { now = () => Date.parse('2026-11-11T12:00:00.000Z') } = {}) {
  const store = new Map(Object.entries(local)), errors = []
  let emits = 0, offline = false
  const req = async (url, init) => {
    if (offline) throw new TypeError('Failed to fetch')
    const r = await box.req(url, init)
    if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { status: r.status })
    return r
  }
  const ctx = { console, URL, Date, JSON }
  vm.createContext(ctx)
  const live = read('web/live.js')
  vm.runInContext(live.slice(live.indexOf('  /* ---- channel store'), live.indexOf('  /* ---- end channel store ---- */')) + '\nthis.channelStore = channelStore;', ctx)
  const clock = { t: now() }
  const api = ctx.channelStore({ req, emit: () => { emits++ }, onError: r => errors.push(r), now: () => clock.t,
    storage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) } })
  return { ...api, api, store, errors, clock, get emits() { return emits }, set offline(v) { offline = v } }
}
