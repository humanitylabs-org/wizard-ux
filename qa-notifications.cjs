// QA (notifications fold, James 18 Oct 2026): the pull-down notifications panel is gone. "open inbox"/"notifications",
// ?view=inbox and the old Inbox entry points open the Chats list (Working + Ready) instead; the phone launcher has no
// Inbox tile; voice takes still on the phone show as one row at the top of Chats that opens Settings → Unsent.
// Usage: QA_WEB_DIR=<repo> node qa-notifications.cjs
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const URL_ = process.argv[2] || (require('./tools/qa-paths.cjs').origin() + '/wizard-os-home/');
const W = process.env.QA_WEB_DIR || __dirname;
const SHOTS = process.env.QA_SHOTS || '';
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };
const THREADS = Array.from({ length: 30 }, (_, i) => ({ id: `qa-${i}`, title: `QA thread ${i + 1}`, source: 'api_server', model: 'qa', message_count: 2, preview: 'Preview line', last_active: Date.now() / 1000 - i * 600, started_at: Date.now() / 1000 - i * 600 - 60 }));
const VW = 412, VH = 892;

async function boot(b, initUrl) {
  const ctx = await b.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true, permissions: ['microphone'] });
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url());
    if (u.origin !== new URL(URL_).origin) return r.abort();
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
  await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); localStorage.setItem('wos.tourDone', 'true'); } catch (e) {} if (window.__qaUnsent) {} });
  if (process.env.QA_NATIVE_UNSENT) await p.addInitScript(() => { window.WizardOSNative = { unsent: () => JSON.stringify([{ id: 'qa-take-1', state: 'failed', text: 'Remind me to call Miguel about the orb', createdAt: Date.now() - 60000, source: 'side' }]) }; });
  await p.goto(initUrl || URL_, { waitUntil: 'load' });
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


const front = p => p.evaluate(() => { const d = __wos.desks[__wos.idx], w = __wos.wins[d.focus]; const el = document.querySelector(`.win[data-win="${d.focus}"]`);
  return { app: w?.app, thread: w?.thread || '', sheet: __wos.sheet, list: !!el?.querySelector('.ch-list'), ready: !!el?.querySelector('[data-sec="ready"]'), working: !!el?.querySelector('[data-sec="working"]'),
    shade: document.querySelector('#inbox')?.classList.contains('open') || false, unsent: el?.querySelector('.ch-unsent')?.innerText || '' }; });
const isChatsList = s => s.app === 'chats' && !s.thread && s.list && s.ready && !s.sheet && !s.shade;
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  let { p, errs } = await boot(b);
  // 1. Launcher: no Inbox tile on the phone.
  await p.evaluate(() => __wos.openSheet('launcher')); await p.waitForTimeout(600);
  const tiles = await p.evaluate(() => [...document.querySelectorAll('#launcher [data-app]')].map(e => e.dataset.app));
  ok(!tiles.includes('v-inbox') && tiles.length > 3, 'phone launcher has no Inbox tile', tiles.join(','));
  await p.evaluate(() => __wos.closeSheets()); await p.waitForTimeout(400);
  // 2. Every old entry point opens the Chats list instead of the panel, from Home.
  await p.evaluate(() => __wos.goDesk(0, true)); await p.waitForTimeout(500);
  await p.evaluate(() => __wos.openSheet('inbox')); await p.waitForTimeout(900);
  let s = await front(p); ok(isChatsList(s), 'openSheet(inbox) from Home opens the Chats list (Working + Ready)', JSON.stringify(s));
  // 3. From inside a thread: back to the list.
  await p.evaluate(() => { const id = __wos.desks[__wos.idx].focus; __wos.openChat(id, 'qa-3'); }); await p.waitForTimeout(800);
  s = await front(p); ok(s.thread === 'qa-3', 'a thread is open', JSON.stringify(s));
  await p.evaluate(() => __wos.openSheet('inbox')); await p.waitForTimeout(900);
  s = await front(p); ok(isChatsList(s), 'from a thread it returns to the Chats list', JSON.stringify(s));
  // 4. Typed/voice commands.
  for (const t of ['open inbox', 'notifications', 'show my notifications']) {
    await p.evaluate(() => __wos.goDesk(0, true)); await p.waitForTimeout(400);
    await p.evaluate(t => __wos.handleText(t, 'command', false, 300, null), t); await p.waitForTimeout(1200);
    s = await front(p); ok(isChatsList(s), `"${t}" opens the Chats list`, JSON.stringify(s));
  }
  // 5. Keyboard ArrowDown no longer opens a panel.
  await p.evaluate(() => __wos.goDesk(0, true)); await p.waitForTimeout(400);
  await p.keyboard.press('ArrowDown'); await p.waitForTimeout(900);
  s = await front(p); ok(!s.shade, 'ArrowDown never shows the old panel', JSON.stringify(s));
  ok(errs.length === 0, 'no page errors', errs.join(' | '));
  await p.context().close();
  // 6. Deep link ?view=inbox.
  ({ p, errs } = await boot(b, URL_ + '?view=inbox')); await p.waitForTimeout(800);
  s = await front(p); ok(isChatsList(s), '?view=inbox opens the Chats list', JSON.stringify(s));
  ok(!s.unsent, 'no Unsent row when nothing is waiting', s.unsent);
  await p.context().close();
  // 7. A voice take still on the phone: one row at the top of Chats; tapping it opens Settings → Unsent.
  process.env.QA_NATIVE_UNSENT = '1';
  ({ p, errs } = await boot(b));
  await p.evaluate(() => __wos.openSheet('inbox')); await p.waitForTimeout(900);
  s = await front(p);
  ok(/1 voice take not sent/.test(s.unsent) && /call Miguel/.test(s.unsent), 'unsent voice take shows as a row at the top of Chats', JSON.stringify(s));
  const top = await p.evaluate(() => { const d = __wos.desks[__wos.idx]; const el = document.querySelector(`.win[data-win="${d.focus}"] .ch-scroll`); const first = [...el.children].find(c => c.offsetHeight); return first?.className || ''; });
  ok(/ch-unsent/.test(top), 'the row sits first in the list', top);
  if (SHOTS) await p.screenshot({ path: path.join(SHOTS, 'notif-unsent-row.png') });
  await p.evaluate(() => { const d = __wos.desks[__wos.idx]; document.querySelector(`.win[data-win="${d.focus}"] .ch-unsent`).click(); }); await p.waitForTimeout(900);
  const st = await p.evaluate(() => ({ sheet: __wos.sheet, txt: document.querySelector('#settingsBody')?.innerText.slice(0, 2000) || '' }));
  ok(st.sheet === 'settings' && /Unsent/.test(st.txt) && /call Miguel/.test(st.txt), 'tapping it opens Settings at Unsent with the take', JSON.stringify({ sheet: st.sheet }));
  ok(errs.length === 0, 'no page errors (unsent)', errs.join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
