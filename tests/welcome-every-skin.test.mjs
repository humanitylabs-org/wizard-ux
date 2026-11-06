// Welcome › Pick a skin offers every skin the shell ships (WosSkin.list, in its order) as one flat grid, not only the
// Wizard skin's five colours. Skins and tweaks are independent (Miguel, 30 Oct 2026): a card sets only that skin with
// the plain setter, never a family's tweaks/recommends, and opening the step never switches the skin by itself.
// Runs the real web/core/welcome.js against a fake Agent Service and a WosSkin built from the real web/core/skins.js ids,
// plus one skin that belongs to no family, so a future skin shows up with no edit to the Welcome.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8')
const welcome = read('web/core/welcome.js')
const wait = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 2)) }

// The shell's own skin ids, in list order (each SKINS entry starts `{ id: '<id>', ... name: ...`).
const skinsSrc = read('web/core/skins.js')
const SHIPPED = [...skinsSrc.slice(skinsSrc.indexOf('const SKINS = [')).matchAll(/^\s*\{ id: '([a-z0-9-]+)',[^\n]*name: '/gm)].map(m => m[1])

function fakeSkin() {
  const ids = [...SHIPPED, 'aurora'] // 'aurora': a skin of its own, listed in no family
  const calls = []
  const S = {
    list: ids.map(id => ({ id, name: id === 'aurora' ? 'Aurora' : id, bg: '#000', accent: '#fff', t: {} })),
    families: [
      { id: 'wizard', name: 'Wizard', tweaks: 'wizard', palettes: ['nebula', 'grove', 'tide', 'ember', 'signal'] },
      { id: 'mizel', name: 'Mizel', tweaks: 'miguel', recommends: { chats: 'mizel-chats' }, palettes: ['obsidian', 'obsidian-light', 'landscapes', 'landscapes-light'] },
      { id: 'aurora', name: 'Aurora', palettes: ['aurora'] },
    ],
    cur: 'nebula', chosen: null,
    get current() { return S.cur },
    familyOf: id => (S.families.find(f => f.palettes.includes(id)) || { id }).id,
    set(id) { calls.push(['set', id]); S.cur = id; return id },
    setFamily(fid) { calls.push(['setFamily', fid]); return S.cur },
  }
  return { S, calls }
}

function device(skin) {
  const handlers = {}, store = new Map()
  const card = { _html: '', classList: { toggle() {} }, set innerHTML(h) { card._html = h }, get innerHTML() { return card._html }, querySelector: s => (/h2/.test(s) ? { focus() {} } : null) }
  const overlay = { classList: { add() {}, remove() {}, toggle() {} }, set innerHTML(h) {}, addEventListener: (t, f) => { handlers[t] = f }, remove() {},
    querySelector: s => (s === '.wl-card' ? card : null), querySelectorAll: () => [] }
  const ok = body => ({ ok: true, status: 200, json: async () => body })
  const ctx = {
    console, URL, URLSearchParams, Promise, JSON, Date, Math, String, Object, Array, Error, Map, Set,
    fetch: async u => String(u).endsWith('/wizard/v1/setup') ? ok({ first_run: true })
      : String(u).endsWith('/model/options') ? ok({ providers: [{ slug: 'anthropic', authenticated: true }] }) : ok({}),
    CustomEvent: class {}, setTimeout: (f, ms) => setTimeout(f, Math.min(ms || 0, 5)), clearTimeout,
    AbortController, AbortSignal, requestAnimationFrame: f => setTimeout(f, 0), matchMedia: () => ({ matches: true }),
    localStorage: { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
    document: { createElement: () => overlay, body: { appendChild() {} }, documentElement: { classList: { add() {}, remove() {} } }, addEventListener() {}, hidden: false },
    location: { href: 'https://box.test/wizard-os-home/desktop.html', origin: 'https://box.test' }, navigator: { userAgent: 'test' },
    WosSkin: skin.S,
  }
  ctx.window = ctx
  vm.createContext(ctx)
  vm.runInContext(welcome, ctx)
  const press = (wl, id) => handlers.click({ target: { closest: s => (s === '[data-wl]' ? { dataset: { wl, id } } : null) } })
  const boot = async () => { ctx.WosWelcome.boot({ app: () => null, deeplinked: () => false, busy: () => false, send: async () => ({}) }); await wait() }
  return { ctx, press, boot, html: () => card._html }
}

test('the real skin list has every shipped palette (guards the regex above)', () => {
  for (const id of ['nebula', 'grove', 'tide', 'ember', 'signal', 'novairecito', 'sepia', 'obsidian', 'obsidian-light', 'landscapes', 'landscapes-light']) assert.ok(SHIPPED.includes(id), id)
})

test('Pick a skin: one flat grid of every skin in WosSkin.list order, including a skin in no family', async () => {
  const skin = fakeSkin(), d = device(skin)
  await d.boot()
  assert.match(d.html(), /<h2 tabindex="-1">Pick a skin<\/h2><p>You can change it any time in Settings\.<\/p>/)
  const shown = [...d.html().matchAll(/class="skp-card" data-wl="palette" data-id="([^"]+)"/g)].map(m => m[1])
  assert.deepEqual(shown, skin.S.list.map(k => k.id))
  assert.ok(shown.length >= 12 && shown.includes('landscapes-light') && shown.includes('aurora'))
  assert.equal((d.html().match(/role="group"/g) || []).length, 1, 'one grid, no grouping by family')
  assert.doesNotMatch(d.html(), /skp-fam|data-wl="family"|>Wizard<|>Mizel</)
  assert.match(d.html(), /data-id="nebula" aria-pressed="true"/)
})

test('Pick a skin: opening it never switches the skin; the fresh default stays Nebula', async () => {
  const skin = fakeSkin(), d = device(skin)
  skin.S.cur = 'nebula'
  await d.boot()
  assert.deepEqual(skin.calls, [])
  assert.equal(skin.S.current, 'nebula')
  const other = fakeSkin(), e = device(other)
  other.S.cur = 'sepia' // a box already on another skin keeps it
  await e.boot()
  assert.deepEqual(other.calls, [])
})

test('Pick a skin: a card sets only that skin (plain setter), never a family or its tweaks', async () => {
  const skin = fakeSkin(), d = device(skin)
  await d.boot()
  for (const id of ['obsidian', 'landscapes-light', 'aurora', 'nebula']) {
    d.press('palette', id)
    assert.deepEqual(skin.calls.at(-1), ['set', id])
    assert.match(d.html(), new RegExp(`data-id="${id}" aria-pressed="true"`))
  }
  assert.ok(skin.calls.every(([fn]) => fn === 'set'))
  assert.doesNotMatch(welcome, /setFamily|\.tweaks|recommends|WosTweaks/)
})
