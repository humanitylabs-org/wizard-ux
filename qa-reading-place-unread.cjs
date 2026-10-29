// Run: node tools/qa-origin.cjs 9733 web &  then  ID=<a finished thread id> node qa-reading-place-unread.cjs http://127.0.0.1:9733/wizard-os-home/  (writes fulfilled locally)
// Unread thread whose saved place is mid-thread for the SAME latest reply: the unread reply must still win.
const { chromium } = require('./tools/qa-playwright.cjs');
const { context, geometry } = require('./tools/qa-thread-place.cjs');
const URL_ = process.argv[2], ID = process.env.ID; const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext(context);
  const p = await ctx.newPage();
  await p.route('**/*', r => (['GET', 'HEAD'].includes(r.request().method()) ? r.continue() : r.fulfill({ status: 200, body: '{}' })));
  await p.goto(URL_, { waitUntil: 'domcontentloaded' }); await p.waitForFunction(() => window.__wos?.live?.ok, null, { timeout: 90000 }); await sleep(3000);
  const nb = `(()=>{const w=Object.values(__wos.wins).sort((a,b)=>Number(__wos.desks[__wos.idx]?.wins.includes(b.id))-Number(__wos.desks[__wos.idx]?.wins.includes(a.id))).find(x=>x.app==='chats'&&x.thread===${JSON.stringify(ID)});return w&&document.querySelector('[data-chats="'+w.id+'"] .ch-msgs');})()`;
  const open = async () => { await p.evaluate(id => __wos.openWizardThread(id), ID); await p.waitForFunction(nb + '?.querySelector(".msg")', null, { timeout: 30000 }).catch(() => {}); await sleep(3000); };
  await open();
  await p.evaluate(`(()=>{const n=${nb};n.dispatchEvent(new TouchEvent('touchstart',{bubbles:true}));(n.closest('.wos-doc-thread') ? document.scrollingElement : n).scrollTop=Math.round((n.closest('.wos-doc-thread') ? document.scrollingElement : n).scrollHeight*0.3);n.dispatchEvent(new Event('scroll'));n.dispatchEvent(new TouchEvent('touchend',{bubbles:true}));})()`);
  await sleep(800); await p.keyboard.press('Escape'); await sleep(800);
  await p.evaluate(id => { const s = __wos.live.session(id); s.lastAssistantAt = new Date().toISOString(); }, ID);
  const unread = await p.evaluate(id => __wos.live.isNew(__wos.live.session(id)), ID);
  await open();
  await p.waitForFunction(nb + '?.querySelector(".msg.a")', null, { timeout: 30000 });
  const r = await p.evaluate(`(()=>{const n=${nb};const last=[...n.querySelectorAll('.msg.a')].pop();return Math.round(last.getBoundingClientRect().top-${geometry(nb)}.top);})()`);
  console.log(JSON.stringify({ unread, lastTop: r, ok: unread && r >= 0 && r < 40 }));
  await b.close();
})();
