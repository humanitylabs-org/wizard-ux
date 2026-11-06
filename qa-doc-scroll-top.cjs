// Android 0.9.42+ document-scrolled threads: nothing may scroll into view ABOVE the thread title (James, 23 Oct 2026:
// "the chat is appearing above the title bar"). Checks a long real thread with a simulated native status-bar inset,
// both with the status bar showing and in immersive full screen (status bar hidden, header under the cutout).
// Reads hit the real backend read-only; every write is fulfilled locally.
// Run: node tools/qa-origin.cjs 9391 web &  then  node qa-doc-scroll-top.cjs http://127.0.0.1:9391/wizard-os-home/
const { chromium } = require('./tools/qa-playwright.cjs');
const URL_ = process.argv[2];
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block', bypassCSP: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36 WizardOS-Android/0.10.5 WizardOS-DocScroll' });
  const p = await ctx.newPage();
  await p.route('**/*', r => ['GET', 'HEAD'].includes(r.request().method()) ? r.continue() : r.fulfill({ status: 200, body: '{}' }));
  await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); } catch (e) {} });
  await p.goto(URL_, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__wos?.live?.ok, null, { timeout: 90000 }); await sleep(2500);
  await p.evaluate(() => window.__wosTop(44));
  const ID = process.env.ID; if (!ID) throw Error("set ID to a long thread");
  await p.evaluate(id => __wos.openWizardThread(id), ID);
  await p.waitForFunction(() => document.documentElement.classList.contains('wos-doc-scroll') && document.querySelector('.wos-doc-thread .ch-msgs .msg'), null, { timeout: 30000 });
  await sleep(2500);
  const probe = () => p.evaluate(() => {
    const se = document.scrollingElement; se.scrollTop = Math.round(se.scrollHeight / 2); // mid-thread: messages fill the screen
    const head = document.querySelector('.wos-doc-thread .ch-head'), r = head.getBoundingClientRect();
    // The strip above the title is covered when the header's ::before paints it opaque, edge to edge.
    const bs = getComputedStyle(head, '::before'), bg = bs.backgroundColor;
    const strip = r.top < 1 || (bs.content !== 'none' && Math.abs(parseFloat(bs.height) - r.top) < 1 && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent');
    const covered = strip && (r.top < 1 || getComputedStyle(head).backgroundColor !== 'rgba(0, 0, 0, 0)');
    const cut = parseFloat(getComputedStyle(document.getElementById('device')).getPropertyValue('--cut-t')) || 0;
    return { top: Math.round(r.top), cut, covered, st: se.scrollTop };
  });
  const a = await probe();
  ok(a.top === 44, 'status bar showing: title sits below the 44px status bar', JSON.stringify(a));
  ok(a.covered, 'status bar showing: no message shows above the title', JSON.stringify(a));
  await p.evaluate(() => { const d = document.getElementById('device'); d.classList.add('immersive'); d.style.setProperty('--cut-t', '0px'); });
  await sleep(400);
  const z = await probe();
  ok(z.top === z.cut, 'immersive: title reaches the top of the glass (cutout only)', JSON.stringify(z));
  ok(z.covered, 'immersive: no message shows above the title', JSON.stringify(z));
  await p.screenshot({ path: process.env.SHOT || 'qa-doc-scroll-top.png' });
  console.log(JSON.stringify({ id: ID, pass, fail }));
  await b.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
