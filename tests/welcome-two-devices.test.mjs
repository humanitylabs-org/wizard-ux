// Two devices, one box, for the first-run Welcome (AGENTS.md "Synced across devices"). The synced state is the Agent
// Service's Setup "seen" mark (POST /wizard/v1/setup/seen, idempotent): once any device finishes the Welcome, a
// stale device that never saw it must not show it again, two devices finishing together must both settle, and a
// device whose seen write failed must retry it on its next launch. Each device runs the real web/core/welcome.js.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { tick } from './two-devices.mjs'

const src = readFileSync(new URL('../web/core/welcome.js', import.meta.url), 'utf8')

function fakeBox({ seen = false, authenticated = true, failSeen = 0 } = {}) {
  const box = { seen, posts: 0, failSeen, held: 0, waiters: [] }
  box.race = n => { box.held = n }
  box.fetch = async (url, init = {}) => {
    const u = String(url), method = init.method || 'GET'
    if (box.held > 0 && method === 'POST') { box.held--; await new Promise(r => { box.waiters.push(r); if (box.held === 0) box.waiters.splice(0).forEach(f => f()) }) }
    const ok = (body, status = 200) => ({ ok: status < 300, status, json: async () => JSON.parse(JSON.stringify(body)) })
    if (u.endsWith('/wizard/v1/setup/seen') && method === 'POST') {
      box.posts++
      if (box.failSeen > 0) { box.failSeen--; return ok({ error: 'unavailable' }, 503) }
      box.seen = true; return ok({ ok: true })
    }
    if (u.endsWith('/wizard/v1/setup')) return ok({ first_run: !box.seen, launch_mode: 'alongside' })
    if (u.endsWith('/wizard/hermes/api/model/options')) return ok({ providers: [{ slug: 'anthropic', authenticated }] })
    return ok({})
  }
  return box
}

function fakeEl() {
  const el = { innerHTML: '', className: '', id: '', classList: { add() {}, remove() {}, toggle() {} }, style: {},
    addEventListener() {}, removeEventListener() {}, remove() {}, appendChild() {}, focus() {},
    querySelector: () => fakeEl(), querySelectorAll: () => [], matches: () => false }
  return el
}

function device(box, local = {}) {
  const store = new Map(Object.entries(local))
  const ctx = {
    console, URL, URLSearchParams, Promise, JSON, Date, Math, String, Object, Array, Error,
    fetch: (u, i) => box.fetch(u, i),
    setTimeout: (f, ms) => setTimeout(f, Math.min(ms || 0, 5)), clearTimeout,
    AbortController, AbortSignal, requestAnimationFrame: f => setTimeout(f, 0),
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    addEventListener() {}, removeEventListener() {},
    document: { createElement: fakeEl, body: fakeEl(), documentElement: fakeEl(), baseURI: 'https://box.test/wizard-os-home/', activeElement: null },
    location: { href: 'https://box.test/wizard-os-home/desktop.html' },
  }
  ctx.window = ctx
  vm.createContext(ctx)
  vm.runInContext(src, ctx)
  const W = ctx.WosWelcome
  const boot = async () => {
    W.boot({ app: () => null, deeplinked: () => false, busy: () => false, send: async () => ({ sessionId: 's1' }) })
    for (let i = 0; i < 10; i++) { await tick(); await new Promise(r => setTimeout(r, 5)) }
    return W.log
  }
  return { W, store, boot }
}

const opened = log => log.some(l => String(l).startsWith('open:'))

test('stale device: a Welcome finished on another device never reappears', async () => {
  const box = fakeBox()
  const a = device(box, { 'wos.welcome.v1': 'done', 'wos.welcome.v1.seen-pending': '1' })
  await a.boot()
  assert.equal(box.seen, true, 'device A retried and the box holds seen')
  const b = device(box) // never ran the Welcome here, nothing cached
  assert.equal(opened(await b.boot()), false, 'device B with a signed-in agent stays on its desktop')
})

test('simultaneous: two devices settling seen together both finish, the box is seen once and for all', async () => {
  const box = fakeBox()
  const pending = { 'wos.welcome.v1': 'done', 'wos.welcome.v1.seen-pending': '1' }
  const a = device(box, pending), b = device(box, pending)
  box.race(2)
  await Promise.all([a.boot(), b.boot()])
  assert.equal(box.seen, true)
  assert.equal(box.posts, 2)
  for (const d of [a, b]) assert.equal(d.store.get('wos.welcome.v1.seen-pending'), undefined, 'both cleared their retry')
})

test('a failed seen write is retried on the next launch, never dropped', async () => {
  const box = fakeBox({ failSeen: 1 })
  const local = { 'wos.welcome.v1': 'done', 'wos.welcome.v1.seen-pending': '1' }
  const first = device(box, local)
  await first.boot()
  assert.equal(box.seen, false)
  assert.equal(first.store.get('wos.welcome.v1.seen-pending'), '1', 'still pending after the 503')
  const again = device(box, Object.fromEntries(first.store))
  await again.boot()
  assert.equal(box.seen, true, 'the next launch delivered it')
  assert.equal(again.store.get('wos.welcome.v1.seen-pending'), undefined)
})

test('no AI signed in: every device shows the Welcome until one connects', async () => {
  const box = fakeBox({ authenticated: false })
  assert.equal(opened(await device(box).boot()), true)
  assert.equal(opened(await device(box).boot()), true)
})
