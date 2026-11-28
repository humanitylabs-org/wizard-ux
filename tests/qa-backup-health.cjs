// Browser proof for wizard-ux#1743 (on for everyone): Home › Resources › Health on a box with no watchdog.
// The shell's own files are served from QA_WEB at https://box.test/wizard-os-home/; /api/system/health answers 404 as
// on a stock box (nginx passes it to the Agent Service, which has no such route); store-install/_backup-health goes to
// a real App Manager store listener at QA_WAM (e.g. http://127.0.0.1:17743, adding the owner's Tailscale login as
// Tailscale Serve does). QA_FREE_FILE: the file that App Manager reads its free disk from (Include it's estimate).
// Usage: QA_PLAYWRIGHT=<playwright> QA_WEB=<repo>/web QA_WAM=<url> [QA_FREE_FILE=<file>] [QA_OUT=<dir>] node tests/qa-backup-health.cjs
const pw = require(process.env.QA_PLAYWRIGHT || 'playwright');
const fs = require('fs'), path = require('path'), http = require('http');
const WEB = process.env.QA_WEB || path.join(__dirname, '..', 'web'), WAM = process.env.QA_WAM || '', OUT = process.env.QA_OUT || '';
const FREE = process.env.QA_FREE_FILE || '';
const UA = 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/141.0.0.0 Mobile Safari/537.36';
const TYPES = { js: 'application/javascript', mjs: 'application/javascript', css: 'text/css', html: 'text/html', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', webp: 'image/webp', woff2: 'font/woff2', md: 'text/markdown' };
let pass = 0, fail = 0; const ok = (v, n, x = '') => { console.log(v ? 'PASS' : 'FAIL', n, v ? '' : x); v ? pass++ : fail++; };
const wam = [];
function toWam(req) {
  return new Promise((resolve, reject) => {
    const u = new URL(WAM.replace(/\/$/, '') + '/_backup-health');
    const body = req.postData() || '';
    const h = req.headers();
    const headers = { 'Tailscale-User-Login': 'owner@example.com', 'X-Forwarded-For': ['100', '64', '0', '9'].join('.'),
      ...(h.origin ? { Origin: h.origin } : {}), ...(h['x-wizard-store'] ? { 'X-Wizard-Store': h['x-wizard-store'] } : {}), ...(h['idempotency-key'] ? { 'Idempotency-Key': h['idempotency-key'] } : {}),
      ...(h['content-type'] ? { 'Content-Type': h['content-type'] } : {}), 'Content-Length': Buffer.byteLength(body) };
    const r = http.request(u, { method: req.method(), headers }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, body: d })); });
    r.on('error', reject); r.end(body);
  });
}
async function context(b) {
  const c = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block', userAgent: UA });
  await c.addInitScript(() => { localStorage.setItem('wos.coached', 'true'); });
  await c.route('https://box.test/**', async r => {
    const q = r.request(), u = new URL(q.url());
    if (u.pathname === '/wizard-os-home/store-install/_backup-health') {
      wam.push(q.method());
      if (!WAM) return r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not found"}' });
      const a = await toWam(q); return r.fulfill({ status: a.status, contentType: 'application/json', body: a.body });
    }
    if (u.pathname === '/api/system/load') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ cpuLoad: 12, percentUsedMemory: 41, percentUsed: 58, memoryTotal: 16e9, diskUsed: 116, diskSize: 200 }) });
    if (u.pathname.startsWith('/wizard-os-home/') && q.method() === 'GET') {
      const rel = decodeURIComponent(u.pathname.slice('/wizard-os-home/'.length)) || 'index.html', f = path.join(WEB, rel);
      if (f.startsWith(WEB) && fs.existsSync(f) && fs.statSync(f).isFile()) return r.fulfill({ status: 200, contentType: TYPES[rel.split('.').pop()] || 'application/octet-stream', body: fs.readFileSync(f) });
    }
    return r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not_found"}' });
  });
  return c;
}
async function boot(c, url = 'https://box.test/wizard-os-home/') {
  const p = await c.newPage(), errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto(url);
  await p.waitForFunction(() => window.WosResources?.state.server, null, { timeout: 30000 });
  await p.evaluate(() => window.WosResources.update(true)); await p.waitForTimeout(900);
  return { p, errs };
}
const healthText = p => p.locator('.rs-sheet .rs-detail-body').innerText();
(async () => {
  const b = await pw.chromium.launch(); const errs = [];
  {
    const c = await context(b), { p, errs: e } = await boot(c); errs.push(...e);
    const alert = p.locator('.rs-health-alert');
    ok(await alert.count() === 1 && /Main agent not in backup/.test(await alert.innerText()), 'Home names the left-out main agent', await alert.innerText().catch(() => ''));
    if (OUT) await p.screenshot({ path: path.join(OUT, 'home.png') });
    await p.locator('[data-res-open=server]').first().tap(); await p.waitForTimeout(300);
    await p.locator('[data-res-tab=health]').tap(); await p.waitForTimeout(900);
    const t = await healthText(p);
    {
      ok(/Backup\s*Last backup 11h ago, 1 warning/.test(t), 'Backup row from backup-status.json (amber: a warning)', t);
      ok(/Your main agent \(its memory, skills and chats\) isn’t in this backup|Your main agent \(its memory, skills and chats\) isn't in this backup/.test(t), 'warning in plain words', t);
      ok(!/unavailable/i.test(t), 'no "unavailable" on a box without a watchdog', t);
      ok(await p.locator('.rs-sheet [data-health="backups"].rs-h-warn').count() === 1, 'Backup row is amber');
      ok(await p.locator('.rs-sheet [data-res-bh]').count() === 1, 'Include it is offered');
      if (OUT) await p.locator('.rs-sheet').screenshot({ path: path.join(OUT, 'health-on.png') });
      await p.locator('.rs-sheet [data-res-bh]').tap(); await p.waitForTimeout(150);
      const busy = await p.locator('.rs-sheet [data-res-bh]').innerText().catch(() => '');
      await p.waitForSelector('.rs-sheet .rs-h-msg', { timeout: 20000 });
      const m = await p.locator('.rs-sheet .rs-h-msg').innerText();
      ok(/needs [\d.]+ MB free, [\d.]+ MB free/.test(m) && /Free up about/.test(m), 'too little disk: says why, with numbers', `${busy} | ${m}`);
      ok(await p.locator('.rs-sheet [data-res-bh]').count() === 1, 'and Include it stays for a second try');
      if (OUT) await p.locator('.rs-sheet').screenshot({ path: path.join(OUT, 'include-refused.png') });
      if (FREE) {
        fs.writeFileSync(FREE, String(50 * 2 ** 30));
        await p.locator('.rs-sheet [data-res-bh]').tap();
        await p.waitForFunction(() => /Done\./.test(document.querySelector('.rs-sheet .rs-h-msg')?.textContent || ''), null, { timeout: 20000 });
        await p.waitForTimeout(1200);
        const t2 = await healthText(p);
        ok(/Done\. Your next nightly backup includes your main agent/.test(t2), 'enough disk: turned on, next nightly backup includes it', t2);
        ok(/Main agent\s*in the next backup/.test(t2) && await p.locator('.rs-sheet [data-res-bh]').count() === 0, 'row now says it is included, no button', t2);
        if (OUT) await p.locator('.rs-sheet').screenshot({ path: path.join(OUT, 'include-done.png') });
      }
    }
    await c.close();
  }
  { // the notification's link
    const c = await context(b), { p, errs: e } = await boot(c, 'https://box.test/wizard-os-home/?view=backup-health'); errs.push(...e);
    await p.waitForTimeout(600);
    ok(await p.locator('.rs-sheet [data-res-tab=health].selected').count() === 1, '?view=backup-health opens Home › Resources › Health');
    await c.close();
  }
  ok(errs.length === 0, 'no page errors', errs.join(' | '));
  await b.close(); console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
