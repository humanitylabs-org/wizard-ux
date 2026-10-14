// Remote-safe desktop width QA: real API reads; all writes intercepted; no agent sends.
// Usage: PLAYWRIGHT_PATH=<package> QA_OUT=<dir> QA_EXPECTED_WEB_DIR=<repo> [QA_WEB_DIR=<override>] node <suite> <base-url>
const QA_ORIGIN = (process.env.WIZARD_QA_ORIGIN || 'https://wizard.example.ts.net').replace(/\/+$/, ''); // the Wizard under test (env; see docs/qa-targets.md)
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
let pw; for (const m of [process.env.PLAYWRIGHT_PATH, 'playwright', 'playwright-core'].filter(Boolean)) { try { pw = require(m); break; } catch {} }
if (!pw) throw Error('Set PLAYWRIGHT_PATH to Playwright');
const BASE = process.argv[2] || QA_ORIGIN + '/wizard-os-home/';
const OUT = process.env.QA_OUT || path.join(process.cwd(), 'width-evidence');
fs.mkdirSync(OUT, { recursive: true });
const cases = [], writes = [], errors = [];
function ok(c, name, detail) { cases.push({ name, pass: !!c, detail }); console.log(c ? 'PASS' : 'FAIL', name, detail ? JSON.stringify(detail) : ''); }
const near = (a, b) => Math.abs(a - b) < 1.1;
(async () => {
 const b = await pw.chromium.launch({ ...(process.env.QA_CHROME ? { executablePath: process.env.QA_CHROME } : {}), args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
 try {
 const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36' });
 const origin = new URL(BASE).origin;
 await ctx.route('**/*', async r => {
  const q = r.request(), u = new URL(q.url());
  if (!['GET', 'HEAD'].includes(q.method())) { writes.push({ method: q.method(), path: u.pathname }); return r.fulfill({ status: 403, contentType: 'application/json', body: '{}' }); }
  if (u.origin === origin && u.pathname === '/qa-width-frame/') return r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Width fixture</title><style>body{background:#181225;color:#ddd;font:18px system-ui}input{font:inherit}</style><h1>Hosted app fixture</h1><input id="draft" value="kept hosted state">' });
  if (process.env.QA_WEB_DIR && u.origin === origin && u.pathname.startsWith('/wizard-os-home/')) {
   const root = path.resolve(process.env.QA_WEB_DIR, 'web'), rel = decodeURIComponent(u.pathname.slice('/wizard-os-home/'.length)) || 'index.html', f = path.resolve(root, rel);
   if (f.startsWith(root + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile()) {
    const types = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.txt': 'text/plain' };
    return r.fulfill({ contentType: types[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
   }
  }
  return r.continue();
 });
 await ctx.addInitScript(() => {
  localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.shell', 'desktop');
  if (!sessionStorage.getItem('qa-width-seeded')) {
   sessionStorage.setItem('qa-width-seeded', '1');
   localStorage.setItem('wux.desk.wins', JSON.stringify({ qa: { id: 'qa', app: 'chats', thread: null } }));
   localStorage.setItem('wux.desk.ws', JSON.stringify(Array.from({ length: 9 }, (_, i) => ({ wins: i ? [] : ['qa'], focus: i ? null : 'qa', mono: false }))));
   localStorage.setItem('wux.desk.cur', '0');
  }
 });
 const p = await ctx.newPage(); p.on('pageerror', e => errors.push(String(e)));
 const hashes = {}, hashReads = [];
 p.on('response', response => {
  const file = new URL(response.url()).pathname.match(/^\/wizard-os-home\/(desktop\/desktop\.(?:js|css))$/)?.[1];
  if (file && response.ok()) hashReads.push(response.body().then(body => { hashes[file] = crypto.createHash('sha256').update(body).digest('hex'); }));
 });
 const wait = () => p.waitForTimeout(400);
 const boot = () => p.waitForFunction(() => window.__wux?.live?.ok, null, { timeout: 45000 });
 const geometry = () => p.evaluate(() => {
  const d = __wux.ws[__wux.cur], host = document.querySelector('.wsp:not([hidden])'), hr = host.getBoundingClientRect();
  const windows = d.wins.map(id => {
   const el = document.querySelector(`.win[data-win="${id}"]`), r = el.getBoundingClientRect();
   return { id, x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom, gone: el.classList.contains('gone'), focus: el.classList.contains('focus') };
  }).filter(w => !w.gone);
  return { windows, width: innerWidth, height: innerHeight, host: { x: hr.x, y: hr.y, w: hr.width, h: hr.height }, shell: document.documentElement.dataset.shell, scroll: document.documentElement.scrollWidth };
 });
 const centered = s => near(Math.min(...s.windows.map(w => w.x)), s.width - Math.max(...s.windows.map(w => w.right)));
 const fits = s => s.windows.every(w => w.x >= -1 && w.right <= s.width + 1 && w.y >= s.host.y - 1 && w.bottom <= s.height + 1);
 await p.goto(BASE, { waitUntil: 'load' }); await boot(); await wait();
 let s = await geometry();
 ok(s.shell === 'desktop', 'desktop shell selected');
 ok(s.windows.length === 1 && near(s.windows[0].w, 1200) && centered(s), '1920: lone Chats is capped at 1200 and centered', s);
 ok(near(s.windows[0].h, s.host.h - 16) && fits(s), 'vertical space preserved', s);
 await p.screenshot({ path: path.join(OUT, 'single-wide.png') });
 await p.keyboard.press('Alt+Enter'); await wait();
 const ta = p.locator('.win.focus .pane-main textarea'); await ta.fill('width resize unsent draft');
 for (const width of [800, 500, 1215, 1216, 1217, 3000, 1920]) {
  await p.setViewportSize({ width, height: 900 }); await wait(); s = await geometry();
  ok(near(s.windows[0].w, Math.min(1200, width - 16)) && centered(s) && fits(s), `resize ${width}: capped-or-fill geometry`, s);
  ok(s.shell === 'desktop' && await ta.inputValue() === 'width resize unsent draft', `resize ${width}: desktop and draft preserved`);
 }
 await p.screenshot({ path: path.join(OUT, 'single-composer.png') });
 const added = await p.evaluate(() => __wux.newWin({ app: 'frame', appId: 'link', url: '/qa-width-frame/', title: 'Width fixture' }).id);
 await wait(); await p.frameLocator('.win.focus iframe').locator('#draft').waitFor();
 const nodeBefore = await p.evaluate(id => { window.__qaFrame = document.querySelector(`.win[data-win="${id}"] iframe`); return !!window.__qaFrame; }, added);
 s = await geometry();
 ok(s.windows.length === 2 && s.windows.every(w => near(w.w, (1920 - 24) / 2)) && centered(s) && near(s.windows[1].x - s.windows[0].right, 8), 'opening second app moves Chats aside and tiles adjacently', s);
 ok(s.windows[1].focus && nodeBefore, 'new hosted app receives focus');
 await p.screenshot({ path: path.join(OUT, 'two-apps.png') });
 for (const width of [3000, 800, 1920]) {
  await p.setViewportSize({ width, height: 900 }); await wait(); s = await geometry();
  ok(s.windows.length === 2 && s.windows.every(w => near(w.w, Math.min(1200, (width - 24) / 2))) && centered(s) && fits(s) && near(s.windows[1].x - s.windows[0].right, 8), `two apps ${width}: each capped, group centered, no empty internal gap`, s);
  ok(await p.evaluate(() => window.__qaFrame === document.querySelector('.win.focus iframe')) && await p.frameLocator('.win.focus iframe').locator('#draft').inputValue() === 'kept hosted state', `two apps ${width}: frame is preserved`);
 }
 await p.evaluate(() => __wux.newWin({ app: 'frame', appId: 'link', url: '/qa-width-frame/', title: 'Second fixture' })); await wait();
 for (const width of [1920, 3000, 800]) {
  await p.setViewportSize({ width, height: 900 }); await wait(); s = await geometry(); const [master, top, bottom] = s.windows;
  ok(s.windows.length === 3 && s.windows.every(w => w.w <= 1201) && centered(s) && fits(s) && near(master.right + 8, top.x) && near(top.x, bottom.x) && near(top.bottom + 8, bottom.y) && master.h > top.h * 1.8, `three apps ${width}: capped master + stack`, s);
 }
 await p.setViewportSize({ width: 3000, height: 900 }); await wait(); await p.screenshot({ path: path.join(OUT, 'three-ultrawide.png') });
 await p.evaluate(() => { const ids = __wux.ws[0].wins.slice(1); ids.forEach(id => __wux.closeWin(id)); }); await wait(); s = await geometry();
 ok(s.windows.length === 1 && near(s.windows[0].w, 1200) && centered(s), 'closing neighbours recenters Chats', s);
 ok(await p.locator('.win.focus .pane-main textarea').inputValue() === 'width resize unsent draft', 'closing neighbours keeps chat draft');
 await p.reload({ waitUntil: 'load' }); await boot(); await wait(); s = await geometry();
 ok(s.windows.length === 1 && near(s.windows[0].w, 1200) && centered(s), 'reload restores capped layout', s);
 await p.evaluate(() => { __wux.newDesktop(); __wux.newWin({ app: 'frame', appId: 'link', url: '/qa-width-frame/', title: 'Workspace fixture' }); }); await wait(); s = await geometry();
 ok(s.windows.length === 1 && near(s.windows[0].w, 1200) && centered(s), 'lone hosted app gets the same cap', s);
 await p.evaluate(() => __wux.goWs(0)); await wait(); s = await geometry();
 ok(s.windows.length === 1 && near(s.windows[0].w, 1200) && centered(s), 'workspace return preserves centering');
 // Existing explicit focus mode remains wide; host-window fullscreen was exercised by large viewports.
 await p.evaluate(() => __wux.newWin({ app: 'frame', appId: 'link', url: '/qa-width-frame/', title: 'Monocle fixture' })); await wait();
 await p.keyboard.press('Alt+KeyF'); await wait(); s = await geometry();
 ok(s.windows.length === 1 && s.windows[0].w >= s.width - 16, 'explicit immersive/focus mode preserves its full-width contract', s);
 await p.keyboard.press('Escape'); await wait(); s = await geometry();
 ok(s.windows.length === 2 && s.windows.every(w => w.w <= 1201) && centered(s), 'Escape returns to capped tiles');
 await p.evaluate(() => { __wux.closeWin(__wux.ws[0].focus); __wux.chats.chatsBack(__wux.wins.qa); }); await wait();
 await p.setViewportSize({ width: 1920, height: 900 }); await wait();
 const row = p.locator('.win.focus .pane-list [data-chopen]').first(); await row.waitFor({ timeout: 30000 });
 await p.evaluate(() => document.querySelector('.win.focus .pane-list [data-chopen]').click()); await wait();
 ok(await p.evaluate(() => !!__wux.wins.qa.thread), 'nested thread opens in centered Chats');
 await p.keyboard.press('Escape'); await wait();
 ok(await p.evaluate(() => !__wux.wins.qa.thread && __wux.ws[0].wins.includes('qa')), 'nested Back returns to list with Chats open');
 const url = p.url(); await p.keyboard.press('Escape'); await p.evaluate(() => history.back()); await wait();
 const afterBack = { url: p.url(), before: url, app: await p.evaluate(() => !!window.__wux), windows: await p.evaluate(() => window.__wux?.ws[0]?.wins.length), log: await p.evaluate(() => window.__wux?.log) };
 ok(new URL(p.url()).pathname === new URL(url).pathname && new URL(p.url()).origin === new URL(url).origin && afterBack.app && afterBack.windows === 1, 'root Back keeps Wizard open', afterBack);
 await Promise.all(hashReads);
 const expectedRoot = process.env.QA_EXPECTED_WEB_DIR || process.env.QA_WEB_DIR;
 if (!expectedRoot) throw Error('Set QA_EXPECTED_WEB_DIR for served-preview provenance');
 for (const file of ['desktop/desktop.js', 'desktop/desktop.css']) {
  const expected = crypto.createHash('sha256').update(fs.readFileSync(path.join(expectedRoot, 'web', file))).digest('hex');
  ok(hashes[file] === expected, 'browser-loaded source hash matches ' + file, { loaded: hashes[file], expected });
 }
 ok(errors.length === 0, 'zero page errors', errors);
 ok(!writes.some(q => /\/v1\/runs|\/api\/sessions$/.test(q.path)), 'zero agent sends', writes);
 await ctx.close();
 const result = { worker: os.hostname(), base: BASE, tree: process.env.QA_WEB_DIR || 'served preview', hashes, pass: cases.filter(c => c.pass).length, fail: cases.filter(c => !c.pass).length, cases, errors, writes };
 fs.writeFileSync(path.join(OUT, 'receipt.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify({ worker: result.worker, pass: result.pass, fail: result.fail, base: BASE, hashes })); process.exitCode = result.fail ? 1 : 0;
 } finally { await b.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
