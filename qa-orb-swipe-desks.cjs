// QA: a swipe up on the orb opens Desks when the skin (or My skin) sets --wos-orb-swipe-up: desks, Apps otherwise.
// Usage: QA_BASE=http://127.0.0.1:<port> [QA_SHOTS=dir] node qa-orb-swipe-desks.cjs
const { chromium } = require('./tools/qa-playwright.cjs');
const BASE = process.env.QA_BASE || 'http://127.0.0.1:9371', SHOTS = process.env.QA_SHOTS || '';
const fails = [], ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails.push(m); };
async function swipeUp(p) {
  const c = await p.cdp, b = await p.locator('#orbWrap').boundingBox(); const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 8; i++) { await c.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - i * 22 }] }); await p.waitForTimeout(16); }
  await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await p.waitForTimeout(500);
}
const state = p => p.evaluate(() => ({ desks: !!document.querySelector('#overview.open'), pill: !!document.querySelector('#overview.ov-pill'), apps: document.getElementById('launcher').classList.contains('open') }));
(async () => {
  const browser = await chromium.launch();
  for (const [skin, mine, want] of [['nebula', false, 'apps'], ['nebula', true, 'desks'], ['grove', true, 'desks'], ['obsidian', false, 'pill']]) {
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 412, height: 892 }, isMobile: true, hasTouch: true });
    await ctx.addInitScript(([s, m]) => {
      if (window !== top) return; try { localStorage.setItem('wos.skin', s); localStorage.setItem('wos.tour.done', '1'); localStorage.setItem('wos.coached', 'true'); } catch (_) { return; }
      if (m) addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = 'html[data-skin] { --wos-orb-swipe-up: desks; }'; document.head.appendChild(st); });
    }, [skin, mine]);
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
    p.cdp = ctx.newCDPSession(p);
    await p.goto(BASE + '/'); await p.waitForSelector('#orbWrap'); await p.waitForTimeout(2500);
    await p.evaluate(() => { document.querySelectorAll('.tour, .tour-veil, [data-tour]').forEach(n => n.remove()); });
    await swipeUp(p); const s = await state(p);
    const tag = `${skin}${mine ? ' + My skin var' : ''}`;
    if (want === 'apps') ok(s.apps && !s.desks, `${tag}: swipe up opens Apps (${JSON.stringify(s)})`);
    else if (want === 'desks') ok(s.desks && !s.pill && !s.apps, `${tag}: swipe up opens Desks overview (${JSON.stringify(s)})`);
    else ok(s.desks && s.pill && !s.apps, `${tag}: swipe up opens Miguel's pill Desks (${JSON.stringify(s)})`);
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/${skin}${mine ? '-mine' : ''}.png` });
    if (want !== 'apps') { await p.evaluate(() => window.__wosNativeBack()); await p.waitForTimeout(500); const b = await state(p); ok(!b.desks && p.url().startsWith(BASE) && await p.locator('#orbWrap').count() === 1, `${tag}: Back closes Desks and stays in Wizard (${JSON.stringify(b)} ${await p.evaluate(() => (window.__backLog||[]).join(','))})`); }
    ok(!errs.length, `${tag}: no page errors ${errs.join(' | ').slice(0, 200)}`);
    await ctx.close();
  }
  await browser.close();
  console.log(fails.length ? `${fails.length} failed` : 'all passed'); process.exit(fails.length ? 1 : 0);
})();
