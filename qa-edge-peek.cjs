// Edge peek QA (phone): a view bound beside a chat thread can be reached by tapping or swiping the edge where it
// leans in, and the thread's edge on that view goes back. The handle and the next dock dot glow when it appears.
// Read-only: every write is answered 204 locally; the thread and the bound page are fixtures (no private content).
// Usage: QA_PLAYWRIGHT=<playwright module> QA_OUT=<dir> node qa-edge-peek.cjs http://127.0.0.1:<port> [--skin nebula] [--expect on|off]
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const { chromium, devices } = require('./tools/qa-playwright.cjs');
const origin = process.argv[2] || 'http://127.0.0.1:8894';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const skin = arg('--skin', 'nebula'), expect = arg('--expect', 'on');
const out = process.env.QA_OUT || path.join(process.env.TMPDIR || '.', 'edge-peek'); fs.mkdirSync(out, { recursive: true });
const results = [];
const ok = (name, value, detail) => { results.push({ name, pass: !!value }); console.log(`${value ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ' ' + JSON.stringify(detail)}`); };
const VIEW = '<!doctype html><meta name="viewport" content="width=device-width"><body style="margin:0;font:600 22px system-ui;background:#16324a;color:#fff;display:grid;place-items:center;height:100vh">Bound view (QA fixture)</body>';
const messages = sid => ({ object: 'list', session_id: sid, pagination: { limit: 500, offset: 0, order: 'oldest', returned: 2 }, data: [
  { id: 'qa1', session_id: sid, role: 'user', timestamp: String(Date.now() / 1000 - 60), content: 'Build me the page.' },
  { id: 'qa2', session_id: sid, role: 'assistant', timestamp: String(Date.now() / 1000 - 30), content: 'Done. The page is ready: [open the page](/qa-edge-peek/view/). It sits right beside this thread.', shareable: true },
] });

async function phone(b, { reduced = false } = {}) {
  const ctx = await b.newContext({ ...devices['iPhone 13'], reducedMotion: reduced ? 'reduce' : 'no-preference', serviceWorkers: 'block' });
  await ctx.route(/.*/, r => ['GET', 'HEAD'].includes(r.request().method()) ? r.fallback() : r.fulfill({ status: 204, body: '' }));
  let sid = null;
  await ctx.route(/\/qa-edge-peek\/view\//, r => r.fulfill({ contentType: 'text/html', body: VIEW }));
  await ctx.route(/\/wizard\/hermes\/api\/sessions\/[^/?]+(\/messages)?\?/, async r => {
    if (r.request().method() !== 'GET') return r.fallback();
    const u = new URL(r.request().url()), m = u.pathname.match(/sessions\/([^/]+)(\/messages)?$/);
    if (!m || m[1] !== sid) return r.fallback();
    if (m[2]) return r.fulfill({ json: messages(sid) });
    const response = await r.fetch(), json = await response.json();
    json.session = { ...json.session, title: 'Edge peek QA', message_count: 2, latest_message: messages(sid).data[1] };
    return r.fulfill({ response, json });
  });
  await ctx.addInitScript(s => { if (window !== parent) return; localStorage.setItem('wos.skin', s); localStorage.setItem('wos.tour.v1', 'true'); localStorage.setItem('wos.tour.done', 'true'); localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.deskcoached', 'true'); localStorage.setItem('wos.rvCoached', 'true'); }, skin);
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e.message).slice(0, 200)));
  await page.goto(origin + '/wizard-os-home/');
  await page.waitForFunction(() => !!window.__wos?.wins && (window.__wos.live?.sessions || []).length > 0, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  sid = await page.evaluate(() => window.__wos.live.sessions[0].id);
  await page.evaluate(id => window.__wos.openWizardThread(id), sid);
  await page.waitForFunction(() => document.getElementById('device').classList.contains('bound-peeking'), null, { timeout: 20000 });
  await page.waitForTimeout(700); // the lean-in transition
  const cdp = await ctx.newCDPSession(page);
  const drag = async (x0, x1, y0 = 420, y1 = y0, ms = 160) => {
    const n = 8; await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
    for (let i = 1; i <= n; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * i / n, y: y0 + (y1 - y0) * i / n }] }); await page.waitForTimeout(ms / n); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(700);
  };
  return { ctx, page, errors, drag, sid };
}
const state = page => page.evaluate(() => {
  const W = window.__wos, d = document.getElementById('device'), f = W.wins[W.desks[W.idx].focus], g = document.querySelector('.bound-grab');
  const r = g && !g.hidden ? g.getBoundingClientRect() : null;
  const anim = (sel, pseudo) => document.getAnimations().filter(a => a.playState === 'running' && a.effect?.target?.matches?.(sel) && (pseudo ? a.effect.pseudoElement === pseudo : !a.effect.pseudoElement)).map(a => a.animationName);
  return { idx: W.idx, app: f?.app, bound: !!f?.bound, peek: d.classList.contains('bound-peeking') ? 1 : d.classList.contains('bound-view-peeking') ? -1 : 0,
    grab: g ? (g.hidden ? 'hidden' : g.classList.contains('right') ? 'right' : 'left') : 'none', rect: r && { x: Math.round(r.x), w: Math.round(r.width), y: Math.round(r.y), h: Math.round(r.height) },
    label: g?.getAttribute('aria-label') || '', glow: anim('.bound-grab', '::after'), dotR: anim('#dotsR > .ddot:first-child .dsg'), dotL: anim('#dotsL > .ddot:last-child .dsg'), vw: innerWidth, vh: innerHeight, dockTop: Math.round(document.getElementById('dock').getBoundingClientRect().top) };
});
const shot = (page, name) => page.screenshot({ path: path.join(out, `edge-peek-${skin}-${name}.png`) });

(async () => {
  const b = await chromium.launch({ executablePath: process.env.QA_CHROME || undefined });
  try {
    const { page, errors, drag, ctx } = await phone(b);
    let s = await state(page); const home = s.idx;
    ok('thread in front with the bound view leaning in on the right', s.app === 'chats' && s.peek === 1, s);
    if (expect === 'off') {
      ok('off: no edge handle; the shared peek is unchanged', s.grab === 'none', s);
      await drag(Math.round(s.vw * .7), Math.round(s.vw * .2), s.dockTop + 30); s = await state(page);
      ok('off: the bottom-bar swipe still reaches the view', s.idx === home + 1 && s.bound, s);
    } else {
      ok('handle on the right edge, over the lean-in, clear of status bar and dock', s.grab === 'right' && s.rect.x >= s.vw - 40 && s.rect.y > 40 && s.rect.y + s.rect.h <= s.dockTop, s);
      ok('the handle and the next dock dot glow when it appears', s.glow.length > 0 && s.dotR.length > 0, { glow: s.glow, dot: s.dotR });
      await shot(page, '1-thread-glow');
      await page.waitForTimeout(5200); s = await state(page);
      ok('the glow stops after three runs', s.glow.length === 0 && s.dotR.length === 0, s);
      await page.touchscreen.tap(s.rect.x + s.rect.w / 2, s.rect.y + s.rect.h / 2); await page.waitForTimeout(800); s = await state(page);
      ok('tap the right edge: on the bound view', s.idx === home + 1 && s.bound && s.peek === -1, s);
      ok('on the view: thread edge on the left, glowing, labelled Back', s.grab === 'left' && s.rect.x === 0 && /Back to the thread/.test(s.label) && s.glow.length > 0 && s.dotL.length > 0, s);
      await shot(page, '2-view-left-edge');
      await page.touchscreen.tap(s.rect.x + s.rect.w / 2, s.rect.y + s.rect.h / 2); await page.waitForTimeout(800); s = await state(page);
      ok('tap the left edge: back on the thread', s.idx === home && s.app === 'chats' && s.grab === 'right', s);
      const R = s.rect, mid = R.y + R.h / 2;
      await drag(R.x + 20, R.x + 20 - 40, mid); s = await state(page);
      ok('a short nudge on the edge does nothing', s.idx === home, s);
      await drag(R.x + 20, R.x + 30, mid, mid + 160); s = await state(page);
      ok('a vertical drag on the edge does nothing', s.idx === home, s);
      await drag(R.x + 20, R.x + 20 - 170, mid); s = await state(page);
      ok('swipe the right edge toward the middle: on the bound view', s.idx === home + 1 && s.bound && s.grab === 'left', s);
      const L = s.rect;
      await drag(L.x + 8, L.x + 8 + 170, L.y + L.h / 2); s = await state(page);
      ok('swipe the left edge toward the middle: back on the thread', s.idx === home && s.app === 'chats', s);
      await page.evaluate(() => { const g = document.querySelector('.bound-grab'); g.focus(); }); await page.keyboard.press('Enter'); await page.waitForTimeout(800); s = await state(page);
      ok('keyboard Enter on the edge moves across too', s.idx === home + 1 && s.bound, s);
      await page.evaluate(() => window.__wos.goDesk(window.__wos.idx - 1)); await page.waitForTimeout(800);
    }
    // Regressions: the bottom bar swipe and the thread swipe-back still own their own gestures.
    s = await state(page);
    if (expect !== 'off') { await drag(260, 90, s.dockTop + 30); s = await state(page); ok('bottom-bar swipe still moves to the view', s.idx === home + 1 && s.bound, s); await drag(90, 280, s.dockTop + 30); s = await state(page); ok('bottom-bar swipe back to the thread', s.idx === home && s.app === 'chats', s); }
    else { await page.evaluate(() => window.__wos.goDesk(window.__wos.idx - 1)); await page.waitForTimeout(800); s = await state(page); }
    await drag(120, 330, Math.round(s.vh * .45)); s = await state(page);
    ok('thread swipe-back still goes back (the thread closes), and the edge goes with the bound view', s.peek === 0 && (s.grab === 'none' || s.grab === 'hidden'), s);
    ok('no page errors', errors.length === 0, errors);
    await ctx.close();
    if (expect !== 'off') {
      const r = await phone(b, { reduced: true }); const t = await state(r.page);
      ok('reduced motion: handle shown, nothing animates', t.grab === 'right' && t.glow.length === 0 && t.dotR.length === 0, t);
      await r.ctx.close();
    }
    const dctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
    await dctx.route(/.*/, r => ['GET', 'HEAD'].includes(r.request().method()) ? r.continue() : r.fulfill({ status: 204, body: '' }));
    await dctx.addInitScript(s => { localStorage.setItem('wos.skin', s); localStorage.setItem('wos.tour.v1', 'true'); localStorage.setItem('wos.coached', 'true'); }, skin);
    const dp = await dctx.newPage(), derr = []; dp.on('pageerror', e => derr.push(e.message));
    await dp.goto(origin + '/wizard-os-home/desktop.html'); await dp.waitForTimeout(5000);
    const dd = await dp.evaluate(() => ({ grab: document.querySelectorAll('.bound-grab').length, shell: document.documentElement.dataset.shell }));
    ok('desktop shell: no edge handle, no errors', dd.grab === 0 && derr.length === 0, { ...dd, derr });
    await dctx.close();
  } finally { await b.close(); }
  const failed = results.filter(r => !r.pass).length;
  console.log(`${results.length - failed}/${results.length} passed`);
  fs.writeFileSync(path.join(out, `edge-peek-${skin}-${expect}.json`), JSON.stringify(results, null, 1));
  assert.equal(failed, 0);
})().catch(e => { console.error(e); process.exit(1); });
