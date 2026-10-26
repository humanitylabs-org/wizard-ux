import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setBlock, blocks, accentCss, run } from '../skills/wizard-customize/scripts/wizard-customize.mjs'
import { startBox } from './fixtures/customize-box.mjs'

const OWNER = '/* my own notes */\n.mine { color: red }\n'

test('blocks: replace, append and remove only the marked block; owner text stays byte-identical', () => {
  let css = setBlock(OWNER, 'accent', accentCss('orange'))
  assert.ok(css.startsWith(OWNER.trimEnd()))
  assert.deepEqual(blocks(css), ['accent'])
  css = setBlock(css, 'accent', accentCss('#2f80ed'))
  assert.equal(css.split('/* wizard-customize:accent */').length, 2)
  assert.match(css, /--violet: #2f80ed !important/)
  assert.equal(setBlock(css, 'accent', null), OWNER)
  assert.throws(() => accentCss('red; } body { display:none'), /Not a CSS colour/)
  assert.throws(() => accentCss('url(https://x)'), /Not a CSS colour/)
  assert.throws(() => setBlock('/* wizard-customize:x */ open', 'x', 'a{}'), /no end marker/)
})

async function box(t, opts) {
  const root = mkdtempSync(join(tmpdir(), 'wcz-')), home = join(root, '.agent')
  mkdirSync(join(root, 'Skins/My skin'), { recursive: true })
  writeFileSync(join(root, 'Skins/My skin/skin.css'), OWNER)
  const b = await startBox({ root, ...opts })
  t.after(async () => { await b.close(); b.wipe() })
  const env = { base: b.url, filesRoot: root, home }
  return { b, root, cli: (...a) => run(a, env) }
}

test('one request = one change; undo restores the exact previous look and preferences', async t => {
  const { b, cli } = await box(t)
  const r = await cli('change', '--label', 'orange accent, compact chats', '--accent', 'orange', '--pref', 'compact=true')
  assert.equal(r.ok, true); assert.equal(r.via, 'api'); assert.deepEqual(r.blocks, ['accent'])
  assert.match(b.served(), /--violet: orange !important/)
  assert.equal(b.state.prefs.compact, true)
  assert.equal((await cli('status')).lastChange.label, 'orange accent, compact chats')
  const u = await cli('undo')
  assert.equal(u.ok, true)
  assert.equal(b.css(), OWNER)
  assert.equal(b.state.prefs.compact, false)
  await assert.rejects(cli('undo'), /Nothing to undo/)
})

test('undo refuses to clobber a later owner edit unless forced', async t => {
  const { b, root, cli } = await box(t)
  await cli('change', '--accent', 'orange')
  writeFileSync(join(root, 'Skins/My skin/skin.css'), b.css() + '\n.later { color: blue }\n')
  await assert.rejects(cli('undo'), /edited since/)
  assert.match(b.css(), /\.later/)
  await cli('undo', '--force')
  assert.equal(b.css(), OWNER)
})

test('agent without owner API writes falls back to the Files root; never a write outside Skins/', async t => {
  const { b, cli } = await box(t, { ownerWrites: false })
  const r = await cli('change', '--accent', '#ff8800')
  assert.equal(r.via, 'files')
  assert.match(b.served(), /#ff8800/)
})

test('no worn own skin: stops with a clear message and changes nothing', async t => {
  const { b, cli } = await box(t, { skin: '' })
  await assert.rejects(cli('change', '--accent', 'orange', '--pref', 'compact=true'), /No own skin is worn/)
  assert.equal(b.state.prefs.compact, false)
  assert.deepEqual(b.state.writes, [])
})

test('a failed read-back rolls everything back', async t => {
  const { b, root, cli } = await box(t)
  const bad = join(root, 'bad.css'); writeFileSync(bad, '.x { color: red }')
  const orig = b.state.prefs.compact
  // A sanitiser that drops the block: the served CSS never contains it, so read-back must fail and roll back.
  const env = { base: b.url, filesRoot: root, home: join(root, '.agent'), request: async (u, init) => {
    const url = new URL(u)
    if (url.pathname === '/wizard/v1/my-skin' && !url.search && (!init?.method || init.method === 'GET')) return new Response('', { status: 200 })
    return fetch(u, init)
  } }
  await assert.rejects(run(['change', '--css-block', `palette=${bad}`, '--pref', 'compact=true'], env), /rolled back/)
  assert.equal(b.css(), OWNER)
  assert.equal(b.state.prefs.compact, orig)
})

test('skin.js is written off; script removal is undoable; unsupported preferences are refused', async t => {
  const { root, cli } = await box(t)
  const f = join(root, 'new.js'); writeFileSync(f, 'export default api => {}')
  const r = await cli('change', '--script', f)
  assert.match(r.script, /off until the owner taps Turn on/)
  assert.equal(readFileSync(join(root, 'Skins/My skin/skin.js'), 'utf8'), 'export default api => {}')
  await cli('undo')
  assert.throws(() => readFileSync(join(root, 'Skins/My skin/skin.js')), /ENOENT/)
  await assert.rejects(cli('change', '--pref', 'spaces=[]'), /Unsupported preference/)
  await assert.rejects(cli('change', '--pref', 'chatLayout="grid"'), /Invalid value/)
})
