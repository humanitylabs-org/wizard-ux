#!/usr/bin/env node
// Owner's-agent customization client for Wizard OS: look (the worn own skin's skin.css / skin.js) and
// Chats layout (box-wide ui-preferences). Every change is journalled with its exact "before" state, verified by
// reading it back, and undone in one step. It never edits shell source, skin packages, settings.json or
// ui-preferences.json, and it never approves a script (only the owner's tap in Settings › Look can).
import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, lstatSync, openSync, closeSync, realpathSync, statSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { pathToFileURL } from 'node:url'

export const MAX_CSS = 64 * 1024
// Look/layout preferences this skill may change. Spaces and pins belong to the wizard-spaces skill.
export const PREFS = {
  compact: v => typeof v === 'boolean',
  chatLayout: v => v === 'day' || v === 'status',
  readyOrder: v => ['newest', 'oldest', 'priority', 'subject'].includes(v),
  archiveAfterDays: v => Number.isInteger(v) && [0, 1, 3, 7, 14, 30].includes(v),
}
const BLOCK = /^[a-z][a-z0-9-]{0,39}$/
// One colour value: hex, a CSS colour function or a named colour. No url(), braces, semicolons or comments.
const COLOUR = /^(?:#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\([0-9a-z.,%\s/+-]{1,80}\)|[a-z]{3,30})$/i
const marks = name => [`/* wizard-customize:${name} */`, `/* /wizard-customize:${name} */`]

export function accentCss(colour) {
  const c = String(colour || '').trim()
  if (!COLOUR.test(c) || /url|var|expression/i.test(c)) throw new Error(`Not a CSS colour: ${colour}`)
  // --violet is every skin's accent token; --violet-2 its lighter partner (Wizard roles --wz-accent read it).
  return `:root {\n  --violet: ${c} !important;\n  --violet-2: color-mix(in oklab, ${c} 78%, white) !important;\n}`
}

/** Replace (or append) one named, marked block; null removes it. Text outside the markers is never touched. */
export function setBlock(css, name, body) {
  if (!BLOCK.test(name)) throw new Error(`Block names are lowercase words with dashes: ${name}`)
  const [open, close] = marks(name)
  const text = String(css || '')
  if (body != null && (String(body).includes('/* wizard-customize:') || String(body).includes('/* /wizard-customize:'))) throw new Error('A block cannot contain block markers')
  const start = text.indexOf(open), end = start < 0 ? -1 : text.indexOf(close, start)
  if (start >= 0 && end < 0) throw new Error(`Block ${name} has no end marker; fix the file by hand first`)
  const block = body == null ? '' : `${open}\n${String(body).trim()}\n${close}`
  if (start >= 0) {
    let before = text.slice(0, start), after = text.slice(end + close.length)
    if (!block) { before = before.replace(/\n+$/, '\n'); after = after.replace(/^\n+/, '') }
    return (before + block + after).replace(/^\n+/, '')
  }
  if (!block) return text
  return (text.replace(/\s+$/, '') + (text.trim() ? '\n\n' : '') + block + '\n')
}
export const blocks = css => [...String(css || '').matchAll(/\/\* wizard-customize:([a-z][a-z0-9-]{0,39}) \*\//g)].map(m => m[1])

function parseArgs(argv) {
  const out = { _: [], prefs: {}, blocks: [], removes: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => { const v = argv[++i]; if (v === undefined) throw new Error(`${a} needs a value`); return v }
    if (a === '--label') out.label = next()
    else if (a === '--accent') out.accent = next()
    else if (a === '--css-block') { const v = next(), k = v.indexOf('='); if (k < 1) throw new Error('--css-block NAME=FILE (FILE - reads stdin)'); out.blocks.push([v.slice(0, k), v.slice(k + 1)]) }
    else if (a === '--remove-block') out.removes.push(next())
    else if (a === '--script') out.script = next()
    else if (a === '--remove-script') out.script = null
    else if (a === '--pref') {
      const v = next(), k = v.indexOf('='); if (k < 1) throw new Error('--pref KEY=JSON, for example compact=true')
      const key = v.slice(0, k); let value
      try { value = JSON.parse(v.slice(k + 1)) } catch { value = v.slice(k + 1) }
      if (!Object.hasOwn(PREFS, key)) throw new Error(`Unsupported preference ${key}; supported: ${Object.keys(PREFS).join(', ')}`)
      if (!PREFS[key](value)) throw new Error(`Invalid value for ${key}: ${JSON.stringify(value)}`)
      out.prefs[key] = value
    } else if (a === '--force') out.force = true
    else if (a === '--json') out.json = true
    else out._.push(a)
  }
  return out
}

export function client({ base = process.env.WIZARD_URL || 'http://127.0.0.1:8923', filesRoot = process.env.WIZARD_FILES_ROOT || '', home = process.env.WIZARD_CUSTOMIZE_HOME || join(process.env.HERMES_HOME || join(homedir(), '.hermes'), 'wizard-customize'), request = fetch, readStdin = () => readFileSync(0, 'utf8'), readText = f => readFileSync(f, 'utf8') } = {}) {
  const origin = new URL(base)
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password) throw new Error('WIZARD_URL must be an owner-authorized http(s) origin without credentials')
  const url = p => new URL(p, origin)
  async function call(path, init = {}) {
    const r = await request(url(path), { ...init, headers: { 'X-Requested-With': 'wizard', ...(init.headers || {}) }, signal: AbortSignal.timeout(15000) })
    return r
  }
  async function json(path, init) {
    const r = await call(path, init)
    if (!r.ok) { let code = ''; try { code = (await r.json()).error || '' } catch { /* not JSON */ } const e = new Error(`${init?.method || 'GET'} ${path}: HTTP ${r.status}${code ? ` (${code})` : ''}`); e.status = r.status; e.code = code; throw e }
    return r.json()
  }

  // ---- look: the worn own skin's folder in Files, as the Agent Service resolves it ----
  async function skinInfo() {
    const info = await json('/wizard/v1/my-skin?format=json', { cache: 'no-store' })
    if (info.unavailable) throw new Error('This Wizard has no Files root, so it has no own skin to customize')
    if (!info.path) throw new Error('No own skin is worn. Ask the owner to wear their own skin (Settings › Look › My skin), then retry')
    return info
  }
  function confinedFile(rel) {
    if (!filesRoot) return null
    const root = realpathSync(resolve(filesRoot)), file = resolve(root, rel)
    if (!file.startsWith(root + sep) || !/^Skins\/[^/]+\/skin\.(?:css|js)$|^Skins\/My skin\.css$/.test(rel)) throw new Error(`Refusing a path outside Skins/: ${rel}`)
    let parent = dirname(file)
    while (true) { try { const real = realpathSync(parent); if (real !== root && !real.startsWith(root + sep)) throw new Error('Skins folder escapes the Files root'); break } catch (e) { if (e.code !== 'ENOENT') throw e; parent = dirname(parent) } }
    try { if (!lstatSync(file).isFile()) throw new Error(`${rel} is not a regular file`) } catch (e) { if (e.code !== 'ENOENT') throw e }
    return file
  }
  const readFile = file => { try { return readFileSync(file, 'utf8') } catch (e) { if (e.code === 'ENOENT') return null; throw e } }
  function atomicWrite(file, text) {
    mkdirSync(dirname(file), { recursive: true })
    const tmp = join(dirname(file), `.wizard-customize-${randomBytes(6).toString('hex')}.tmp`)
    try { writeFileSync(tmp, text, { mode: 0o664 }); renameSync(tmp, file) } catch (e) { rmSync(tmp, { force: true }); throw e }
  }
  async function readCss(info) {
    const file = confinedFile(info.path)
    if (file) return readFile(file) ?? ''
    const r = await call('/wizard/v1/my-skin', { cache: 'no-store' })
    if (!r.ok) throw new Error(`GET /wizard/v1/my-skin: HTTP ${r.status}`)
    return r.text()
  }
  async function writeCss(info, css) {
    if (Buffer.byteLength(css, 'utf8') > MAX_CSS) throw new Error('skin.css would exceed 64 KiB')
    const r = await call('/wizard/v1/my-skin', { method: 'PUT', headers: { 'Content-Type': 'text/css; charset=utf-8' }, body: css })
    if (r.ok) return 'api'
    const file = confinedFile(info.path)
    if ([401, 403, 404, 405].includes(r.status) && file) { atomicWrite(file, css); return 'files' }
    throw new Error(`PUT /wizard/v1/my-skin: HTTP ${r.status}. This agent may not write the skin through the API: set WIZARD_FILES_ROOT to the owner's Files root, or edit ${info.path} with the Files app tools`)
  }
  const scriptPath = info => info.path.replace(/skin\.css$/, 'skin.js').replace(/^Skins\/My skin\.css$/, 'Skins/My skin/skin.js')
  function readScript(info) { const f = confinedFile(scriptPath(info)); return f ? readFile(f) : undefined }
  function writeScript(info, text) {
    const f = confinedFile(scriptPath(info))
    if (!f) throw new Error(`Writing skin.js needs WIZARD_FILES_ROOT (or the Files app tools on ${scriptPath(info)})`)
    if (text == null) rmSync(f, { force: true }); else { if (Buffer.byteLength(text) > MAX_CSS) throw new Error('skin.js would exceed 64 KiB'); atomicWrite(f, text) }
  }
  // The shell's view of the look: what /wizard/v1/my-skin serves after sanitising.
  async function served() { const r = await call('/wizard/v1/my-skin', { cache: 'no-store' }); return r.ok ? r.text() : '' }

  // ---- layout: box-wide ui-preferences (partial PUT merges; nothing else is touched) ----
  const prefsGet = () => json('/wizard/v1/ui-preferences', { cache: 'no-store' })
  const prefsPut = patch => json('/wizard/v1/ui-preferences', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
  const pick = (all, keys) => Object.fromEntries(keys.map(k => [k, all[k]]))

  // ---- journal ----
  const journal = join(home, 'history.json')
  const load = () => { try { const j = JSON.parse(readFileSync(journal, 'utf8')); return Array.isArray(j.entries) ? j : { entries: [] } } catch { return { entries: [] } } }
  const save = j => { mkdirSync(home, { recursive: true, mode: 0o700 }); const tmp = `${journal}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify({ version: 1, entries: j.entries.slice(-50) }, null, 2) + '\n', { mode: 0o600 }); renameSync(tmp, journal) }
  async function locked(fn) {
    mkdirSync(home, { recursive: true, mode: 0o700 })
    const lock = join(home, 'lock')
    try { if (Date.now() - statSync(lock).mtimeMs > 120000) rmSync(lock, { force: true }) } catch { /* no lock */ }
    let fd; try { fd = openSync(lock, 'wx') } catch { throw new Error('Another customization is in progress; retry in a moment') }
    try { return await fn() } finally { closeSync(fd); rmSync(lock, { force: true }) }
  }

  async function snapshot(info, keys) {
    const s = { path: info.path, css: await readCss(info) }
    if (keys.length) s.prefs = pick(await prefsGet(), keys)
    const js = readScript(info); if (js !== undefined) s.script = js
    return s
  }
  async function restore(info, snap, keys, touchScript) {
    if (snap.css !== undefined) await writeCss(info, snap.css)
    if (keys.length) await prefsPut(pick(snap.prefs, keys))
    if (touchScript) writeScript(info, snap.script ?? null)
  }
  function same(a, b, keys, touchScript) {
    return a.css === b.css && keys.every(k => JSON.stringify(a.prefs?.[k]) === JSON.stringify(b.prefs?.[k])) && (!touchScript || (a.script ?? null) === (b.script ?? null))
  }

  async function change(opts) {
    const keys = Object.keys(opts.prefs), touchScript = opts.script !== undefined
    if (!opts.accent && !opts.blocks.length && !opts.removes.length && !keys.length && !touchScript) throw new Error('Nothing to change: give --accent, --css-block, --remove-block, --pref or --script')
    return locked(async () => {
      const info = await skinInfo()
      const before = await snapshot(info, keys)
      let css = before.css
      if (opts.accent) css = setBlock(css, 'accent', accentCss(opts.accent))
      for (const [name, file] of opts.blocks) css = setBlock(css, name, file === '-' ? readStdin() : readText(file))
      for (const name of opts.removes) css = setBlock(css, name, null)
      const script = touchScript ? (opts.script === null ? null : readText(opts.script)) : undefined
      const j = load(), id = `c${Date.now().toString(36)}${randomBytes(2).toString('hex')}`
      const entry = { id, at: new Date().toISOString(), label: opts.label || describe(opts), path: info.path, keys, touchScript, before }
      // Journal the before-state first: an interrupted change can still be undone.
      j.entries.push(entry); save(j)
      let via
      try {
        if (css !== before.css) via = await writeCss(info, css)
        if (keys.length) await prefsPut(opts.prefs)
        if (touchScript) writeScript(info, script)
        const after = await snapshot(info, keys)
        const look = await served()
        const missing = blocks(css).filter(n => opts.accent && n === 'accent' || opts.blocks.some(b => b[0] === n)).filter(n => !squash(look).includes(squash(blockBody(css, n))))
        const prefsOk = keys.every(k => JSON.stringify(after.prefs[k]) === JSON.stringify(opts.prefs[k]))
        if (missing.length || !prefsOk) throw new Error(`Read-back failed (${missing.length ? `the shell is not served block ${missing.join(', ')}; it was probably removed by sanitising` : 'preferences did not save'})`)
        entry.after = after; entry.via = via || 'unchanged'; save(j)
        return { ok: true, id, label: entry.label, path: info.path, via: entry.via, preferences: after.prefs || {}, blocks: blocks(after.css), script: touchScript ? (script == null ? 'removed' : 'written, off until the owner taps Turn on in Settings › Look') : 'unchanged', undo: 'node scripts/wizard-customize.mjs undo' }
      } catch (e) {
        try { await restore(info, before, keys, touchScript) } catch (r) { e.message += `; rollback also failed: ${r.message}` }
        const k = load(); k.entries = k.entries.filter(x => x.id !== id); save(k)
        throw new Error(`${e.message}. Nothing was changed (rolled back).`)
      }
    })
  }
  async function undo(opts = {}) {
    return locked(async () => {
      const j = load(), entry = [...j.entries].reverse().find(e => !e.undoneAt && e.after)
      if (!entry) throw new Error('Nothing to undo')
      const info = await skinInfo()
      if (info.path !== entry.path && !opts.force) throw new Error(`The worn skin changed since "${entry.label}" (${entry.path} → ${info.path}); undo would edit the wrong skin. Ask the owner, or pass --force`)
      const now = await snapshot(info, entry.keys)
      if (!same(now, entry.after, entry.keys, entry.touchScript) && !opts.force) throw new Error(`"${entry.label}" was edited since (by the owner or another change). Show the owner the difference before undoing, or pass --force`)
      await restore({ ...info, path: entry.path }, entry.before, entry.keys, entry.touchScript)
      const back = await snapshot(info, entry.keys)
      if (!same(back, entry.before, entry.keys, entry.touchScript)) throw new Error('Undo did not read back as the previous state; check the skin file and preferences')
      entry.undoneAt = new Date().toISOString(); save(j)
      return { ok: true, undone: entry.id, label: entry.label, preferences: back.prefs || {}, blocks: blocks(back.css) }
    })
  }
  async function status() {
    const info = await skinInfo(), css = await readCss(info), prefs = await prefsGet()
    const last = [...load().entries].reverse().find(e => !e.undoneAt && e.after)
    return { skin: { path: info.path, empty: info.empty, script: info.script }, blocks: blocks(css), css, preferences: pick(prefs, Object.keys(PREFS).filter(k => k in prefs)), lastChange: last ? { id: last.id, at: last.at, label: last.label } : null }
  }
  const history = () => load().entries.map(e => ({ id: e.id, at: e.at, label: e.label, path: e.path, undone: !!e.undoneAt }))
  return { change, undo, status, history }
}
// The served CSS is sanitised (comments dropped, unsafe rules removed), so a block reached the shell only when
// its declarations come back verbatim, whitespace aside.
const squash = s => String(s || '').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, '')
export function blockBody(css, name) {
  const [open, close] = marks(name), text = String(css || ''), a = text.indexOf(open)
  return a < 0 ? '' : text.slice(a + open.length, text.indexOf(close, a))
}
const describe = o => [o.accent && `accent ${o.accent}`, ...o.blocks.map(b => `css ${b[0]}`), ...o.removes.map(n => `remove ${n}`), ...Object.entries(o.prefs).map(([k, v]) => `${k}=${JSON.stringify(v)}`), o.script !== undefined && (o.script === null ? 'remove skin.js' : 'skin.js')].filter(Boolean).join(', ')

const USAGE = `Usage: wizard-customize.mjs status | history | undo [--force]
       wizard-customize.mjs change [--label TEXT] [--accent COLOUR] [--css-block NAME=FILE|-]... [--remove-block NAME]...
                                   [--pref KEY=JSON]... [--script FILE | --remove-script]
Preferences: ${Object.keys(PREFS).join(', ')}`
export async function run(argv, env) {
  const o = parseArgs(argv), c = client(env), cmd = o._[0]
  if (cmd === 'status') return c.status()
  if (cmd === 'history') return c.history()
  if (cmd === 'undo') return c.undo(o)
  if (cmd === 'change') return c.change(o)
  throw new Error(USAGE)
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  run(process.argv.slice(2)).then(r => console.log(JSON.stringify(r, null, 2)), e => { console.error(e.message); process.exit(1) })
}
