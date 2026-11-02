// Real Chromium + real Agent Service + REAL WAM install/grant state + REAL Notifications front (stub ntfy).
// The Notifications data path is admitted only through data.call -> Service -> WAM apps.json `browser` facts.
// A Node stand-in replaces nginx for the shell document rules (same template headers/token injection).
// Synthetic data only; never a live box. Env: QA_OUT, QA_SERVICE_ROOT, QA_WAM_ROOT, QA_NOTIFICATIONS_ROOT,
// QA_PYTHON (Python with PyYAML), optional QA_PLAYWRIGHT / QA_CHROME.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict'), { spawn, execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url'), crypto = require('node:crypto');
const appFrame = require('./qa-browser-frame.cjs');
const root = path.resolve(process.env.QA_UX_ROOT || path.join(__dirname, '..')), out = process.env.QA_OUT;
const { chromium } = require(path.join(root, 'tools/qa-playwright.cjs'));
for (const k of ['QA_OUT', 'QA_SERVICE_ROOT', 'QA_WAM_ROOT', 'QA_NOTIFICATIONS_ROOT', 'QA_PYTHON']) if (!process.env[k]) throw new Error(k + ' is required');
fs.mkdirSync(out, { recursive: true });
const token = crypto.randomBytes(32).toString('hex'), ownerProof = crypto.randomBytes(32).toString('hex');
const web = path.join(root, 'web'), fixtureRoot = path.join(root, 'tests/fixtures/browser-trust');
const listen = server => new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const close = s => new Promise(r => { s.closeAllConnections?.(); s.close(r); });
const report = { candidate: true, nativeProven: false, realStoreInstallProven: false, nginxStandIn: 'node', checks: [], screenshots: [], errors: [], wam: [] };
const check = (value, name) => { assert.ok(value, name); report.checks.push(name); };
const box = path.join(out, 'box');
const wam = (...args) => { const r = execFileSync(process.env.QA_PYTHON, [path.join(process.env.QA_WAM_ROOT, 'tools/browser_admission_fixture.py'), box, ...args], { encoding: 'utf8' }); report.wam.push(args.join(' ')); return r; };
const appsJson = () => JSON.parse(fs.readFileSync(path.join(box, 'home/apps.json'), 'utf8'));
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const children = [];
(async () => {
  // 1. Real Notifications front (the app's own mcp/front.py + tools.py, as its compose inlines them) over a stub ntfy.
  const now = Math.floor(Date.now() / 1000);
  const messages = [
    { id: 'SynthAAAA0001', time: now - 60, event: 'message', topic: 'wizard', title: 'Synthetic build finished', message: 'Synthetic job output is ready.' },
    { id: 'SynthAAAA0002', time: now - 120, event: 'message', topic: 'wizard', title: 'Synthetic reminder', message: 'Synthetic reminder text.' },
  ];
  const ntfy = http.createServer((req, res) => {
    const topic = new URL(req.url, 'http://x').pathname.split('/')[1];
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.end(messages.filter(m => m.topic === topic).map(m => JSON.stringify(m)).join('\n') + '\n');
  });
  const ntfyPort = await listen(ntfy);
  const nroot = process.env.QA_NOTIFICATIONS_ROOT;
  const frontSrc = ['front.py', 'tools.py', 'minimal_assets.py', 'relay.py'].map(f => fs.readFileSync(path.join(nroot, 'mcp', f), 'utf8')).join('\n\n') + '\n\nif __name__ == "__main__":\n    asyncio.run(main())\n';
  fs.mkdirSync(path.join(box, 'notifications-data'), { recursive: true });
  const frontFile = path.join(out, 'notifications-front.py'); fs.writeFileSync(frontFile, frontSrc);
  const probe = http.createServer(), frontPort = await listen(probe); await close(probe);   // pick a free port for the front
  const front = spawn(process.env.QA_PYTHON, [frontFile], { env: { ...process.env, WIZARD_APP: 'notifications', FRONT_PORT: String(frontPort), UPSTREAM_HOST: '127.0.0.1', UPSTREAM_PORT: String(ntfyPort), INBOX_TOPICS: 'wizard,cron', INBOX_STATE: path.join(box, 'notifications-data/inbox.json') }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(front); let frontLog = ''; front.stdout.on('data', b => frontLog += b); front.stderr.on('data', b => frontLog += b);
  // 2. WAM: real registry writer, owner route for the view, install + owner browser grants.
  fs.mkdirSync(path.join(box, 'home'), { recursive: true });
  fs.writeFileSync(path.join(box, 'home/routes.json'), JSON.stringify({ notifications: { view: '/notifications-adapter/' } }));
  wam('install', 'notifications', '--repo', 'oscarhenrycollins/notifications', '--port', String(frontPort));
  check(appsJson().apps[0].browser.admissible === false && appsJson().apps[0].browser.reason === 'no_grant', 'WAM: installed declaration alone is not admissible');
  wam('grant', 'notifications', 'notifications.list', 'notifications.mark_read');
  report.browserFacts = appsJson().apps[0].browser;
  check(report.browserFacts.admissible && report.browserFacts.source_id === 'standard:oscarhenrycollins/notifications', 'WAM: owner grant recorded for this installation and source');
  check(appsJson().apps[0].view?.url === '/notifications-adapter/', 'WAM: owner route publishes a same-origin view path');
  for (let i = 0; i < 50; i++) { try { const r = await fetch(`http://127.0.0.1:${frontPort}/notifications/healthz`); if (r.ok) break; } catch (_) {} await new Promise(r => setTimeout(r, 100)); }
  // 3. Agent Service with the production WAM resolver (no injected resolver).
  const { createWizardServer } = await import(pathToFileURL(path.join(process.env.QA_SERVICE_ROOT, 'server/service.mjs')));
  const { createHermesFixture } = await import(pathToFileURL(path.join(process.env.QA_SERVICE_ROOT, 'server/fixture.mjs')));
  const hermes = createHermesFixture({ expectedKey: 'boundary-fixture-only' }); const hp = await listen(hermes);
  const svcHome = path.join(out, 'service-home'); fs.mkdirSync(svcHome, { recursive: true });
  const receiptsPath = path.join(out, 'service-state/browser-operation-receipts.json');
  const service = createWizardServer({ upstreamOrigin: `http://127.0.0.1:${hp}`, hermesKey: 'boundary-fixture-only', requireAccess: false, ownerProof,
    browserBoundary: { enabled: true, token }, hermesHome: path.join(svcHome, 'hermes'), wizardOsHome: path.join(box, 'home'),
    appsJsonPath: path.join(box, 'home/apps.json'), settingsPath: path.join(svcHome, 'settings.json'), launcherPath: path.join(svcHome, 'launcher.json'),
    agentBridge: false, followThrough: false, joinedDelegation: 'off', browserAdapterWam: { receiptsPath } });
  const trace = []; report.serviceTrace = trace;
  service.on('request', (req, res) => res.on('finish', () => trace.push({ method: req.method, path: new URL(req.url, 'http://x').pathname, status: res.statusCode, origin: req.headers.origin || '', hasShellToken: typeof req.headers['x-wizard-shell-token'] === 'string' })));
  const sp = await listen(service);
  // 4. nginx stand-in: browser-boundary-document.conf.template rules for the shell documents, static web/, fixtures, /wizard/ proxy.
  const tpl = fs.readFileSync(path.join(root, 'packaging/browser-boundary-document.conf.template'), 'utf8');
  const docHeaders = [...tpl.matchAll(/add_header ([A-Za-z-]+) "([^"]*)" always;/g)].map(m => [m[1], m[2]]);
  const inject = tpl.match(/sub_filter '<head>' '([^']*)';/)[1].replace('${WIZARD_SHELL_TOKEN}', token);
  const serveFile = (res, file, extra = {}) => { if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', ...extra }); res.end(fs.readFileSync(file)); };
  const proxy = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'), p = u.pathname;
    const doc = p.match(/^\/(?:wizard-os-home|wizard-ux)\/(|index\.html|desktop\.html)$/);
    if (doc) {
      if (req.headers['sec-fetch-dest'] !== 'document' || req.headers['sec-fetch-mode'] !== 'navigate' || req.method !== 'GET') { res.writeHead(403); return res.end(); }
      const html = fs.readFileSync(path.join(web, doc[1] || 'index.html'), 'utf8').replace('<head>', '<head>' + inject);
      res.writeHead(200, { 'Content-Type': 'text/html', ...Object.fromEntries(docHeaders) }); return res.end(html);
    }
    if (p.startsWith('/wizard-os-home/')) return serveFile(res, path.join(web, path.normalize(p.slice('/wizard-os-home/'.length)).replace(/^(\.\.[/\\])+/, '')));
    if (p === '/fixture-assets/styles.css') return serveFile(res, path.join(fixtureRoot, 'styles.css'));
    if (p === '/notifications-adapter/') return serveFile(res, path.join(fixtureRoot, 'notifications-adapter/index.html'));
    if (p === '/notifications-adapter/fixture.js') return serveFile(res, path.join(fixtureRoot, 'notifications-adapter/fixture.js'));
    if (p.startsWith('/wizard/')) {
      const up = http.request({ host: '127.0.0.1', port: sp, method: req.method, path: req.url, headers: { ...req.headers, 'x-wizard-owner-proof': ownerProof } }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
      up.on('error', () => { res.writeHead(502); res.end(); }); return req.pipe(up);
    }
    res.writeHead(404); res.end();
  });
  const np = await listen(proxy);
  let browser, page;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME ? { executablePath: process.env.QA_CHROME } : {}) });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    page = await context.newPage(); page.on('pageerror', e => report.errors.push(e.message));
    await require('./qa-browser-onboarding.cjs')(page, token, report);
    await page.goto(`http://127.0.0.1:${np}/wizard-os-home/desktop.html`);
    await page.waitForFunction(() => window.WizBrowserBoundary?.enabled && window.wizardUX, { timeout: 20000 });
    const open = async () => {
      await page.evaluate(() => dispatchEvent(new CustomEvent('wizard:open', { detail: { path: '/notifications-adapter/' } })));
      const frame = await appFrame(page, '/notifications-adapter/');
      await frame.waitForFunction(() => window.WizBoundaryClient?.ready, null, { timeout: 15000 });
      return frame;
    };
    let app = await open();
    check(await page.locator('iframe[src*="/notifications-adapter/"]').getAttribute('sandbox') === 'allow-scripts allow-forms allow-downloads', 'Notifications view is an opaque sandboxed frame (no allow-same-origin)');
    await app.waitForFunction(() => /^Loaded 2/.test(document.querySelector('#status').textContent), null, { timeout: 15000 });
    check((await app.locator('#items').textContent()).includes('Synthetic build finished'), 'data.call notifications.list renders real Notifications front items');
    check(trace.some(r => r.path === '/wizard/v1/browser-adapters/bindings' && r.status === 200 && r.hasShellToken), 'binding created by the shell with possession (server trace)');
    // Mark read: same-frame feedback, then durable result, backend disk readback, list readback.
    const target = 'SynthAAAA0001';
    const btn = app.locator(`li[data-id="${target}"] button`);
    await btn.dispatchEvent('pointerdown');
    check(await btn.evaluate(b => b.classList.contains('pressed')), 'same-frame tap feedback on Mark read');
    await btn.click();
    await app.waitForFunction(id => document.querySelector('#status').textContent === 'Saved: ' + id, target, { timeout: 15000 });
    const inbox = JSON.parse(fs.readFileSync(path.join(box, 'notifications-data/inbox.json'), 'utf8'));
    check(inbox[target]?.read === true, 'Notifications backend persisted the mark (inbox.json readback)');
    const direct = await (await fetch(`http://127.0.0.1:${frontPort}/notifications/api/items?view=inbox&limit=50`)).json();
    check(direct.items.find(i => i.id === target)?.read === true && direct.items.find(i => i.id === 'SynthAAAA0002')?.read === false, 'Notifications API readback: only the requested item changed');
    const receipts = Object.values(JSON.parse(fs.readFileSync(receiptsPath, 'utf8')).receipts);
    check(receipts.length === 1 && receipts[0].status === 'succeeded' && receipts[0].operation === 'notifications.mark_read', 'durable outcome receipt written by the Service');
    await app.evaluate(() => window.qaReload());
    await app.waitForFunction(id => document.querySelector(`li[data-id="${id}"]`)?.dataset.read === 'true', target);
    check(true, 'data.call list readback shows the item read');
    // Hostile attempts from the opaque frame.
    const hostile = await app.evaluate(async () => {
      const r = {};
      for (const [k, req] of Object.entries({ unknown: { operation: 'owner.fetch', args: {} }, forged: { operation: 'notifications.list', args: { limit: 1, cursor: null }, appId: 'profiles' } })) {
        try { await WizardApp.data.call(req); r[k] = 'ALLOWED'; } catch (e) { r[k] = e.code; }
      }
      try { await fetch('/wizard/v1/browser-adapters/call', { method: 'POST', mode: 'no-cors', body: '{}' }); } catch (_) {}
      try { await fetch('/wizard/v1/browser-adapters/bindings', { method: 'POST', mode: 'no-cors', body: JSON.stringify({ appId: 'notifications', generation: crypto.randomUUID() }) }); } catch (_) {}
      return r;
    });
    check(hostile.unknown === 'not_allowed' && hostile.forged === 'bad_request', 'frame cannot call unknown operations or forge a principal');
    check(trace.some(r => r.origin === 'null' && r.path === '/wizard/v1/browser-adapters/call' && [401, 403].includes(r.status) && !r.hasShellToken), 'direct frame adapter call refused server-side (trace, not CORS)');
    check(trace.some(r => r.origin === 'null' && r.path === '/wizard/v1/browser-adapters/bindings' && [401, 403].includes(r.status) && !r.hasShellToken), 'direct frame binding creation refused server-side');
    // Screenshots on two accepted skins, opaque text panels.
    for (const skin of ['nebula', 'grove']) {
      await page.evaluate(s => { WosSkin.set(s); WizAppearance.sync(); }, skin);
      await app.waitForFunction(s => document.documentElement.dataset.skin === s, skin);
      await page.waitForTimeout(300);
      const opaque = await app.evaluate(() => [...document.querySelectorAll('#status, #items li')].every(el => { const c = document.createElement('canvas'); c.width = c.height = 1; const x = c.getContext('2d'); x.fillStyle = getComputedStyle(el).backgroundColor; x.fillRect(0, 0, 1, 1); return x.getImageData(0, 0, 1, 1).data[3] === 255; }));
      check(opaque, 'text-bearing panels fully opaque on ' + skin);
      check(await app.evaluate(() => document.documentElement.hasAttribute('data-wz-hosted')), 'Appearance v1 hosted on ' + skin);
      const shot = path.join(out, `notifications-${skin}.png`); await page.screenshot({ path: shot }); report.screenshots.push(shot);
    }
    await page.evaluate(() => dispatchEvent(new CustomEvent('wizard:back')));
    await page.waitForTimeout(300);
    check(!page.isClosed() && page.url().includes('/wizard-os-home/desktop.html'), 'Back stays in the shell');
    // Revocation through WAM's real CLI: the next mark is refused at the server; nothing changes upstream.
    wam('revoke', 'notifications', 'notifications.mark_read');
    const second = 'SynthAAAA0002', callsBefore = trace.filter(r => r.path === '/wizard/v1/browser-adapters/call').length;
    await app.locator(`li[data-id="${second}"] button`).click();
    await app.waitForFunction(() => /^Not saved/.test(document.querySelector('#status').textContent), null, { timeout: 15000 });
    report.afterRevoke = await app.locator('#status').textContent();
    check(report.afterRevoke === 'Not saved (revoked)', 'open binding revoked after WAM grant change (no save claimed)');
    check(trace.filter(r => r.path === '/wizard/v1/browser-adapters/call').slice(callsBefore).some(r => r.status === 403), 'revoked mark refused by the server (403 in trace)');
    check(JSON.parse(fs.readFileSync(path.join(box, 'notifications-data/inbox.json'), 'utf8'))[second]?.read !== true, 'revoked mark never reached the Notifications backend');
    // Reload the app document: the shell revokes the old channel/binding and the next call binds afresh.
    await page.evaluate(() => { const f = document.querySelector('iframe[src*="/notifications-adapter/"]'); f.src = f.src; });
    app = await appFrame(page, '/notifications-adapter/');
    await app.waitForFunction(() => window.WizBoundaryClient?.ready, null, { timeout: 15000 });
    await app.waitForFunction(() => /^Loaded 2/.test(document.querySelector('#status').textContent), null, { timeout: 15000 });
    await app.locator(`li[data-id="${second}"] button`).click();
    await app.waitForFunction(() => /^Not saved/.test(document.querySelector('#status').textContent), null, { timeout: 15000 });
    check(await app.locator('#status').textContent() === 'Not saved (not_allowed)', 'fresh binding: list still granted, mark_read not granted');
    // Uninstall through WAM: everything refused.
    wam('uninstall', 'notifications');
    await app.evaluate(() => window.qaReload());
    await app.waitForFunction(() => /^Unavailable/.test(document.querySelector('#status').textContent), null, { timeout: 15000 });
    report.afterUninstall = await app.locator('#status').textContent();
    check(['Unavailable: not_allowed', 'Unavailable: revoked'].includes(report.afterUninstall), 'uninstalled app refused at the server');
    // Dark standalone fallback (no shell, no authority).
    const dark = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', colorScheme: 'dark' });
    const standalone = await dark.newPage(); await standalone.goto(`http://127.0.0.1:${np}/notifications-adapter/`);
    await standalone.waitForTimeout(500);
    check(await standalone.evaluate(() => getComputedStyle(document.documentElement).colorScheme === 'dark' && getComputedStyle(document.body).backgroundColor !== 'rgba(0, 0, 0, 0)'), 'standalone view has an opaque dark fallback and no data authority');
    check(/Connecting/.test(await standalone.locator('#status').textContent()), 'standalone view gets no data without the shell');
    const darkShot = path.join(out, 'notifications-standalone-dark.png'); await standalone.screenshot({ path: darkShot }); report.screenshots.push(darkShot);
    await dark.close(); await context.close();
    report.frontLogTail = frontLog.slice(-2000);
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: true, checks: report.checks.length, screenshots: report.screenshots }, null, 2));
  } catch (error) {
    report.failure = error.stack; report.frontLogTail = frontLog.slice(-2000);
    try { report.statusText = await page?.frames().find(f => f.url().includes('/notifications-adapter/'))?.locator('#status').textContent(); } catch (_) {}
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2));
    throw error;
  } finally {
    await browser?.close();
    for (const c of children) c.kill('SIGTERM');
    await Promise.all([close(proxy), close(service), close(ntfy)]);
    await hermes.closeFixture?.();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
