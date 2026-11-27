// A test Wizard for wizard-ux#1804 (private routing, the shell half of wizard-agent-service#629): the REAL Agent
// Service (server/service.mjs from a checkout, QA_AS=<path>) decides where each orb take goes, through its own
// /wizard/v1/route, Sent log, agents and Look file. In private mode (turned on through its own route), with a
// standard "Philosopher" agent on claude-fable-5 and a stand-in PRIVATE router on 127.0.0.1 that labels personal
// requests by keyword. One origin in front serves this repo's web/ (or QA_WEB) at /wizard-os-home/ and passes
// everything to the Agent Service, except the agents' Hermes runtimes (/wizard/hermes/*), which are stand-ins here
// that record which agent got which words (?agent=<id>; none = the default, private agent).
//   QA_AS=<agent service checkout> node tests/qa-private-routing-box.mjs   → prints `READY <port> <dir>` and serves
// Control (for the QA script, never a real box): GET /qa/state (runs per agent, sessions, Sent rows, look file).
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
  { id: 'messenger', name: 'Messenger', status: 'running', privacy: 'private', view: { url: '/messenger/' }, url: '/messenger/', kind: 'wizard', mcp: { url: 'http://messenger/mcp' } },
  { id: 'wizard-money', name: 'Money', status: 'running', privacy: 'private', view: { url: '/wizard-money/' }, url: '/wizard-money/', kind: 'wizard', mcp: { url: 'http://money/mcp' } },
  { id: 'wizard-notes', name: 'Notes', status: 'running', view: { url: '/wizard-notes/' }, url: '/wizard-notes/', kind: 'wizard', mcp: { url: 'http://notes/mcp' } },
]
const OPTIONS = { provider: 'anthropic', model: 'claude-opus-5-5', providers: [
  { slug: 'anthropic', name: 'Claude', authenticated: true, auth_type: 'oauth', models: ['claude-opus-5-5', 'claude-fable-5'] },
  { slug: 'openai-codex', name: 'ChatGPT', authenticated: true, auth_type: 'oauth', models: ['gpt-5.5'] },
] }
const PERSONAL = /messenger|spend|sam\b|mail|money/iu
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)) }
const state = { runs: [], sessions: {}, routerCalls: 0, archived: [] }
const REPLY_MS = Number(process.env.QA_REPLY_MS ?? -1) // < 0: agents never answer (a thread with no reply yet)

// The main Hermes behind the Agent Service (only its model list is read here).
const main = createServer((req, res) => {
  req.resume(); req.on('end', () => {
    const p = new URL(req.url ?? '/', 'http://x').pathname
    if (p === '/health') return json(res, 200, { status: 'ok' })
    if (p === '/api/model/options') return json(res, 200, OPTIONS)
    if (p === '/api/sessions') return json(res, 200, { data: [] })
    json(res, 404, {})
  })
})
const mainAddress = await listen(main)
// The private router (loopback = a private endpoint): one answer, with the personal label.
const router = createServer((req, res) => {
  let b = ''; req.on('data', c => { b += c })
  req.on('end', () => {
    state.routerCalls += 1
    let said = ''; try { said = JSON.parse(b).messages.at(-1).content } catch {}
    json(res, 200, { choices: [{ message: { content: JSON.stringify({ route: 'agent', summary: 'REWRITTEN BY ROUTER', personal: PERSONAL.test(said) }) } }] })
  })
})
const routerAddress = await listen(router)

const dir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'qa-1804-private-routing-'))
mkdirSync(join(dir, 'agents'), { recursive: true })
mkdirSync(join(dir, 'Pages', 'wizard-look'), { recursive: true })
writeFileSync(join(dir, 'apps.json'), JSON.stringify({ schema: 1, apps: APPS }))
writeFileSync(join(dir, 'settings.json'), JSON.stringify({ fast_router: { endpoint: `http://127.0.0.1:${routerAddress.port}/v1/chat/completions`, model: 'fixture-router' } }))
// Private mode and private routing are on for everyone (no switch in the Look file).
writeFileSync(join(dir, 'Pages', 'wizard-look', 'look.json'), JSON.stringify({ version: 1, skin: null, tweaks: {} }))
const svc = createWizardServer({
  upstreamOrigin: `http://127.0.0.1:${mainAddress.port}`, hermesKey: 'fixture-key', requireAccess: false, agentBridge: false,
  appsJsonPath: join(dir, 'apps.json'), settingsPath: join(dir, 'settings.json'), wizardOsHome: dir,
  agentRuntime: { apply: async () => ({ ok: true }), start: async () => ({ ok: true }), stop: async () => ({ ok: true }) },
  schedulerStatePath: join(dir, 'schedules.sqlite'), schedulerIntervalMs: 3_600_000, followThrough: false,
  agentBasePort: 48100 + Math.floor(Math.random() * 400), runQueue: false, agentInboxStatePath: join(dir, 'state', 'agent-inbox.json'),
  pagesRoot: join(dir, 'Pages'), pagesGitDir: join(dir, 'pages-history.git'), pagesWatch: false,
})
const svcAddress = await listen(svc)
const base = `http://127.0.0.1:${svcAddress.port}`
const call = async (method, path, body) => {
  const r = await fetch(base + path, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: r.status, json: await r.json().catch(() => null) }
}
const on = await call('POST', '/wizard/v1/private-mode/on', { apps: ['messenger', 'wizard-money'] })
if (on.status !== 200) { console.error('private mode did not turn on', on.status, JSON.stringify(on.json)); process.exit(3) }
const made = await call('POST', '/wizard/v1/agents', { label: 'Philosopher', preset: 'standard', model: { provider: 'anthropic', model: 'claude-fable-5' } })
if (made.status !== 201) { console.error('Philosopher not made', made.status, JSON.stringify(made.json)); process.exit(3) }

// The agents' Hermes runtimes, one stand-in: every session and run is kept under the agent that got it.
const agentOf = u => u.searchParams.get('agent') || 'private'
const nowS = () => Date.now() / 1000
function hermes(req, res, u, body) {
  const p = u.pathname.replace(/^\/wizard\/hermes/, ''), agent = agentOf(u)
  const list = () => Object.values(state.sessions).filter(s => s.agent === agent && !s.archived)
  if (p === '/api/model/options') {
    if (agent === 'philosopher') return json(res, 200, { provider: 'anthropic', model: 'claude-fable-5', providers: [{ slug: 'anthropic', name: 'Claude', authenticated: true, models: ['claude-fable-5'] }] })
    if (agent === 'private') return json(res, 200, { provider: 'tinfoil', model: 'glm-5-3', providers: [{ slug: 'tinfoil', name: 'Tinfoil', authenticated: true, models: ['glm-5-3'] }] })
    return json(res, 200, OPTIONS)
  }
  if (p === '/api/sessions' && req.method === 'GET') return json(res, 200, { data: list().map(s => ({ id: s.id, title: s.title, runtime: 'direct', status: s.status, source: 'wizard-mobile', message_count: s.messages.length, last_active: s.at, updated_at: new Date(s.at * 1000).toISOString(), preview: s.messages[0]?.content || '' })), has_more: false })
  if (p === '/api/sessions' && req.method === 'POST') {
    let j = {}; try { j = JSON.parse(body) } catch {}
    if (j.id && !state.sessions[j.id]) state.sessions[j.id] = { id: j.id, agent, title: 'New chat', status: 'idle', messages: [], at: nowS(), model: j.model || '' }
    return json(res, 200, { session: { id: j.id } })
  }
  let m = p.match(/^\/api\/sessions\/([^/]+)\/messages$/)
  if (m) { const s = state.sessions[decodeURIComponent(m[1])]; return s && s.agent === agent ? json(res, 200, { data: s.messages }) : json(res, 404, { error: 'session_not_found' }) }
  m = p.match(/^\/api\/sessions\/([^/]+)$/)
  if (m && req.method === 'PATCH') {
    const s = state.sessions[decodeURIComponent(m[1])]
    let j = {}; try { j = JSON.parse(body) } catch {}
    if (s && j.archived === true) { s.archived = true; state.archived.push({ id: s.id, agent: s.agent }) }
    return s ? json(res, 200, { session: { id: s.id, archived: !!s.archived } }) : json(res, 404, { error: 'session_not_found' })
  }
  if (m && req.method === 'GET') { const s = state.sessions[decodeURIComponent(m[1])]; return s && s.agent === agent ? json(res, 200, { session: { id: s.id, title: s.title } }) : json(res, 404, { error: 'session_not_found' }) }
  if (p === '/v1/runs' && req.method === 'POST') {
    let j = {}; try { j = JSON.parse(body) } catch {}
    const s = state.sessions[j.session_id] || (state.sessions[j.session_id] = { id: j.session_id, agent, title: 'New chat', status: 'idle', messages: [], at: nowS() })
    const run = { run_id: 'run-' + (state.runs.length + 1), agent, session_id: j.session_id, input: j.input, model: j.model, provider: j.provider, at: Date.now() }
    state.runs.push(run)
    s.title = String(j.input || '').slice(0, 40); s.status = 'running'; s.at = nowS(); s.runId = run.run_id
    s.messages.push({ id: s.messages.length + 1, role: 'user', content: j.input, timestamp: nowS() })
    if (REPLY_MS >= 0) setTimeout(() => { s.messages.push({ id: s.messages.length + 1, role: 'assistant', content: `(${agent}) reply`, timestamp: nowS() }); s.status = 'completed' }, REPLY_MS)
    return json(res, 200, { run_id: run.run_id, status: 'running' })
  }
  m = p.match(/^\/v1\/runs\/([^/]+)(\/stop|\/cancel)?$/)
  if (m) {
    const run = state.runs.find(r => r.run_id === decodeURIComponent(m[1]))
    if (m[2] && run) { const s = state.sessions[run.session_id]; if (s) s.status = 'cancelled'; run.stopped = true }
    return run ? json(res, 200, { run_id: run.run_id, status: run.stopped ? 'cancelled' : 'running' }) : json(res, 404, { error: 'run_not_found' })
  }
  return json(res, 404, { error: 'not_in_fixture', path: p })
}

const TYPES = { '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' }
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
  if (p === '/wizard/v1/apps' && req.method === 'GET') return json(res, 200, { apps: APPS })
  if (p === '/troubleshoot/api/ping') return json(res, 200, { ok: true })
  if (p === '/troubleshoot/api/status') return json(res, 200, { checks: [] })
  if (p === '/qa/state') {
    return call('GET', '/wizard/v1/sent?limit=50').then(sent => {
      let look = null; try { look = JSON.parse(readFileSync(join(dir, 'Pages', 'wizard-look', 'look.json'), 'utf8')) } catch {}
      json(res, 200, { runs: state.runs, sessions: Object.values(state.sessions).map(s => ({ id: s.id, agent: s.agent, archived: !!s.archived, messages: s.messages.length })), archived: state.archived, routerCalls: state.routerCalls, sent: sent.json?.rows || [], look })
    })
  }
  if (p.startsWith('/wizard/hermes/')) {
    let body = ''; req.on('data', c => { body += c })
    return req.on('end', () => hermes(req, res, u, body))
  }
  // Everything else is the Agent Service's own (route, Sent log, agents, Pages/Look file, ...).
  const up = httpRequest({ host: '127.0.0.1', port: svcAddress.port, path: req.url, method: req.method, headers: req.headers }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res) })
  up.on('error', () => { if (!res.headersSent) json(res, 502, { error: 'service' }) })
  req.pipe(up)
})
const frontAddress = await listen(front, '127.0.0.1', Number(process.env.QA_PORT) || 0)
console.log(`READY ${frontAddress.port} ${dir}`)
