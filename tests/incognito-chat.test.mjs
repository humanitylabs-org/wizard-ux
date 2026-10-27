import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('../web/core/incognito-chat.js', import.meta.url), 'utf8')
const chats = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8')
function rig(extra = {}) {
  const events = {}, calls = [], field = { value: '', selectionStart: 0, selectionEnd: 0 }, box = { scrollTop: 0, scrollHeight: 20 }
  const el = { innerHTML: '', querySelector(s) { if (s === '[data-incog-thread]') return this.innerHTML.includes('data-incog-thread') ? {} : null; if (s === '[data-incog-field]') return this.innerHTML.includes('data-incog-field') ? field : null; if (s === '.ch-msgs') return box; return null }, replaceChildren() { this.innerHTML = ''; field.value = '' } }
  const forbidden = new Proxy({}, { get() { throw new Error('Incognito touched persistent browser storage') } })
  const context = { window: { WizCore: {} }, document: { activeElement: null }, addEventListener: (name, fn) => events[name] = fn,
    setInterval, clearInterval, setTimeout, clearTimeout, AbortController, Promise, localStorage: forbidden, sessionStorage: forbidden, indexedDB: forbidden, caches: forbidden }
  vm.runInNewContext(source, context)
  let choice = true, component
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const fetchImpl = async (path, init) => {
    calls.push({ path, ...init })
    if (extra.fetchImpl) return extra.fetchImpl(path, init)
    if (path.endsWith('/incognito')) return { ok: true, json: async () => ({ session_id: 'incog_' + 'a'.repeat(32) }) }
    if (path.endsWith('/v1/runs')) return { ok: true, json: async () => ({ run_id: 'synthetic-run' }) }
    if (path.endsWith('/synthetic-run')) return { ok: true, json: async () => ({ status: 'completed', output: 'Synthetic answer' }) }
    return { ok: true, json: async () => ({ closed: true }) }
  }
  component = context.window.WizCore.incognitoChats({ win: () => ({ id: 'one', thread: '__new__' }), elOf: () => el, paint: () => component.render('one', el), grow() {}, toast() {}, kit: { esc, md: esc }, fetchImpl, confirm: () => choice })
  const agent = { id: 'private-synthetic', label: 'Synthetic private', privacy: 'private' }
  return { component, el, field, events, calls, agent, setConfirm: c => choice = c }
}
test('Incognito browser transcript and draft remain exclusively in memory; close really wipes them', async () => {
  const s = rig(); await s.component.start('one', s.agent)
  assert.match(s.el.innerHTML, /This chat is never saved/)
  assert.match(s.el.innerHTML, /Text only/)
  assert.match(s.el.innerHTML, /data-incog-off/)
  s.field.value = 'unique-synthetic-draft'; s.component.input('one', s.field)
  assert.equal(s.component.draft('one'), 'unique-synthetic-draft')
  await s.component.send('one', 'unique-synthetic-message')
  assert.match(s.el.innerHTML, /Synthetic answer/)
  assert.ok(!s.el.innerHTML.includes('data-incog-off'))
  assert.equal(s.component.draft('one'), '')
  s.setConfirm(false); assert.equal(s.component.close('one'), false); assert.equal(s.component.active('one'), true)
  s.setConfirm(true); assert.equal(s.component.close('one'), true); assert.equal(s.component.active('one'), false)
  assert.ok(!s.el.innerHTML.includes('unique-synthetic')); assert.equal(s.component.draft('one'), '')
  assert.equal(s.calls.at(-1).method, 'DELETE')
})
test('reload/BFCache lifecycle ends the target and cannot restore a transcript', async () => {
  const s = rig(); await s.component.start('one', s.agent)
  await s.component.send('one', 'synthetic-pagehide-canary')
  s.events.pagehide(); s.events.pageshow({ persisted: true })
  assert.equal(s.component.active('one'), false); assert.ok(!s.el.innerHTML.includes('synthetic-pagehide-canary'))
  assert.ok(s.calls.some(c => c.method === 'DELETE' && c.keepalive))
})
test('start-close race destroys late target instead of resurrecting it', async () => {
  let resolve
  const s = rig({ fetchImpl: async (path, init) => path.endsWith('/incognito') ? await new Promise(r => resolve = r) : ({ ok: true, json: async () => ({ closed: true }) }) })
  const start = s.component.start('one', s.agent)
  s.component.close('one', true)
  resolve({ ok: true, json: async () => ({ session_id: 'incog_' + 'b'.repeat(32) }) }); await start
  assert.equal(s.component.active('one'), false); assert.equal(s.calls.at(-1).method, 'DELETE')
})
test('offline sends are never retried or copied into a durable queue', async () => {
  let count = 0
  const s = rig({ fetchImpl: async path => {
    if (path.endsWith('/incognito')) return { ok: true, json: async () => ({ session_id: 'incog_' + 'c'.repeat(32) }) }
    if (path.endsWith('/v1/runs')) { count++; throw new Error('offline') }
    return { ok: true, json: async () => ({}) }
  } })
  await s.component.start('one', s.agent); await s.component.send('one', 'synthetic-offline')
  assert.equal(count, 1); assert.match(s.el.innerHTML, /will not be retried or saved/)
  s.component.close('one', true)
})
test('leaving for another view confirms once and destroys only temporary chats', async () => {
  const s = rig(); await s.component.start('one', s.agent)
  assert.equal(s.component.beforeNavigate(['one']), true)
  s.setConfirm(false); assert.equal(s.component.beforeNavigate([]), false); assert.equal(s.component.active('one'), true)
  s.setConfirm(true); assert.equal(s.component.beforeNavigate([]), true); assert.equal(s.component.active('one'), false)
})
test('every persistent Chats adapter has an Incognito early return; both shells load the same core', () => {
  for (const method of ['saveDraft', 'addFiles', 'toggleVoice', 'refreshCompose', 'loadThread', 'takeComposer', 'sendChat', 'peekComposer', 'setDraft']) {
    const start = chats.indexOf('function ' + method + '('); assert.ok(start >= 0, method)
    assert.match(chats.slice(start, start + 350), /INC\?\.active/, method)
  }
  assert.match(chats, /const incognitoAction = isNew &&/); assert.match(chats, /w.thread !== '__new__'/)
  assert.match(chats, /beforeLeave: id => !INC\?\.active/)
  for (const file of ['index.html', 'desktop.html']) assert.match(readFileSync(new URL('../web/' + file, import.meta.url), 'utf8'), /core\/incognito-chat.js/)
  for (const file of ['app.js', 'desktop/desktop.js']) assert.match(readFileSync(new URL('../web/' + file, import.meta.url), 'utf8'), /CHATS.beforeLeave\(id\)/)
})
