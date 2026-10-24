// Boomerang on the one Wizard scheduler (kind "return"). Picker design: Novaire, wizard-ux #255.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8')
const store = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) } }
function load(schedules = [], extra = {}) {
  const calls = []
  const sandbox = { Intl, Date, URL, crypto, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o?.detail } }, Event: class { constructor(t) { this.type = t } },
    localStorage: store(), location: { pathname: '/wizard-os-home/' }, setInterval: () => 1, setTimeout, clearTimeout, addEventListener() {}, dispatchEvent() { return true },
    document: { addEventListener() {}, hidden: false },
    fetch: async (url, init = {}) => { calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null }); return { ok: true, status: 200, json: async () => init.method === 'POST' ? { id: 'j1', kind: 'return', thread: 'wizard_t', when: { once: JSON.parse(init.body).when.once }, timezone: 'Asia/Bangkok', prompt: '', target: JSON.parse(init.body).target } : { schedules } } },
    ...extra }
  sandbox.window = sandbox
  vm.runInNewContext(read('web/core/scheduled-reminders.js'), sandbox)
  return { B: sandbox.WosBoomerang, calls, sandbox }
}

test('phone and desktop load the shared Boomerang and pin assets once each', () => {
  for (const page of ['web/index.html', 'web/desktop.html']) {
    const html = read(page)
    for (const asset of ['core/scheduled-reminders.js', 'core/scheduled-reminders.css', 'core/chat-pins.js']) assert.equal(html.split(asset).length - 1, 1, `${page} ${asset}`)
  }
})

test('Boomerang reads and writes the one scheduler, never its own store or a run', async () => {
  const js = read('web/core/scheduled-reminders.js')
  assert.match(js, /const API='\/wizard\/v1\/schedules'/)
  assert.doesNotMatch(js, /\/wizard\/v1\/boomerangs|\/v1\/runs['"`]|OUTBOX\.send/)
  const { calls } = load()
  await new Promise(r => setTimeout(r, 5))
  assert.equal(calls[0].url, '/wizard/v1/schedules')
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

test('wall-clock time in the chosen zone becomes the right instant', () => {
  const { B } = load()
  assert.equal(B._wallToUtc('2026-10-22', '09:00', 'Asia/Bangkok'), '2026-10-22T02:00:00.000Z')
  assert.equal(B._wallToUtc('2026-11-01', '09:00', 'America/New_York'), '2026-11-01T14:00:00.000Z')
  assert.equal(B._addWallMonths('2028-01-31', 1), '2028-02-29')
})

test('Back closes the picker before anything under it, on phone and desktop', () => {
  const phone = read('web/app.js'), desktop = read('web/desktop/desktop.js')
  const order = (src, first, then) => { const a = src.indexOf(first); assert.ok(a > 0, first); assert.ok(src.indexOf(then, a) > a, then) }
  order(phone, "if (window.WosBoomerang?.back()) return 'boomerang'", 'const ov = CHATS.closeOverlay()')
  order(desktop, "if (window.WosBoomerang?.back()) return 'boomerang'", 'if (!pal.hidden)')
})

test('one Snooze action replaces Defer and Boomerang, with no second Snooze under each reply', () => {
  const js = read('web/core/chats.js')
  assert.match(js, /return \['snooze', 'done'\]/)
  assert.doesNotMatch(js, /label: '(Defer|Boomerang)'|🪃/)
  assert.match(read('web/core/scheduled-reminders.js'), /live\(\)\.defer\(opts.sessionId\)/)
  assert.doesNotMatch(js, /data-mboom/)
})


test('Snooze confirms the actual Bangkok time, independent of device timezone', () => {
  const { B } = load()
  assert.equal(B._returnLabel({ due_at: '2026-10-24T02:00:00.000Z', timezone: 'Asia/Bangkok' }), 'Back 24 Oct at 9:00')
  assert.equal(B._returnLabel({ due_at: '2026-10-23T23:37:00.000Z', timezone: 'Asia/Bangkok' }), 'Back 24 Oct at 6:37')
  assert.deepEqual({ ...B._preset('tomorrow-am', 'Asia/Bangkok', Date.parse('2026-10-23T20:00:00Z')) }, { date: '2026-10-25', time: '09:00' })
  assert.deepEqual({ ...B._preset('today', 'Asia/Bangkok', Date.parse('2026-10-23T15:00:00Z')) }, { date: '2026-10-23', time: '23:59' })
  for (const [k, date] of [['2d', '2026-10-26'], ['3d', '2026-10-27'], ['5d', '2026-10-29'], ['1w', '2026-10-31']]) assert.deepEqual({ ...B._preset(k, 'Asia/Bangkok', Date.parse('2026-10-23T20:00:00Z')) }, { date, time: '09:00' }, k)
})

test('Snoozed preserves the deferred API and search aliases; Someday creates no schedule', () => {
  const chats = read('web/core/chats.js'), picker = read('web/core/scheduled-reminders.js')
  assert.match(chats, /label: 'Snoozed', syn: \['snooze', 'defer', 'deferred', 'later', 'boomerang'/)
  assert.match(chats, /Snoozed · out of your list/)
  assert.match(chats, /\['deferred', 'Snoozed'\], \['archive', 'Archive'\]/, 'Snoozed threads wait in their own section')
  assert.match(picker, /void away\(opts\.sessionId\)/, 'a timed Snooze also takes the thread out of the list')
  const live = read('web/live.js')
  assert.match(live, /else if \(isDeferred\(s\)\) g\.deferred\.push\(s\);/, 'snoozed threads leave Ready')
  for (const label of ['Later today', 'Tomorrow', 'In 2 days', 'In 3 days', 'In 5 days', 'Next week', 'Someday', 'Other date…', 'When should this come back?']) assert.ok(picker.includes(label), label)
  assert.doesNotMatch(picker, /🪃|🪄/)
  assert.match(picker, /name:\('Snooze · '/, 'new jobs use the current UI name')
  const { B } = load()
  for (const name of ['Boomerang · Quote', 'Snooze · Quote']) assert.equal(B._fromJob({ id: 'a', kind: 'return', name, when: { once: '2099-01-01T00:00:00Z' } }).context, 'Quote')
  assert.doesNotMatch(picker.slice(picker.indexOf('async function someday'), picker.indexOf('function open(opts')), /method:'POST'/)
})
