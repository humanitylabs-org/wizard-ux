// Staging front for the Apps screens preview (apps-views.staging.wizard001.com).
// Sits in front of the ordinary wizard-stage qa-origin and adds, READ-ONLY:
//   /wizard/v1/wizard-apps, /wizard/v1/index/*   from wizard-agent-service feature/apps-views-routes (the real module)
//   /api/apps/installed, /api/system/load,
//   /api/marketplace/apps/<urn>/image            from Telos Runtipi (GET only, CLI token minted per request)
// Every non-GET is refused 403 "qa-origin refuses writes", like qa-origin: the preview never installs/starts/stops.
// Everything else goes to the qa-origin (shell files, /wizard/* reads from the live Agent Service).
// Usage: node origin.mjs <port> <qa-origin port>
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { createHmac } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'

const { createAppsViewsRoutes } = await import(join(homedir(), 'worktrees/was-apps-views-routes/server/wizard-apps-views.mjs'))
const PORT = +process.argv[2], UP = +process.argv[3]
const routes = createAppsViewsRoutes({ appsJsonPath: join(homedir(), '.wizard-os/apps.json') })
const env = Object.fromEntries(readFileSync(join(homedir(), 'runtipi/.env'), 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }))
const RUNTIPI = `http://${env.INTERNAL_IP || '127.0.0.1'}:${env.NGINX_PORT || 80}`
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url')
const token = () => { const now = Math.floor(Date.now() / 1000); const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64({ sub: 'cli', iat: now, nbf: now, exp: now + 60 }); return `${h}.${p}.${createHmac('sha256', env.JWT_SECRET).update(`${h}.${p}`).digest('base64url')}` }
const RUNTIPI_READ = /^\/api\/(?:apps\/installed|system\/load|marketplace\/apps\/[A-Za-z0-9_.:%-]{1,120}\/image)$/
let refused = 0

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x')
  if (u.pathname === '/__qa/refused-apps') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ refused })) }
  const ours = u.pathname === '/wizard/v1/wizard-apps' || u.pathname.startsWith('/wizard/v1/index') || RUNTIPI_READ.test(u.pathname) || /^\/api\/app-lifecycle\//.test(u.pathname)
  if (ours && req.method !== 'GET' && req.method !== 'HEAD') { refused++; res.writeHead(403, { 'content-type': 'application/json' }); return res.end('{"error":"qa-origin refuses writes"}') }
  if (u.pathname.startsWith('/wizard/v1/') && await routes(req, res, u)) return
  if (RUNTIPI_READ.test(u.pathname)) {
    try {
      const r = await fetch(RUNTIPI + u.pathname, { headers: { Authorization: `Bearer ${token()}` } })
      let body = Buffer.from(await r.arrayBuffer())
      // An installed app's config can hold generated passwords: the views only need status/version, so drop it.
      if (u.pathname === '/api/apps/installed' && r.ok) {
        try { const j = JSON.parse(body); for (const x of j.installed || []) if (x.app) { delete x.app.config; delete x.app.userConfig } ; for (const x of j.installed || []) if (x.info) delete x.info.form_fields; body = Buffer.from(JSON.stringify(j)) } catch { body = Buffer.from('{"installed":[]}') }
      }
      res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' })
      return res.end(body)
    } catch { res.writeHead(502); return res.end('{}') }
  }
  const p = http.request({ host: '127.0.0.1', port: UP, method: req.method, path: req.url, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res) })
  p.on('error', () => { res.writeHead(502); res.end() })
  req.pipe(p)
}).listen(PORT, '127.0.0.1', () => console.log(`apps-views front :${PORT} → qa-origin :${UP}`))
