// Pending echo (James, 23 Oct 2026: "When I open a thread, I still see my reply as sending at the bottom for a second or
// two, and then it disappears... my message above, then your reply, then my identical message still sending").
// The outbox still holds the send (state sent, or a lost receipt still sending) when the thread reopens; the transcript
// on screen already has it. No pending copy of a message the transcript shows may ever paint, and a message that never
// left the phone always shows, even when it repeats words already in the thread.
// Reads hit the real backend read-only; every write is fulfilled locally; the thread's read is slowed like a phone.
// ID must name a main-agent thread you own; agent and private threads are refused (AGENTS.md: never open them for QA).
// Run: node tools/qa-origin.cjs 9392 web &  then  ID=<main thread> node qa-pending-echo.cjs http://127.0.0.1:9392/wizard-os-home/
const { chromium } = require('./tools/qa-playwright.cjs');
const URL_ = process.argv[2], ID = process.env.ID;
if (!ID || !/^[\w.-]+$/.test(ID)) throw Error('set ID to a main-agent thread id');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block', bypassCSP: true });
  // The thread's message list for an id, defined once in the page (no code built from strings).
  await ctx.addInitScript(() => { window.__qaList = id => { const w = Object.values(__wos.wins).find(x => x.app === 'chats' && x.thread === id); return w && document.querySelector(`[data-chats="${w.id}"] .ch-msgs`); }; });
  const p = await ctx.newPage();
  let slow = 0;
  await p.route('**/*', async r => {
    const q = r.request(); if (!['GET', 'HEAD'].includes(q.method())) return r.fulfill({ status: 200, body: '{}' });
    if (slow && /\/sessions\/[^/]+\/messages/.test(q.url())) await sleep(slow);
    return r.continue();
  });
  await p.goto(URL_, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__wos?.live?.ok && window.WosOutbox, null, { timeout: 90000 }); await sleep(2500);
  const who = await p.evaluate(id => { const s = __wos.live.session(id); return s ? { agent: s.agent || '', priv: !!__wos.live.isPrivate?.(id) } : null; }, ID);
  if (!who) throw Error('thread not in this owner\'s list');
  const main = await p.evaluate(() => window.WosAgents?.defaultId?.() || '');
  if ((who.agent && who.agent !== main) || who.priv) throw Error('refusing an agent thread: QA uses main threads only ' + JSON.stringify({ ...who, main }));
  // First open (warms the on-device cache), read the last message James wrote, leave.
  await p.evaluate(id => __wos.openWizardThread(id), ID);
  await p.waitForFunction(id => __qaList(id)?.querySelector('.msg.u:not(.pending)'), ID, { timeout: 30000 }); await sleep(2500);
  const last = await p.evaluate(async id => { const t = WosChat.parseRows(await __wos.live.messages(id)).filter(x => x.u && x.u.text).pop(); return { text: t.u.text, at: t.u.at, files: (t.u.files || []).filter(f => f.id).map(f => ({ id: f.id, name: f.name || 'file' })) }; }, ID);
  await p.keyboard.press('Escape'); await sleep(800);
  const results = [];
  // expect 'hidden': no pending copy may paint; 'shown': the pending copy paints the whole time.
  const watch = async (name, item, reopenAfter, expect) => {
    await p.evaluate(([id, it]) => { WosOutbox._items.set(it.id, { kind: 'reply', sessionId: id, durable: true, updatedAt: Date.now(), ...it }); }, [ID, { id: 'qa-echo-' + Math.random().toString(36).slice(2, 8), ...item }]);
    await sleep(reopenAfter);
    slow = 1500;
    await p.evaluate(id => __wos.openWizardThread(id), ID);
    let seen = 0, painted = 0;
    for (let t = 0; t < 40; t++) {
      const r = await p.evaluate(id => { const n = __qaList(id); return n ? { u: n.querySelectorAll('.msg.u:not(.pending)').length, pend: n.querySelectorAll('.msg.u.pending').length } : null; }, ID);
      if (r?.u) painted++; if (r?.pend) seen++; await sleep(100);
    }
    slow = 0;
    const ok = expect === 'shown' ? seen === 40 : painted > 0 && seen === 0; results.push(ok);
    console.log(name, JSON.stringify({ ok, expect, framesWithPendingCopy: seen, framesPainted: painted }));
    await p.evaluate(() => { for (const k of [...WosOutbox._items.keys()]) if (k.startsWith('qa-echo-')) WosOutbox._items.delete(k); });
    await p.keyboard.press('Escape'); await sleep(800);
  };
  const sent = { state: 'sent', attempts: 1, sentAt: Date.now() - 50e3, runId: 'qa-run' };
  const lost = { state: 'waiting', attempts: 1, lastAttemptAt: Date.now(), nextAt: Date.now() + 3600e3 };
  await watch('reopen-cached-sent', { ...sent, text: last.text, createdAt: last.at - 1500 }, 0, 'hidden'); // inside the 60 s cache window
  await watch('reopen-after-cache-sent', { ...sent, text: last.text, createdAt: last.at - 1500 }, 16000, 'hidden'); // cached paint, then the slow read
  await watch('reopen-receipt-lost-sending', { ...lost, text: last.text, createdAt: last.at - 1500 }, 0, 'hidden');
  if (last.files.length) await watch('reopen-receipt-lost-files-only', { ...lost, text: '', files: last.files, createdAt: last.at - 1500 }, 0, 'hidden');
  else console.log('reopen-receipt-lost-files-only', JSON.stringify({ skipped: 'last user turn has no files' }));
  await watch('control-unsent-new-message-still-shows', { ...lost, text: 'A brand new message not in the transcript yet ' + Date.now(), createdAt: Date.now() }, 0, 'shown');
  await watch('control-same-words-queued-offline-still-shows', { state: 'queued', attempts: 0, nextAt: Date.now() + 3600e3, text: last.text, createdAt: last.at + 2000 }, 0, 'shown');
  console.log(JSON.stringify({ ID, ok: results.every(Boolean), passed: results.filter(Boolean).length, of: results.length }));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
