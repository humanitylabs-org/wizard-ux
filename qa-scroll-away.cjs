// Reading place survives leaving the thread for another app/desk and coming back (James, 24 Oct 2026: "I tapped on
// Messenger, went to its login screen, tapped Back, and now I'm at the very top of this thread"), and a scroll up
// is never pulled back to the bottom while something keeps changing the page (James, 24 Oct: "recording a reply
// with the orb, I tried to scroll up and it stuttered, locked to the bottom").
// Run: node tools/qa-origin.cjs 9395 web &  then  ID=<long thread> [DOC=1] node qa-scroll-away.cjs http://127.0.0.1:9395/wizard-os-home/
const { chromium } = require('./tools/qa-playwright.cjs');
const URL_ = process.argv[2], ID = process.env.ID, DOC = process.env.DOC === '1'; if (!ID) throw Error('set ID');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch();
  const ua = 'Mozilla/5.0 (Linux; Android 15; SM-S938B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' + (DOC ? ' WizardOS-DocScroll' : '');
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block', bypassCSP: true, userAgent: ua });
  const p = await ctx.newPage();
  await p.route('**/*', r => ['GET', 'HEAD'].includes(r.request().method()) ? r.continue() : r.fulfill({ status: 200, body: '{}' }));
  await p.goto(URL_, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__wos?.live?.ok, null, { timeout: 90000 }); await sleep(2500);
  const nb = `(()=>{const w=Object.values(__wos.wins).find(x=>x.app==='chats'&&x.thread===${JSON.stringify(ID)});return w&&document.querySelector('[data-chats="'+w.id+'"] .ch-msgs');})()`;
  const env = `(()=>{const n=${nb};const doc=document.documentElement.classList.contains('wos-doc-scroll')&&n.closest('.wos-doc-thread');const sc=doc?document.scrollingElement:n;const top=doc?n.closest('.ch-thread').querySelector('.ch-head').getBoundingClientRect().bottom:n.getBoundingClientRect().top;const bot=doc?n.closest('.ch-thread').querySelector('.ch-compose').getBoundingClientRect().top:n.getBoundingClientRect().bottom;return {n,doc,sc,top,bot,x:n.getBoundingClientRect().left+n.getBoundingClientRect().width/2}})()`;
  const words = `(()=>{const e=${env};let m=null;for(let y=e.top+(e.bot-e.top)/3;!m&&y<e.bot;y+=16){const el=document.elementFromPoint(e.x,y);m=el&&el.closest('.ch-msgs > *');}if(!m)return {miss:true,st:Math.round(e.sc.scrollTop)};const snip=m.innerText.trim().slice(0,240);return {snip:snip.slice(0,60),full:snip,nth:[...e.n.children].filter(x=>x.innerText.trim().slice(0,240)===snip).indexOf(m),off:Math.round(m.getBoundingClientRect().top-e.top),st:Math.round(e.sc.scrollTop),doc:!!e.doc,h:e.sc.scrollHeight}})()`;
  const wordsAgain = w => p.evaluate(`(()=>{const e=${env};const m=[...e.n.children].filter(x=>x.innerText.trim().slice(0,240)===${JSON.stringify(w.full)})[${w.nth}];return m?{off:Math.round(m.getBoundingClientRect().top-e.top),st:Math.round(e.sc.scrollTop),doc:!!e.doc}:null})()`);
  const touch = fn => p.evaluate(`(()=>{const e=${env};const t=e.n;t.dispatchEvent(new TouchEvent('touchstart',{bubbles:true}));(${fn})(e);(e.doc?document:e.n).dispatchEvent(new Event('scroll'));t.dispatchEvent(new TouchEvent('touchend',{bubbles:true}));})()`);
  const park = frac => touch(`e=>{e.sc.scrollTop=Math.round(e.sc.scrollHeight*${frac})}`);
  const results = [];
  const check = async (name, w0) => { const w1 = w0?.full && await wordsAgain(w0); const ok = !!(w1 && Math.abs(w0.off - w1.off) <= 6); results.push(ok); console.log(name, JSON.stringify({ ok, before: { ...w0, full: undefined }, after: w1 })); };
  await p.evaluate(id => __wos.openWizardThread(id), ID);
  await p.waitForFunction(nb + '?.querySelector(".msg")', null, { timeout: 30000 }); await sleep(4000);

  // 1) Open another app (Messenger) on its own desk, then Back.
  await park(0.5); await sleep(900);
  let w0 = await p.evaluate(words);
  const home = await p.evaluate(() => __wos.idx);
  const opened = await p.evaluate(() => window.WizOpenApp?.('messenger') || __wos.openApp?.({ id: 'qa-other', kind: 'wizard', url: '/wizard-os-home/blank.html' }));
  await sleep(2500);
  const away = await p.evaluate(() => ({ doc: document.documentElement.classList.contains('wos-doc-scroll'), y: Math.round(document.scrollingElement.scrollTop) }));
  await p.evaluate(() => __wos.onBack()); await sleep(1500);
  const backed = await p.evaluate(() => __wos.idx);
  if (backed !== home) await p.evaluate(d => __wos.goDesk(d), home); // headless Back may land elsewhere; the phone's Back returns to the thread's desk
  await sleep(2500);
  console.log('away', JSON.stringify({ opened, away, home, backed, log: await p.evaluate(() => __wos.back.log.slice(-3)) }));
  await check('other-app-then-back', w0);

  // 2) Swipe to Home desk and back to the thread's desk.
  await park(0.35); await sleep(900);
  w0 = await p.evaluate(words);
  const desk = await p.evaluate(() => __wos.idx ?? null);
  await p.evaluate(() => __wos.goDesk(__wos.HOME)); await sleep(1500);
  await p.evaluate(d => __wos.goDesk(d), desk); await sleep(2500);
  await check('desk-switch-then-back', w0);

  // 3) Scroll up from the bottom while the page keeps changing every frame (the orb's live recording UI).
  await touch(`e=>{e.sc.scrollTop=e.sc.scrollHeight}`); await sleep(900);
  await p.evaluate(() => { const d = document.createElement('i'); d.id = 'qa-tick'; d.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px'; document.body.appendChild(d); window.__qaTick = setInterval(() => { d.textContent = String(Date.now()); }, 16); });
  const start = await p.evaluate(`${env}.sc.scrollTop`);
  for (let i = 0; i < 20; i++) { await touch(`e=>{e.sc.scrollTop-=15}`); await sleep(32); }
  await sleep(400);
  const end = await p.evaluate(`${env}.sc.scrollTop`);
  await p.evaluate(() => clearInterval(window.__qaTick));
  const moved = Math.round(start - end), ok3 = moved > 200; results.push(ok3);
  console.log('scroll-up-while-page-changes', JSON.stringify({ ok: ok3, start: Math.round(start), end: Math.round(end), moved }));

  console.log(JSON.stringify({ ID, doc: DOC, ok: results.every(Boolean), results }));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
