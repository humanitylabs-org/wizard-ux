// Real Chromium + nginx + Agent Service acceptance. Synthetic app/data only.
// Run on the dedicated QA host with QA_SERVICE_ROOT, QA_OUT, QA_NGINX_MIME,
// QA_PLAYWRIGHT set. This is candidate proof, NOT installation/native proof.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict'), { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url'), crypto = require('node:crypto');
const { chromium } = require('../tools/qa-playwright.cjs');
const root = path.resolve(__dirname, '..'), out = process.env.QA_OUT;
if (!out || !process.env.QA_SERVICE_ROOT) throw new Error('QA_OUT and QA_SERVICE_ROOT are required');
fs.mkdirSync(out, { recursive: true });
const serviceRoot = process.env.QA_SERVICE_ROOT;
const token = crypto.randomBytes(32).toString('hex');
const web = path.join(root, 'web');
const listen = server => new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const close = s => new Promise(r => { s.closeAllConnections?.(); s.close(r); });
const report = { candidate: true, nativeProven: false, realStoreInstallProven: false, checks: [], screenshots: [], errors: [] };
const check = (value, name) => { assert.ok(value, name); report.checks.push(name); };
(async () => {
  const { createWizardServer } = await import(pathToFileURL(path.join(serviceRoot, 'server/service.mjs')));
  const { createHermesFixture } = await import(pathToFileURL(path.join(serviceRoot, 'server/fixture.mjs')));
  const hermes = createHermesFixture({ expectedKey: 'boundary-fixture-only' });
  const hp = await listen(hermes);
  const home = path.join(out, 'synthetic-home'); fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'apps.json'), JSON.stringify({ schema: 1, apps: [{ id: 'boundary-fixture', name: 'Boundary fixture', status: 'running', view: { url: '/fixture-app/' } }] }));
  const service = createWizardServer({ upstreamOrigin: `http://127.0.0.1:${hp}`, hermesKey: 'boundary-fixture-only', requireAccess: false,
    browserBoundary: { enabled: true, token }, wizardOsHome: home,
    appsJsonPath: path.join(home, 'apps.json'), settingsPath: path.join(home, 'settings.json'),
    launcherPath: path.join(home, 'launcher.json'), agentBridge: false, followThrough: false, joinedDelegation: 'off' });
  const sp = await listen(service);
  const fixture = http.createServer((req, res) => {
    if (req.url === '/fixture-app/app.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(`
      let nested = false;
      WizardApp.back.register({ canGoBack: () => nested, back() { nested = false; document.querySelector('#state').textContent = 'Root'; return true; } });
      document.querySelector('button').onclick = () => { nested = true; document.querySelector('#state').textContent = 'Nested'; };
      window.probe = async () => {
        const p = {};
        try { p.parent = parent.document.documentElement.outerHTML; } catch (_) { p.parentDenied = true; }
        try { p.storage = localStorage.length; } catch (_) { p.storageDenied = true; }
        try { p.chats = await (await fetch('/wizard/hermes/api/sessions')).text(); } catch (_) { p.chatsDenied = true; }
        try { p.html = await (await fetch('/wizard-os-home/desktop.html')).text(); } catch (_) { p.htmlDenied = true; }
        try { await fetch('/wizard/v1/setup/seen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch (_) { p.mutationDenied = true; }
        p.nativeAbsent = !window.WizardOSNative && !window.WizardOSDevice && !window.WizardNative && !window.webkit?.messageHandlers?.wizardNative;
        return p;
      };
    `); }
    res.setHeader('Content-Type', 'text/html'); res.end(`<!doctype html><html><head><meta charset="utf-8"><script src="/wizard-os-home/core/browser-boundary-client.js"></script><script src="/wizard-os-home/core/app-client.js"></script><style>html,body{margin:0;background:transparent;color:var(--wz-text,#eee);font:18px system-ui}main{padding:32px}button,input{font:inherit;padding:12px;margin:12px 0;color:inherit;background:var(--wz-surface,#222);border:1px solid var(--wz-border,#555);border-radius:12px}input{display:block}</style></head><body><main><h1>Boundary fixture</h1><p>Opaque origin · no owner authority</p><p id="state">Root</p><button>Open nested view</button><input value="Hello" aria-label="Dictation field"></main><script src="/fixture-app/app.js"></script></body></html>`);
  });
  const fp = await listen(fixture);
  const socket = http.createServer(); const np = await listen(socket); await close(socket);
  const doc = fs.readFileSync(path.join(root, 'packaging/browser-boundary-document.conf.template'), 'utf8').replace('${WIZARD_SHELL_TOKEN}', token);
  const docPath = path.join(out, 'document.conf'); fs.writeFileSync(docPath, doc);
  let exact = '';
  for (const prefix of ['wizard-os-home', 'wizard-ux']) for (const page of ['', 'index.html', 'desktop.html']) exact += `location = /${prefix}/${page} { root ${web}; try_files /${page || 'index.html'} =404; include ${docPath}; }\n`;
  const config = `worker_processes 1; pid ${path.join(out, 'nginx.pid')}; error_log ${path.join(out, 'nginx.log')}; events { worker_connections 256; } http { include ${process.env.QA_NGINX_MIME || '/etc/nginx/mime.types'}; access_log off; server { listen 127.0.0.1:${np}; ${exact} location /wizard-os-home/ { alias ${web}/; } location /fixture-app/ { proxy_pass http://127.0.0.1:${fp}; } location /wizard/ { proxy_pass http://127.0.0.1:${sp}; } location / { return 404; } } }`;
  const configPath = path.join(out, 'nginx.conf'); fs.writeFileSync(configPath, config);
  const nginx = spawn(process.env.QA_NGINX || 'nginx', ['-c', configPath, '-g', 'daemon off;'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = ''; nginx.stderr.on('data', b => { stderr += b; });
  let browser;
  try {
    let available = false;
    for (let i = 0; i < 30; i++) { try { const r = await fetch(`http://127.0.0.1:${np}/wizard-os-home/core/browser-boundary.js`); if (r.ok) { available = true; break; } } catch (_) {} await new Promise(r => setTimeout(r, 100)); }
    assert.ok(available, 'nginx readiness: ' + stderr);
    browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME ? { executablePath: process.env.QA_CHROME } : {}) });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    const page = await context.newPage(); page.on('pageerror', e => report.errors.push(e.message));
    await page.goto(`http://127.0.0.1:${np}/wizard-os-home/desktop.html?open=boundary-fixture`);
    await page.waitForFunction(() => window.WizBrowserBoundary?.enabled && window.wizardUX, { timeout: 15000 });
    check(await page.locator('meta[name="wizard-shell-token"]').count() === 0, 'bootstrap secret removed from shell DOM');
    check(await page.evaluate(async () => (await fetch('/wizard/v1/settings')).status) === 200, 'real shell fetch reaches token-gated service');
    await page.evaluate(() => dispatchEvent(new CustomEvent('wizard:open', { detail: { path: '/fixture-app/' } })));
    await page.waitForFunction(() => [...document.querySelectorAll('iframe')].some(f => f.src.includes('/fixture-app/')));
    const app = page.frames().find(f => f.url().includes('/fixture-app/'));
    await app.waitForFunction(() => typeof window.probe === 'function');
    check(await page.locator('iframe[src*="/fixture-app/"]').getAttribute('sandbox') === 'allow-scripts allow-forms allow-downloads', 'real shell render sandboxes app without same-origin/top-navigation/popups');
    const probe = await app.evaluate(() => window.probe());
    report.hostileProbe = probe;
    for (const field of ['parentDenied', 'storageDenied', 'chatsDenied', 'htmlDenied', 'mutationDenied', 'nativeAbsent']) check(probe[field] === true, `hostile frame: ${field}`);
    await app.locator('button').click();
    check(await app.locator('#state').textContent() === 'Nested', 'nested app view opened');
    await page.evaluate(() => dispatchEvent(new CustomEvent('wizard:back')));
    await app.waitForFunction(() => document.querySelector('#state').textContent === 'Root');
    check(!page.isClosed() && page.url().includes('/wizard-os-home/desktop.html'), 'shell Back consumes one nested app step without leaving');
    await app.locator('input').click();
    const pinned = await page.evaluate(async () => { const f = document.querySelector('iframe[src*="/fixture-app/"]'); window.testPin = await WizBrowserBoundary.pinField(f); return !!window.testPin; });
    check(pinned, 'field pin acknowledged by opaque client');
    check(await page.evaluate(() => window.testPin.insert('world')), 'field insertion acknowledged, not fire-and-forget');
    check(await app.locator('input').inputValue() === 'Hello world', 'dictation bridge inserts only in pinned field');
    await app.locator('input').click();
    await page.evaluate(async () => { window.testPin = await WizBrowserBoundary.pinField(document.querySelector('iframe[src*="/fixture-app/"]')); });
    await app.locator('input').fill('Changed');
    check(!(await page.evaluate(() => window.testPin.insert('must not insert'))), 'edited field refuses stale voice insertion');
    for (const skin of ['nebula', 'sepia']) {
      await page.evaluate(s => { document.documentElement.dataset.skin = s; window.WosSkin?.set?.(s); window.WizAppearance.sync(); }, skin);
      await app.waitForFunction(s => document.documentElement.dataset.skin === s, skin);
      await page.waitForFunction(() => document.querySelector('iframe[src*="/fixture-app/"]')?.closest('.win')?.classList.contains('wz-themed'));
      const shot = path.join(out, `shell-${skin}.png`); await page.screenshot({ path: shot }); report.screenshots.push(shot);
      check(await app.evaluate(() => document.documentElement.hasAttribute('data-wz-hosted')), `in-shell Appearance v1 ${skin}`);
    }
    check((await fetch(`http://127.0.0.1:${np}/wizard-os-home/desktop.html`)).status === 403, 'credential-bearing HTML refuses non-navigation fetch');
    // A frame cannot self-grant an API/native/install operation via this bridge.
    await app.evaluate(() => parent.postMessage({ type: 'wizard:app:request', version: 1, op: 'fetch', args: { path: '/wizard/v1/settings' } }, '*'));
    check(await page.evaluate(() => typeof WizBrowserBoundary.fetch === 'undefined'), 'no generic privileged app fetch RPC');
    await context.close();
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    report.failure = error.stack; fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2));
    throw error;
  } finally {
    await browser?.close(); nginx.kill('SIGTERM');
    await Promise.all([close(fixture), close(service)]);
    await hermes.closeFixture();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
