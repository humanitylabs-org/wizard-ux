// Private first setup (wizard-ux issue 1549, wizard-os DECISIONS #115, switch wizard/private-first-setup): since standard
// first (wizard-ux issue 1800) a new Wizard's Welcome always asks for Claude or ChatGPT first
// (tests/welcome-standard-first.test.mjs). Private first's order is kept for Reconnect your AI: with it on, Tinfoil leads
// (Private, recommended) and Claude and ChatGPT are an optional second agent. Runs the real web/core/welcome.js and
// web/core/config.js against a fake Agent Service (harness from welcome-bring-your-ai.test.mjs).
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const welcome = readFileSync(new URL('../web/core/welcome.js', import.meta.url), 'utf8')
const config = readFileSync(new URL('../web/core/config.js', import.meta.url), 'utf8')
const wait = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 2)) }
const until = async (f, n = 200) => { for (let i = 0; i < n && !f(); i++) await new Promise(r => setTimeout(r, 2)); return f() }

// pf: the Agent Service's GET /wizard/v1/private-first answer (null = 404, an older Agent Service).
// firstRun false: a Wizard that is set up already, so a signed-out AI opens Reconnect your AI.
function fakeBox({ pf = null, providers = [], firstRun = false } = {}) {
  const box = { settings: { agent: { name: 'Ana', adapter: 'hermes-plugin' }, owner: { name: '' } }, pf, providers, reads: [] }
  const ok = (body, status = 200) => ({ ok: status < 300, status, json: async () => JSON.parse(JSON.stringify(body)) })
  box.fetch = async (url, init = {}) => {
    const u = String(url); box.reads.push(u)
    if (u.endsWith('/wizard/v1/bootstrap')) return ok({ bootstrap: 1, settings: box.settings, capabilities: {}, endpoints: {} })
    if (u.endsWith('/wizard/v1/settings')) return ok({ settings: box.settings })
    if (u.endsWith('/wizard/v1/setup')) return ok({ first_run: firstRun })
    if (u.endsWith('/wizard/v1/private-first')) return box.pf ? ok(box.pf) : ok({ error: 'not_found' }, 404)
    if (u.endsWith('/wizard/hermes/api/model/options')) return ok({ providers: box.providers })
    return ok({})
  }
  return box
}

function device(box, { tweaks = '' } = {}) {
  const handlers = {}, store = new Map()
  const card = { _html: '', classList: { toggle() {} }, focus() {}, set innerHTML(h) { card._html = h }, get innerHTML() { return card._html },
    querySelector: s => (/h2/.test(s) ? { focus() {} } : null) }
  const overlay = { className: '', id: '', classList: { add() {}, remove() {}, toggle() {} }, set innerHTML(h) {}, get innerHTML() { return '' },
    addEventListener: (t, f) => { handlers[t] = f }, remove() {}, querySelector: s => (s === '.wl-card' ? card : null), querySelectorAll: () => [] }
  const doc = { createElement: () => overlay, body: { appendChild() {} }, documentElement: { getAttribute: n => (n === 'data-tweaks' ? tweaks : null), classList: { add() {}, remove() {} } },
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
  }
  ctx.window = ctx
  vm.createContext(ctx)
  vm.runInContext(config, ctx)
  vm.runInContext(welcome, ctx)
  const W = ctx.WosWelcome
  const press = (act, data = {}) => handlers.click({ target: { closest: s => (s === '[data-wl]' ? { dataset: { wl: act, ...data } } : null) } })
  const apps = { 'wizard-tinfoil': { url: '/tinfoil/' }, 'wizard-claude': { url: '/claude/' }, 'wizard-chatgpt': { url: '/chatgpt/' } }
  const boot = async () => { W.boot({ app: id => apps[id] || null, deeplinked: () => false, busy: () => false, send: async () => ({ sessionId: 's1' }) }); await wait() }
  return { W, press, boot, html: () => card._html, active: () => W.active }
}

const order = html => [...html.matchAll(/data-app="([^"]+)"/g)].map(m => m[1])
const ON = { schema: 'wizard.private-first/1', on: true, standard_agent: 'main', private_agent: null, standard_on: true }

test('private first off: Reconnect your AI lists Claude, ChatGPT and Tinfoil, no second-agent copy', async () => {
  const d = device(fakeBox({ pf: { ...ON, on: false } }))
  await d.boot()
  assert.match(d.html(), /Reconnect your AI/)
  assert.deepEqual(order(d.html()), ['wizard-claude', 'wizard-chatgpt', 'wizard-tinfoil'])
  assert.doesNotMatch(d.html(), /second agent/)
})

test('the Agent Service answer wins over the shell switch (its env forces it off)', async () => {
  const d = device(fakeBox({ pf: { ...ON, on: false } }), { tweaks: 'wizard/private-first-setup' })
  await d.boot()
  assert.deepEqual(order(d.html()), ['wizard-claude', 'wizard-chatgpt', 'wizard-tinfoil'])
})

test('private first on: Reconnect your AI leads with Tinfoil, Claude and ChatGPT as an optional second agent', async () => {
  const d = device(fakeBox({ pf: ON }))
  await d.boot()
  const h = d.html()
  assert.match(h, /Reconnect your AI/)
  assert.deepEqual(order(h), ['wizard-tinfoil', 'wizard-claude', 'wizard-chatgpt'])
  assert.match(h, /Tinfoil<span class="wl-sub">Private<\/span><\/span><span class="wl-tag">Recommended<\/span>/)
  assert.match(h, /Optional: a second agent/)
  assert.match(h, /Adds a second agent that uses Claude\. Your private agent and its apps stay private\./)
  assert.match(h, /Adds a second agent that uses ChatGPT\. Your private agent and its apps stay private\./)
  assert.ok(h.indexOf('Recommended') < h.indexOf('Optional: a second agent'))
})

test('a new Wizard with private first on still gets standard first (wizard-ux issue 1800)', async () => {
  const d = device(fakeBox({ pf: ON, firstRun: true }), { tweaks: 'wizard/private-first-setup' })
  await d.boot()
  assert.match(d.html(), /Connect your AI/)
  assert.deepEqual(order(d.html()), ['wizard-claude', 'wizard-chatgpt'])
})

test('an older Agent Service (404): the shell switch decides', async () => {
  const on = device(fakeBox({ pf: null }), { tweaks: 'wizard/chat-channels wizard/private-first-setup' })
  await on.boot()
  assert.deepEqual(order(on.html()), ['wizard-tinfoil', 'wizard-claude', 'wizard-chatgpt'])
  const off = device(fakeBox({ pf: null }), { tweaks: 'wizard/chat-channels' })
  await off.boot()
  assert.deepEqual(order(off.html()), ['wizard-claude', 'wizard-chatgpt', 'wizard-tinfoil'])
})

test('Tinfoil sign-in: once the private agent exists the AI is back and Reconnect closes', async () => {
  const box = fakeBox({ pf: ON }), d = device(box)
  await d.boot()
  d.press('provider', { app: 'wizard-tinfoil' })
  assert.match(d.html(), /Sign in to Tinfoil/)
  assert.doesNotMatch(d.html(), /Adds a second agent/, 'the private sign-in has no second-agent line')
  box.pf = { ...ON, private_agent: 'private-1', standard_on: false } // the Agent Service made the private agent
  assert.ok(await until(() => /Tinfoil is connected\./.test(d.html())))
  assert.ok(await until(() => !d.active()))
})

test('a second agent: the Claude sign-in says what it adds', async () => {
  const box = fakeBox({ pf: ON }), d = device(box)
  await d.boot()
  d.press('provider', { app: 'wizard-claude' })
  assert.match(d.html(), /Sign in to Claude/)
  assert.match(d.html(), /Adds a second agent that uses Claude\. Your private agent and its apps stay private\. This continues by itself/)
  box.providers = [{ slug: 'anthropic', authenticated: true }]
  assert.ok(await until(() => !d.active()))
})

test('boot: a box whose private agent exists counts as connected (no Connect your AI again)', async () => {
  const d = device(fakeBox({ pf: { ...ON, private_agent: 'private-1', offer: 'setup' }, firstRun: true }))
  await d.boot()
  assert.match(d.html(), /Pick a skin/)
})

test('Tinfoil signed in is not enough: it waits for the private agent record (Codex P1), then a short grace', async () => {
  const box = fakeBox({ pf: ON }), d = device(box)
  await d.boot()
  d.press('provider', { app: 'wizard-tinfoil' })
  box.providers = [{ slug: 'wizard-tinfoil', authenticated: true }] // the sign-in shows before the agent is made
  const reads = () => box.reads.filter(u => u.endsWith('/wizard/v1/private-first')).length
  const before = reads()
  assert.ok(await until(() => reads() >= before + 3))
  assert.doesNotMatch(d.html(), /is connected/, 'never ready on the sign-in alone')
  box.pf = { ...ON, private_agent: 'private-1' }
  assert.ok(await until(() => /Tinfoil is connected\./.test(d.html())))
})

test('a box with no private agent recorded still goes on after the grace', async () => {
  const box = fakeBox({ pf: ON }), d = device(box)
  await d.boot()
  d.press('provider', { app: 'wizard-tinfoil' })
  box.providers = [{ slug: 'wizard-tinfoil', authenticated: true }] // signed in; the Agent Service records no default private agent
  assert.ok(await until(() => /Tinfoil is connected\./.test(d.html()), 2000))
})
