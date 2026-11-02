// Browser trust, approved separate-origin exception (wizard-os #385, Files decision 2 Nov 2026): File Browser opens
// ONLY as its own tab on its own origin, never framed in a Wizard window, and its listener refuses frame and cross-/
// same-site browser requests server-side. Real Chromium + real Agent Service + REAL WAM state from the Files app's own
// wizard.md + the REAL Files front (its mcp/*.py) over a REAL File Browser v2.63.23 container (pinned digest, noauth
// as the recipe). Every listener is https on one synthetic host (box.test), as on a tailnet box. A Node stand-in
// replaces nginx (shell document) and Tailscale Serve (Files' own port). Synthetic files only; never a live box.
// Env: QA_OUT, QA_SERVICE_ROOT, QA_WAM_ROOT, QA_FILES_ROOT, QA_PYTHON (PyYAML), QA_PLAYWRIGHT, QA_CHROME,
//      QA_BASELINE=1 (QA_FILES_BASE=<rev>: the unmigrated front + manifest, Files at /files/ on the Wizard origin).
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict'), { spawn, execFileSync } = require('node:child_process');
const R = require('./qa-browser-files-rig.cjs'), { HOST, listen, close, freePort, sleep, raw } = R;
const root = path.resolve(process.env.QA_UX_ROOT || path.join(__dirname, '..')), out = path.resolve(process.env.QA_OUT || '');
const { chromium } = require(path.join(root, 'tools/qa-playwright.cjs'));
for (const k of ['QA_OUT', 'QA_SERVICE_ROOT', 'QA_WAM_ROOT', 'QA_FILES_ROOT', 'QA_PYTHON']) if (!process.env[k]) throw new Error(k + ' is required');
const BASELINE = process.env.QA_BASELINE === '1', FILES = path.resolve(process.env.QA_FILES_ROOT), BASE_REV = process.env.QA_FILES_BASE || 'origin/main';
const FB = 'filebrowser/filebrowser:v2.63.23@sha256:a469ea076d4a1b4b1d86a41d130f2f536cd9da996a2b1fb39c0d7635f9d89b9a';
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
const token = R.crypto.randomBytes(32).toString('hex'), ownerProof = R.crypto.randomBytes(32).toString('hex');
const web = path.join(root, 'web');
const report = { candidate: !BASELINE, baseline: BASELINE, nginxStandIn: 'node', serveStandIn: 'node', fileBrowser: FB, checks: [], open: [], screenshots: [], errors: [], wam: [], filesRequests: [] };
const check = (value, name) => { assert.ok(value, name); report.checks.push(name); };
const box = path.join(out, 'box');
const wam = (...args) => { const r = execFileSync(process.env.QA_PYTHON, [path.join(process.env.QA_WAM_ROOT, 'tools/browser_admission_fixture.py'), box, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); report.wam.push(args.join(' ')); return r; };
const appsJson = () => JSON.parse(fs.readFileSync(path.join(box, 'home/apps.json'), 'utf8'));
const show = (rev, f) => rev ? execFileSync('git', ['-C', FILES, 'show', `${rev}:${f}`], { encoding: 'utf8' }) : fs.readFileSync(path.join(FILES, f), 'utf8');
const children = [], servers = [];
let container = '';
(async () => {
  const tls = R.certificate(path.join(out, 'tls'));
  const freqs = report.filesRequests, rec = r => freqs.push(r);
  // 1. A real File Browser (pinned digest), noauth like the recipe, on loopback; synthetic owner files.
  const fbPort = await freePort(), srv = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-srv-'));
  fs.chmodSync(srv, 0o777); fs.mkdirSync(path.join(srv, 'Documents'), { mode: 0o777 }); fs.chmodSync(path.join(srv, 'Documents'), 0o777);
  fs.writeFileSync(path.join(srv, 'Documents/synthetic-notes.txt'), 'Synthetic owner file for the own-tab QA.\n');
  container = 'fb-own-tab-' + fbPort;
  const script = `filebrowser -d /tmp/fb.db config init --root /srv --address 127.0.0.1 --port ${fbPort} --baseurl /files --auth.method noauth >/dev/null && ` +
    `filebrowser -d /tmp/fb.db users add admin "$(head -c 24 /dev/urandom | base64)" --perm.create --perm.delete --perm.modify --perm.rename --perm.download >/dev/null && exec filebrowser -d /tmp/fb.db`;
  execFileSync('docker', ['run', '-d', '--rm', '--name', container, '--network', 'host', '--user', '0:0', '--entrypoint', '/bin/sh', '-v', `${srv}:/srv`, FB, '-c', script], { stdio: 'ignore' });
  for (let i = 0; i < 150 && (await raw(`http://127.0.0.1:${fbPort}/files/health`)).status !== 200; i++) await sleep(100);
  report.fileBrowserHealth = (await raw(`http://127.0.0.1:${fbPort}/files/health`)).status;
  // 2. Ports: the shell (Wizard origin) and Files' own origin, both https on box.test.
  const shellPort = await freePort(), filesPort = await freePort(), frontPort = await freePort();
  const SHELL = `https://${HOST}:${shellPort}`, OWN = `https://${HOST}:${filesPort}`;
  report.origins = { shell: SHELL, files: OWN };
  // 3. WAM: the Files app's OWN wizard.md (candidate: own-tab contract; baseline: the unmigrated manifest at /files/).
  const manifest = path.join(out, 'files-wizard.md'); fs.writeFileSync(manifest, show(BASELINE ? BASE_REV : '', 'wizard.md'));
  fs.mkdirSync(path.join(box, 'home'), { recursive: true });
  fs.writeFileSync(path.join(box, 'home/routes.json'), JSON.stringify({ 'hostile-notes': { view: '/hostile-notes/' }, ...(BASELINE ? { files: { view: '/files/' } } : {}) }));
  wam('install', 'files', '--repo', 'oscarhenrycollins/files', '--provides', 'files', '--port', String(filesPort), '--wizard-md', manifest);
  wam('install', 'hostile-notes', '--repo', 'synthetic/hostile-notes', '--provides', 'notes', '--port', String(await freePort()), '--no-contract');
  if (!BASELINE) {
    // What `wam links` writes on a tailnet box for the own-tab app: its own https address (no Wizard-origin path).
    fs.writeFileSync(path.join(box, 'home/links.json'), JSON.stringify({ links: [{ id: 'files', url: OWN + '/files/', open: OWN + '/files/', own_tab: true }] }));
    wam('write');
    const b = appsJson().apps.find(a => a.id === 'files');
    report.wamFiles = { browser: b.browser, view: b.view };
    check(b.browser.isolation === 'own-tab' && b.browser.admissible === false && !b.browser.listener_credential && b.browser.granted.length === 0, 'WAM: Files (oscarhenrycollins/files) is the reviewed own-tab exception: no binding, grant or listener credential');
    check(b.view.url === OWN + '/files/', 'WAM: Files opens at its own https origin, not a Wizard-origin path');
    let refused = false; try { wam('grant', 'files', 'notifications.list'); } catch (e) { refused = /own tab/.test(String(e.stderr || e.message)); }
    check(refused, 'WAM: browser grants are refused for the own-tab app');
  }
  // 4. The REAL Files front (gate per variant) behind a Tailscale Serve stand-in on Files' own https port.
  const frontSrc = show(BASELINE ? BASE_REV : '', 'mcp/front.py') + '\n\n' + show(BASELINE ? BASE_REV : '', 'mcp/tools.py') + '\n\nif __name__ == "__main__":\n    asyncio.run(main())\n';
  const frontFile = path.join(out, 'files-front.py'); fs.writeFileSync(frontFile, frontSrc);
  const env = { PATH: process.env.PATH, WIZARD_APP: 'files', FRONT_PORT: String(frontPort), UPSTREAM_HOST: '127.0.0.1', UPSTREAM_PORT: String(fbPort), FILES_ROOT: srv, PYTHONDONTWRITEBYTECODE: '1', WIZARD_OWNER_LOGINS: 'owner@example.com',
    ...(BASELINE ? {} : { WIZARD_BROWSER_BOUNDARY: '1', WIZARD_OWN_HOSTS: `${HOST}:${filesPort}` }) };
  const front = spawn(process.env.QA_PYTHON, [frontFile], { env, stdio: ['ignore', 'pipe', 'pipe'] }); children.push(front);
  let frontLog = ''; front.stdout.on('data', b => frontLog += b); front.stderr.on('data', b => frontLog += b);
  for (let i = 0; i < 50 && (await raw(`http://127.0.0.1:${frontPort}/files/health`)).status !== 200; i++) await sleep(100);
  const own = R.serveStandIn({ tls, upstreamPort: frontPort, record: rec }); servers.push(own); await listen(own, filesPort);
  // 5. Agent Service + the shell stand-in. /files/ on the Wizard origin = the OLD route (baseline: the live one).
  const svc = await R.startService({ out, serviceRoot: process.env.QA_SERVICE_ROOT, box, token, ownerProof });
  const service = svc.createWizardServer(svc.options); servers.push(service, svc.hermes); const sp = await listen(service);
  const hostileDir = path.join(out, 'hostile-notes'); fs.mkdirSync(hostileDir, { recursive: true });
  fs.writeFileSync(path.join(hostileDir, 'index.html'), '<!doctype html><meta charset="utf-8"><title>Notes</title><body style="font:14px system-ui;padding:24px"><h1>Synthetic notes app</h1><p>(hostile probe page; synthetic)</p></body>');
  const shell = R.shellProxy({ tls, web, token, ownerProof, servicePort: sp, routes: { '/files/': { port: frontPort }, '/hostile-notes/': { static: hostileDir } }, record: rec });
  servers.push(shell); await listen(shell, shellPort);
  const snapshot = JSON.parse((await raw(`http://127.0.0.1:${sp}/wizard/v1/apps`, { headers: { 'x-wizard-shell-token': token, 'x-wizard-owner-proof': ownerProof } })).body.toString());
  report.serviceFiles = snapshot.apps.find(a => a.id === 'files');
  if (!BASELINE) check(report.serviceFiles?.own_tab === true && report.serviceFiles.url === OWN + '/files/', 'Agent Service: /wizard/v1/apps flags Files own_tab at its own https address');
  else check(report.serviceFiles?.url === '/files/' && !report.serviceFiles.own_tab, 'baseline: Files is a Wizard-origin path (/files/) with no own_tab');
  let browser, page;
  try {
    browser = await chromium.launch({ headless: true, args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1`], ...(process.env.QA_CHROME ? { executablePath: process.env.QA_CHROME } : {}) });
    const context = await browser.newContext({ viewport: { width: 1440, height: 940 }, serviceWorkers: 'block', ignoreHTTPSErrors: true });
    page = await context.newPage(); page.on('pageerror', e => report.errors.push('page: ' + e.message));
    await require('./qa-browser-onboarding.cjs')(page, token, report);
    await page.goto(`${SHELL}/wizard-os-home/desktop.html`);
    await page.waitForFunction(() => window.WizBrowserBoundary?.enabled && window.wizardUX, { timeout: 20000 });
    await page.waitForFunction(() => document.querySelector('.home') && window.WizCore?.apps('desktop')?.APP?.files, null, { timeout: 20000 });
    const tile = await page.evaluate(() => { const a = window.WizCore.apps('desktop').APP.files; return { ownTab: a.ownTab === true, url: a.url }; });
    report.shellTile = tile;
    // ---- Open Files the way the owner does: the app picker (Alt+O), type, Enter (a trusted activation). ----
    const opening = context.waitForEvent('page', { timeout: 8000 }).catch(() => null);
    await page.keyboard.press('Alt+o'); await sleep(400);
    await page.keyboard.type('Files'); await sleep(400);
    await page.keyboard.press('Enter');
    const tab = await opening; await sleep(1500);
    const framesForFiles = await page.evaluate(() => [...document.querySelectorAll('iframe')].filter(f => /\/files\//.test(f.src)).map(f => ({ src: f.src, sandbox: f.getAttribute('sandbox') })));
    report.framesForFiles = framesForFiles;
    if (!BASELINE) {
      check(tile.ownTab && tile.url === OWN + '/files/', 'shell: the Files tile carries ownTab and its own https address');
      check(!!tab && new URL(tab.url()).origin === OWN, 'opening Files from the app picker opens a NEW TAB at Files\' own origin');
      check(framesForFiles.length === 0, 'no Wizard window frames Files (no iframe for /files/ anywhere in the shell)');
      await tab.waitForLoadState('load');
      const nav = freqs.find(r => r.via === 'own-origin' && r.path === '/files/' && r.mode === 'navigate');
      report.tabNavigation = nav;
      check(nav && nav.site === 'same-site' && nav.dest === 'document' && nav.status === 200 && nav.xfo === 'DENY', 'the tab\'s navigation reached Files as a same-site top-level document (200) and its reply says X-Frame-Options DENY');
      const opener = await tab.evaluate(() => ({ opener: window.opener === null, referrer: document.referrer }));
      check(opener.opener && opener.referrer === '', 'the tab has no opener and no referrer (nothing crosses from the shell)');
      // ---- File Browser's own features, unchanged, on its own origin. ----
      await tab.waitForFunction(() => /synthetic|Documents/.test(document.body.innerText), null, { timeout: 20000 });
      await tab.getByText('Documents', { exact: true }).first().dblclick().catch(async () => { await tab.goto(OWN + '/files/files/Documents/'); });
      await tab.waitForFunction(() => /synthetic-notes\.txt/.test(document.body.innerText), null, { timeout: 15000 });
      check(true, 'File Browser lists the synthetic owner folder and file in its own tab');
      // Upload through File Browser's own (tus) uploader: request bodies stream through the gated front.
      const up = path.join(out, 'synthetic-upload.txt'); fs.writeFileSync(up, 'x'.repeat(300 * 1024));
      await tab.locator('input[type=file]').first().setInputFiles(up);
      for (let i = 0; i < 100 && !fs.existsSync(path.join(srv, 'Documents/synthetic-upload.txt')); i++) await sleep(150);
      await sleep(500);
      check(fs.existsSync(path.join(srv, 'Documents/synthetic-upload.txt')) && fs.statSync(path.join(srv, 'Documents/synthetic-upload.txt')).size === 300 * 1024, 'File Browser\'s own upload (300 KiB, tus) lands byte-complete through the gated front');
      await tab.waitForFunction(() => /synthetic-upload\.txt/.test(document.body.innerText), null, { timeout: 10000 }).catch(() => {});
      const tabShot = path.join(out, 'files-own-tab.png'); await tab.screenshot({ path: tabShot }); report.screenshots.push(tabShot);
      const authCookie = (await context.cookies(OWN)).find(c => c.name === 'auth');
      report.fileBrowserCookie = authCookie ? { name: authCookie.name, path: authCookie.path, sameSite: authCookie.sameSite, domain: authCookie.domain } : null;
    }
    // ---- Hostile 1: an installed app in a Wizard window (opaque sandboxed frame) aims at Files. ----
    await page.bringToFront();
    await page.evaluate(() => dispatchEvent(new CustomEvent('wizard:open', { detail: { path: '/hostile-notes/' } })));
    const hostileFrame = await require('./qa-browser-frame.cjs')(page, '/hostile-notes/');
    const sandbox = await page.locator('iframe[src*="/hostile-notes/"]').getAttribute('sandbox');
    check(sandbox === 'allow-scripts allow-forms allow-downloads', 'the hostile app runs in the opaque sandboxed frame');
    const mark = Date.now();
    const target = BASELINE ? SHELL : OWN;
    const fromFrame = await hostileFrame.evaluate(async t => {
      const r = { origin: self.origin };
      try { const x = await fetch(t + '/files/api/resources/Documents/', { credentials: 'include' }); r.cors = x.status; } catch (e) { r.cors = 'blocked'; }
      try { await fetch(t + '/files/api/login', { method: 'POST', mode: 'no-cors', credentials: 'include', body: '{}' }); r.loginPost = 'sent'; } catch (e) { r.loginPost = 'blocked'; }
      r.img = await new Promise(res => { const i = new Image(); i.onload = () => res('loaded'); i.onerror = () => res('error'); i.src = t + '/files/api/raw/Documents/synthetic-notes.txt'; });
      r.frame = await new Promise(res => { const f = document.createElement('iframe'); f.src = t + '/files/'; f.onload = () => res('load-event'); document.body.append(f); setTimeout(() => res('no-load'), 4000); });
      return r;
    }, target);
    await sleep(800);
    report.hostileFrame = fromFrame;
    const frameHits = freqs.filter(r => r.path.startsWith('/files/') && (r.origin === 'null' || r.site === 'cross-site'));
    report.hostileFrameServerSide = frameHits;
    if (!BASELINE) {
      check(fromFrame.origin === 'null' && fromFrame.cors === 'blocked', 'hostile frame: its credentialed CORS read of /files/api/resources fails in the browser');
      check(frameHits.length >= 4 && frameHits.every(r => r.status === 403), `server-side: all ${frameHits.length} requests from the opaque frame to Files' origin (fetch, no-cors login POST, <img>, nested <iframe>) were refused 403 by the Files front`);
      check(frameHits.some(r => r.dest === 'iframe' && r.status === 403 && r.xfo === 'DENY'), 'the nested <iframe> of Files was refused (Sec-Fetch-Dest iframe → 403, X-Frame-Options DENY)');
      check(frameHits.some(r => r.method === 'POST' && r.path === '/files/api/login' && r.status === 403), 'the no-cors POST to File Browser\'s noauth login never reached File Browser (403)');
    } else {
      report.baselineFrameStatuses = frameHits.map(r => `${r.method} ${r.path} ${r.dest} → ${r.status}`);
      check(framesForFiles.length >= 1 && framesForFiles.every(f => f.sandbox === 'allow-scripts allow-forms allow-downloads'), 'BASELINE: Files opens framed (opaque sandbox) in a Wizard window');
      check(frameHits.some(r => r.method === 'POST' && r.path === '/files/api/login' && r.status === 200), 'BASELINE: the hostile frame\'s no-cors POST reached File Browser\'s noauth login (200, a JWT minted; body unreadable)');
    }
    // ---- Hostile 2: an app's own top-level tab on the Wizard origin (same-site to Files' port, carries its cookie). ----
    const appTab = await context.newPage(); appTab.on('pageerror', e => report.errors.push('app tab: ' + e.message));
    await appTab.goto(`${SHELL}/hostile-notes/`);
    const mark2 = Date.now();
    const fromTab = await appTab.evaluate(async ({ own, baseline }) => {
      const r = {};
      // Wizard-origin path (baseline: Files itself; candidate: the old route).
      try { const l = await fetch('/files/api/login', { method: 'POST', body: '{}' }); r.wizardLogin = l.status; const jwt = l.ok ? await l.text() : '';
        const x = await fetch('/files/api/resources/Documents/', { headers: jwt ? { 'X-Auth': jwt } : {} }); r.wizardList = x.status; r.wizardSawFile = x.ok && /synthetic-notes/.test(await x.text()); } catch (e) { r.wizardLogin = 'blocked'; }
      if (!baseline) { try { const x = await fetch(own + '/files/api/resources/Documents/', { credentials: 'include' }); r.ownSameSite = x.status; } catch (e) { r.ownSameSite = 'blocked'; } }
      return r;
    }, { own: OWN, baseline: BASELINE });
    await sleep(500);
    report.hostileTab = fromTab;
    if (!BASELINE) {
      const tabHits = freqs.filter(r => r.at >= mark2 && r.via === 'own-origin');
      report.hostileTabServerSide = tabHits;
      check(fromTab.wizardLogin === 403 && fromTab.wizardList === 403 && !fromTab.wizardSawFile, 'same-origin app tab: the old /files/ route on the Wizard origin is refused 403 by the Files front (Host is not Files\' own address)');
      check(fromTab.ownSameSite === 'blocked' && tabHits.length >= 1 && tabHits.every(r => r.status === 403 && r.site === 'same-site'), 'same-origin app tab → Files\' own origin: same-site request refused 403 server-side');
      if (report.fileBrowserCookie) check(tabHits.some(r => r.cookie), 'that refused request carried File Browser\'s auth cookie (host-scoped, SameSite=Strict still sends it same-site); the front refused it anyway');
    } else {
      check(fromTab.wizardLogin === 200 && fromTab.wizardList === 200 && fromTab.wizardSawFile === true, 'BASELINE: a same-origin app tab gets a File Browser JWT from /files/api/login and lists the owner\'s files (200)');
    }
    // Direct listener probes (no browser): the boundary headers on every reply, and the owner gate kept.
    if (!BASELINE) {
      const direct = await raw(`http://127.0.0.1:${frontPort}/files/`, { headers: { host: `${HOST}:${filesPort}`, 'tailscale-user-login': 'owner@example.com', 'x-forwarded-for': '100.64.0.7', 'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' } });
      check(direct.status === 200 && direct.headers['x-frame-options'] === 'DENY' && /frame-ancestors 'none'/.test(direct.headers['content-security-policy'] || '') && direct.headers['cross-origin-opener-policy'] === 'same-origin', 'Files\' own page: X-Frame-Options DENY, frame-ancestors \'none\', COOP same-origin');
      const stranger = await raw(`http://127.0.0.1:${frontPort}/files/api/resources/`, { headers: { host: `${HOST}:${filesPort}`, 'tailscale-user-login': 'stranger@example.com', 'x-forwarded-for': '100.64.0.9' } });
      check(stranger.status === 403, 'owner gate kept: another tailnet login is refused (403)');
    }
    const shot = path.join(out, BASELINE ? 'baseline-shell-files-frame.png' : 'shell-after-own-tab.png');
    if (BASELINE) { await page.bringToFront(); await page.evaluate(() => dispatchEvent(new CustomEvent('wizard:open', { detail: { path: '/files/' } }))); await sleep(2500); }
    await page.screenshot({ path: shot }); report.screenshots.push(shot);
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
