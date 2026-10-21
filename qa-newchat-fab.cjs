// QA: New chat button bottom-right of the Chats list (feature/newchat-fab).
//  1 visible bottom-right, inside the list, never under the orb (phone windowed + full-screen corner orb)
//  2 tap opens the New chat composer; typing works
//  3 Back returns to the Chats list and the app stays open
//  4 desktop shell shows it too
// Every non-GET request is refused; nothing reaches Wizard.
// Usage: node tools/qa-origin.cjs 9381 <worktree>/web (background), then node qa-newchat-fab.cjs [url]
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs');
const URL_ = process.argv[2] || 'http://127.0.0.1:9381/wizard-os-home/';
const OUT = process.env.QA_OUT || require('./tools/qa-paths.cjs').workPath('wizard-audit/shots/newchat-fab');
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, JSON.stringify(x).slice(0, 400)); } };
const box = (p, sel) => p.evaluate(s => { const e = [...document.querySelectorAll(s)].find(e => { const b = e.getBoundingClientRect(); return b.width && b.left >= -2 && b.right <= innerWidth + 2; }); if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; }, sel);
const overlap = (a, b) => a && b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
(async () => {
  const br = await chromium.launch({ executablePath: (process.env.QA_CHROME || undefined) });
  const mk = async (vp, mobile) => { const ctx = await br.newContext({ viewport: vp, hasTouch: mobile, isMobile: mobile, deviceScaleFactor: 2 });
    await ctx.route('**/*', r => { const m = r.request().method(); return m !== 'GET' && m !== 'HEAD' ? r.fulfill({ status: 403, body: 'qa' }) : r.continue(); });
    const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => { if (!/localStorage/.test(e.message)) p.errs.push(e.message); }); return p; };
  // ---- phone, windowed
  const p = await mk({ width: 412, height: 892 }, true);
  await p.goto(URL_ + '?open=chats'); await p.waitForTimeout(3500);
  const fab = await box(p, '[data-chfab]'), win = await box(p, '.win:has(.ch-list)'), orb = await box(p, '.dock');
  ok(fab && fab.w >= 44, 'phone: New chat button present and thumb-sized', fab);
  ok(fab && win && fab.r <= win.r - 8 && fab.r >= win.r - 30 && fab.b <= win.b - 8 && fab.b >= win.b - 30, 'phone: sits bottom-right of the Chats window', { fab, win });
  ok(!overlap(fab, orb), 'phone: clear of the orb', { fab, orb });
  await p.screenshot({ path: OUT + '/phone-list.png' });
  await p.tap('[data-chfab]'); await p.waitForTimeout(700);
  ok(!!(await box(p, '.ch-compose textarea')), 'phone: tap opens the New chat composer');
  await p.fill('.ch-compose textarea', 'hello from the new button');
  ok(await p.inputValue('.ch-compose textarea') === 'hello from the new button', 'phone: can type in the new chat');
  await p.screenshot({ path: OUT + '/phone-new.png' });
  await p.goBack().catch(() => {}); await p.waitForTimeout(800);
  ok(!!(await box(p, '[data-chfab]')) && !(await box(p, '.ch-compose textarea')), 'phone: Back returns to the Chats list, app still open');
  // ---- phone, full screen: orb moves into the corner
  const fullBtn = await p.evaluate(() => { const b = [...document.querySelectorAll('.win:has(.ch-list) .win-head button, .win:has(.ch-list) button')].find(e => /full|expand|maxim/i.test((e.getAttribute('aria-label') || '') + (e.title || '') + (e.className || ''))); if (b) { b.click(); return (b.getAttribute('aria-label') || b.className); } return ''; });
  await p.waitForTimeout(900);
  const corner = await p.evaluate(() => document.querySelector('.device')?.classList.contains('orb-corner'));
  const fab2 = await box(p, '[data-chfab]'), orb2 = await box(p, '.dock');
  ok(corner, 'phone full-screen: orb in the corner', { corner, fullBtn });
  ok(fab2 && orb2 && !overlap(fab2, orb2) && fab2.b <= orb2.t, 'phone full-screen: button stacked above the corner orb', { fab2, orb2 });
  await p.screenshot({ path: OUT + '/phone-full.png' });
  ok(!p.errs.length, 'phone: no page errors', p.errs);
  // ---- desktop
  const d = await mk({ width: 1440, height: 900 }, false);
  await d.goto(URL_.replace(/\/$/, '/') + 'desktop.html'); await d.waitForTimeout(3500);
  const dfab = await box(d, '[data-chfab]');
  ok(!!dfab, 'desktop: New chat button present', dfab);
  if (dfab) { await d.click('[data-chfab]'); await d.waitForTimeout(700); ok(!!(await box(d, '.ch-compose textarea')), 'desktop: opens New chat composer'); }
  await d.screenshot({ path: OUT + '/desktop.png' });
  ok(!d.errs.length, 'desktop: no page errors', d.errs);
  console.log(`\n${pass} passed, ${fail} failed · shots ${OUT}`);
  await br.close(); process.exit(fail ? 1 : 0);
})();
