// Browser trust, PROPOSED second separate-origin exception (wizard-os issue 386; awaiting Miguel's approval): the
// Hermes dashboard opens ONLY as its own tab on its own origin with its OWN login, never framed in a Wizard window,
// and its listener refuses frame and cross-/same-site browser requests server-side. Hermes itself is not patched.
// Real Chromium + real Agent Service + REAL WAM state from the app's own wizard.md + the REAL hermes-agent front (its
// mcp/*.py) over the REAL Wizard Hermes image (pinned digest, the recipe's engine: dashboard + its password login).
// Every listener is https on one synthetic host (box.test), as on a tailnet box. A Node stand-in replaces nginx
// (shell document) and Tailscale Serve (the dashboard's own port, WebSocket upgrades included). Synthetic data only.
// Env: QA_OUT, QA_SERVICE_ROOT, QA_WAM_ROOT, QA_HERMES_ROOT, QA_PYTHON (PyYAML), QA_PLAYWRIGHT, QA_CHROME,
//      QA_BASELINE=1 (QA_HERMES_BASE=<rev>: the unmigrated front + manifest).
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), https = require('node:https'), net = require('node:net');
const assert = require('node:assert/strict'), { spawn, execFileSync } = require('node:child_process');
const R = require('./qa-browser-files-rig.cjs'), { HOST, listen, close, freePort, sleep, raw } = R;
const root = path.resolve(process.env.QA_UX_ROOT || path.join(__dirname, '..')), out = path.resolve(process.env.QA_OUT || '');
const { chromium } = require(path.join(root, 'tools/qa-playwright.cjs'));
for (const k of ['QA_OUT', 'QA_SERVICE_ROOT', 'QA_WAM_ROOT', 'QA_HERMES_ROOT', 'QA_PYTHON']) if (!process.env[k]) throw new Error(k + ' is required');
const BASELINE = process.env.QA_BASELINE === '1', HERMES = path.resolve(process.env.QA_HERMES_ROOT), BASE_REV = process.env.QA_HERMES_BASE || 'origin/main';
const IMAGE = 'ghcr.io/humanitylabs-org/hermes-agent@sha256:ac89f5f9fa16eda6c7aba3de3ba7235da3d867914e3ae2dcf13135ee078fd3b0';
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
const token = R.crypto.randomBytes(32).toString('hex'), ownerProof = R.crypto.randomBytes(32).toString('hex');
const password = R.crypto.randomBytes(18).toString('base64url');   // synthetic dashboard login, this run only
const web = path.join(root, 'web');
const report = { candidate: !BASELINE, baseline: BASELINE, nginxStandIn: 'node', serveStandIn: 'node (http + websocket)', image: IMAGE, checks: [], screenshots: [], errors: [], wam: [], dashRequests: [] };
const check = (value, name) => { assert.ok(value, name); report.checks.push(name); };
const box = path.join(out, 'box');
const wam = (...args) => { const r = execFileSync(process.env.QA_PYTHON, [path.join(process.env.QA_WAM_ROOT, 'tools/browser_admission_fixture.py'), box, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); report.wam.push(args.join(' ')); return r; };
const appsJson = () => JSON.parse(fs.readFileSync(path.join(box, 'home/apps.json'), 'utf8'));
const show = (rev, f) => rev ? execFileSync('git', ['-C', HERMES, 'show', `${rev}:${f}`], { encoding: 'utf8' }) : fs.readFileSync(path.join(HERMES, f), 'utf8');
const children = [], servers = [];
let container = '';

/** Tailscale Serve stand-in for the dashboard's OWN https port: keeps Host, adds the owner login, pipes WebSocket
 *  upgrades too, and records what the listener answered (status, X-Frame-Options, whether a session cookie rode). */
function serveStandIn({ tls, upstreamPort, record }) {
  const fwd = req => ({ ...req.headers, 'tailscale-user-login': 'owner@example.com', 'tailscale-user-name': 'Owner', 'x-forwarded-for': '100.64.0.7', 'x-forwarded-proto': 'https', 'x-forwarded-host': req.headers.host });
  const rec0 = req => ({ via: 'own-origin', method: req.method, path: new URL(req.url, 'https://' + HOST).pathname, site: req.headers['sec-fetch-site'] || '', dest: req.headers['sec-fetch-dest'] || '', mode: req.headers['sec-fetch-mode'] || '', origin: req.headers.origin ?? '', cookie: /hermes_session/.test(req.headers.cookie || ''), upgrade: !!req.headers.upgrade, at: Date.now() });
  const s = https.createServer(tls, (req, res) => {
    const rec = rec0(req); record(rec);
    const up = http.request({ host: '127.0.0.1', port: upstreamPort, method: req.method, path: req.url, headers: fwd(req) }, r => {
      rec.status = r.statusCode; rec.xfo = r.headers['x-frame-options'] || '';
      // Like Serve, keep the browser connection alive: the listener closes each upstream connection after one reply,
      // and passing its `Connection: close` on made Chromium abandon parallel loads (ERR_TOO_MANY_RETRIES).
      const h = { ...r.headers }; delete h.connection; delete h['keep-alive'];
      res.writeHead(r.statusCode, h); r.pipe(res);
    });
    up.on('error', () => { rec.status = 502; res.writeHead(502); res.end(); }); req.pipe(up);
  });
  s.on('upgrade', (req, sock, head) => {
    const rec = rec0(req); record(rec);
    const u = net.connect(upstreamPort, '127.0.0.1', () => {
      const h = fwd(req); let lines = `${req.method} ${req.url} HTTP/1.1\r\n`;
      for (const [k, v] of Object.entries(h)) lines += `${k}: ${v}\r\n`;
      u.write(lines + '\r\n'); if (head?.length) u.write(head);
      let buf = Buffer.alloc(0);
      const first = d => { buf = Buffer.concat([buf, d]); const i = buf.indexOf('\r\n\r\n'); if (i < 0) return; u.off('data', first);
        const m = /^HTTP\/1\.1 (\d+)/.exec(buf.toString('latin1')); rec.status = m ? +m[1] : 0; rec.xfo = (/x-frame-options:\s*([^\r\n]*)/i.exec(buf.slice(0, i).toString('latin1')) || [])[1] || '';
        sock.write(buf); u.pipe(sock); sock.pipe(u); };
      u.on('data', first);
    });
    u.on('error', () => { rec.status = 502; sock.destroy(); }); sock.on('error', () => u.destroy());
  });
  return s;
}

(async () => {
  const tls = R.certificate(path.join(out, 'tls'));
  const dreqs = report.dashRequests, rec = r => dreqs.push(r);
  // 1. The REAL Wizard Hermes image (pinned digest) as the recipe's engine: dashboard on, its own password login.
  const dashPort = await freePort(), data = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'hq-data-')); fs.chmodSync(data, 0o777);
  container = 'hq-dash-' + dashPort;
  execFileSync('docker', ['run', '-d', '--rm', '--name', container, '-p', `127.0.0.1:${dashPort}:9119`, '-v', `${data}:/opt/data`,
    '-e', `HERMES_UID=${process.getuid()}`, '-e', `HERMES_GID=${process.getgid()}`, '-e', 'HERMES_DASHBOARD=1', '-e', 'HERMES_DASHBOARD_HOST=0.0.0.0', '-e', 'HERMES_DASHBOARD_PORT=9119',
    '-e', 'HERMES_DASHBOARD_BASIC_AUTH_USERNAME=hermes', '-e', `HERMES_DASHBOARD_BASIC_AUTH_PASSWORD=${password}`, '-e', `HERMES_DASHBOARD_BASIC_AUTH_SECRET=${R.crypto.randomBytes(48).toString('hex')}`,
    IMAGE, 'gateway', 'run'], { stdio: 'ignore' });
  for (let i = 0; i < 120 && (await raw(`http://127.0.0.1:${dashPort}/login`).catch(() => ({ status: 0 }))).status !== 200; i++) await sleep(500);
  report.dashboardLogin = (await raw(`http://127.0.0.1:${dashPort}/login`)).status;
  // 2. Ports: the shell (Wizard origin) and the dashboard's own origin, both https on box.test.
  const shellPort = await freePort(), ownPort = await freePort(), frontPort = await freePort();
  const SHELL = `https://${HOST}:${shellPort}`, OWN = `https://${HOST}:${ownPort}`;
  report.origins = { shell: SHELL, dashboard: OWN };
  // 3. WAM: the app's OWN wizard.md (candidate: own-tab contract; baseline: the unmigrated manifest).
  const manifest = path.join(out, 'hermes-wizard.md'); fs.writeFileSync(manifest, show(BASELINE ? BASE_REV : '', 'wizard.md'));
  fs.mkdirSync(path.join(box, 'home'), { recursive: true });
  fs.writeFileSync(path.join(box, 'home/routes.json'), JSON.stringify({ 'hostile-notes': { view: '/hostile-notes/' } }));
  wam('install', 'hermes-agent', '--repo', 'oscarhenrycollins/hermes-agent', '--provides', 'agent', '--port', String(ownPort), '--wizard-md', manifest);
  wam('install', 'hostile-notes', '--repo', 'synthetic/hostile-notes', '--provides', 'notes', '--port', String(await freePort()), '--no-contract');
  // What `wam links` writes on a tailnet box: the agent dashboard is on its own https port (never a Wizard path);
  // the candidate marks it own_tab.
  fs.writeFileSync(path.join(box, 'home/links.json'), JSON.stringify({ links: [{ id: 'hermes-agent', url: OWN + '/', open: OWN + '/', ...(BASELINE ? {} : { own_tab: true }) }] }));
  wam('write');
  const b = appsJson().apps.find(a => a.id === 'hermes-agent');
  report.wamHermes = { browser: b.browser, view: b.view };
  if (!BASELINE) {
    check(b.browser.isolation === 'own-tab' && b.browser.admissible === false && !b.browser.listener_credential && b.browser.granted.length === 0, 'WAM: hermes-agent (oscarhenrycollins/hermes-agent) is the proposed own-tab exception: no binding, grant or listener credential');
    check(b.view.url === OWN + '/', 'WAM: the dashboard opens at its own https origin');
    let refused = false; try { wam('grant', 'hermes-agent', 'notifications.list'); } catch (e) { refused = /own tab/.test(String(e.stderr || e.message)); }
    check(refused, 'WAM: browser grants are refused for the own-tab dashboard');
  }
  // 4. The REAL hermes-agent front behind a Tailscale Serve stand-in on the dashboard's own https port.
  const frontSrc = show(BASELINE ? BASE_REV : '', 'mcp/front.py') + '\n\n' + show(BASELINE ? BASE_REV : '', 'mcp/tools.py') + '\n\nif __name__ == "__main__":\n    asyncio.run(main())\n';
  const frontFile = path.join(out, 'hermes-front.py'); fs.writeFileSync(frontFile, frontSrc);
  const env = { PATH: process.env.PATH, WIZARD_APP: 'hermes-agent', FRONT_PORT: String(frontPort), UPSTREAM_HOST: '127.0.0.1', UPSTREAM_PORT: String(dashPort), PYTHONDONTWRITEBYTECODE: '1', MCP_TOKEN: R.crypto.randomBytes(16).toString('hex'),
    ...(BASELINE ? {} : { WIZARD_BROWSER_BOUNDARY: '1', WIZARD_OWN_HOSTS: `${HOST}:${ownPort}` }) };
  const front = spawn(process.env.QA_PYTHON, [frontFile], { env, stdio: ['ignore', 'pipe', 'pipe'] }); children.push(front);
  let frontLog = ''; front.stdout.on('data', x => frontLog += x); front.stderr.on('data', x => frontLog += x);
  for (let i = 0; i < 50 && (await raw(`http://127.0.0.1:${frontPort}/login`).catch(() => ({ status: 0 }))).status !== 200; i++) await sleep(100);
  const own = serveStandIn({ tls, upstreamPort: frontPort, record: rec }); servers.push(own); await listen(own, ownPort);
  // 5. Agent Service + the shell stand-in.
  const svc = await R.startService({ out, serviceRoot: process.env.QA_SERVICE_ROOT, box, token, ownerProof });
  const service = svc.createWizardServer(svc.options); servers.push(service, svc.hermes); const sp = await listen(service);
  const hostileDir = path.join(out, 'hostile-notes'); fs.mkdirSync(hostileDir, { recursive: true });
  fs.writeFileSync(path.join(hostileDir, 'index.html'), '<!doctype html><meta charset="utf-8"><title>Notes</title><body style="font:14px system-ui;padding:24px"><h1>Synthetic notes app</h1><p>(hostile probe page; synthetic)</p></body>');
  const shell = R.shellProxy({ tls, web, token, ownerProof, servicePort: sp, routes: { '/hostile-notes/': { static: hostileDir } }, record: rec });
  servers.push(shell); await listen(shell, shellPort);
  const snapshot = JSON.parse((await raw(`http://127.0.0.1:${sp}/wizard/v1/apps`, { headers: { 'x-wizard-shell-token': token, 'x-wizard-owner-proof': ownerProof } })).body.toString());
  report.serviceHermes = snapshot.apps.find(a => a.id === 'hermes-agent');
  if (!BASELINE) check(report.serviceHermes?.own_tab === true && report.serviceHermes.url === OWN + '/', 'Agent Service: /wizard/v1/apps flags the dashboard own_tab at its own https address');
  else check(report.serviceHermes && !report.serviceHermes.own_tab, 'baseline: the dashboard has no own_tab flag');
  let browser, page;
  const shot = async (p, name) => { const f = path.join(out, name + '.png'); await p.screenshot({ path: f }); report.screenshots.push(f); };
  const login = async t => {
    await t.waitForSelector('input[name=password]', { timeout: 20000 });
    const asked = /\/login/.test(new URL(t.url()).pathname);
    await t.fill('input[name=username]', 'hermes'); await t.fill('input[name=password]', password);
    await Promise.all([t.waitForURL(u => !/\/login/.test(u.pathname), { timeout: 20000 }), t.locator('button[type=submit]').first().click()]);
    await t.waitForLoadState('networkidle').catch(() => {}); await sleep(3000);
    return asked;
  };
  const setSkin = async skin => { await page.evaluate(s => { WosSkin.set(s); WizAppearance.sync(); }, skin); await sleep(800); };
  try {
    browser = await chromium.launch({ headless: true, args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1`], ...(process.env.QA_CHROME ? { executablePath: process.env.QA_CHROME } : {}) });
    const context = await browser.newContext({ viewport: { width: 1440, height: 940 }, serviceWorkers: 'block', ignoreHTTPSErrors: true });
    page = await context.newPage(); page.on('pageerror', e => report.errors.push('page: ' + e.message));
    await require('./qa-browser-onboarding.cjs')(page, token, report);
    await page.goto(`${SHELL}/wizard-os-home/desktop.html`);
    await page.waitForFunction(() => window.WizBrowserBoundary?.enabled && window.wizardUX, { timeout: 20000 });
    await page.waitForFunction(() => document.querySelector('.home') && window.WizCore?.apps('desktop')?.APP, null, { timeout: 20000 });
    if (!BASELINE) await page.waitForFunction(() => window.WizCore.apps('desktop').APP['hermes-agent'], null, { timeout: 20000 });
    else await sleep(3000);
    const tile = await page.evaluate(() => { const a = window.WizCore.apps('desktop').APP['hermes-agent']; return a ? { ownTab: a.ownTab === true, url: a.url } : null; });
    report.shellTile = tile;
    report.shellAppIds = await page.evaluate(() => Object.keys(window.WizCore.apps('desktop').APP));
    // ---- Open Hermes the way the owner does: the app picker (Alt+O), type, Enter (a trusted activation). ----
    const frameErrors = [];
    context.on('page', p => { p.on('pageerror', e => frameErrors.push('tab: ' + e.message)); p.on('requestfailed', r => frameErrors.push('failed: ' + r.url().replace(/^https:\/\/[^/]+/, '') + ' ' + (r.failure()?.errorText || ''))); });
    const opening = context.waitForEvent('page', { timeout: 8000 }).catch(() => null);
    await page.keyboard.press('Alt+o'); await sleep(400);
    await page.keyboard.type('Hermes Agent'); await sleep(400);
    await page.keyboard.press('Enter');
    let tab = await opening; await sleep(2500);
    const frames = await page.evaluate(own => [...document.querySelectorAll('iframe')].filter(f => f.src.startsWith(own)).map(f => ({ src: f.src, sandbox: f.getAttribute('sandbox') })), OWN);
    report.framesForHermes = frames; report.tabOpened = tab ? tab.url() : null;
    if (!BASELINE) {
      check(tile.ownTab && tile.url === OWN + '/', 'shell: the Hermes Agent tile carries ownTab and its own https address');
      check(!!tab && new URL(tab.url()).origin === OWN, 'opening Hermes Agent from the app picker opens a NEW TAB at the dashboard\'s own origin');
      check(frames.length === 0, 'no Wizard window frames the dashboard (no iframe of its origin anywhere in the shell)');
      await tab.waitForLoadState('load');
      const nav = dreqs.find(r => r.via === 'own-origin' && r.mode === 'navigate' && r.dest === 'document');
      report.tabNavigation = nav;
      check(nav && nav.site === 'same-site' && [200, 302].includes(nav.status) && nav.xfo === 'DENY', 'the tab\'s navigation reached the dashboard as a same-site top-level document and its reply says X-Frame-Options DENY');
      const opener = await tab.evaluate(() => ({ opener: window.opener === null, referrer: document.referrer }));
      check(opener.opener && opener.referrer === '', 'the tab has no opener and no referrer (nothing crosses from the shell)');
      // ---- The dashboard's OWN login, unchanged, on its own origin. ----
      check(await login(tab), 'the dashboard asks for its own login (no Wizard credential crosses into it)');
      const cookies = await context.cookies(OWN);
      report.dashboardCookies = cookies.map(c => ({ name: c.name, sameSite: c.sameSite, httpOnly: c.httpOnly, secure: c.secure, path: c.path }));
      check(cookies.some(c => /hermes_session/.test(c.name)), 'the dashboard\'s own session cookie is set on its own origin after its own login');
      const me = await tab.evaluate(async () => { const r = await fetch('/api/auth/me', { credentials: 'same-origin' }); return { status: r.status, body: r.ok ? await r.json() : null }; });
      report.dashboardMe = { status: me.status, user: me.body?.user_id || me.body?.username || null };
      check(me.status === 200, 'own-origin API call with the dashboard session works through the gated front (GET /api/auth/me 200)');
      const ws = await tab.evaluate(async () => {
        const t = await fetch('/api/auth/ws-ticket', { method: 'POST', credentials: 'same-origin' }); const j = t.ok ? await t.json() : {};
        return await new Promise(res => { const w = new WebSocket(`wss://${location.host}/api/events?channel=qa&ticket=${encodeURIComponent(j.ticket || '')}`);
          w.onopen = () => { res({ ticket: t.status, open: true }); w.close(); }; w.onclose = e => res({ ticket: t.status, open: false, code: e.code }); setTimeout(() => res({ ticket: t.status, open: 'timeout' }), 6000); });
      });
      report.ownWebSocket = ws;
      const wsHit = dreqs.filter(r => r.upgrade && r.path === '/api/events').pop();
      report.ownWebSocketServerSide = wsHit;
      check(ws.ticket === 200 && wsHit && wsHit.status !== 403, 'own-page WebSocket upgrade passes the front and is decided by Hermes itself (status ' + (wsHit && wsHit.status) + ', browser open=' + ws.open + ')');
      await tab.emulateMedia({ colorScheme: 'dark' }); await sleep(600);
      await shot(tab, 'hermes-own-tab-dark');
      await tab.emulateMedia({ colorScheme: 'light' }); await sleep(600);
      await shot(tab, 'hermes-own-tab-light');
    } else {
      report.baselineOpen = { tile, tab: tab ? tab.url() : null, frames };
      // The owner opens the dashboard's own address directly (today's only way) and signs in, for parity and so the
      // hostile probes below run against a signed-in owner exactly as in the candidate.
      tab = await context.newPage(); await tab.goto(OWN + '/'); await login(tab);
      report.baselineMe = await tab.evaluate(async () => (await fetch('/api/auth/me', { credentials: 'same-origin' })).status);
      await shot(tab, 'baseline-hermes-direct-light');
      check(true, 'baseline: recorded how the shell opens the dashboard (tile ' + JSON.stringify(tile) + ', tab ' + (tab ? tab.url() : 'none') + ', frames ' + frames.length + ')');
      await shot(page, 'baseline-shell-open-hermes');
    }
    report.tabErrors = frameErrors;
    // ---- Hostile 1: an installed app in a Wizard window (opaque sandboxed frame) aims at the dashboard. ----
    await page.bringToFront();
    await page.evaluate(() => dispatchEvent(new CustomEvent('wizard:open', { detail: { path: '/hostile-notes/' } })));
    const hostileFrame = await require('./qa-browser-frame.cjs')(page, '/hostile-notes/');
    const sandbox = await page.locator('iframe[src*="/hostile-notes/"]').getAttribute('sandbox');
    check(sandbox === 'allow-scripts allow-forms allow-downloads', 'the hostile app runs in the opaque sandboxed frame');
    const mark = Date.now();
    const fromFrame = await hostileFrame.evaluate(async t => {
      const r = { origin: self.origin };
      try { const x = await fetch(t + '/api/auth/me', { credentials: 'include' }); r.cors = x.status; } catch (e) { r.cors = 'blocked'; }
      try { await fetch(t + '/auth/password-login', { method: 'POST', mode: 'no-cors', credentials: 'include', body: '{"username":"hermes","password":"guess"}' }); r.loginPost = 'sent'; } catch (e) { r.loginPost = 'blocked'; }
      r.img = await new Promise(res => { const i = new Image(); i.onload = () => res('loaded'); i.onerror = () => res('error'); i.src = t + '/favicon.ico?qa=' + Date.now(); });
      r.ws = await new Promise(res => { try { const w = new WebSocket(t.replace('https:', 'wss:') + '/api/events?channel=qa'); w.onopen = () => res('open'); w.onclose = e => res('closed ' + e.code); } catch (e) { res('threw'); } setTimeout(() => res('timeout'), 4000); });
      r.frame = await new Promise(res => { const f = document.createElement('iframe'); f.src = t + '/'; f.onload = () => res('load-event'); document.body.append(f); setTimeout(() => res('no-load'), 4000); });
      return r;
    }, OWN);
    await sleep(800);
    report.hostileFrame = fromFrame;
    const frameHits = dreqs.filter(r => r.via === 'own-origin' && r.at >= mark && (r.origin === 'null' || r.site === 'cross-site'));
    report.hostileFrameServerSide = frameHits;
    if (!BASELINE) {
      check(fromFrame.origin === 'null' && fromFrame.cors === 'blocked', 'hostile frame: its credentialed CORS read of /api/auth/me fails in the browser');
      check(frameHits.length >= 4 && frameHits.every(r => r.status === 403), `server-side: all ${frameHits.length} requests from the opaque frame to the dashboard's origin (${[...new Set(frameHits.map(r => r.upgrade ? 'websocket' : r.dest || 'fetch'))].join(', ')}) were refused 403 by the front`);
      check(frameHits.some(r => r.dest === 'iframe' && r.status === 403 && r.xfo === 'DENY'), 'the nested <iframe> of the dashboard was refused (Sec-Fetch-Dest iframe → 403, X-Frame-Options DENY)');
      check(frameHits.some(r => r.upgrade && r.status === 403), 'the frame\'s WebSocket upgrade (Origin null) was refused 403 before Hermes');
    } else {
      report.baselineFrameStatuses = frameHits.map(r => `${r.method} ${r.path} ${r.dest || (r.upgrade ? 'websocket' : '')} → ${r.status} xfo=${r.xfo || '-'}`);
      check(frameHits.some(r => r.dest === 'iframe' && r.status !== 403 && !r.xfo), 'BASELINE: a hostile frame can embed the dashboard (no X-Frame-Options, not refused)');
    }
    // ---- Hostile 2: an app's own top-level tab on the Wizard origin (same-site: the dashboard's Lax cookie rides). ----
    const appTab = await context.newPage(); appTab.on('pageerror', e => report.errors.push('app tab: ' + e.message));
    await appTab.goto(`${SHELL}/hostile-notes/`);
    const mark2 = Date.now();
    const fromTab = await appTab.evaluate(async own => {
      const r = {};
      try { const x = await fetch(own + '/api/auth/me', { credentials: 'include' }); r.sameSite = x.status; } catch (e) { r.sameSite = 'blocked'; }
      try { await fetch(own + '/api/auth/logout', { method: 'POST', mode: 'no-cors', credentials: 'include' }); r.logout = 'sent'; } catch (e) { r.logout = 'blocked'; }
      r.frame = await new Promise(res => { const f = document.createElement('iframe'); f.src = own + '/'; f.onload = () => res('load-event'); document.body.append(f); setTimeout(() => res('no-load'), 4000); });
      return r;
    }, OWN);
    await sleep(600);
    report.hostileTab = fromTab;
    const tabHits = dreqs.filter(r => r.at >= mark2 && r.via === 'own-origin');
    report.hostileTabServerSide = tabHits;
    if (!BASELINE) {
      check(tabHits.length >= 3 && tabHits.every(r => r.status === 403 && r.site === 'same-site'), `same-origin app tab → the dashboard's origin: all ${tabHits.length} same-site requests (fetch, no-cors logout POST, iframe) refused 403 server-side`);
      check(tabHits.some(r => r.cookie), 'those refused requests carried the dashboard\'s session cookie (SameSite=Lax sends it same-site); the front refused them anyway');
      const still = await tab.evaluate(async () => (await fetch('/api/auth/me', { credentials: 'same-origin' })).status);
      check(still === 200, 'the owner\'s dashboard session survived the hostile same-site logout POST (still 200)');
    } else {
      report.baselineTabStatuses = tabHits.map(r => `${r.method} ${r.path} ${r.dest} cookie=${r.cookie} → ${r.status}`);
      check(tabHits.some(r => r.method === 'POST' && r.path === '/api/auth/logout' && r.status !== 403 && r.cookie), 'BASELINE: a same-origin app tab\'s no-cors logout POST reaches the dashboard WITH the owner\'s session cookie (SameSite=Lax, same-site)');
      report.baselineMeAfterHostile = await tab.evaluate(async () => (await fetch('/api/auth/me', { credentials: 'same-origin' })).status);
    }
    // Direct listener probes (no browser): boundary headers on every reply; box callers unchanged.
    if (!BASELINE) {
      const direct = await raw(`http://127.0.0.1:${frontPort}/login`, { headers: { host: `${HOST}:${ownPort}`, 'tailscale-user-login': 'owner@example.com', 'x-forwarded-for': '100.64.0.7', 'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' } });
      check(direct.status === 200 && direct.headers['x-frame-options'] === 'DENY' && /frame-ancestors 'none'/.test(direct.headers['content-security-policy'] || '') && direct.headers['cross-origin-opener-policy'] === 'same-origin', 'the dashboard\'s own page: X-Frame-Options DENY, frame-ancestors \'none\', COOP same-origin');
      const boxCaller = await raw(`http://127.0.0.1:${frontPort}/api/status`, { headers: { host: 'hermes-agent:9119' } });
      report.boxCallerStatus = boxCaller.status;
      check(boxCaller.status !== 403, 'a box caller (e.g. the ChatGPT/Claude apps using the dashboard API in fresh mode) is not refused by the front (' + boxCaller.status + ')');
    }
    // ---- Shell screenshots: the window fallback for a restored desk (two skins + Landscapes Light). ----
    await page.bringToFront();
    if (!BASELINE) {
      await page.evaluate(() => dispatchEvent(new CustomEvent('wizard:open', { detail: { id: 'hermes-agent' } }))).catch(() => {});
      await sleep(1500);
      report.frameFallback = await page.evaluate(() => [...document.querySelectorAll('.own-tab')].map(n => n.innerText.slice(0, 120)));
    }
    // The app picker with "Hermes" typed: the candidate lists Hermes Agent (opens as its own tab); the baseline has no
    // entry for it at all (its Service row has no address under the boundary).
    await page.keyboard.press('Escape'); await sleep(300); await page.keyboard.press('Escape'); await sleep(300);
    for (const skin of ['nebula', 'grove', 'landscapes-light']) {
      await setSkin(skin);
      await page.keyboard.press('Alt+o'); await sleep(500); await page.keyboard.type('Hermes'); await sleep(700);
      report['picker_' + skin] = await page.evaluate(() => document.body.innerText.includes('Hermes Agent'));
      await shot(page, (BASELINE ? 'baseline-' : '') + 'picker-' + skin);
      await page.keyboard.press('Escape'); await sleep(400);
    }
    await setSkin('nebula');
    report.frontLogTail = frontLog.slice(-1500);
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: true, baseline: BASELINE, checks: report.checks.length, screenshots: report.screenshots, errors: report.errors.length }, null, 2));
  } catch (error) {
    report.failure = error.stack; report.frontLogTail = frontLog.slice(-2000);
    try { const s = path.join(out, 'failure.png'); await page?.screenshot({ path: s }); report.failureShot = s; } catch (_) {}
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2));
    throw error;
  } finally {
    await browser?.close().catch(() => {});
    for (const c of children) c.kill();
    for (const s of servers) await close(s).catch(() => {});
    try { execFileSync('docker', ['rm', '-f', container], { stdio: 'ignore' }); } catch (_) {}
  }
})().catch(e => { console.error(e); process.exit(1); });
