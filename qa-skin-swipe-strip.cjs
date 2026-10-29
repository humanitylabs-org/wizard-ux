// QA: Miguel's left-swipe strip (Obsidian/Landscapes) uses the shell's one swipe threshold, and the row under the
// right-edge strip never also swipes to Done / actions. Usage: QA_BASE=http://127.0.0.1:<port> node qa-skin-swipe-strip.cjs
const { chromium } = require('./tools/qa-playwright.cjs');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:9381';
const fails = [], ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails.push(m); };
async function swipe(p, x0, x1, y, ms = 300) {
  const c = p.cdp, n = 10;
  await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
  for (let i = 1; i <= n; i++) { await c.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * i / n, y }] }); await p.waitForTimeout(ms / n); }
  await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await p.waitForTimeout(900);
}
const view = p => p.evaluate(() => {
  const th = [...document.querySelectorAll('[data-part="thread"]')].find(n => { const r = n.getBoundingClientRect(); return r.width > 0 && r.left >= -5 && r.left < innerWidth / 2; });
  return { thread: !!th, sheet: !!document.querySelector('.ch-sheet[aria-label="Thread actions"]') };
});
(async () => {
  const browser = await chromium.launch();
  for (const skin of ['obsidian', 'landscapes']) {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 412, height: 892 }, isMobile: true, hasTouch: true });
    await ctx.addInitScript(s => { if (window !== top) return; try { localStorage.setItem('wos.skin', s); localStorage.setItem('wos.tour.done', '1'); localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.rvCoached', 'true'); localStorage.setItem('wos.obsidian.live', 'true'); } catch (_) {} }, skin);
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
    p.cdp = await ctx.newCDPSession(p);
    await p.goto(BASE + '/wizard-os-home/?myskin=off'); await p.waitForSelector('#orbWrap'); await p.waitForTimeout(3000);
    await p.evaluate(() => window.__wos.openSheet('inbox')); await p.waitForTimeout(1500);
    const sid = await p.evaluate(() => document.querySelector('[data-chopen]')?.dataset.chopen);
    if (!sid) { ok(false, `${skin}: a thread to open`); await ctx.close(); continue; }
    await p.evaluate(id => window.__wos.openWizardThread(id), sid); await p.waitForTimeout(1500);
    await swipe(p, 120, 330, 400); // back to the list (remembers the last thread)
    ok(!(await view(p)).thread, `${skin}: on the list`);
    const y = await p.evaluate(() => { const r = document.querySelector('[data-chopen]').getBoundingClientRect(); return r.top + r.height / 2; });
    const rows = () => p.evaluate(() => document.querySelectorAll('[data-chopen]').length);
    const before = await rows();
    await swipe(p, 405, 340, y, 60); ok(!(await view(p)).thread, `${skin}: a subtle 65px edge flick stays on the list`);
    await swipe(p, 405, 305, y, 600); ok(!(await view(p)).thread, `${skin}: a 100px edge drag stays on the list`);
    await swipe(p, 405, 245, y, 400);
    const v = await view(p);
    ok(v.thread, `${skin}: an intentional edge swipe reopens the last thread`);
    ok(!v.sheet, `${skin}: the row under the strip did not open its actions sheet`);
    await p.evaluate(() => window.__wos.openSheet('inbox')); await p.waitForTimeout(600);
    ok((await p.evaluate(() => document.querySelectorAll('[data-chopen]').length)) >= before, `${skin}: no row filed to Done by the strip`);
    ok(!errs.length, `${skin}: no page errors ${errs.join(' | ').slice(0, 200)}`);
    await ctx.close();
  }
  await browser.close();
  console.log(fails.length ? `${fails.length} failed` : 'all passed'); process.exit(fails.length ? 1 : 0);
})();
