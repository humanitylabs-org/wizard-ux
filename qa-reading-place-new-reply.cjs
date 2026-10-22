// Run: node tools/qa-origin.cjs 9733 web &  then  ID=<a finished thread id> node qa-reading-place-new-reply.cjs http://127.0.0.1:9733/wizard-os-home/  (writes are fulfilled locally)
// Repro: a new reply landed while away; the thread's cached paint (old latest reply) must not pin the old place.
const { chromium } = require('./tools/qa-playwright.cjs');
const URL_ = process.argv[2]; const sleep = ms => new Promise(r => setTimeout(r, ms));
const ID = process.env.ID; if (!ID) throw Error('set ID to a finished thread id');
let trunc = true, slow = 0;
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  await p.route('**/*', async r => {
    const q = r.request(); if (!['GET', 'HEAD'].includes(q.method())) return r.fulfill({ status: 200, body: '{}' });
    if (q.url().includes(`/sessions/${ID}/messages`)) {
      const res = await r.fetch(); const j = await res.json(); const k = Array.isArray(j.data) ? 'data' : 'messages';
      if (trunc) { const rows = j[k]; const lastU = rows.map(x => x.role).lastIndexOf('user'); j[k] = rows.slice(0, lastU); }
      if (slow) await sleep(slow);
      return r.fulfill({ response: res, body: JSON.stringify(j) });
    }
    return r.continue();
  });
  await p.goto(URL_, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__wos?.live?.ok, null, { timeout: 90000 }); await sleep(3000);
  const nb = `(()=>{const w=Object.values(__wos.wins).find(x=>x.app==='chats'&&x.thread===${JSON.stringify(ID)});return w&&document.querySelector('[data-chats="'+w.id+'"] .ch-msgs');})()`;
  const open = async () => { await p.evaluate(id => __wos.openWizardThread(id), ID); await p.waitForFunction(nb + '?.querySelector(".msg")', null, { timeout: 30000 }).catch(() => {}); };
  await open(); await sleep(2500);
  await p.evaluate(`(()=>{const n=${nb};n.dispatchEvent(new TouchEvent('touchstart',{bubbles:true}));n.scrollTop=Math.round(n.scrollHeight*0.6);n.dispatchEvent(new Event('scroll'));})()`);
  await sleep(800); await p.keyboard.press('Escape'); await sleep(800);
  await p.evaluate(id => { __wos.live.session(id).messageCount += 4; }, ID);
  trunc = false; slow = 1200; // the new reply is on the server; the history read is slow like a phone
  await open(); await sleep(4500);
  const r = await p.evaluate(`(()=>{const n=${nb};const a=[...n.querySelectorAll('.msg.a')];const last=a.pop();return {replies:a.length+1,lastTop:Math.round(last.getBoundingClientRect().top-n.getBoundingClientRect().top),st:Math.round(n.scrollTop)};})()`);
  console.log(JSON.stringify({ r, ok: r.lastTop >= 0 && r.lastTop < 40 }));
  // And with no new reply: your place holds.
  await p.evaluate(`(()=>{const n=${nb};n.dispatchEvent(new TouchEvent('touchstart',{bubbles:true}));n.scrollTop=Math.round(n.scrollHeight*0.4);n.dispatchEvent(new Event('scroll'));})()`);
  await sleep(800); const mid = await p.evaluate(`Math.round(${nb}.scrollTop)`);
  await p.keyboard.press('Escape'); await sleep(800); await open(); await sleep(4500);
  const back = await p.evaluate(`Math.round(${nb}.scrollTop)`);
  console.log(JSON.stringify({ mid, back, ok: Math.abs(back - mid) < 30 }));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
