// QA: recording and sending never fade or cover the screen. James taps the orb, then keeps
// scrolling and tapping while the take records, transcribes and sends.
// Checks, while listening / paused / sending: the desk and windows keep full opacity and no blur;
// the middle of the screen hit-tests to the app, not the voice layer; a touch scroll moves the
// content; a tap on a thread opens it; and recording carries on through all of it.
// Usage: QA_WEB_DIR=<repo> node qa-voice-nodim.cjs [url]. Every Hermes/Wizard write is intercepted.
const { chromium } = require('./tools/qa-playwright.cjs');
const URL_ = process.argv[2] || (require('./tools/qa-paths.cjs').origin() + '/wizard-os-home/');
const W = process.env.QA_WEB_DIR || __dirname;
const SHOTS = process.env.QA_SHOTS || '';
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };

const THREADS = Array.from({ length: 40 }, (_, i) => ({ id: `qa-${i}`, title: `QA thread ${i + 1}`, source: 'api_server', model: 'qa', message_count: 2, preview: 'Preview line for scrolling', last_active: Date.now() / 1000 - i * 600, started_at: Date.now() / 1000 - i * 600 - 60 }));

async function boot(b) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true, permissions: ['microphone'] });
  const writes = [];
  let slowSend = null;
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url());
    if (!(u.origin === require('./tools/qa-paths.cjs').origin())) return r.abort();
    const m = u.pathname.match(/^\/wizard-os-home\/(.*)$/);
    if (m && q.method() === 'GET' && !m[1].startsWith('api/')) {
      const f = m[1] || 'index.html', p = require('path').join(W, 'web', f);
      if (!require('fs').existsSync(p)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      const ct = f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : f.endsWith('.png') ? 'image/png' : f.endsWith('.webmanifest') ? 'application/manifest+json' : 'application/javascript';
      return r.fulfill({ status: 200, contentType: ct, body: require('fs').readFileSync(p) });
    }
    if (q.method() !== 'GET') writes.push(u.pathname);
    if (/\/api\/transcribe$/.test(u.pathname)) { await new Promise(res => { slowSend = res; setTimeout(res, 20000); }); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: 'something for archimedes about the week', ms: 300 }) }).catch(() => {}); }
    if (/\/api\/route$/.test(u.pathname)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ms: 5, cmd: { route: 'agent' } }) });
    if (/\/hermes\/api\/sessions$/.test(u.pathname) && q.method() === 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: THREADS, has_more: false }) });
    if (/\/wizard\/thread-seen$/.test(u.pathname)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state: { initializedAt: Date.now(), threads: {} } }) });
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => { if (/wizard-os-home\//.test(String(e.stack || '')) || !/https?:\/\//.test(String(e.stack || ''))) errs.push(String(e)); });
  await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); } catch (e) {} });
  await p.goto('about:blank');
  await p.goto(URL_, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__wos && window.__wos.live && window.__wos.live.ok, null, { timeout: 30000 });
  await p.waitForTimeout(800);
  return { ctx, p, errs, writes, release: () => slowSend && slowSend() };
}
async function tapOrb(p, wait = 1500) { const o = await p.locator('#orbWrap').boundingBox(); await p.touchscreen.tap(o.x + o.width / 2, o.y + o.height / 2); await p.waitForTimeout(wait); }
// Visual state of whatever is on screen: every desk/window layer that is visible must be undimmed.
const look = p => p.evaluate(() => {
  const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.right > 0 && r.left < innerWidth; };
  const layers = [...document.querySelectorAll('.desk > *, .tiles, .win')].filter(vis);
  const dim = layers.filter(el => !(el.classList.contains('glance') && el.closest('.desk.has-wins'))).map(el => { const cs = getComputedStyle(el); return { c: el.className.toString().slice(0, 30), o: +cs.opacity, f: cs.filter }; }).filter(x => x.o < 0.99 || (x.f && x.f !== 'none'));
  const mid = document.elementFromPoint(innerWidth / 2, innerHeight * 0.42);
  const upper = document.elementFromPoint(innerWidth / 2, innerHeight * 0.25);
  const lean = getComputedStyle(document.querySelector('.lean'));
  return { voice: __wos.voice, layers: layers.length, dim, midInVoice: !!mid?.closest('#voice'), upperInVoice: !!upper?.closest('#voice'), mid: mid?.className?.toString().slice(0, 40), lean: +lean.opacity };
});
// The scrollable thread list in the focused Chats window.
const scroller = p => p.evaluateHandle(() => {
  const els = [...document.querySelectorAll('.win *')].filter(el => { const cs = getComputedStyle(el); return /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 40; });
  return els.sort((a, b) => b.clientHeight - a.clientHeight)[0] || null;
});

// Real finger drag: touchStart → moves → touchEnd, so the page sees what a thumb does.
async function drag(ctx, p, x, y, dy) {
  const c = await ctx.newCDPSession(p);
  const pt = yy => [{ x: Math.round(x), y: Math.round(yy), id: 1 }];
  await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(y) });
  for (let k = 1; k <= 12; k++) { await c.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(y + dy * k / 12) }); await p.waitForTimeout(16); }
  await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(500);
}

(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const { ctx, p, errs, release } = await boot(b);
  // Home desk with the Chats window, which lists threads.
  await p.evaluate(() => window.__wos.goDesk(1, true)); await p.waitForTimeout(900);
  const sh = await scroller(p);
  const hasList = await p.evaluate(el => !!el, sh);
  ok(hasList, 'a scrollable thread list is on screen');
  let s = await look(p);
  ok(s.dim.length === 0 && s.layers > 0, 'idle: nothing dimmed', JSON.stringify(s));

  await tapOrb(p);
  s = await look(p);
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/nodim-recording.png` });
  ok(s.voice === 'listen', 'tap orb starts recording', s.voice);
  ok(s.dim.length === 0, 'recording: desk and windows keep full opacity, no blur', JSON.stringify(s.dim));
  ok(!s.midInVoice && !s.upperInVoice, 'recording: the middle of the screen still hits the app', JSON.stringify(s));
  ok(s.lean < 0.05, 'recording: no colour wash over the screen', String(s.lean));

  // Scroll the list by touch while recording.
  if (hasList) {
    const box = await p.evaluate(el => { el.scrollTop = 0; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * 0.7, h: r.height }; }, sh);
    await drag(ctx, p, box.x, box.y, -Math.round(box.h * 0.45));
    const top = await p.evaluate(el => el.isConnected ? el.scrollTop : -1, sh).then(async v => v >= 0 ? v : p.evaluate(el => el && el.scrollTop, await scroller(p)));
    ok(top > 40, 'recording: touch scroll moves the list', String(top));
    ok((await look(p)).voice === 'listen', 'recording keeps going after the scroll');
    // Tap a thread while recording.
    const row = await p.evaluate(el => { const rows = [...el.querySelectorAll('button, [data-thread], .ch-row')].filter(r => { const b = r.getBoundingClientRect(); return b.top > el.getBoundingClientRect().top + 10 && b.bottom < innerHeight * 0.55 && b.height > 20; }); const r = rows[0]?.getBoundingClientRect(); return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2, t: rows[0].textContent.slice(0, 30) } : null; }, sh);
    if (row) {
      const hit = await p.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('#voice'), row);
      ok(!hit, 'recording: a thread row is tappable (not under the voice layer)', JSON.stringify(row));
      await p.touchscreen.tap(row.x, row.y); await p.waitForTimeout(700);
      ok((await look(p)).voice === 'listen', 'recording keeps going after tapping into the app');
      const opened = await p.evaluate(() => !!document.querySelector('.win [data-chback]'));
      ok(opened, 'recording: the tapped thread opened');
      const bk = await p.locator('.win [data-chback]').first().boundingBox();
      if (bk) { await p.touchscreen.tap(bk.x + bk.width / 2, bk.y + bk.height / 2); await p.waitForTimeout(700); }
      ok(!(await p.evaluate(() => !!document.querySelector('.win [data-chback]'))) && (await look(p)).voice === 'listen', 'recording: in-app Back tap returns to the list, still recording');
    } else ok(false, 'found a thread row to tap');
  }

  await p.click('#arcPause'); await p.waitForTimeout(400);
  s = await look(p);
  ok(s.voice === 'paused' && s.dim.length === 0, 'paused: nothing dimmed', JSON.stringify(s));
  await p.click('#arcPause'); await p.waitForTimeout(400);

  // Send: transcription is held for 5 s; the screen must stay live the whole time.
  await tapOrb(p, 600);
  s = await look(p);
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/nodim-sending.png` });
  ok(s.voice === 'think', 'send: transcribing', s.voice);
  ok(s.dim.length === 0 && !s.midInVoice, 'sending: nothing dimmed, screen still live', JSON.stringify(s));
  if (hasList) {
    // The tap above may have opened a thread: scroll whatever list is in front now.
    const sh2 = await scroller(p);
    const before = await p.evaluate(el => { el.scrollTop = Math.round((el.scrollHeight - el.clientHeight) / 2); return el.scrollTop; }, sh2);
    const box = await p.evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * 0.3, h: r.height }; }, sh2);
    await p.waitForTimeout(500); // let the programmatic jump settle before the thumb lands
    await drag(ctx, p, box.x, box.y, Math.round(box.h * 0.3));
    // A live refresh mid-send may re-render the list (it keeps its scroll position on the new element): read
    // the list that is on screen now, not a detached one.
    const after = await p.evaluate(el => el.isConnected ? el.scrollTop : -1, sh2).then(async v => v >= 0 ? v : p.evaluate(el => el && el.scrollTop, await scroller(p)));
    ok(after !== before && (await look(p)).voice === 'think', 'sending: touch scroll still works mid-send', `${before}→${after}`);
  }
  release(); // let the held transcribe answer now (fixture holds it so 'mid-send' is real under load)
  await p.waitForTimeout(6000);
  s = await look(p);
  ok(s.voice === 'idle' && s.dim.length === 0, 'after send: back to idle, nothing dimmed', JSON.stringify(s));
  ok(errs.length === 0, 'no page errors', errs.join(' | '));
  await ctx.close();
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
