// Disposable QA workspace sync is off: background restored apps are tested separately.
// QA: swipe right inside an open chat thread goes back to the list on every skin (one step, never exits, never twice).
// Usage: QA_BASE=http://127.0.0.1:<port> [QA_SHOTS=dir] node qa-thread-swipe-back.cjs
const { chromium } = require('./tools/qa-playwright.cjs');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:9371', SHOTS = process.env.QA_SHOTS || '';
const fails = [], ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails.push(m); };
async function swipe(p, x0, x1, y) {
  const c = p.cdp;
  await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
  for (let i = 1; i <= 10; i++) { await c.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * i / 10, y: y + i }] }); await p.waitForTimeout(16); }
  await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await p.waitForTimeout(700);
}
const where = p => p.evaluate(() => {
  const th = [...document.querySelectorAll('[data-part="thread"]')].find(n => { const r = n.getBoundingClientRect(); return r.width > 0 && r.left >= -5 && r.left < innerWidth / 2; });
  const row = [...document.querySelectorAll('[data-chopen]')].find(n => { const r = n.getBoundingClientRect(); return r.width > 0 && r.left >= -5 && r.left < innerWidth / 2 && r.top < innerHeight; });
  return { thread: !!th, list: !!row, desk: window.__wos?.idx ?? null, backs: (window.__backLog || []).slice(-3), url: location.pathname };
});
(async () => {
  const browser = await chromium.launch();
  for (const skin of ['nebula', 'grove', 'obsidian', 'landscapes']) {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 412, height: 892 }, isMobile: true, hasTouch: true });
    await ctx.addInitScript(s => { if (window !== top) return; try { localStorage.setItem('wos.wsync.off', 'true'); localStorage.setItem('wos.skin', s); localStorage.setItem('wos.tour.done', '1'); localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.rvCoached', 'true'); localStorage.setItem('wos.obsidian.live', 'true'); } catch (_) {} }, skin);
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
    p.cdp = await ctx.newCDPSession(p);
    await p.goto(BASE + '/wizard-os-home/?myskin=off'); await p.waitForSelector('#orbWrap'); await p.waitForTimeout(3000);
    const built = await p.evaluate(() => window.WosSkinHost?.builtinState || []);
    ok(built.includes('core:thread-swipe-back'), `${skin}: swipe-back built-in running (${JSON.stringify(built)})`);
    await p.evaluate(() => window.__wos.openSheet('inbox'));
    // Wait for real sessions, not a fixed delay: the read-only upstream can be
    // slower while another hosted app loads. A timeout still fails below.
    await p.waitForFunction(() => !!document.querySelector('[data-chopen]') || !!window.__wos.live?.sessions?.find(s => !s.archived), null, { timeout: 30000 }).catch(() => {});
    const sid = await p.evaluate(() => document.querySelector('[data-chopen]')?.dataset.chopen || window.__wos.live?.sessions?.find(s => !s.archived)?.id || null);
    if (!sid) { ok(false, `${skin}: found a thread to open`); await ctx.close(); continue; }
    await p.evaluate(id => window.__wos.openWizardThread(id), sid); await p.waitForTimeout(1500);
    const before = await where(p); ok(before.thread, `${skin}: thread open (${sid.slice(0, 12)})`);
    // Vertical-ish drag must not go back.
    await swipe(p, 200, 230, 420); ok((await where(p)).thread, `${skin}: a short drag keeps the thread`);
    // Subtle swipes keep the thread and snap fully back (James, 23 Oct 2026).
    const indent = () => p.evaluate(() => { const th = [...document.querySelectorAll('[data-part="thread"]')].find(n => n.getBoundingClientRect().width > 0); return th ? th.style.transform + '|' + th.style.opacity : 'none'; });
    await swipe(p, 150, 215, 420); ok((await where(p)).thread, `${skin}: a subtle 65px flick keeps the thread`);
    await swipe(p, 150, 250, 420); ok((await where(p)).thread, `${skin}: a 100px drag keeps the thread`);
    // Release in the same frame as the last move, like a real phone: move and release in one task.
    await p.evaluate(async () => {
      const th = [...document.querySelectorAll('[data-part="thread"]')].find(n => n.getBoundingClientRect().width > 0);
      const at = x => { const t = new Touch({ identifier: 41, target: th, clientX: x, clientY: 420 }); return { touches: [t], targetTouches: [t], changedTouches: [t], bubbles: true, cancelable: true }; };
      th.dispatchEvent(new TouchEvent('touchstart', at(150)));
      for (let x = 166; x < 240; x += 16) { th.dispatchEvent(new TouchEvent('touchmove', at(x))); await new Promise(r => setTimeout(r, 40)); }
      th.dispatchEvent(new TouchEvent('touchmove', at(250)));
      const t = new Touch({ identifier: 41, target: th, clientX: 250, clientY: 420 });
      th.dispatchEvent(new TouchEvent('touchend', { touches: [], targetTouches: [], changedTouches: [t], bubbles: true }));
    });
    await p.waitForTimeout(500);
    const left = await indent(); ok(left === '|', `${skin}: a short drag snaps fully back (${left})`);
    await p.evaluate(() => { window.__backLog = []; });
    await swipe(p, 120, 330, 400);
    const after = await where(p);
    ok(!after.thread && after.list && after.desk === before.desk && after.url.includes('/wizard-os-home/'), `${skin}: swipe right from mid-screen goes back to the list (${JSON.stringify(after)})`);
    const steps = await p.evaluate(() => window.__skinBacks || null);
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/swipe-${skin}.png` });
    // Another swipe at the list must not exit.
    await swipe(p, 120, 330, 400); ok(!p.isClosed() && p.url().includes('/wizard-os-home/'), `${skin}: swiping on the list stays in Wizard`);
    ok(!errs.length, `${skin}: no page errors ${errs.join(' | ').slice(0, 200)}`);
    await ctx.close();
  }
  await browser.close();
  console.log(fails.length ? `${fails.length} failed` : 'all passed'); process.exit(fails.length ? 1 : 0);
})();
