// QA (immersive full screen, James 9 Oct): full screen hides the title bar, the bottom bar and the orb; the app
// fills the display. Out: swipe up from the bottom edge, pinch in, or Back. Chats keeps a small orb bottom-right
// beside the composer for voice replies; that orb only talks (no shell swipes). Every write is intercepted.
// Usage: QA_WEB_DIR=<repo> [QA_SHOTS=dir] node qa-immersive.cjs [url]
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const URL_ = process.argv[2] || (require('./tools/qa-paths.cjs').origin() + '/wizard-os-home/');
const W = process.env.QA_WEB_DIR || __dirname;
const SHOTS = process.env.QA_SHOTS || '';
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };
const THREADS = Array.from({ length: 30 }, (_, i) => ({ id: `qa-${i}`, title: `QA thread ${i + 1}`, source: 'api_server', model: 'qa', message_count: 2, preview: 'Preview line', last_active: Date.now() / 1000 - i * 600, started_at: Date.now() / 1000 - i * 600 - 60 }));
const VW = 412, VH = 892;

async function boot(b) {
  const ctx = await b.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true, permissions: ['microphone'] });
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url());
    if (!(u.origin === require('./tools/qa-paths.cjs').origin())) return r.abort();
    const m = u.pathname.match(/^\/wizard-os-home\/(.*)$/);
    if (m && q.method() === 'GET' && !m[1].startsWith('api/')) {
      const f = m[1] || 'index.html';
      // data.js / summaries.js are untracked build outputs: fall back to the live tree's copy (same as tools/qa-origin.cjs).
      let p = path.join(W, 'web', f); if (!fs.existsSync(p) && /^(data|summaries)\.js$/.test(f)) p = path.join(require('node:path').join(require('./tools/qa-paths.cjs').repoRoot, 'web'), f);
      if (!fs.existsSync(p)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      const ct = f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : f.endsWith('.png') ? 'image/png' : f.endsWith('.webmanifest') ? 'application/manifest+json' : 'application/javascript';
      return r.fulfill({ status: 200, contentType: ct, body: fs.readFileSync(p) });
    }
    if (u.pathname === '/qa-edge-own/') return r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><style>body{margin:0;background:#123456;padding-top:var(--wos-cutout,0px)}</style><h1>own</h1>' });
    if (u.pathname === '/qa-edge-plain/') return r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><style>body{margin:0;background:#123456}</style><h1>plain</h1>' });
    if (/\/api\/transcribe$/.test(u.pathname)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: 'hello', ms: 50 }) });
    if (/\/hermes\/api\/sessions$/.test(u.pathname) && q.method() === 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: THREADS, has_more: false }) });
    if (/\/wizard\/thread-seen$/.test(u.pathname)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state: { initializedAt: Date.now(), threads: {} } }) });
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); } catch (e) {} });
  await p.goto(URL_, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__wos && window.__wos.live && window.__wos.live.ok, null, { timeout: 30000 });
  await p.waitForTimeout(700);
  return { ctx, p, errs };
}
const shot = async (p, n) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, n + '.png') }); };
// Wait for actual finite transitions, not a fixed wall-clock delay on a busy SwiftShader host.
const settle = p => p.waitForFunction(() => !document.getAnimations().some(a =>
  a.playState === 'running' && Number.isFinite(a.effect?.getComputedTiming().endTime)), null, { timeout: 6000 });
const state = async p => { await settle(p); return p.evaluate(() => {
  const d = __wos.desks[__wos.idx], id = d.focus, we = document.querySelector(`.win[data-win="${id}"]`);
  const r = el => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom }; };
  const vis = el => !!el && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' && +getComputedStyle(el).opacity > .2 && el.getBoundingClientRect().height > 0 && el.getBoundingClientRect().top < innerHeight;
  const dock = document.querySelector('#dock'), orb = document.querySelector('#orbWrap'), bar = we?.querySelector('.wbar');
  const send = we?.querySelector('.ch-compose button[type=submit]');
  return { full: !!d.full, imm: document.querySelector('#device').classList.contains('immersive'), corner: document.querySelector('#device').classList.contains('orb-corner'),
    win: r(we), bar: vis(bar), orbVis: vis(orb), dockVis: vis(dock), orb: r(orb), send: r(send), sheet: __wos.sheet, voice: __wos.voice, app: __wos.wins[id]?.app };
}); };
async function swipe(p, x, y0, y1, steps = 8) {
  const c = await p.context().newCDPSession(p);
  await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0, id: 1 }] });
  await p.waitForTimeout(30);
  for (let k = 1; k <= steps; k++) { await c.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + (y1 - y0) * k / steps, id: 1 }] }); await p.waitForTimeout(16); }
  await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(500);
}
async function pinch(p, cx, cy, d0, d1) {
  const c = await p.context().newCDPSession(p), pts = d => [{ x: cx - d / 2, y: cy, id: 1 }, { x: cx + d / 2, y: cy, id: 2 }];
  await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(d0) });
  for (let k = 1; k <= 10; k++) { await c.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(d0 + (d1 - d0) * k / 10) }); await p.waitForTimeout(16); }
  await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(600);
}
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const { p, errs } = await boot(b);
  // Chats sits on desk 2 by default.
  const chatsDesk = await p.evaluate(() => __wos.desks.findIndex(d => d.wins.some(id => __wos.wins[id].app === 'chats')));
  await p.evaluate(i => __wos.goDesk(i, true), chatsDesk); await p.waitForTimeout(800);
  let s = await state(p);
  ok(s.app === 'chats' && !s.full && s.bar && s.orbVis, 'tiled Chats: title bar and centred orb visible', JSON.stringify(s));
  await shot(p, '1-tiled');
  // 1. the full-screen button in the title bar
  const cid = await p.evaluate(() => __wos.desks[__wos.idx].focus);
  await p.locator(`.win[data-win="${cid}"] [data-wact="full"]`).tap(); await p.waitForTimeout(700);
  s = await state(p);
  ok(s.full && s.imm && s.corner, 'full-screen button → immersive Chats with corner orb', JSON.stringify(s));
  ok(!s.bar, 'title bar gone in full screen', JSON.stringify(s));
  ok(s.win && s.win.y <= 1 && s.win.b >= VH - 1 && s.win.x <= 0 && s.win.r >= VW, 'Chats fills the whole display', JSON.stringify(s.win));
  ok(s.orbVis && s.orb.r > VW - 70 && s.orb.b > VH - 70 && s.orb.w <= 50, 'orb is small and bottom-right', JSON.stringify(s.orb));
  // Edge to edge (James, 10 Oct): the native shell reports the camera cutout; shell windows pad their content
  // by it while the window itself still starts at the very top edge. Simulate a 32px punch-hole.
  await p.evaluate(() => window.__wosCutout(32)); await p.waitForTimeout(150);
  const cut = await p.evaluate(id => { const we = document.querySelector(`.win[data-win="${id}"]`); const f = we.querySelector('.ch-top, .ch-head'); return { winTop: we.getBoundingClientRect().top, body: we.querySelector('.wbody').getBoundingClientRect().top, firstTop: f ? f.getBoundingClientRect().top : -1, bg: getComputedStyle(we).backgroundColor, tilesTop: document.querySelector('.tiles.has-full')?.getBoundingClientRect().top }; }, cid);
  ok(cut.winTop <= 0.5 && cut.tilesTop <= 0.5, 'full-screen window starts at the very top edge', JSON.stringify(cut));
  ok(cut.body >= 31.5, 'shell window content clears the camera cutout', JSON.stringify(cut));
  // James (10 Oct, screenshot 2): the thread title must sit below the camera, background above it.
  const ban = await p.evaluate(() => { const d = document.querySelector('#device'), b = document.createElement('div'); b.className = 'wx-banners'; b.innerHTML = '<div style="height:20px">x</div>'; d.appendChild(b); const t = b.getBoundingClientRect().top; b.remove(); return t; });
  ok(ban >= 31.5, 'full screen: notice banners clear the camera', ban);
  ok(cut.firstTop >= 31.5, 'Chats top row (search / thread title) starts below the camera', JSON.stringify(cut));
  await shot(p, '2-chats-full-list');
  // open a thread so the composer shows
  await p.locator(`.win[data-win="${cid}"] [data-chopen]`).first().tap().catch(() => {}); await p.waitForTimeout(900);
  s = await state(p);
  ok(s.full && s.corner, 'opening a thread keeps full screen', JSON.stringify(s));
  if (s.send) ok(s.send.r <= s.orb.x - 4, 'composer Send stays clear of the corner orb', JSON.stringify({ send: s.send, orb: s.orb }));
  else ok(false, 'thread composer present', JSON.stringify(s));
  const head = await p.evaluate(() => { const h = document.querySelector('.win.full .ch-head'); return h ? h.getBoundingClientRect().top : -1; });
  ok(head >= 31.5, 'open thread: title bar sits below the camera', head);
  await shot(p, '3-chats-full-thread');
  // tap the corner orb: records; arc controls on screen
  const o = s.orb; await p.touchscreen.tap(o.x + o.w / 2, o.y + o.h / 2); await p.waitForTimeout(900);
  const arcs = await p.evaluate(() => ['#arcCancel', '#arcPause', '#arcAttach'].map(q => { const r = document.querySelector(q).getBoundingClientRect(); return { x: r.x, y: r.y, r: r.right, b: r.bottom, o: +getComputedStyle(document.querySelector(q)).opacity }; }));
  s = await state(p);
  ok(s.voice === 'listen', 'corner orb tap starts a voice reply', s.voice);
  ok(arcs.every(a => a.x >= 0 && a.r <= VW && a.y >= 0 && a.b <= VH && a.o > .5), 'Cancel · Pause · Attach fan out on screen from the corner', JSON.stringify(arcs));
  const compTop = await p.evaluate(() => document.querySelector('.win.full .ch-compose').getBoundingClientRect().top);
  ok(arcs.every(a => a.b <= compTop + 2), 'voice controls stay above the composer (never on Send)', JSON.stringify({ compTop, arcs }));
  await shot(p, '4-chats-full-recording');
  await p.locator('#arcCancel').tap(); await p.waitForTimeout(500);
  ok((await state(p)).voice === 'idle', 'Cancel discards the take');
  // swiping up on the corner orb never opens the launcher
  await swipe(p, o.x + o.w / 2, o.y + o.h / 2, o.y - 200);
  s = await state(p);
  ok(!s.sheet && s.full && s.voice === 'idle', 'swipe on the corner orb: no launcher, still full screen', JSON.stringify(s));
  // focus the composer: the bottom edge yields to the keyboard
  await p.locator('.win.full .ch-compose textarea').tap().catch(() => {}); await p.waitForTimeout(600);
  ok(await p.evaluate(() => getComputedStyle(document.querySelector('#immEdge')).display === 'none'), 'typing: the bottom-edge exit steps aside');
  await p.evaluate(() => document.activeElement?.blur()); await p.waitForTimeout(600);
  // 2. swipe up from the bottom edge (left of the orb) leaves full screen
  await swipe(p, 120, VH - 4, VH - 160);
  s = await state(p);
  ok(!s.full && !s.imm && s.bar && s.orbVis && Math.abs(s.orb.x + s.orb.w / 2 - VW / 2) < 4, 'bottom-edge swipe up → tiles, title bar and centred orb back', JSON.stringify(s));
  await shot(p, '5-back-to-tiles');
  // 3. pinch out enters, pinch in leaves
  const wr = (await state(p)).win;
  await pinch(p, wr.x + wr.w / 2, wr.y + wr.h / 2, 90, 240);
  s = await state(p); ok(s.full && s.imm, 'pinch out → immersive full screen', JSON.stringify(s));
  await pinch(p, VW / 2, VH / 2, 260, 80);
  s = await state(p); ok(!s.full && !s.imm, 'pinch in → back to tiles', JSON.stringify(s));
  // 4. a non-Chats app: everything goes, orb included; Back exits; the app stays open
  const other = await p.evaluate(() => { const i = __wos.desks.findIndex(d => d.wins.some(id => __wos.wins[id].app === 'review')); return i; });
  if (other >= 0) {
    await p.evaluate(i => __wos.goDesk(i, true), other); await p.waitForTimeout(800);
    const fid = await p.evaluate(() => __wos.desks[__wos.idx].wins.find(id => __wos.wins[id].app === 'review'));
    await p.evaluate(id => __wos.setFull(id, true), fid); await p.waitForTimeout(700);
    s = await state(p);
    ok(s.imm && !s.corner && !s.bar && !s.orbVis && !s.dockVis, 'other apps: title bar, bottom bar and orb all gone', JSON.stringify(s));
    ok(s.win.y <= 1 && s.win.b >= VH - 1, 'app fills the display', JSON.stringify(s.win));
    await shot(p, '6-review-full');
    await p.reload({ waitUntil: 'load' }); await p.waitForFunction(() => window.__wos && window.__wos.live && window.__wos.live.ok, null, { timeout: 30000 }); await p.waitForTimeout(900);
    s = await state(p); ok(s.full && s.imm, 'full screen survives a reload', JSON.stringify(s));
    const did = await p.evaluate(() => __wos.onBack() || (__wos.back.log.slice(-1)[0]));
    await p.waitForTimeout(600);
    s = await state(p);
    ok(!s.full && !s.imm && s.app === 'review', 'Back leaves full screen and the app is still open', JSON.stringify({ did, s }));
    // desk change while full: going to another desk drops immersive chrome-hiding for that desk
    await p.evaluate(id => __wos.setFull(id, true), fid); await p.waitForTimeout(300);
    await p.evaluate(i => __wos.goDesk(i, true), chatsDesk); await p.waitForTimeout(700);
    s = await state(p); ok(!s.imm && s.orbVis, 'another desk (not full) shows the normal shell', JSON.stringify(s));
  } else ok(false, 'review window present for the non-Chats case');
  // Hosted apps in full screen. One that clears the camera itself (reads --wos-cutout) stays full bleed; one that
  // doesn't is moved below the camera and the strip above takes the app's own background colour.
  await p.evaluate(() => window.__wosCutout(32)); // the reload above started a fresh page: the native shell pushes it again
  for (const [path, own] of [['/qa-edge-own/', true], ['/qa-edge-plain/', false]]) {
    const wid = await p.evaluate(u => __wos.openWin({ app: 'frame', url: u, title: 'Edge' }).id, path);
    await p.waitForTimeout(1200);
    await p.evaluate(id => __wos.setFull(id, true), wid); await p.waitForTimeout(1300);
    await settle(p);
    const e = await p.evaluate(id => { const we = document.querySelector(`.win[data-win="${id}"]`), f = we.querySelector('iframe');
      return { own: we.classList.contains('edge-own'), winTop: we.getBoundingClientRect().top, frameTop: f.getBoundingClientRect().top, bg: getComputedStyle(we).backgroundColor,
        cut: f.contentDocument.documentElement.style.getPropertyValue('--wos-cutout') }; }, wid);
    if (own) ok(e.own && e.frameTop <= 1.5 && e.cut === '32px', 'hosted app that reads --wos-cutout stays full bleed and gets the cutout', JSON.stringify(e));
    else ok(!e.own && e.winTop <= 0.5 && e.frameTop >= 31.5 && e.bg === 'rgb(18, 52, 86)', 'other hosted app moves below the camera, strip above in its own background', JSON.stringify(e));
    await shot(p, own ? '7-hosted-own' : '8-hosted-plain');
    await p.evaluate(id => { __wos.setFull(id, false); __wos.closeWin(id); }, wid); await p.waitForTimeout(500);
  }
  // Status bar (James, 10 Oct, screenshot 1): the native shell draws the page under the status bar and reports
  // its height. The background reaches the top of the glass and content starts below the bar.
  await p.evaluate(() => { window.__wosTop(28); __wos.goDesk(__wos.HOME, true); }); await p.waitForTimeout(900);
  const sb = await p.evaluate(() => { const d = document.querySelector('#device').getBoundingClientRect(), h = document.querySelector('.desk.home, .desk')?.getBoundingClientRect(),
    g = document.querySelector('.gear')?.getBoundingClientRect(); return { devTop: d.top, gearTop: g ? g.top : -1, safeT: getComputedStyle(document.querySelector('#device')).getPropertyValue('--safe-t') }; });
  ok(sb.devTop <= 0.5 && sb.gearTop >= 28, 'status bar: background reaches the top, Home content starts below the bar', JSON.stringify(sb));
  await shot(p, '9-home-statusbar');
  await p.evaluate(() => window.__wosTop(0));
  ok(errs.length === 0, 'no page errors', errs.join(' | '));
  // after leaving full screen the cutout padding is gone again
  const after = await p.evaluate(() => getComputedStyle(document.querySelector('#device')).getPropertyValue('--cut-t').trim());
  ok(after === '0px', 'cutout inset resets outside full screen', after);
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
