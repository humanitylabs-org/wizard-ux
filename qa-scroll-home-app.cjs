// Reading place survives Thread -> Home -> open an app from Home (Claude) -> come back to the thread
// (James, 24 Oct 2026: "opened Opus Token Savings, clicked Home, clicked into Claude to see usage, clicked back to
// the thread, and it jumped to the bottom"). Runs every way back: Back, Back+Back, desk swipe, and re-tapping the row.
// Run: node tools/qa-origin.cjs 9431 web &  then  ID=<long thread> [DOC=1] [APP=wizard-claude] node qa-scroll-home-app.cjs http://127.0.0.1:9431/wizard-os-home/
const { chromium } = require('./tools/qa-playwright.cjs');
const URL_ = process.argv[2], ID = process.env.ID, DOC = process.env.DOC === '1', APP = process.env.APP || 'wizard-claude'; if (!ID) throw Error('set ID');
const ONLY = process.env.ONLY || '';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch();
  const ua = 'Mozilla/5.0 (Linux; Android 15; SM-S938B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36 WizardOS-Android/0.10.9' + (DOC ? ' WizardOS-DocScroll' : '');
  const results = [];
  const ways = ['back', 'desk', 'row', 'home-desk', 'home-row'].filter(w => !ONLY || ONLY.split(',').includes(w));
  for (const way of ways) {
    const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block', bypassCSP: true, userAgent: ua });
    const p = await ctx.newPage();
    await p.route('**/*', r => ['GET', 'HEAD'].includes(r.request().method()) ? r.continue() : r.fulfill({ status: 200, body: '{}' }));
    await p.goto(URL_, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__wos?.live?.ok, null, { timeout: 90000 }); await sleep(2500);
    await p.evaluate(() => { try { localStorage.setItem('wos.tour.done', '1'); } catch (_) {} });
    const nb = `(()=>{const w=Object.values(__wos.wins).find(x=>x.app==='chats'&&x.thread===${JSON.stringify(ID)});return w&&document.querySelector('[data-chats="'+w.id+'"] .ch-msgs');})()`;
    const env = `(()=>{const n=${nb};if(!n||!n.getClientRects().length)return null;const doc=document.documentElement.classList.contains('wos-doc-scroll')&&n.closest('.wos-doc-thread');const sc=doc?document.scrollingElement:n;const top=doc?n.closest('.ch-thread').querySelector('.ch-head').getBoundingClientRect().bottom:n.getBoundingClientRect().top;const bot=doc?n.closest('.ch-thread').querySelector('.ch-compose').getBoundingClientRect().top:n.getBoundingClientRect().bottom;return {n,doc,sc,top,bot,x:n.getBoundingClientRect().left+n.getBoundingClientRect().width/2}})()`;
    const words = `(()=>{const e=${env};if(!e)return {gone:true};let m=null;for(let y=e.top+(e.bot-e.top)/3;!m&&y<e.bot;y+=16){const el=document.elementFromPoint(e.x,y);m=el&&el.closest('.ch-msgs > *');}if(!m)return {miss:true,st:Math.round(e.sc.scrollTop)};const snip=m.innerText.trim().slice(0,240);return {snip:snip.slice(0,50),full:snip,nth:[...e.n.children].filter(x=>x.innerText.trim().slice(0,240)===snip).indexOf(m),off:Math.round(m.getBoundingClientRect().top-e.top),st:Math.round(e.sc.scrollTop),gap:Math.round(e.sc.scrollHeight-e.sc.scrollTop-e.sc.clientHeight),doc:!!e.doc}})()`;
    const wordsAgain = w => p.evaluate(`(()=>{const e=${env};if(!e)return {gone:true};const m=[...e.n.children].filter(x=>x.innerText.trim().slice(0,240)===${JSON.stringify(w.full)})[${w.nth}];return m?{off:Math.round(m.getBoundingClientRect().top-e.top),st:Math.round(e.sc.scrollTop),gap:Math.round(e.sc.scrollHeight-e.sc.scrollTop-e.sc.clientHeight),doc:!!e.doc}:{missing:true,st:Math.round(e.sc.scrollTop),gap:Math.round(e.sc.scrollHeight-e.sc.scrollTop-e.sc.clientHeight)}})()`);
    const touch = fn => p.evaluate(`(()=>{const e=${env};const t=e.n;t.dispatchEvent(new TouchEvent('touchstart',{bubbles:true}));(${fn})(e);(e.doc?document:e.n).dispatchEvent(new Event('scroll'));t.dispatchEvent(new TouchEvent('touchend',{bubbles:true}));})()`);
    await p.evaluate(id => __wos.openWizardThread(id), ID);
    await p.waitForFunction(nb + '?.querySelector(".msg")', null, { timeout: 30000 }); await sleep(4000);
    await touch(`e=>{e.sc.scrollTop=Math.round(e.sc.scrollHeight*0.4)}`); await sleep(1200);
    const w0 = await p.evaluate(words);
    const deskId = await p.evaluate(() => __wos.desks[__wos.idx].id); const deskT = deskId;
    const goThreadDesk = () => p.evaluate(id => __wos.goDesk(__wos.desks.findIndex(d => d.id === id)), deskId);
    await p.evaluate(() => __wos.goDesk(__wos.HOME)); await sleep(1500);
    const opened = await p.evaluate(a => { const o = window.WizOpenApp?.(a); return o ?? 'no-WizOpenApp'; }, APP); await sleep(3000);
    const mid = await p.evaluate(() => ({ idx: __wos.idx, doc: document.documentElement.classList.contains('wos-doc-scroll'), y: Math.round(document.scrollingElement.scrollTop), focus: (()=>{const d=__wos.desks[__wos.idx];const f=__wos.wins[d?.focus];return f&&(f.appId||f.app)})(), desks: __wos.desks.map(d=>({id:d.id,full:d.full,focus:d.focus,wins:d.wins.map(i=>{const w=__wos.wins[i];return i+':'+(w?.appId||w?.app)+(w?.thread?'#'+w.thread.slice(-4):'')})})) }));
    const backs = [];
    const threadFront = `(()=>{const d=__wos.desks[__wos.idx];const f=__wos.wins[d?.focus];return !!(f&&f.app==='chats'&&f.thread===${JSON.stringify(ID)})})()`;
    if (way === 'back') { for (let i = 0; i < 4 && !(await p.evaluate(threadFront)); i++) { await p.evaluate(() => __wos.onBack()); await sleep(1200); backs.push(await p.evaluate(() => ({ idx: __wos.idx, log: (window.__backLog||[]).slice(-1)[0], focus: (()=>{const d=__wos.desks[__wos.idx];const f=__wos.wins[d?.focus];return f&&(f.appId||f.app)})() }))); } }
    if (way === 'desk') await goThreadDesk();
    if (way === 'back' && !(await p.evaluate(threadFront))) { backs.push('fallback-desk'); await goThreadDesk(); }
    if (way === 'row') await p.evaluate(id => __wos.openWizardThread(id), ID);
    // Back out of the app to Home first (the phone's Back from an app at its root lands on Home), then return from Home:
    // the thread's desk is now two swipes away (the app's desk sits between), so it is parked when it comes back.
    if (way.startsWith('home-')) { await p.evaluate(() => __wos.goDesk(__wos.HOME)); await sleep(1500); backs.push(await p.evaluate(id => ({ idx: __wos.idx, parked: document.querySelectorAll('.desk.parked').length }), 0));
      // While you're away the thread keeps repainting: live list polls, another thread's reply, Boomerang pins.
      if (process.env.REPAINT !== '0') { await p.evaluate(() => window.dispatchEvent(new Event('wos:boomerang'))); await sleep(800); await p.evaluate(() => window.dispatchEvent(new Event('wos:boomerang'))); await sleep(800); }
      if (process.env.STRAY === '1') { await p.evaluate(id => { const w = Object.values(__wos.wins).find(x => x.app === 'chats' && x.thread === id); const nb = document.querySelector('[data-chats="' + w.id + '"] .ch-msgs'); nb.dispatchEvent(new Event('scroll')); }, ID); await sleep(600); }
      backs.push(await p.evaluate(id => { const w = Object.values(__wos.wins).find(x => x.app === 'chats' && x.thread === id); const c = __wos.chats.ch(w.id); let rp = null; try { rp = JSON.parse(localStorage.getItem('wizard.mobile.reading-positions.v1') || '{}'); rp = rp[id] || rp.items?.[id] || Object.keys(rp).slice(0,3); } catch (_) {} return { follow: c.follow, posFor: c.posFor === id, rp }; }, ID)); }
    if (way === 'home-desk') await goThreadDesk();
    if (way === 'home-row') await p.evaluate(id => __wos.openWizardThread(id), ID);
    await sleep(3000);
    const w1 = w0.full ? await wordsAgain(w0) : null;
    const ok = !!(w1 && w1.off != null && Math.abs(w0.off - w1.off) <= 8);
    results.push(ok);
    console.log(way, JSON.stringify({ ok, deskT, mid, opened: typeof opened, backs, before: { ...w0, full: undefined }, after: w1 }));
    await ctx.close();
  }
  console.log(JSON.stringify({ ID, doc: DOC, app: APP, ok: results.every(Boolean), results }));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
