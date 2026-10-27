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
  const streams = []
  context.window.WizLive = { openRunStream(sid, agent, run, notify, target) {
    const stream = { sid, agent, run, target, notify, closed: false, close() { this.closed = true } }; streams.push(stream)
    if (!extra.manualStream) notify({ terminal: true, status: 'completed', text: 'Synthetic answer', steps: [] })
    return stream
  } }
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
  return { component, el, field, events, calls, agent, streams, setConfirm: c => choice = c }
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
test('James: Incognito reuses the skinned Settings switch, not a browser checkbox', async () => {
  assert.match(chats, /class="pbtn ch-incog-toggle" role="switch" aria-checked="false"/)
  assert.match(chats, /<span class="sw" aria-hidden="true"><i><\/i><\/span>/)
  assert.ok(!chats.includes('type="checkbox" role="switch" data-incog-start'))
  const s = rig(); await s.component.start('one', s.agent)
  assert.match(s.el.innerHTML, /role="switch" aria-checked="true"/)
  assert.match(s.el.innerHTML, /class="sw on" aria-hidden="true"/)
  assert.ok(!s.el.innerHTML.includes('type="checkbox"'))
  s.component.close('one', true)
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
test('failed sends retry only on owner action with the same RAM text and no durable queue', async () => {
  let count = 0
  const s = rig({ fetchImpl: async path => {
    if (path.endsWith('/incognito')) return { ok: true, json: async () => ({ session_id: 'incog_' + 'c'.repeat(32) }) }
    if (path.endsWith('/v1/runs')) { count++; throw new Error('offline') }
    return { ok: true, json: async () => ({}) }
  } })
  await s.component.start('one', s.agent); await s.component.send('one', 'synthetic-offline')
  assert.equal(count, 1); assert.match(s.el.innerHTML, /Retry sends the same message again here/)
  await s.component.send('one', 'synthetic-offline', true)
  assert.equal(count, 2); assert.equal(s.calls.filter(c => c.path.endsWith('/v1/runs')).length, 2)
  assert.equal((s.el.innerHTML.match(/synthetic-offline/g) || []).length, 1)
  s.component.close('one', true)
})
test('leaving for another view confirms once and destroys only temporary chats', async () => {
  const s = rig(); await s.component.start('one', s.agent)
  assert.equal(s.component.beforeNavigate(['one']), true)
  s.setConfirm(false); assert.equal(s.component.beforeNavigate([]), false); assert.equal(s.component.active('one'), true)
  s.setConfirm(true); assert.equal(s.component.beforeNavigate([]), true); assert.equal(s.component.active('one'), false)
})
test('Incognito blocks microphone admission before snapshots, custody or recorder access', () => {
  const phone = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8')
  const desktop = readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8')
  const mobileAdmission = phone.slice(phone.indexOf('async function startVoice'), phone.indexOf('async function startVoice') + 600)
  assert.ok(mobileAdmission.indexOf('CHATS.incognitoActive') < mobileAdmission.indexOf('V.onAt'))
  for (const name of ['talk(', 'dictate(', 'recordReply(']) {
    const start = desktop.indexOf('async function ' + name)
    assert.match(desktop.slice(start, start + 400), /CHATS.incognitoActive/)
  }
  assert.match(phone, /captureBusy:.*V.state !== 'idle'/)
  assert.match(desktop, /captureBusy:.*VOICE.state !== 'idle'/)
  const chats = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8')
  assert.match(chats, /if \(H.captureBusy\?\.\(\)\)/)
})

test('every persistent Chats adapter has an Incognito early return; both shells load the same core', () => {
  for (const method of ['saveDraft', 'addFiles', 'toggleVoice', 'refreshCompose', 'loadThread', 'takeComposer', 'sendChat', 'peekComposer', 'setDraft']) {
    const start = chats.indexOf('function ' + method + '('); assert.ok(start >= 0, method)
    assert.match(chats.slice(start, start + 350), /INC\?\.active/, method)
  }
  assert.match(chats, /const incognitoAction = isNew &&/); assert.ok(chats.includes('${chip}${incognitoAction}')); assert.match(chats, /w.thread !== '__new__'/)
  assert.match(chats, /beforeLeave: id => !INC\?\.active/)
  for (const file of ['index.html', 'desktop.html']) assert.match(readFileSync(new URL('../web/' + file, import.meta.url), 'utf8'), /core\/incognito-chat.js/)
  for (const file of ['app.js', 'desktop/desktop.js']) assert.match(readFileSync(new URL('../web/' + file, import.meta.url), 'utf8'), /CHATS.beforeLeave\(id\)/)
})
