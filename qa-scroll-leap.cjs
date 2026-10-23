// Scroll leap (James, 23 Oct 2026, after #387: "sometimes the viewport still leaps to a previous point in the
// conversation when I'm scrolling"). Same events as qa-scroll-jump, measured by the WORDS under the reader's eye line
// (not by the anchor key the fix uses), in both scroll modes: inner list (browsers, older APKs) and document scrolling
// (Android APKs declaring WizardOS-DocScroll, 0.10.6+). Reads hit the real backend read-only; writes are fulfilled locally.
// Run: node tools/qa-origin.cjs 9395 web &  then  ID=<finished thread, 60+ turns> [DOC=1] node qa-scroll-leap.cjs http://127.0.0.1:9395/wizard-os-home/
const { chromium } = require('./tools/qa-playwright.cjs');
const URL_ = process.argv[2], ID = process.env.ID, DOC = process.env.DOC === '1'; if (!ID) throw Error('set ID');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let cut = 0, forceRunning = false;
(async () => {
  const b = await chromium.launch();
  const ua = 'Mozilla/5.0 (Linux; Android 15; SM-S938B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' + (DOC ? ' WizardOS-DocScroll' : '');
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block', bypassCSP: true, userAgent: ua });
  const p = await ctx.newPage();
  await p.route('**/*', async r => {
    const q = r.request(); if (!['GET', 'HEAD'].includes(q.method())) return r.fulfill({ status: 200, body: '{}' });
    if (forceRunning && q.url().includes('/wizard/hermes/api/sessions?')) {
      const res = await r.fetch(); const j = await res.json();
      for (const k of ['data', 'sessions', 'items']) for (const row of j[k] || []) if ([row.id, row.session_id].includes(ID)) row.status = 'running';
      return r.fulfill({ response: res, body: JSON.stringify(j) });
    }
    if (q.url().includes(`/sessions/${ID}/messages`)) {
      const res = await r.fetch(); const j = await res.json(); const k = Array.isArray(j.data) ? 'data' : 'messages';
      for (let n = 0; n < cut; n++) { const rows = j[k]; const lastU = rows.map(x => x.role).lastIndexOf('user'); if (lastU > 0) j[k] = rows.slice(0, lastU); }
      return r.fulfill({ response: res, body: JSON.stringify(j) });
    }
    return r.continue();
  });
  await p.goto(URL_, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__wos?.live?.ok, null, { timeout: 90000 }); await sleep(2500);
  const nb = `(()=>{const w=Object.values(__wos.wins).find(x=>x.app==='chats'&&x.thread===${JSON.stringify(ID)});return w&&document.querySelector('[data-chats="'+w.id+'"] .ch-msgs');})()`;
  // The scroller and the visible band of the list (document mode: below the fixed header, above the composer).
  const env = `(()=>{const n=${nb};const doc=document.documentElement.classList.contains('wos-doc-scroll')&&n.closest('.wos-doc-thread');const sc=doc?document.scrollingElement:n;const top=doc?n.closest('.ch-thread').querySelector('.ch-head').getBoundingClientRect().bottom:n.getBoundingClientRect().top;const bot=doc?n.closest('.ch-thread').querySelector('.ch-compose').getBoundingClientRect().top:n.getBoundingClientRect().bottom;return {n,doc,sc,top,bot,x:n.getBoundingClientRect().left+n.getBoundingClientRect().width/2}})()`;
  const words = `(()=>{const e=${env};const y=e.top+(e.bot-e.top)/3;const el=document.elementFromPoint(e.x,y);const m=el&&el.closest('.ch-msgs > *');if(!m)return {miss:true,st:Math.round(e.sc.scrollTop)};const snip=m.innerText.trim().slice(0,240);return {snip,nth:[...e.n.children].filter(x=>x.innerText.trim().slice(0,240)===snip).indexOf(m),off:Math.round(m.getBoundingClientRect().top-e.top),st:Math.round(e.sc.scrollTop),doc:!!e.doc}})()`;
  const wordsAgain = (snip, nth) => p.evaluate(`(()=>{const e=${env};const m=[...e.n.children].filter(x=>x.innerText.trim().slice(0,240)===${JSON.stringify(snip)})[${nth}];return m?{off:Math.round(m.getBoundingClientRect().top-e.top),st:Math.round(e.sc.scrollTop)}:null})()`);
  const touch = (fn) => p.evaluate(`(()=>{const e=${env};const t=e.n;t.dispatchEvent(new TouchEvent('touchstart',{bubbles:true}));(${fn})(e);(e.doc?document:e.n).dispatchEvent(new Event('scroll'));t.dispatchEvent(new TouchEvent('touchend',{bubbles:true}));})()`);
  const park = frac => touch(`e=>{e.sc.scrollTop=Math.round(e.sc.scrollHeight*${frac})}`);
  const bump = (status, n) => p.evaluate(([id, status, n]) => { const s = __wos.live.session(id); s.status = status; s.messageCount += n; s.lastAssistantAt = new Date().toISOString(); }, [ID, status, n]);
  const waitFor = async (pred, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await p.evaluate(pred)) return true; await sleep(250); } return false; };
  const count = `${nb}.querySelectorAll('.ch-msgs > *').length`;
  const results = [];
  const check = async (name, w0, landed) => { const w1 = w0?.snip && await wordsAgain(w0.snip, w0.nth); const ok = !!(landed && w1 && Math.abs(w0.off - w1.off) <= 4); results.push(ok); console.log(name, JSON.stringify({ ok, landed, before: w0, after: w1 })); };
  const open = async () => { await p.evaluate(id => __wos.openWizardThread(id), ID); await p.waitForFunction(nb + '?.querySelector(".msg")', null, { timeout: 30000 }); await sleep(4000); };
  const leave = async () => { await p.keyboard.press('Escape'); await sleep(900); };

  // 1) A new turn arrives while you read further up.
  cut = 1; await open(); await park(0.5); await sleep(800);
  let c0 = await p.evaluate(count), w0 = await p.evaluate(words);
  cut = 0; await bump('completed', 2);
  await check('new-turn-while-reading', w0, await waitFor(`${count} !== ${c0}`) && (await sleep(1500), true));

  // 2) Working thread: the latest reply lands while you read the earlier part.
  await leave(); cut = 1; await bump('running', 0); await open(); await park(0.4); await sleep(800);
  c0 = await p.evaluate(count); w0 = await p.evaluate(words);
  cut = 0; await bump('completed', 2);
  await check('reply-lands-while-reading', w0, await waitFor(`${count} !== ${c0}`) && (await sleep(1500), true));

  // 3) Reading the latest reply with your own message peeking above; Working catches up to finished.
  await leave(); forceRunning = true; await bump('running', 0); await open();
  await touch(`e=>{const u=[...e.n.querySelectorAll('.msg.u:not(.pending)')].pop();e.sc.scrollTop+=u.getBoundingClientRect().bottom-e.top-20}`); await sleep(800);
  w0 = await p.evaluate(words);
  forceRunning = false; await p.evaluate(id => { const s = __wos.live.session(id); s.status = 'completed'; s.messageCount += 1; }, ID);
  await check('working-catches-up-while-reading', w0, await waitFor(`!${nb}.querySelector('.live')`, 25000) && (await sleep(1500), true));

  // 4) Scrolling up to the top of what is loaded: earlier messages load above (tap or, in document mode, automatically).
  await leave(); await open();
  await touch(`e=>{e.sc.scrollTop=0}`); await sleep(300);
  const more = await p.evaluate(`!!${nb}.querySelector('[data-chearlier]')`);
  w0 = await p.evaluate(words); c0 = await p.evaluate(count);
  if (more && !(await p.evaluate(`${count}`) !== c0)) await p.evaluate(`${nb}.querySelector('[data-chearlier]')?.click()`);
  await check('earlier-messages-load-above', w0, more ? await waitFor(`${count} !== ${c0}`) && (await sleep(800), true) : true);

  // 5) Something above the reader grows by itself, with no repaint: a photo or voice note finishing loading, a work
  //    receipt expanding. Browsers keep the text still on their own (scroll anchoring) unless the page opts out.
  await leave(); await open(); await park(0.5); await sleep(800);
  w0 = await p.evaluate(words);
  const grew = await p.evaluate(`(()=>{const e=${env};const m=[...e.n.querySelectorAll('.msg')].filter(x=>x.getBoundingClientRect().bottom<e.top-50).pop();if(!m)return false;const d=document.createElement('div');d.style.height='420px';m.querySelector('.bub').appendChild(d);return true})()`);
  await sleep(600);
  await check('photo-above-finishes-loading', w0, grew);

  console.log(JSON.stringify({ ID, doc: DOC, ok: results.every(Boolean) }));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
