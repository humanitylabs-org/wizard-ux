// Scroll-jump repro (James, 23 Oct 2026: "I'm scrolling down reading a message and it jumps to a previous place").
// The reader is parked mid-thread; live updates land (a new turn arrives, the latest reply lands while Working).
// The words under the reader's eyes must not move. Reads hit the real backend read-only; every write is fulfilled locally.
// Run: node tools/qa-origin.cjs 9391 web &  then  ID=<finished thread with 60+ turns> node qa-scroll-jump.cjs http://127.0.0.1:9391/wizard-os-home/
const { chromium } = require('./tools/qa-playwright.cjs');
const URL_ = process.argv[2], ID = process.env.ID; if (!ID) throw Error('set ID');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let cut = 0; // drop this many turns from the end of the thread's history
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block', bypassCSP: true });
  const p = await ctx.newPage();
  await p.route('**/*', async r => {
    const q = r.request(); if (!['GET', 'HEAD'].includes(q.method())) return r.fulfill({ status: 200, body: '{}' });
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
  // The words at the reader's eye line (a third of the way down the list): which message and how far it sits from the top.
  const eye = `(()=>{const n=${nb};const r=n.getBoundingClientRect();const y=r.top+r.height/3;const m=[...n.querySelectorAll('[data-morph-key]')].find(e=>{const b=e.getBoundingClientRect();return b.top<=y&&b.bottom>y});return m?{key:m.dataset.morphKey,off:Math.round(m.getBoundingClientRect().top-r.top),st:Math.round(n.scrollTop),gap:Math.round(n.scrollHeight-n.scrollTop-n.clientHeight),turns:n.querySelectorAll('.msg.u').length}:{st:Math.round(n.scrollTop)}})()`;
  const park = frac => p.evaluate(`(()=>{const n=${nb};n.dispatchEvent(new TouchEvent('touchstart',{bubbles:true}));n.scrollTop=Math.round(n.scrollHeight*${frac});n.dispatchEvent(new Event('scroll'));n.dispatchEvent(new TouchEvent('touchend',{bubbles:true}));})()`);
  const bump = (status, n) => p.evaluate(([id, status, n]) => { const s = __wos.live.session(id); s.status = status; s.messageCount += n; s.lastAssistantAt = new Date().toISOString(); }, [ID, status, n]);
  const waitFor = async (pred, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await p.evaluate(pred)) return true; await sleep(250); } return false; };
  const results = [];
  const check = (name, a, z, landed) => { const ok = landed && a.key === z.key && Math.abs(a.off - z.off) <= 4; results.push(ok); console.log(name, JSON.stringify({ ok, landed, before: a, after: z })); };

  // 1) A new turn arrives (you or a steer sent one, a report landed) while you read further up a long thread.
  cut = 1; await p.evaluate(id => __wos.openWizardThread(id), ID);
  await p.waitForFunction(nb + '?.querySelector(".msg")', null, { timeout: 30000 }); await sleep(3500);
  await park(0.5); await sleep(800);
  const n0 = await p.evaluate(`${nb}.querySelectorAll('[data-morph-key]').length`);
  let a = await p.evaluate(eye);
  cut = 0; await bump('completed', 2);
  let landed = await waitFor(`(${nb}).querySelectorAll('.msg.u').length !== ${a.turns} || (${nb}).querySelectorAll('[data-morph-key]').length !== ${n0}`);
  await sleep(1500);
  check('new-turn-while-reading', a, await p.evaluate(eye), landed);

  // 2) Working thread: the latest reply lands while you read the earlier part of the thread.
  await p.keyboard.press('Escape'); await sleep(800);
  cut = 1; await bump('running', 0);
  await p.evaluate(id => __wos.openWizardThread(id), ID); await sleep(4000);
  await park(0.4); await sleep(800);
  a = await p.evaluate(eye);
  const m1 = await p.evaluate(`${nb}.querySelectorAll('[data-morph-key]').length`);
  cut = 0; await bump('completed', 2);
  landed = await waitFor(`(${nb}).querySelectorAll('[data-morph-key]').length !== ${m1}`);
  await sleep(1500);
  check('reply-lands-while-reading', a, await p.evaluate(eye), landed);

  console.log(JSON.stringify({ ok: results.every(Boolean) }));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
