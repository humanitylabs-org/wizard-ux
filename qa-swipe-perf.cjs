// Perf probe: desk swipes stay smooth with Legacy Wizard open.
// Measures frame gaps and main-thread long tasks during (a) finger-drag swipes on the orb and
// (b) animated desk changes, on a 4x-throttled phone, with and without Legacy Wizard on a desk.
// Usage: QA_WEB_DIR=$PWD node qa-swipe-perf.cjs [origin]  (QA_WEB_DIR serves the shell from this checkout)
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const URL_ = process.argv[2] || (require('./tools/qa-paths.cjs').origin() + '/wizard-os-home/');
const RESOLVE = process.env.QA_RESOLVE || '';
const W = process.env.QA_WEB_DIR, THROTTLE = +(process.env.QA_CPU || 4), STRICT = !!process.env.QA_STRICT;

async function run(b, withLegacy) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2.6, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36' });
  await ctx.route('**/*', r => {
    const q = r.request(), u = q.url();
    const m = u.match(/\/wizard-os-home\/((?:desktop\/|core\/)?[a-z-]+\.(?:js|css|html)|)(\?|$)/);
    if (W && m && q.method() === 'GET' && !/^(data|summaries)\.js$/.test(m[1])) {
      const f = m[1] || 'index.html', p = path.join(W, 'web', f);
      if (fs.existsSync(p)) return r.fulfill({ status: 200, contentType: f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : 'application/javascript', body: fs.readFileSync(p) });
    }
    if (q.method() !== 'GET' && /\/wizard\//.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    return r.continue();
  });
  const p = await ctx.newPage();
  const reqs = []; let counting = false; p.on('request', q => { if (counting && q.frame() !== p.mainFrame() && /\/wizard\//.test(q.url())) reqs.push(q.url()); });
  await p.addInitScript(() => {
    try { if (window.top === window) { localStorage.setItem('wos.coached', 'true'); localStorage.removeItem('wos.desks'); localStorage.removeItem('wos.wins'); } } catch (e) {}
    if (window.top !== window) return;
    window.__perf = { gaps: [], long: [], on: false };
    const loop = (() => { let last = 0; const f = t => { if (__perf.on && last) __perf.gaps.push(t - last); last = t; requestAnimationFrame(f); }; return f; })();
    requestAnimationFrame(loop);
    try { new PerformanceObserver(l => { if (__perf.on) for (const e of l.getEntries()) __perf.long.push(e.duration); }).observe({ type: 'longtask', buffered: false }); } catch (e) {}
  });
  await p.goto(URL_, { waitUntil: 'load' });
  await p.waitForTimeout(3000);
  await p.evaluate(() => { const s = window.__wos; s.desks.forEach((d, i) => [...d.wins].forEach(id => s.closeWin(id))); s.goDesk(s.HOME, true); });
  if (withLegacy) {
    // Legacy on the desk to the right of Home, opened the way James does it: from the launcher.
    await p.evaluate(() => { const s = window.__wos; s.goDesk(s.HOME + 1, true); s.openApp(window.WizCore.apps('mobile').APPS.find(a => a.id === 'legacy-wizard')); });
    await p.waitForTimeout(9000); // let the React app boot, load sessions, and settle into its steady state
    await p.evaluate(() => window.__wos.goDesk(window.__wos.HOME, true));
  }
  await p.waitForTimeout(1500);
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  const orb = await p.locator('#orbWrap').boundingBox();
  const cx = orb.x + orb.width / 2, cy = orb.y + orb.height / 2;
  await p.evaluate(() => { __perf.gaps = []; __perf.long = []; __perf.on = true; });
  // Finger-drag swipes: Home → right desk (Legacy) → back, 4 round trips, ~16 ms move cadence like a real touch stream.
  // QA_AWAY=1: swipe Home ↔ the left desk, so Legacy (right of Home) is only ever a painted neighbour, never visited.
  const dirs = process.env.QA_AWAY ? [1, -1] : [-1, 1];
  for (let k = 0; k < 4; k++) for (const dir of dirs) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
    for (let s = 1; s <= 18; s++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx + dir * s * 12, y: cy }] }); await p.waitForTimeout(16); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p.waitForTimeout(700);
  }
  const drag = await p.evaluate(() => { const r = { gaps: __perf.gaps.slice(), long: __perf.long.slice(), idx: __wos.idx }; __perf.gaps = []; __perf.long = []; return r; });
  // Idle on Home for 10 s: what does a background Legacy cost when nothing is moving?
  await p.evaluate(() => window.__wos.goDesk(window.__wos.HOME, true)); await p.waitForTimeout(1500);
  await p.evaluate(() => { __perf.gaps = []; __perf.long = []; }); counting = true;
  await p.waitForTimeout(10000); counting = false; const r0 = reqs.length;
  const idle = await p.evaluate(() => { const r = { gaps: __perf.gaps.slice(), long: __perf.long.slice() }; __perf.on = false; return r; });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  let wake = null;
  if (withLegacy) {
    // Land on Legacy's desk: it must wake (visible) and resume its own refresh within a few seconds.
    const vis = () => p.evaluate(() => document.querySelector('iframe.appframe')?.contentDocument?.visibilityState);
    const parked = await vis();
    reqs.length = 0; counting = true;
    await p.evaluate(() => window.__wos.goDesk(window.__wos.HOME + 1, true)); await p.waitForTimeout(5000); counting = false;
    wake = { parked, awake: await vis(), requests: reqs.length };
  }
  const frames = await p.evaluate(() => [...document.querySelectorAll('iframe.appframe')].map(f => f.src));
  await ctx.close();
  return { drag, idle, frames, idleReqs: r0, wake };
}
const stat = gaps => {
  const s = gaps.slice().sort((a, b) => a - b), n = s.length || 1;
  const jank = gaps.filter(g => g > 34).length, sum = gaps.reduce((a, b) => a + b, 0);
  return { frames: gaps.length, fps: +(gaps.length / (sum / 1000 || 1)).toFixed(1), p50: +(s[Math.floor(n * .5)] || 0).toFixed(1), p95: +(s[Math.floor(n * .95)] || 0).toFixed(1), max: +(s[n - 1] || 0).toFixed(1), janky: jank, jankPct: +(100 * jank / n).toFixed(1) };
};
(async () => {
  const b = await chromium.launch({ args: ['--host-resolver-rules=' + RESOLVE] });
  const out = {};
  for (const withLegacy of [false, true]) {
    const r = await run(b, withLegacy), k = withLegacy ? 'legacy' : 'baseline';
    out[k] = { drag: stat(r.drag.gaps), dragLongTasks: { n: r.drag.long.length, ms: Math.round(r.drag.long.reduce((a, b) => a + b, 0)) },
      idle: stat(r.idle.gaps), idleLongTasks: { n: r.idle.long.length, ms: Math.round(r.idle.long.reduce((a, b) => a + b, 0)) }, frames: r.frames, endDesk: r.drag.idx, idleLegacyRequests: r.idleReqs, wake: r.wake };
    console.log(k, JSON.stringify(out[k]));
  }
  await b.close();
  if (process.env.QA_OUT) fs.writeFileSync(process.env.QA_OUT, JSON.stringify(out, null, 1));
  let fail = 0;
  const ok = (c, n, x = '') => { if (!c) fail++; console.log(c ? 'PASS' : 'FAIL', n, x); };
  ok(out.legacy.frames.some(u => /\/wizard\//.test(u)), 'Legacy Wizard really was open on a desk');
  if (STRICT) {
    ok(out.legacy.wake.parked === 'hidden' && out.legacy.wake.awake === 'visible' && out.legacy.wake.requests >= 1, 'landing on the Legacy desk wakes it and it refreshes', JSON.stringify(out.legacy.wake));
    ok(out.legacy.idleLegacyRequests <= 1, 'Legacy on another desk stops polling', String(out.legacy.idleLegacyRequests));
    ok(out.legacy.idleLongTasks.ms <= out.baseline.idleLongTasks.ms + 600, 'a backgrounded Legacy desk adds little main-thread work at idle', `${out.legacy.idleLongTasks.ms} vs ${out.baseline.idleLongTasks.ms} ms`);
  }
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('Error', e.stack); process.exit(2); });
