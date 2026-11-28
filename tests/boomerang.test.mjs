import { modelContext, runWithChatsModel } from './fixtures/chats-list-model.mjs';
// Boomerang on the one Wizard scheduler (kind "return"). Picker design: Novaire, wizard-ux #255.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { withLiveParts } from './fixtures/live-parts.mjs'; // live.js parts moved out verbatim (issue 1665)
import { withParts } from './fixtures/chats-parts.mjs'; // chats.js parts moved out verbatim (issue 1665)
import { withShellParts } from './fixtures/shell-parts.mjs';
import { pageAssets } from './fixtures/w1-pages.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';

const read = p => withShellParts(readFileSync(new URL('../' + p, import.meta.url), 'utf8'))
const store = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) } }
function load(schedules = [], extra = {}) {
  const calls = []
  const sandbox = { Intl, Date, URL, crypto, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail } }, Event: class { constructor(t) { this.type = t } },
    localStorage: store(), location: { pathname: '/wizard-os-home/' }, setInterval: () => 1, setTimeout, clearTimeout, addEventListener() {}, dispatchEvent() { return true },
    document: { addEventListener() {}, hidden: false },
    fetch: async (url, init = {}) => { calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null }); return { ok: true, status: 200, json: async () => init.method === 'POST' ? { id: 'j1', kind: 'return', thread: 'wizard_t', when: { once: JSON.parse(init.body).when.once }, timezone: 'Asia/Bangkok', prompt: '', target: JSON.parse(init.body).target } : { schedules } } },
    ...extra }
  sandbox.window = sandbox
  runWithChatsModel(read('web/core/scheduled-reminders.js'), sandbox)
  return { B: sandbox.WosBoomerang, calls, sandbox }
}

test('phone and desktop load the shared Boomerang and pin assets once each', () => {
  for (const page of ['index.html', 'desktop.html']) {
    const { all } = pageAssets(page)
    for (const asset of ['core/scheduled-reminders.js', 'core/scheduled-reminders.css', 'core/chat-pins.js']) assert.equal(all.filter(a => a === asset).length, 1, `${page} ${asset}`)
  }
})

test('Boomerang reads and writes the one scheduler, never its own store or a run', async () => {
  const js = read('web/core/scheduled-reminders.js')
  // (the one scheduler's URL: the run below reads /wizard/v1/schedules)
  assert.doesNotMatch(js, /\/wizard\/v1\/boomerangs|\/v1\/runs['"`]|OUTBOX\.send/)
  const { calls } = load()
  await new Promise(r => setTimeout(r, 5))
  // Only Snooze's own return jobs (wizard-ux issue 2055): never the whole schedule list with its run history.
  assert.equal(calls[0].url, '/wizard/v1/schedules?kind=return')
})

test('a scheduler job maps to the picker shape; only the current time reads as returned', async () => {
  const { B } = load()
  const job = { id: 'a', kind: 'return', thread: 'wizard_t', when: { once: '2026-10-23T05:00:00.000Z' }, timezone: 'Asia/Bangkok', prompt: 'Check quote', target: { message: 1792700000000, excerpt: 'The quote' }, name: 'Boomerang · Quote' }
  assert.deepEqual({ ...B._fromJob(job) }, { id: 'a', session_id: 'wizard_t', created_at: null, due_at: '2026-10-23T05:00:00.000Z', timezone: 'Asia/Bangkok', note: 'Check quote', anchor_at: 1792700000000, target_kind: 'message', context: 'The quote', status: 'scheduled', returned_at: null })
  const back = B._fromJob({ ...job, lastRun: { outcome: 'returned', scheduledFor: '2026-10-23T05:00:00.000Z', finishedAt: '2026-10-23T05:00:01Z' } })
  assert.equal(back.status, 'due')
  // "Again" moved the time: the earlier return is history, not a fresh one.
  assert.equal(B._fromJob({ ...job, when: { once: '2026-10-24T05:00:00.000Z' }, lastRun: { outcome: 'returned', scheduledFor: '2026-10-23T05:00:00.000Z' } }).status, 'scheduled')
  assert.equal(B._fromJob({ ...job, target: { message: null, excerpt: '' } }).target_kind, 'thread')
})

test('returned Boomerangs come back to the thread list and are announced once per device', async () => {
  const restored = []
  const sessions = { wizard_t: { id: 'wizard_t', title: 'Quote', deferred: true } }
  const job = { id: 'a', kind: 'return', thread: 'wizard_t', when: { once: '2026-10-23T05:00:00.000Z' }, timezone: 'UTC', prompt: '', target: { message: null, excerpt: '' }, lastRun: { outcome: 'returned', scheduledFor: '2026-10-23T05:00:00.000Z' } }
  const { B, sandbox } = load([job], { WizLive: { session: id => sessions[id], restore: id => { restored.push(id); return true } } })
  await B.refresh()
  assert.deepEqual(restored, ['wizard_t'])
  assert.equal(B.dueFor('wizard_t').length, 1)
  assert.match(sandbox.localStorage.getItem('wos.boomerang.seen.v1'), /"a"/)
  await B.refresh()
  assert.deepEqual(restored, ['wizard_t'], 'seen once, never restored again')
})

test('an existing Snooze takes its thread out of the list once, unless James wrote or restored since', async () => {
  const deferred = []
  const set = '2026-10-23T14:40:00.000Z'
  const sessions = {
    quiet: { id: 'quiet', lastUserAt: '2026-10-23T08:00:00.000Z' },
    wrote: { id: 'wrote', lastUserAt: '2026-10-23T15:00:00.000Z' },
    restored: { id: 'restored', lastUserAt: '2026-10-23T08:00:00.000Z', restoredAt: '2026-10-23T15:00:00.000Z' },
    already: { id: 'already', deferred: true },
  }
  const job = id => ({ id: 'j_' + id, kind: 'return', thread: id, createdAt: set, when: { once: '2099-01-01T00:00:00.000Z' }, timezone: 'UTC', prompt: '', target: { message: null, excerpt: '' } })
  const { B } = load(['quiet', 'wrote', 'restored', 'already'].map(job).concat({ ...job('quiet'), id: 'legacy', createdAt: undefined }), { WizLive: { ok: true, session: id => sessions[id], busy: () => false, defer: async id => { deferred.push(id); return true } } })
  await B.refresh(); await B.refresh()
  assert.deepEqual(deferred, ['quiet'])
})

test('the phone reply watcher is armed with the wzb_ watch id', async () => {
  const watched = []
  const job = { id: 'b', kind: 'return', thread: 'wizard_t', when: { once: '2099-01-01T00:00:00.000Z' }, timezone: 'UTC', prompt: '', target: { message: null, excerpt: '' } }
  const { B } = load([job], { WizardOSDevice: { watchRun: (...a) => watched.push(a) }, WizLive: { session: () => ({ title: 'Quote', status: 'completed' }) } })
  await B.refresh()
  assert.deepEqual(watched, [['wizard_t', 'wzb_b', '◷ Snooze · Quote']])
})

test('wizard-os#648: the phone watcher gets the return time, and a hidden phone page stops reading', async () => {
  const watched = [], timers = []
  const job = { id: 'b', kind: 'return', thread: 'wizard_t', when: { once: '2099-01-01T00:00:00.000Z' }, timezone: 'UTC', prompt: '', target: { message: null, excerpt: '' } }
  const dev = { watchRun: (...a) => watched.push(['old', ...a]), watchRunAt: (...a) => watched.push(['at', ...a]) }
  let clock = Date.now()
  class FakeDate extends Date { static now() { return clock } }
  const { B, calls, sandbox } = load([job], { Date: FakeDate, WizardOSDevice: dev, setInterval: fn => { timers.push(fn); return 1 }, WizLive: { session: () => ({ title: 'Quote', status: 'completed' }) } })
  await B.refresh()
  assert.deepEqual(watched, [['at', 'wizard_t', 'wzb_b', '◷ Snooze · Quote', String(Date.parse('2099-01-01T00:00:00.000Z'))]])
  const reads = () => calls.filter(c => c.method === 'GET').length
  const before = reads()
  sandbox.document.hidden = true
  for (const fn of timers) fn()
  await new Promise(r => setTimeout(r, 0))
  assert.equal(reads(), before, 'a hidden phone page reads no schedules every 15 s')
  clock += 10 * 60000 + 1
  for (const fn of timers) fn()
  await new Promise(r => setTimeout(r, 0))
  assert.equal(reads(), before + 1, 'every 10 minutes it still looks, so a Snooze set on another device is armed')
  sandbox.document.hidden = false
  for (const fn of timers) fn()
  await new Promise(r => setTimeout(r, 0))
  assert.ok(reads() > before, 'a visible page still reads them')
})

test('wizard-os#648: a hidden desktop tab keeps reading (it notifies on its own)', async () => {
  const timers = []
  const { calls, sandbox } = load([], { setInterval: fn => { timers.push(fn); return 1 } })
  await new Promise(r => setTimeout(r, 0))
  const before = calls.length
  sandbox.document.hidden = true
  for (const fn of timers) fn()
  await new Promise(r => setTimeout(r, 0))
  assert.ok(calls.length > before)
})

test('wall-clock time in the chosen zone becomes the right instant', () => {
  const { B } = load()
  assert.equal(B._wallToUtc('2026-10-22', '09:00', 'Asia/Bangkok'), '2026-10-22T02:00:00.000Z')
  assert.equal(B._wallToUtc('2026-11-01', '09:00', 'America/New_York'), '2026-11-01T14:00:00.000Z')
  assert.equal(B._addWallMonths('2028-01-31', 1), '2028-02-29')
})

test('Back closes the picker before anything under it, on phone and desktop', () => {
  const phone = read('web/app.js'), desktop = read('web/desktop/desktop.js')
  for (const src of [phone, desktop]) assert.match(src, /WizEscapeBack\.installOwners\(/)
  // The one owner catalog both shells install (core/escape-back.js) peels the picker first.
  let open = true, backs = 0
  const W = { WosBoomerang: { isOpen: () => open, back: () => { backs++; open = false; return 'boomerang' } } }
  vm.runInNewContext(read('web/core/escape-back.js'), { window: W, document: { addEventListener() {} }, addEventListener() {}, setTimeout, clearTimeout, queueMicrotask, MutationObserver: class { observe() {} disconnect() {} } })
  const stack = W.WizEscapeBack.create(); W.WizEscapeBack.installOwners(stack, { chats: () => ({}), links: () => null })
  let roots = 0
  assert.equal(stack.run({ fallback: () => (roots++, 'root') }), 'boomerang'); assert.equal(backs, 1); assert.equal(roots, 0)
  assert.equal(stack.run({ fallback: () => (roots++, 'root') }), 'root')
})

test('one Snooze action replaces Defer and Boomerang, with no second Snooze under each reply', async () => {
  const js = withParts(read('web/core/chats.js'))
  // The real thread actions (core/chats-threadacts.js): one Snooze beside Archive on a settled thread.
  const window = { WizCore: {} }
  vm.runInNewContext(read('web/core/chats-threadacts.js'), { window })
  const T = window.WizCore.chatsParts.threadacts({ isWorking: () => false, LIVE: { busy: () => false, workGroups: () => ({ archive: [] }) }, WORKING_ST: new Set(['running']) })
  const turns = [{ a: 'answer', media: [] }]
  assert.deepEqual([...T.threadActions({ id: 's', status: 'completed' }, turns)], ['snooze', 'done'])
  assert.deepEqual([...T.threadActions({ id: 's', status: 'completed', followUp: { active: true, count: 1 } }, turns)], ['snooze', 'stop_watch', 'done'])
  for (const a of Object.values(T.ACT)) assert.doesNotMatch(a.label, /^(Defer|Boomerang)$|🪃/)
  assert.doesNotMatch(js, /label: '(Defer|Boomerang)'|🪃/)
  assert.doesNotMatch(js, /data-mboom/)
  // Someday in the picker is the existing Defer (WizLive.defer), with no schedule.
  const deferred = []
  const { B, calls } = load([], { WizLive: { defer: async id => (deferred.push(id), true), session: () => ({}) } })
  await new Promise(r => setTimeout(r, 5)); const before = calls.length
  await B.someday({ sessionId: 's1' })
  assert.deepEqual(deferred, ['s1']); assert.equal(calls.filter(c => c.method === 'POST').length, 0); assert.equal(calls.length, before)
})

test('Snooze confirms the actual Bangkok time, independent of device timezone', () => {
  const { B } = load()
  assert.equal(B._returnLabel({ due_at: '2026-10-24T02:00:00.000Z', timezone: 'Asia/Bangkok' }), 'Back 24 Oct at 9:00')
  assert.equal(B._returnLabel({ due_at: '2026-10-23T23:37:00.000Z', timezone: 'Asia/Bangkok' }), 'Back 24 Oct at 6:37')
  assert.deepEqual({ ...B._preset('tomorrow-am', 'Asia/Bangkok', Date.parse('2026-10-23T20:00:00Z')) }, { date: '2026-10-25', time: '09:00' })
  assert.deepEqual({ ...B._preset('today', 'Asia/Bangkok', Date.parse('2026-10-23T15:00:00Z')) }, { date: '2026-10-23', time: '23:59' })
  for (const [k, date] of [['2d', '2026-10-26'], ['3d', '2026-10-27'], ['5d', '2026-10-29'], ['1w', '2026-10-31']]) assert.deepEqual({ ...B._preset(k, 'Asia/Bangkok', Date.parse('2026-10-23T20:00:00Z')) }, { date, time: '09:00' }, k)
})

test('Snoozed preserves the deferred API and search aliases; Someday creates no schedule', async () => {
  const picker = read('web/core/scheduled-reminders.js')
  // Chats' own status filter and sections (core/chats-setup.js run): Snoozed answers the old words, and has its own
  // section before Archive in both list layouts
  const setup = chatsPart('setup', { deferredOf: s => !!s.deferred })
  assert.equal(setup.STATUS.deferred.label, 'Snoozed')
  for (const w of ['snooze', 'defer', 'deferred', 'later', 'boomerang']) assert.ok(setup.STATUS.deferred.syn.includes(w), w)
  for (const list of [setup.SECTIONS_STATUS, setup.SECTIONS_DAY]) {
    const keys = list.map(([k]) => k), at = keys.indexOf('deferred')
    assert.deepEqual([...list[at]], ['deferred', 'Snoozed'], 'Snoozed threads wait in their own section')
    assert.equal(keys[at + 1], 'archive')
  }
  // Someday's toast (core/chats-events.js run on wos:snooze-someday)
  const toasts = [], ev = chatsPart('events', { toast: (...a) => toasts.push(a[1]), H: {}, holdList() {}, leaveFinishedThread() {} }, true)
  ev.part.bindLate({ snoozeLast: () => false, renderChats() {} })
  ev.fire('wos:snooze-someday', { session: 's1' })
  assert.deepEqual(toasts, ['Snoozed · out of your list'])
  // snoozed threads leave Ready: ready-working-helper.test.mjs runs live's groups with a snoozed row (deferred: 1)
  // the real picker on a small DOM: its words, and a timed Snooze posts a "Snooze · " job and takes the thread out
  const sheet = await pickerSheet()
  for (const label of ['Later today', 'Tomorrow', 'In 2 days', 'In 3 days', 'In 5 days', 'Next week', 'Someday', 'Other date…', 'When should this come back?']) assert.ok(sheet.text.includes(label), label)
  assert.doesNotMatch(sheet.text, /🪃|🪄/)
  assert.equal(sheet.post.body.name, 'Snooze · Quote', 'new jobs use the current UI name')
  assert.deepEqual(sheet.deferred, ['s1'], 'a timed Snooze also takes the thread out of the list')
  assert.doesNotMatch(picker, /🪃|🪄/)
  const { B } = load()
  for (const name of ['Boomerang · Quote', 'Snooze · Quote']) assert.equal(B._fromJob({ id: 'a', kind: 'return', name, when: { once: '2099-01-01T00:00:00Z' } }).context, 'Quote')
  assert.doesNotMatch(picker.slice(picker.indexOf('async function someday'), picker.indexOf('function open(opts')), /method:'POST'/)
})

// One core/chats-<part>.js factory run with recorders for the Chats names it reads (fire: its window listeners).
function chatsPart(name, deps, listen = false) {
  const on = {}, window = { WizCore: {}, WosChat: {}, addEventListener: (t, fn) => { on[t] = fn } }
  vm.runInNewContext(readFileSync(new URL(`../web/core/chats-${name}.js`, import.meta.url), 'utf8'), { window, localStorage: store() })
  const any = new Proxy(deps, { get: (o, k) => (k in o ? o[k] : () => null), has: () => true })
  const part = window.WizCore.chatsParts[name](any)
  return listen ? { part, fire: (t, detail) => on[t]({ type: t, detail }) } : part
}

// core/scheduled-reminders.js's open() drawn on mini-dom (form fields by name, as a browser form has them), then a
// timed Snooze submitted.
async function pickerSheet() {
  const doc = createDocument(), proto = Object.getPrototypeOf(doc.createElement('form')), deferred = []
  const byName = (form, n) => { // (a select's value is its selected option, as in a browser)
    const el = form.querySelector(`[name="${n}"]`)
    if (el?.localName === 'select' && el._value == null) el.value = (el.querySelector('option[selected]') || el.querySelector('option'))?.getAttribute('value') ?? ''
    return el
  }
  const field = n => function () { return this.localName === 'form' ? byName(this, n) : undefined }
  const shim = { elements: { get() { return new Proxy({}, { get: (o, n) => byName(this, String(n)) }) } } }
  for (const n of ['date', 'time', 'timezone', 'note']) shim[n] = { get: field(n) }
  const had = Object.fromEntries(Object.keys(shim).map(k => [k, Object.getOwnPropertyDescriptor(proto, k)]))
  for (const [k, d] of Object.entries(shim)) Object.defineProperty(proto, k, { ...d, configurable: true })
  try {
    const { B, calls } = load([], { document: doc, WizLive: { defer: async id => (deferred.push(id), true), session: id => ({ id }) } })
    B.open({ sessionId: 's1', title: 'Quote' })
    const form = doc.querySelector('form'), text = doc.querySelector('.boom-sheet').textContent
    form.querySelector('[name="timezone"]').value = 'Asia/Bangkok'
    form.querySelector('[name="date"]').value = '2099-01-02'; form.querySelector('[name="time"]').value = '09:00'
    await form.onsubmit({ preventDefault() {} })
    await new Promise(r => setTimeout(r, 5))
    return { text, post: calls.find(c => c.method === 'POST'), deferred }
  } finally { for (const [k, d] of Object.entries(had)) { if (d) Object.defineProperty(proto, k, d); else delete proto[k] } }
}

test('wizard-ux#2055: one Snooze read per resume, and an unchanged list costs a 304, not the list again', async () => {
  const handlers = {}, sent = []
  const job = { id: 'r1', kind: 'return', thread: 'wizard_t', when: { once: '2030-01-01T09:00:00.000Z' }, timezone: 'UTC', prompt: '', target: { message: null, excerpt: '' }, name: 'Snooze · Synthetic' }
  const { B, sandbox } = load([], {
    addEventListener: (k, f) => { (handlers[k] ||= []).push(f) },
    fetch: async (url, init = {}) => {
      sent.push({ url, tag: init.headers?.['If-None-Match'] || '' })
      if (init.headers?.['If-None-Match'] === '"t1"') return { ok: false, status: 304, headers: { get: () => '"t1"' }, json: async () => { throw Error('no body') } }
      return { ok: true, status: 200, headers: { get: k => k.toLowerCase() === 'etag' ? '"t1"' : null }, json: async () => ({ schedules: [job] }) }
    } })
  sandbox.document.addEventListener = (k, f) => { (handlers[k] ||= []).push(f) }
  await new Promise(r => setTimeout(r, 5))
  assert.equal(sent.length, 1)
  assert.equal(B.forSession('wizard_t').length, 1)
  // Back to the front 5 s later: visibilitychange and focus arrive together.
  const realNow = Date.now
  sandbox.Date = class extends Date { static now() { return realNow() + 5000 } }
  for (const f of handlers.focus || []) f()
  for (const f of handlers.focus || []) f()
  await new Promise(r => setTimeout(r, 5))
  assert.equal(sent.length, 2, 'focus twice in one moment: one read')
  assert.equal(sent[1].url, '/wizard/v1/schedules?kind=return')
  assert.equal(sent[1].tag, '"t1"', 'asks with the last ETag')
  assert.equal(B.forSession('wizard_t').length, 1, 'a 304 keeps the Snoozes it has')
})
