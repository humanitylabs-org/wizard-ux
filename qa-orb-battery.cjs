// QA + measurement: the orb's battery cost (James, 10 Oct: Wizard OS 38.5% of a day's battery).
// Boots the real shell (self-contained, every request fulfilled from QA_WEB_DIR/web), counts actual WebGL
// orb draws (gl.drawArrays on the #orb canvas) and reports draws/minute idle, listening, hidden, slept.
// Usage: QA_WEB_DIR=<repo> node qa-orb-battery.cjs   (prints JSON metrics + PASS/FAIL lines)
const { chromium } = require('/home/telos/node_modules/playwright');
const path = require('path'), fs = require('fs');
const W = process.env.QA_WEB_DIR || __dirname;
const SECS = +(process.env.QA_SECS || 10);
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2.625, hasTouch: true, isMobile: true, permissions: ['microphone'] });
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url());
    if (u.hostname !== 'private.wizard001.com') return r.abort();
    const m = u.pathname.match(/^\/wizard-os-home\/(.*)$/);
    if (m && q.method() === 'GET' && !m[1].startsWith('api/')) {
      const f = (m[1] || 'index.html'), p = path.join(W, 'web', f);
      if (!fs.existsSync(p)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      const ct = f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : f.endsWith('.png') ? 'image/png' : 'application/javascript';
      return r.fulfill({ status: 200, contentType: ct, body: fs.readFileSync(p) });
    }
    if (/sessions/.test(u.pathname)) return r.fulfill({ status: 200, contentType: 'application/json', body: '{"sessions":[]}' });
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await ctx.addInitScript(() => {
    window.__orbDraws = 0; window.__hide = false;
    const d = WebGLRenderingContext.prototype.drawArrays;
    WebGLRenderingContext.prototype.drawArrays = function (...a) { if (this.canvas && this.canvas.id === 'orb') window.__orbDraws++; return d.apply(this, a); };
    Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get() { return window.__hide; } });
    Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get() { return window.__hide ? 'hidden' : 'visible'; } });
  });
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(String(e)));
  await pg.goto('https://private.wizard001.com/wizard-os-home/', { waitUntil: 'load' });
  await pg.waitForTimeout(3000);
  const webgl = await pg.evaluate(() => !!(window.Orb && Orb.webgl));
  const rate = async (setup) => {
    await pg.evaluate(setup); await pg.waitForTimeout(2000); // let transitions settle
    const a = await pg.evaluate(() => window.__orbDraws); await pg.waitForTimeout(SECS * 1000);
    const z = await pg.evaluate(() => window.__orbDraws); return Math.round((z - a) * 60 / SECS);
  };
  const raf = await pg.evaluate(() => new Promise(res => { let n = 0; const t = performance.now(); (function f() { n++; if (performance.now() - t < 1000) requestAnimationFrame(f); else res(n); })(); }));
  const m = { webgl, rafHz: raf };
  m.idle = await rate(() => { Orb.setMode('idle'); });
  m.listen = await rate(() => { Orb.setMode('listen'); Orb.setLevel(.4); });
  m.think = await rate(() => { Orb.setLevel(0); Orb.setMode('think'); });
  m.idleAgain = await rate(() => { Orb.setMode('idle'); });
  m.hidden = await rate(() => { window.__hide = true; document.dispatchEvent(new Event('visibilitychange')); });
  m.shown = await rate(() => { window.__hide = false; document.dispatchEvent(new Event('visibilitychange')); });
  m.slept = await rate(() => { Orb.sleep && Orb.sleep(true); });
  m.wokeDraws = await pg.evaluate(async () => { const a = window.__orbDraws; Orb.sleep && Orb.sleep(false); await new Promise(r => setTimeout(r, 1000)); return window.__orbDraws - a; });
  m.wokeRest = await rate(() => {});
  m.canvasPx = await pg.evaluate(() => { const c = document.getElementById('orb'); return [c.width, c.height, c.clientWidth]; });
  m.errors = errs;
  console.log(JSON.stringify(m));
  ok(webgl, 'orb renders with WebGL');
  ok(m.idle <= 15 * 60 && m.idle >= 8 * 60, 'idle orb rests at 8-15 fps', m.idle);
  // Full rate = whatever this GPU sustains (SwiftShader ~20 fps, a phone 60-120): live must clearly out-draw rest.
  ok(m.listen >= Math.min(m.idle * 1.8, 50 * 60), 'listening orb draws at full rate', m.listen + ' vs idle ' + m.idle);
  ok(m.think >= Math.min(m.idle * 1.8, 50 * 60), 'thinking orb draws at full rate', m.think);
  ok(m.idleAgain <= 15 * 60, 'back to resting rate after a take', m.idleAgain);
  ok(m.hidden === 0, 'hidden page: zero orb frames', m.hidden);
  ok(m.shown >= 8 * 60, 'visible again: orb resumes', m.shown);
  ok(m.slept === 0, 'Orb.sleep(true): zero frames', m.slept);
  ok(m.wokeDraws >= 5 && m.wokeRest >= 6 * 60, 'Orb.sleep(false): orb wakes and keeps resting-rate frames', m.wokeDraws + '/' + m.wokeRest);
  ok(m.canvasPx[0] <= m.canvasPx[2] * 2 + 1, 'canvas resolution capped at 2x', JSON.stringify(m.canvasPx));
  ok(errs.length === 0, 'no page errors', errs.join(' | '));
  console.log(`${pass}/${pass + fail} passed`);
  await b.close(); process.exit(fail ? 1 : 0);
})();
