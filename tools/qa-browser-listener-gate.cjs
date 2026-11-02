// Card 3 (wizard-os #386): the Notifications DIRECT listener under the browser boundary.
// Real Chromium + real nginx (shell document template + a Tailscale Serve stand-in for WAM's --set-path route)
// + real Agent Service (production WAM resolver) + REAL WAM install/grant/listener-credential state + the REAL
// Notifications front over a stub ntfy. Hostile requests from an opaque app frame, from the shell document and
// from a network caller carrying the owner's tailnet identity go straight to /notifications/api/* (bypassing
// data.call); the adapter path must keep working. Server-side readback: nginx access log + inbox.json.
// QA_FRONT_BOUNDARY=0 runs the same requests against an unguarded front (negative control; nothing asserted
// about refusals, outcomes recorded). Synthetic data only; never a live box.
// Env: QA_OUT, QA_SERVICE_ROOT, QA_WAM_ROOT, QA_NOTIFICATIONS_ROOT, QA_PYTHON (PyYAML), QA_NGINX_IMAGE (any local
// image with nginx, run with --network host on a free 127.0.0.1 port and removed after), QA_PLAYWRIGHT, QA_CHROME.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict'), { spawn, execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url'), crypto = require('node:crypto');
const appFrame = require('./qa-browser-frame.cjs');
const root = path.resolve(process.env.QA_UX_ROOT || path.join(__dirname, '..')), out = path.resolve(process.env.QA_OUT || '');
const { chromium } = require(path.join(root, 'tools/qa-playwright.cjs'));
for (const k of ['QA_OUT', 'QA_SERVICE_ROOT', 'QA_WAM_ROOT', 'QA_NOTIFICATIONS_ROOT', 'QA_PYTHON', 'QA_NGINX_IMAGE']) if (!process.env[k]) throw new Error(k + ' is required');
const guarded = process.env.QA_FRONT_BOUNDARY !== '0';
fs.mkdirSync(out, { recursive: true });
const token = crypto.randomBytes(32).toString('hex'), ownerProof = crypto.randomBytes(32).toString('hex');
const web = path.join(root, 'web'), fixtureRoot = path.join(root, 'tests/fixtures/browser-trust');
const listen = server => new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const close = s => new Promise(r => { s.closeAllConnections?.(); s.close(r); });
const freePort = async () => { const p = http.createServer(), port = await listen(p); await close(p); return port; };
const report = { candidate: true, mode: guarded ? 'boundary-on' : 'control-boundary-off', nativeProven: false, realStoreInstallProven: false, realTailscaleServeProven: false, checks: [], observed: {}, screenshots: [], errors: [], wam: [] };
const check = (value, name) => { assert.ok(value, name); report.checks.push(name); };
const box = path.join(out, 'box');
const wam = (...args) => { const r = execFileSync(process.env.QA_PYTHON, [path.join(process.env.QA_WAM_ROOT, 'tools/browser_admission_fixture.py'), box, ...args], { encoding: 'utf8' }); report.wam.push(args.join(' ')); return r; };
const appsJson = () => JSON.parse(fs.readFileSync(path.join(box, 'home/apps.json'), 'utf8'));
const inbox = () => { try { return JSON.parse(fs.readFileSync(path.join(box, 'notifications-data/inbox.json'), 'utf8')); } catch (_) { return {}; } };
const children = [];
const nginxName = 'card3-nginx-qa-' + process.pid;
const accessLog = () => { try { return fs.readFileSync(path.join(out, 'nginx/notifications-access.log'), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)); } catch (_) { return []; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  // 1. Stub ntfy (the engine behind the front) with two synthetic messages.
  const now = Math.floor(Date.now() / 1000);
  const messages = [
    { id: 'SynthGate0001', time: now - 60, event: 'message', topic: 'wizard', title: 'Synthetic build finished', message: 'Synthetic job output is ready.' },
    { id: 'SynthGate0002', time: now - 120, event: 'message', topic: 'wizard', title: 'Synthetic reminder', message: 'Synthetic reminder text.' },
  ];
  const ntfy = http.createServer((req, res) => {
    const topic = new URL(req.url, 'http://x').pathname.split('/')[1];
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.end(messages.filter(m => m.topic === topic).map(m => JSON.stringify(m)).join('\n') + '\n');
  });
  const ntfyPort = await listen(ntfy);
  // 2. WAM: real registry writer + grant CLI; --listener-auth gives the installed compose WIZARD_APP_CREDENTIAL.
  const frontPort = await freePort();
  fs.mkdirSync(path.join(box, 'home'), { recursive: true });
  fs.writeFileSync(path.join(box, 'home/routes.json'), JSON.stringify({ notifications: { view: '/notifications-adapter/' } }));
  wam('install', 'notifications', '--repo', 'oscarhenrycollins/notifications', '--port', String(frontPort), '--listener-auth');
  wam('grant', 'notifications', 'notifications.list', 'notifications.mark_read');
  const facts = appsJson().apps[0].browser;
  report.browserFacts = { ...facts };
  check(facts.admissible && facts.listener_credential?.state === 'written', 'WAM: granted installation has a listener credential reference');
  const keyFile = path.join(box, 'home', facts.listener_credential.ref);
  const appEnv = Object.fromEntries(fs.readFileSync(path.join(box, 'runtipi/user-config/wizardapps/notifications/app.env'), 'utf8').trim().split('\n').map(l => l.split(/=(.*)/s).slice(0, 2)));
  check(appEnv.WIZARD_APP_CREDENTIAL === fs.readFileSync(keyFile, 'utf8').trim() && /^[a-f0-9]{64}$/.test(appEnv.WIZARD_APP_CREDENTIAL), 'WAM: the app env and the Service key file hold the same per-installation credential');
  check(!JSON.stringify(appsJson()).includes(appEnv.WIZARD_APP_CREDENTIAL), 'WAM: apps.json never contains the credential value');
  // 3. The real Notifications front, with the env WAM wrote (candidate) or with nothing (control).
  const nroot = process.env.QA_NOTIFICATIONS_ROOT;
  const frontSrc = ['front.py', 'tools.py', 'minimal_assets.py', 'relay.py'].map(f => fs.readFileSync(path.join(nroot, 'mcp', f), 'utf8')).join('\n\n') + '\n\nif __name__ == "__main__":\n    asyncio.run(main())\n';
  fs.mkdirSync(path.join(box, 'notifications-data'), { recursive: true });
  const frontFile = path.join(out, 'notifications-front.py'); fs.writeFileSync(frontFile, frontSrc);
  const gateEnv = guarded ? { WIZARD_BROWSER_BOUNDARY: appEnv.WIZARD_BROWSER_BOUNDARY, WIZARD_APP_CREDENTIAL: appEnv.WIZARD_APP_CREDENTIAL, WIZARD_GUARDED_PATHS: '/notifications/api/,/notifications/media/' } : {};
  const front = spawn(process.env.QA_PYTHON, [frontFile], { env: { PATH: process.env.PATH, WIZARD_APP: 'notifications', FRONT_PORT: String(frontPort), UPSTREAM_HOST: '127.0.0.1', UPSTREAM_PORT: String(ntfyPort), INBOX_TOPICS: 'wizard,cron', INBOX_STATE: path.join(box, 'notifications-data/inbox.json'), CRON_RELAY: 'off', ...gateEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(front); let frontLog = ''; front.stdout.on('data', b => frontLog += b); front.stderr.on('data', b => frontLog += b);
  for (let i = 0; i < 50; i++) { try { const r = await fetch(`http://127.0.0.1:${frontPort}/notifications/healthz`); if (r.ok) break; } catch (_) {} await sleep(100); }
  // 4. Agent Service with the production WAM resolver.
  const { createWizardServer } = await import(pathToFileURL(path.join(process.env.QA_SERVICE_ROOT, 'server/service.mjs')));
  const { createHermesFixture } = await import(pathToFileURL(path.join(process.env.QA_SERVICE_ROOT, 'server/fixture.mjs')));
  const hermes = createHermesFixture({ expectedKey: 'boundary-fixture-only' }); const hp = await listen(hermes);
  const svcHome = path.join(out, 'service-home'); fs.mkdirSync(svcHome, { recursive: true });
  const service = createWizardServer({ upstreamOrigin: `http://127.0.0.1:${hp}`, hermesKey: 'boundary-fixture-only', requireAccess: false, ownerProof,
    browserBoundary: { enabled: true, token }, hermesHome: path.join(svcHome, 'hermes'), wizardOsHome: path.join(box, 'home'),
    appsJsonPath: path.join(box, 'home/apps.json'), settingsPath: path.join(svcHome, 'settings.json'), launcherPath: path.join(svcHome, 'launcher.json'),
    agentBridge: false, followThrough: false, joinedDelegation: 'off', browserAdapterWam: { receiptsPath: path.join(out, 'service-state/receipts.json') } });
  const trace = []; report.serviceTrace = trace;
  service.on('request', (req, res) => res.on('finish', () => trace.push({ method: req.method, path: new URL(req.url, 'http://x').pathname, status: res.statusCode, origin: req.headers.origin || '', hasShellToken: typeof req.headers['x-wizard-shell-token'] === 'string' })));
  const sp = await listen(service);
  // 5. Real nginx: the REAL shell document template (token injected by sub_filter), static shell, fixture view,
  //    /wizard/ -> Service, and /notifications/ -> the app port directly with Tailscale Serve's identity headers,
  //    which is what WAM's `tailscale serve --set-path=/notifications/` route does on a box (links.py).
  const np = await freePort();
  const ng = path.join(out, 'nginx'); fs.mkdirSync(ng, { recursive: true }); fs.chmodSync(ng, 0o777);
  const tpl = fs.readFileSync(path.join(root, 'packaging/browser-boundary-document.conf.template'), 'utf8');
  fs.writeFileSync(path.join(ng, 'doc.conf'), tpl.replace('${WIZARD_SHELL_TOKEN}', token).replace('${WIZARD_RECOVERY_TOKEN}', process.env.QA_RECOVERY_TOKEN || ''));
  const conf = `worker_processes 1; pid /tmp/qa-nginx.pid; error_log /qa/error.log warn; daemon off;
events { worker_connections 64; }
http {
  include /etc/nginx/mime.types; default_type application/octet-stream; access_log off; server_tokens off; absolute_redirect off;
  client_body_temp_path /tmp/qa-cb; proxy_temp_path /tmp/qa-px; fastcgi_temp_path /tmp/qa-fc; uwsgi_temp_path /tmp/qa-uw; scgi_temp_path /tmp/qa-sc;
  log_format qa escape=json '{"m":"$request_method","u":"$request_uri","s":$status,"o":"$http_origin","site":"$http_sec_fetch_site","dest":"$http_sec_fetch_dest","mode":"$http_sec_fetch_mode","ct":"$content_type","by":"$http_x_qa_caller"}';
  server {
    listen 127.0.0.1:${np};
    location = /wizard-os-home/desktop.html { root /web; try_files /desktop.html =404; include /qa/doc.conf; }
    location = /wizard-os-home/index.html { root /web; try_files /index.html =404; include /qa/doc.conf; }
    location /wizard-os-home/ { location ~ /\\. { return 404; } alias /web/; }
    location = /fixture-assets/styles.css { alias /fix/styles.css; }
    location /notifications-adapter/ { alias /fix/notifications-adapter/; }
    location /wizard/ { proxy_pass http://127.0.0.1:${sp}; proxy_http_version 1.1; proxy_set_header Host $http_host; proxy_set_header X-Wizard-Owner-Proof ${ownerProof}; proxy_buffering off; }
    # Stand-in for Tailscale Serve's path handler: straight to the app listener, owner identity added.
    location /notifications/ {
      access_log /qa/notifications-access.log qa;
      proxy_pass http://127.0.0.1:${frontPort}; proxy_http_version 1.1; proxy_set_header Host $http_host;
      proxy_set_header Tailscale-User-Login owner@example.com; proxy_set_header Tailscale-User-Name "Synthetic Owner";
      proxy_set_header X-Forwarded-For $remote_addr; proxy_set_header X-Forwarded-Proto https;
    }
  }
}
`;
  fs.writeFileSync(path.join(ng, 'nginx.conf'), conf);
  const runArgs = ['run', '--rm', '--name', nginxName, '--network', 'host', '--entrypoint', 'nginx', '-v', `${ng}:/qa`, '-v', `${web}:/web:ro`, '-v', `${fixtureRoot}:/fix:ro`, process.env.QA_NGINX_IMAGE, '-c', '/qa/nginx.conf'];
  report.nginx = { image: process.env.QA_NGINX_IMAGE, version: '' };
  try { report.nginx.version = execFileSync('sh', ['-c', `docker run --rm --entrypoint nginx ${process.env.QA_NGINX_IMAGE} -v 2>&1 | grep 'nginx version'`], { encoding: 'utf8' }).trim(); } catch (_) {}
  execFileSync('docker', ['run', '--rm', '--network', 'host', '--entrypoint', 'nginx', '-v', `${ng}:/qa`, '-v', `${web}:/web:ro`, '-v', `${fixtureRoot}:/fix:ro`, process.env.QA_NGINX_IMAGE, '-t', '-c', '/qa/nginx.conf'], { stdio: 'pipe' });
  const nginx = spawn('docker', runArgs, { stdio: ['ignore', 'pipe', 'pipe'] }); children.push(nginx);
  let nginxLog = ''; nginx.stdout.on('data', b => nginxLog += b); nginx.stderr.on('data', b => nginxLog += b);
  let browser, page;
  try {
    for (let i = 0; i < 100; i++) { try { const r = await fetch(`http://127.0.0.1:${np}/wizard-os-home/core/app-client.js`); if (r.ok) break; } catch (_) {} await sleep(150); }
    // Every refusal must carry no token (nginx's own error pages would get it through sub_filter).
    report.observed.documentRefusals = [];
    for (const [method, dest, mode] of [['GET', 'empty', 'cors'], ['GET', 'iframe', 'navigate'], ['GET', 'script', 'no-cors'], ['POST', 'document', 'navigate']]) {
      const r = await fetch(`http://127.0.0.1:${np}/wizard-os-home/desktop.html`, { method, headers: { 'sec-fetch-dest': dest, 'sec-fetch-mode': mode }, ...(method === 'POST' ? { body: 'x=1' } : {}) });
      const leaked = (await r.text()).includes(token);
      report.observed.documentRefusals.push({ method, dest, mode, status: r.status, leaked });
    }
    check(report.observed.documentRefusals.every(x => [403, 405].includes(x.status) && !x.leaked), 'real nginx: every non-navigation or non-GET shell document request is refused and carries no shell token');
    // A real preflight (raw HTTP through real nginx): refused, no CORS grant.
    report.observed.preflight = await new Promise((done, fail) => {
      const rq = http.request({ host: '127.0.0.1', port: np, method: 'OPTIONS', path: '/notifications/api/mark', headers: { Origin: 'null', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type', 'Sec-Fetch-Mode': 'cors', 'Sec-Fetch-Site': 'cross-site' } }, r => { r.resume(); r.on('end', () => done({ status: r.statusCode, cors: Object.keys(r.headers).filter(k => k.startsWith('access-control-')) })); });
      rq.on('error', fail); rq.end();
    });
    if (guarded) check(report.observed.preflight.status === 403 && report.observed.preflight.cors.length === 0, 'preflight to /notifications/api/mark refused (403, no Access-Control-* header)');
    // A network caller with the owner's tailnet identity (any device or process on the tailnet), straight to the listener.
    const network = async (method, p, body) => {
      const r = await fetch(`http://127.0.0.1:${np}${p}`, { method, headers: { 'x-qa-caller': 'network', ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: r.status, text: await r.text() };
    };
    const netRead = await network('GET', '/notifications/api/items?view=all&limit=500');
    const netWrite = await network('POST', '/notifications/api/mark', { ids: ['SynthGate0002'], read: true });
    report.observed.network = { read: netRead.status, readLeaked: netRead.text.includes('SynthGate'), write: netWrite.status, writeLanded: inbox().SynthGate0002?.read === true };
    if (guarded) {
      check(netRead.status === 403 && !report.observed.network.readLeaked, 'network owner identity cannot read /notifications/api/items (403, no data)');
      check(netWrite.status === 403 && !report.observed.network.writeLanded, 'network owner identity cannot write /notifications/api/mark (403, inbox.json unchanged)');
    }
    browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME ? { executablePath: process.env.QA_CHROME } : {}) });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    page = await context.newPage(); page.on('pageerror', e => report.errors.push(e.message)); report.console = []; page.on('console', m => { if (report.console.length < 80) report.console.push(m.type() + ': ' + m.text().slice(0, 300)); });
    await require('./qa-browser-onboarding.cjs')(page, token, report);
    await page.goto(`http://127.0.0.1:${np}/wizard-os-home/desktop.html`);
    await page.waitForFunction(() => window.WizBrowserBoundary?.enabled && window.wizardUX, { timeout: 20000 });
    check(true, 'shell document served by real nginx with the boundary template (token injected by sub_filter)');
    await page.evaluate(() => dispatchEvent(new CustomEvent('wizard:open', { detail: { path: '/notifications-adapter/' } })));
    const app = await appFrame(page, '/notifications-adapter/');
    await app.waitForFunction(() => window.WizBoundaryClient?.ready, null, { timeout: 15000 });
    check(await page.locator('iframe[src*="/notifications-adapter/"]').getAttribute('sandbox') === 'allow-scripts allow-forms allow-downloads', 'app view is an opaque sandboxed frame');
    await app.waitForFunction(() => /^Loaded 2/.test(document.querySelector('#status').textContent), null, { timeout: 15000 });
    check(true, 'adapter path works: data.call notifications.list -> Service -> gated listener (app credential)');
    // Hostile: the frame skips data.call and goes to the app's direct routes (owner identity added by the Serve stand-in).
    const before = accessLog().length;
    report.observed.frame = await app.evaluate(async () => {
      const r = {};
      const tryFetch = async (k, url, init) => { try { const x = await fetch(url, init); r[k] = x.type === 'opaque' ? 'opaque' : 'status:' + x.status; } catch (e) { r[k] = 'blocked:' + e.name; } };
      await tryFetch('corsRead', '/notifications/api/items?view=all&limit=500');
      await tryFetch('noCorsRead', '/notifications/api/items?view=all&limit=500', { mode: 'no-cors' });
      await tryFetch('simpleWrite', '/notifications/api/mark', { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ ids: ['SynthGate0002'], read: true }) });
      await tryFetch('jsonWrite', '/notifications/api/mark', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: ['SynthGate0002'], read: true }) });
      await tryFetch('sourcesWrite', '/notifications/api/sources', { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: '{"app":"wizard","chats":false}' });
      r.form = await new Promise(done => {
        const sink = document.createElement('iframe'); sink.name = 'qa-sink'; document.body.append(sink);
        const f = document.createElement('form'); f.method = 'POST'; f.action = '/notifications/api/mark'; f.target = 'qa-sink'; f.enctype = 'text/plain';
        const i = document.createElement('input'); i.name = '{"ids":["SynthGate0002"],"read":true,"x":"'; i.value = '"}'; f.append(i); document.body.append(f);
        const t = setTimeout(() => done('timeout'), 4000); sink.onload = () => { clearTimeout(t); done('submitted'); }; f.submit();
      });
      r.img = await new Promise(done => { const im = new Image(); im.onload = () => done('loaded'); im.onerror = () => done('error'); im.src = '/notifications/media/tmp/synthetic.png'; });
      return r;
    });
    await sleep(500);
    const frameReqs = accessLog().slice(before);
    report.observed.frameServer = frameReqs;
    const fromFrame = frameReqs.filter(x => x.by !== 'network');
    report.observed.frameServerStatuses = fromFrame.map(x => `${x.m} ${x.u.split('?')[0]} ${x.s}`);
    if (guarded) {
      check(fromFrame.length >= 7 && fromFrame.every(x => x.s === 403 || x.s === 401), 'every direct frame request reached the listener and was refused server-side (nginx access log)');
      // Playwright's request interception (the onboarding fixture routes) answers CORS preflights itself, so the
      // browser sends the JSON POST without a real OPTIONS: what matters is that the listener refuses the POST.
      check(fromFrame.some(x => x.m === 'POST' && x.ct === 'application/json' && x.s === 403) || fromFrame.some(x => x.m === 'OPTIONS' && x.s === 403), 'JSON write from the frame refused server-side (403)');
      check(fromFrame.some(x => x.m === 'POST' && /text\/plain/.test(x.ct) && x.u.startsWith('/notifications/api/mark') && x.s === 403), 'simple text/plain and form writes refused server-side');
      check(fromFrame.some(x => x.dest === 'image' && x.s === 403), 'media <img> load refused server-side');
      check(inbox().SynthGate0002?.read !== true && !inbox().SynthGate0002, 'no hostile write reached the inbox (inbox.json readback)');
    }
    // The shell document itself (same origin, owner identity) also cannot use the direct listener.
    const shellBefore = accessLog().length;
    report.observed.shellDirect = await page.evaluate(async () => { try { const r = await fetch('/notifications/api/count', { cache: 'no-store' }); return r.status; } catch (e) { return 'blocked:' + e.name; } });
    report.observed.shellServer = accessLog().slice(shellBefore).map(x => `${x.m} ${x.u} ${x.s} site=${x.site}`);
    if (guarded) check(report.observed.shellDirect === 403, 'shell document direct /notifications/api/count refused (bell needs the card-2 shell-owned count)');
    // Legitimate path still writes: Mark read through data.call -> Service -> listener with the app credential.
    const btn = app.locator('li[data-id="SynthGate0001"] button');
    await btn.click();
    await app.waitForFunction(() => /^Saved: SynthGate0001/.test(document.querySelector('#status').textContent), null, { timeout: 15000 });
    check(inbox().SynthGate0001?.read === true && (!guarded || !inbox().SynthGate0002), 'adapter mark_read persisted the requested item (inbox.json readback)');
    // Reinstall rotates the credential: the running front (old env) now refuses the Service until restarted with the new env.
    if (guarded) {
      wam('uninstall', 'notifications');
      check(!fs.existsSync(keyFile), 'WAM uninstall removed the listener credential');
      wam('install', 'notifications', '--repo', 'oscarhenrycollins/notifications', '--port', String(frontPort), '--listener-auth');
      wam('grant', 'notifications', 'notifications.list');
      const after = appsJson().apps[0].browser;
      check(after.installation_id !== facts.installation_id, 'reinstall is a new installation');
      const newKey = fs.readFileSync(path.join(box, 'home', after.listener_credential.ref), 'utf8').trim();
      check(newKey !== appEnv.WIZARD_APP_CREDENTIAL, 'reinstall minted a new credential');
      const stale = await app.evaluate(async () => { try { await WizardApp.data.call({ operation: 'notifications.list', args: { limit: 5, cursor: null } }); return 'ALLOWED'; } catch (e) { return e.code; } });
      report.observed.afterReinstallOldBinding = stale;
      check(stale !== 'ALLOWED', 'old binding refused after reinstall');
    }
    for (const skin of ['nebula', 'grove']) {
      await page.evaluate(s => { WosSkin.set(s); WizAppearance.sync(); }, skin);
      await page.waitForTimeout(300);
      const shot = path.join(out, `listener-gate-${report.mode}-${skin}.png`); await page.screenshot({ path: shot }); report.screenshots.push(shot);
    }
    await context.close();
    report.inbox = inbox(); report.frontLogTail = frontLog.slice(-1500); report.nginxLogTail = nginxLog.slice(-1500);
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: true, mode: report.mode, checks: report.checks.length, observed: { network: report.observed.network, frame: report.observed.frame, frameServer: report.observed.frameServerStatuses, shellDirect: report.observed.shellDirect } }, null, 2));
  } catch (error) {
    report.failure = error.stack; report.frontLogTail = frontLog.slice(-2000); report.nginxLogTail = nginxLog.slice(-2000);
    try { report.statusText = await page?.frames().find(f => f.url().includes('/notifications-adapter/'))?.locator('#status').textContent(); } catch (_) {}
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2));
    throw error;
  } finally {
    await browser?.close();
    try { execFileSync('docker', ['rm', '-f', nginxName], { stdio: 'ignore' }); } catch (_) {}
    for (const c of children) c.kill('SIGTERM');
    await Promise.all([close(service), close(ntfy)]);
    await hermes.closeFixture?.();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
