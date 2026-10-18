// Agents MVP fixture: the exact Agent Service agents contract (briefs/agents-mvp.md), in memory, plus a static
// server for a web dir. Lane B builds and QA's against this until Lane A's service is staged.
//
//   node tools/agents-fixture.mjs [port=9640] [webDir=<repo>/web] [--main=fixture|proxy] [--seed=private|none]
//
// --main=fixture (default; browser QA): the main agent ("hermes") is faked here too, with a few threads.
// --main=proxy   (staged preview): the main agent's reads go to the real Agent Service (--main-upstream, default
//                http://127.0.0.1:8923) and
//                every main-agent write is refused (403), like tools/qa-origin.cjs. Only fixture agents take writes.
//
// --agents-upstream=http://host:port  (switch to Lane A): every agents request (/wizard/v1/agent*, and thread/run
//                calls naming a non-main agent with ?agent=) is forwarded, all methods, to that staged Agent Service
//                instead of the in-memory fixture. Main-agent traffic follows --main as above.
//
// Contract implemented (agent=<id> as query or body):
//   GET/POST /wizard/v1/agents · GET/PATCH /wizard/v1/agents/<id> · POST /wizard/v1/agents/<id>/start|stop
//   GET /wizard/v1/agent-options
//   GET/PUT /wizard/v1/apps/<app_id>/agents → {app_id, kind, agents:[{id,label,privacy,appearance,enabled}]}; PUT {agents:[ids]}
//                (which agents can use an app, #58; standard ticked, private unticked; writes the agents' app lists)
//   GET /wizard/v1/app-bindings → {bindings} · GET/PUT /wizard/v1/apps/<app_id>/binding → {binding}   (App → agent binding; agents list
//                their bound apps as bound_apps). --binding-apps=id:Label:Purpose,… names the installed apps that
//                declare agent_binding (default: one universal recorder). No entry = the main agent.
//   GET/POST /wizard/hermes/api/sessions?agent= · GET/PATCH /wizard/hermes/api/sessions/<sid>?agent=
//   GET /wizard/hermes/api/sessions/<sid>/messages?agent= · POST /wizard/hermes/api/sessions/<sid>/model?agent=
//   POST /wizard/hermes/v1/runs?agent= · GET /wizard/hermes/v1/runs/<id>?agent= · POST …/stop
// Server-side checks answer 409 { error, check } naming the failed check, as the brief requires.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (k, d) => (args.find(a => a.startsWith(`--${k}=`)) || '').split('=')[1] || d;
const pos = args.filter(a => !a.startsWith('--'));
const PORT = Number(pos[0] || 9640);
const WEB = path.resolve(pos[1] || path.join(HERE, '..', 'web'));
const MAIN = flag('main', 'fixture');
const SEED = flag('seed', 'none');
const UP = flag('agents-upstream', '') ? new URL(flag('agents-upstream', '')) : null;
// Untracked build outputs (data.js, summaries.js) may come from another checkout: WIZARD_UX_FALLBACK_WEB=<web dir>.
const FALLBACK = process.env.WIZARD_UX_FALLBACK_WEB || '';
const MAIN_UP = new URL(flag('main-upstream', 'http://127.0.0.1:8923'));
const BACKEND = { host: MAIN_UP.hostname, port: Number(MAIN_UP.port || 80) };
const TYPES = { '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; manifest-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'";
const now = () => Math.floor(Date.now() / 1000);
const iso = s => new Date(s * 1000).toISOString();

/* ---------------- options ---------------- */
const OPTIONS = {
  harnesses: [{ id: 'hermes', label: 'Hermes', description: 'Stock Hermes in its own container: tools, memory and skills of its own.' }],
  providers: [
    { id: 'tinfoil', label: 'Tinfoil (confidential)', confidential: true, description: 'Confidential: encrypted, attested hardware. Tinfoil can’t read what it processes.', models: [{ id: 'glm-5-3', label: 'GLM 5.3' }, { id: 'deepseek-v4-1-flash', label: 'DeepSeek V4.1 Flash' }] },
    { id: 'anthropic', label: 'Claude', confidential: false, description: 'Your Claude account (AI Accounts).', models: [{ id: 'claude-opus-5-5', label: 'Claude Opus 5.5' }, { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' }] },
    { id: 'openai-codex', label: 'ChatGPT', confidential: false, description: 'Your ChatGPT account (AI Accounts).', models: [{ id: 'gpt-5.5', label: 'GPT-5.5' }] },
  ],
  presets: [
    { id: 'private', label: 'Private', privacy: 'private', summary: 'Nothing leaves your Wizard: no outside tools, its own folder only, no apps, no fallback. Needs a confidential provider.', requires_confidential: true,
      permissions: { outside_tools: [], files: 'own', wizard_apps: [], agent_apps: [], other_agents: 'none' } },
    { id: 'standard', label: 'Standard', privacy: 'standard', summary: 'Hermes defaults: outside tools on, reads your shared files. Add the apps you want.',
      permissions: { outside_tools: ['web', 'browser', 'image_gen', 'tts', 'vision', 'delegation', 'x_search'], files: 'shared-read', wizard_apps: [], agent_apps: [], other_agents: 'none' } },
  ],
  wizard_apps: [
    { id: 'meeting-recorder', label: 'Meeting Recorder', description: 'Recordings and recaps' },
    { id: 'wisdom', label: 'Wisdom', description: 'Your reading library' },
    { id: 'calendar', label: 'Calendar', description: 'Your schedule' },
    { id: 'files', label: 'Files', description: 'Your shared files' },
  ],
  agent_apps: [
    { id: 'transcriber', label: 'Transcriber', kind: 'app', description: 'Speech to text on your Wizard' },
    { id: 'reading-queue', label: 'Reading queue', kind: 'app', description: 'Saves links to read later' },
    { id: 'tool-pdf', label: 'PDF tools', kind: 'tool', description: 'Read, merge and fill PDFs' },
    { id: 'conn-gmail', label: 'Gmail', kind: 'connector', description: 'Your Gmail account' },
  ],
  outside_tools: [
    { id: 'web', label: 'Web search', description: 'Searches and reads websites' },
    { id: 'browser', label: 'Browser', description: 'Drives a web browser' },
    { id: 'image_gen', label: 'Image generation', description: 'Makes images with a public model' },
    { id: 'tts', label: 'Voice', description: 'Speaks replies with a public voice service' },
    { id: 'vision', label: 'Vision', description: 'Looks at images with a public model' },
    { id: 'delegation', label: 'Delegation', description: 'Hands work to public models' },
    { id: 'x_search', label: 'X search', description: 'Searches X' },
  ],
  files: ['none', 'own', 'shared-read', 'shared-write'],
  other_agents: ['none', 'titles', 'search', 'read'],
};
const provider = id => OPTIONS.providers.find(p => p.id === id);

/* ---------------- agents ---------------- */
const AGENTS = new Map();
const MAIN_AGENT = { id: 'hermes', label: 'Atlas', harness: 'hermes', privacy: 'standard', appearance: { glyph: 'wizard', hue: 270 },
  model: { provider: 'anthropic', model: 'claude-opus-5-5', allowed_models: [], fallback: true },
  permissions: { preset: 'standard', outside_tools: OPTIONS.presets[1].permissions.outside_tools, files: 'shared-write', wizard_apps: ['meeting-recorder', 'wisdom', 'calendar', 'files'], agent_apps: ['transcriber'], other_agents: 'read' },
  runtime: { kind: 'external', api: 'http://127.0.0.1:8642' }, status: 'running', status_detail: '', is_default: true, created_at: 1790000000 };
AGENTS.set('hermes', MAIN_AGENT);
// Proxy mode: the main agent keeps the box's own name (settings.agent.name from the real bootstrap).
if (MAIN === 'proxy') fetch(new URL('/wizard/v1/bootstrap', MAIN_UP)).then(r => r.json()).then(j => { const n = j?.settings?.agent?.name; if (typeof n === 'string' && n.trim()) MAIN_AGENT.label = n.trim().slice(0, 40); }).catch(() => {});
const IDEMP = new Map();
const pub = a => { const { runtime, created_at, ...rest } = a; return { ...rest, bound_apps: appsFor(a.id) }; };

/* ---------------- app → agent binding ---------------- */
const BIND_APPS = flag('binding-apps', 'meeting-recorder:Meeting Recorder:Where your recording recaps go').split(',').map(x => x.split(':'))
  .filter(([id]) => /^[a-z0-9][a-z0-9._-]{0,63}$/.test(id || '')).map(([id, label, purpose]) => ({ id, label: label || id, required: true, purpose: purpose || '' }));
const BINDINGS = new Map(); // app id -> agent id (absent = the main agent)
const agentFor = id => BINDINGS.get(id) || 'hermes';
function appsFor(agentId) { return BIND_APPS.filter(x => agentFor(x.id) === agentId).map(({ id, label, purpose }) => ({ id, label, purpose })); }
function bindingView(app) {
  const a = AGENTS.get(agentFor(app.id));
  return { app_id: app.id, label: app.label, required: app.required, purpose: app.purpose, agent: agentFor(app.id), is_default: !BINDINGS.has(app.id),
    agent_info: a ? { id: a.id, label: a.label, privacy: a.privacy, appearance: a.appearance } : null, ...(a ? {} : { problem: 'agent_missing' }) };
}
const slug = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'agent';
const PERMS = ['outside_tools', 'files', 'wizard_apps', 'agent_apps', 'other_agents'];
function checkPerms(p, privacy) {
  if (!p || typeof p !== 'object') return 'permissions.shape';
  if (p.files != null && !['none', 'own', 'shared-read', 'shared-write'].includes(p.files)) return 'permissions.files';
  for (const k of ['outside_tools', 'wizard_apps', 'agent_apps']) if (p[k] != null && !Array.isArray(p[k])) return `permissions.${k}`;
  if ((p.outside_tools || []).some(t => !OPTIONS.outside_tools.some(o => o.id === t))) return 'permissions.outside_tools.unknown';
  if ((p.wizard_apps || []).some(t => !OPTIONS.wizard_apps.some(o => o.id === t))) return 'permissions.wizard_apps.unknown';
  if ((p.agent_apps || []).some(t => !OPTIONS.agent_apps.some(o => o.id === t))) return 'permissions.agent_apps.unknown';
  return '';
}
function createAgent(body) {
  const label = String(body.label || '').trim().slice(0, 40);
  if (!label) return [400, { error: 'A name is required', check: 'agent.label' }];
  if ((body.harness || 'hermes') !== 'hermes') return [409, { error: 'Only the Hermes harness is available', check: 'agent.harness' }];
  const p = provider(body.model?.provider); if (!p) return [409, { error: 'Unknown model provider', check: 'agent.model.provider' }];
  const model = body.model?.model; if (!p.models.some(m => m.id === model)) return [409, { error: 'That model isn’t offered by this provider', check: 'agent.model.allowed' }];
  const presetId = body.permissions?.preset || 'standard';
  const pre = OPTIONS.presets.find(x => x.id === presetId); if (!pre) return [409, { error: 'Unknown preset', check: 'agent.permissions.preset' }];
  if (pre.requires_confidential && !p.confidential) return [409, { error: 'A private agent needs a confidential model provider', check: 'agent.private.confidential_provider' }];
  const perms = { preset: presetId, ...pre.permissions };
  for (const k of PERMS) if (body.permissions && k in body.permissions) perms[k] = body.permissions[k];
  const bad = checkPerms(perms); if (bad) return [409, { error: 'Permissions are not valid', check: bad }];
  if (presetId === 'private' && perms.outside_tools.length) return [409, { error: 'A private agent starts with outside tools off', check: 'agent.private.outside_tools' }];
  let id = slug(label); for (let i = 2; AGENTS.has(id); i++) id = `${slug(label)}-${i}`;
  const priv = presetId === 'private';
  const a = { id, label, harness: 'hermes', privacy: priv ? 'private' : 'standard',
    appearance: { glyph: String(body.appearance?.glyph || (priv ? 'lock' : '')), hue: Number.isFinite(Number(body.appearance?.hue)) ? Number(body.appearance.hue) : 200 },
    model: { provider: p.id, model, allowed_models: priv ? [model] : p.models.map(m => m.id), fallback: !priv },
    permissions: perms, runtime: { kind: 'container', app_id: `agent-${id}`, api: `http://agent-${id}:8642` },
    status: 'starting', status_detail: '', is_default: false, created_at: now() };
  AGENTS.set(id, a); SESS.set(id, new Map());
  setTimeout(() => { if (a.status === 'starting') a.status = 'running'; }, 1500);
  return [201, { agent: pub(a) }];
}
function patchAgent(a, body) {
  if (a.is_default) {
    // #58: only which apps the main agent can use is set here.
    const keys = Object.keys(body), pk = Object.keys(body.permissions || {});
    if (keys.some(k => k !== 'permissions') || !pk.length || pk.some(k => !['wizard_apps', 'agent_apps'].includes(k))) return [409, { error: 'The main agent is managed by your Wizard setup', check: 'agent.main' }];
    const next = { ...a.permissions, ...body.permissions }; const bad = checkPerms(next); if (bad) return [409, { error: 'Permissions are not valid', check: bad }];
    a.permissions = next; return [200, { agent: pub(a) }];
  }
  if (a.privacy === 'private' && body.privacy !== undefined && body.privacy !== 'private') return [409, { error: 'private_agent_sealed', check: 'agent.private_sealed' }];
  if (body.label != null) { const l = String(body.label).trim().slice(0, 40); if (!l) return [400, { error: 'A name is required', check: 'agent.label' }]; a.label = l; }
  if (body.appearance) a.appearance = { ...a.appearance, ...body.appearance };
  if (body.model) {
    const p = provider(body.model.provider || a.model.provider);
    if (!p) return [409, { error: 'Unknown model provider', check: 'agent.model.provider' }];
    if (a.privacy === 'private' && !p.confidential) return [409, { error: body.confirm_downgrade === true ? 'private_agent_sealed' : 'A private agent keeps a confidential provider', check: body.confirm_downgrade === true ? 'agent.private_sealed' : 'agent.private.confidential_provider' }];
    if (!p.models.some(m => m.id === body.model.model)) return [409, { error: 'That model isn’t offered by this provider', check: 'agent.model.allowed' }];
    a.model = { ...a.model, provider: p.id, model: body.model.model, allowed_models: a.privacy === 'private' ? [body.model.model] : p.models.map(m => m.id) };
  }
  if (body.permissions) {
    const next = { ...a.permissions }; for (const k of PERMS) if (k in body.permissions) next[k] = body.permissions[k];
    const bad = checkPerms(next); if (bad) return [409, { error: 'Permissions are not valid', check: bad }];
    a.permissions = next;
  }
  return [200, { agent: pub(a) }];
}

/* ---------------- threads and runs, per agent ---------------- */
const SESS = new Map([['hermes', new Map()]]); // agent -> Map(sid -> session)
const RUNS = new Map();
function addSession(agentId, sid, title, msgs = []) {
  const t = now(); const a = AGENTS.get(agentId);
  const s = { id: sid, title, source: 'wizard-mobile', agent: agentId, model: a.model.model, provider: a.model.provider, started_at: t, updated_at: t, messages: msgs, status: 'completed', run: '', archived: false };
  SESS.get(agentId).set(sid, s); return s;
}
function row(s) {
  const a = AGENTS.get(s.agent), last = s.messages[s.messages.length - 1], lastU = [...s.messages].reverse().find(m => m.role === 'user');
  const lastA = [...s.messages].reverse().find(m => m.role === 'assistant');
  return { id: s.id, title: s.title, source: s.source, status: s.status, archived: s.archived, message_count: s.messages.length, model: s.model, provider: s.provider,
    started_at: s.started_at, updated_at: s.updated_at, last_active: s.updated_at, wizard_run_id: s.run || '',
    wizard_last_user_at: lastU ? iso(lastU.timestamp) : null, wizard_last_assistant_at: lastA ? iso(lastA.timestamp) : null,
    latest_message: last ? { role: last.role, content: last.content, timestamp: last.timestamp } : null, last_user_message: lastU ? { role: 'user', content: lastU.content, timestamp: lastU.timestamp } : null,
    agent: { id: a.id, label: a.label, privacy: a.privacy, appearance: a.appearance } };
}
function seedMain() {
  const t = now();
  addSession('hermes', 'wizard_fixture_main_1', 'Wizard OS · Agents MVP plan', [{ role: 'user', content: 'Plan the agents MVP', timestamp: t - 7200 }, { role: 'assistant', content: 'Here is the plan: Agents app, per-agent chats, Private agent on Tinfoil.', timestamp: t - 7100 }]);
  addSession('hermes', 'wizard_fixture_main_2', 'Groceries for the week', [{ role: 'user', content: 'What should I buy?', timestamp: t - 3600 }, { role: 'assistant', content: 'Eggs, rice, greens and coffee.', timestamp: t - 3500 }]);
}
function seedPrivate() {
  const [, j] = createAgent({ label: 'Private', harness: 'hermes', model: { provider: 'tinfoil', model: 'glm-5-3' }, permissions: { preset: 'private' }, appearance: { glyph: 'lock', hue: 160 } });
  const a = AGENTS.get(j.agent.id); a.status = 'running';
  // The owner allows both Tinfoil chat models (PERSONAL_CONFIG): GLM default, DeepSeek on pick.
  a.model.allowed_models = ['glm-5-3', 'deepseek-v4-1-flash'];
  const t = now();
  addSession(a.id, 'wizard_fixture_private_1', 'Recording recap · Team call', [{ role: 'user', content: 'Recap of today’s recording', timestamp: t - 1800 }, { role: 'assistant', content: 'Recap kept in the Private agent. Nothing left this agent.', timestamp: t - 1750 }]);
  // A Mizel-style app delivery (assistant-only recap), newer than every main thread: tops the unified Chats.
  addSession(a.id, 'wizard_app_mizel_fixture1', 'Mizel recap · Fixture standup', [{ role: 'assistant', content: 'Fixture recap: three decisions, two follow-ups.', timestamp: t - 60 }]);
}
if (MAIN === 'fixture') seedMain();
if (SEED === 'private') seedPrivate();

function agentParam(u, body) { return String(u.searchParams.get('agent') || body?.agent || ''); }
function startRun(a, s, body) {
  if (a.privacy === 'private' || a.model.allowed_models.length) {
    if (body.model && !a.model.allowed_models.includes(body.model)) return [409, { error: `${a.label} can’t use ${body.model}`, check: 'agent.allowed_models' }];
    if (body.provider && body.provider !== a.model.provider) return [409, { error: `${a.label} only runs on ${a.model.provider}`, check: 'agent.provider' }];
  }
  if (a.status !== 'running') return [409, { error: `${a.label} isn’t running`, check: 'agent.running' }];
  const input = typeof body.input === 'string' ? body.input : JSON.stringify(body.input || '');
  const t = now(); const id = 'run_' + crypto.randomUUID().slice(0, 12);
  s.messages.push({ role: 'user', content: input, timestamp: t }); s.status = 'running'; s.run = id; s.updated_at = t;
  if (s.title === 'Untitled chat' || !s.title) s.title = input.slice(0, 50);
  const model = body.model || s.model;
  const run = { id, run_id: id, session_id: s.id, agent: a.id, status: 'running', model, provider: a.model.provider, runtime: 'direct' };
  RUNS.set(id, run);
  setTimeout(() => {
    if (run.status !== 'running') return;
    s.messages.push({ role: 'assistant', content: `(${a.label} · ${a.label === 'Private' || a.privacy === 'private' ? 'Tinfoil ' : ''}${model}) Fixture reply to: “${input.slice(0, 120)}”`, timestamp: now() });
    s.status = 'completed'; s.run = ''; s.updated_at = now(); run.status = 'completed';
  }, 1600);
  return [202, { run_id: id, id, status: 'running', session_id: s.id, agent: a.id }];
}

/* ---------------- http ---------------- */
const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
const readBody = req => new Promise(r => { let b = ''; req.on('data', c => { b += c; if (b.length > 1e6) req.destroy(); }); req.on('end', () => { try { r(b ? JSON.parse(b) : {}); } catch (_) { r({}); } }); });
const log = []; // every API call, for QA receipts
function proxy(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 403, { error: 'preview refuses writes to the main agent' });
  const headers = { ...req.headers }; delete headers.host; delete headers.origin; delete headers.referer;
  const p = http.request({ ...BACKEND, method: req.method, path: req.url, headers }, r => {
    // The main list never carries fixture agents' threads, and fixture agents never appear in it.
    res.writeHead(r.statusCode, r.headers); r.pipe(res);
  });
  p.on('error', e => send(res, 502, { error: String(e) })); p.end();
}

async function api(req, res, u) {
  const m = req.method, p = u.pathname;
  const body = ['POST', 'PATCH', 'PUT'].includes(m) ? await readBody(req) : {};
  log.push({ at: Date.now(), method: m, path: p + u.search, agent: agentParam(u, body) || '' });
  if (log.length > 500) log.shift();
  // ---- agents ----
  if (p === '/wizard/v1/agent-options' && m === 'GET') return send(res, 200, OPTIONS);
  if (p === '/wizard/v1/agents' && m === 'GET') return send(res, 200, { agents: [...AGENTS.values()].map(pub) });
  if (p === '/wizard/v1/agents' && m === 'POST') {
    const k = req.headers['idempotency-key']; if (k && IDEMP.has(k)) return send(res, 201, IDEMP.get(k));
    const [code, j] = createAgent(body); if (code === 201 && k) IDEMP.set(k, j); return send(res, code, j);
  }
  let mm = p.match(/^\/wizard\/v1\/agents\/([a-z0-9-]{1,41})(?:\/(start|stop))?$/);
  if (mm) {
    const a = AGENTS.get(mm[1]); if (!a) return send(res, 404, { error: 'No such agent', check: 'agent.exists' });
    if (!mm[2] && m === 'GET') return send(res, 200, { agent: pub(a) });
    if (!mm[2] && m === 'PATCH') { const [code, j] = patchAgent(a, body); return send(res, code, j); }
    if (mm[2] && m === 'POST') {
      if (a.is_default) return send(res, 409, { error: 'The main agent is managed by your Wizard setup', check: 'agent.main.readonly' });
      if (mm[2] === 'stop') a.status = 'stopped'; else { a.status = 'starting'; setTimeout(() => { if (a.status === 'starting') a.status = 'running'; }, 1200); }
      return send(res, 200, { agent: pub(a) });
    }
    return send(res, 405, { error: 'method' });
  }
  if (p === '/wizard/v1/app-bindings' && m === 'GET') return send(res, 200, { bindings: BIND_APPS.map(bindingView) });
  mm = p.match(/^\/wizard\/v1\/apps\/([a-z0-9][a-z0-9._-]{0,63})\/agents$/);
  if (mm) {
    const id = mm[1], kind = OPTIONS.wizard_apps.some(x => x.id === id) ? 'wizard_apps' : OPTIONS.agent_apps.some(x => x.id === id) ? 'agent_apps' : '';
    if (!kind) return send(res, 404, { error: 'app_not_found', check: 'app.id' });
    const view = () => ({ app_id: id, kind, agents: [...AGENTS.values()].map(a => ({ id: a.id, label: a.label, privacy: a.privacy, appearance: a.appearance, is_default: a.is_default, enabled: [...a.permissions.wizard_apps, ...a.permissions.agent_apps].includes(id) })) });
    if (m === 'GET') return send(res, 200, view());
    if (m === 'PUT') {
      if (!Array.isArray(body.agents)) return send(res, 400, { error: 'invalid_request', check: 'app.agents' });
      for (const x of body.agents) if (!AGENTS.has(x)) return send(res, 404, { error: 'agent_not_found', check: 'agent.id' });
      for (const a of AGENTS.values()) {
        const on = body.agents.includes(a.id);
        a.permissions = { ...a.permissions, [kind]: on ? [...new Set([...a.permissions[kind], id])] : a.permissions[kind].filter(x => x !== id) };
      }
      return send(res, 200, view());
    }
    return send(res, 405, { error: 'method' });
  }
  mm = p.match(/^\/wizard\/v1\/apps\/([a-z0-9][a-z0-9._-]{0,63})\/binding$/);
  if (mm) {
    const app = BIND_APPS.find(x => x.id === mm[1]);
    if (!app) return send(res, 404, { error: 'app_not_found', check: 'app.id' });
    if (m === 'GET') return send(res, 200, { binding: bindingView(app) });
    if (m === 'PUT') {
      const id = typeof body.agent === 'string' ? body.agent : '';
      if (!id) return send(res, 400, { error: 'agent_required', check: 'app.binding.agent' });
      if (!AGENTS.has(id)) return send(res, 404, { error: 'agent_not_found', check: 'agent.id' });
      if (id === 'hermes') BINDINGS.delete(app.id); else BINDINGS.set(app.id, id);
      return send(res, 200, { binding: bindingView(app) });
    }
    return send(res, 405, { error: 'method' });
  }
  if (p === '/__fixture/log') return send(res, 200, { log });
  // ---- threads/runs ----
  let agentId = agentParam(u, body);
  const pinnedTo = sid => { for (const [other, map] of SESS) if (other !== 'hermes' && map.has(sid)) return other; return ''; };
  const pathSid = (p.match(/^\/wizard\/hermes\/api\/sessions\/([^/]+)/) || [])[1];
  // #59 (as the Agent Service): a private agent's thread read by id alone is sealed; the client must name the agent.
  if (!agentId && m === 'GET' && pathSid) { const o = pinnedTo(decodeURIComponent(pathSid)); if (o && AGENTS.get(o)?.privacy === 'private') return send(res, 409, { error: 'private_agent_sealed', check: 'agent.private_sealed' }); }
  // Unified Chats routing (as the Agent Service): a new chat on a private agent's model goes to that agent.
  if (!agentId && m === 'POST' && (p === '/wizard/hermes/api/sessions' || p === '/wizard/hermes/v1/runs') && body?.provider === 'tinfoil') {
    const owner = [...AGENTS.values()].filter(x => x.privacy === 'private' && x.model.allowed_models.includes(body.model))[0];
    if (owner) { agentId = owner.id; log.push({ at: Date.now(), routed: owner.id, path: p }); }
  }
  if (!agentId && m === 'POST' && p === '/wizard/hermes/v1/runs') { const o = pinnedTo(String(body?.session_id || '')); if (o) agentId = o; }
  const isFixtureAgent = agentId && agentId !== 'hermes';
  if (MAIN === 'proxy' && !isFixtureAgent) return proxy(req, res);
  const aid = agentId || 'hermes';
  const a = AGENTS.get(aid); if (!a) return send(res, 404, { error: 'No such agent', check: 'agent.exists' });
  const sessions = SESS.get(aid);
  if (p === '/wizard/hermes/api/sessions' && m === 'GET') {
    const rows = [...sessions.values()].sort((x, y) => y.updated_at - x.updated_at).map(row);
    return send(res, 200, { data: rows, has_more: false });
  }
  if (p === '/wizard/hermes/api/sessions' && m === 'POST') {
    const sid = String(body.id || '');
    if (!/^[A-Za-z0-9._:-]{1,180}$/.test(sid)) return send(res, 400, { error: 'id' });
    // Pinned at creation: an id that already belongs to another agent is refused, naming the check.
    for (const [other, map] of SESS) if (other !== aid && map.has(sid)) return send(res, 409, { error: 'This thread belongs to another agent', check: 'thread.agent_pinned' });
    if (sessions.has(sid)) return send(res, 409, { error: 'exists' });
    addSession(aid, sid, 'Untitled chat'); return send(res, 201, { session: row(sessions.get(sid)) });
  }
  mm = p.match(/^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages|\/model)?$/);
  if (mm) {
    const sid = decodeURIComponent(mm[1]); const s = sessions.get(sid);
    if (!s) { for (const [other, map] of SESS) if (other !== aid && map.has(sid)) return send(res, 409, { error: 'This thread belongs to another agent', check: 'thread.agent_pinned' }); return send(res, 404, { error: 'No such thread' }); }
    if (!mm[2] && m === 'GET') return send(res, 200, { session: row(s) });
    if (!mm[2] && m === 'PATCH') { if (typeof body.title === 'string') s.title = body.title.slice(0, 120); if (typeof body.archived === 'boolean') s.archived = body.archived; return send(res, 200, { session: row(s) }); }
    if (mm[2] === '/messages' && m === 'GET') return send(res, 200, { data: s.messages.map((x, i) => ({ id: i + 1, ...x })), has_more: false });
    if (mm[2] === '/model' && m === 'POST') {
      if (a.model.allowed_models.length && !a.model.allowed_models.includes(body.model)) return send(res, 409, { error: `${a.label} can’t use ${body.model}`, check: 'agent.allowed_models' });
      s.model = body.model; s.provider = body.provider || a.model.provider;
      return send(res, 200, { runtime: { model_lock: 'accepted', model: s.model, provider: s.provider, selection_version: now() } });
    }
  }
  if (p === '/wizard/hermes/v1/runs' && m === 'POST') {
    const s = sessions.get(String(body.session_id || ''));
    if (!s) { for (const [other, map] of SESS) if (other !== aid && map.has(body.session_id)) return send(res, 409, { error: 'This thread belongs to another agent', check: 'thread.agent_pinned' }); return send(res, 404, { error: 'No such thread' }); }
    const [code, j] = startRun(a, s, body); return send(res, code, j);
  }
  mm = p.match(/^\/wizard\/hermes\/v1\/runs\/([^/]+)(\/stop|\/steer|\/approval)?$/);
  if (mm) {
    const r = RUNS.get(decodeURIComponent(mm[1])); if (!r || r.agent !== aid) return send(res, 404, { error: 'No such run' });
    if (!mm[2]) return send(res, 200, r);
    if (mm[2] === '/stop') { r.status = 'cancelled'; const s = sessions.get(r.session_id); if (s) { s.status = 'cancelled'; s.run = ''; } return send(res, 200, r); }
    return send(res, 409, { error: 'not supported in fixture', check: 'fixture' });
  }
  // ---- the main agent's other reads (fixture mode only) ----
  if (p === '/wizard/hermes/api/model/options') return send(res, 200, { provider: 'anthropic', model: 'claude-opus-5-5', providers: [{ slug: 'anthropic', name: 'Claude', is_current: true, authenticated: true, models: ['claude-opus-5-5', 'claude-sonnet-5-5'] }] });
  if (p === '/wizard/thread-seen') return send(res, 200, { state: m === 'PUT' ? body : null });
  if (p === '/wizard/thread-dispositions') return send(res, 200, { state: {} });
  if (p === '/wizard/v1/apps') return send(res, 200, { apps: [] });
  return send(res, 404, { error: 'not in fixture' });
}

function upstream(req, res) {
  const headers = { ...req.headers }; delete headers.host; delete headers.origin; delete headers.referer;
  const p = http.request({ host: UP.hostname, port: UP.port || 80, method: req.method, path: req.url, headers }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  p.on('error', e => send(res, 502, { error: String(e), check: 'preview.agents_upstream' })); req.pipe(p);
}
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  // A stand-in for an installed app that declares agent_binding (QA opens it as a window; the shell adds its route).
  { const am = u.pathname.match(/^\/__fixture\/apps\/([a-z0-9][a-z0-9._-]{0,63})\/$/); const app = am && BIND_APPS.find(x => x.id === am[1]);
    if (app) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); return res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${app.label}</title><body style="margin:0;font:15px system-ui;color:#eee;background:#0b0718;padding:24px"><h1 style="font-size:20px">${app.label}</h1><p>${app.purpose}</p><p>Fixture app: its work goes to whichever agent it routes through.</p></body>`); } }
  const agentsRoute = /^\/wizard\/v1\/(agent(s|-options|-grants)|app-bindings$|apps\/[^/]+\/(binding|agents)$)/.test(u.pathname);
  if (UP && (agentsRoute || (u.pathname.startsWith('/wizard/') && u.searchParams.get('agent') && u.searchParams.get('agent') !== 'hermes'))) return upstream(req, res);
  if (u.pathname.startsWith('/wizard/') || u.pathname.startsWith('/__fixture/')) {
    const fixtureRoute = agentsRoute || u.pathname.startsWith('/__fixture/');
    if (MAIN === 'proxy' && !fixtureRoute && !u.searchParams.get('agent') && !(req.method !== 'GET' && /\/wizard\/hermes\//.test(u.pathname))) return proxy(req, res);
    return api(req, res, u).catch(e => send(res, 500, { error: String(e) }));
  }
  if (u.pathname.startsWith('/api/')) return send(res, 404, {});
  let rel = u.pathname.startsWith('/wizard-os-home/') ? u.pathname.slice('/wizard-os-home/'.length) : u.pathname === '/wizard-os-home' ? '' : null;
  if (rel == null) { res.writeHead(302, { location: '/wizard-os-home/' }); return res.end(); }
  rel = decodeURIComponent(rel) || 'index.html';
  if (rel.endsWith('/')) rel += 'index.html';
  if (rel === 'sw.js') { res.writeHead(404); return res.end(); } // previews never install a worker over the daily
  if (rel.includes('..') || rel.split('/').some(s => s.startsWith('.'))) { res.writeHead(404); return res.end(); }
  let f = path.join(WEB, rel);
  if (!fs.existsSync(f) && FALLBACK && fs.existsSync(FALLBACK)) f = path.join(FALLBACK, rel);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store', 'content-security-policy': CSP, 'permissions-policy': 'microphone=(self)' });
  fs.createReadStream(f).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log(`agents-fixture http://127.0.0.1:${PORT}/wizard-os-home/ → ${WEB} (main=${MAIN}, seed=${SEED})`));
