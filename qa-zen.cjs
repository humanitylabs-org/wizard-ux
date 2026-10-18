// QA (distraction-free, James 18 Oct 2026): a short swipe down on the orb, or starting a little above it, hides the
// bottom bar and the window title bars; the windows grow smoothly (no frame jump); swipe up from the bottom edge or
// Back brings them back; swipe down no longer opens the Inbox shade; swipe up still opens Apps. Writes intercepted.
// Usage: QA_WEB_DIR=<repo> [QA_SHOTS=dir] node qa-zen.cjs [url]
const { chromium } = (() => { try { return require('playwright'); } catch (e) { return require('/home/telos/node_modules/playwright'); } })();
const fs = require('fs'), path = require('path');
const URL_ = process.argv[2] || 'https://wizard.tailc0f369.ts.net/wizard-os-home/';
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
    if (!/wizard\.tailc0f369\.ts\.net$/.test(u.hostname)) return r.abort();
    const m = u.pathname.match(/^\/wizard-os-home\/(.*)$/);
    if (m && q.method() === 'GET' && !m[1].startsWith('api/')) {
      const f = m[1] || 'index.html';
      // data.js / summaries.js are untracked build outputs: fall back to the live tree's copy (same as tools/qa-origin.cjs).
      let p = path.join(W, 'web', f); if (!fs.existsSync(p) && /^(data|summaries)\.js$/.test(f)) p = path.join('/home/telos/apps/wizard-os-home/web', f);
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

const zenOn = p => p.evaluate(() => document.querySelector('#device').classList.contains('zen'));
// Sample the first chat row's top every frame while a transition runs: a smooth change never moves it >20px in a frame.
const sampleRows = p => p.evaluate(() => { window.__rowTops = []; const go = t0 => { const r = document.querySelector(`.win[data-win="${__wos.desks[__wos.idx].focus}"] .ch-row`); if (r) window.__rowTops.push(Math.round(r.getBoundingClientRect().top)); if (performance.now() - t0 < 2500) requestAnimationFrame(() => go(t0)); }; requestAnimationFrame(() => go(performance.now())); });
// Animated, not snapped: the row passes through in-between positions (frame rate on a CI host can be ~15 fps).
const maxStep = async p => { await p.waitForTimeout(2200); return p.evaluate(() => { const a = window.__rowTops, f = a[0], l = a[a.length - 1]; const mid = new Set(a.filter(v => v !== f && v !== l)).size; return { mid, n: a.length, first: f, last: l }; }); };
(async () => {
  const b = await chromium.launch({ executablePath: process.env.QA_CHROME || undefined, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const { p, errs } = await boot(b);
  const chatsDesk = await p.evaluate(() => __wos.desks.findIndex(d => d.wins.some(id => __wos.wins[id].app === 'chats')));
  await p.evaluate(i => __wos.goDesk(i, true), chatsDesk); await p.waitForTimeout(800);
  let s = await state(p);
  ok(s.app === 'chats' && s.bar && s.orbVis && s.dockVis, 'tiled Chats: title bar and orb visible', JSON.stringify(s));
  await shot(p, 'zen-0-before');
  const before = s.win;
  // 1. A short swipe down on the orb (only ~24px of travel: the orb sits near the bottom of the glass).
  const ox = s.orb.x + s.orb.w / 2, oy = s.orb.y + s.orb.h / 2;
  await sampleRows(p);
  await swipe(p, ox, oy, oy + 24, 2);
  const st = await maxStep(p);
  s = await state(p);
  ok(await zenOn(p), 'short swipe down on the orb enters distraction-free');
  ok(!s.dockVis && !s.orbVis, 'orb and bottom bar hidden', JSON.stringify(s));
  ok(!s.bar, 'window title bar hidden');
  ok(!s.sheet, 'no Inbox shade opens', String(s.sheet));
  ok(s.win.b > before.b + 40 && s.win.b >= VH - 30, 'window grows into the freed bottom space', JSON.stringify({ before, after: s.win }));
  ok(s.win.y <= before.y && s.win.x <= before.x, 'window grows to the top and edges', JSON.stringify({ before, after: s.win }));
  ok(st.last < st.first && st.mid >= 1, 'content glides up (animated through in-between positions, no snap)', JSON.stringify(st));
  const hv = await p.evaluate(() => { const e = document.querySelector('#zenEdge'), r = e.getBoundingClientRect(), h = document.elementFromPoint(innerWidth / 2, r.top + r.height / 2); return { h: r.height, hit: h === e || e.contains(h) }; });
  ok(hv.h >= 24 && hv.hit, 'bottom-edge handle is a real >=24px target', JSON.stringify(hv));
  // Native shell draws under the status bar and reports its height (--nat-t); distraction-free keeps the bar,
  // so the app must start below it (James, 18 Oct: thread title overlapped the clock).
  await p.evaluate(() => window.__wosTop(44));
  const sb = await state(p);
  ok(sb.win.y >= 44, 'distraction-free app starts below the native status bar', JSON.stringify(sb.win));
  await p.evaluate(() => window.__wosTop(0));
  await shot(p, 'zen-1-hidden');
  // 2. Swipe up from the bottom edge brings everything back.
  await sampleRows(p);
  await swipe(p, VW / 2, VH - 10, VH - 70, 8);
  const st2 = await maxStep(p);
  s = await state(p);
  ok(!(await zenOn(p)) && s.dockVis && s.orbVis && s.bar, 'swipe up from the bottom edge restores orb and title bar', JSON.stringify(s));
  ok(Math.abs(s.win.b - before.b) < 2 && Math.abs(s.win.y - before.y) < 2, 'window returns to its tiled size', JSON.stringify({ before, now: s.win }));
  ok(st2.last > st2.first && st2.mid >= 1, 'restore glides too', JSON.stringify(st2));
  // 3. Forgiving: the swipe may start ~40px above the orb, on the list.
  await swipe(p, ox + 10, s.orb.y - 40, s.orb.y + 6, 8);
  ok(await zenOn(p), 'swipe starting ~40px above the orb also hides the bars');
  await p.evaluate(() => __wos.onBack()); await p.waitForTimeout(600);
  s = await state(p);
  ok(!(await zenOn(p)) && s.dockVis && s.app === 'chats', 'Back leaves distraction-free and Chats stays open', JSON.stringify(s));
  // 4. A tap or a scroll up just above the orb never hides anything.
  const c = await p.context().newCDPSession(p);
  await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: ox, y: s.orb.y - 30, id: 1 }] });
  await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await p.waitForTimeout(300);
  await swipe(p, ox, s.orb.y - 20, s.orb.y - 120, 8);
  ok(!(await zenOn(p)), 'tap / upward scroll above the orb leaves the bars alone');
  // 5. Swipe up on the orb still opens Apps.
  s = await state(p);
  await swipe(p, ox, oy, oy - 160, 8); await p.waitForTimeout(400);
  s = await state(p);
  ok(s.sheet === 'launcher', 'swipe up on the orb still opens Apps', String(s.sheet));
  await p.evaluate(() => __wos.closeSheets()); await p.waitForTimeout(500);
  // 6. A reload always starts with the orb showing (James, 18 Oct: it was starting hidden).
  await swipe(p, ox, oy, oy + 24, 2); await p.waitForTimeout(400);
  await p.reload({ waitUntil: 'load' });
  await p.waitForFunction(() => window.__wos && window.__wos.live && window.__wos.live.ok, null, { timeout: 30000 }); await p.waitForTimeout(800);
  ok(!(await zenOn(p)) && (await state(p)).orbVis, 'orb shows again after a reload');
  // 7. Home desk too.
  await p.evaluate(() => __wos.goDesk(0, true)); await p.waitForTimeout(700);
  s = await state(p);
  await swipe(p, s.orb.x + s.orb.w / 2, s.orb.y + s.orb.h / 2, s.orb.y + s.orb.h / 2 + 24, 2);
  s = await state(p);
  ok(await zenOn(p) && !s.dockVis, 'works on Home as well');
  await shot(p, 'zen-2-home');
  await p.evaluate(() => __wos.onBack()); await p.waitForTimeout(500);
  // 8. Full-screen Chats: the corner orb hides on a swipe down too; the bottom swipe brings it back, full screen stays.
  await p.evaluate(i => __wos.goDesk(i, true), chatsDesk); await p.waitForTimeout(600);
  await p.evaluate(() => __wos.setFull(__wos.desks[__wos.idx].focus, true)); await p.waitForTimeout(900);
  s = await state(p);
  ok(s.imm && s.corner && s.orbVis, 'full-screen Chats shows the corner orb', JSON.stringify(s));
  await swipe(p, s.orb.x + s.orb.w / 2, s.orb.y + s.orb.h / 2, s.orb.y + s.orb.h / 2 + 26, 2);
  s = await state(p);
  ok(await zenOn(p) && !s.dockVis && s.imm, 'swipe down on the corner orb hides it, full screen stays', JSON.stringify(s));
  await shot(p, 'zen-3-fullscreen-chats');
  await swipe(p, VW / 2, VH - 10, VH - 70, 8);
  s = await state(p);
  ok(!(await zenOn(p)) && s.orbVis && s.imm, 'bottom swipe brings the corner orb back, still full screen', JSON.stringify(s));
  await p.evaluate(() => __wos.setFull(__wos.desks[__wos.idx].focus, false)); await p.waitForTimeout(600);
  // 9. First-run tour beat 3 now teaches this gesture.
  await p.evaluate(() => { __wos.goDesk(0, true); WosTour.start('qa'); WosTour._go(3); }); await p.waitForTimeout(900);
  s = await state(p);
  await swipe(p, s.orb.x + s.orb.w / 2, s.orb.y + s.orb.h / 2, s.orb.y + s.orb.h / 2 + 24, 2); await p.waitForTimeout(400);
  const tc = await p.evaluate(() => ({ step: WosTour.step, copy: document.querySelector('#tour')?.innerText || '' }));
  ok(await zenOn(p) && tc.step === 3 && /Swipe up from the bottom/.test(tc.copy), 'tour beat 3: swipe down hides the bars and says how to get them back', JSON.stringify(tc));
  await swipe(p, VW / 2, VH - 10, VH - 70, 8); await p.waitForTimeout(700);
  const tc2 = await p.evaluate(() => ({ step: WosTour.step }));
  ok(!(await zenOn(p)) && tc2.step === 4, 'tour beat 3: swipe up from the bottom finishes the beat', JSON.stringify(tc2));
  ok(errs.length === 0, 'no page errors', errs.join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
