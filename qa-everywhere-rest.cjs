// Everywhere floating-orb page: idle draws vs live draws, before/after. Browser-level (exact asset bytes).
// Usage: node qa-everywhere-rest.cjs <assist dir>
const { chromium } = require('./tools/qa-playwright.cjs');
const path = require('path'), DIR = process.argv[2];
(async () => {
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await (await b.newContext({ viewport: { width: 64, height: 64 }, deviceScaleFactor: 2.6 })).newPage();
  await p.addInitScript(() => { window.__d = 0; const o = WebGLRenderingContext.prototype.drawArrays; WebGLRenderingContext.prototype.drawArrays = function (...a) { if (this.canvas.id === 'orb') window.__d++; return o.apply(this, a); }; });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('file://' + path.join(DIR, 'everywhere.html')); await p.waitForTimeout(3000);
  const rate = async (fn, s = 5) => { await p.evaluate(fn); await p.waitForTimeout(2200); const a = await p.evaluate(() => __d); await p.waitForTimeout(s * 1000); return Math.round((await p.evaluate(() => __d) - a) * 60 / s); };
  const m = { webgl: await p.evaluate(() => Orb.webgl) };
  m.idle = await rate(() => E.state({ mode: 'idle' }));
  m.listen = await rate(() => { E.state({ mode: 'listen' }); E.level(.4); });
  m.idleAgain = await rate(() => E.state({ mode: 'idle' }));
  m.keyboard = await rate(() => E.state({ mode: 'type', kb: true }));
  m.errors = errs; console.log(JSON.stringify(m)); await b.close();
})();
