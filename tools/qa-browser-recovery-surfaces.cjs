// Recovery surfaces under the browser boundary (wizard-os #385/#386, spec #398 §6, census rows "troubleshooter" and
// "secret-drop"), in real Chromium:
//  1. The shell model picker reads Claude accounts through ONE shell-owned typed Service operation (the Claude app's
//     own listener answers only the adapter): REAL Claude front (gate on, WAM-written env) + REAL engine (store
//     images/wizard-claude pool_server.py) over a stub Hermes dashboard, REAL Agent Service, REAL WAM state.
//  2. The Troubleshooter (REAL server.mjs, hermetic host config, fake Claude CLI) inside a Wizard window: opaque frame,
//     recovery-scoped typed operations run by the shell with the DISTINCT recovery token; still working with the
//     Agent Service stopped; its own tab (dark) carries the token only in a non-framable, opener-cut navigation.
//  3. Secret Drop (REAL relay server.py + REAL MCP front, gate on) on its own non-owner origin over plain HTTP
//     (an insecure context, as on a box): one-use link, browser HPKE seal, agent pickup + decrypt with client.py,
//     no framing, and the agent side refusing browsers server-side.
// Hostile probes run in a separate browser context with NO request interception (Playwright routes skip preflights).
// A Node stand-in replaces nginx (shell document template + /troubleshoot/ like Caddy's X-Private-Peer); say so.
// Env: QA_OUT, QA_SERVICE_ROOT, QA_WAM_ROOT, QA_STORE_ROOT, QA_CLAUDE_ROOT, QA_TROUBLESHOOTER_ROOT, QA_SECRET_DROP_ROOT,
// QA_PYTHON (PyYAML + cryptography), optional QA_PLAYWRIGHT, QA_CHROME, QA_UX_ROOT, QA_BASELINE=1 (unmigrated
// checkouts: record what breaks, no feature checks).
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), net = require('node:net');
const assert = require('node:assert/strict'), { spawn, execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url'), crypto = require('node:crypto');
const appFrame = require('./qa-browser-frame.cjs');
const root = path.resolve(process.env.QA_UX_ROOT || path.join(__dirname, '..')), out = path.resolve(process.env.QA_OUT || '');
const { chromium } = require(path.join(__dirname, 'qa-playwright.cjs'));
for (const k of ['QA_OUT', 'QA_SERVICE_ROOT', 'QA_WAM_ROOT', 'QA_STORE_ROOT', 'QA_CLAUDE_ROOT', 'QA_TROUBLESHOOTER_ROOT', 'QA_SECRET_DROP_ROOT', 'QA_PYTHON']) if (!process.env[k]) throw new Error(k + ' is required');
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
const BASELINE = process.env.QA_BASELINE === '1';
const token = crypto.randomBytes(32).toString('hex'), recoveryToken = crypto.randomBytes(32).toString('hex'), ownerProof = crypto.randomBytes(32).toString('hex');
const web = path.join(root, 'web');
const listen = (server, host = '127.0.0.1') => new Promise(r => server.listen(0, host, () => r(server.address().port)));
const close = s => new Promise(r => { try { s.closeAllConnections?.(); s.close(() => r()); } catch (_) { r(); } });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = async () => { const s = http.createServer(); const p = await listen(s); await close(s); return p; };
const report = { candidate: !BASELINE, baseline: BASELINE, nginxStandIn: 'node', checks: [], open: [], screenshots: [], errors: [], wam: [], trace: [], drop: [], refusals: [] };
const check = (value, name) => { assert.ok(value, name); report.checks.push(name); };
const box = path.join(out, 'box');
const wam = (...args) => { const r = execFileSync(process.env.QA_PYTHON, [path.join(process.env.QA_WAM_ROOT, 'tools/browser_admission_fixture.py'), box, ...args], { encoding: 'utf8' }); report.wam.push(args.join(' ')); return r; };
const appsJson = () => JSON.parse(fs.readFileSync(path.join(box, 'home/apps.json'), 'utf8'));
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const children = [];
const run = (name, cmd, args, opts) => {
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  report.logs ||= {}; report.logs[name] = '';
  const add = b => { report.logs[name] = (report.logs[name] + b).slice(-6000); };
  p.stdout.on('data', add); p.stderr.on('data', add); children.push(p); return p;
};
const waitHttp = async (url, ok = r => r.status < 500) => { for (let i = 0; i < 120; i++) { try { if (ok(await fetch(url))) return true; } catch (_) {} await sleep(100); } throw new Error('not up: ' + url); };
const iso = h => new Date(Date.now() + h * 3600e3).toISOString();

// ---- Stub Hermes dashboard: the Claude account broker (account_lifecycle.py semantics), synthetic accounts only.
function hermesStub(accounts) {
  return http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'), json = (c, b) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
    if (u.pathname === '/auth/password-login') { res.writeHead(200, { 'set-cookie': 'hermes_session=synthetic; Path=/' }); return res.end('{}'); }
    if (u.pathname === '/api/model/info') return json(200, { provider: 'synthetic-qa', model: 'synthetic-model' });
    if (u.pathname === '/api/plugins/wizard-os/provider-accounts/claude') return json(200, { provider: 'claude', owner: 'hermes', accounts, actions: { add: true }, management: { contract: 'wizard.account-management/1', status: 'available' } });
    json(404, { detail: 'not found' });
  });
}

// ---- Whois stub (tailscaled local API): the stand-in front door's peer 100.64.0.7 is the owner.
function whoisStub(sock) {
  const s = http.createServer((req, res) => {
    const a = new URL(req.url, 'http://x').searchParams.get('addr');
    if (a !== '100.64.0.7') { res.writeHead(404); return res.end(); }
    res.end(JSON.stringify({ Node: { User: 7, Tags: [] }, UserProfile: { ID: 7, LoginName: 'owner@example.com' } }));
  });
  return new Promise(r => s.listen(sock, () => r(s)));
}

(async () => {
  const work = path.join(out, 'work'); fs.mkdirSync(work, { recursive: true });
  // ======================= 1. Claude app (real front + engine) under WAM =======================
  const claudePort = await freePort(), enginePort = await freePort();
  const accounts = [{ id: 'cl-a', name: 'synthetic.claude@example.com', source: 'pool', email: 'synthetic.claude@example.com', plan: 'Max 5x', status: 'ready', priority: 0, preferred: true,
    usage: { fetchedAt: new Date().toISOString(), limits: [{ id: 'session:session', label: 'Session (5 h)', usedPercent: 100, remainingPercent: 0, resetsAt: iso(2) }, { id: 'weekly_all:weekly', label: 'Weekly', usedPercent: 64, remainingPercent: 36, resetsAt: iso(70) }] },
    credentials: [{ id: 'cred-cl-a', name: 'Sign-in A', managed: true }], actions: { reconnect: true, remove: true, prefer: true } }];
  const hermes = hermesStub(accounts), hermesPort = await listen(hermes);
  fs.mkdirSync(path.join(box, 'home'), { recursive: true });
  fs.writeFileSync(path.join(box, 'home/routes.json'), JSON.stringify({ 'wizard-claude': { view: '/wizard-claude/' } }));
  wam('install', 'wizard-claude', '--repo', 'oscarhenrycollins/claude-connection', '--port', String(claudePort), '--provides', 'claude-subscription', '--wizard-md', path.join(process.env.QA_CLAUDE_ROOT, 'wizard.md'), '--listener-auth');
  const claudeB = appsJson().apps.find(a => a.id === 'wizard-claude').browser;
  report.claudeInstall = { installation: claudeB.installation_id, credential: claudeB.listener_credential?.state, slot: appsJson().slots?.['claude-subscription']?.default };
  const envOf = id => Object.fromEntries(fs.readFileSync(path.join(box, `runtipi/user-config/wizardapps/${id}/app.env`), 'utf8').trim().split('\n').map(l => l.split(/=(.*)/s).slice(0, 2)));
  const store = path.resolve(process.env.QA_STORE_ROOT);
  for (const d of ['claude-dir', 'claude-work']) fs.mkdirSync(path.join(work, d), { recursive: true, mode: 0o700 });
  run('claude-engine', process.env.QA_PYTHON, ['pool_server.py'], { cwd: path.join(store, 'images/wizard-claude'), env: { PATH: process.env.PATH, PYTHONDONTWRITEBYTECODE: '1', WIZARD_POOL_PROVIDER: 'claude', WIZARD_POOL_BIND: '127.0.0.1', WIZARD_POOL_PORT: String(enginePort),
    WIZARD_CLAUDE_PORT: String(enginePort), WIZARD_CLAUDE_HERMES_URL: `http://127.0.0.1:${hermesPort}`, WIZARD_CLAUDE_HERMES_PASSWORD: 'synthetic-dashboard-password', WIZARD_CLAUDE_HERMES_USER: 'hermes',
    WIZARD_CLAUDE_CLAUDE: '/bin/false', WIZARD_CLAUDE_CLAUDE_DIR: path.join(work, 'claude-dir'), WIZARD_CLAUDE_WORK_DIR: path.join(work, 'claude-work') } });
  const claudeRoot = process.env.QA_CLAUDE_ROOT, cenv = envOf('wizard-claude');
  const compose = fs.readFileSync(path.join(claudeRoot, 'runtipi/docker-compose.yml'), 'utf8');
  const guarded = (/WIZARD_GUARDED_PATHS: (\S+)/.exec(compose) || [])[1] || '';
  const frontFile = path.join(work, 'claude-front.py');
  fs.writeFileSync(frontFile, ['front.py', 'tools.py'].map(f => fs.readFileSync(path.join(claudeRoot, 'mcp', f), 'utf8')).join('\n\n') + '\n\nif __name__ == "__main__":\n    asyncio.run(main())\n');
  run('claude-front', process.env.QA_PYTHON, [frontFile], { cwd: work, env: { PATH: process.env.PATH, WIZARD_APP: 'wizard-claude', FRONT_PORT: String(claudePort), UPSTREAM_HOST: '127.0.0.1', UPSTREAM_PORT: String(enginePort),
    WIZARD_BROWSER_BOUNDARY: cenv.WIZARD_BROWSER_BOUNDARY || '0', WIZARD_APP_CREDENTIAL: cenv.WIZARD_APP_CREDENTIAL || '', WIZARD_GUARDED_PATHS: guarded } });
  report.claudeGate = { on: cenv.WIZARD_BROWSER_BOUNDARY === '1', guarded };
  await waitHttp(`http://127.0.0.1:${claudePort}/health`, r => r.ok);

  // ======================= Agent Service (production WAM resolver) =======================
  const { createWizardServer } = await import(pathToFileURL(path.join(process.env.QA_SERVICE_ROOT, 'server/service.mjs')));
  const { createHermesFixture } = await import(pathToFileURL(path.join(process.env.QA_SERVICE_ROOT, 'server/fixture.mjs')));
  const hfix = createHermesFixture({ expectedKey: 'boundary-fixture-only' }); const hp = await listen(hfix);
  const svcHome = path.join(out, 'service-home'); fs.mkdirSync(svcHome, { recursive: true });
  const service = createWizardServer({ upstreamOrigin: `http://127.0.0.1:${hp}`, hermesKey: 'boundary-fixture-only', requireAccess: false, ownerProof,
    browserBoundary: { enabled: true, token }, hermesHome: path.join(svcHome, 'hermes'), wizardOsHome: path.join(box, 'home'),
    appsJsonPath: path.join(box, 'home/apps.json'), settingsPath: path.join(svcHome, 'settings.json'), launcherPath: path.join(svcHome, 'launcher.json'),
    agentBridge: false, followThrough: false, joinedDelegation: 'off', browserAdapterWam: { receiptsPath: path.join(out, 'service-state/receipts.json') } });
  const sp = await listen(service);
  let serviceUp = true;

  // ======================= 2. Troubleshooter (real server.mjs, hermetic host) =======================
  const tsRoot = path.resolve(process.env.QA_TROUBLESHOOTER_ROOT), tsState = path.join(work, 'ts-state'), tsPort = await freePort();
  fs.mkdirSync(path.join(tsState, 'claude'), { recursive: true });
  fs.writeFileSync(path.join(tsState, 'claude/.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'fixture', refreshToken: 'fixture' } }));
  const recoveryFile = path.join(work, 'recovery.token'); fs.writeFileSync(recoveryFile, recoveryToken + '\n', { mode: 0o600 });
  const fakeDocker = path.join(work, 'fake-docker.sh'); fs.writeFileSync(fakeDocker, `#!/bin/sh\necho "$@" >> ${JSON.stringify(path.join(work, 'docker-calls.log'))}\n[ "$1" = restart ] && echo "$2"\nexit 0\n`, { mode: 0o755 });
  const whoisSock = path.join(work, 'ts.sock'); const whois = await whoisStub(whoisSock);
  // The stand-in front door (below) is this origin; Caddy would set X-Private-Peer from the tailnet connection.
  const np = await freePort(), ORIGIN = `http://127.0.0.1:${np}`;
  const tsEnv = { PATH: process.env.PATH, HOME: tsState, TMPDIR: process.env.TMPDIR || '/tmp', TROUBLESHOOT_STATE: tsState, PORT: String(tsPort), TROUBLESHOOT_FRONT: 'caddy', TS_WHOIS_SOCKET: whoisSock,
    WIZARD_PRIVATE_ORIGINS: ORIGIN, TS_SOCKET: path.join(tsState, 'no.sock'), AGENT_PORT: String(sp), HERMES_PORT: '', SHELL_PORT: String(np), GATEWAY_PORT: '4', AUTH_PORT: '', TAILSCALE_UNIT: '', GATEWAY_UNIT: '',
    SHELL_CONTAINER: 'qa-shell', AGENT_UNIT: '', HERMES_UNIT: '', WAS_RELEASE_ROOT: path.join(tsState, 'no-release'), CLAUDE_CONFIG_DIR: path.join(tsState, 'claude'), CLAUDE_BIN: path.join(tsRoot, 'tests/ui/fake-claude.sh'),
    CLAUDE_AGENT_AUTH_FILE: path.join(tsState, 'no-auth'), CHATGPT_AUTH_FILE: path.join(tsState, 'no-auth'), CODEX_BIN: '/bin/false', CODEX_HOME: path.join(tsState, 'no-codex'), TINFOIL_URL: 'http://127.0.0.1:9',
    TINFOIL_TOKEN_FILE: path.join(tsState, 'no-token'), DOCKER_BIN: fakeDocker, WIZARD_APPS_FILE: path.join(box, 'home/apps.json'),
    ...(BASELINE ? {} : { WIZARD_BROWSER_BOUNDARY: '1', WIZARD_RECOVERY_TOKEN_FILE: recoveryFile }) };
  run('troubleshooter', process.execPath, ['server.mjs'], { cwd: tsRoot, env: tsEnv });
  await waitHttp(`http://127.0.0.1:${tsPort}/troubleshoot/api/ping`, r => r.ok);

  // ======================= 3. Secret Drop (real relay + real front, own port = own origin) =======================
  const sdRoot = path.resolve(process.env.QA_SECRET_DROP_ROOT), sdEngine = await freePort(), sdFront = await freePort(), sdPublic = await freePort();
  const DROP = `http://drop.box.test:${sdPublic}`;
  fs.mkdirSync(path.join(work, 'sd-data'), { recursive: true });
  run('drop-engine', process.env.QA_PYTHON, ['server.py'], { cwd: sdRoot, env: { PATH: process.env.PATH, SECRET_DROP_DATA_DIR: path.join(work, 'sd-data'), SECRET_DROP_BIND: '127.0.0.1', SECRET_DROP_PORT: String(sdEngine), SECRET_DROP_ALLOWED_HOSTS: 'drop.box.test', SECRET_DROP_PUBLIC_URL: DROP } });
  const sdFrontFile = path.join(work, 'drop-front.py');
  fs.writeFileSync(sdFrontFile, ['front.py', 'tools.py'].map(f => fs.readFileSync(path.join(sdRoot, 'mcp', f), 'utf8')).join('\n\n') + '\n\nif __name__ == "__main__":\n    asyncio.run(main())\n');
  run('drop-front', process.env.QA_PYTHON, [sdFrontFile], { cwd: work, env: { PATH: process.env.PATH, WIZARD_APP: 'secret-drop', FRONT_PORT: String(sdFront), UPSTREAM_HOST: '127.0.0.1', UPSTREAM_PORT: String(sdEngine), WIZARD_BROWSER_BOUNDARY: BASELINE ? '0' : '1' } });
  // Recording pass-through in front of the app port (what reached the app, and its answer). Bytes unchanged.
  const dropProxy = http.createServer((req, res) => {
    const rec = { method: req.method, path: req.url.split('#')[0].slice(0, 80), origin: req.headers.origin || '', site: req.headers['sec-fetch-site'] || '', dest: req.headers['sec-fetch-dest'] || '' }; report.drop.push(rec);
    const up = http.request({ host: '127.0.0.1', port: sdFront, method: req.method, path: req.url, headers: req.headers }, r => { rec.status = r.statusCode; res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on('error', () => { rec.status = 502; res.writeHead(502); res.end(); }); req.pipe(up);
  });
  await new Promise(r => dropProxy.listen(sdPublic, '127.0.0.1', r));
  await waitHttp(`http://127.0.0.1:${sdFront}/health`, r => r.ok);

  // ======================= nginx stand-in: shell document (template + both tokens), /troubleshoot/, /wizard-*/ =======================
  const tpl = fs.readFileSync(path.join(root, 'packaging/browser-boundary-document.conf.template'), 'utf8');
  const docHeaders = [...tpl.matchAll(/add_header ([A-Za-z-]+) "([^"]*)" always;/g)].map(m => [m[1], m[2]]);
  const inject = tpl.match(/sub_filter '<head>' '([^']*)';/)[1].replace('${WIZARD_SHELL_TOKEN}', token).replace('${WIZARD_RECOVERY_TOKEN}', BASELINE ? '' : recoveryToken);
  report.templateHasRecoveryMeta = /wizard-recovery-token/.test(tpl);
  const serveFile = (res, file) => { if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }); res.end(fs.readFileSync(file)); };
  const pipeTo = (req, res, port, p, extra, rec) => {
    const parts = []; req.on('data', c => parts.push(c));
    req.on('end', () => {
      const up = http.request({ host: '127.0.0.1', port, method: req.method, path: p, headers: { ...req.headers, ...extra } }, r => { if (rec) rec.status = r.statusCode; res.writeHead(r.statusCode, r.headers); r.pipe(res); });
      up.on('error', () => { if (rec) rec.status = 502; res.writeHead(502); res.end(); }); up.end(Buffer.concat(parts));
    });
  };
  const proxy = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'), p = u.pathname;
    if (p === '/shell-health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"ok":true,"component":"wizard-shell"}'); }
    const doc = p.match(/^\/(?:wizard-os-home|wizard-ux)\/(|index\.html|desktop\.html)$/);
    if (doc) {
      if (req.headers['sec-fetch-dest'] !== 'document' || req.headers['sec-fetch-mode'] !== 'navigate' || req.method !== 'GET') { res.writeHead(403, { 'content-type': 'text/plain' }); return res.end('navigation only\n'); }
      const html = fs.readFileSync(path.join(web, doc[1] || 'index.html'), 'utf8').replace('<head>', '<head>' + inject);
      res.writeHead(200, { 'Content-Type': 'text/html', ...Object.fromEntries(docHeaders) }); return res.end(html);
    }
    if (p.startsWith('/wizard-os-home/')) return serveFile(res, path.join(web, path.normalize(p.slice('/wizard-os-home/'.length)).replace(/^(\.\.[/\\])+/, '')));
    if (p === '/evil-app/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<!doctype html><title>Same-origin app page</title><h1>An installed app\'s own page on the owner origin</h1>'); }
    if (p.startsWith('/troubleshoot')) {
      const rec = { path: p + u.search, method: req.method, origin: req.headers.origin || '', site: req.headers['sec-fetch-site'] || '', dest: req.headers['sec-fetch-dest'] || '', recoveryToken: req.headers['x-wizard-recovery-token'] === recoveryToken, shellToken: typeof req.headers['x-wizard-shell-token'] === 'string', by: req.headers['x-qa-caller'] || '' };
      report.trace.push(rec);
      // Caddy: the real peer from the connection, never a client copy.
      const h = { ...req.headers }; delete h['x-private-peer'];
      return pipeTo(req, res, tsPort, req.url, { 'x-private-peer': '100.64.0.7' }, rec);
    }
    const app = /^\/wizard-claude(\/.*)?$/.exec(p);
    if (app) {
      const rec = { path: p, method: req.method, origin: req.headers.origin || '', site: req.headers['sec-fetch-site'] || '', claude: true }; report.trace.push(rec);
      if (!app[1]) { res.writeHead(308, { location: p + '/' }); return res.end(); }
      return pipeTo(req, res, claudePort, app[1] + u.search, {}, rec);
    }
    if (p.startsWith('/wizard/')) {
      if (!serviceUp) { res.writeHead(502, { 'content-type': 'text/plain' }); return res.end('Agent Service down'); }
      const rec = p === '/wizard/v1/browser-shell/call' || p.startsWith('/wizard/v1/provider-recovery') ? { path: p, method: req.method, shellToken: req.headers['x-wizard-shell-token'] === token, origin: req.headers.origin || '' } : null;
      if (rec) report.trace.push(rec);
      return pipeTo(req, res, sp, req.url, { 'x-wizard-owner-proof': ownerProof }, rec);
    }
    res.writeHead(404); res.end();
  });
  await new Promise(r => proxy.listen(np, '127.0.0.1', r));

  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: [`--host-resolver-rules=MAP drop.box.test 127.0.0.1`], ...(process.env.QA_CHROME ? { executablePath: process.env.QA_CHROME } : {}) });
    // ---------- Main shell context (onboarding fixture uses page.route: never cite preflights from here) ----------
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.on('pageerror', e => report.errors.push('page: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') report.errors.push('console: ' + m.text().slice(0, 400)); });
    await page.addInitScript(() => { try { localStorage.setItem('wos.wsync.off', 'true'); } catch (_) {} });
    await require('./qa-browser-onboarding.cjs')(page, token, report);
    // The picker's model catalogue (Hermes) is synthetic; the Claude accounts read under test is NOT intercepted.
    const SUB = 'claude-subscription-directsdk-experimental';
    await page.route('**/wizard/hermes/api/model/options', route => route.request().frame() === page.mainFrame() ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ provider: 'openai-codex', model: 'gpt-6.1-sol', providers: [
      { slug: 'openai-codex', authenticated: true, models: ['gpt-6.1-sol'] }, { slug: SUB, authenticated: true, models: ['claude-opus-5-5[1m]'] }, { slug: 'anthropic', authenticated: true, models: ['claude-opus-5-5', 'claude-sonnet-5-5'] }] }) }) : route.continue());
    await page.goto(`${ORIGIN}/wizard-os-home/desktop.html`);
    await page.waitForFunction(() => window.WizBrowserBoundary?.enabled && window.wizardUX, { timeout: 20000 });
    const setSkin = async skin => { await page.evaluate(s => { WosSkin.set(s); WizAppearance.sync(); }, skin); await sleep(700); };
    const shot = async (name, target = page) => { const f = path.join(out, name + '.png'); await target.screenshot({ path: f }); report.screenshots.push(f); return f; };
    check(await page.evaluate(() => !document.querySelector('meta[name="wizard-recovery-token"]') && !document.querySelector('meta[name="wizard-shell-token"]')), 'shell document: both tokens left the DOM at boot (memory only)');

    // =================== 1. Model picker ===================
    await setSkin('nebula');
    const pick = await page.evaluate(async () => { await WosModels.load(true); const o = WosModels.visible().find(x => WosModels.family(x.value, x.provider) === 'claude:opus'); return { note: WosModels.claudeNote().replace(/<[^>]+>/g, ' ').trim(), down: WosModels.claudeDown, opusProvider: o?.provider }; });
    report.picker = pick;
    const pickerTrace = report.trace.filter(r => r.path === '/wizard/v1/browser-shell/call' || (r.claude && r.path === '/wizard-claude/api/accounts'));
    report.pickerTrace = pickerTrace;
    if (BASELINE) {
      report.baselinePicker = { ...pick, requests: pickerTrace.map(r => `${r.method} ${r.path} -> ${r.status} (site ${r.site || '-'})`) };
    } else {
      check(pickerTrace.some(r => r.path === '/wizard/v1/browser-shell/call' && r.status === 200 && r.shellToken) && !pickerTrace.some(r => r.claude), 'picker: one shell-owned typed read (shell token, 200); the shell never asked the Claude app listener');
      check(/Every listed Claude account reports a limit/.test(pick.note) && !pick.down && pick.opusProvider === 'anthropic', 'picker: the Claude limit note and the native Claude route are kept (real engine, real gated front)');
      // Server-side: the same direct read the old shell made is refused by the Claude listener gate.
      const direct = await page.evaluate(async () => { const r = await fetch('/wizard-claude/api/accounts', { cache: 'no-store' }); return { status: r.status, body: (await r.text()).slice(0, 80) }; });
      check(direct.status === 403 && /browser_request_refused/.test(direct.body), 'Claude listener gate refuses the shell document\'s direct /wizard-claude/api/accounts (403 browser_request_refused, server-side)');
      report.refusals.push({ what: 'shell document direct Claude read', ...direct });
    }
    await page.keyboard.press('Alt+KeyN'); await sleep(1200);
    const modelBtn = page.locator('[data-chmodel]').first();
    if (await modelBtn.count()) {
      for (const skin of ['nebula', 'grove', 'landscapes-light']) { await setSkin(skin); await page.locator('[data-chmodel]').first().click(); await sleep(900); await shot((BASELINE ? 'baseline-' : '') + 'model-picker-' + skin); await page.keyboard.press('Escape'); await sleep(400); }
      await setSkin('nebula');
    } else report.open.push('model picker button not found in the new chat window');

    // =================== 2. Troubleshooter in a Wizard window ===================
    const openTs = async (p = '') => { await page.evaluate(x => window.WizOpenApp('troubleshooter', x || undefined), p); const f = await appFrame(page, '/troubleshoot/'); return f; };
    let tsf = await openTs();
    await sleep(2500);
    const sandbox = await page.locator('iframe[src*="/troubleshoot/"]').first().getAttribute('sandbox');
    if (BASELINE) {
      report.baselineTroubleshooter = await tsf.evaluate(() => ({ origin: globalThis.origin, pill: document.querySelector('#pillText')?.textContent, picker: document.querySelector('#picker')?.children.length }));
      report.baselineTroubleshooter.sandbox = sandbox;
      report.baselineTroubleshooter.requests = report.trace.filter(r => r.path.startsWith('/troubleshoot/api')).map(r => `${r.method} ${r.path} -> ${r.status} (origin ${r.origin || '-'}, site ${r.site || '-'})`);
      await shot('baseline-troubleshooter-opaque-nebula');
    } else {
      await tsf.waitForFunction(() => /All working|problem/.test(document.querySelector('#pillText')?.textContent || ''), null, { timeout: 20000 });
      const st = await tsf.evaluate(() => ({ origin: globalThis.origin, pill: document.querySelector('#pillText').textContent, picker: document.querySelector('#picker').children.length, hasToken: document.documentElement.outerHTML.includes('wizard-recovery-token" content') }));
      report.troubleshooter = { ...st, sandbox };
      check(sandbox === 'allow-scripts allow-forms allow-downloads' && st.origin === 'null' && !st.hasToken, 'Troubleshooter window: opaque sandboxed frame, served without any token');
      const api = report.trace.filter(r => r.path.startsWith('/troubleshoot/api/') && !r.path.startsWith('/troubleshoot/api/ping'));
      check(api.length > 0 && api.every(r => r.site === 'same-origin' && r.recoveryToken && !r.shellToken && r.origin !== 'null'), 'every /troubleshoot/api/ call came from the shell document with the recovery token, never the shell token, never from the frame');
      check(st.picker >= 1, 'Troubleshooter: status pill and engine picker painted through recovery operations');
      await shot('troubleshooter-nebula');
      // Details sheet: checks, sign-ins, one-tap fixes.
      await tsf.locator('#pill').click(); await sleep(1500);
      await tsf.waitForFunction(() => document.querySelectorAll('#fixes [data-act]').length > 0, null, { timeout: 15000 });
      await shot('troubleshooter-details-nebula');
      // One-tap fix: arm, then run (fake docker records the restart).
      const before = fs.existsSync(path.join(work, 'docker-calls.log')) ? fs.readFileSync(path.join(work, 'docker-calls.log'), 'utf8') : '';
      const fix = tsf.locator('#fixes [data-act="restart:shell"]');
      await fix.click(); await sleep(200); await fix.click();
      await tsf.waitForFunction(() => /restarted|Done|qa-shell/i.test(document.querySelector('#fixMsg')?.textContent || ''), null, { timeout: 20000 }).catch(() => {});
      const after = fs.existsSync(path.join(work, 'docker-calls.log')) ? fs.readFileSync(path.join(work, 'docker-calls.log'), 'utf8') : '';
      report.fix = { msg: await tsf.evaluate(() => document.querySelector('#fixMsg').textContent), calls: after.slice(before.length).trim() };
      check(/restart qa-shell/.test(report.fix.calls), 'one-tap fix ran through recovery.action (the listener restarted the shell container via its fixed command)');
      tsf = await appFrame(page, '/troubleshoot/');
      await tsf.evaluate(() => document.querySelector('#closeSheet')?.click()); await sleep(500);
      // Repair chat via the fake Claude CLI.
      await tsf.locator('#input').fill('Wizard feels slow today');
      await tsf.locator('#send').click();
      await tsf.waitForFunction(() => document.querySelectorAll('.ts-msg.ts-agent').length > 0, null, { timeout: 30000 });
      report.chat = await tsf.evaluate(() => [...document.querySelectorAll('.ts-msg')].map(m => m.textContent.slice(0, 120)));
      check(report.trace.some(r => r.path === '/troubleshoot/api/repair' && r.method === 'POST' && r.status === 202 && r.recoveryToken), 'repair chat: message started through recovery.repair.start (202) and the answer painted from recovery.repair.read');
      await shot('troubleshooter-chat-nebula');
      for (const skin of ['grove', 'landscapes-light']) { await setSkin(skin); await sleep(600); await shot(`troubleshooter-chat-${skin}`); }
      report.landscapesLight = await tsf.evaluate(() => ({ scheme: getComputedStyle(document.documentElement).colorScheme, bg: getComputedStyle(document.body).backgroundColor }));
      await setSkin('nebula');
      // Diagnosed sign-in (chat-power opens this with ?provider&run_id): its "Sign in to Claude" link and the
      // "was the waiting message sent?" poll. The shell opens the Claude app as a Wizard window; the frame stays put.
      await page.evaluate(() => window.WizOpenApp('troubleshooter', '/troubleshoot/?provider=claude&run_id=run_qa_1'));
      const dloc = page.locator('iframe[src*="run_id=run_qa_1"]'); await dloc.waitFor({ state: 'attached' });
      const dframe = await (await dloc.elementHandle()).contentFrame();
      await dframe.waitForFunction(() => !document.querySelector('#reconnect')?.hidden && document.querySelector('#reconnect a[data-openapp]'), null, { timeout: 20000 });
      await sleep(1500);
      await shot('troubleshooter-diagnosed-signin-nebula');
      await dframe.locator('#reconnect a[data-openapp]').click(); await sleep(1500);
      report.signinOpened = await page.evaluate(() => [...document.querySelectorAll('iframe')].map(f => new URL(f.src, location.href).pathname + new URL(f.src, location.href).search));
      check(report.signinOpened.includes('/wizard-claude/') && (await dframe.evaluate(() => location.pathname)) === '/troubleshoot/', 'diagnosed sign-in: "Sign in to Claude" opened the Claude app as a Wizard window (source-bound open_app); the Troubleshooter frame did not navigate');
      check(report.trace.some(r => r.path === '/wizard/v1/provider-recovery' && r.shellToken && r.status), 'diagnosed sign-in: the "message sent?" poll is one shell read of the Agent Service (recovery.provider_run)');
      await page.evaluate(() => { for (const f of document.querySelectorAll('iframe')) { const p = new URL(f.src, location.href); if (p.pathname === '/wizard-claude/' || p.search.includes('run_qa_1')) f.closest('.win')?.querySelector('[aria-label="Close window"]')?.click(); } });
      await sleep(600);

      // ---- Agent Service down: the recovery path does not go through it ----
      report.serviceUpRow = await tsf.evaluate(() => [...document.querySelectorAll('#checks .ts-row')].filter(r => /Agent Service/.test(r.textContent)).map(r => ({ text: r.textContent.trim().slice(0, 160), bad: !!r.querySelector('.ts-bad') }))[0] || null);
      await close(service); serviceUp = false;
      await page.evaluate(() => { for (const f of document.querySelectorAll('iframe')) { const u = new URL(f.src, location.href); if (u.pathname === '/troubleshoot/' && !u.search) f.src = f.src; } });
      await sleep(800);
      tsf = await (await page.locator('iframe[src$="/troubleshoot/"]').first().elementHandle()).contentFrame();
      await tsf.waitForFunction(() => /problem/.test(document.querySelector('#pillText')?.textContent || ''), null, { timeout: 30000 });
      const agentRow = () => [...document.querySelectorAll('#checks .ts-row')].filter(r => /Agent Service/.test(r.textContent)).map(r => ({ text: r.textContent.trim().slice(0, 160), bad: !!r.querySelector('.ts-bad') }))[0] || null;
      await tsf.waitForFunction(f => { const r = eval(f)(); return r && r.bad; }, agentRow.toString(), { timeout: 30000 });
      report.serviceDown = await tsf.evaluate(f => ({ pill: document.querySelector('#pillText').textContent, agent: eval(f)() }), agentRow.toString());
      check(report.serviceUpRow && !report.serviceUpRow.bad && report.serviceDown.agent?.bad, 'Agent Service stopped: the Troubleshooter window still reads status through the recovery path and now reports the Agent Service down');
      const agentsBefore = await tsf.evaluate(() => document.querySelectorAll('.ts-msg.ts-agent').length);
      const startsBefore = report.trace.filter(r => r.path === '/troubleshoot/api/repair' && r.method === 'POST').length;
      await tsf.locator('#input').fill('The Agent Service is down');
      await tsf.locator('#input').press('Enter');
      await tsf.waitForFunction(n => document.querySelectorAll('.ts-msg.ts-agent').length > n, agentsBefore, { timeout: 30000 });
      const starts = report.trace.filter(r => r.path === '/troubleshoot/api/repair' && r.method === 'POST');
      report.serviceDownChat = await tsf.evaluate(() => [...document.querySelectorAll('.ts-msg')].map(m => m.textContent.slice(0, 100)));
      check(!serviceUp && starts.length === startsBefore + 1 && starts.at(-1).status === 202 && starts.at(-1).recoveryToken, 'Agent Service stopped: a new repair chat message was started (202) and answered through the recovery operations');
      await shot('troubleshooter-service-down-nebula');
    }

    // =================== Hostile probes: a context with NO request interception ===================
    const hostile = await browser.newContext({ viewport: { width: 1100, height: 800 }, serviceWorkers: 'block' });
    const hp2 = await hostile.newPage();
    await hp2.goto(`${ORIGIN}/evil-app/`);
    const evil = await hp2.evaluate(async () => {
      const r = {};
      const call = async (u, i) => { try { const x = await fetch(u, i); return x.status + ' ' + (await x.text()).slice(0, 60); } catch (e) { return 'blocked: ' + e.message.slice(0, 40); } };
      r.readRepairs = await call('/troubleshoot/api/repairs?limit=5');
      r.runFix = await call('/troubleshoot/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Wizard-Troubleshoot': '1' }, body: '{"action":"restart:shell"}' });
      r.fetchPage = await call('/troubleshoot/');
      const w = window.open('/troubleshoot/', '_blank'); r.openerHandle = w === null ? 'null (COOP noopener-allow-popups)' : 'got a handle';
      await new Promise(res => setTimeout(res, 1500));
      r.openerClosed = w ? w.closed : null;
      try { r.openerRead = w && w.document ? (w.document.documentElement.outerHTML.includes('wizard-recovery-token') ? 'TOKEN READ' : 'read, no token') : 'no access'; } catch (e) { r.openerRead = 'blocked: ' + e.name; }
      const f = document.createElement('iframe'); f.src = '/troubleshoot/'; document.body.append(f);
      await new Promise(res => f.onload = res);
      try { r.frameRead = f.contentDocument ? (f.contentDocument.documentElement.outerHTML.includes('wizard-recovery-token" content') ? 'TOKEN READ' : 'read, no token') : 'no access (opaque)'; } catch (e) { r.frameRead = 'blocked: ' + e.name; }
      return r;
    });
    report.hostileSameOrigin = evil;
    if (!BASELINE) {
      check(/^403 .*recovery_token_required/.test(evil.readRepairs) && /^403 /.test(evil.runFix), 'same-origin app page: /troubleshoot/api reads and fixes refused server-side (403 recovery_token_required)');
      check(/^403 .*navigation_only/.test(evil.fetchPage), 'same-origin app page: fetching the Troubleshooter page is refused (navigation only)');
      check(evil.openerRead !== 'TOKEN READ' && /^(blocked|no access)/.test(evil.openerRead) && evil.frameRead === 'no access (opaque)', 'same-origin app page: the Troubleshooter tab it opens cannot be read (COOP noopener-allow-popups) and a framed copy is opaque without a token');
    }
    // Opaque-frame probes, with the real drop origin.
    const opaque = await hp2.evaluate(async drop => {
      const s = document.createElement('iframe'); s.sandbox = 'allow-scripts'; document.body.append(s);
      const got = new Promise(r => addEventListener('message', e => { if (e.source === s.contentWindow) r(e.data); }, { once: true }));
      s.srcdoc = `<script>(async () => { const o = {}; const t = async (u, i) => { try { const x = await fetch(u, i); return 'status ' + x.status; } catch (e) { return 'opaque/no-cors'; } };
        o.recovery = await t(${JSON.stringify(location.origin)} + '/troubleshoot/api/action', { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: '{"action":"restart:shell"}' });
        o.dropCreate = await t(${JSON.stringify(drop)} + '/api/v1/requests', { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: '{"label":"x","key":"EVIL_API_KEY","requester":"evil","public_key":"AAAA"}' });
        o.dropMcp = await t(${JSON.stringify(drop)} + '/mcp', { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' });
        parent.postMessage(o, '*'); })();<\/script>`;
      return got;
    }, DROP);
    await sleep(500);
    const fromOpaque = report.trace.filter(r => r.origin === 'null' && r.path.startsWith('/troubleshoot/api/action'));
    const dropFromOpaque = report.drop.filter(r => r.origin === 'null');
    report.opaqueProbes = { client: opaque, troubleshooter: fromOpaque, drop: dropFromOpaque };
    if (!BASELINE) {
      check(fromOpaque.length >= 1 && fromOpaque.every(r => r.status === 403), 'opaque frame POST /troubleshoot/api/action (no-cors): reached the listener and was refused server-side (403)');
      check(dropFromOpaque.length >= 2 && dropFromOpaque.every(r => r.status === 403), 'opaque frame POST to Secret Drop /api/v1/requests and /mcp (no-cors): refused server-side by the listener gate (403)');
    }
    // Raw preflights (no browser involved): the agent side never approves one.
    const preflight = await new Promise(r => { const q = http.request({ host: '127.0.0.1', port: sdPublic, method: 'OPTIONS', path: '/api/v1/requests', headers: { Host: `drop.box.test:${sdPublic}`, Origin: 'null', 'Access-Control-Request-Method': 'POST' } }, x => { let b = ''; x.on('data', d => { b += d; }); x.on('end', () => r({ status: x.statusCode, body: b, acao: x.headers['access-control-allow-origin'] || null })); }); q.end(); });
    report.dropPreflight = preflight;
    if (!BASELINE) check(preflight.status === 403 && /preflight_refused/.test(preflight.body) && !preflight.acao, 'Secret Drop: a raw OPTIONS preflight to the agent API is refused (403, no CORS header)');

    // =================== Standalone Troubleshooter tab, dark ===================
    const tab = await hostile.newPage();
    await tab.emulateMedia({ colorScheme: 'dark' });
    await tab.goto(`${ORIGIN}/troubleshoot/`);
    await tab.waitForFunction(() => /All working|problem|check/i.test(document.querySelector('#pillText')?.textContent || ''), null, { timeout: 20000 }).catch(() => {});
    report.standalone = await tab.evaluate(() => ({ pill: document.querySelector('#pillText')?.textContent, tokenInDom: !!document.querySelector('meta[name="wizard-recovery-token"]'), scheme: matchMedia('(prefers-color-scheme: dark)').matches }));
    if (!BASELINE) check(/All working|problem/.test(report.standalone.pill) && !report.standalone.tokenInDom, 'standalone tab (no shell): works with its own navigation-bound recovery token, which left the DOM at boot');
    await shot(BASELINE ? 'baseline-troubleshooter-standalone-dark' : 'troubleshooter-standalone-dark', tab);
    await tab.close();

    // =================== 3. Secret Drop recipient page on its own origin ===================
    const kdir = path.join(work, 'agent-key'); fs.mkdirSync(kdir, { recursive: true, mode: 0o700 });
    // Async: the recording proxy in this process must keep answering while the agent client runs.
    const py = (...a) => new Promise((resolve, reject) => require('node:child_process').execFile(process.env.QA_PYTHON, [path.join(sdRoot, 'client.py'), ...a], { encoding: 'utf8', cwd: work, env: { PATH: process.env.PATH } }, (err, stdout, stderr) => err ? reject(Object.assign(err, { stderr })) : resolve(stdout)));
    let created = null;
    try {
      await py('keygen', '--key-file', path.join(kdir, 'agent.key'));
      created = JSON.parse(await py('create', '--relay', `http://127.0.0.1:${sdPublic}`, '--key-file', path.join(kdir, 'agent.key'), '--key', 'SYNTHETIC_API_KEY', '--label', 'Synthetic QA key', '--requester', 'qa-agent', '--state', path.join(kdir, 'state.json')));
    } catch (e) { report.open.push('client.py create: ' + String(e.stderr || e.message).slice(0, 300)); }
    if (created) {
      const url = created.request_url;
      const value = 'synthetic-' + crypto.randomBytes(6).toString('hex');
      const rp = await hostile.newPage();
      await rp.emulateMedia({ colorScheme: 'dark' });
      await rp.goto(url);
      await rp.waitForSelector('#secret-form:not([hidden])', { timeout: 15000 });
      report.dropPage = await rp.evaluate(() => ({ origin: location.origin, secure: isSecureContext, subtle: typeof crypto.subtle, fragmentGone: !location.hash }));
      await shot('secret-drop-recipient-dark', rp);
      await rp.locator('#value').fill(value);
      await rp.locator('#submit').click();
      await sleep(1500);
      await shot('secret-drop-sent-dark', rp);
      const envFile = path.join(work, 'picked.env');
      let picked = '';
      try { await py('pickup', '--state', path.join(kdir, 'state.json'), '--key-file', path.join(kdir, 'agent.key'), '--write-env', envFile); picked = fs.readFileSync(envFile, 'utf8'); } catch (e) { report.open.push('client.py pickup: ' + String(e.stderr || e.message).slice(0, 300)); }
      report.dropRoundTrip = { pickedMatches: picked.includes(value), secure: report.dropPage.secure };
      const again = await hostile.newPage(); await again.goto(url); await sleep(1500);
      report.dropReuse = await again.evaluate(() => document.body.innerText.slice(0, 160));
      await shot('secret-drop-already-used', again);
      // Framing: the shell trying to show the link in a frame (as its link sheet would) gets nothing.
      const framed = await page.evaluate(async u => { const f = document.createElement('iframe'); f.src = u; f.style.cssText = 'position:fixed;left:0;top:0;width:400px;height:300px'; document.body.append(f); await new Promise(r => setTimeout(r, 2000)); let s; try { s = f.contentDocument ? 'readable' : 'no access'; } catch (e) { s = 'blocked'; } f.remove(); return s; }, url);
      report.dropFramed = framed;
      const pageHeaders = await fetch(`http://127.0.0.1:${sdPublic}/`, { headers: { Host: `drop.box.test:${sdPublic}` } }).then(r => ({ csp: r.headers.get('content-security-policy'), xfo: r.headers.get('x-frame-options'), coop: r.headers.get('cross-origin-opener-policy') }));
      report.dropHeaders = pageHeaders;
      if (!BASELINE) {
        check(report.dropPage.origin !== ORIGIN && !report.dropPage.secure && report.dropPage.fragmentGone, 'Secret Drop: recipient page on its own non-owner origin (plain HTTP, not a secure context); the capability fragment left the address bar');
        check(report.dropRoundTrip.pickedMatches, 'Secret Drop: sealed in the browser (bundled HPKE, no WebCrypto needed), picked up once and decrypted by the agent client');
        check(/already|used/i.test(report.dropReuse), 'Secret Drop: the one-use link reports Already used on a second open');
        check(/frame-ancestors 'none'/.test(pageHeaders.csp) && pageHeaders.xfo === 'DENY' && pageHeaders.coop === 'same-origin', 'Secret Drop: the page refuses framing (CSP frame-ancestors none + XFO DENY) and openers (COOP same-origin)');
      }
      const agentCalls = report.drop.filter(r => r.path.startsWith('/api/v1/requests') && !r.origin && !r.site);
      if (!BASELINE) check(agentCalls.length >= 2 && agentCalls.every(r => [200, 201].includes(r.status)), 'Secret Drop: the agent client (no browser headers) created and picked up through the gated front');
    }

    report.passed = !BASELINE;
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ baseline: BASELINE, checks: report.checks.length, open: report.open, errors: report.errors.slice(0, 10), screenshots: report.screenshots.map(f => path.basename(f)),
      ...(BASELINE ? { picker: report.baselinePicker, troubleshooter: report.baselineTroubleshooter, hostile: report.hostileSameOrigin, opaque: report.opaqueProbes } : {}) }, null, 2));
  } catch (e) {
    report.failure = String(e.stack || e).slice(0, 3000);
    try { const pg = browser?.contexts()[0]?.pages()[0]; if (pg) await pg.screenshot({ path: path.join(out, 'failure.png') }); } catch (_) {}
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2));
    console.error('FAILED', report.failure, '\nchecks so far:', report.checks.length);
    process.exitCode = 1;
  } finally {
    await browser?.close().catch(() => {});
    for (const c of children) c.kill();
    for (const s of [proxy, dropProxy, hermes, hfix, whois]) await close(s);
    if (serviceUp) await close(service);
  }
})();
