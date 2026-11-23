import { modelContext, runWithChatsModel } from './fixtures/chats-list-model.mjs';
import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { withParts } from './fixtures/chats-parts.mjs'; // chats.js parts moved out verbatim (issue 1665)
import { withLiveParts } from './fixtures/live-parts.mjs'; // live.js parts moved out verbatim (issue 1665)
import { withShellParts } from './fixtures/shell-parts.mjs';
import { block, runRecording } from './fixtures/source-slice.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { cascade } from './fixtures/mini-css.mjs';
const source = withShellParts(readFileSync(new URL('../web/core/incognito-chat.js', import.meta.url), 'utf8'))
const chats = withParts(withShellParts(readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8'))) + withShellParts(readFileSync(new URL('../web/core/chats-outbox.js', import.meta.url), 'utf8'))
function rig(extra = {}) {
  const events = {}, calls = [], field = { value: '', selectionStart: 0, selectionEnd: 0 }, box = { scrollTop: 0, scrollHeight: 20 }
  const el = { innerHTML: '', querySelector(s) { if (s === '[data-incog-thread]') return this.innerHTML.includes('data-incog-thread') ? {} : null; if (s === '[data-incog-field]') return this.innerHTML.includes('data-incog-field') ? field : null; if (s === '.ch-msgs') return box; return null }, replaceChildren() { this.innerHTML = ''; field.value = '' } }
  const forbidden = new Proxy({}, { get() { throw new Error('Incognito touched persistent browser storage') } });
  const local = { getItem: key => { assert.equal(key, 'wos.incognito.opt-in'); return extra.optIn === false ? null : 'true'; } };
  const context = { window: { WizCore: {} }, document: { activeElement: null }, addEventListener: (name, fn) => events[name] = fn,
    setInterval, clearInterval, setTimeout, clearTimeout, AbortController, Promise, localStorage: local, sessionStorage: forbidden, indexedDB: forbidden, caches: forbidden }
  const streams = []
  context.window.WizLive = { openRunStream(sid, agent, run, notify, target) {
    const stream = { sid, agent, run, target, notify, closed: false, close() { this.closed = true } }; streams.push(stream)
    if (!extra.manualStream) notify({ terminal: true, status: 'completed', text: 'Synthetic answer', steps: [] })
    return stream
  } }
  runWithChatsModel(source, context)
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
  const agent = { id: 'private-synthetic', label: 'Synthetic private', privacy: 'private', incognito_available: true }
  return { component, el, field, events, calls, agent, streams, setConfirm: c => choice = c }
}
test('Incognito stays off by default and requires strict server capability before allocating a session', async () => {
  const off = rig({ optIn: false }); await off.component.start('one', off.agent);
  assert.equal(off.component.active('one'), false); assert.equal(off.calls.length, 0);
  for (const capability of [undefined, false, 'true', 1]) {
    const s = rig(); await s.component.start('one', { ...s.agent, incognito_available: capability });
    assert.equal(s.component.active('one'), false); assert.equal(s.calls.length, 0);
  }
});
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
  // the real new-chat action (chats-threadpaint.js incognitoAction), drawn: Settings' switch markup, off
  const paint = readFileSync(new URL('../web/core/chats-threadpaint.js', import.meta.url), 'utf8')
  const line = paint.split('\n').find(l => l.includes('const incognitoAction ='))
  const action = (isNew, on) => vm.runInNewContext(`${line}\nincognitoAction`, { isNew, INC: {}, TAG: 'hermes', agentRec: id => ({ id }), window: { WizCore: { incognitoOptIn: { enabled: () => on } } } })
  const doc = createDocument(); doc.body.innerHTML = action(true, true)
  const toggle = doc.body.querySelector('[data-incog-start]')
  assert.equal(toggle.tagName, 'BUTTON'); assert.equal(toggle.getAttribute('role'), 'switch'); assert.equal(toggle.getAttribute('aria-checked'), 'false')
  assert.ok(toggle.classList.contains('pbtn') && toggle.classList.contains('ch-incog-toggle'))
  assert.ok(toggle.querySelector('span.sw[aria-hidden="true"] > i'), 'the skinned Settings switch')
  assert.equal(doc.body.querySelector('input'), null, 'no browser checkbox')
  assert.equal(action(false, true), '', 'only on a new chat'); assert.equal(action(true, false), '', 'only once opted in')
  const bridge = withShellParts(readFileSync(new URL('../web/core/chats-view.css', import.meta.url), 'utf8'))
  assert.match(cascade(toggle, bridge)['--wz-text']?.value || '', /^var\(--ink/, 'the toggle gets the skin tokens from the bridge')
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
test('Incognito blocks microphone admission before snapshots, custody or recorder access', async () => {
  // each shell's real voice entry, with an Incognito chat in front: refused before anything is touched
  const phone = withShellParts(readFileSync(new URL('../web/app.js', import.meta.url), 'utf8'))
  const desktop = withShellParts(readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8'))
  const run = async (src, marker, args, extra = {}) => {
    const V = { state: 'idle' }, VOICE = { state: 'idle' }, name = /function (\w+)/.exec(marker)[1]
    const ctx = runRecording(`${block(src, marker)}\nthis.f = ${name};`, { V, VOICE, window: {}, document: { activeElement: null }, performance: { now: () => 1 }, MOD: '⌥', CHATS: { incognitoActive: () => true }, ...extra })
    const out = await ctx.f(...args)
    return { out, V, touched: ctx.calls.map(c => c[0]).filter(n => n !== 'toast' && n !== 'focusedWin' && n !== 'focused') }
  }
  const p = await run(phone, 'async function startVoice', ['dictation'])
  assert.equal(p.out, 'busy'); assert.equal(p.V.onAt, undefined, 'phone: before the take starts'); assert.deepEqual(p.touched, [])
  for (const [m, args] of [['async function talk(', []], ['async function dictate(', []], ['async function recordReply(', ['w1', 't1']]]) {
    const d = await run(desktop, m, args, { dictationFinishing: false, vMode: 'talk', vReply: null })
    assert.equal(d.out, 'busy', m); assert.deepEqual(d.touched, [], `${m}: nothing else touched`)
  }
  // the capture-busy hooks each shell hands Chats
  const busy = (src, key, scope) => vm.runInNewContext(`({ ${src.slice(src.indexOf(key), src.indexOf('\n', src.indexOf(key))).trim().replace(/,$/, '')} }).captureBusy()`, { window: {}, ...scope })
  assert.equal(busy(phone, 'captureBusy:', { V: { state: 'listen' } }), true); assert.equal(busy(phone, 'captureBusy:', { V: { state: 'idle' } }), false)
  assert.equal(busy(desktop, 'captureBusy:', { VOICE: { state: 'listen' }, dictationFinishing: false }), true); assert.equal(busy(desktop, 'captureBusy:', { VOICE: { state: 'idle' }, dictationFinishing: false }), false)
  const chats = withParts(withShellParts(readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8'))) + withShellParts(readFileSync(new URL('../web/core/chats-outbox.js', import.meta.url), 'utf8'))
  assert.match(chats, /if \(H.captureBusy\?\.\(\)\)/)
})

test('every persistent Chats adapter has an Incognito early return; both shells load the same core', async () => {
  // each real adapter, called on an Incognito window: it hands off to Incognito (or stops) and touches nothing durable
  for (const method of ['saveDraft', 'addFiles', 'toggleVoice', 'refreshCompose', 'loadThread', 'takeComposer', 'sendChat', 'peekComposer', 'setDraft']) {
    const marker = chats.includes('  async function ' + method + '(') ? '  async function ' + method + '(' : '  function ' + method + '('
    const ctx = runRecording(`${block(chats, marker)}\nthis.f = ${method};`, { INC: { active: () => true, send: () => 'inc', input() {}, draft: () => '' }, W: { w1: { id: 'w1', thread: '__new__' } }, window: {}, Promise, Object, String, Array })
    let out; try { out = await ctx.f('w1', 'words', 'typing', null, {}) } catch (e) { out = 'threw: ' + e.message }
    const durable = ctx.calls.map(c => c[0]).filter(n => /^(KIT|OUTBOX|LIVE|localStorage|sessionStorage|H\.|renderChats|ch$)/.test(n))
    assert.deepEqual(durable, [], `${method}: ${JSON.stringify(ctx.calls.slice(0, 4))} (${out})`)
  }
  // leaving a window holding an Incognito chat asks first (beforeLeave)
  const bl = chats.slice(chats.indexOf('beforeLeave: (id, checkOnly = false) =>'), chats.indexOf(', incognitoActive:', chats.indexOf('beforeLeave: (id, checkOnly = false) =>')))
  const asked = [], leave = vm.runInNewContext(`({ ${bl} })`, { INC: { active: id => id === 'w1', close: (id, force, checkOnly) => (asked.push([id, force, checkOnly]), false) } })
  assert.equal(leave.beforeLeave('w2'), true, 'no Incognito chat: leave freely')
  assert.equal(leave.beforeLeave('w1', true), false, 'an Incognito chat asks first'); assert.deepEqual(asked, [['w1', false, true]])
  for (const file of ['index.html', 'desktop.html']) {
    const h = withShellParts(readFileSync(new URL('../web/' + file, import.meta.url), 'utf8')), d = createDocument()
    d.documentElement.innerHTML = h.slice(h.indexOf('<head'), h.lastIndexOf('</html>'))
    assert.ok(d.querySelectorAll('script[src]').some(x => x.getAttribute('src') === 'core/incognito-chat.js'), file)
  }
  for (const file of ['app.js', 'desktop/desktop.js']) assert.match(withShellParts(readFileSync(new URL('../web/' + file, import.meta.url), 'utf8')), /CHATS.beforeLeave\(id(?:, checkOnly)?\)/)
})
test('preflight of a desktop close never destroys an earlier accepted chat', async () => {
  const s = rig(); await s.component.start('one', s.agent); await s.component.start('two', s.agent);
  const before = s.calls.length;
  assert.equal(s.component.close('one',false,true),true);
  s.setConfirm(false); assert.equal(s.component.close('two',false,true),false);
  assert.equal(s.component.active('one'),true);assert.equal(s.component.active('two'),true);
  assert.equal(s.calls.length - before, 0, 'preflight must issue no request of any method');
  assert.equal(s.calls.filter(c=>c.method==='DELETE').length,0);
  s.component.endAll();
  assert.equal(s.calls.length - before, 2, 'destructive negative control must hit the real recorder');
  assert.equal(s.calls.filter(c=>c.method==='DELETE').length,2);
});
test('Settings registration follows dependency and scrub checks before active index mutation', () => {
  // the page loads Settings before Incognito registers with it
  for (const f of ['index.html', 'desktop.html']) {
    const h = withShellParts(readFileSync(new URL('../web/' + f, import.meta.url), 'utf8')), d = createDocument()
    d.documentElement.innerHTML = h.slice(h.indexOf('<head'), h.lastIndexOf('</html>'))
    const src = d.querySelectorAll('script[src]').map(x => x.getAttribute('src'))
    assert.ok(src.indexOf('core/settings.js') >= 0 && src.indexOf('core/settings.js') < src.indexOf('core/incognito-chat.js'), f)
  }
  // the phone's desk switch asks Chats first and keeps its place when refused
  const phone = withShellParts(readFileSync(new URL('../web/app.js', import.meta.url), 'utf8'))
  const i = phone.indexOf('if (n !== DS.at && !CHATS.beforeNavigate(desks[n]?.wins || [])) return;')
  const line = phone.slice(phone.lastIndexOf('\n', i) + 1, phone.indexOf('\n', i)).trim()
  for (const ok of [false, true]) {
    const DS = { at: 0 }, asked = []
    vm.runInNewContext(`(n => { ${line} DS.moved = n; })(2)`, { DS, desks: [{ wins: [] }, {}, { wins: ['x'] }], CHATS: { beforeNavigate: w => (asked.push([...w]), ok) } })
    assert.deepEqual(asked, [['x']]); assert.equal(DS.moved, ok ? 2 : undefined, `allowed=${ok}`)
  }
})
test('terminal reply uses the final run output, not a partial stream', async () => {
  const s = rig({ manualStream: true, fetchImpl: async path => path.endsWith('/incognito') ? { ok: true, json: async () => ({ session_id: 'incog_' + 'c'.repeat(32) }) } : { ok: true, json: async () => ({ run_id: 'synthetic-run' }) } })
  await s.component.start('one', s.agent); await s.component.send('one', 'synthetic-final-canary')
  s.streams.at(-1).notify({ terminal: true, status: 'completed', text: 'Partial', result: { output: 'Partial and the rest' }, steps: [] })
  assert.match(s.el.innerHTML, /Partial and the rest/)
  s.component.close('one', true)
})
test('Incognito stream target accepts every registry agent id, including a leading digit', () => {
  // the real openRunStream: a malformed target is refused before any stream opens
  const live = withLiveParts(withShellParts(readFileSync(new URL('../web/live.js', import.meta.url), 'utf8')))
  const fn = live.slice(live.indexOf('  L.openRunStream = function'), live.indexOf('\n', live.indexOf('if (target && !/^\\/wizard', live.indexOf('  L.openRunStream = function'))))
  const open = base => vm.runInNewContext(`const L = {}; ${fn} return 'opened'; }; L.openRunStream('s1', '', 'r1', () => {}, { base: BASE, read: () => null })`, { BASE: base })
  assert.equal(open('/wizard/v1/agents/1-private/incognito/incog_' + 'a'.repeat(32)), 'opened')
  assert.equal(open('/wizard/v1/agents/hermes/incognito/incog_' + 'a'.repeat(32)), 'opened')
  assert.equal(open('/wizard/v1/agents/-x/incognito/incog_' + 'a'.repeat(32)), null)
  assert.equal(open('/wizard/v1/agents/hermes/incognito/incog_short'), null)
  assert.equal(open('/wizard/v1/sessions/x'), null)
})
test('desktop HUD title-bar close asks before ending an Incognito chat', () => {
  const desktop = withShellParts(readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8'))
  const close = (leave, hudId) => {
    const c = runRecording(`this.click = ${block(desktop, "  stage.addEventListener('click', e => {", desktop.indexOf('/* ---------------- window interactions')).replace(/^\s*stage\.addEventListener\('click', /, '')};`,
      { W: { c1: { id: 'c1', app: 'chats' } }, hud: hudId ? { id: hudId } : null, canLeave: () => leave, CHATS: { isHosted: () => false } })
    c.click({ target: { closest: q => (q === '.win' ? { dataset: { win: 'c1' } } : q === '[data-wact]' ? { dataset: { wact: 'close' } } : null) }, stopPropagation() {} })
    return c.calls.map(x => x[0]).filter(n => /^(hudClose|desktopHost\.close)$/.test(n))
  }
  assert.deepEqual(close(false, 'c1'), [], 'the floating chat asks first and stays')
  assert.deepEqual(close(true, 'c1'), ['hudClose'])
  // closeWin asks once (internal closes skip it)
  const cw = (leave, internal) => { const c = runRecording(`${block(desktop, 'function closeWin(id, internal = false) {')}\nthis.f = closeWin;`, { canLeave: () => leave, hud: { id: 'c1' }, globalThis: {} }); c.f('c1', internal); return c.calls.map(x => x[0]) }
  assert.deepEqual(cw(false, false), []); assert.deepEqual(cw(false, true), ['hudClose']); assert.deepEqual(cw(true, false), ['hudClose'])
})
