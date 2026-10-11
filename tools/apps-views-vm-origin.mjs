// Lifecycle test origin INSIDE the throwaway Lima VM 'wos-apps' on Thales (never Telos).
// Serves the feature/apps-views web tree at /wizard-os-home/, the read-only routes from
// wizard-agent-service feature/apps-views-routes, and passes /api/* (reads AND lifecycle writes)
// to this VM's own Runtipi with a CLI token minted from the VM's JWT_SECRET.
// Hermes routes (/wizard/hermes/*) are refused: there is no agent here and nothing may reach Archimedes.
// Usage: node vm-origin.mjs <port> <webDir> <routesModule>
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

const PORT = +(process.argv[2] || 9600)
const WEB = path.resolve(process.argv[3] || './web')
const ROUTES = path.resolve(process.argv[4] || './wizard-apps-views.mjs')
const HOME = os.homedir()
const { createAppsViewsRoutes } = await import(ROUTES)
const appsViews = createAppsViewsRoutes({ appsJsonPath: path.join(HOME, '.wizard-os/apps.json') })

const env = Object.fromEntries(fs.readFileSync(path.join(HOME, 'runtipi/.env'), 'utf8').split('\n')
  .filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')] }))
const RUNTIPI = `http://${env.INTERNAL_IP || '127.0.0.1'}:${env.NGINX_PORT || 80}`
const b64 = (b) => Buffer.from(b).toString('base64url')
function token() {
  const now = Math.floor(Date.now() / 1000)
  const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const p = b64(JSON.stringify({ sub: 'cli', iat: now, nbf: now, exp: now + 600 }))
  return `${h}.${p}.${crypto.createHmac('sha256', env.JWT_SECRET).update(`${h}.${p}`).digest('base64url')}`
}
const TYPES = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' }
const log = []

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x')
  if (u.pathname === '/__vm/log') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(log)) }
  if (await appsViews(req, res, u)) return
  if (u.pathname.startsWith('/api/')) {
    const chunks = []; for await (const c of req) chunks.push(c)
    const body = chunks.length ? Buffer.concat(chunks) : undefined
    if (req.method !== 'GET') log.push({ at: Date.now(), method: req.method, path: u.pathname })
    try {
      const r = await fetch(RUNTIPI + u.pathname + u.search, { method: req.method, body, headers: { Authorization: `Bearer ${token()}`, ...(body ? { 'content-type': req.headers['content-type'] || 'application/json' } : {}) } })
      const out = Buffer.from(await r.arrayBuffer())
      res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' })
      return res.end(out)
    } catch (e) { res.writeHead(502); return res.end(JSON.stringify({ error: String(e) })) }
  }
  if (u.pathname.startsWith('/wizard/')) {
    if (u.pathname === '/wizard/v1/apps') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"schema":1,"apps":[]}') }
    res.writeHead(req.method === 'GET' ? 404 : 403, { 'content-type': 'application/json' }); return res.end('{"error":"not in the lifecycle VM"}')
  }
  let rel = u.pathname.startsWith('/wizard-os-home/') ? u.pathname.slice(16) : null
  if (rel == null) { res.writeHead(302, { location: '/wizard-os-home/' }); return res.end() }
  rel = decodeURIComponent(rel) || 'index.html'
  if (rel.includes('..')) { res.writeHead(404); return res.end() }
  const f = path.join(WEB, rel)
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end() }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' })
  fs.createReadStream(f).pipe(res)
}).listen(PORT, '127.0.0.1', () => console.log(`vm-origin :${PORT} → ${WEB}, Runtipi ${RUNTIPI}`))
