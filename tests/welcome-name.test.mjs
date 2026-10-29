// Name your Wizard: the Welcome's first step, run on the real web/core/welcome.js and web/core/config.js against a
// fake Agent Service. It shows only while the agent has the default name, Continue saves an edited name through
// PUT /wizard/v1/settings (keeping the rest of the agent block), Skip and an untouched Continue keep "Wizard", and the
// next steps say the new name.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const welcome = readFileSync(new URL('../web/core/welcome.js', import.meta.url), 'utf8')
const config = readFileSync(new URL('../web/core/config.js', import.meta.url), 'utf8')
const wait = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 2)) }

function fakeBox({ name = 'Wizard', authenticated = false, failPut = false, live = true } = {}) {
  const box = { settings: { agent: { name, adapter: 'hermes-plugin' }, owner: { name: '' } }, puts: [] }
  const ok = (body, status = 200) => ({ ok: status < 300, status, json: async () => JSON.parse(JSON.stringify(body)) })
  box.fetch = async (url, init = {}) => {
    const u = String(url), method = init.method || 'GET'
    if (u.endsWith('/wizard/v1/bootstrap')) return live ? ok({ bootstrap: 1, settings: box.settings, capabilities: {}, endpoints: {} }) : ok({ error: 'down' }, 503)
    if (u.endsWith('/wizard/v1/settings') && method === 'PUT') {
      const input = JSON.parse(init.body); box.puts.push(input)
      if (failPut) return ok({ error: 'unavailable' }, 503)
      box.settings = { ...box.settings, ...input }; return ok({ settings: box.settings })
    }
    if (u.endsWith('/wizard/v1/settings')) return ok({ settings: box.settings })
    if (u.endsWith('/wizard/v1/setup')) return ok({ first_run: true })
    if (u.endsWith('/wizard/hermes/api/model/options')) return ok({ providers: [{ slug: 'anthropic', authenticated }] })
    return ok({})
  }
  return box
}

// A small DOM: the overlay keeps its handlers and the card keeps its HTML, so a test can read the copy and press buttons.
function device(box, { pointer = 'fine' } = {}) {
  const handlers = {}, store = new Map()
  const input = { value: '', disabled: false, focus() {}, select() {} }
  const card = { _html: '', classList: { toggle() {} }, focus() {},
    set innerHTML(h) { card._html = h; const m = /<input[^>]*value="([^"]*)"/.exec(h); if (m) input.value = m[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>') },
    get innerHTML() { return card._html },
    querySelector: s => (/input/.test(s) && /<input/.test(card._html) ? input : /h2/.test(s) ? { focus() {} } : null) }
  const overlay = { className: '', id: '', classList: { add() {}, remove() {}, toggle() {} }, set innerHTML(h) {}, get innerHTML() { return '' },
    addEventListener: (t, f) => { handlers[t] = f }, remove() { overlay.removed = true },
    querySelector: s => (s === '.wl-card' ? card : /input/.test(s) && /<input/.test(card._html) ? input : s === 'form' ? { requestSubmit() { handlers.submit({ preventDefault() {} }) } } : null),
    querySelectorAll: () => [] }
  const doc = { createElement: () => overlay, body: { appendChild() {} }, documentElement: { classList: { add() {}, remove() {} } }, baseURI: 'https://box.test/wizard-os-home/', activeElement: null, addEventListener() {}, hidden: false }
  const ctx = {
    console, URL, URLSearchParams, Promise, JSON, Date, Math, String, Object, Array, Error, Map, Set,
    fetch: (u, i) => box.fetch(u, i), CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail } },
    setTimeout: (f, ms) => setTimeout(f, Math.min(ms || 0, 5)), clearTimeout,
    AbortController, AbortSignal, requestAnimationFrame: f => setTimeout(f, 0), matchMedia: () => ({ matches: pointer === 'fine' }),
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    document: doc, location: { href: 'https://box.test/wizard-os-home/desktop.html', origin: 'https://box.test' },
    Intl, navigator: { userAgent: 'test' },
  }
  ctx.window = ctx
  vm.createContext(ctx)
  vm.runInContext(config, ctx)
  vm.runInContext(welcome, ctx)
  const W = ctx.WosWelcome
  const press = act => handlers.click({ target: { closest: s => (s === '[data-wl]' ? { dataset: { wl: act } } : null) } })
  const submit = () => handlers.submit({ preventDefault() {} })
  const boot = async () => { W.boot({ app: () => null, deeplinked: () => false, busy: () => false, send: async () => ({ sessionId: 's1' }) }); await wait() }
  return { W, ctx, card, input, press, submit, boot, html: () => card._html }
}

test('Name your Wizard: first step, only while the agent has the default name', async () => {
  const d = device(fakeBox({ name: 'Wizard' }))
  await d.boot()
  assert.ok(d.W.active)
  assert.match(d.html(), /<h2 tabindex="-1">Name your Wizard<\/h2><p>What do you want to call your agent\?<\/p>/)
  assert.match(d.html(), /<input type="text" maxlength="40" value="Wizard"/)
  assert.match(d.html(), />Continue</)
  assert.match(d.html(), /data-wl="skip-name"[^>]*>Skip this step</)
  assert.equal((d.html().match(/<i class/g) || []).length, 4, 'four dots: name, AI, colour, hello')

  const named = device(fakeBox({ name: 'Oscar' }))
  await named.boot()
  assert.ok(named.W.active)
  assert.doesNotMatch(named.html(), /Name your Wizard/)
  assert.match(named.html(), /Connect your AI<\/h2><p>Oscar thinks with your own AI subscription/)
  assert.equal((named.html().match(/<i class/g) || []).length, 3)
})

test('Name your Wizard: never asked when the settings are not live (offline or cached)', async () => {
  const d = device(fakeBox({ name: 'Wizard', live: false }))
  await d.boot()
  assert.ok(d.W.active)
  assert.doesNotMatch(d.html(), /Name your Wizard/)
})

test('Name your Wizard: Continue saves a trimmed plain-text name, keeps the agent block, later steps use it', async () => {
  const box = fakeBox({ name: 'Wizard' }), d = device(box)
  await d.boot()
  d.input.value = '   Os<b>car  \n'
  d.submit(); await wait()
  assert.equal(box.puts.length, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(box.puts[0])), { agent: { name: 'Os b car', adapter: 'hermes-plugin' } })
  assert.equal(d.ctx.WizConfig.agent(), 'Os b car')
  assert.match(d.html(), /Connect your AI<\/h2><p>Os b car thinks with your own AI subscription/)

  const long = fakeBox({ name: 'Wizard' }), e = device(long)
  await e.boot()
  e.input.value = 'x'.repeat(60)
  e.submit(); await wait()
  assert.equal(long.puts[0].agent.name.length, 40)
})

test('Name your Wizard: the hello step says the new name (provider already signed in)', async () => {
  const box = fakeBox({ name: 'Wizard', authenticated: true }), d = device(box)
  await d.boot()
  assert.match(d.html(), /Name your Wizard/)
  d.input.value = 'Oscar'; d.submit(); await wait()
  // No skin catalogue in this fake, so the colour step falls through to Say hello, which says the new name.
  assert.match(d.html(), /Send your first message to Oscar\./)
})

test('Name your Wizard: Skip and an untouched Continue keep the default and write nothing', async () => {
  const a = fakeBox(), d = device(a)
  await d.boot()
  d.press('skip-name'); await wait()
  assert.equal(a.puts.length, 0)
  assert.match(d.html(), /Connect your AI<\/h2><p>Wizard thinks/)

  const b = fakeBox(), e = device(b)
  await e.boot()
  e.submit(); await wait()
  assert.equal(b.puts.length, 0)
  assert.match(e.html(), /Connect your AI/)
  assert.equal(e.ctx.WizConfig.agent(), 'Wizard')
})

test('Name your Wizard: a failed save stays on the step with the typed name; Back returns to it', async () => {
  const box = fakeBox({ failPut: true }), d = device(box)
  await d.boot()
  d.input.value = 'Merlin'; d.submit(); await wait()
  assert.match(d.html(), /Name your Wizard/)
  assert.match(d.html(), /role="alert">That name didn’t save/)
  assert.equal(d.input.value, 'Merlin')
  assert.equal(d.ctx.WizConfig.agent(), 'Wizard')
  d.press('skip-name'); await wait()
  assert.match(d.html(), /Connect your AI/)
  assert.equal(d.W.back(), 'welcome')
  assert.match(d.html(), /Name your Wizard/)
})
