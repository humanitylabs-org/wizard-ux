// QA (long screenshots): a tall image opened in the media viewer fits the screen width and scrolls, so the
// whole screenshot is readable (James, 23 Oct 2026: "I can only see the top portion"). Drag and fling scroll it,
// the bottom is reachable, pulling down from the top still closes, wheel scrolls on desktop, and an ordinary
// photo keeps the old fit/swipe-to-close behaviour. Every Wizard write is refused.
// Usage: QA_WEB_DIR=<tree> [QA_SHOTS=<dir>] node qa-long-image.cjs
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const ORIGIN = require('./tools/qa-paths.cjs').origin(), URL_ = ORIGIN + '/wizard-os-home/';
const WEB = process.env.QA_WEB_DIR || __dirname, SHOTS = process.env.QA_SHOTS || '';
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, typeof extra === 'string' ? extra : JSON.stringify(extra)); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const NOW = Date.now();
const CT = { '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.js': 'application/javascript' };

async function boot(b) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true });
  const json = (r, o, s = 200) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url()), m = q.method();
    if (u.hostname !== new URL(ORIGIN).hostname) return m === 'GET' ? r.continue() : r.abort();
    const sh = u.pathname.match(/^\/wizard-os-home\/(.*)$/);
    if (sh && (m === 'GET' || m === 'HEAD')) {
      const f = sh[1] || 'index.html', p = path.join(WEB, 'web', f);
      if (!fs.existsSync(p) || /^(data|summaries)\.js$/.test(f)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      return r.fulfill({ status: 200, contentType: CT[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(p) });
    }
    if (m !== 'GET' && m !== 'HEAD') {
      if (u.pathname === '/wizard/thread-seen') return json(r, { state: { initializedAt: NOW, threads: {} } });
      return json(r, { error: 'qa: write refused' }, 403);
    }
    if (u.pathname === '/wizard/v1/bootstrap') return json(r, { bootstrap: 1, api: 'wizard-agent-service/1', settings: { owner: { name: 'Robin', place: '' }, agent: { name: 'Merlin' }, clock: { timezone: 'UTC', day_starts_at: '06:00' }, voice: { language: 'en', vocabulary: [] } },
      capabilities: { voice: true, router: true, files: true, approvals: true, steer: true, markdown: true }, endpoints: { sessions: '/wizard/hermes/api/sessions', runs: '/wizard/hermes/v1/runs', transcribe: '/wizard/voice/transcribe', route: '/wizard/v1/route', upload: '/wizard/files/upload', apps: '/wizard/v1/apps' } });
    if (u.pathname === '/wizard/hermes/api/sessions') return json(r, { data: [], has_more: false });
    if (u.pathname === '/wizard/thread-seen') return json(r, { state: { initializedAt: NOW - 864e5, threads: {} } });
    if (u.pathname === '/wizard/v1/apps') return json(r, { apps: [] });
    return json(r, {});
  });
  await ctx.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); } catch (e) {} });
  const p = await ctx.newPage(); p.errs = [];
  p.on('pageerror', e => p.errs.push(String(e)));
  await p.goto(ORIGIN + '/qa-start').catch(() => {});
  await p.goto(URL_, { waitUntil: 'load' });
  await p.waitForFunction(() => window.WosChat && window.WosChat.viewer, null, { timeout: 30000 });
  await sleep(800);
  return { ctx, p };
}
// A canvas-drawn image with numbered bands, as a blob URL (w x h CSS px).
const makeImg = (p, w, h) => p.evaluate(([w, h]) => new Promise(res => {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
  for (let y = 0, i = 0; y < h; y += 200, i++) { g.fillStyle = `hsl(${i * 37 % 360} 60% 35%)`; g.fillRect(0, y, w, 200); g.fillStyle = '#fff'; g.font = 'bold 60px sans-serif'; g.fillText('Row ' + (i + 1), 30, y + 120); }
  g.fillStyle = '#ff0'; g.fillRect(0, h - 40, w, 40);
  c.toBlob(b => res(URL.createObjectURL(b)), 'image/png');
}), [w, h]);
const open = async (p, url, name) => { await p.evaluate(([u, n]) => window.WosChat.viewer.open([{ url: u, name: n, kind: 'image', mime: 'image/png' }]), [url, name]);
  await p.waitForFunction(() => { const i = document.querySelector('.mviewer .mv-stage img'); return i && i.complete && i.naturalWidth > 0; }); await sleep(400); };
const st = p => p.evaluate(() => window.WosChat.viewer.state);
const geo = p => p.evaluate(() => { const s = document.querySelector('.mviewer .mv-stage').getBoundingClientRect(), i = document.querySelector('.mviewer .mv-stage img').getBoundingClientRect(); return { sTop: s.top, sBot: s.bottom, sW: s.width, iTop: i.top, iBot: i.bottom, iW: i.width, iH: i.height }; });
const shot = async (p, n) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, n + '.png') }); };
let C;
async function drag(p, x, y0, y1, ms = 300, steps = 12) {
  await C.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
  for (let k = 1; k <= steps; k++) { await sleep(ms / steps); await C.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + (y1 - y0) * k / steps }] }); }
  await C.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

(async () => {
  const b = await chromium.launch();
  const { ctx, p } = await boot(b); C = await ctx.newCDPSession(p);
  const tall = await makeImg(p, 1080, 9000);
  await open(p, tall, 'Long screenshot');
  let s = await st(p), g = await geo(p);
  ok(s.open && s.long === true, 'tall screenshot opens in long (scrolling) mode', s);
  ok(Math.abs(g.iW - g.sW) < 2 && Math.abs(g.iTop - g.sTop) < 2, 'it fills the screen width with its top at the top', g);
  await shot(p, '1-top');

  await drag(p, 200, 700, 300, 400); await sleep(300);
  s = await st(p); g = await geo(p);
  ok(s.open && s.y < -300, 'dragging up scrolls down the screenshot (viewer stays open)', s);
  const y1 = s.y;
  await drag(p, 200, 700, 400, 80, 4); await sleep(1200);
  s = await st(p);
  ok(s.y < y1 - 300 - 50, 'a quick flick keeps scrolling (momentum)', { before: y1, after: s.y });

  for (let k = 0; k < 30; k++) await drag(p, 200, 750, 150, 120, 6);
  await sleep(1500); g = await geo(p); s = await st(p);
  ok(s.open && Math.abs(g.iBot - g.sBot) < 2, 'the bottom of the screenshot is reachable and stops at the bottom edge', g);
  await shot(p, '2-bottom');

  await drag(p, 200, 300, 700, 400); await sleep(400); s = await st(p);
  ok(s.open, 'pulling down mid-screenshot scrolls back instead of closing', s);

  await p.mouse.move(200, 400); await p.mouse.wheel(0, 600); await sleep(300);
  const sw = await st(p);
  ok(sw.y < s.y - 200, 'mouse wheel scrolls it on desktop', { before: s.y, after: sw.y });

  for (let k = 0; k < 40 && (await st(p)).y < -1; k++) { await drag(p, 200, 150, 750, 100, 5); await sleep(150); }
  await sleep(1500); g = await geo(p); s = await st(p);
  ok(s.open && Math.abs(g.iTop - g.sTop) < 2, 'scrolling back reaches the top', g);
  await drag(p, 200, 300, 600, 300); await sleep(500); s = await st(p);
  ok(!s.open, 'at the top, pulling down still closes the viewer', s);

  const wide = await makeImg(p, 1600, 1000);
  await open(p, wide, 'Photo');
  s = await st(p); g = await geo(p);
  ok(s.open && !s.long, 'an ordinary photo is not in long mode', s);
  await drag(p, 200, 400, 650, 300); await sleep(500); s = await st(p);
  ok(!s.open, 'an ordinary photo still swipes down to close', s);

  await open(p, tall, 'Long screenshot');
  await drag(p, 200, 700, 300, 300); await sleep(300);
  const back = await p.evaluate(() => window.WosChat.viewer.close());
  s = await st(p);
  ok(back && !s.open, 'Back/close closes a scrolled long screenshot', s);
  ok(!p.errs.length, 'no page errors', p.errs);
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
