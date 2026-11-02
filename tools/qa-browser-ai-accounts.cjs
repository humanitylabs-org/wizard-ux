// Shell intents (wizard-os spec/browser-trust-shell-intents): the REAL ChatGPT and Claude connection pages
// (wizard-app-store images/wizard-{chatgpt,claude}: pool_server.py + pool-static, and Claude's original claude-code/
// page) inside the opaque frame, with every feature on typed operations, the trusted-shell owner confirmation and the
// narrow sign-in navigation intent. Real Chromium + real Agent Service + REAL WAM install/grant/credential state from
// each app's own wizard.md + the apps' REAL MCP fronts (listener gate on, WAM-written env) + the REAL engines over a
// stub Hermes dashboard (synthetic accounts, no provider) and a fake `claude` CLI. A Node stand-in replaces nginx for
// the shell document. Provider hosts resolve to 127.0.0.1 in Chromium, so a sign-in tab never reaches a provider.
// Env: QA_OUT, QA_SERVICE_ROOT, QA_WAM_ROOT, QA_STORE_ROOT, QA_CHATGPT_ROOT, QA_CLAUDE_ROOT, QA_PYTHON (PyYAML),
// optional QA_PLAYWRIGHT, QA_CHROME, QA_BASELINE=1 (unmigrated pages: record what breaks, no feature checks).
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict'), { spawn, execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url'), crypto = require('node:crypto');
const appFrame = require('./qa-browser-frame.cjs');
const root = path.resolve(process.env.QA_UX_ROOT || path.join(__dirname, '..')), out = path.resolve(process.env.QA_OUT || '');
const { chromium } = require(path.join(root, 'tools/qa-playwright.cjs'));
for (const k of ['QA_OUT', 'QA_SERVICE_ROOT', 'QA_WAM_ROOT', 'QA_STORE_ROOT', 'QA_CHATGPT_ROOT', 'QA_CLAUDE_ROOT', 'QA_PYTHON']) if (!process.env[k]) throw new Error(k + ' is required');
fs.mkdirSync(out, { recursive: true });
const BASELINE = process.env.QA_BASELINE === '1';
const token = crypto.randomBytes(32).toString('hex'), ownerProof = crypto.randomBytes(32).toString('hex');
const web = path.join(root, 'web');
const listen = server => new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const close = s => new Promise(r => { s.closeAllConnections?.(); s.close(r); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = async () => { const s = http.createServer(); const p = await listen(s); await close(s); return p; };
const report = { candidate: !BASELINE, baseline: BASELINE, nativeProven: false, nginxStandIn: 'node', checks: [], open: [], screenshots: [], errors: [], wam: [], appRequests: [], hermes: [], popups: [], intents: [] };
const check = (value, name) => { assert.ok(value, name); report.checks.push(name); };
const box = path.join(out, 'box');
const wam = (...args) => { const r = execFileSync(process.env.QA_PYTHON, [path.join(process.env.QA_WAM_ROOT, 'tools/browser_admission_fixture.py'), box, ...args], { encoding: 'utf8' }); report.wam.push(args.join(' ')); return r; };
const appsJson = () => JSON.parse(fs.readFileSync(path.join(box, 'home/apps.json'), 'utf8'));
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const children = [];
const CLAUDE_URL = 'https://claude.ai/oauth/authorize?code=true&client_id=synthetic-client&response_type=code&redirect_uri=https%3A%2F%2Fconsole.anthropic.com%2Foauth%2Fcode%2Fcallback&scope=user%3Ainference&code_challenge=synthetic-challenge&code_challenge_method=S256&state=synthetic-state';
const DEVICE_URL = 'https://auth.openai.com/codex/device';

// ---- Stub Hermes dashboard: the Wizard OS plugin's account broker semantics (account_lifecycle.py), synthetic only.
function hermesStub() {
  const iso = h => new Date(Date.now() + h * 3600e3).toISOString();
  const acct = (id, email, plan, extra = {}) => ({ id, name: email, source: 'pool', email, emailHash: crypto.createHash('sha256').update(email).digest('hex').slice(0, 16), plan, status: 'ready',
    usage: { limits: [{ id: 'session:5h', label: 'Session (5 h)', usedPercent: 18, resetsAt: iso(3) }, { id: 'weekly_all:7d', label: 'Weekly', usedPercent: 41, resetsAt: iso(80) }] },
    credentials: [{ id: 'cred-' + id, name: 'Sign-in ' + id.slice(-1).toUpperCase(), managed: true }], priority: 0, preferred: false, actions: { reconnect: true, remove: true, prefer: true }, ...extra });
  const state = {
    chatgpt: [acct('cg-a', 'synthetic.one@example.com', 'Plus', { preferred: true, priority: 0 }), acct('cg-b', 'synthetic.two@example.com', 'Pro', { priority: 1, status: 'expired', usage: null, usageStatus: 'unavailable' })],
    claude: [acct('cl-a', 'synthetic.claude@example.com', 'Max 5x', { preferred: true })],
    jobs: new Map(), approve: new Set(),
  };
  const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', c => { body += c; });
    req.on('end', () => {
      const u = new URL(req.url, 'http://x'), d = body ? JSON.parse(body) : null;
      report.hermes.push({ method: req.method, path: u.pathname, body: d && { ...d, ...(d.code ? { code: '[pasted]' } : {}) } });
      if (u.pathname === '/auth/password-login') { res.writeHead(200, { 'set-cookie': 'hermes_session=synthetic; Path=/' }); return res.end('{}'); }
      if (u.pathname === '/api/model/info') return json(res, 200, { provider: 'synthetic-qa', model: 'synthetic-model' });
      if (u.pathname.startsWith('/api/model/')) return json(res, 200, { providers: [] });
      const m = /^\/api\/plugins\/wizard-os\/provider-accounts\/(chatgpt|claude)(\/operations(?:\/([A-Za-z0-9_-]+))?)?$/.exec(u.pathname);
      if (!m) return json(res, 404, { detail: 'not found' });
      const prov = m[1], list = () => state[prov];
      if (!m[2]) return json(res, 200, { provider: prov, owner: 'hermes', accounts: list(), actions: { add: true }, identity: { emailHash: true }, management: { contract: 'wizard.account-management/1', status: 'available' } });
      if (m[3]) {
        const job = state.jobs.get(m[3]); if (!job) return json(res, 404, { detail: 'Unknown operation' });
        if (job.status === 'running' && state.approve.has(job.id)) {
          job.status = 'succeeded'; job.url = null; job.userCode = null; job.inputRequired = false;
          if (job.action === 'add') { const n = list().length + 1, a = acct(prov.slice(0, 2) + '-n' + n, `synthetic.new${n}@example.com`, prov === 'claude' ? 'Pro' : 'Plus', { priority: n }); list().push(a); job.credentialIds = [a.credentials[0].id]; }
          if (job.action === 'reconnect') for (const a of list()) if (a.credentials.some(c => c.id === job.target)) { a.status = 'ready'; a.usageStatus = undefined; a.usage = acct('x', 'x@example.com', 'Plus').usage; }
        }
        return json(res, 200, job);
      }
      if (d.action === 'cancel') { const job = state.jobs.get(d.operation); if (job) job.status = 'cancelled'; return json(res, 200, job || {}); }
      if (d.action === 'submit') {
        const job = state.jobs.get(d.operation);
        if (!job || !job.inputRequired || !/^[A-Za-z0-9_-]{1,2048}#[A-Za-z0-9_-]{1,256}$/.test(d.code || '')) return json(res, 409, { detail: 'Operation is not accepting a code' });
        job.inputRequired = false; state.approve.add(job.id); return json(res, 200, job);
      }
      if (d.confirmed !== true) return json(res, 403, { detail: 'Confirmation required' });
      const job = { id: crypto.randomBytes(18).toString('base64url'), provider: prov, action: d.action, target: d.target || null, status: 'running', expiresAt: Date.now() / 1000 + 600, url: null, userCode: null, inputRequired: false, credentialIds: [] };
      if (d.action === 'add' || d.action === 'reconnect') { job.url = prov === 'chatgpt' ? DEVICE_URL : CLAUDE_URL; if (prov === 'chatgpt') job.userCode = 'SYNT-4821'; else job.inputRequired = true; }
      if (d.action === 'remove') { state[prov] = list().filter(a => !a.credentials.some(c => c.id === d.target)); job.status = 'succeeded'; }
      if (d.action === 'prefer') { for (const a of list()) { a.preferred = a.credentials.some(c => c.id === d.target); } list().sort((x, y) => Number(y.preferred) - Number(x.preferred)).forEach((a, i) => { a.priority = i; }); job.status = 'succeeded'; }
      state.jobs.set(job.id, job);
      json(res, 200, job);
    });
  });
  return { server, state };
}

// Fake official Claude Code CLI for the original claude-code/ page (status, login with a pasted code, logout, -p test).
function fakeClaude(dir) {
  const file = path.join(dir, 'fake-claude.py'), st = path.join(dir, 'fake-claude-state.json');
  fs.writeFileSync(file, `#!/usr/bin/env python3
import json, os, sys
ST = ${JSON.stringify(st)}
def load():
    try: return json.load(open(ST))
    except Exception: return {"loggedIn": False}
a = sys.argv[1:]
if a[:3] == ["auth", "status", "--json"]:
    s = load(); print(json.dumps({**s, "authMethod": "claude.ai", "email": "synthetic.claude@example.com", "subscriptionType": "max"} if s.get("loggedIn") else s)); sys.exit(0)
if a[:2] == ["auth", "login"]:
    print("Opening browser to sign in...\\nVisit: ${CLAUDE_URL}\\nPaste code here if prompted > ", flush=True)
    code = sys.stdin.readline().strip()
    if "#" in code: json.dump({"loggedIn": True}, open(ST, "w")); print("Login successful.", flush=True); sys.exit(0)
    print("Login failed: invalid code", flush=True); sys.exit(1)
if a[:2] == ["auth", "logout"]:
    json.dump({"loggedIn": False}, open(ST, "w")); print("Logged out."); sys.exit(0)
if a and a[0] == "-p":
    print(json.dumps({"result": "OK", "is_error": False, "modelUsage": {"claude-haiku-synthetic": {}}})); sys.exit(0)
sys.exit(2)
`, { mode: 0o755 });
  return file;
}

(async () => {
  const hermes = hermesStub(), hermesPort = await listen(hermes.server);
  // ---- WAM: each app's OWN wizard.md (browser_contract), a listener credential, owner grants. ----
  const ports = { chatgpt: await freePort(), claude: await freePort() }, engines = { chatgpt: await freePort(), claude: await freePort() };
  fs.mkdirSync(path.join(box, 'home'), { recursive: true });
  fs.writeFileSync(path.join(box, 'home/routes.json'), JSON.stringify({ 'wizard-chatgpt': { view: '/wizard-chatgpt/' }, 'wizard-claude': { view: '/wizard-claude/' } }));
  const APPS = { chatgpt: { id: 'wizard-chatgpt', repo: 'oscarhenrycollins/chatgpt-connection', root: process.env.QA_CHATGPT_ROOT, provides: 'ai-connection' },
    claude: { id: 'wizard-claude', repo: 'oscarhenrycollins/claude-connection', root: process.env.QA_CLAUDE_ROOT, provides: 'claude-subscription' } };
  for (const [k, a] of Object.entries(APPS)) wam('install', a.id, '--repo', a.repo, '--port', String(ports[k]), '--provides', a.provides, '--wizard-md', path.join(a.root, 'wizard.md'), '--listener-auth');
  const declared = id => appsJson().apps.find(a => a.id === id).browser;
  if (!BASELINE) {
    check(JSON.stringify(declared('wizard-chatgpt').contract.navigation) === JSON.stringify([{ id: 'signin', url: DEVICE_URL, query: [] }]), 'WAM: ChatGPT installed contract = its wizard.md (4 account ops, one sign-in page)');
    check(declared('wizard-claude').contract.operations.length === 10 && declared('wizard-claude').contract.navigation[0].url === 'https://claude.ai/oauth/authorize', 'WAM: Claude installed contract = its wizard.md (10 ops, PKCE authorize page)');
    wam('grant', 'wizard-chatgpt', ...declared('wizard-chatgpt').contract.operations);
    wam('grant', 'wizard-claude', ...declared('wizard-claude').contract.operations);
    check(['wizard-chatgpt', 'wizard-claude'].every(id => declared(id).admissible && declared(id).listener_credential?.state === 'written'), 'WAM: both granted for this installation; listener credentials written');
  }
  const envOf = id => Object.fromEntries(fs.readFileSync(path.join(box, `runtipi/user-config/wizardapps/${id}/app.env`), 'utf8').trim().split('\n').map(l => l.split(/=(.*)/s).slice(0, 2)));
  // ---- The REAL engines (store image sources) over the stub dashboard, and the apps' REAL fronts, gate on. ----
  const store = path.resolve(process.env.QA_STORE_ROOT), work = path.join(out, 'engine-work');
  fs.mkdirSync(work, { recursive: true });
  const fake = fakeClaude(work);
  for (const d of ['claude-dir', 'claude-work']) fs.mkdirSync(path.join(work, d), { recursive: true, mode: 0o700 });
  const logs = {};
  const run = (name, args, cwd, env) => {
    const p = spawn(process.env.QA_PYTHON, args, { cwd, env: { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: '1', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    logs[name] = ''; p.stdout.on('data', b => { logs[name] += b; }); p.stderr.on('data', b => { logs[name] += b; }); children.push(p); return p;
  };
  for (const k of ['chatgpt', 'claude']) {
    const P = k.toUpperCase();
    run(k + '-engine', ['pool_server.py'], path.join(store, 'images/wizard-' + k), { WIZARD_POOL_PROVIDER: k, WIZARD_POOL_BIND: '127.0.0.1', WIZARD_POOL_PORT: String(engines[k]),
      [`WIZARD_${P}_PORT`]: String(engines[k]), [`WIZARD_${P}_HERMES_URL`]: `http://127.0.0.1:${hermesPort}`, [`WIZARD_${P}_HERMES_PASSWORD`]: 'synthetic-dashboard-password', [`WIZARD_${P}_HERMES_USER`]: 'hermes',
      ...(k === 'claude' ? { WIZARD_CLAUDE_CLAUDE: fake, WIZARD_CLAUDE_CLAUDE_DIR: path.join(work, 'claude-dir'), WIZARD_CLAUDE_WORK_DIR: path.join(work, 'claude-work') } : {}) });
    const a = APPS[k], env = envOf(a.id);
    const compose = fs.readFileSync(path.join(a.root, 'runtipi/docker-compose.yml'), 'utf8');
    const guarded = (/WIZARD_GUARDED_PATHS: (\S+)/.exec(compose) || [])[1] || '';
    const frontFile = path.join(out, k + '-front.py');
    fs.writeFileSync(frontFile, ['front.py', 'tools.py'].map(f => fs.readFileSync(path.join(a.root, 'mcp', f), 'utf8')).join('\n\n') + '\n\nif __name__ == "__main__":\n    asyncio.run(main())\n');
    run(k + '-front', [frontFile], out, { WIZARD_APP: a.id, FRONT_PORT: String(ports[k]), UPSTREAM_HOST: '127.0.0.1', UPSTREAM_PORT: String(engines[k]),
      ...(guarded ? { WIZARD_BROWSER_BOUNDARY: env.WIZARD_BROWSER_BOUNDARY || '0', WIZARD_APP_CREDENTIAL: env.WIZARD_APP_CREDENTIAL || '', WIZARD_GUARDED_PATHS: guarded } : {}) });
    report[k + 'Gate'] = guarded ? { on: env.WIZARD_BROWSER_BOUNDARY === '1', guarded } : { on: false, note: 'this app checkout has no listener gate' };
  }
  for (const k of ['chatgpt', 'claude']) for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://127.0.0.1:${ports[k]}/health`)).ok) break; } catch (_) {} await sleep(100); }
  // ---- Agent Service (production WAM resolver). ----
  const { createWizardServer } = await import(pathToFileURL(path.join(process.env.QA_SERVICE_ROOT, 'server/service.mjs')));
  const { createHermesFixture } = await import(pathToFileURL(path.join(process.env.QA_SERVICE_ROOT, 'server/fixture.mjs')));
  const hfix = createHermesFixture({ expectedKey: 'boundary-fixture-only' }); const hp = await listen(hfix);
  const svcHome = path.join(out, 'service-home'); fs.mkdirSync(svcHome, { recursive: true });
  const service = createWizardServer({ upstreamOrigin: `http://127.0.0.1:${hp}`, hermesKey: 'boundary-fixture-only', requireAccess: false, ownerProof,
    browserBoundary: { enabled: true, token }, hermesHome: path.join(svcHome, 'hermes'), wizardOsHome: path.join(box, 'home'),
    appsJsonPath: path.join(box, 'home/apps.json'), settingsPath: path.join(svcHome, 'settings.json'), launcherPath: path.join(svcHome, 'launcher.json'),
    agentBridge: false, followThrough: false, joinedDelegation: 'off', browserAdapterWam: { receiptsPath: path.join(out, 'service-state/receipts.json') } });
  const trace = []; report.serviceTrace = trace;
  const sp = await listen(service);
  // ---- nginx stand-in: shell document (template headers + token), /wizard-*/ -> that app's front (prefix stripped). ----
  const tpl = fs.readFileSync(path.join(root, 'packaging/browser-boundary-document.conf.template'), 'utf8');
  const docHeaders = [...tpl.matchAll(/add_header ([A-Za-z-]+) "([^"]*)" always;/g)].map(m => [m[1], m[2]]);
  const inject = tpl.match(/sub_filter '<head>' '([^']*)';/)[1].replace('${WIZARD_SHELL_TOKEN}', token);
  const serveFile = (res, file) => { if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }); res.end(fs.readFileSync(file)); };
  const proxy = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'), p = u.pathname;
    const doc = p.match(/^\/(?:wizard-os-home|wizard-ux)\/(|index\.html|desktop\.html)$/);
    if (doc) {
      if (req.headers['sec-fetch-dest'] !== 'document' || req.headers['sec-fetch-mode'] !== 'navigate' || req.method !== 'GET') { res.writeHead(403); return res.end(); }
      const html = fs.readFileSync(path.join(web, doc[1] || 'index.html'), 'utf8').replace('<head>', '<head>' + inject);
      res.writeHead(200, { 'Content-Type': 'text/html', ...Object.fromEntries(docHeaders) }); return res.end(html);
    }
    if (p.startsWith('/wizard-os-home/')) return serveFile(res, path.join(web, path.normalize(p.slice('/wizard-os-home/'.length)).replace(/^(\.\.[/\\])+/, '')));
    const app = /^\/wizard-(chatgpt|claude)(\/.*)?$/.exec(p);
    if (app) {
      // Tailscale Serve strips the app path and keeps Host; here the stand-in does the same and records the requester.
      const rec = { app: app[1], method: req.method, path: app[2] || '/', site: req.headers['sec-fetch-site'] || '', dest: req.headers['sec-fetch-dest'] || '', origin: req.headers.origin || '' }; report.appRequests.push(rec);
      if (!app[2]) { res.writeHead(308, { location: p + '/' }); return res.end(); }
      const up = http.request({ host: '127.0.0.1', port: ports[app[1]], method: req.method, path: app[2] + u.search, headers: req.headers }, r => { rec.status = r.statusCode; res.writeHead(r.statusCode, r.headers); r.pipe(res); });
      up.on('error', () => { res.writeHead(502); res.end(); }); return req.pipe(up);
    }
    if (p.startsWith('/wizard/')) {
      // Buffer, record (operation/kind, status, shell token present, Origin), then forward unchanged.
      const parts = []; req.on('data', c => parts.push(c));
      req.on('end', () => {
        const b = Buffer.concat(parts); let op = ''; try { const j = JSON.parse(b.toString()); op = j.operation || j.kind || ''; } catch (_) {}
        const rec = { method: req.method, path: p, op, origin: req.headers.origin || '', hasShellToken: typeof req.headers['x-wizard-shell-token'] === 'string' };
        if (p.startsWith('/wizard/v1/browser-adapters/')) trace.push(rec);
        const up = http.request({ host: '127.0.0.1', port: sp, method: req.method, path: req.url, headers: { ...req.headers, 'x-wizard-owner-proof': ownerProof } }, r => { rec.status = r.statusCode; res.writeHead(r.statusCode, r.headers); r.pipe(res); });
        up.on('error', () => { res.writeHead(502); res.end(); }); up.end(b);
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  const np = await listen(proxy);
  const fromFrame = r => r.site === 'cross-site' || r.origin === 'null';
  let browser, page, context;
  try {
    // Provider hosts never resolve: a sign-in tab is recorded, not sent to OpenAI/Anthropic.
    browser = await chromium.launch({ headless: true, args: ['--host-resolver-rules=MAP auth.openai.com 127.0.0.1:9, MAP claude.ai 127.0.0.1:9, MAP claude.com 127.0.0.1:9, MAP *.anthropic.com 127.0.0.1:9, MAP *.openai.com 127.0.0.1:9'], ...(process.env.QA_CHROME ? { executablePath: process.env.QA_CHROME } : {}) });
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    context.on('page', p => { if (p === page) return; const rec = { url: '', referer: null }; report.popups.push(rec); p.on('request', r => { if (/^https:/.test(r.url()) && !rec.url) { rec.url = r.url(); rec.referer = r.headers().referer ?? null; } }); });
    page = await context.newPage(); page.on('pageerror', e => report.errors.push('page: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') report.errors.push('console: ' + m.text().slice(0, 1500)); });
    // This run moves one window through many flows; a late first workspace pull from the (empty) fixture box would
    // replace the desk mid-flow. Workspace sync is not under test here: keep it off for this device.
    await page.addInitScript(() => { try { localStorage.setItem('wos.wsync.off', 'true'); } catch (_) {} });
    await require('./qa-browser-onboarding.cjs')(page, token, report);
    await page.goto(`http://127.0.0.1:${np}/wizard-os-home/desktop.html`);
    await page.waitForFunction(() => window.WizBrowserBoundary?.enabled && window.wizardUX, { timeout: 20000 });
    const setSkin = async skin => { await page.evaluate(s => { WosSkin.set(s); WizAppearance.sync(); }, skin); await sleep(700); };
    const shot = async name => { const f = path.join(out, name + '.png'); await page.screenshot({ path: f }); report.screenshots.push(f); return f; };
    const open = async (id, ready = () => document.querySelector('#accounts')?.children.length > 0 || !document.querySelector('#problem')?.hidden) => {
      await page.evaluate(p => dispatchEvent(new CustomEvent('wizard:open', { detail: { path: p } })), `/${id}/`);
      const f = await appFrame(page, `/${id}/`);
      await f.waitForFunction(ready, null, { timeout: 20000 }).catch(() => {});
      return f;
    };
    const frameFor = id => appFrame(page, `/${id}/`);
    const sandbox = id => page.locator(`iframe[src*="/${id}/"]`).getAttribute('sandbox');
    // Review budget: 3 a minute per app (shell + Service). Space the flows instead of tripping the limit.
    const budget = { 'wizard-chatgpt': [], 'wizard-claude': [] };
    const spend = async id => { const t = Date.now(), b = budget[id].filter(x => x > t - 61000); budget[id] = b; if (b.length >= 3) { const wait = b[0] + 61500 - t; report.intents.push({ app: id, waitedMs: wait }); await sleep(wait); } budget[id].push(Date.now()); };
    const chip = id => page.locator(`.wz-intent-chip[data-wz-intent="${id}"]`);
    const dialog = () => page.locator('dialog.wz-intent[open]');
    const confirmsSoFar = () => trace.filter(r => r.path === '/wizard/v1/browser-adapters/intents/confirm').length;
    // Opens the queued review from the shell chip and confirms with a trusted pointer press after the 500 ms wake.
    const review = async (id, opts = {}) => {
      const { early = false, keyboard = false, cancel = false } = opts;
      await chip(id).waitFor({ state: 'visible', timeout: 15000 });
      const rec = { app: id, chipText: await chip(id).textContent() };
      check(!(await dialog().count()), `${id}: the request only queued a Review chip in the window bar; no dialog opened by itself`);
      await page.evaluate(i => document.querySelector(`.wz-intent-chip[data-wz-intent="${i}"]`).click(), id);   // synthetic: ignored
      await sleep(150);
      check(!(await dialog().count()), `${id}: a synthetic click on the shell chip opens nothing`);
      await chip(id).click();
      await dialog().waitFor({ state: 'visible' });
      rec.title = await dialog().locator('h2').textContent(); rec.detail = await dialog().locator('p').first().textContent();
      rec.host = await dialog().locator('.wzi-host').count() ? await dialog().locator('.wzi-host').textContent() : null;
      if (opts.shotName) await shot(opts.shotName);
      const before = confirmsSoFar();
      if (early) {
        await dialog().locator('.wzi-go').click({ force: true });   // inside 500 ms
        await page.evaluate(() => { const b = document.querySelector('dialog.wz-intent .wzi-go'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true })); b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, isPrimary: true })); b.click(); });
        await sleep(100);
        check(confirmsSoFar() === before, `${id}: a press inside the 500 ms wake and synthetic pointer/click events confirm nothing`);
      }
      await sleep(650);
      if (cancel) { await dialog().locator('.wzi-no').click(); rec.result = 'cancelled'; report.intents.push(rec); return rec; }
      if (keyboard) { await dialog().locator('.wzi-go').focus(); await page.keyboard.press('Enter'); rec.activation = 'keyboard'; }
      else { await dialog().locator('.wzi-go').click(); rec.activation = 'pointer'; }
      await page.waitForFunction(n => [...document.querySelectorAll('dialog.wz-intent[open]')].length === 0 || n, null).catch(() => {});
      for (let i = 0; i < 50 && confirmsSoFar() === before; i++) await sleep(100);
      rec.confirmCalls = confirmsSoFar() - before;
      report.intents.push(rec);
      return rec;
    };
    if (BASELINE) {
      // ---- Unmigrated pages in the same frame: record what breaks. ----
      await setSkin('nebula');
      let f = await open('wizard-chatgpt'); await sleep(2500);
      report.baselineChatgpt = await f.evaluate(() => ({ rows: document.querySelectorAll('#accounts > li').length, message: document.querySelector('#message')?.textContent, problem: !document.querySelector('#problem')?.hidden && document.querySelector('#problem-text')?.textContent, add: !document.querySelector('#add')?.hidden }));
      report.baselineSandbox = await sandbox('wizard-chatgpt');
      await shot('baseline-chatgpt-opaque-nebula');
      f = await open('wizard-claude'); await sleep(1500);
      await f.evaluate(() => { location.href = 'claude-code/'; }); await sleep(2500);
      f = await page.locator('iframe[src*="/wizard-claude/"]').elementHandle().then(h => h.contentFrame());
      report.baselineClaudeCode = await f.evaluate(() => ({ list: document.querySelector('#accounts')?.textContent?.trim().slice(0, 120), confirm: (() => { try { return confirm('x'); } catch (e) { return 'threw ' + e.name; } })(), open: (() => { try { return window.open('https://claude.ai/oauth/authorize') === null ? 'blocked (null)' : 'opened'; } catch (e) { return 'threw ' + e.name; } })() }));
      await shot('baseline-claude-code-opaque-nebula');
      report.baselineAppRequests = report.appRequests.filter(r => fromFrame(r) && r.path.includes('/api/')).map(r => `${r.method} ${r.app}${r.path} -> ${r.status}`);
      fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2));
      console.log(JSON.stringify({ baseline: true, chatgpt: report.baselineChatgpt, claudeCode: report.baselineClaudeCode, requests: report.baselineAppRequests, screenshots: report.screenshots }, null, 2));
      return;
    }
    // ================= ChatGPT on Nebula =================
    await setSkin('nebula');
    let cg = await open('wizard-chatgpt', () => document.querySelectorAll('#accounts > li').length === 2);
    check(await sandbox('wizard-chatgpt') === 'allow-scripts allow-forms allow-downloads', 'ChatGPT: the real accounts page is an opaque sandboxed frame (no modals, no popups, no same-origin)');
    check(await cg.evaluate(() => globalThis.origin === 'null' && document.querySelectorAll('#accounts > li').length === 2 && document.querySelector('#conn-pill').textContent === 'Connected'), 'ChatGPT: both synthetic accounts render with usage meters; pill Connected');
    check(await cg.evaluate(() => document.documentElement.dataset.skin === 'nebula' && !!getComputedStyle(document.documentElement).getPropertyValue('--wz-accent').trim()), 'ChatGPT: the page follows the shell skin over Appearance v1 (data-skin nebula, --wz-* tokens)');
    check(trace.some(r => r.path === '/wizard/v1/browser-adapters/call' && r.op === 'ai_accounts.inventory' && r.status === 200 && r.hasShellToken), 'inventory read through the shell\'s possession-bound adapter call (ai_accounts.inventory)');
    check(report.appRequests.filter(r => r.app === 'chatgpt' && fromFrame(r) && r.path.startsWith('/api/')).length === 0, 'the migrated page never asked its own api/ from the frame');
    await shot('chatgpt-nebula-accounts');
    // -- Add account: device code + Wizard-opened sign-in page --
    await cg.locator('#add').click();
    await spend('wizard-chatgpt');
    await cg.locator('#go').click();
    const addPostsBefore = hermes.state.jobs.size;
    const r1 = await review('wizard-chatgpt', { early: true });
    check(/Connect a ChatGPT account/.test(r1.title) && r1.confirmCalls === 1, 'Add: Wizard\'s own dialog showed the Service summary (Connect a ChatGPT account) and one trusted press confirmed it');
    await cg.waitForFunction(() => document.querySelector('#user-code')?.textContent === 'SYNT-4821' && !document.querySelector('#signin-step').hidden, null, { timeout: 15000 });
    check(hermes.state.jobs.size === addPostsBefore + 1 && report.hermes.filter(h => h.body?.action === 'add').every(h => h.body.confirmed === true), 'Add: exactly one add reached the agent broker, with confirmed:true set by the Service after consumption');
    check(await cg.evaluate(() => document.querySelector('#signin').getAttribute('href') === '#'), 'Add: the frame holds no sign-in URL (link href is #)');
    await shot('chatgpt-nebula-device-code');
    await spend('wizard-chatgpt');
    await cg.locator('#signin').click();
    const r2 = await review('wizard-chatgpt');
    await sleep(800);
    const pop1 = report.popups.at(-1);
    check(r2.host === 'https://auth.openai.com/codex/device' && pop1?.url === DEVICE_URL && pop1.referer === null, 'Sign-in: Wizard showed auth.openai.com/codex/device and opened exactly that page in a new tab, with no Referer');
    hermes.state.approve.add([...hermes.state.jobs.values()].at(-1).id);
    await cg.waitForFunction(() => /Connected/.test(document.querySelector('#dlg-status')?.textContent || ''), null, { timeout: 20000 });
    await cg.locator('#close').click();
    await cg.waitForFunction(() => document.querySelectorAll('#accounts > li').length === 3, null, { timeout: 15000 });
    check(true, 'Add: the approved sign-in shows Connected and a third account (multiple accounts)');
    // -- Reconnect (renewal) on the expired account --
    await cg.locator('[data-reconnect]').first().click();
    await spend('wizard-chatgpt');
    await cg.locator('#go').click();
    const r3 = await review('wizard-chatgpt', { keyboard: true });
    check(/Reconnect/.test(r3.title) && r3.confirmCalls === 1, 'Reconnect: confirmed with a keyboard activation inside Wizard\'s dialog');
    await cg.waitForFunction(() => !document.querySelector('#signin-step').hidden, null, { timeout: 15000 });
    hermes.state.approve.add([...hermes.state.jobs.values()].at(-1).id);
    await cg.waitForFunction(() => /Connected/.test(document.querySelector('#dlg-status')?.textContent || ''), null, { timeout: 20000 });
    await cg.locator('#close').click();
    await cg.waitForFunction(() => !document.querySelector('[data-reconnect]'), null, { timeout: 15000 });
    check(hermes.state.chatgpt.find(a => a.id === 'cg-b').status === 'ready', 'Reconnect: the expired account is ready again (renewal)');
    // -- Use first (prefer) and Remove (Disconnect), with a cancelled review first --
    await cg.locator('li[data-account-id="cg-b"] .wz-row').click(); await cg.locator('#prefer').click();
    await spend('wizard-chatgpt');
    await cg.locator('#go').click();
    const r4 = await review('wizard-chatgpt');
    await cg.waitForFunction(() => /uses this account first/.test(document.querySelector('#dlg-status')?.textContent || ''), null, { timeout: 15000 });
    check(/Use .* first/.test(r4.title) && hermes.state.chatgpt.find(a => a.id === 'cg-b').preferred, 'Use first: confirmed in Wizard; the agent now tries that account first');
    await cg.locator('#close').click();
    await shot('chatgpt-nebula-after-use-first');
    await cg.locator('li[data-account-id="cg-a"] .wz-row').click();
    await cg.locator('#grants button.danger').click();
    await spend('wizard-chatgpt');
    await cg.locator('#go').click();
    const removesBefore = report.hermes.filter(h => h.body?.action === 'remove').length;
    await chip('wizard-chatgpt').waitFor({ state: 'visible' }); await chip('wizard-chatgpt').click(); await dialog().waitFor({ state: 'visible' });
    check(await dialog().locator('.wzi-go.danger').count() === 1 && /Remove this sign-in/.test(await dialog().locator('h2').textContent()), 'Remove: Wizard\'s dialog is the danger variant naming the sign-in');
    await shot('chatgpt-nebula-review-remove');
    await sleep(600); await dialog().locator('.wzi-no').click();
    await cg.waitForFunction(() => /Nothing changed/.test(document.querySelector('#dlg-status')?.textContent || ''), null, { timeout: 10000 });
    check(report.hermes.filter(h => h.body?.action === 'remove').length === removesBefore && hermes.state.chatgpt.some(a => a.id === 'cg-a'), 'Remove: Cancel in Wizard\'s dialog changes nothing (no remove reached the agent)');
    await spend('wizard-chatgpt');
    await cg.locator('#go').click();
    await review('wizard-chatgpt');
    await cg.waitForFunction(() => /Removed/.test(document.querySelector('#dlg-status')?.textContent || ''), null, { timeout: 15000 });
    check(!hermes.state.chatgpt.some(a => a.id === 'cg-a') && report.hermes.filter(h => h.body?.action === 'remove').length === removesBefore + 1, 'Remove (Disconnect): confirmed once, exactly one remove reached the agent');
    await cg.locator('#close').click();
    // -- Hostile: what the frame can do on its own --
    await spend('wizard-chatgpt');
    const hostile = await cg.evaluate(async () => {
      const r = {};
      try { const x = await fetch('api/accounts'); r.fetchAccounts = x.status; } catch (_) { r.fetchAccounts = 'blocked'; }
      try { const x = await fetch('api/operations', { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'remove', target: 'cred-cg-b', confirmed: true }) }); r.simplePost = x.type; } catch (_) { r.simplePost = 'blocked'; }
      try { await WizardApp.data.call({ operation: 'ai_accounts.change', args: { action: 'remove', target: 'cred-cg-b' }, operationKey: crypto.randomUUID() }); r.dataChange = 'ALLOWED'; } catch (e) { r.dataChange = e.code; }
      try { await WizardApp.intent.confirm({ operation: 'ai_accounts.change', args: { action: 'remove', target: 'cred-cg-b' }, operationKey: crypto.randomUUID(), confirmed: true }); r.confirmedTrue = 'ALLOWED'; } catch (e) { r.confirmedTrue = e.code; }
      try { await WizardApp.intent.open({ target: 'signin', ref: 'ai:' + 'x'.repeat(24) }); r.openUnknown = 'ALLOWED'; } catch (e) { r.openUnknown = e.code; }
      try { await WizardApp.intent.open({ url: 'https://evil.example/' }); r.openUrl = 'ALLOWED'; } catch (e) { r.openUrl = e.code; }
      r.popup = (() => { try { return window.open('https://evil.example/') === null ? 'null' : 'opened'; } catch (e) { return 'threw'; } })();
      r.confirm = (() => { try { return String(confirm('x')); } catch (e) { return 'threw'; } })();
      return r;
    });
    report.hostile = hostile;
    await sleep(400);
    const frameApi = report.appRequests.filter(r => r.app === 'chatgpt' && fromFrame(r) && r.path.startsWith('/api/'));
    report.hostileAppRequests = frameApi;
    check(frameApi.length >= 2 && frameApi.every(r => r.status === 403), `server-side: the frame's ${frameApi.length} direct requests to its own api/ (GET + a simple no-cors POST with confirmed:true) were refused 403 by the app's listener gate`);
    check(hostile.dataChange === 'not_allowed' && hostile.confirmedTrue === 'bad_request' && hostile.openUnknown === 'not_found' && hostile.openUrl === 'bad_request', 'frame: an account change as data.call (not_allowed), confirmed:true (bad_request), an unknown sign-in ref (not_found) and a raw URL (bad_request) are all refused');
    check(hostile.popup === 'null' && hostile.confirm === 'false', 'frame: window.open and confirm() stay blocked (no allow-popups / allow-modals added)');
    check(hermes.state.chatgpt.some(a => a.id === 'cg-b'), 'no hostile attempt removed an account');
    // ---- Landscapes Light and dark, same page ----
    await setSkin('landscapes-light');
    cg = await frameFor('wizard-chatgpt');
    report.landscapesLight = await cg.evaluate(() => ({ skin: document.documentElement.dataset.skin, scheme: document.documentElement.dataset.colorScheme }));
    await shot('chatgpt-landscapes-light-accounts');
    // ================= Claude on Grove =================
    await setSkin('grove');
    let cl = await open('wizard-claude', () => document.querySelectorAll('#accounts > li').length >= 1);
    check(await cl.evaluate(() => globalThis.origin === 'null' && document.documentElement.dataset.skin === 'grove' && document.querySelectorAll('#accounts > li').length === 1), 'Claude (Grove): the accounts page renders in the opaque frame and follows the skin');
    await cl.locator('#add').click();
    await spend('wizard-claude');
    await cl.locator('#go').click();
    await review('wizard-claude');
    await cl.waitForFunction(() => !document.querySelector('#paste-step').hidden && !document.querySelector('#signin-step').hidden, null, { timeout: 15000 });
    await spend('wizard-claude');
    await cl.locator('#signin').click();
    const c2 = await review('wizard-claude');
    await sleep(800);
    const pop2 = report.popups.at(-1);
    check(c2.host === 'https://claude.ai/oauth/authorize' && pop2?.url === CLAUDE_URL && pop2.referer === null, 'Claude sign-in: Wizard opened exactly the PKCE authorize page from the contract (query from the agent, no Referer)');
    await shot('claude-grove-paste-code');
    await cl.locator('#code').fill('synthetic' + crypto.randomBytes(6).toString('hex') + '#' + crypto.randomBytes(4).toString('hex'));
    await cl.locator('#submit-code').click();
    await cl.waitForFunction(() => /Connected/.test(document.querySelector('#dlg-status')?.textContent || ''), null, { timeout: 20000 });
    await cl.locator('#close').click();
    await cl.waitForFunction(() => document.querySelectorAll('#accounts > li').length === 2, null, { timeout: 15000 });
    check(!fs.readFileSync(path.join(out, 'service-state/receipts.json'), 'utf8').includes('#'), 'Claude: the pasted code reached the broker once and is not kept in the Service receipts');
    await shot('claude-grove-accounts');
    // -- The original Claude Code page: Connect (owner-confirmed), Wizard-opened link, code, Test, Disconnect --
    await cl.evaluate(() => { location.href = 'claude-code/'; });
    await sleep(800);
    cl = await page.locator('iframe[src*="/wizard-claude/"]').elementHandle().then(h => h.contentFrame());
    await cl.waitForFunction(() => /claude-code\/$/.test(location.pathname) && /Not connected/.test(document.querySelector('#accounts')?.textContent || ''), null, { timeout: 20000 });
    check(true, 'Claude Code page: status read through claude_code.status (Not connected)');
    await spend('wizard-claude');
    await cl.locator('#accounts button.primary').first().click();   // Connect
    const c3 = await review('wizard-claude', { shotName: 'claude-code-grove-review-connect' });
    check(c3.title === 'Connect Claude', 'Claude Code: Connect needs the owner in Wizard\'s dialog');
    await cl.waitForFunction(() => !document.querySelector('#login').hidden, null, { timeout: 60000 });
    await spend('wizard-claude');
    await cl.locator('#login-url').click();
    await review('wizard-claude');
    await sleep(800);
    check(report.popups.at(-1)?.url === CLAUDE_URL, 'Claude Code: the sign-in link opens only through Wizard (the official CLI\'s authorize page)');
    await cl.locator('#code').fill('synthetic-code#synthetic-state');
    await cl.locator('#code-form button[type=submit]').click();
    await cl.waitForFunction(() => /Connected/.test(document.querySelector('#message')?.textContent || '') && /Connected as/.test(document.querySelector('#accounts')?.textContent || ''), null, { timeout: 30000 });
    check(true, 'Claude Code: the pasted code connects (claude_code.code); the row shows Connected as Max 5x');
    await cl.locator('#accounts button.primary').first().click();   // Test
    await cl.waitForFunction(() => /OK: Claude answered/.test(document.querySelector('#message')?.textContent || ''), null, { timeout: 30000 });
    check(true, 'Claude Code: Test (connection test) answers through claude_code.test');
    await shot('claude-code-grove-connected');
    await spend('wizard-claude');
    await cl.locator('#accounts .buttons button:not(.primary)').first().click();   // Disconnect
    const c5 = await review('wizard-claude');
    check(c5.title === 'Disconnect Claude?', 'Claude Code: Disconnect is confirmed in Wizard\'s dialog, not confirm()');
    await cl.waitForFunction(() => /Disconnected/.test(document.querySelector('#message')?.textContent || ''), null, { timeout: 30000 });
    check(true, 'Claude Code: Disconnected');
    // ---- Rate limit (3 a minute per app), from the frame. ----
    await sleep(Math.max(0, (budget['wizard-chatgpt'].at(-1) || 0) + 61500 - Date.now()));
    cg = await open('wizard-chatgpt', () => document.querySelectorAll('#accounts > li').length >= 1);
    const burst = [];
    for (let i = 0; i < 4; i++) {
      await cg.evaluate(() => { window.__qaIntent = WizardApp.intent.confirm({ operation: 'ai_accounts.change', args: { action: 'add', target: null }, operationKey: crypto.randomUUID() }).then(() => 'confirmed', e => e.code); });
      const queued = await chip('wizard-chatgpt').waitFor({ state: 'visible', timeout: 2500 }).then(() => true, () => false);
      if (queued) { await chip('wizard-chatgpt').click(); await dialog().waitFor({ state: 'visible' }); await sleep(600); await dialog().locator('.wzi-no').click(); }
      burst.push(await cg.evaluate(() => window.__qaIntent));
    }
    report.burst = burst; budget['wizard-chatgpt'].push(Date.now());
    check(JSON.stringify(burst) === JSON.stringify(['cancelled', 'cancelled', 'cancelled', 'rate_limited']), `review requests: three queued and cancelled in Wizard, the fourth in the same minute refused (${burst.join(', ')})`);
    // ---- WAM revoke of ai_accounts.change: the open binding stops; a fresh one reads but cannot queue a change. ----
    wam('revoke', 'wizard-chatgpt', 'ai_accounts.change');
    const afterRevoke = await cg.evaluate(async () => { try { await WizardApp.data.call({ operation: 'ai_accounts.inventory', args: {} }); return 'ALLOWED'; } catch (e) { return e.code; } });
    check(afterRevoke === 'revoked', 'after a WAM revoke the open binding refuses even reads (revoked)');
    cg = await open('wizard-chatgpt');
    await page.evaluate(() => { const f = document.querySelector('iframe[src*="/wizard-chatgpt/"]'); f.src = f.src; });
    cg = await frameFor('wizard-chatgpt');
    await cg.waitForFunction(() => document.querySelectorAll('#accounts > li').length >= 1, null, { timeout: 20000 });
    await sleep(Math.max(0, (budget['wizard-chatgpt'].at(-1) || 0) + 61500 - Date.now()));
    const fresh = await cg.evaluate(async () => { try { await WizardApp.intent.confirm({ operation: 'ai_accounts.change', args: { action: 'add', target: null }, operationKey: crypto.randomUUID() }); return 'ALLOWED'; } catch (e) { return e.code; } });
    report.freshAfterRevoke = fresh;
    check(fresh === 'not_allowed', 'fresh binding without the grant: accounts still read, an account change cannot even be queued (not_allowed)');
    // ---- Dark standalone: the page in its own tab (no Wizard around it). ----
    const tab = await context.newPage();
    await tab.emulateMedia({ colorScheme: 'dark' });
    await tab.goto(`http://127.0.0.1:${np}/wizard-chatgpt/`);
    await tab.waitForFunction(() => document.querySelector('#message')?.textContent, null, { timeout: 15000 });
    report.standalone = await tab.evaluate(() => ({ message: document.querySelector('#message').textContent, scheme: getComputedStyle(document.documentElement).colorScheme }));
    const sa = report.appRequests.filter(r => r.app === 'chatgpt' && r.path === '/api/accounts' && r.site === 'same-origin');
    check(/Open this app from Wizard/.test(report.standalone.message) && sa.length >= 1 && sa.every(r => r.status === 403), 'dark standalone tab: its own api/accounts is refused by the gate (403) and the page says to open it from Wizard');
    const f = path.join(out, 'chatgpt-standalone-dark.png'); await tab.screenshot({ path: f }); report.screenshots.push(f);
    await tab.close();
    check(trace.filter(r => r.path.startsWith('/wizard/v1/browser-adapters/intents')).every(r => r.hasShellToken && r.origin === `http://127.0.0.1:${np}`), 'every intent request reached the Service from the shell document (its own origin + token), never from a frame (Origin null)');
    report.logsTail = Object.fromEntries(Object.entries(logs).map(([k, v]) => [k, v.slice(-800)]));
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: true, checks: report.checks.length, open: report.open, screenshots: report.screenshots, errors: report.errors.length, burst: report.burst }, null, 2));
  } catch (error) {
    report.failure = error.stack; report.logsTail = Object.fromEntries(Object.entries(logs).map(([k, v]) => [k, v.slice(-2000)]));
    try { const s = path.join(out, 'failure.png'); await page?.screenshot({ path: s }); report.failureShot = s; } catch (_) {}
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2));
    throw error;
  } finally {
    await browser?.close().catch(() => {});
    for (const c of children) c.kill();
    for (const s of [proxy, service, hfix, hermes.server]) await close(s).catch(() => {});
  }
})().catch(e => { console.error(e); process.exit(1); });
