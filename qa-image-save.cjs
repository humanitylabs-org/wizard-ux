// QA (image save): Wizard Search images can be saved. In the viewer, Save on the Android app hands the image's real
// URL (?dl=<title>, a named attachment) to the WebView's download path (Android's download manager → Downloads);
// long-press on the photo or on a result opens a Save / Share menu; Back peels menu → viewer → sheet and stays in
// Wizard. Plain browsers keep the blob download. Wizard Search itself is the real local service.
// Usage: QA_SEARCH=http://127.0.0.1:9289 node qa-image-save.cjs. Every Hermes/Wizard write is refused and recorded.
const { chromium } = require('/home/developer/node_modules/playwright');
const fs = require('fs'), path = require('path');
const ORIGIN = 'https://legacy.wizard.example', URL_ = ORIGIN + '/wizard-os-home/';
const WEB = process.env.QA_WEB_DIR || __dirname, SEARCH = process.env.QA_SEARCH || 'http://127.0.0.1:9288';
const SHOTS = process.env.QA_SHOTS || '';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 15; SM-S928B Build/AP3A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36 WizardOS-Android/0.9.0';
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, typeof extra === 'string' ? extra : JSON.stringify(extra)); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const NOW = Date.now();
const THREADS = Array.from({ length: 3 }, (_, i) => ({ id: `qa-${i}`, title: `QA thread ${i + 1}`, source: 'api_server', model: 'qa', message_count: 2, preview: 'Preview', last_active: NOW / 1000 - i * 600, started_at: NOW / 1000 - i * 600 - 60 }));
const CT = { '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.js': 'application/javascript' };

async function boot(b, ua) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true, acceptDownloads: true, ...(ua ? { userAgent: ua } : {}) });
  const writes = [];
  const json = (r, o, s = 200) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url()), m = q.method();
    if (u.hostname !== 'legacy.wizard.example') return m === 'GET' ? r.continue() : r.abort();
    if (u.pathname.startsWith('/wizard-search/')) {
      const res = await r.fetch({ url: SEARCH + u.pathname + u.search }).catch(() => null);
      return res ? r.fulfill({ response: res }) : r.abort();
    }
    const sh = u.pathname.match(/^\/wizard-os-home\/(.*)$/);
    if (sh && (m === 'GET' || m === 'HEAD')) {
      const f = sh[1] || 'index.html', p = path.join(WEB, 'web', f);
      if (!fs.existsSync(p) || /^(data|summaries)\.js$/.test(f)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      return r.fulfill({ status: 200, contentType: CT[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(p) });
    }
    if (m !== 'GET' && m !== 'HEAD') {
      writes.push(`${m} ${u.pathname}`);
      if (u.pathname === '/wizard/thread-seen') return json(r, { state: { initializedAt: NOW, threads: {} } });
      if (u.pathname === '/wizard/v1/route') return json(r, { ms: 5, cmd: { route: 'agent' } });
      return json(r, { error: 'qa: write refused' }, 403);
    }
    if (u.pathname === '/wizard/v1/bootstrap') return json(r, { bootstrap: 1, api: 'wizard-agent-service/1', settings: { owner: { name: 'Robin', place: '' }, agent: { name: 'Merlin' }, clock: { timezone: 'UTC', day_starts_at: '06:00' }, voice: { language: 'en', vocabulary: [] } },
      capabilities: { voice: true, router: true, files: true, approvals: true, steer: true, markdown: true }, endpoints: { sessions: '/wizard/hermes/api/sessions', runs: '/wizard/hermes/v1/runs', transcribe: '/wizard/voice/transcribe', route: '/wizard/v1/route', upload: '/wizard/files/upload', apps: '/wizard/v1/apps' } });
    if (u.pathname === '/wizard/hermes/api/sessions') return json(r, { data: THREADS, has_more: false });
    const mm = u.pathname.match(/^\/wizard\/hermes\/api\/sessions\/([^/]+)\/messages$/);
    if (mm) return json(r, { object: 'list', data: [{ id: 1, role: 'user', content: 'hello', timestamp: NOW / 1000 - 100 }, { id: 2, role: 'assistant', content: 'hi', timestamp: NOW / 1000 - 90 }] });
    if (u.pathname === '/wizard/thread-seen') return json(r, { state: { initializedAt: NOW - 864e5, threads: {} } });
    if (u.pathname === '/wizard/thread-dispositions') return json(r, { state: {} });
    if (u.pathname === '/wizard/v1/apps') return json(r, { apps: [{ id: 'wizard-search', name: 'Search', desc: 'Image search and AI overview', url: '/wizard-search/', icon: '⌕', colors: ['#8f63ff', '#ff5ccf'], source: 'launcher.json' }] });
    return json(r, {});
  });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); } catch (e) {}
    // Record every programmatic download click (what the Android WebView hands to its DownloadListener).
    window.__dl = [];
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { if (this.hasAttribute('download')) window.__dl.push({ href: this.href, download: this.getAttribute('download') }); return orig.call(this); };
    // Every toast the shell shows.
    window.__toasts = [];
    addEventListener('DOMContentLoaded', () => new MutationObserver(() => { document.querySelectorAll('#toast').forEach(t => { const s = (t.textContent || '').trim(); if (s && window.__toasts[window.__toasts.length - 1] !== s) window.__toasts.push(s); }); })
      .observe(document.documentElement, { subtree: true, childList: true, characterData: true }));
  });
  const p = await ctx.newPage(); p.errs = [];
  p.on('pageerror', e => p.errs.push(String(e)));
  await p.goto(ORIGIN + '/qa-start').catch(() => {});
  await p.goto(URL_, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__wos && window.__wos.live && window.__wos.live.ok, null, { timeout: 30000 });
  await p.waitForFunction(() => window.WizCore.apps && document.querySelector('#search'), null, { timeout: 10000 });
  await sleep(1200);
  return { ctx, p, writes };
}
const frame = p => p.frames().find(f => /\/wizard-search\//.test(f.url()));
const shot = async (p, n) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, n + '.png') }); };
const viewer = p => p.evaluate(() => window.WosChat.viewer.state);
const cdpOf = new Map();
async function cdp(p) { if (!cdpOf.has(p)) cdpOf.set(p, await p.context().newCDPSession(p)); return cdpOf.get(p); }
// A real finger hold: touchStart, stay still, touchEnd (no synthetic contextmenu).
async function hold(p, x, y, ms = 750) {
  const c = await cdp(p);
  await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(ms);
  await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function tapXY(p, x, y) {
  const c = await cdp(p);
  await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await sleep(60);
  await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function centre(p, sel) { return p.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, sel); }
async function openSearch(p, q) {
  await p.evaluate(q => window.__wos.runUtterance('image search ' + q, 'auto', true), q);
  await sleep(1500);
  const f = frame(p);
  await f.waitForFunction(() => window.WizardSearch && window.WizardSearch.state().images > 6, null, { timeout: 25000 }).catch(() => {});
  await f.waitForFunction(() => { const i = document.querySelectorAll('#grid .tile img'); return i.length > 3 && [...i].slice(0, 3).every(x => x.complete && x.naturalWidth > 0); }, null, { timeout: 20000 }).catch(() => {});
  return f;
}

(async () => {
  const b = await chromium.launch();

  /* ===== A. Wizard OS Android app: Save goes to Android's downloads ===== */
  {
    const { ctx, p, writes } = await boot(b, ANDROID_UA);
    const f = await openSearch(p, 'goku super saiyan');
    ok(f && (await f.evaluate(() => window.WizardSearch.state().images)) > 6, 'Android: image search shows results', '');
    const title = await f.evaluate(() => document.querySelectorAll('#grid .tile')[1].querySelector('img').alt);
    await f.locator('#grid .tile').nth(1).tap(); await sleep(900);
    let v = await viewer(p);
    ok(v.open && v.kind === 'image' && v.i === 1 && v.n > 6, 'Android: tapping a result opens it in the viewer', v);
    await p.waitForFunction(() => { const i = document.querySelector('.mviewer .mv-stage img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 20000 }).catch(() => {});
    await shot(p, 'a1-viewer');
    await p.evaluate(() => { window.__dl.length = 0; window.__toasts.length = 0; });
    await p.locator('.mviewer [data-mv="save"]').tap(); await sleep(700);
    const dl = await p.evaluate(() => window.__dl.slice());
    const toasts = await p.evaluate(() => window.__toasts.slice());
    ok(dl.length === 1 && /\/wizard-search\/img\/[0-9a-f]{20}\.jpg\?dl=/.test(dl[0].href), 'Android: Save hands the image URL to the download path (no blob, no share sheet)', dl);
    ok(!toasts.some(t => /isn.t available/i.test(t)), 'Android: no “Saving isn’t available here”', toasts);
    if (dl[0]) {
      const r = await p.evaluate(async h => { const x = await fetch(h); const b = await x.arrayBuffer(); return { s: x.status, ct: x.headers.get('content-type'), cd: x.headers.get('content-disposition'), n: b.byteLength }; }, dl[0].href);
      const want = title.replace(/[\\/:*?"<>|]+/g, ' ').normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80).replace(/[ .]+$/, '');
      ok(r.s === 200 && /^image\//.test(r.ct) && r.n > 2000, 'Android: that URL serves the full image', r);
      ok(/^attachment; filename="[^"]+\.(jpg|png|webp|gif|avif|bmp|heic)"$/.test(r.cd || '') && (r.cd || '').includes(want.slice(0, 20)), 'Android: it is a named attachment (the result’s title + real extension), so Downloads gets a real file name', { cd: r.cd, want });
    }
    v = await viewer(p);
    ok(v.open && !v.menu, 'Android: the viewer stays open after Save', v);

    // Long-press the photo in the viewer → Save / Share menu (real touch hold, no contextmenu event).
    const c = await centre(p, '.mviewer .mv-stage img');
    await hold(p, c[0], c[1]); await sleep(300);
    v = await viewer(p);
    const menuTitle = await p.evaluate(() => document.querySelector('.mviewer .mv-menu-t')?.textContent || '');
    ok(v.open && v.menu && v.i === 1 && menuTitle.length > 0, 'Android: long-press on the photo opens Save / Share (and doesn’t swipe or close)', { v, menuTitle });
    await shot(p, 'a2-hold-menu');
    // Back closes only the menu.
    await p.evaluate(() => window.__wosNativeBack());
    await sleep(300); v = await viewer(p);
    ok(v.open && !v.menu, 'Android: Back closes the menu; the photo stays open', v);
    // Hold again → “Save image”.
    await hold(p, c[0], c[1]); await sleep(300);
    await p.evaluate(() => { window.__dl.length = 0; });
    await p.locator('.mviewer [data-mvm="save"]').tap(); await sleep(600);
    const dl2 = await p.evaluate(() => window.__dl.slice());
    v = await viewer(p);
    ok(dl2.length === 1 && /\?dl=/.test(dl2[0].href) && v.open && !v.menu, 'Android: menu → Save image downloads it and closes the menu', { dl2, v });
    // Hold → tap outside the sheet: menu closes, nothing saved.
    await hold(p, c[0], c[1]); await sleep(600);
    await p.evaluate(() => { window.__dl.length = 0; });
    await tapXY(p, 200, 120); await sleep(400);
    v = await viewer(p);
    ok(v.open && !v.menu && (await p.evaluate(() => window.__dl.length)) === 0, 'Android: tapping outside the menu just closes it', v);
    // A quick tap and a swipe still behave (no menu).
    await tapXY(p, c[0], c[1]); await sleep(500);
    v = await viewer(p);
    ok(v.open && !v.menu, 'Android: a quick tap doesn’t open the menu', v);

    // Back: viewer → sheet → stays in Wizard.
    await p.evaluate(() => window.__wosNativeBack()); await sleep(400);
    v = await viewer(p);
    const sheetOpen = await p.evaluate(() => window.__wos.links.state().open);
    ok(!v.open && sheetOpen, 'Android: Back closes the viewer; search results still open', { v, sheetOpen });

    // Long-press a result in the grid → opens it with the menu.
    const tile = await f.evaluate(() => { const t = document.querySelectorAll('#grid .tile')[2]; t.scrollIntoView({ block: 'center' }); return true; });
    await sleep(300);
    const fr = await p.evaluate(() => { const i = document.querySelector('.linksheet iframe'); const r = i.getBoundingClientRect(); return [r.x, r.y]; });
    const tc = await f.evaluate(() => { const r = document.querySelectorAll('#grid .tile')[2].getBoundingClientRect(); return [r.x + r.width / 2, r.y + Math.min(r.height / 2, 60)]; });
    await hold(p, fr[0] + tc[0], fr[1] + tc[1], 800); await sleep(500);
    v = await viewer(p);
    ok(tile && v.open && v.i === 2 && v.menu, 'Android: long-press a search result opens it with Save / Share', v);
    await shot(p, 'a3-grid-hold');
    await p.evaluate(() => window.__wosNativeBack()); await sleep(250);
    await p.evaluate(() => window.__wosNativeBack()); await sleep(250);
    await p.evaluate(() => window.__wosNativeBack()); await sleep(400);
    v = await viewer(p);
    ok(!v.open && p.url().startsWith(URL_), 'Android: Back ×3 (menu → viewer → sheet) stays in Wizard', p.url());
    ok(writes.filter(w => !/thread-seen|v1\/route/.test(w)).length === 0, 'Android: zero Wizard writes', writes);
    ok(p.errs.length === 0, 'Android: no page errors', p.errs);
    await ctx.close();
  }

  /* ===== B. Plain browser: Save still downloads the bytes ===== */
  {
    const { ctx, p } = await boot(b, null);
    const f = await openSearch(p, 'goku super saiyan');
    await f.locator('#grid .tile').nth(0).tap(); await sleep(900);
    await p.waitForFunction(() => { const i = document.querySelector('.mviewer .mv-stage img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 20000 }).catch(() => {});
    const [d] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }).catch(() => null), p.locator('.mviewer [data-mv="save"]').tap()]);
    let n = 0; if (d) { const fp = await d.path().catch(() => null); n = fp ? fs.statSync(fp).size : 0; }
    ok(!!d && /\.(jpe?g|png|webp|gif)$/i.test(d.suggestedFilename()) && n > 2000, 'Browser: Save downloads the photo (bytes)', d && { name: d.suggestedFilename(), n });
    // Right-click the photo → the same menu.
    const c = await centre(p, '.mviewer .mv-stage img');
    await p.mouse.click(c[0], c[1], { button: 'right' }); await sleep(300);
    const v = await viewer(p);
    ok(v.open && v.menu, 'Browser: right-click the photo opens Save / Share', v);
    ok(p.errs.length === 0, 'Browser: no page errors', p.errs);
    await ctx.close();
  }

  await b.close();
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
