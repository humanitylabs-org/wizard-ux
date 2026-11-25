// Standard first onboarding (wizard-ux issue 1800, switch wizard/standard-first-setup, off by default): Connect your AI
// asks for Claude or ChatGPT first (also when the box says private first is on), with Skip for now, then offers private
// AI once (Set up private AI / Later / No thanks). Later leaves Settings › Privacy's "Finish setting up private AI".
// Runs the real web/core/welcome.js and web/core/config.js against a fake Agent Service (welcome-private-first harness).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const welcome = readFileSync(new URL('../web/core/welcome.js', import.meta.url), 'utf8')
const config = readFileSync(new URL('../web/core/config.js', import.meta.url), 'utf8')
const wait = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 2)) }
const until = async (f, n = 400) => { for (let i = 0; i < n && !f(); i++) await new Promise(r => setTimeout(r, 2)); return f() }
const SW = 'wizard/standard-first-setup'

// pf: the Agent Service's private first state (null = 404, an older Agent Service). POST {offer} answers like
// wizard-agent-service (setup turns it on for the box).
function fakeBox({ pf = null, providers = [], firstRun = true } = {}) {
  const box = { settings: { agent: { name: 'Ana', adapter: 'hermes-plugin' }, owner: { name: '' } }, pf, providers, firstRun, reads: [], offers: [] }
  const ok = (body, status = 200) => ({ ok: status < 300, status, json: async () => JSON.parse(JSON.stringify(body)) })
  box.fetch = async (url, init = {}) => {
    const u = String(url); box.reads.push(u)
    if (u.endsWith('/wizard/v1/bootstrap')) return ok({ bootstrap: 1, settings: box.settings, capabilities: {}, endpoints: {} })
    if (u.endsWith('/wizard/v1/settings')) return ok({ settings: box.settings })
    if (u.endsWith('/wizard/v1/setup')) return ok({ first_run: box.firstRun })
    if (u.endsWith('/wizard/v1/private-first')) {
      if (!box.pf) return ok({ error: 'not_found' }, 404)
      if (init.method === 'POST') {
        const { offer } = JSON.parse(init.body); box.offers.push(offer)
        box.pf = { ...box.pf, offer, on: offer === 'setup' ? true : box.pf.on }
      }
      return ok(box.pf)
    }
    if (u.endsWith('/wizard/hermes/api/model/options')) return ok({ providers: box.providers })
    return ok({})
  }
  return box
}

function device(box, { tweaks = SW } = {}) {
  const handlers = {}, store = new Map(), features = []
  const card = { _html: '', classList: { toggle() {} }, focus() {}, set innerHTML(h) { card._html = h }, get innerHTML() { return card._html },
    querySelector: s => (/h2/.test(s) ? { focus() {} } : null) }
  let shown = false
  const overlay = { className: '', id: '', classList: { add() {}, remove() {}, toggle() {} }, set innerHTML(h) {}, get innerHTML() { return '' },
    addEventListener: (t, f) => { handlers[t] = f }, remove() { shown = false }, querySelector: s => (s === '.wl-card' ? card : null), querySelectorAll: () => [] }
  const doc = { createElement: () => overlay, body: { appendChild() { shown = true } }, documentElement: { getAttribute: n => (n === 'data-tweaks' ? tweaks : null), classList: { add() {}, remove() {} } },
    baseURI: 'https://box.test/wizard-os-home/', activeElement: null, addEventListener() {}, hidden: false }
  const ctx = {
    console, URL, URLSearchParams, Promise, JSON, Date, Math, String, Object, Array, Error, Map, Set,
    fetch: (u, i) => box.fetch(u, i), CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail } },
    setTimeout: (f, ms) => setTimeout(f, Math.min(ms || 0, 5)), clearTimeout,
    AbortController, AbortSignal, requestAnimationFrame: f => setTimeout(f, 0), matchMedia: () => ({ matches: false }),
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    document: doc, location: { href: 'https://box.test/wizard-os-home/desktop.html', origin: 'https://box.test' },
    Intl, navigator: { userAgent: 'test' },
    WosSkin: { list: [{ id: 'nebula', name: 'Nebula', t: {} }], current: 'nebula', set() {} },
    WosSettings: { register: f => { features.push(f); return () => {} }, refresh() {} },
  }
  ctx.window = ctx
  vm.createContext(ctx)
  vm.runInContext(config, ctx)
  vm.runInContext(welcome, ctx)
  const W = ctx.WosWelcome
  const press = (act, data = {}) => handlers.click({ target: { closest: s => (s === '[data-wl]' ? { dataset: { wl: act, ...data } } : null) } })
  const apps = { 'wizard-tinfoil': { url: '/tinfoil/' }, 'wizard-claude': { url: '/claude/' }, 'wizard-chatgpt': { url: '/chatgpt/' } }
  const boot = async () => { W.boot({ app: id => apps[id] || null, deeplinked: () => false, busy: () => false, send: async () => ({ sessionId: 's1' }) }); await wait() }
  return { W, press, boot, html: () => card._html, features, shown: () => shown }
}

const order = html => [...html.matchAll(/data-app="([^"]+)"/g)].map(m => m[1])
const ON = { schema: 'wizard.private-first/1', on: true, standard_agent: 'hermes', private_agent: null, standard_on: true, offer: null }
const OFF = { ...ON, on: false }
const title = html => (html.match(/<h2[^>]*>([^<]*)</) || [])[1]

test('switch off: the Welcome is unchanged (private first on still leads with Tinfoil; off lists all three)', async () => {
  const pfOn = device(fakeBox({ pf: ON }), { tweaks: '' })
  await pfOn.boot()
  assert.deepEqual(order(pfOn.html()), ['wizard-tinfoil', 'wizard-claude', 'wizard-chatgpt'])
  assert.doesNotMatch(pfOn.html(), /Skip for now/)
  const pfOff = device(fakeBox({ pf: OFF }), { tweaks: 'wizard/chat-channels' })
  await pfOff.boot()
  assert.deepEqual(order(pfOff.html()), ['wizard-claude', 'wizard-chatgpt', 'wizard-tinfoil'])
  assert.match(pfOff.html(), /thinks with your own AI subscription/)
  assert.deepEqual(pfOff.features.map(f => f.available()), [false], 'no Settings › Privacy row')
})

test('switch on, a fresh Mac (private first on): Connect your AI asks for Claude or ChatGPT, with Skip for now', async () => {
  const d = device(fakeBox({ pf: ON }))
  await d.boot()
  const h = d.html()
  assert.equal(title(h), 'Connect your AI')
  assert.match(h, /Sign in with the AI you already pay for\. We recommend at least one; you can add more later\./)
  assert.deepEqual(order(h), ['wizard-claude', 'wizard-chatgpt'])
  assert.match(h, /Sign in with Claude/)
  assert.match(h, /Sign in with ChatGPT/)
  assert.match(h, /data-wl="skip-ai"[^>]*>Skip for now/)
  assert.doesNotMatch(h, /Tinfoil|second agent/)
})

test('Sign in with ChatGPT, then the private AI offer, then Later: the box remembers it and the Welcome goes on', async () => {
  const box = fakeBox({ pf: OFF }), d = device(box)
  await d.boot()
  d.press('provider', { app: 'wizard-chatgpt' })
  assert.match(d.html(), /Sign in to ChatGPT/)
  assert.doesNotMatch(d.html(), /Adds a second agent/)
  box.providers = [{ slug: 'openai-codex', authenticated: true }]
  assert.ok(await until(() => title(d.html()) === 'Want a fully private AI?'))
  const h = d.html()
  assert.match(h, /Private AI runs in sealed hardware\. No one except you, not us or any AI company, can see your messages, its answers or your data\. Use it alongside your Claude or ChatGPT, or on its own\./)
  assert.match(h, /class="wl-primary" data-wl="offer" data-offer="setup"[^>]*>Set up private AI/)
  assert.match(h, /data-offer="later"[^>]*>Later/)
  assert.match(h, /data-offer="declined"[^>]*>No thanks/)
  assert.doesNotMatch(h, /haven\u2019t connected an AI yet/)
  assert.doesNotMatch(h, /Why does this matter/, 'hidden until its page exists')
  d.press('offer', { offer: 'later' })
  assert.ok(await until(() => title(d.html()) === 'Pick a skin'))
  assert.deepEqual(box.offers, ['later'])
  // Back from the skin is the Welcome's usual close; the offer is never asked again in this Welcome.
})

test('Claude the same way; No thanks is remembered and nothing prompts again', async () => {
  const box = fakeBox({ pf: OFF }), d = device(box)
  await d.boot()
  d.press('provider', { app: 'wizard-claude' })
  box.providers = [{ slug: 'anthropic', authenticated: true }]
  assert.ok(await until(() => title(d.html()) === 'Want a fully private AI?'))
  d.press('offer', { offer: 'declined' })
  assert.ok(await until(() => title(d.html()) === 'Pick a skin'))
  assert.deepEqual(box.offers, ['declined'])
  // A later Welcome on this box (another device) skips the offer.
  const other = device(box)
  box.providers = []
  await other.boot()
  other.press('provider', { app: 'wizard-claude' })
  box.providers = [{ slug: 'anthropic', authenticated: true }]
  assert.ok(await until(() => title(other.html()) === 'Pick a skin'))
  assert.deepEqual(other.features.map(f => f.available()), [false])
})

test('Skip for now with nothing connected: the Private AI step leads with private AI as the way to get a model', async () => {
  const d = device(fakeBox({ pf: OFF }))
  await d.boot()
  d.press('skip-ai')
  const h = d.html()
  assert.equal(title(h), 'Want a fully private AI?')
  assert.match(h, /class="wl-lead">You haven\u2019t connected an AI yet\. Private AI can be how Ana thinks/)
  assert.ok(h.indexOf('wl-lead') < h.indexOf('sealed hardware'))
  // Back returns to Connect your AI.
  assert.equal(d.W.back(), 'welcome')
  assert.equal(title(d.html()), 'Connect your AI')
})

test('Set up private AI: the box opts in, then the Tinfoil sign-in runs until the private agent exists', async () => {
  const box = fakeBox({ pf: OFF }), d = device(box)
  await d.boot()
  d.press('skip-ai')
  d.press('offer', { offer: 'setup' })
  assert.ok(await until(() => /Sign in to Tinfoil/.test(d.html())))
  assert.deepEqual(box.offers, ['setup'])
  box.pf = { ...box.pf, private_agent: 'private', standard_on: false } // the Agent Service made it (wizard-agent-service#545)
  assert.ok(await until(() => /Tinfoil is connected\./.test(d.html())))
  assert.ok(await until(() => title(d.html()) === 'Pick a skin'))
})

test('Set up private AI on an Agent Service without the offer route: it says so and stays', async () => {
  const box = fakeBox({ pf: null }), d = device(box)
  await d.boot()
  d.press('skip-ai')
  assert.equal(title(d.html()), 'Want a fully private AI?')
  d.press('offer', { offer: 'setup' })
  assert.ok(await until(() => /can\u2019t be set up on this Wizard yet/.test(d.html())))
  assert.equal(title(d.html()), 'Want a fully private AI?')
  d.press('offer', { offer: 'later' })
  assert.ok(await until(() => title(d.html()) === 'Pick a skin'), 'Later still goes on')
})

test('an AI connected before the Welcome (a Mac setup): it opens at the offer, not the skin', async () => {
  const d = device(fakeBox({ pf: OFF, providers: [{ slug: 'openai-codex', authenticated: true }] }))
  await d.boot()
  assert.equal(title(d.html()), 'Want a fully private AI?')
  const done = device(fakeBox({ pf: { ...OFF, offer: 'later' }, providers: [{ slug: 'openai-codex', authenticated: true }] }))
  await done.boot()
  assert.equal(title(done.html()), 'Pick a skin')
})

test('Reconnect your AI never offers private AI', async () => {
  const box = fakeBox({ pf: OFF, firstRun: false }), d = device(box)
  await d.boot()
  assert.equal(title(d.html()), 'Reconnect your AI')
  d.press('provider', { app: 'wizard-chatgpt' })
  box.providers = [{ slug: 'openai-codex', authenticated: true }]
  assert.ok(await until(() => !d.shown()))
  assert.deepEqual(box.offers, [])
})

test('Later leaves Settings › Privacy\'s "Finish setting up private AI", which opens the private AI setup on its own', async () => {
  const box = fakeBox({ pf: { ...OFF, offer: 'later' }, providers: [{ slug: 'openai-codex', authenticated: true }] })
  const d = device(box)
  await d.boot() // the offer was answered: no Welcome at the skin step for an unfinished device either way
  const [row] = d.features
  assert.equal(row.page, 'privacy')
  assert.ok(await until(() => row.available()))
  assert.match(row.html(), /Finish setting up private AI/)
  d.W.close()
  const tap = { closest: s => (s === '[data-private-ai-finish]' ? {} : null) }
  // Another device finished it meanwhile: the tap asks the box first and opens nothing (Codex P2).
  box.pf = { ...box.pf, offer: 'declined' }
  assert.equal(row.act({}, tap), true)
  await wait(20)
  assert.equal(d.shown(), false)
  assert.equal(row.available(), false)
  box.pf = { ...box.pf, offer: 'later' }
  assert.equal(row.act({}, tap), true)
  assert.ok(await until(() => title(d.html()) === 'Want a fully private AI?'))
  assert.doesNotMatch(d.html(), /wl-dots/, 'one screen, no step dots')
  d.press('offer', { offer: 'setup' })
  assert.ok(await until(() => /Sign in to Tinfoil/.test(d.html())))
  box.pf = { ...box.pf, private_agent: 'private' }
  assert.ok(await until(() => !d.shown()), 'closes once private AI is set up')
  // Done: the row goes.
  assert.equal(row.available(), false)
})
