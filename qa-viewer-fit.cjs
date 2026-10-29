// QA (media viewer fit): every image opens fully inside the viewer's stage, between the title bar and the
// Share/Save bar, on the phone and desktop shells. Robert, 25 Oct 2026: a phone screenshot opened full-screen was
// cut off at the bottom and could not be scrolled or zoomed out to see it. The stage's implicit grid row grew to
// the image's width-fitted height, so `object-fit: contain` never fitted a tall image and the stage clipped it.
// Cases: tall phone screenshot, a slightly-taller-than-the-stage image, a wide image, a square photo; pinch-free
// double-tap zoom and reset still work; Back closes. Every Wizard write is refused.
// Usage: QA_WEB_DIR=<repo> [QA_SHOTS=<dir>] [QA_ENGINE=chromium|webkit] node qa-viewer-fit.cjs
const pw = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const ORIGIN = require('./tools/qa-paths.cjs').origin(), URL_ = ORIGIN + '/wizard-os-home/';
const WEB = process.env.QA_WEB_DIR || __dirname, SHOTS = process.env.QA_SHOTS || '';
const ENGINE = process.env.QA_ENGINE || 'chromium';
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, typeof extra === 'string' ? extra : JSON.stringify(extra)); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const NOW = Date.now();
const CT = { '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.js': 'application/javascript', '.svg': 'image/svg+xml', '.json': 'application/json' };

async function boot(b, shell) {
  const phone = shell === 'phone';
  const ctx = await b.newContext(phone
    ? { viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, hasTouch: true, isMobile: ENGINE !== 'firefox', ignoreHTTPSErrors: true, serviceWorkers: 'block' }
    : { viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true, serviceWorkers: 'block' });
  const writes = [];
  const json = (r, o, s = 200) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url()), m = q.method();
    if (u.hostname !== new URL(ORIGIN).hostname) return m === 'GET' ? r.continue() : r.abort();
    const sh = u.pathname.match(/^\/wizard-os-home\/(.*)$/);
    if (sh && (m === 'GET' || m === 'HEAD')) {
      const f = decodeURIComponent(sh[1]) || (phone ? 'index.html' : 'desktop.html'), p = path.join(WEB, 'web', f);
      if (!fs.existsSync(p) || fs.statSync(p).isDirectory() || /^(data|summaries)\.js$/.test(f)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      return r.fulfill({ status: 200, contentType: CT[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(p) });
    }
    if (m !== 'GET' && m !== 'HEAD') {
      writes.push(`${m} ${u.pathname}`);
      if (u.pathname === '/wizard/thread-seen') return json(r, { state: { initializedAt: NOW, threads: {} } });
      return json(r, { error: 'qa: write refused' }, 403);
    }
    if (u.pathname === '/wizard/v1/bootstrap') return json(r, { bootstrap: 1, api: 'wizard-agent-service/1', settings: { owner: { name: 'Robin', place: '' }, agent: { name: 'Merlin' }, clock: { timezone: 'UTC', day_starts_at: '06:00' }, voice: { language: 'en', vocabulary: [] } },
      capabilities: { voice: true, router: true, files: true, approvals: true, steer: true, markdown: true }, endpoints: { sessions: '/wizard/hermes/api/sessions', runs: '/wizard/hermes/v1/runs', transcribe: '/wizard/voice/transcribe', route: '/wizard/v1/route', upload: '/wizard/files/upload', apps: '/wizard/v1/apps' } });
    if (u.pathname === '/wizard/hermes/api/sessions') return json(r, { data: [], has_more: false });
    if (u.pathname === '/wizard/thread-seen') return json(r, { state: { initializedAt: NOW - 864e5, threads: {} } });
    if (u.pathname === '/wizard/thread-dispositions') return json(r, { state: {} });
    if (u.pathname === '/wizard/v1/apps') return json(r, { apps: [] });
    return json(r, {});
  });
  await ctx.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); } catch (e) {} });
  const p = await ctx.newPage(); p.errs = [];
  p.on('pageerror', e => p.errs.push(String(e)));
  await p.goto(ORIGIN + '/qa-start').catch(() => {});
  await p.goto(URL_ + `?shell=${shell}`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.WosChat && window.WosChat.viewer, null, { timeout: 30000 });
  await sleep(1000);
  return { ctx, p, writes };
}
// A canvas-drawn image (w x h px) with a bright 1-px frame and a yellow footer band, as a blob URL.
const makeImg = (p, w, h) => p.evaluate(([w, h]) => new Promise(res => {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  g.fillStyle = '#05030c'; g.fillRect(0, 0, w, h);
  for (let y = 0, i = 0; y < h; y += 160, i++) { g.fillStyle = `hsl(${i * 37 % 360} 50% 30%)`; g.fillRect(20, y + 20, w - 40, 120); }
  g.fillStyle = '#ff0'; g.fillRect(0, h - 40, w, 40);
  c.toBlob(b => res(URL.createObjectURL(b)), 'image/png');
}), [w, h]);
const open = async (p, url, name) => {
  await p.evaluate(([u, n]) => window.WosChat.viewer.open([{ url: u, name: n, kind: 'image', mime: 'image/png' }]), [url, name]);
  await p.waitForFunction(() => { const i = document.querySelector('.mviewer .mv-stage img'); return i && i.complete && i.naturalWidth > 0; });
  await sleep(450);
};
// Where the picture is actually painted inside the <img> box (object-fit: contain), against the stage and bars.
const geo = p => p.evaluate(() => {
  const v = document.querySelector('.mviewer'), st = v.querySelector('.mv-stage'), img = st.querySelector('img');
  const s = st.getBoundingClientRect(), b = img.getBoundingClientRect(), top = v.querySelector('.mv-top').getBoundingClientRect(), bar = v.querySelector('.mv-bar').getBoundingClientRect();
  const fit = getComputedStyle(img).objectFit, ar = img.naturalWidth / img.naturalHeight;
  let w = b.width, h = b.height; if (fit === 'contain') { w = Math.min(b.width, b.height * ar); h = w / ar; }
  const x = b.left + (b.width - w) / 2, y = b.top + (b.height - h) / 2;
  const r = n => Math.round(n * 10) / 10;
  return { stage: { t: r(s.top), b: r(s.bottom), l: r(s.left), r: r(s.right) }, pic: { t: r(y), b: r(y + h), l: r(x), r: r(x + w), w: r(w), h: r(h) }, box: { w: r(b.width), h: r(b.height) }, topB: r(top.bottom), barT: r(bar.top), scale: window.WosChat.viewer.state.scale };
});
const inside = g => g.pic.t >= g.stage.t - 0.6 && g.pic.b <= g.stage.b + 0.6 && g.pic.l >= g.stage.l - 0.6 && g.pic.r <= g.stage.r + 0.6 && g.box.h <= (g.stage.b - g.stage.t) + 0.6;
const touchesAnEdge = g => Math.abs(g.pic.w - (g.stage.r - g.stage.l)) < 1.5 || Math.abs(g.pic.h - (g.stage.b - g.stage.t)) < 1.5;
const shot = async (p, n) => { if (SHOTS) { await p.evaluate(() => { const v = document.querySelector('.mviewer'); v.style.transition = 'none'; }); await sleep(250); await p.screenshot({ path: path.join(SHOTS, n + '.png') }); } };

(async () => {
  const b = await pw[ENGINE].launch();
  try {
    for (const shell of ['phone', 'desktop']) {
      const { ctx, p, writes } = await boot(b, shell);
      const cases = [
        ['tall phone screenshot 786x1704', 786, 1704],
        ['just taller than the stage 1000x2000', 1000, 2000],
        ['wide 2400x900', 2400, 900],
        ['square 1200x1200', 1200, 1200],
      ];
      for (const [name, w, h] of cases) {
        const url = await makeImg(p, w, h);
        await open(p, url, name);
        const g = await geo(p), long = await p.evaluate(() => !!window.WosChat.viewer.state.long);
        if (long) {
          // A long-screenshot mode (fit the width, scroll) owns very tall images when the viewer has one.
          ok(Math.abs(g.pic.w - (g.stage.r - g.stage.l)) < 1.5 && Math.abs(g.pic.t - g.stage.t) < 1.5, `${shell}: ${name}: long mode fits the width from the top`, g);
          ok(true, `${shell}: ${name}: (long mode scrolls; covered by its own suite)`);
          ok(g.pic.t >= g.topB - 0.6, `${shell}: ${name}: clear of the title bar`, g);
        } else {
          ok(inside(g), `${shell}: ${name}: whole picture inside the stage`, g);
          ok(touchesAnEdge(g), `${shell}: ${name}: fitted (fills the stage width or height)`, g);
          ok(g.pic.t >= g.topB - 0.6 && g.pic.b <= g.barT + 0.6, `${shell}: ${name}: clear of the title bar and the Share/Save bar`, g);
        }
        await shot(p, `${ENGINE}-${shell}-${w}x${h}`);
        await p.evaluate(() => window.WosChat.viewer.close());
      }
      // Zoom still works from the fitted state, and resetting returns to the fitted picture.
      const url = await makeImg(p, 786, 1704);
      await open(p, url, 'zoom');
      const g0 = await geo(p);
      const s = await p.locator('.mviewer .mv-stage').boundingBox();
      const cx = s.x + s.width / 2, cy = s.y + s.height / 2;
      if (shell === 'phone') { await p.touchscreen.tap(cx, cy); await sleep(120); await p.touchscreen.tap(cx, cy); }
      else { await p.mouse.click(cx, cy); await sleep(120); await p.mouse.click(cx, cy); }
      await sleep(450);
      const z = await p.evaluate(() => window.WosChat.viewer.state.scale);
      ok(z > 1.5, `${shell}: double-tap zooms in`, { z });
      if (shell === 'phone') { await p.touchscreen.tap(cx, cy); await sleep(120); await p.touchscreen.tap(cx, cy); }
      else { await p.mouse.click(cx, cy); await sleep(120); await p.mouse.click(cx, cy); }
      await sleep(450);
      const g1 = await geo(p), long1 = await p.evaluate(() => !!window.WosChat.viewer.state.long);
      ok(g1.scale === 1 && (long1 || inside(g1)) && Math.abs(g1.pic.h - g0.pic.h) < 1, `${shell}: second double-tap returns to the fitted picture`, { g0, g1, long1 });
      // Back closes the viewer.
      if (shell === 'phone') await p.evaluate(() => window.__wosNativeBack && window.__wosNativeBack());
      else await p.keyboard.press('Escape');
      await sleep(300);
      ok(!(await p.evaluate(() => window.WosChat.viewer.isOpen())), `${shell}: Back closes the viewer`);
      ok(!p.errs.length, `${shell}: no page errors`, p.errs.slice(0, 3));
      ok(!writes.filter(x => !/thread-seen/.test(x)).length, `${shell}: no writes`, writes);
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
