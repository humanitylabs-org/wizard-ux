// Pending echo (James, 23 Oct 2026: "When I open a thread, I still see my reply as sending at the bottom for a second or
// two, and then it disappears... my message above, then your reply, then my identical message still sending").
// The outbox still holds the send (state sent, or a lost receipt still sending) when the thread reopens; the transcript
// on screen already has it. No pending copy of a message the transcript shows may ever paint.
// Reads hit the real backend read-only; every write is fulfilled locally; the thread's read is slowed like a phone.
// Run: node tools/qa-origin.cjs 9392 web &  then  node qa-pending-echo.cjs http://127.0.0.1:9392/wizard-os-home/  [ID=<thread>]
const { chromium } = require('./tools/qa-playwright.cjs');
const URL_ = process.argv[2];
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block', bypassCSP: true });
  const p = await ctx.newPage();
  let slow = 0;
  await p.route('**/*', async r => {
    const q = r.request(); if (!['GET', 'HEAD'].includes(q.method())) return r.fulfill({ status: 200, body: '{}' });
    if (slow && /\/sessions\/[^/]+\/messages/.test(q.url())) await sleep(slow);
    return r.continue();
  });
  await p.goto(URL_, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__wos?.live?.ok && window.WosOutbox, null, { timeout: 90000 }); await sleep(2500);
  const ID = process.env.ID || await p.evaluate(() => (__wos.live.sessions || []).find(s => !['running', 'queued', 'submitting'].includes(s.status) && s.messageCount > 6 && !s.archived)?.id);
  if (!ID) throw Error('no thread');
  const nb = `(()=>{const w=Object.values(__wos.wins).find(x=>x.app==='chats'&&x.thread===${JSON.stringify(ID)});return w&&document.querySelector('[data-chats="'+w.id+'"] .ch-msgs');})()`;
  // First open (warms the on-device cache), read the last message James wrote, leave.
  await p.evaluate(id => __wos.openWizardThread(id), ID);
  await p.waitForFunction(nb + '?.querySelector(".msg.u:not(.pending)")', null, { timeout: 30000 }); await sleep(2500);
  const [lastU, uAt] = await p.evaluate(async id => { const t = WosChat.parseRows(await __wos.live.messages(id)).filter(x => x.u && x.u.text).pop(); return [t.u.text, t.u.at]; }, ID);
  await p.keyboard.press('Escape'); await sleep(800);
  const results = [];
  const watch = async (name, state, reopenAfter, fresh) => {
    // Seed the outbox exactly as a send leaves it: the same words, sent a moment ago (or still sending: receipt lost).
    await p.evaluate(([id, text, state, at]) => {
      const it = { id: 'qa-echo-' + state + Math.random().toString(36).slice(2, 6), kind: 'reply', sessionId: id, text, state, createdAt: at - 1500, updatedAt: Date.now(), durable: true, attempts: state === 'sent' ? 1 : 0, ...(state === 'sent' ? { sentAt: Date.now() - 50e3, runId: 'qa-run' } : { nextAt: Date.now() + 3600e3 }) };
      WosOutbox._items.set(it.id, it);
    }, [ID, fresh ? 'A brand new message not in the transcript yet ' + Date.now() : lastU, state, fresh ? Date.now() : uAt]);
    await sleep(reopenAfter);
    slow = 1500;
    await p.evaluate(id => __wos.openWizardThread(id), ID);
    let seen = 0, painted = 0;
    for (let t = 0; t < 40; t++) { const r = await p.evaluate(`(()=>{const n=${nb};return n?{u:n.querySelectorAll('.msg.u:not(.pending)').length,pend:n.querySelectorAll('.msg.u.pending').length}:null})()`); if (r?.u) painted++; if (r?.pend) seen++; await sleep(100); }
    slow = 0;
    if (process.env.DBG) console.log(await p.evaluate(`(()=>{const n=${nb};return [...n.querySelectorAll('.msg.u')].slice(-3).map(m=>m.className+' | '+m.innerText.slice(0,80))})()`), JSON.stringify(lastU.slice(0,80)), uAt);
    const ok = fresh ? seen === 40 : painted > 0 && seen === 0; results.push(ok);
    console.log(name, JSON.stringify({ ok, framesWithPendingCopy: seen, framesPainted: painted }));
    await p.evaluate(() => { for (const k of [...WosOutbox._items.keys()]) if (k.startsWith('qa-echo-')) WosOutbox._items.delete(k); });
    await p.keyboard.press('Escape'); await sleep(800);
  };
  await watch('reopen-cached-sent', 'sent', 0); // inside the 60 s cache window (no server read)
  await watch('reopen-after-cache-sent', 'sent', 16000); // the cache window lapsed: cached paint, then the slow read
  await watch('reopen-receipt-lost-sending', 'waiting', 0);
  await watch('control-unsent-new-message-still-shows', 'waiting', 0, true);
  console.log(JSON.stringify({ ID, ok: results.every(Boolean) }));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
