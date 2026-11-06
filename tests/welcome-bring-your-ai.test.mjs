// Bring your AI (wizard-ux #898): the Welcome's optional step before Say hello, only on a Wizard with the Importer app.
// It embeds the Importer's own screen (one Importer, two ways in) and never imports anything itself. Runs the real
// web/core/welcome.js and web/core/config.js against a fake Agent Service (harness from welcome-name.test.mjs).
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
    set innerHTML(h) { card._html = h; const m = /<input[^>]*value="([^"]*)"/.exec(h); if (m) input.value = m[1].replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') },
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
  const boot = async (apps = {}) => { W.boot({ app: id => apps[id] || null, deeplinked: () => false, busy: () => false, send: async () => ({ sessionId: 's1' }) }); await wait() }
  return { W, ctx, card, input, press, submit, boot, html: () => card._html }
}

const IMPORTER = { importer: { id: 'importer', url: '/importer/' } }
const withSkins = d => { d.ctx.WosSkin = { list: [{ id: 'nebula', name: 'Nebula', t: {} }], current: 'nebula', set() {} }; return d }

test('without the Importer app the Welcome is unchanged: Pick a skin, then Say hello', async () => {
  const d = withSkins(device(fakeBox({ name: 'Ana', authenticated: true })))
  await d.boot()
  assert.match(d.html(), /Pick a skin/)
  assert.equal((d.html().match(/<i class=/g) || []).length >= 3, true)
  d.press('next')
  assert.match(d.html(), /Say hello/)
  assert.doesNotMatch(d.html(), /Bring your AI/)
})

test('with the Importer app: Pick a skin, then the optional Bring your AI step, then Say hello', async () => {
  const d = withSkins(device(fakeBox({ name: 'Ana', authenticated: true })))
  await d.boot(IMPORTER)
  const dots = h => (h.match(/class="wl-dots"[^]*?<\/div>/)[0].match(/<i /g) || []).length
  assert.equal(dots(d.html()), 4) // AI, skin, bring, hello
  d.press('next')
  assert.match(d.html(), /<h2 tabindex="-1">Bring your AI<\/h2><p>Optional\./)
  assert.match(d.html(), /data-wl="bring">Bring my AI</)
  assert.match(d.html(), /data-wl="next">Not now</)
  d.press('next') // Not now
  assert.match(d.html(), /Say hello/)
})

test('Bring my AI embeds the Importer screen; Back peels it, then steps back to the skins', async () => {
  const d = withSkins(device(fakeBox({ name: 'Ana', authenticated: true })))
  await d.boot(IMPORTER)
  d.press('next'); d.press('bring')
  assert.match(d.html(), /<div class="wl-frame wl-embed"><iframe src="https:\/\/box\.test\/importer\/\?embedded=1" title="Importer"><\/iframe><\/div>/)
  assert.match(d.html(), /data-wl="next">Continue</)
  assert.equal(d.W.back(), 'welcome')
  assert.match(d.html(), /Bring my AI/) // frame closed, still on the step
  assert.equal(d.W.back(), 'welcome')
  assert.match(d.html(), /Pick a skin/)
  d.press('next'); d.press('bring'); d.press('back') // the on-screen ‹ does the same as Back
  assert.match(d.html(), /Bring my AI/)
  d.press('bring'); d.press('next') // Continue from inside the Importer
  assert.match(d.html(), /Say hello/)
  assert.equal(d.W.back(), 'welcome')
  assert.match(d.html(), /Bring my AI/) // Back from Say hello returns to Bring your AI
})

test('the step only opens the Importer: no import call from the Welcome', () => {
  const js = readFileSync(new URL('../web/core/welcome.js', import.meta.url), 'utf8')
  const step = js.slice(js.indexOf('function paintBring'), js.indexOf('function paintHello'))
  assert.doesNotMatch(step, /fetch\(|bring-data|api\//)
})
