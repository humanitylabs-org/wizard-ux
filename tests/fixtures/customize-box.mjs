// Isolated stand-in for the Agent Service routes the wizard-customize skill uses (QA and unit tests only):
// GET/PUT /wizard/v1/my-skin (+ ?format=json, /script) backed by a temp Files root, and GET/PUT
// /wizard/v1/ui-preferences (partial merge). Same shapes as the Agent Service; comments are dropped from
// the served CSS like its sanitiser does. No owner data, no network beyond 127.0.0.1.
import { createServer } from 'node:http'
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { createHash } from 'node:crypto'

export async function startBox({ root, skin = 'My skin', prefs = {}, ownerWrites = true } = {}) {
  const state = { skin, prefs: { archiveAfterDays: 7, compact: false, chatLayout: 'day', readyOrder: 'newest', subjectOrder: [], pinnedChats: [], spaces: [], ...prefs }, ownerWrites, writes: [] }
  const rel = () => state.skin ? `Skins/${state.skin}/skin.css` : ''
  const css = () => { try { return readFileSync(join(root, rel()), 'utf8') } catch { return '' } }
  const js = () => { try { return readFileSync(join(root, rel().replace(/css$/, 'js'))) } catch { return null } }
  const served = () => css().replace(/\/\*[\s\S]*?\*\//g, ' ')
  const info = () => { const s = js(); return { path: rel(), exists: existsSync(join(root, rel() || '-')), bytes: Buffer.byteLength(css()), max_bytes: 65536, empty: !served().trim(), too_large: false, script: { exists: !!s, sha256: s ? createHash('sha256').update(s).digest('hex') : null, bytes: s ? s.length : 0 } } }
  const body = req => new Promise(r => { const b = []; req.on('data', c => b.push(c)); req.on('end', () => r(Buffer.concat(b).toString('utf8'))) })
  const json = (res, status, v) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)) }
  const server = createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x')
    if (req.method !== 'GET' && req.method !== 'HEAD') state.writes.push(`${req.method} ${u.pathname}`)
    if (u.pathname === '/wizard/v1/my-skin/script') { const s = js(); if (!s) return json(res, 404, { error: 'not_found' }); res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'X-Wizard-Sha256': createHash('sha256').update(s).digest('hex') }); return res.end(s) }
    if (u.pathname === '/wizard/v1/my-skin') {
      if (req.method === 'GET') { if (u.searchParams.get('format') === 'json') return json(res, 200, info()); res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' }); return res.end(served()) }
      if (req.method === 'PUT') {
        if (!state.ownerWrites) return json(res, 403, { error: 'owner_only' })
        if (!rel()) return json(res, 409, { error: 'no_active_skin' })
        const file = join(root, rel()); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, await body(req)); return json(res, 200, info())
      }
      return json(res, 405, { error: 'method_not_allowed' })
    }
    if (u.pathname === '/wizard/v1/ui-preferences') {
      if (req.method === 'PUT') { const patch = JSON.parse(await body(req) || '{}'); Object.assign(state.prefs, patch); return json(res, 200, state.prefs) }
      return json(res, 200, state.prefs)
    }
    json(res, 404, { error: 'not_in_fixture' })
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${server.address().port}`
  return { url, state, css, served, js, root, close: () => new Promise(r => server.close(r)), wipe: () => rmSync(root, { recursive: true, force: true }) }
}
