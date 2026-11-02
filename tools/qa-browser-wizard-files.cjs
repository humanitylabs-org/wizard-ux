// Browser trust: the first-party Files view (humanitylabs-org/wizard-files) in the opaque boundary (wizard-os #385/#386,
// ADAPTER-SKETCH §4/§6). Real Chromium + real Agent Service (typed files.* operations, its content-ticket listener and
// its resumable upload store) + REAL WAM install/grant/credential state from the app's own wizard.md + the REAL
// wizard-files server.py on a synthetic owner-files root. Every listener is https on one synthetic host (box.test).
// Node stand-ins replace nginx (shell document + gateway prefix strip) and Tailscale Serve. Synthetic files only.
// Candidate: every feature (browse, thumbnails, search, preview, video seek past a ticket's expiry, upload with
// progress + resume after a lost connection + cancel, download/open through the shell, folder scoping) inside the
// opaque frame, plus hostile probes with the server-side refusals recorded. QA_BASELINE=1: the unmigrated app
// (QA_WFILES_BASE) with the boundary off: the same features same-origin, and the same hostile probes succeeding.
// Env: QA_OUT, QA_SERVICE_ROOT, QA_WAM_ROOT, QA_WFILES_ROOT, QA_PYTHON (venv with Pillow), QA_PLAYWRIGHT, QA_CHROME.
const fs = require('node:fs'), path = require('node:path'), https = require('node:https');
const assert = require('node:assert/strict'), { spawn, execFileSync } = require('node:child_process');
const R = require('./qa-browser-files-rig.cjs'), { HOST, listen, close, freePort, sleep, raw } = R;
const root = path.resolve(process.env.QA_UX_ROOT || path.join(__dirname, '..')), out = path.resolve(process.env.QA_OUT || '');
const { chromium } = require(path.join(root, 'tools/qa-playwright.cjs'));
for (const k of ['QA_OUT', 'QA_SERVICE_ROOT', 'QA_WAM_ROOT', 'QA_WFILES_ROOT', 'QA_PYTHON']) if (!process.env[k]) throw new Error(k + ' is required');
const BASELINE = process.env.QA_BASELINE === '1', WFILES = path.resolve(process.env.QA_WFILES_ROOT), BASE_REV = process.env.QA_WFILES_BASE || 'origin/main';
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
const token = R.crypto.randomBytes(32).toString('hex'), ownerProof = R.crypto.randomBytes(32).toString('hex');
const web = path.join(root, 'web'), TTL = 4000;
const report = { candidate: !BASELINE, baseline: BASELINE, nginxStandIn: 'node', checks: [], screenshots: [], errors: [], wam: [], listener: [], content: [], chunks: [], service: {} };
const check = (value, name) => { assert.ok(value, name); report.checks.push(name); };
const box = path.join(out, 'box'), files = path.join(out, 'owner-files');
const wam = (...args) => { report.wam.push(args.join(' ')); return execFileSync(process.env.QA_PYTHON, [path.join(process.env.QA_WAM_ROOT, 'tools/browser_admission_fixture.py'), box, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); };
const sha = f => R.crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const children = [], servers = [];
const OPS = ['files.list', 'files.index', 'files.thumbnail', 'files.content', 'files.upload'];
(async () => {
  const tls = R.certificate(path.join(out, 'tls'));
  // 1. Synthetic owner files: a photo, a 20 s video, a note, app data that must stay browse-only.
  for (const d of ['Documents', 'Photos', 'Videos', 'Apps/notes']) fs.mkdirSync(path.join(files, d), { recursive: true });
  fs.writeFileSync(path.join(files, 'Documents/synthetic-notes.txt'), 'Synthetic owner note for the Files QA.\n');
  fs.writeFileSync(path.join(files, 'Apps/notes/app-data.txt'), 'synthetic app data\n');
  execFileSync(process.env.QA_PYTHON, ['-c', `from PIL import Image\nim=Image.new('RGB',(1200,800))\npx=im.load()\nfor x in range(1200):\n  for y in range(0,800,4):\n    px[x,y]=(x*255//1200,y*255//800,160)\nim.save(${JSON.stringify(path.join(files, 'Photos/synthetic-sunset.jpg'))},quality=85)`]);
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=30:size=1280x720:rate=25', '-vf', 'noise=alls=50:allf=t+u', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '12M', '-maxrate', '12M', '-bufsize', '24M', '-movflags', '+faststart', '-y', path.join(files, 'Videos/synthetic-clip.mp4')]);
  report.videoBytes = fs.statSync(path.join(files, 'Videos/synthetic-clip.mp4')).size;
  // 2. Ports and WAM state from the app's own wizard.md.
  const shellPort = await freePort(), appPort = await freePort(), contentPort = await freePort();
  const SHELL = `https://${HOST}:${shellPort}`, CONTENT = `https://${HOST}:${contentPort}`;
  const appDir = BASELINE ? path.join(out, 'wizard-files-base') : WFILES;
  if (BASELINE) { fs.mkdirSync(appDir); execFileSync('sh', ['-c', `git -C ${JSON.stringify(WFILES)} archive ${BASE_REV} | tar -x -C ${JSON.stringify(appDir)}`]); }
  fs.mkdirSync(path.join(box, 'home'), { recursive: true });
  fs.writeFileSync(path.join(box, 'home/routes.json'), JSON.stringify({ 'wizard-files': { view: '/wizard-files/' }, 'hostile-notes': { view: '/hostile-notes/' } }));
  wam('install', 'wizard-files', '--repo', 'humanitylabs-org/wizard-files', '--provides', 'files', '--port', String(appPort), '--wizard-md', path.join(appDir, 'wizard.md'), '--listener-auth');
  wam('install', 'hostile-notes', '--repo', 'synthetic/hostile-notes', '--provides', 'notes', '--port', String(await freePort()), '--no-contract');
  if (!BASELINE) wam('grant', 'wizard-files', ...OPS);
  wam('write');
  const apps = JSON.parse(fs.readFileSync(path.join(box, 'home/apps.json'), 'utf8')).apps, wf = apps.find(a => a.id === 'wizard-files');
  report.wamBrowser = wf.browser;
  const env = Object.fromEntries((fs.existsSync(path.join(box, 'runtipi/user-config/wizardapps/wizard-files/app.env')) ? fs.readFileSync(path.join(box, 'runtipi/user-config/wizardapps/wizard-files/app.env'), 'utf8') : '').split('\n').filter(Boolean).map(l => [l.split('=')[0], l.slice(l.indexOf('=') + 1)]));
  if (!BASELINE) {
    check(wf.browser.contract?.isolation === 'opaque' && wf.browser.admissible === true && OPS.every(o => wf.browser.granted.includes(o)), 'WAM: wizard-files admitted opaque with its five owner-granted files.* operations');
    check(wf.browser.listener_credential?.state === 'written' && /^[0-9a-f]{64}$/.test(env.WIZARD_APP_CREDENTIAL || '') && env.WIZARD_BROWSER_BOUNDARY === '1', 'WAM: listener credential minted and written to the app env (never in apps.json)');
    check(!JSON.stringify(apps).includes(env.WIZARD_APP_CREDENTIAL), 'apps.json carries only the credential reference, not its value');
  }
  // 3. The REAL wizard-files server.py.
  const appEnv = { PATH: process.env.PATH, PORT: String(appPort), FILES_ROOT: files, FILES_ALLOWED_HOSTS: `${HOST},127.0.0.1`, FILES_CACHE_DIR: path.join(out, 'thumb-cache'), FILES_APP_DATA_PREFIXES: '["Apps/notes"]', PYTHONDONTWRITEBYTECODE: '1',
    ...(BASELINE ? {} : { WIZARD_BROWSER_BOUNDARY: '1', WIZARD_APP_CREDENTIAL: env.WIZARD_APP_CREDENTIAL }) };
  const app = spawn(process.env.QA_PYTHON, ['-B', 'server.py'], { cwd: appDir, env: appEnv, stdio: ['ignore', 'pipe', 'pipe'] }); children.push(app);
  let appLog = ''; app.stdout.on('data', b => appLog += b); app.stderr.on('data', b => appLog += b);
  for (let i = 0; i < 80 && (await raw(`http://127.0.0.1:${appPort}/health`)).status !== 200; i++) await sleep(100);
  // 4. Agent Service: WAM resolver, typed files.* operations, https content listener, resumable uploads into the root.
  const svc = await R.startService({ out, serviceRoot: process.env.QA_SERVICE_ROOT, box, token, ownerProof, boundary: !BASELINE,
    content: BASELINE ? null : { publicBase: CONTENT, ttlMs: TTL },
    extra: { mediaRoot: files, userFilesRoot: files, uploadStatePath: path.join(out, 'service-state/uploads.sqlite3'), uploadStagingDir: path.join(out, 'service-state/staging'), uploadReserveBytes: 0 } });
  fs.mkdirSync(path.join(out, 'service-state/staging'), { recursive: true });
  const service = svc.createWizardServer(svc.options); servers.push(service, svc.hermes); const sp = await listen(service);
  if (!BASELINE) {
    const handler = service.browserContent.createServer().listeners('request');
    const content = https.createServer(tls, (req, res) => { const r = { at: Date.now(), method: req.method, ticket: /^\/t\/[A-Za-z0-9_-]{43}$/.test(req.url), range: req.headers.range || '', origin: req.headers.origin ?? '', cookie: req.headers.cookie !== undefined, referer: req.headers.referer !== undefined, shellToken: req.headers['x-wizard-shell-token'] !== undefined }; report.content.push(r); const wh = res.writeHead.bind(res); res.writeHead = (s, ...rest) => { r.status = s; return wh(s, ...rest); }; for (const l of handler) l(req, res); });
    servers.push(content); await listen(content, contentPort);
  }
  // 5. Shell stand-in: document (+ boundary template unless baseline), /wizard/ to the Service, the gateway's
  //    /wizard-files/ prefix strip to the app listener; a switch to drop upload chunks (a lost connection).
  const net = { dropUntil: 0, delay: 0 };
  const hostileDir = path.join(out, 'hostile-notes'); fs.mkdirSync(hostileDir, { recursive: true });
  fs.writeFileSync(path.join(hostileDir, 'index.html'), '<!doctype html><meta charset="utf-8"><title>Notes</title><script src="/wizard-os-home/core/browser-boundary-client.js" onerror="this.remove()"></script><script src="/wizard-os-home/core/app-client.js"></script><body style="font:14px system-ui;padding:24px"><h1>Synthetic notes app</h1><p>(hostile probe page; synthetic)</p></body>');
  const shell = R.shellProxy({ tls, web, token, ownerProof, servicePort: sp, inject: !BASELINE,
    routes: { '/wizard-files/': { port: appPort, strip: true }, '/hostile-notes/': { static: hostileDir } }, record: r => report.listener.push(r),
    intercept: (req, res, p) => {
      // Baseline (same-origin uploads): only slowed for the cancel step.
      if (p.startsWith('/wizard/v1/uploads/') && req.method === 'PATCH' && net.delay) { req.pause(); setTimeout(() => { req.resume(); svcForward(req, res); }, net.delay); return true; }
      if (p !== '/wizard/v1/browser-adapters/upload-chunk') return false;
      const chunk = { at: Date.now(), offset: Number(req.headers['upload-offset']), bytes: Number(req.headers['content-length']), dropped: Date.now() < net.dropUntil }; report.chunks.push(chunk); req.chunk = chunk;
      if (Date.now() < net.dropUntil) { req.socket.destroy(); return true; }
      if (net.delay) { req.pause(); setTimeout(() => { req.resume(); svcForward(req, res); }, net.delay); return true; }
      svcForward(req, res); return true;
    } });
  const svcForward = (req, res) => { const up = require('node:http').request({ host: '127.0.0.1', port: sp, method: req.method, path: req.url, headers: { ...req.headers, 'x-wizard-owner-proof': ownerProof } }, r => { if (req.chunk) req.chunk.status = r.statusCode; res.writeHead(r.statusCode, r.headers); r.pipe(res); }); up.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(up); };
  servers.push(shell); await listen(shell, shellPort);
  let browser, page;
  const shotDir = out;
  try {
    browser = await chromium.launch({ headless: true, args: [`--host-resolver-rules=MAP ${HOST} 127.0.0.1`, '--autoplay-policy=no-user-gesture-required'], ...(process.env.QA_CHROME ? { executablePath: process.env.QA_CHROME } : {}) });
    const context = await browser.newContext({ viewport: { width: 1440, height: 940 }, serviceWorkers: 'block', ignoreHTTPSErrors: true, acceptDownloads: true });
    page = await context.newPage(); page.on('pageerror', e => report.errors.push('page: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) report.errors.push('console: ' + m.text().slice(0, 300)); });
    await require('./qa-browser-onboarding.cjs')(page, token, report);
    if (BASELINE) {
      // Boundary off: the shell sends no shell token, so the same synthetic established-owner answers without it.
      await page.route('**/wizard/v1/setup', r => r.request().frame() === page.mainFrame() ? r.fulfill({ status: 200, contentType: 'application/json', body: '{"first_run":false}' }) : r.continue());
      await page.route('**/wizard/hermes/api/model/options', r => r.request().frame() === page.mainFrame() ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ provider: 'synthetic-qa', model: 'synthetic-model', providers: [{ slug: 'synthetic-qa', authenticated: true, models: ['synthetic-model'] }] }) }) : r.continue());
    }
    await page.goto(`${SHELL}/wizard-os-home/desktop.html`);
    if (!BASELINE) await page.waitForFunction(() => window.WizBrowserBoundary?.enabled && window.wizardUX, { timeout: 20000 });
    await page.waitForFunction(() => document.querySelector('.home') && window.WizCore?.apps('desktop')?.APP?.['wizard-files'], null, { timeout: 20000 });
    const setSkin = async skin => { await page.evaluate(s => { WosSkin.set(s); WizAppearance.sync(); }, skin); await sleep(800); };
    const shot = async name => { const f = path.join(shotDir, name + '.png'); await page.screenshot({ path: f }); report.screenshots.push(f); return f; };
    await page.evaluate(() => dispatchEvent(new CustomEvent('wizard:open', { detail: { path: '/wizard-files/' } })));
    const frame = await require('./qa-browser-frame.cjs')(page, '/wizard-files/');
    const sandbox = await page.locator('iframe[src*="/wizard-files/"]').getAttribute('sandbox');
    report.frame = { sandbox, origin: await frame.evaluate(() => self.origin) };
    if (!BASELINE) check(sandbox === 'allow-scripts allow-forms allow-downloads' && report.frame.origin === 'null', 'wizard-files runs in the opaque sandboxed frame (origin null)');
    else check(!sandbox && report.frame.origin === SHELL, 'BASELINE: wizard-files runs same-origin with the shell (no sandbox)');
    const inFrame = (fn, arg) => frame.evaluate(fn, arg);
    const route = async hash => { await inFrame(h => { history.pushState({ wizardFilesRoute: true }, '', location.pathname + h); dispatchEvent(new HashChangeEvent('hashchange')); }, hash); };
    const rows = () => inFrame(() => [...document.querySelectorAll('#my-list .my-row')].map(r => r.dataset.name));
    // ---- Browse ----
    await route('#/my');
    await frame.waitForFunction(() => document.querySelectorAll('#my-list .my-row').length >= 3, null, { timeout: 15000 });
    report.rootRows = await rows();
    check(['Apps', 'Documents', 'Photos', 'Videos'].every(n => report.rootRows.includes(n)), 'browse: the root folder lists Apps, Documents, Photos, Videos');
    await route('#/my/Photos');
    await frame.waitForFunction(() => document.querySelector('#my-list .my-row[data-name="synthetic-sunset.jpg"] .my-icon img'), null, { timeout: 20000 });
    const thumb = await inFrame(() => { const i = document.querySelector('#my-list .my-row[data-name="synthetic-sunset.jpg"] .my-icon img'); return { src: i.src.slice(0, 30), w: i.naturalWidth, h: i.naturalHeight }; });
    check(thumb.src.startsWith('data:image/jpeg') && thumb.w > 0 && thumb.w <= 512, `thumbnail: a bounded JPEG preview (${thumb.w}x${thumb.h}) painted for the photo`);
    // ---- Preview (photo) ----
    await route('#/my/Photos?f=synthetic-sunset.jpg');
    await frame.waitForFunction(() => { const i = document.querySelector('#my-sheet-preview img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 15000 });
    const photo = await inFrame(() => { const i = document.querySelector('#my-sheet-preview img'); return { src: i.src, w: i.naturalWidth }; });
    report.photoSrc = photo.src.replace(/\/t\/.*/, '/t/<ticket>');
    if (!BASELINE) check(new URL(photo.src).origin === CONTENT && /^\/t\/[A-Za-z0-9_-]{43}$/.test(new URL(photo.src).pathname) && photo.w === 1200, 'preview: the full photo (1200 px) loads from a ticket on the separate content origin');
    else check(new URL(photo.src).pathname === '/wizard-files/api/files/content' && photo.w === 1200, 'BASELINE: the photo loads from the app\'s own same-origin content route');
    await shot(BASELINE ? 'baseline-photo-preview' : 'photo-preview-nebula');
    // ---- Video: play, seek (Range), seek again after the ticket expired (renewal) ----
    await route('#/my/Videos');
    await frame.waitForFunction(() => document.querySelector('#my-list .my-row[data-name="synthetic-clip.mp4"]'), null, { timeout: 15000 });
    await frame.locator('#my-list .my-row[data-name="synthetic-clip.mp4"]').click();
    await frame.waitForFunction(() => { const v = document.querySelector('#my-sheet-preview video'); return v && v.readyState >= 1 && v.duration > 0; }, null, { timeout: 20000 });
    const seek = t => inFrame(t => new Promise(res => { const v = document.querySelector('#my-sheet-preview video'); const done = () => res({ t: v.currentTime, ready: v.readyState, src: v.currentSrc }); v.addEventListener('seeked', done, { once: true }); v.currentTime = t; setTimeout(() => res({ timeout: true, t: v.currentTime, ready: v.readyState, src: v.currentSrc, err: v.error?.code }), 15000); }), t);
    const firstSeek = await seek(14.5);
    const markSeek = Date.now();
    report.seek1 = { ...firstSeek, src: firstSeek.src.replace(/\/t\/.*/, '/t/<ticket>') };
    check(!firstSeek.timeout && Math.abs(firstSeek.t - 14.5) < 0.6 && firstSeek.ready >= 2, `video: seek to 14.5 s lands (${firstSeek.t.toFixed(2)} s, readyState ${firstSeek.ready})`);
    if (!BASELINE) {
      const ranges = report.content.filter(r => r.ticket && r.status === 206 && /^bytes=[1-9]/.test(r.range));
      check(ranges.length >= 1, `content listener served Range requests from a non-zero offset (206): ${ranges.slice(0, 3).map(r => r.range).join(', ')}`);
      await sleep(TTL + 1500);   // the ticket is now expired (absolute ${TTL} ms in this QA; 60 s on a box)
      const before = firstSeek.src;
      const second = await seek(7.0);
      report.seek2 = { ...second, src: second.src.replace(/\/t\/.*/, '/t/<ticket>') };
      const old = await raw(before, { headers: { range: 'bytes=0-1023' } });
      report.expiredTicketStatus = old.status;
      check(!second.timeout && Math.abs(second.t - 7.0) < 0.6 && second.ready >= 2 && second.src !== before, 'video: after its ticket lapsed, a seek back to 7 s (unbuffered) renewed the ticket through the binding and landed');
      check(old.status === 410, 'server-side: the lapsed ticket now answers 410 (absolute expiry, no sliding extension)');
      check(report.content.every(r => !r.cookie && !r.referer && !r.shellToken), 'no content-listener request carried a cookie, Referer or the shell token');
    }
    await shot(BASELINE ? 'baseline-video' : 'video-seek-nebula');
    // ---- Download + Open through the shell (trusted save/open) ----
    const dl = page.waitForEvent('download', { timeout: 15000 });
    await frame.locator('#my-sheet-actions >> text=Download').click();
    const download = await dl; const saved = path.join(out, 'downloaded.mp4'); await download.saveAs(saved);
    report.download = { suggested: download.suggestedFilename(), url: download.url().replace(/\/t\/.*/, '/t/<ticket>'), sha: sha(saved) === sha(path.join(files, 'Videos/synthetic-clip.mp4')) };
    check(report.download.sha && report.download.suggested === 'synthetic-clip.mp4', 'download: the file saved by the browser is byte-identical (sha256) and named synthetic-clip.mp4');
    if (!BASELINE) {
      check(download.page() === page && new URL(download.url()).origin === CONTENT, 'download was started by the shell document from a ticket (attachment) on the content origin');
      const opening = context.waitForEvent('page', { timeout: 10000 });
      await frame.locator('#my-sheet-actions >> text=Open').click();
      const tab = await opening; await tab.waitForLoadState('domcontentloaded').catch(() => {});
      report.openTab = { origin: new URL(tab.url()).origin, opener: await tab.evaluate(() => window.opener === null).catch(() => null) };
      check(report.openTab.origin === CONTENT && report.openTab.opener !== false, 'open: the shell opened the file in a new tab on the content origin (no opener)');
      await tab.close();
      // Without the owner's click there is no download. (Playwright's evaluate itself carries a user gesture, so the
      // probe starts from a timer inside the frame 6 s later, after any transient activation has lapsed.)
      await inFrame(() => { setTimeout(() => { window.__probe = WizardApp.download.request({ resourceId: 'fr_' + 'A'.repeat(22), action: 'save' }).then(() => 'saved', e => e.code); }, 6000); });
      await sleep(8000);
      const noClick = await inFrame(() => window.__probe);
      report.noClick = noClick;
      check(noClick === 'denied', 'download.request without an owner click is refused by the shell (denied)');
    }
    await inFrame(() => document.querySelector('#my-sheet .sheet-close').click());
    // ---- Search / recent index ----
    await route('#/');
    await frame.waitForFunction(() => /synthetic-sunset\.jpg|synthetic-clip\.mp4/.test(document.body.innerText), null, { timeout: 20000 });
    check(true, 'index: Files home lists recent files (synthetic-sunset.jpg / synthetic-clip.mp4) from the bounded index');
    await setSkin('grove'); await shot(BASELINE ? 'baseline-home-grove' : 'home-grove'); await setSkin('nebula');
    // ---- Upload: progress, then resume after a lost connection, then the file on disk ----
    await route('#/my/Documents');
    await frame.waitForFunction(() => !document.querySelector('#my-upload').disabled, null, { timeout: 15000 });
    const big = path.join(out, 'synthetic-upload.bin'); fs.writeFileSync(big, R.crypto.randomBytes(5 * 1024 * 1024 + 12345));
    const states = [];
    if (!BASELINE) { net.dropUntil = 0; net.delay = 250; }
    await frame.locator('#my-picker').setInputFiles(big);
    const watch = setInterval(() => inFrame(() => [...document.querySelectorAll('#my-uploads .my-upload')].map(n => n.dataset.state + '|' + n.querySelector('.my-upload-state').textContent)).then(s => states.push(...s)).catch(() => {}), 150);
    if (!BASELINE) { await frame.waitForFunction(() => /Uploading [1-9]/.test(document.querySelector('#my-uploads')?.innerText || ''), null, { timeout: 20000 }); net.dropUntil = Date.now() + 3000; }
    await frame.waitForFunction(() => document.querySelector('#my-uploads .my-upload')?.dataset.state === 'done' || document.querySelector('#my-uploads .my-upload')?.dataset.state === 'failed', null, { timeout: 120000 });
    clearInterval(watch); net.delay = 0;
    report.uploadStates = [...new Set(states)].slice(0, 40);
    const landed = path.join(files, 'Documents/synthetic-upload.bin');
    check(fs.existsSync(landed) && sha(landed) === sha(big), 'upload: 5 MiB + 12345 B landed in Documents byte-identical (sha256)');
    check(report.uploadStates.some(s => /^uploading\|Uploading \d+%/.test(s)), 'upload: progress shown while uploading (' + report.uploadStates.filter(s => s.startsWith('uploading')).slice(0, 3).join(' / ') + ')');
    if (!BASELINE) {
      const sent = report.chunks.filter(c => !c.dropped);
      const lost = report.chunks.filter(c => c.dropped).length;
      check(report.uploadStates.some(s => s.startsWith('reconnecting')) && lost >= 1, `resume: the connection dropped for 3 s (${lost} chunk request(s) cut) → "Reconnecting… n% kept", then the upload carried on from the server's offset`);
      check(sent.every(c => c.bytes <= 1048576) && sent.length >= 6 && sent.every(c => c.status === 200), `upload port: ${sent.length} chunks of at most 1 MiB, each answered 200 after its own Service check`);
      const offsets = sent.map(c => c.offset); report.chunkOffsets = offsets;
      check(offsets.every((o, i) => i === 0 || o >= offsets[i - 1]), 'chunks resumed at increasing server offsets (no byte sent twice past the acknowledged offset)');
    }
    await frame.waitForFunction(() => document.querySelector('#my-list .my-row[data-name="synthetic-upload.bin"]'), null, { timeout: 10000 });
    check(true, 'the uploaded file shows in the folder listing');
    await shot(BASELINE ? 'baseline-upload-done' : 'upload-done-nebula');
    // ---- Cancel ----
    const cancelFile = path.join(out, 'synthetic-cancel.bin'); fs.writeFileSync(cancelFile, R.crypto.randomBytes(6 * 1024 * 1024));
    net.delay = BASELINE ? 3000 : 400;
    await frame.locator('#my-picker').setInputFiles(cancelFile);
    await frame.waitForFunction(b => [...document.querySelectorAll('#my-uploads .my-upload')].some(n => n.dataset.state === 'uploading' && (b || /Uploading [1-9]/.test(n.innerText))), BASELINE, { timeout: 30000 });
    if (BASELINE) await sleep(800);
    await frame.locator('#my-uploads .my-upload[data-state="uploading"] .my-cancel').click();
    await sleep(2500); net.delay = 0;
    const toast = await inFrame(() => document.querySelector('#toast')?.textContent || '');
    report.cancelToast = toast;
    check(!fs.existsSync(path.join(files, 'Documents/synthetic-cancel.bin')), 'cancel: the cancelled file never appears in Documents');
    if (!BASELINE) {
      check(/Upload cancelled/.test(toast), 'cancel: the box reports the real outcome (aborted) → "Upload cancelled"');
      const staged = fs.readdirSync(path.join(files, '.wizard-uploads'), { recursive: true }).filter(f => /\.part$|staging/.test(String(f)));
      report.stagedAfterCancel = staged;
    }
    // ---- Landscapes Light: the Photos folder with its thumbnail and the finished upload rows ----
    await route('#/my/Photos');
    await frame.waitForFunction(() => document.querySelector('#my-list .my-row[data-name="synthetic-sunset.jpg"] .my-icon img'), null, { timeout: 15000 });
    await setSkin('landscapes-light'); await sleep(800); await shot(BASELINE ? 'baseline-landscapes-light' : 'photos-landscapes-light'); await setSkin('nebula');
    // ---- Folder scoping: app data browse-only, server-side ----
    await route('#/app/my/Apps/notes');
    await sleep(1500);
    if (!BASELINE) {
      const scoped = await inFrame(async () => {
        const r = {};
        try { r.appList = (await WizardApp.data.call({ operation: 'files.list', args: { folder: 'Apps/notes', scope: 'app' } })).entries.map(e => e.name); } catch (e) { r.appList = e.code; }
        try { r.personalHidden = (await WizardApp.data.call({ operation: 'files.list', args: { folder: '', scope: 'personal' } })).entries.map(e => e.name); } catch (e) { r.personalHidden = e.code; }
        try { await WizardApp.upload.create({ folder: 'Apps/notes', filename: 'x.txt', mime: 'text/plain', bytes: 3, clientUploadId: 'probe-appdata-1' }); r.appUpload = 'created'; } catch (e) { r.appUpload = e.code; }
        try { await WizardApp.upload.create({ folder: '../outside', filename: 'x.txt', mime: 'text/plain', bytes: 3, clientUploadId: 'probe-escape-1' }); r.escape = 'created'; } catch (e) { r.escape = e.code; }
        try { await WizardApp.data.call({ operation: 'files.list', args: { folder: 'Documents', scope: 'personal', path: '/etc' } }); r.extra = 'ok'; } catch (e) { r.extra = e.code; }
        try { await WizardApp.data.call({ operation: 'files.thumbnail', args: { resourceId: 'fr_' + 'B'.repeat(22) } }); r.forged = 'ok'; } catch (e) { r.forged = e.code; }
        try { await WizardApp.media.open({ resourceId: '../../etc/passwd', purpose: 'read' }); r.pathAsId = 'ok'; } catch (e) { r.pathAsId = e.code; }
        return r;
      });
      report.scoping = scoped;
      check(Array.isArray(scoped.appList) && scoped.appList.includes('app-data.txt'), 'scoping: app data is browsable in the app scope');
      check(scoped.appUpload === 'not_allowed' && scoped.escape === 'bad_request', 'scoping: an upload into app data is refused server-side (not_allowed); a ../ folder is refused (bad_request)');
      check(scoped.extra === 'bad_request' && scoped.forged === 'not_found' && scoped.pathAsId === 'bad_request', 'typed only: extra arguments refused, a forged resource id is not_found, a path is never a resource id');
    }
    await shot(BASELINE ? 'baseline-app-scope' : 'app-scope-nebula');
    // ---- Hostile 1: the Files frame itself (compromised) aims at its own listener's data routes ----
    const mark = Date.now();
    const direct = await inFrame(async () => { const r = {}; for (const [k, u] of [['list', '/wizard-files/api/files?folder=Documents'], ['content', '/wizard-files/api/files/content?path=Documents%2Fsynthetic-notes.txt']]) { try { const x = await fetch(u, { credentials: 'include' }); r[k] = x.status; const body = await x.text(); r[k + 'SawOwnerData'] = /synthetic-notes|Synthetic owner note/.test(body); r[k + 'Body'] = body.slice(0, 60); } catch (e) { r[k] = 'blocked'; } } return r; });
    await sleep(400);
    report.directFromFrame = direct;
    const dataHits = report.listener.filter(r => r.at >= mark && r.path.startsWith('/wizard-files/api/'));
    report.directFromFrameServerSide = dataHits;
    if (!BASELINE) check(dataHits.length >= 2 && dataHits.every(r => r.status === 403), `server-side: the frame's own direct reads of /wizard-files/api (list, content) were refused 403 by the listener (${dataHits.map(r => r.status).join(',')})`);
    else check(direct.list === 200 && direct.listSawOwnerData && direct.content === 200 && direct.contentSawOwnerData, 'BASELINE: the frame reads the app API and file bytes directly (200)');
    // ---- Hostile 2: another installed app's frame (no grants) asks the shell for Files' operations ----
    await page.evaluate(() => dispatchEvent(new CustomEvent('wizard:open', { detail: { path: '/hostile-notes/' } })));
    const hostile = await require('./qa-browser-frame.cjs')(page, '/hostile-notes/');
    const mark2 = Date.now();
    const fromHostile = await hostile.evaluate(async () => {
      const r = { origin: self.origin };
      if (window.WizBoundaryClient) await new Promise(res => { if (WizBoundaryClient.ready) res(); else addEventListener('wizard:boundary:connected', res, { once: true }); setTimeout(res, 8000); });
      const tryIt = async (k, f) => { try { await f(); r[k] = 'ok'; } catch (e) { r[k] = e.code || 'error:' + e.message.slice(0, 40); } };
      await tryIt('list', () => WizardApp.data.call({ operation: 'files.list', args: { folder: '', scope: 'personal' } }));
      await tryIt('media', () => WizardApp.media.open({ resourceId: 'fr_' + 'C'.repeat(22), purpose: 'read' }));
      await tryIt('upload', () => WizardApp.upload.create({ folder: '', filename: 'x.txt', mime: 'text/plain', bytes: 3, clientUploadId: 'hostile-upload' }));
      try { const x = await fetch('/wizard-files/api/files?folder=Documents', { credentials: 'include' }); r.direct = x.status; } catch (e) { r.direct = 'blocked'; }
      return r;
    });
    await sleep(400);
    report.hostileFrame = fromHostile;
    if (!BASELINE) {
      check(fromHostile.origin === 'null' && fromHostile.list === 'not_allowed' && fromHostile.media === 'not_allowed' && fromHostile.upload === 'not_allowed', 'another app\'s opaque frame: files.list, media tickets and the upload port are all refused (not_allowed)');
      const h2 = report.listener.filter(r => r.at >= mark2 && r.path.startsWith('/wizard-files/api/'));
      check(h2.every(r => r.status === 403), 'server-side: its direct read of /wizard-files/api was refused 403 (' + h2.length + ' request(s))');
    }
    // ---- Hostile 3: another app's own top-level tab on the Wizard origin (same-origin fetch) ----
    const appTab = await context.newPage(); await appTab.goto(`${SHELL}/hostile-notes/`);
    const mark3 = Date.now();
    const fromTab = await appTab.evaluate(async () => { const x = await fetch('/wizard-files/api/files?folder=Documents'); return { status: x.status, sawNote: /synthetic-notes/.test(await x.text()) }; });
    await sleep(300);
    report.hostileTab = { ...fromTab, serverSide: report.listener.filter(r => r.at >= mark3).map(r => `${r.method} ${r.path} → ${r.status}`) };
    if (!BASELINE) check(fromTab.status === 403 && !fromTab.sawNote, 'same-origin app tab: /wizard-files/api/files refused 403 by the listener (browser request, no adapter credential)');
    else check(fromTab.status === 200 && fromTab.sawNote, 'BASELINE: any same-origin app tab lists the owner\'s Documents (200)');
    await appTab.close();
    // ---- Network probes straight at the listener (no browser) ----
    if (!BASELINE) {
      const owner = await raw(`http://127.0.0.1:${appPort}/api/files?folder=Documents`, { headers: { host: `${HOST}:${shellPort}`, 'tailscale-user-login': 'owner@example.com', 'x-forwarded-for': '100.64.0.7' } });
      const bare = await raw(`http://127.0.0.1:${appPort}/api/files?folder=Documents`);
      const wrong = await raw(`http://127.0.0.1:${appPort}/api/files?folder=Documents`, { headers: { 'x-wizard-app-credential': 'f'.repeat(64) } });
      report.networkProbes = { owner: owner.status, bare: bare.status, wrong: wrong.status };
      check(owner.status === 403 && bare.status === 401 && wrong.status === 401, 'listener: the owner\'s tailnet login is not adapter authority (403); no or a wrong credential → 401');
    }
    // ---- Revocation: files.upload revoked mid-upload → the next chunk is refused server-side ----
    if (!BASELINE) {
      await page.bringToFront();
      await route('#/my/Documents');
      await frame.waitForFunction(() => !document.querySelector('#my-upload').disabled, null, { timeout: 15000 });
      const rev = path.join(out, 'synthetic-revoke.bin'); fs.writeFileSync(rev, R.crypto.randomBytes(6 * 1024 * 1024));
      net.delay = 400;
      await frame.locator('#my-picker').setInputFiles(rev);
      await frame.waitForFunction(() => [...document.querySelectorAll('#my-uploads .my-upload')].some(n => n.dataset.state === 'uploading' && /Uploading [1-9]/.test(n.innerText)), null, { timeout: 30000 });
      const markRev = Date.now();
      wam('revoke', 'wizard-files', 'files.upload'); wam('write');
      await frame.waitForFunction(() => [...document.querySelectorAll('#my-uploads .my-upload')].some(n => n.dataset.state === 'failed'), null, { timeout: 30000 });
      net.delay = 0;
      const after = report.chunks.filter(c => c.at >= markRev);
      report.revokeChunks = after;
      report.revokeMessage = await inFrame(() => [...document.querySelectorAll('#my-uploads .my-upload[data-state="failed"] .my-upload-state')].map(n => n.textContent).join(' | '));
      check(after.some(c => c.status === 403) && !fs.existsSync(path.join(files, 'Documents/synthetic-revoke.bin')), `revocation: the first chunk after files.upload was revoked got 403 from the Service; the upload stopped (${report.revokeMessage}) and no file was placed`);
    }
    // ---- Screens: Landscapes Light, then the dark standalone tab ----
    const darkCtx = await browser.newContext({ viewport: { width: 1100, height: 800 }, colorScheme: 'dark', ignoreHTTPSErrors: true });
    const sa = await darkCtx.newPage(); await sa.goto(`${SHELL}/wizard-files/#/my`); await sleep(2500);
    report.standalone = await sa.evaluate(() => ({ error: document.querySelector('#my-error')?.hidden === false ? document.querySelector('#my-error').textContent : '', rows: document.querySelectorAll('#my-list .my-row').length }));
    const fsa = path.join(out, BASELINE ? 'baseline-standalone-dark.png' : 'standalone-dark.png'); await sa.screenshot({ path: fsa }); report.screenshots.push(fsa);
    if (!BASELINE) check(report.standalone.rows === 0 && /Open Files from your Wizard/.test(report.standalone.error), 'dark standalone tab: the listener refuses its API (browser request) and the page says to open Files from Wizard');
    await darkCtx.close();
    report.appLogTail = appLog.slice(-1200);
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: true, baseline: BASELINE, checks: report.checks.length, screenshots: report.screenshots.length, errors: report.errors }, null, 2));
  } catch (error) {
    report.failure = error.stack; report.appLogTail = appLog.slice(-2000);
    try { const s = path.join(out, 'failure.png'); await page?.screenshot({ path: s }); report.failureShot = s; } catch (_) {}
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2));
    throw error;
  } finally {
    await browser?.close().catch(() => {});
    for (const c of children) c.kill();
    for (const s of servers) await close(s).catch(() => {});
  }
})().catch(e => { console.error(e); process.exit(1); });
