// Card 3 scoped media (wizard-os ADAPTER-SKETCH §6): the REAL Notifications minimal screen shows a notification's
// picture inside the opaque frame through a 60 s ticket on the Service's separate content listener, while the app's
// own /notifications/media/* route refuses the frame server-side (listener gate on, WAM listener credential).
// Real Chromium + real Agent Service (+ content listener) + REAL WAM install/grant/credential state from the app's
// own wizard.md + REAL Notifications front (its mcp/*.py, gate on) over a stub ntfy. A Node stand-in replaces nginx
// for the shell document (same template headers/token injection). Synthetic data only; never a live box.
// Env: QA_OUT, QA_SERVICE_ROOT, QA_WAM_ROOT, QA_NOTIFICATIONS_ROOT, QA_PYTHON (PyYAML), optional QA_PLAYWRIGHT,
// QA_CHROME, QA_TICKET_TTL_MS (default 60000; the run shortens it only to prove expiry without a one-minute wait).
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict'), { spawn, execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url'), crypto = require('node:crypto');
const appFrame = require('./qa-browser-frame.cjs');
const root = path.resolve(process.env.QA_UX_ROOT || path.join(__dirname, '..')), out = path.resolve(process.env.QA_OUT || '');
const { chromium } = require(path.join(root, 'tools/qa-playwright.cjs'));
for (const k of ['QA_OUT', 'QA_SERVICE_ROOT', 'QA_WAM_ROOT', 'QA_NOTIFICATIONS_ROOT', 'QA_PYTHON']) if (!process.env[k]) throw new Error(k + ' is required');
fs.mkdirSync(out, { recursive: true });
const TTL = Number(process.env.QA_TICKET_TTL_MS || 60000);
const token = crypto.randomBytes(32).toString('hex'), ownerProof = crypto.randomBytes(32).toString('hex');
const web = path.join(root, 'web'), nroot = path.resolve(process.env.QA_NOTIFICATIONS_ROOT);
const listen = server => new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const close = s => new Promise(r => { s.closeAllConnections?.(); s.close(r); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const report = { candidate: true, nativeProven: false, nginxStandIn: 'node', ticketTtlMs: TTL, checks: [], open: [], screenshots: [], errors: [], wam: [], notificationsRequests: [], contentRequests: [] };
const check = (value, name) => { assert.ok(value, name); report.checks.push(name); };
const box = path.join(out, 'box');
const wam = (...args) => { const r = execFileSync(process.env.QA_PYTHON, [path.join(process.env.QA_WAM_ROOT, 'tools/browser_admission_fixture.py'), box, ...args], { encoding: 'utf8' }); report.wam.push(args.join(' ')); return r; };
const appsJson = () => JSON.parse(fs.readFileSync(path.join(box, 'home/apps.json'), 'utf8'));
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const children = [];
const raw = (url, { method = 'GET', headers = {} } = {}) => new Promise(resolve => {
  const req = http.request(url, { method, headers }, res => { const parts = []; res.on('data', c => parts.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(parts).length })); });
  req.on('error', e => resolve({ status: 0, error: e.code })); req.end();
});
const PNG = (() => {   // synthetic 320x200 gradient (no owner content)
  const zlib = require('node:zlib'), w = 320, h = 200, rawPx = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { rawPx[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; rawPx[o] = 40 + x * 0.6; rawPx[o + 1] = 90 + y * 0.6; rawPx[o + 2] = 200 - x * 0.3; } }
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rawPx)), chunk('IEND', Buffer.alloc(0))]);
})();
(async () => {
  // 1. Stub ntfy with one synthetic picture under an allowed media root.
  const now = Math.floor(Date.now() / 1000);
  const media = path.join(out, 'media'); fs.mkdirSync(media, { recursive: true });
  const pic = path.join(media, 'synthetic-chart.png'); fs.writeFileSync(pic, PNG);
  const messages = [
    { id: 'SynthMMMM0001', time: now - 60, event: 'message', topic: 'wizard', title: 'Synthetic chart ready', message: `The synthetic weekly chart is ready.\nMEDIA:${pic}` },
    { id: 'SynthMMMM0002', time: now - 120, event: 'message', topic: 'wizard', title: 'Synthetic reminder', message: 'Synthetic reminder text.' },
  ];
  const ntfy = http.createServer((req, res) => { const topic = new URL(req.url, 'http://x').pathname.split('/')[1]; res.setHeader('Content-Type', 'application/x-ndjson'); res.end(messages.filter(m => m.topic === topic).map(m => JSON.stringify(m)).join('\n') + '\n'); });
  const ntfyPort = await listen(ntfy);
  // 2. WAM: the app's OWN wizard.md (inbox + mark + media), a listener credential, owner grants.
  const probe = http.createServer(), frontPort = await listen(probe); await close(probe);
  fs.mkdirSync(path.join(box, 'home'), { recursive: true });
  fs.writeFileSync(path.join(box, 'home/routes.json'), JSON.stringify({ notifications: { view: '/notifications/' } }));
  wam('install', 'notifications', '--repo', 'oscarhenrycollins/notifications', '--port', String(frontPort), '--wizard-md', path.join(nroot, 'wizard.md'), '--listener-auth');
  const declared = appsJson().apps.find(a => a.id === 'notifications').browser;
  check(JSON.stringify(declared.contract.operations) === '["notifications.inbox","notifications.mark","notifications.media"]', 'WAM: installed contract = the app\'s wizard.md (inbox, mark, media)');
  wam('grant', 'notifications', 'notifications.inbox', 'notifications.mark', 'notifications.media');
  const facts = appsJson().apps.find(a => a.id === 'notifications').browser;
  check(facts.admissible && facts.granted.includes('notifications.media') && facts.listener_credential?.state === 'written', 'WAM: media granted for this installation, listener credential written');
  const appEnv = Object.fromEntries(fs.readFileSync(path.join(box, 'runtipi/user-config/wizardapps/notifications/app.env'), 'utf8').trim().split('\n').map(l => l.split(/=(.*)/s).slice(0, 2)));
  // 3. The real Notifications front, gate ON with the env WAM wrote.
  const frontSrc = ['front.py', 'tools.py', 'minimal_assets.py', 'relay.py'].map(f => fs.readFileSync(path.join(nroot, 'mcp', f), 'utf8')).join('\n\n') + '\n\nif __name__ == "__main__":\n    asyncio.run(main())\n';
  fs.mkdirSync(path.join(box, 'notifications-data'), { recursive: true });
  const frontFile = path.join(out, 'notifications-front.py'); fs.writeFileSync(frontFile, frontSrc);
  const front = spawn(process.env.QA_PYTHON, [frontFile], { env: { PATH: process.env.PATH, WIZARD_APP: 'notifications', FRONT_PORT: String(frontPort), UPSTREAM_HOST: '127.0.0.1', UPSTREAM_PORT: String(ntfyPort), INBOX_TOPICS: 'wizard,cron', INBOX_STATE: path.join(box, 'notifications-data/inbox.json'), CRON_RELAY: 'off', INBOX_MEDIA_ROOTS: media,
    WIZARD_BROWSER_BOUNDARY: appEnv.WIZARD_BROWSER_BOUNDARY, WIZARD_APP_CREDENTIAL: appEnv.WIZARD_APP_CREDENTIAL, WIZARD_GUARDED_PATHS: '/notifications/api/,/notifications/media/' }, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(front); let frontLog = ''; front.stdout.on('data', b => frontLog += b); front.stderr.on('data', b => frontLog += b);
  for (let i = 0; i < 50; i++) { try { const r = await fetch(`http://127.0.0.1:${frontPort}/notifications/healthz`); if (r.ok) break; } catch (_) {} await sleep(100); }
  check(appEnv.WIZARD_BROWSER_BOUNDARY === '1' && (await raw(`http://127.0.0.1:${frontPort}/notifications/media${pic}`)).status === 401, 'front gate on: a bare box caller without the credential gets 401 on /notifications/media/*');
  // 4. Agent Service (production WAM resolver) + its content listener on its own port (= its own origin).
  const cprobe = http.createServer(), contentPort = await listen(cprobe); await close(cprobe);
  const contentBase = `http://127.0.0.1:${contentPort}`;
  const { createWizardServer } = await import(pathToFileURL(path.join(process.env.QA_SERVICE_ROOT, 'server/service.mjs')));
  const { createHermesFixture } = await import(pathToFileURL(path.join(process.env.QA_SERVICE_ROOT, 'server/fixture.mjs')));
  const hermes = createHermesFixture({ expectedKey: 'boundary-fixture-only' }); const hp = await listen(hermes);
  const svcHome = path.join(out, 'service-home'); fs.mkdirSync(svcHome, { recursive: true });
  const service = createWizardServer({ upstreamOrigin: `http://127.0.0.1:${hp}`, hermesKey: 'boundary-fixture-only', requireAccess: false, ownerProof,
    browserBoundary: { enabled: true, token }, hermesHome: path.join(svcHome, 'hermes'), wizardOsHome: path.join(box, 'home'),
    appsJsonPath: path.join(box, 'home/apps.json'), settingsPath: path.join(svcHome, 'settings.json'), launcherPath: path.join(svcHome, 'launcher.json'),
    agentBridge: false, followThrough: false, joinedDelegation: 'off',
    browserAdapterWam: { receiptsPath: path.join(out, 'service-state/receipts.json'), content: { publicBase: contentBase, ttlMs: TTL } } });
  const trace = []; report.serviceTrace = trace;
  service.on('request', (req, res) => res.on('finish', () => trace.push({ method: req.method, path: new URL(req.url, 'http://x').pathname, status: res.statusCode, origin: req.headers.origin || '', hasShellToken: typeof req.headers['x-wizard-shell-token'] === 'string' })));
  const sp = await listen(service);
  check(!!service.browserContent, 'Service: content tickets configured (default-off elsewhere)');
  const content = service.browserContent.createServer();
  const creqs = report.contentRequests;
  content.on('request', (req, res) => res.on('finish', () => creqs.push({ method: req.method, ticket: /^\/t\/[A-Za-z0-9_-]{43}$/.test(req.url) ? 'ticket' : req.url, status: res.statusCode, origin: req.headers.origin ?? '', cookie: req.headers.cookie !== undefined, referer: req.headers.referer !== undefined, shellToken: req.headers['x-wizard-shell-token'] !== undefined, dest: req.headers['sec-fetch-dest'] || '', mode: req.headers['sec-fetch-mode'] || '' })));
  await new Promise(r => content.listen(contentPort, '127.0.0.1', r));
  // 5. nginx stand-in for the shell document; /notifications/* passes to the front (records requester + status).
  const tpl = fs.readFileSync(path.join(root, 'packaging/browser-boundary-document.conf.template'), 'utf8');
  const docHeaders = [...tpl.matchAll(/add_header ([A-Za-z-]+) "([^"]*)" always;/g)].map(m => [m[1], m[2]]);
  const inject = tpl.match(/sub_filter '<head>' '([^']*)';/)[1].replace('${WIZARD_SHELL_TOKEN}', token);
  const serveFile = (res, file) => { if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }); res.end(fs.readFileSync(file)); };
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
    if (p.startsWith('/notifications/') || p === '/notifications') {
      const rec = { method: req.method, path: p, site: req.headers['sec-fetch-site'] || '', dest: req.headers['sec-fetch-dest'] || '', origin: req.headers.origin || '' }; nreq.push(rec);
      const up = http.request({ host: '127.0.0.1', port: frontPort, method: req.method, path: req.url, headers: req.headers }, r => { rec.status = r.statusCode; res.writeHead(r.statusCode, r.headers); r.pipe(res); });
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
    page = await context.newPage(); page.on('pageerror', e => report.errors.push('page: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') report.errors.push('console: ' + m.text().slice(0, 300)); });
    await require('./qa-browser-onboarding.cjs')(page, token, report);
    await page.goto(`http://127.0.0.1:${np}/wizard-os-home/desktop.html`);
    await page.waitForFunction(() => window.WizBrowserBoundary?.enabled && window.wizardUX, { timeout: 20000 });
    const setSkin = async skin => { await page.evaluate(s => { WosSkin.set(s); WizAppearance.sync(); }, skin); };
    const frameOf = async () => { const f = await appFrame(page, '/notifications/'); await f.waitForFunction(() => window.WizBoundaryClient?.ready && window.NotifData, null, { timeout: 15000 }); return f; };
    const openApp = async () => { await page.evaluate(() => dispatchEvent(new CustomEvent('wizard:open', { detail: { path: '/notifications/' } }))); return frameOf(); };
    const minimal = async skin => {
      await setSkin(skin);
      let app = await frameOf();
      for (let i = 0; i < 40 && !app.url().includes('layout=minimal'); i++) { await sleep(150); try { app = await frameOf(); } catch (_) {} }
      app = await frameOf();
      await app.waitForFunction(() => document.querySelectorAll('#list .subject-row').length === 2, null, { timeout: 15000 });
      return app;
    };
    const openDetail = async app => {
      if (await app.evaluate(() => !document.querySelector('#detail').hidden)) { await app.locator('#back').click(); await app.waitForFunction(() => document.querySelector('#detail').hidden && !document.querySelector('#overview').hidden); await sleep(400); }
      await app.locator('.subject-row[data-id="SynthMMMM0001"]').click();
      await app.waitForFunction(() => !document.querySelector('#detail').hidden && document.querySelector('#subject').textContent === 'Synthetic chart ready');
      await app.waitForFunction(() => { const i = document.querySelector('#body .thumb img'); return (i && i.complete && i.naturalWidth > 0) || document.querySelector('#body .thumb-missing'); }, null, { timeout: 15000 });
      return app.evaluate(() => { const i = document.querySelector('#body .thumb img'); return i ? { ok: i.complete && i.naturalWidth === 320, src: i.getAttribute('src'), crossOrigin: i.crossOrigin, referrerPolicy: i.referrerPolicy } : { ok: false, missing: true }; });
    };
    await setSkin('nebula');
    let app = await openApp();
    check(await page.locator('iframe[src*="/notifications/"]').getAttribute('sandbox') === 'allow-scripts allow-forms allow-downloads', 'the real Notifications view is an opaque sandboxed frame');
    // ---- Thumbnail in the minimal screen (Obsidian dark), through a ticket only. ----
    app = await minimal('obsidian');
    let thumb = await openDetail(app);
    report.thumbnail = thumb;
    check(thumb.ok, 'Obsidian: the MEDIA thumbnail renders inside the opaque frame (320x200 synthetic picture)');
    check(new URL(thumb.src).origin === contentBase && /^\/t\/[A-Za-z0-9_-]{43}$/.test(new URL(thumb.src).pathname), 'its src is a ticket on the separate content origin (not the owner origin, no path)');
    check(thumb.crossOrigin === 'anonymous' && thumb.referrerPolicy === 'no-referrer', 'the image loads anonymous with no Referer');
    const ticketHits = creqs.filter(r => r.ticket === 'ticket' && r.method === 'GET');
    check(ticketHits.length >= 1 && ticketHits.every(r => !r.cookie && !r.referer && !r.shellToken && r.origin === 'null'), 'content listener saw the frame\'s GET: Origin null, no cookie, no Referer, no shell token');
    check(trace.some(r => r.path === '/wizard/v1/browser-adapters/call' && r.status === 200 && r.hasShellToken), 'the ticket was minted through the shell\'s possession-bound adapter call');
    const frameMedia = nreq.filter(r => r.path.startsWith('/notifications/media/') && fromFrame(r));
    check(frameMedia.length === 0, 'the real screen never asked the app\'s own /notifications/media/* route for the thumbnail');
    let shot = path.join(out, 'media-obsidian-detail.png'); await page.screenshot({ path: shot }); report.screenshots.push(shot);
    // Viewer: its own 'read' ticket.
    const mintedBefore = trace.filter(r => r.path === '/wizard/v1/browser-adapters/call').length;
    await app.locator('#body .thumb').click();
    await app.waitForFunction(() => { const v = document.querySelector('#viewer'), i = document.querySelector('#viewer-img'); return v && !v.hidden && i.complete && i.naturalWidth === 320; }, null, { timeout: 10000 });
    check(trace.filter(r => r.path === '/wizard/v1/browser-adapters/call').length > mintedBefore, 'opening the picture asks for a fresh read ticket; the viewer shows it');
    shot = path.join(out, 'media-obsidian-viewer.png'); await page.screenshot({ path: shot }); report.screenshots.push(shot);
    await app.locator('#viewer-close').click();
    // ---- Hostile: the frame aims at the app's own media route and at the content listener's other paths. ----
    const hostile = await app.evaluate(async p => {
      const r = {};
      const img = src => new Promise(res => { const i = new Image(); i.onload = () => res('loaded'); i.onerror = () => res('error'); i.src = src; });
      r.directImg = await img('media' + p.split('/').map(encodeURIComponent).join('/'));
      try { const x = await fetch('media' + p.split('/').map(encodeURIComponent).join('/'), { mode: 'no-cors' }); r.directFetch = x.type; } catch (_) { r.directFetch = 'blocked'; }
      for (const id of ['../../etc/passwd', p]) { try { await WizardApp.media.open({ resourceId: id, purpose: 'thumbnail' }); r['path:' + id.slice(0, 8)] = 'ALLOWED'; } catch (e) { r['path:' + id.slice(0, 8)] = e.code; } }
      try { await WizardApp.media.open({ resourceId: 'n:SynthMMMM0002:1', purpose: 'thumbnail' }); r.noPicture = 'ALLOWED'; } catch (e) { r.noPicture = e.code; }
      return r;
    }, pic);
    report.hostile = hostile;
    await sleep(300);
    check(hostile.directImg === 'error', 'frame <img> straight at media/<path> fails');
    const hostileMedia = nreq.filter(r => r.path.startsWith('/notifications/media/') && fromFrame(r));
    report.hostileMedia = hostileMedia;
    check(hostileMedia.length >= 2 && hostileMedia.every(r => r.status === 403), `server-side: the frame's ${hostileMedia.length} direct requests to /notifications/media/* (img + fetch) were refused 403 by the app listener gate`);
    check(Object.entries(hostile).filter(([k]) => k.startsWith('path:')).every(([, v]) => v === 'bad_request') && hostile.noPicture === 'not_found', 'media.open refuses paths (bad_request) and a notification without that picture (not_found)');
    for (const p of ['/', '/wizard/v1/browser-adapters/bindings', '/notifications/api/items', '/t/short']) check((await raw(contentBase + p)).status === 404, `content listener has no route for ${p} (404)`);
    // ---- Two more skins: Landscapes Light and Landscapes (photo), detail with the ticketed thumbnail. ----
    for (const skin of ['landscapes-light', 'landscapes']) {
      app = await minimal(skin);
      thumb = await openDetail(app);
      check(thumb.ok && new URL(thumb.src).origin === contentBase, `${skin}: thumbnail through a ticket`);
      shot = path.join(out, `media-${skin}-detail.png`); await page.screenshot({ path: shot }); report.screenshots.push(shot);
    }
    // ---- Expiry: absolute; the screen renews on its own when it needs the picture again. ----
    const ticketUrl = thumb.src;
    check((await raw(ticketUrl, { headers: { range: 'bytes=0-15' } })).status === 206 && (await raw(ticketUrl, { method: 'HEAD' })).status === 200, 'Range and HEAD on the live ticket');
    if (TTL <= 10000) {
      await sleep(TTL + 300);
      check((await raw(ticketUrl)).status === 410, `after ${TTL} ms the same ticket is refused (410), use never extended it`);
      app = await frameOf();
      thumb = await openDetail(app);
      check(thumb.ok && thumb.src !== ticketUrl, 'reopening the notification gets a fresh ticket and the picture renders again');
    } else report.open.push({ item: 'expiry in browser', detail: 'TTL is the production 60 s; expiry is covered by the Service tests in this run' });
    // ---- Closing the window revokes the binding: a still-valid ticket stops at once. ----
    const live = (await openDetail(app)).src;
    check((await raw(live)).status === 200, 'fresh ticket serves before the window closes');
    const appSrc = await page.evaluate(() => { const f = document.querySelector('iframe[src*="/notifications/"]'); const src = f.src; f.dataset.qaSrc = src; f.src = 'about:blank'; return src; });
    await sleep(600);
    const afterClose = (await raw(live)).status;
    check([403, 410].includes(afterClose), `navigating the frame away revokes its binding; the unexpired ticket is refused (${afterClose})`);
    // ---- WAM revokes notifications.media: tickets stop, the screen shows Picture unavailable. ----
    await page.evaluate(src => { const f = document.querySelector('iframe[data-qa-src]'); f.src = src; }, appSrc);
    app = await frameOf();
    await app.waitForFunction(() => document.querySelectorAll('#list .subject-row').length === 2, null, { timeout: 15000 });
    const beforeRevoke = (await openDetail(app)).src;
    wam('revoke', 'notifications', 'notifications.media');
    check((await raw(beforeRevoke)).status === 403, 'after a WAM revoke of notifications.media the unexpired ticket is refused (403)');
    await page.evaluate(() => { const f = document.querySelector('iframe[src*="/notifications/"]'); f.src = f.src; });
    app = await frameOf();
    await app.waitForFunction(() => document.querySelectorAll('#list .subject-row').length === 2, null, { timeout: 15000 });
    const denied = await openDetail(app);
    check(denied.missing === true, 'fresh binding without the media grant: inbox still works, the picture shows "Picture unavailable"');
    shot = path.join(out, 'media-revoked-obsidian-light.png'); await setSkin('obsidian-light'); await sleep(800); await page.screenshot({ path: shot }); report.screenshots.push(shot);
    check(report.contentRequests.every(r => !r.cookie && !r.shellToken), 'no content-listener request ever carried a cookie or the shell token');
    report.frontLogTail = frontLog.slice(-1500);
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: true, checks: report.checks.length, open: report.open, screenshots: report.screenshots, errors: report.errors.length }, null, 2));
  } catch (error) {
    report.failure = error.stack; report.frontLogTail = frontLog.slice(-2000);
    try { const s = path.join(out, 'failure.png'); await page?.screenshot({ path: s }); report.failureShot = s; } catch (_) {}
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2));
    throw error;
  } finally {
    await browser?.close().catch(() => {});
    for (const c of children) c.kill();
    for (const s of [proxy, service, content, hermes, ntfy]) await close(s).catch(() => {});
  }
})().catch(e => { console.error(e); process.exit(1); });
