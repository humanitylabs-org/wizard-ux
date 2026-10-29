// An app's file picker (or camera) hides the page for a moment; that must never move you off the app's desk
// (James, 26 Oct 2026: "I hit add attachment in Messenger ... it switched my desk and refocused me on the chats
// tab"). Only a desk swipe right before the page hides is undone (the iPhone swipe-home guard).
// Run: node tools/qa-origin.cjs 9431 web &  then  [APP=messenger] node qa-picker-keeps-desk.cjs http://127.0.0.1:9431/wizard-os-home/
const { chromium } = require('./tools/qa-playwright.cjs');
const URL_ = process.argv[2], APP = process.env.APP || 'messenger';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hide = p => p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
const show = p => p.evaluate(() => { delete document.hidden; delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); });
let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else fail++; console.log((c ? 'ok   ' : 'FAIL ') + m); };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block', bypassCSP: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 15; SM-S938B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 WizardOS-Android/0.10.9' });
  const p = await ctx.newPage();
  await p.route('**/*', r => ['GET', 'HEAD'].includes(r.request().method()) ? r.continue() : r.fulfill({ status: 200, body: '{}' }));
  await p.addInitScript(() => { try { localStorage.setItem('wos.tour.done', '1'); } catch (_) {} });
  await p.goto(URL_, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__wos?.live?.ok, null, { timeout: 90000 }); await sleep(2000);
  await p.evaluate(() => __wos.goDesk(__wos.HOME)); await sleep(1800);
  const home = await p.evaluate(() => __wos.desks[__wos.idx].id);
  // Open the app, then at once tap its attach button: the picker hides the page.
  const opened = await p.evaluate(a => window.WizOpenApp?.(a), APP); await sleep(250);
  const appDesk = await p.evaluate(() => __wos.desks[__wos.idx].id);
  ok(opened !== false && appDesk !== home, `${APP} opened on its own desk`);
  await hide(p); await sleep(400); await show(p); await sleep(400);
  ok(await p.evaluate(() => __wos.desks[__wos.idx].id) === appDesk, 'file picker (page hidden right after opening the app) keeps the app desk');
  // A tap/goDesk move straight before hiding is a choice too.
  await p.evaluate(() => __wos.goDesk(__wos.HOME)); await sleep(100);
  await hide(p); await sleep(200); await show(p); await sleep(300);
  ok(await p.evaluate(() => __wos.desks[__wos.idx].id) === home, 'a tapped desk change is kept when the page hides');
  console.log(`${pass} pass, ${fail} fail`); await b.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
