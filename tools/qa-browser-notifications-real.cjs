// Card 2: the REAL Notifications app UI (both screens: the original inbox and the minimal one on Miguel's skins)
// inside the opaque frame, over typed data.call operations only. Real Chromium + real Agent Service + REAL WAM
// install/grant state from the app's own wizard.md + REAL Notifications front (its mcp/*.py, over a stub ntfy).
// A Node stand-in replaces nginx for the shell document rules (same template headers/token injection) and passes
// /notifications/* byte for byte to the front, recording who asked. Synthetic data only; never a live box.
// Env: QA_OUT, QA_SERVICE_ROOT, QA_WAM_ROOT, QA_NOTIFICATIONS_ROOT, QA_PYTHON (with PyYAML), optional QA_PLAYWRIGHT / QA_CHROME.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict'), { spawn, execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url'), crypto = require('node:crypto');
const appFrame = require('./qa-browser-frame.cjs');
const root = path.resolve(process.env.QA_UX_ROOT || path.join(__dirname, '..')), out = process.env.QA_OUT;
const { chromium } = require(path.join(root, 'tools/qa-playwright.cjs'));
for (const k of ['QA_OUT', 'QA_SERVICE_ROOT', 'QA_WAM_ROOT', 'QA_NOTIFICATIONS_ROOT', 'QA_PYTHON']) if (!process.env[k]) throw new Error(k + ' is required');
fs.mkdirSync(out, { recursive: true });
const token = crypto.randomBytes(32).toString('hex'), ownerProof = crypto.randomBytes(32).toString('hex');
const web = path.join(root, 'web'), nroot = path.resolve(process.env.QA_NOTIFICATIONS_ROOT);
const listen = server => new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const close = s => new Promise(r => { s.closeAllConnections?.(); s.close(r); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const report = { candidate: true, nativeProven: false, realStoreInstallProven: false, nginxStandIn: 'node', checks: [], open: [], screenshots: [], errors: [], wam: [], notificationsRequests: [] };
const check = (value, name) => { assert.ok(value, name); report.checks.push(name); };
const box = path.join(out, 'box');
const wam = (...args) => { const r = execFileSync(process.env.QA_PYTHON, [path.join(process.env.QA_WAM_ROOT, 'tools/browser_admission_fixture.py'), box, ...args], { encoding: 'utf8' }); report.wam.push(args.join(' ')); return r; };
const appsJson = () => JSON.parse(fs.readFileSync(path.join(box, 'home/apps.json'), 'utf8'));
const marks = () => { try { return JSON.parse(fs.readFileSync(path.join(box, 'notifications-data/inbox.json'), 'utf8')); } catch (_) { return {}; } };
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const children = [];
// A synthetic 320x200 gradient PNG for the thumbnail path (no owner content).
const PNG = (() => {
  const zlib = require('node:zlib'), w = 320, h = 200, raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = 40 + x * 0.6; raw[o + 1] = 90 + y * 0.6; raw[o + 2] = 200 - x * 0.3; } }
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
})();
(async () => {
  // 1. Real Notifications front over a stub ntfy, with one synthetic picture under an allowed media root.
  const now = Math.floor(Date.now() / 1000);
  const media = path.join(out, 'media'); fs.mkdirSync(media, { recursive: true });
  const pic = path.join(media, 'synthetic-chart.png'); fs.writeFileSync(pic, PNG);
  const messages = [
    { id: 'SynthBBBB0001', time: now - 60, event: 'message', topic: 'wizard', title: 'Synthetic chart ready', message: `The synthetic weekly chart is ready.\nMEDIA:${pic}` },
    { id: 'SynthBBBB0002', time: now - 120, event: 'message', topic: 'wizard', title: 'Synthetic backup failed', message: 'Synthetic backup could not reach the disk.', priority: 4 },
    { id: 'SynthBBBB0003', time: now - 180, event: 'message', topic: 'cron', title: 'Synthetic nightly report', message: 'Synthetic: 3 jobs ran. Details at https://example.invalid/report', tags: ['cron'] },
  ];
  const ntfy = http.createServer((req, res) => {
    const topic = new URL(req.url, 'http://x').pathname.split('/')[1];
    res.setHeader('Content-Type', 'application/x-ndjson');
    res.end(messages.filter(m => m.topic === topic).map(m => JSON.stringify(m)).join('\n') + '\n');
  });
  const ntfyPort = await listen(ntfy);
  const frontSrc = ['front.py', 'tools.py', 'minimal_assets.py', 'relay.py'].map(f => fs.readFileSync(path.join(nroot, 'mcp', f), 'utf8')).join('\n\n') + '\n\nif __name__ == "__main__":\n    asyncio.run(main())\n';
  fs.mkdirSync(path.join(box, 'notifications-data'), { recursive: true });
  const frontFile = path.join(out, 'notifications-front.py'); fs.writeFileSync(frontFile, frontSrc);
  const probe = http.createServer(), frontPort = await listen(probe); await close(probe);
  const front = spawn(process.env.QA_PYTHON, [frontFile], { env: { ...process.env, WIZARD_APP: 'notifications', FRONT_PORT: String(frontPort), UPSTREAM_HOST: '127.0.0.1', UPSTREAM_PORT: String(ntfyPort), INBOX_TOPICS: 'wizard,cron', INBOX_STATE: path.join(box, 'notifications-data/inbox.json'), INBOX_MEDIA_ROOTS: media }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(front); let frontLog = ''; front.stdout.on('data', b => frontLog += b); front.stderr.on('data', b => frontLog += b);
  for (let i = 0; i < 50; i++) { try { const r = await fetch(`http://127.0.0.1:${frontPort}/notifications/healthz`); if (r.ok) break; } catch (_) {} await sleep(100); }
  const agentMark = async body => (await fetch(`http://127.0.0.1:${frontPort}/notifications/api/mark`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).status;
  // 2. WAM: the real registry writer installs the app's OWN wizard.md (its browser_contract), then owner grants.
  fs.mkdirSync(path.join(box, 'home'), { recursive: true });
  // Owner routing (as a box's routes.json): the view is served same-origin at the app's own path.
  fs.writeFileSync(path.join(box, 'home/routes.json'), JSON.stringify({ notifications: { view: '/notifications/' } }));
  wam('install', 'notifications', '--repo', 'oscarhenrycollins/notifications', '--port', String(frontPort), '--wizard-md', path.join(nroot, 'wizard.md'));
  if (process.env.QA_BASELINE === '1') report.baseline = true;   // an unmigrated app build: record what the opaque frame shows, then stop
  const declared = appsJson().apps.find(a => a.id === 'notifications');
  if (report.baseline) { report.baselineContract = declared.browser.reason; }
  else {
  check(declared.browser.admissible === false && declared.browser.reason === 'no_grant', 'WAM: the app\'s own declaration alone is not admissible');
  // A build with scoped media tickets (card 3) also declares notifications.media; the owner grants it too.
  const withMedia = JSON.stringify(declared.browser.contract.operations) === '["notifications.inbox","notifications.mark","notifications.media"]';
  report.mediaTickets = withMedia;
  check(withMedia || JSON.stringify(declared.browser.contract.operations) === '["notifications.inbox","notifications.mark"]', 'WAM: installed contract = the app\'s wizard.md (inbox + mark' + (withMedia ? ' + media)' : ')'));
  wam('grant', 'notifications', 'notifications.inbox', 'notifications.mark', ...(withMedia ? ['notifications.media'] : []));
  report.browserFacts = appsJson().apps.find(a => a.id === 'notifications').browser;
  check(report.browserFacts.admissible && report.browserFacts.source_id === 'standard:oscarhenrycollins/notifications', 'WAM: owner grant recorded for this installation and source');
  }
  report.viewUrl = appsJson().apps.find(a => a.id === 'notifications').view?.url;
  check(report.viewUrl === '/notifications/', 'WAM: the real view path /notifications/');
  // 3. Agent Service with the production WAM resolver (no injected resolver).
  const { createWizardServer } = await import(pathToFileURL(path.join(process.env.QA_SERVICE_ROOT, 'server/service.mjs')));
  const { createHermesFixture } = await import(pathToFileURL(path.join(process.env.QA_SERVICE_ROOT, 'server/fixture.mjs')));
  const hermes = createHermesFixture({ expectedKey: 'boundary-fixture-only' }); const hp = await listen(hermes);
  const svcHome = path.join(out, 'service-home'); fs.mkdirSync(svcHome, { recursive: true });
  const cprobe = http.createServer(), contentPort = await listen(cprobe); await close(cprobe);
  const receiptsPath = path.join(out, 'service-state/browser-operation-receipts.json');
  const service = createWizardServer({ upstreamOrigin: `http://127.0.0.1:${hp}`, hermesKey: 'boundary-fixture-only', requireAccess: false, ownerProof,
    browserBoundary: { enabled: true, token }, hermesHome: path.join(svcHome, 'hermes'), wizardOsHome: path.join(box, 'home'),
    appsJsonPath: path.join(box, 'home/apps.json'), settingsPath: path.join(svcHome, 'settings.json'), launcherPath: path.join(svcHome, 'launcher.json'),
    agentBridge: false, followThrough: false, joinedDelegation: 'off', browserAdapterWam: { receiptsPath, ...(report.mediaTickets ? { content: { publicBase: `http://127.0.0.1:${contentPort}` } } : {}) } });
  const trace = []; report.serviceTrace = trace;
  service.on('request', (req, res) => res.on('finish', () => trace.push({ method: req.method, path: new URL(req.url, 'http://x').pathname, status: res.statusCode, origin: req.headers.origin || '', hasShellToken: typeof req.headers['x-wizard-shell-token'] === 'string' })));
  const sp = await listen(service);
  const content = report.mediaTickets ? service.browserContent.createServer() : null;
  if (content) { await new Promise(r => content.listen(contentPort, '127.0.0.1', r)); children.push({ kill: () => { content.closeAllConnections?.(); content.close(); } }); }
  const receipts = () => { try { return Object.values(JSON.parse(fs.readFileSync(receiptsPath, 'utf8')).receipts); } catch (_) { return []; } };
  // 4. nginx stand-in.
  const tpl = fs.readFileSync(path.join(root, 'packaging/browser-boundary-document.conf.template'), 'utf8');
  const docHeaders = [...tpl.matchAll(/add_header ([A-Za-z-]+) "([^"]*)" always;/g)].map(m => [m[1], m[2]]);
  const inject = tpl.match(/sub_filter '<head>' '([^']*)';/)[1].replace('${WIZARD_SHELL_TOKEN}', token);
  const serveFile = (res, file, extra = {}) => { if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', ...extra }); res.end(fs.readFileSync(file)); };
  const nreq = report.notificationsRequests;
  const proxy = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'), p = u.pathname;
    const doc = p.match(/^\/(?:wizard-os-home|wizard-ux)\/(|index\.html|desktop\.html)$/);
    if (doc) {
      if (req.headers['sec-fetch-dest'] !== 'document' || req.headers['sec-fetch-mode'] !== 'navigate' || req.method !== 'GET') { res.writeHead(403); return res.end(); }
      const html = fs.readFileSync(path.join(web, doc[1] || 'index.html'), 'utf8').replace('<head>', '<head>' + inject);
      res.writeHead(200, { 'Content-Type': 'text/html', ...Object.fromEntries(docHeaders) }); return res.end(html);
    }
    if (p.startsWith('/wizard-os-home/')) return serveFile(res, path.join(web, path.normalize(p.slice('/wizard-os-home/'.length)).replace(/^(\.\.[/\\])+/, '')));
    if (p === '/qa-sandbox-host') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<!doctype html><iframe sandbox="allow-scripts allow-forms allow-downloads" src="/notifications/"></iframe>'); }
    if (p.startsWith('/notifications/') || p === '/notifications') {
      // The gateway route to the app, as on a box (direct listener protection is card 3). Record the requester.
      nreq.push({ method: req.method, path: p, site: req.headers['sec-fetch-site'] || '', dest: req.headers['sec-fetch-dest'] || '', origin: req.headers.origin || '', type: req.headers['content-type'] || '', preflight: req.headers['access-control-request-method'] || '' });
      const up = http.request({ host: '127.0.0.1', port: frontPort, method: req.method, path: req.url, headers: req.headers }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
      up.on('error', () => { res.writeHead(502); res.end(); }); return req.pipe(up);
    }
    if (p.startsWith('/wizard/')) {
      const up = http.request({ host: '127.0.0.1', port: sp, method: req.method, path: req.url, headers: { ...req.headers, 'x-wizard-owner-proof': ownerProof } }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
      up.on('error', () => { res.writeHead(502); res.end(); }); return req.pipe(up);
    }
    res.writeHead(404); res.end();
  });
  const np = await listen(proxy);
  const fromFrame = r => r.site === 'cross-site' || r.origin === 'null';
  let browser, page;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME ? { executablePath: process.env.QA_CHROME } : {}) });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    page = await context.newPage(); page.on('pageerror', e => report.errors.push('page: ' + e.message + ' @ ' + String(e.stack || '').split('\n').slice(1, 3).join(' | ').slice(0, 300)));
    page.on('console', m => { if (m.type() === 'error') report.errors.push('console: ' + m.text().slice(0, 300)); });
    await require('./qa-browser-onboarding.cjs')(page, token, report);
    await page.goto(`http://127.0.0.1:${np}/wizard-os-home/desktop.html`);
    await page.waitForFunction(() => window.WizBrowserBoundary?.enabled && window.wizardUX, { timeout: 20000 });
    const setSkin = async skin => { await page.evaluate(s => { WosSkin.set(s); WizAppearance.sync(); }, skin); };
    await setSkin('nebula');
    const open = async () => {
      await page.evaluate(() => dispatchEvent(new CustomEvent('wizard:open', { detail: { path: '/notifications/' } })));
      const frame = await appFrame(page, '/notifications/');
      await frame.waitForFunction(() => window.WizBoundaryClient?.ready && window.NotifData, null, { timeout: 15000 });
      return frame;
    };
    const frameOf = async () => { const f = await appFrame(page, '/notifications/'); await f.waitForFunction(() => window.WizBoundaryClient?.ready && window.NotifData, null, { timeout: 15000 }); return f; };
    const waitMark = async (id, key, value) => { for (let i = 0; i < 100; i++) { if (marks()[id]?.[key] === value) return true; await sleep(100); } return false; };
    if (report.baseline) {
      await page.evaluate(() => dispatchEvent(new CustomEvent('wizard:open', { detail: { path: '/notifications/' } })));
      const frame = await appFrame(page, '/notifications/'); await sleep(6000);
      report.baselineView = await frame.evaluate(() => ({ origin: self.origin, rows: document.querySelectorAll('#list .nt-item, #list .subject-row').length, status: document.querySelector('#status')?.textContent || '' }));
      report.baselineDirectApi = nreq.filter(r => r.path.startsWith('/notifications/api/') && fromFrame(r)).length;
      const shot = path.join(out, 'baseline-unmigrated-nebula.png'); await page.screenshot({ path: shot }); report.screenshots.push(shot);
      fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2));
      console.log(JSON.stringify({ baseline: true, view: report.baselineView, directApiFromFrame: report.baselineDirectApi, contract: report.baselineContract }, null, 2));
      return;
    }
    let app = await open();
    const frameEl = page.locator('iframe[src*="/notifications/"]');
    check(await frameEl.getAttribute('sandbox') === 'allow-scripts allow-forms allow-downloads', 'the real Notifications view is an opaque sandboxed frame (no allow-same-origin)');
    check(await app.evaluate(() => self.origin === 'null' && window.NotifData.opaque === true), 'inside the frame: origin "null", data layer in opaque mode');

    // ---- Original screen (Nebula): list, open-marks-read, flag, archive, tabs, mark all read, Back. ----
    await app.waitForFunction(() => document.querySelectorAll('#list .nt-item').length === 3, null, { timeout: 15000 });
    check(true, 'original screen: data.call notifications.inbox renders the three synthetic notifications');
    check(trace.some(r => r.path === '/wizard/v1/browser-adapters/bindings' && r.status === 200 && r.hasShellToken), 'binding created by the shell with possession (server trace)');
    check(await app.evaluate(() => document.querySelector('#c-inbox').textContent === '3'), 'original screen: unread count from typed counts');
    const bellBefore = await page.evaluate(() => window.WosBell?.state?.unread);
    report.bellBefore = bellBefore;
    // Same-frame tap feedback is the kit's :active style; record the computed press state.
    await app.locator('.nt-item[data-id="SynthBBBB0002"] .nt-row').click();
    check(await waitMark('SynthBBBB0002', 'read', true), 'original screen: opening an unread item marks it read (inbox.json readback)');
    await app.waitForFunction(() => document.querySelector('.nt-item[data-id="SynthBBBB0002"]')?.classList.contains('open') && !document.querySelector('.nt-item[data-id="SynthBBBB0002"]').classList.contains('unread'));
    check(receipts().some(r => r.operation === 'notifications.mark' && r.status === 'succeeded'), 'durable outcome receipt for notifications.mark');
    for (let i = 0; i < 50 && (await page.evaluate(() => window.WosBell?.state?.unread)) !== 2; i++) await sleep(100);
    report.bellAfterRead = await page.evaluate(() => window.WosBell?.state?.unread);
    check(report.bellAfterRead === 2, 'badge: the shell re-read the count itself after the typed write (3 -> 2)');
    check(await page.evaluate(() => [...document.querySelectorAll('[data-chbell]')].every(b => b.hidden || !b.querySelector('b'))), 'badge in one place: no Chats bell count while the Notifications window is open');
    // Back closes the open item first, then stays in the shell.
    await page.evaluate(() => dispatchEvent(new CustomEvent('wizard:back'))); await sleep(400);
    check(await app.evaluate(() => !document.querySelector('.nt-item.open')), 'original screen: Back closes the open item (boundary Back)');
    await page.evaluate(() => dispatchEvent(new CustomEvent('wizard:back'))); await sleep(400);
    check(!page.isClosed() && page.url().includes('/wizard-os-home/desktop.html'), 'Back at the list stays in Wizard (never exits)');
    if (!(await page.locator('iframe[src*="/notifications/"]').count())) app = await open(); else app = await frameOf();
    await app.waitForFunction(() => document.querySelectorAll('#list .nt-item').length === 3, null, { timeout: 15000 });
    await app.locator('.nt-item[data-id="SynthBBBB0003"] .nt-row').click();
    await waitMark('SynthBBBB0003', 'read', true);
    await app.waitForFunction(() => document.querySelector('.nt-item[data-id="SynthBBBB0003"].open [data-act="flag"]'));
    await app.locator('.nt-item[data-id="SynthBBBB0003"] [data-act="flag"]').click();
    check(await waitMark('SynthBBBB0003', 'flag', true), 'original screen: Flag persisted');
    await app.locator('[role=tab][data-view="flagged"]').click();
    await app.waitForFunction(() => [...document.querySelectorAll('#list .nt-item')].map(n => n.dataset.id).join() === 'SynthBBBB0003', null, { timeout: 10000 });
    check(true, 'original screen: Flagged tab lists the flagged item (view=flagged)');
    await app.locator('[role=tab][data-view="inbox"]').click();
    await app.waitForFunction(() => document.querySelectorAll('#list .nt-item').length === 3);
    await app.locator('.nt-item[data-id="SynthBBBB0003"] .nt-row').click();
    await app.waitForFunction(() => document.querySelector('.nt-item[data-id="SynthBBBB0003"].open [data-act="archive"]'));
    await app.locator('.nt-item[data-id="SynthBBBB0003"] [data-act="archive"]').click();
    check(await waitMark('SynthBBBB0003', 'archived', true), 'original screen: Archive persisted');
    await app.waitForFunction(() => document.querySelectorAll('#list .nt-item').length === 2, null, { timeout: 10000 });
    await app.locator('[role=tab][data-view="archive"]').click();
    await app.waitForFunction(() => [...document.querySelectorAll('#list .nt-item')].map(n => n.dataset.id).join() === 'SynthBBBB0003', null, { timeout: 10000 });
    check(true, 'original screen: Archive tab lists it (view=archive)');
    await app.locator('.nt-item[data-id="SynthBBBB0003"] .nt-row').click();
    await app.locator('.nt-item[data-id="SynthBBBB0003"] [data-act="archive"]').click();   // Move to inbox (non-monotonic, CAS)
    check(await waitMark('SynthBBBB0003', 'archived', false), 'original screen: Move to inbox persisted (compare-and-set write)');
    await app.locator('[role=tab][data-view="inbox"]').click();
    await app.waitForFunction(() => document.querySelectorAll('#list .nt-item').length === 3 && !document.querySelector('#allread').hidden, null, { timeout: 10000 });
    await app.locator('#allread').click();
    check(await waitMark('SynthBBBB0001', 'read', true), 'original screen: Mark all read persisted');
    for (let i = 0; i < 50 && (await page.evaluate(() => window.WosBell?.state?.unread)) !== 0; i++) await sleep(100);
    check(await page.evaluate(() => window.WosBell?.state?.unread) === 0, 'badge: count 0 after mark all read');
    // Reset to a useful state for the screenshots and the minimal screen.
    for (const id of ['SynthBBBB0001', 'SynthBBBB0003']) await agentMark({ ids: [id], read: false });
    await agentMark({ ids: ['SynthBBBB0003'], flag: false });
    await app.locator('[role=tab][data-view="flagged"]').click(); await app.locator('[role=tab][data-view="inbox"]').click();
    await app.waitForFunction(() => document.querySelector('#c-inbox').textContent === '2', null, { timeout: 10000 });
    const opaquePanels = () => app.evaluate(() => [...document.querySelectorAll('#status, .wz-app')].every(el => { const c = document.createElement('canvas'); c.width = c.height = 1; const x = c.getContext('2d'); x.fillStyle = getComputedStyle(el).backgroundColor; x.fillRect(0, 0, 1, 1); const a = x.getImageData(0, 0, 1, 1).data[3]; return a === 255 || a === 0; }));
    for (const skin of ['nebula', 'grove']) {
      await setSkin(skin);
      await app.waitForFunction(s => document.documentElement.dataset.skin === s, skin);
      await sleep(400);
      check(await app.evaluate(() => document.documentElement.hasAttribute('data-wz-hosted') && getComputedStyle(document.documentElement).getPropertyValue('--wz-text').trim() !== ''), 'Appearance v1 tokens applied live on ' + skin);
      check(await opaquePanels(), 'no translucent text panels on ' + skin + ' (window glass is the canvas)');
      const shot = path.join(out, `notifications-real-${skin}.png`); await page.screenshot({ path: shot }); report.screenshots.push(shot);
    }

    // ---- Minimal screen (Miguel's skins): live skin change reloads into ?layout=minimal. ----
    await setSkin('landscapes-light');
    await sleep(1200);
    app = await frameOf();
    report.landscapesLight = { frameUrl: app.url(), skin: await app.evaluate(() => document.documentElement.dataset.skin) };
    const shotLL = path.join(out, 'notifications-real-landscapes-light.png'); await page.screenshot({ path: shotLL }); report.screenshots.push(shotLL);
    await setSkin('obsidian');
    for (let i = 0; i < 40 && !app.url().includes('layout=minimal'); i++) { await sleep(150); try { app = await frameOf(); } catch (_) {} }
    app = await frameOf();
    check(app.url().includes('layout=minimal'), 'Miguel\'s skin: the gate reloads the frame into the minimal screen');
    await app.waitForFunction(() => document.querySelectorAll('#list .subject-row').length === 2, null, { timeout: 15000 });
    check(true, 'minimal screen: Unread list through notifications.inbox');
    await app.locator('.subject-row[data-id="SynthBBBB0001"]').click();
    await app.waitForFunction(() => !document.querySelector('#detail').hidden && document.querySelector('#subject').textContent === 'Synthetic chart ready');
    await app.waitForFunction(() => { const i = document.querySelector('#body .thumb img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 10000 }).catch(() => {});
    const thumb = await app.evaluate(() => { const i = document.querySelector('#body .thumb img'); return i ? { ok: i.complete && i.naturalWidth > 0, src: i.getAttribute('src') } : null; });
    report.thumbnail = thumb;
    check(thumb?.ok === true, 'minimal screen: the MEDIA thumbnail renders');
    const mediaReq = nreq.filter(r => r.path.startsWith('/notifications/media/') && fromFrame(r));
    if (report.mediaTickets) check(mediaReq.length === 0 && new URL(thumb.src).origin === `http://127.0.0.1:${contentPort}` && /^\/t\//.test(new URL(thumb.src).pathname), 'thumbnail through a 60 s media ticket on the content origin; the frame never asked /notifications/media/*');
    else report.open.push({ item: 'thumbnails', detail: 'loaded by the opaque frame as a no-cors image GET straight from /notifications/media/* (ambient gateway route, ' + mediaReq.length + ' request(s)); no typed M adapter yet. OPEN: card 3 (#386).' });
    const shotDark = path.join(out, 'notifications-real-obsidian-detail.png'); await page.screenshot({ path: shotDark }); report.screenshots.push(shotDark);
    // Reply: an unsent Chats draft through the bounded shell service; nothing is sent.
    const postsBefore = trace.filter(r => r.method === 'POST' && !r.path.startsWith('/wizard/v1/browser-adapters/')).length;
    await app.locator('#primary button, #actions button').filter({ hasText: 'Reply' }).first().click();
    await app.waitForFunction(() => /Reply opened in Chats\. Nothing sent\./.test(document.querySelector('#status').textContent), null, { timeout: 10000 });
    const draft = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('wos.chat.drafts.v1') || '{}')).find(d => d?.reply?.key === 'notifications:SynthBBBB0001') || null);
    check(!!draft && draft.reply.title === 'Synthetic chart ready', 'Reply: unsent Chats draft keyed notifications:<id> opened by the shell');
    await sleep(500);
    check(trace.filter(r => r.method === 'POST' && !r.path.startsWith('/wizard/v1/browser-adapters/')).length === postsBefore, 'Reply: nothing was sent (no chat/run POST)');
    // Return to Notifications for the one-tap Mark read.
    await page.evaluate(() => dispatchEvent(new CustomEvent('wizard:open', { detail: { path: '/notifications/' } })));
    app = await frameOf();
    await sleep(300);
    if (await app.evaluate(() => document.querySelector('#detail').hidden)) { await app.locator('.subject-row[data-id="SynthBBBB0001"]').click(); await app.waitForFunction(() => !document.querySelector('#detail').hidden); }
    await app.locator('#actions button').filter({ hasText: 'Mark read' }).click();
    check(await waitMark('SynthBBBB0001', 'read', true), 'minimal screen: Mark read persisted');
    await app.waitForFunction(() => document.querySelector('#detail').hidden && !document.querySelector('#overview').hidden, null, { timeout: 5000 });
    check(true, 'minimal screen: one tap on Mark read returns to the list');
    // Back from detail returns to the list; at the list Back stays in Wizard.
    await app.locator('[data-filter="all"]').click();
    await app.waitForFunction(() => document.querySelectorAll('#list .subject-row').length === 3);
    await app.locator('.subject-row[data-id="SynthBBBB0003"]').click();
    await app.waitForFunction(() => !document.querySelector('#detail').hidden);
    await page.evaluate(() => dispatchEvent(new CustomEvent('wizard:back'))); await sleep(500);
    check(await app.evaluate(() => document.querySelector('#detail').hidden), 'minimal screen: Back leaves the detail for the list');
    await page.evaluate(() => dispatchEvent(new CustomEvent('wizard:back'))); await sleep(400);
    check(!page.isClosed() && page.url().includes('/wizard-os-home/desktop.html'), 'minimal screen: Back at the list stays in Wizard');
    if (!(await page.locator('iframe[src*="/notifications/"]').count())) await page.evaluate(() => dispatchEvent(new CustomEvent('wizard:open', { detail: { path: '/notifications/' } })));
    app = await frameOf();
    await app.waitForFunction(() => document.querySelectorAll('#list .subject-row').length >= 1, null, { timeout: 10000 });
    // Stale view: the agent changes an item behind the screen; the next mark conflicts and writes nothing.
    await app.locator('[data-filter="all"]').click();
    await app.waitForFunction(() => document.querySelectorAll('#list .subject-row').length === 3);
    await app.locator('.subject-row[data-id="SynthBBBB0003"]').click();
    await app.waitForFunction(() => !document.querySelector('#detail').hidden);
    check(await agentMark({ ids: ['SynthBBBB0003'], flag: true }) === 200, 'agent flags the item directly (no expect)');
    await app.locator('#actions button').filter({ hasText: 'Mark read' }).click();
    await app.waitForFunction(() => /changed somewhere else/.test(document.querySelector('#status').textContent), null, { timeout: 10000 });
    check(marks().SynthBBBB0003?.read !== true, 'stale view: conflict shown, nothing written');
    await app.locator('#back').click();
    await app.waitForFunction(() => document.querySelector('#detail').hidden);
    // Mark all read (two taps) through More.
    await app.locator('[data-filter="unread"]').click();
    await app.waitForFunction(() => [...document.querySelectorAll('#list .subject-row')].map(n => n.dataset.id).join() === 'SynthBBBB0003', null, { timeout: 10000 });
    check(true, 'minimal screen: Unread filter lists only what is still unread');
    await app.locator('#more').click(); await app.locator('#allread').click();
    check(await app.evaluate(() => document.querySelector('#allread').textContent === 'Confirm mark all read'), 'minimal screen: mark all read asks once more in place');
    await app.locator('#allread').click();
    check(await waitMark('SynthBBBB0003', 'read', true), 'minimal screen: Mark all read persisted');
    for (let i = 0; i < 50 && (await page.evaluate(() => window.WosBell?.state?.unread)) !== 0; i++) await sleep(100);
    check(await page.evaluate(() => window.WosBell?.state?.unread) === 0, 'badge: 0 after the minimal screen\'s mark all read');
    check(!nreq.some(r => r.path.startsWith('/notifications/api/') && fromFrame(r)), 'the real UI never called /notifications/api/* from the frame (all reads/marks were typed)');
    // Hostile attempts from the opaque frame.
    const hostile = await app.evaluate(async () => {
      const r = {};
      for (const [k, req] of Object.entries({ unknown: { operation: 'owner.fetch', args: {} }, forged: { operation: 'notifications.inbox', args: { view: 'all', limit: 5 }, appId: 'profiles' }, cardOne: { operation: 'notifications.list', args: { limit: 1, cursor: null } } })) {
        try { await WizardApp.data.call(req); r[k] = 'ALLOWED'; } catch (e) { r[k] = e.code; }
      }
      try { parent.postMessage({ type: 'wizard:notifications:count', unread: 99, needs: 9 }, '*'); } catch (_) {}
      try { await WizardApp.nav.openContextDraft({ id: 'x', title: 't', message: 'm', extra: 1 }); r.badDraft = 'ALLOWED'; } catch (e) { r.badDraft = e.code; }
      return r;
    });
    report.hostile = hostile;
    check(hostile.unknown === 'not_allowed' && hostile.forged === 'bad_request' && hostile.cardOne === 'not_allowed', 'frame cannot call unknown/ungranted operations or forge a principal');
    await sleep(300);
    check(await page.evaluate(() => window.WosBell?.state?.unread) === 0, 'a forged count message from the frame is ignored by the shell');
    check(hostile.badDraft === 'invalid_request', 'reply draft refuses off-schema context');
    // Revocation through WAM's real CLI: the next write is refused at the server; nothing changes upstream.
    wam('revoke', 'notifications', 'notifications.mark');
    // The open binding's permission revision moved: its next call (even a read) is refused as revoked.
    await app.locator('[data-filter="all"]').click();
    await app.waitForFunction(() => /Permission for Notifications changed/.test(document.querySelector('#status').textContent), null, { timeout: 10000 });
    check(trace.filter(r => r.path === '/wizard/v1/browser-adapters/call').slice(-1)[0]?.status === 403, 'after a WAM revoke the open binding is refused at the server (403 revoked)');
    // Reload: fresh binding; read still granted, writes not.
    await page.evaluate(() => { const f = document.querySelector('iframe[src*="/notifications/"]'); f.src = f.src; });
    app = await frameOf();
    await app.waitForFunction(() => document.querySelectorAll('#list .subject-row').length >= 0 && document.querySelector('#status').textContent === '', null, { timeout: 10000 }).catch(() => {});
    await app.locator('[data-filter="all"]').click().catch(() => {});
    await app.waitForFunction(() => document.querySelectorAll('#list .subject-row').length === 3, null, { timeout: 10000 });
    await app.locator('.subject-row[data-id="SynthBBBB0001"]').click();
    await app.locator('#actions button').filter({ hasText: 'Flag' }).click();
    await app.waitForFunction(() => /need permission/.test(document.querySelector('#status').textContent), null, { timeout: 10000 });
    check(marks().SynthBBBB0001?.flag !== true, 'fresh binding: inbox still granted, mark refused (not_allowed)');
    await app.locator('#back').click();
    // Uninstall through WAM: everything refused.
    wam('uninstall', 'notifications');
    await app.locator('#refresh').click({ trial: false }).catch(async () => { await app.locator('#more').click(); await app.locator('#refresh').click(); });
    await app.waitForFunction(() => /permission|Reopen|not reachable/i.test(document.querySelector('#status').textContent), null, { timeout: 10000 });
    report.afterUninstall = await app.locator('#status').textContent();
    check(true, 'uninstalled app refused at the server: "' + report.afterUninstall + '"');
    // Direct API from the same opaque sandbox, in a context WITHOUT Playwright request interception: page.route()
    // (the onboarding fixture above) makes Chromium skip CORS preflights, so it cannot prove this part.
    const plain = await browser.newContext({ serviceWorkers: 'block' });
    const host = await plain.newPage(); await host.goto(`http://127.0.0.1:${np}/qa-sandbox-host`);
    const sf = host.frames().find(f => f !== host.mainFrame());
    await sf.waitForFunction(() => window.NotifData, null, { timeout: 10000 });
    const before = JSON.stringify(marks()), mark0 = nreq.length;
    const direct = await sf.evaluate(async () => {
      const r = { opaque: self.origin === 'null' };
      try { const x = await fetch('api/items?view=all'); r.read = 'READ ' + x.status; } catch (_) { r.read = 'blocked'; }
      try { await fetch('api/mark', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: ['SynthBBBB0001'], read: false }) }); r.write = 'SENT'; } catch (_) { r.write = 'blocked'; }
      return r;
    });
    await sleep(300);
    const seen = nreq.slice(mark0);
    report.directFromSandbox = { result: direct, requests: seen };
    check(direct.opaque && direct.read === 'blocked' && direct.write === 'blocked', 'opaque frame cannot read or write /notifications/api/* directly (browser-side)');
    check(seen.some(r => r.method === 'OPTIONS' && r.path === '/notifications/api/mark' && r.preflight === 'POST') && !seen.some(r => r.method === 'POST'), 'the JSON write was stopped at its CORS preflight; no POST reached the app');
    check(JSON.stringify(marks()) === before, 'inbox.json unchanged by the direct attempts');
    report.open.push({ item: 'direct listener', detail: `the frame's plain GET to /notifications/api/items still reaches the app (${seen.filter(r => r.method === 'GET' && r.path.startsWith('/notifications/api/')).length} request(s), body hidden by the browser), and the app answers Origin:null requests; only the browser's preflight stops JSON writes. Server-side protection of /notifications/api/* is card 3 (#386).` });
    await plain.close();
    // Dark standalone (no shell): the app's own page at its own path, same-origin API, as before the boundary.
    const dark = await browser.newContext({ viewport: { width: 1000, height: 800 }, serviceWorkers: 'block', colorScheme: 'dark' });
    const standalone = await dark.newPage(); standalone.on('pageerror', e => report.errors.push('standalone: ' + e.message));
    await standalone.goto(`http://127.0.0.1:${np}/notifications/`);
    await standalone.waitForFunction(() => document.querySelectorAll('#list .nt-item').length === 3, null, { timeout: 10000 });
    check(await standalone.evaluate(() => window.NotifData.opaque === false && getComputedStyle(document.body).backgroundColor !== 'rgba(0, 0, 0, 0)' && matchMedia('(prefers-color-scheme: dark)').matches), 'dark standalone: opaque dark canvas, same-origin data path (unchanged)');
    const darkShot = path.join(out, 'notifications-real-standalone-dark.png'); await standalone.screenshot({ path: darkShot }); report.screenshots.push(darkShot);
    await dark.close(); await context.close();
    report.frontLogTail = frontLog.slice(-2000);
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: true, checks: report.checks.length, open: report.open, screenshots: report.screenshots, errors: report.errors.length }, null, 2));
  } catch (error) {
    report.failure = error.stack; report.frontLogTail = frontLog.slice(-2000);
    try { report.statusText = await page?.frames().find(f => f.url().includes('/notifications/'))?.locator('#status').textContent(); } catch (_) {}
    try { const shot = path.join(out, 'failure.png'); await page?.screenshot({ path: shot }); report.failureShot = shot; } catch (_) {}
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2));
    throw error;
  } finally {
    await browser?.close();
    for (const c of children) c.kill('SIGTERM');
    await Promise.all([close(proxy), close(service), close(ntfy)]);
    await hermes.closeFixture?.();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
