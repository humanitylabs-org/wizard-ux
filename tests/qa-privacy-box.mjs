// A test Wizard for wizard-ux#1801 (Settings › Privacy): the REAL Agent Service (wizard-agent-service
// server/service.mjs from a checkout, QA_AS=<path>) with a stand-in main Hermes on Claude, and in front of it one
// origin that serves this repo's web/ (or QA_WEB) at /wizard-os-home/, a stand-in Tinfoil app (/wizard-tinfoil/) and
// passes everything else to the Agent Service. Private mode follows the owner's switch wizard/private-mode in the Look
// file, which the shell itself writes (Pages/wizard-look/look.json), so the switch chain is the box's own.
// Installed apps: Mail and Notes (personal data: `privacy: private`), Music, Tinfoil and Claude (connection apps).
//   QA_AS=<agent service checkout> node tests/qa-privacy-box.mjs   → prints `READY <port> <dir>` and serves until killed
// Control (for the QA script, never a real box): POST /qa/tinfoil {signed: true|false}; GET /qa/state.
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, readFileSync, statSync, createReadStream } from 'node:fs'
import { createServer, request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve, extname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const AS = resolve(process.env.QA_AS || '')
if (!process.env.QA_AS || !existsSync(join(AS, 'server', 'service.mjs'))) { console.error('QA_AS must point at a wizard-agent-service checkout'); process.exit(2) }
const WEB = process.env.QA_WEB ? resolve(process.env.QA_WEB) : join(fileURLToPath(new URL('.', import.meta.url)), '..', 'web')
const { createWizardServer, listen } = await import(pathToFileURL(join(AS, 'server', 'service.mjs')).href)

const APPS = [
  { id: 'wizard-mail', name: 'Mail', status: 'running', privacy: 'private', view: { url: '/wizard-mail/' }, url: '/wizard-mail/', kind: 'wizard', mcp: { url: 'http://mail/mcp' }, agent_binding: { required: true, purpose: 'Where mail summaries go' } },
  { id: 'wizard-notes', name: 'Notes', status: 'running', privacy: 'private', view: { url: '/wizard-notes/' }, url: '/wizard-notes/', kind: 'wizard', mcp: { url: 'http://notes/mcp' } },
  { id: 'wizard-music', name: 'Music', status: 'running', view: { url: '/wizard-music/' }, url: '/wizard-music/', kind: 'wizard', mcp: { url: 'http://music/mcp' } },
  { id: 'wizard-tinfoil', name: 'Tinfoil', status: 'running', view: { url: '/wizard-tinfoil/' }, url: '/wizard-tinfoil/', kind: 'wizard' },
  { id: 'wizard-claude', name: 'Claude', status: 'running', provides: ['ai-connection'], view: { url: '/wizard-claude/' }, url: '/wizard-claude/', kind: 'wizard', mcp: { url: 'http://claude/mcp' } },
]
const state = { tinfoil: process.env.QA_TINFOIL === 'signed', runs: [], sessions: {} }

// The main Hermes, signed in to Claude.
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)) }
const main = createServer((req, res) => {
  let body = ''; req.on('data', c => { body += c })
  req.on('end', () => {
    const p = new URL(req.url ?? '/', 'http://x').pathname
    if (p === '/health') return json(res, 200, { status: 'ok' })
    if (p === '/api/model/options') return json(res, 200, { provider: 'anthropic', model: 'claude-opus-5-5', providers: [{ slug: 'anthropic', name: 'Claude', authenticated: true, auth_type: 'oauth', models: ['claude-opus-5-5'] }] })
    if (p === '/api/sessions' && req.method === 'GET') return json(res, 200, { data: Object.keys(state.sessions).map(id => ({ id, title: 'Chat', message_count: state.sessions[id].length, last_active: Date.now() / 1000, source: 'wizard-mobile' })) })
    if (p === '/api/sessions' && req.method === 'POST') { try { const j = JSON.parse(body); state.sessions[j.id] = state.sessions[j.id] || [] } catch {} return json(res, 200, { ok: true }) }
    const m = p.match(/^\/api\/sessions\/([^/]+)\/messages$/)
    if (m) return json(res, 200, { data: state.sessions[decodeURIComponent(m[1])] || [] })
    if (p === '/v1/runs' && req.method === 'POST') { let j = {}; try { j = JSON.parse(body) } catch {} state.runs.push(j); return json(res, 200, { run_id: 'r' + state.runs.length, status: 'completed' }) }
    json(res, 404, {})
  })
})
const mainAddress = await listen(main)

const dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'qa-1801-privacy-'))
mkdirSync(join(dir, 'agents'), { recursive: true })
writeFileSync(join(dir, 'apps.json'), JSON.stringify({ schema: 1, apps: APPS }))
// Today every app is on the standard agent (the owner ticked them before private mode).
writeFileSync(join(dir, 'agents', '.main-agent.json'), JSON.stringify({ schema: 1, wizard_apps: ['wizard-mail', 'wizard-notes', 'wizard-music', 'wizard-tinfoil'], agent_apps: ['wizard-claude'] }))
const svc = createWizardServer({
  upstreamOrigin: `http://127.0.0.1:${mainAddress.port}`, hermesKey: 'fixture-key', requireAccess: false, agentBridge: false,
  appsJsonPath: join(dir, 'apps.json'), settingsPath: join(dir, 'settings.json'), wizardOsHome: dir,
  agentRuntime: { apply: async () => ({ ok: true }), start: async () => ({ ok: true }), stop: async () => ({ ok: true }) },
  schedulerStatePath: join(dir, 'schedules.sqlite'), schedulerIntervalMs: 3_600_000,
  followThrough: false, agentBasePort: 47930 + Math.floor(Math.random() * 500), runQueue: false,
  pagesRoot: join(dir, 'Pages'), pagesGitDir: join(dir, 'pages-history.git'), pagesWatch: false, privateModeTtlMs: 0,
})
const svcAddress = await listen(svc)

const TYPES = { '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' }
const TINFOIL_PAGE = `<!doctype html><meta charset="utf-8"><body style="font:15px system-ui;padding:16px;background:#fff;color:#111"><h1 style="font-size:18px">Tinfoil</h1><p>Stand-in sign-in page.</p><button id="in" style="font:inherit;padding:10px 16px" onclick="fetch('/qa/tinfoil',{method:'POST',headers:{'content-type':'application/json'},body:'{&quot;signed&quot;:true}'}).then(()=>{document.body.append(' Signed in.')})">Sign in to Tinfoil</button></body>`
const front = createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname
  if (p === '/') { res.writeHead(302, { location: '/wizard-os-home/' }); return res.end() }
  if (p.startsWith('/wizard-os-home/') && !p.startsWith('/wizard-os-home/store-install/') && !p.startsWith('/wizard-os-home/store-data/')) {
    let f = join(WEB, decodeURIComponent(p.slice('/wizard-os-home/'.length)) || 'index.html')
    if (f.endsWith('/')) f += 'index.html'
    if (!f.startsWith(WEB) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); return res.end() }
    res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' })
    return createReadStream(f).pipe(res)
  }
  if (p === '/wizard-tinfoil/api/status') return json(res, 200, state.tinfoil ? { provider: 'tinfoil', credentialStored: true } : { provider: null, credentialStored: false })
  if (p === '/wizard-tinfoil/' || p === '/wizard-tinfoil/index.html') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(TINFOIL_PAGE) }
  if (/^\/wizard-(mail|notes|music|claude)\/$/.test(p)) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<!doctype html><body>app</body>') }
  if (p === '/wizard/v1/apps' && req.method === 'GET') return json(res, 200, { apps: APPS })
  if (p === '/troubleshoot/api/ping') return json(res, 200, { ok: true })
  if (p === '/troubleshoot/api/status') return json(res, 200, { checks: [] })
  if (p.startsWith('/qa/')) {
    let body = ''; req.on('data', c => { body += c })
    return req.on('end', () => {
      if (p === '/qa/tinfoil') { try { state.tinfoil = JSON.parse(body).signed === true } catch {} return json(res, 200, { tinfoil: state.tinfoil }) }
      if (p === '/qa/state') {
        const read = f => { try { return JSON.parse(readFileSync(join(dir, f), 'utf8')) } catch { return null } }
        return json(res, 200, { tinfoil: state.tinfoil, runs: state.runs.length, record: read('agents/.private-mode.json'), settings: read('settings.json'), look: read('Pages/wizard-look/look.json') })
      }
      json(res, 404, {})
    })
  }
  // Everything else is the Agent Service's (its owner routes, Pages, /wizard/hermes/* to the main Hermes).
  const up = httpRequest({ host: '127.0.0.1', port: svcAddress.port, path: req.url, method: req.method, headers: req.headers }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res) })
  up.on('error', () => { if (!res.headersSent) json(res, 502, { error: 'service' }) })
  req.pipe(up)
})
const frontAddress = await listen(front, '127.0.0.1', Number(process.env.QA_PORT) || 0)
console.log(`READY ${frontAddress.port} ${dir}`)
