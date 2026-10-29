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
  vm.createContext(ctx)
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
