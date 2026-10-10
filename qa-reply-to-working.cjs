// QA: a reply moves its thread into Working the instant it is sent, never lingering in Ready.
// James (10 Oct 2026): "after I reply to a thread and it pushes me back out to the main screen, the thread I just
// replied to still appears in my ready list for like a few seconds until it gets processed by the server and then
// it moves into working. Let's move it out of the ready list immediately and into working and it can have some
// status that changes… I don't want to see the thread I just replied to in my feed and then have a UX update."
// The row goes straight to Working with a live status (Sending → Starting → Working), holds there against stale
// list reads until Wizard reports the run, and goes back where it was only if the message truly can't be sent.
// Usage: node qa-reply-to-working.cjs <origin> (e.g. http://127.0.0.1:9381/wizard-os-home/ from tools/qa-origin.cjs).
// Real Wizard reads; every write is intercepted (zero writes reach Wizard).
let chromium; try { ({ chromium } = require('playwright-core')); } catch (e) { ({ chromium } = require('/home/telos/node_modules/playwright')); }
const BASE = process.argv[2] || 'http://127.0.0.1:9381/wizard-os-home/';
const SHOTS = process.env.QA_SHOTS || '';
const fs = require('fs'), path = require('path');
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function boot(b, opt = {}) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true });
  // admit: ms the run admission takes; mode: 'ok' | 'offline' (503) | 'refuse' (400); confirm: { sid, key, status } patched into list reads.
  const R = { admit: opt.admit ?? 2500, mode: opt.mode || 'ok', confirm: null, writes: [] };
  await ctx.route('**/*', async r => {
    const q = r.request(), u = q.url();
    if (q.method() !== 'GET' && /\/wizard\/(hermes|thread-seen|files|thread-dispositions|filings)/.test(u)) {
      R.writes.push({ u: u.replace(/^https?:\/\/[^/]+/, ''), body: q.postData() || '' });
      if (/\/v1\/runs$|\/api\/sessions$|\/steer$/.test(u)) {
        await sleep(R.admit);
        if (R.mode === 'offline') return r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"qa offline"}' }).catch(() => {});
        if (R.mode === 'refuse') return r.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"qa refused"}' }).catch(() => {});
        if (/\/api\/sessions$/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: '{"session":{"id":"qa"}}' }).catch(() => {});
        return r.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ run_id: 'qa-run-1', status: 'queued' }) }).catch(() => {});
      }
      return r.fulfill({ status: 200, contentType: 'application/json', body: '{"accepted":true}' });
    }
    if (q.method() === 'GET' && /\/wizard\/hermes\/api\/sessions\?/.test(u) && R.confirm) {
      const res = await r.fetch(); const j = await res.json();
      for (const s of j.data || j.sessions || []) if (s.id === R.confirm.sid) Object.assign(s, { status: R.confirm.status, wizard_last_run_idempotency_key: R.confirm.key, wizard_run_id: 'qa-run-1' });
      return r.fulfill({ response: res, body: JSON.stringify(j), headers: { ...res.headers(), 'content-type': 'application/json' } });
    }
    return r.continue();
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); } catch (e) {} });
  await p.goto(BASE, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__wos && window.__wos.live && window.__wos.live.ok, null, { timeout: 30000 });
  await p.waitForTimeout(1000);
  return { ctx, p, R, errs };
}
const shot = async (p, n) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, n + '.png') }); } };
const chatsWin = p => p.evaluate(() => { __wos.goDesk(1); return __wos.desks[1].wins.find(x => __wos.wins[x].app === 'chats'); });
// A real thread that is not working: from Ready when there is one, else the next settled section.
const pickSettled = p => p.evaluate(() => {
  const g = __wos.live.workGroups();
  const s = [...g.ready, ...g.yesterday, ...g.pastWeek].find(x => x.status !== 'waiting_for_approval');
  if (!s) return null;
  const sec = Object.keys(g).find(k => g[k].includes(s));
  return { id: s.id, sec, title: s.title };
});
// Where the thread's row is in the list right now: section key + its status line.
const rowAt = (p, wid, sid) => p.evaluate(([w, id]) => {
  const row = document.querySelector(`.win[data-win="${w}"] .ch-list .ch-scroll [data-chopen="${CSS.escape(id)}"]`);
  if (!row) return { sec: null };
  return { sec: row.closest('[data-sec]')?.dataset.sec || null, pv: row.querySelector('.pv')?.textContent || '', top: row.getBoundingClientRect().top };
}, [wid, sid]);
// Records every section the row is painted in from now on (each list repaint is caught).
const watchRow = (p, wid, sid) => p.evaluate(([w, id]) => {
  window.__seenIn = [];
  const root = document.querySelector(`.win[data-win="${w}"]`);
  const look = () => { const row = root.querySelector(`.ch-list .ch-scroll [data-chopen="${CSS.escape(id)}"]`); const sec = row ? row.closest('[data-sec]')?.dataset.sec || '?' : 'none'; if (window.__seenIn[window.__seenIn.length - 1] !== sec) window.__seenIn.push(sec); };
  window.__rowObs?.disconnect(); window.__rowObs = new MutationObserver(look); window.__rowObs.observe(root, { childList: true, subtree: true }); look();
}, [wid, sid]);
async function typeAndSend(p, wid, text) {
  const ta = p.locator(`.win[data-win="${wid}"] textarea`).first();
  await ta.tap(); await ta.fill(text); await p.waitForTimeout(120);
  await p.locator(`.win[data-win="${wid}"] button.ch-send`).first().tap();
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.QA_CHROME });

  // 1. Reply to a settled thread: straight into Working with a changing status; never painted in Ready again.
  {
    const { ctx, p, R, errs } = await boot(b, { admit: 2500 });
    const wid = await chatsWin(p);
    const t = await pickSettled(p);
    ok(!!t, 'a settled real thread exists', JSON.stringify(t));
    await p.evaluate(([w, id]) => __wos.openChat(w, id), [wid, t.id]); await p.waitForTimeout(900);
    await watchRow(p, wid, t.id); // from before the tap: the thread view is open, so the row is not painted ('none')
    await typeAndSend(p, wid, 'QA reply to working');
    await p.waitForTimeout(250);
    await shot(p, '1-instant');
    const a = await rowAt(p, wid, t.id);
    ok(await p.evaluate(w => __wos.wins[w].thread, wid) === null, 'reply: back on the chat list');
    ok(a.sec === 'working', `reply: thread is in Working at once (was in ${t.sec})`, JSON.stringify(a));
    ok(/Sending/.test(a.pv), 'reply: its status reads Sending… while the message leaves the phone', a.pv);
    ok(/QA reply to working/.test(a.pv), 'reply: the row previews what James just said', a.pv);
    const firstWorking = await p.evaluate(w => document.querySelector(`.win[data-win="${w}"] [data-sec="working"] .ch-row`)?.dataset.chopen, wid);
    ok(firstWorking === t.id, 'reply: it is the top row of Working', firstWorking);
    // A stale list read (Wizard hasn't projected the run yet) must not pull it back to Ready.
    await p.evaluate(() => __wos.live.refresh()); await p.waitForTimeout(300);
    ok((await rowAt(p, wid, t.id)).sec === 'working', 'reply: a list read that still says "completed" does not move it back');
    // Admission lands (202 queued) → Starting…
    await p.waitForFunction(() => __wos.outbox.unsent().length === 0, null, { timeout: 8000 }).catch(() => {});
    await p.waitForTimeout(200);
    const b2 = await rowAt(p, wid, t.id);
    ok(b2.sec === 'working' && /Starting/.test(b2.pv), 'reply: once Wizard accepts it the status reads Starting…', JSON.stringify(b2));
    await p.evaluate(() => __wos.live.refresh()); await p.waitForTimeout(400);
    ok((await rowAt(p, wid, t.id)).sec === 'working', 'reply: accepted but not yet listed as running: still Working');
    // Wizard now reports the run → plain Working, overlay released to the server's truth.
    const key = await p.evaluate(id => __wos.outbox.forThread(id).slice(-1)[0]?.id, t.id);
    R.confirm = { sid: t.id, key, status: 'running' };
    await p.evaluate(() => __wos.live.refresh()); await p.waitForTimeout(500);
    const c = await rowAt(p, wid, t.id);
    ok(c.sec === 'working' && /Working/.test(c.pv) && !/Starting|Sending/.test(c.pv), 'reply: Wizard reports the run → status reads Working', JSON.stringify(c));
    ok(await p.evaluate(id => !__wos.live.session(id).pend, t.id), 'reply: the optimistic hold is released once Wizard reports the run');
    await shot(p, '1-working');
    const seen = await p.evaluate(() => window.__seenIn);
    ok(seen.includes('working') && seen.every(s => s === 'working' || s === 'none'), 'reply: from the tap on, the row was only ever painted in Working (never Ready first)', JSON.stringify(seen));
    // The run finishes (same idempotency key, terminal) → it goes to Ready normally.
    R.confirm = { sid: t.id, key, status: 'completed' };
    await p.evaluate(() => __wos.live.refresh()); await p.waitForTimeout(500);
    ok((await rowAt(p, wid, t.id)).sec !== 'working', 'reply: when the run completes it leaves Working as usual');
    ok(R.writes.every(w => !/\/api\/sessions$/.test(w.u)), 'reply: no new thread created');
    ok(errs.length === 0, 'no page errors (reply)', errs.join(' | '));
    await p.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {}); await ctx.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {}); await ctx.close();
  }
  // 2. Offline: stays in Working ("Offline · will retry"), the pill offers Retry; nothing jumps back to Ready.
  {
    const { ctx, p, errs } = await boot(b, { admit: 50, mode: 'offline' });
    const wid = await chatsWin(p);
    const t = await pickSettled(p);
    await p.evaluate(([w, id]) => __wos.openChat(w, id), [wid, t.id]); await p.waitForTimeout(900);
    await typeAndSend(p, wid, 'QA offline reply to working');
    await p.waitForTimeout(1500);
    const a = await rowAt(p, wid, t.id);
    ok(a.sec === 'working' && /Offline/.test(a.pv), 'offline: the thread waits in Working, status Offline · will retry', JSON.stringify(a));
    ok(await p.locator(`.win[data-win="${wid}"] .ch-pill.wait [data-obretry]`).count() === 1, 'offline: the pill offers Retry');
    await shot(p, '2-offline');
    ok(errs.length === 0, 'no page errors (offline)', errs.join(' | '));
    await p.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {}); await ctx.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {}); await ctx.close();
  }
  // 3. Refused (not retryable): the thread goes back where it was; the pill says Not sent with Retry/Edit.
  {
    const { ctx, p, errs } = await boot(b, { admit: 50, mode: 'refuse' });
    const wid = await chatsWin(p);
    const t = await pickSettled(p);
    await p.evaluate(([w, id]) => __wos.openChat(w, id), [wid, t.id]); await p.waitForTimeout(900);
    await typeAndSend(p, wid, 'QA refused reply');
    await p.waitForTimeout(1500);
    const a = await rowAt(p, wid, t.id);
    ok(a.sec === t.sec, `refused: the thread returns to ${t.sec}`, JSON.stringify(a));
    ok(await p.locator(`.win[data-win="${wid}"] .ch-pill.fail [data-obedit]`).count() === 1, 'refused: the pill says Not sent with Edit');
    ok(errs.length === 0, 'no page errors (refused)', errs.join(' | '));
    await p.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {}); await ctx.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {}); await ctx.close();
  }
  // 4. New chat: shows in Working immediately (Sending…), no waiting for Wizard to create the thread.
  {
    const { ctx, p, errs } = await boot(b, { admit: 2500 });
    const wid = await chatsWin(p);
    await p.locator(`.win[data-win="${wid}"] [data-chnew]`).first().tap(); await p.waitForTimeout(600);
    await typeAndSend(p, wid, 'QA brand new chat to working');
    await p.waitForTimeout(300);
    const sid = await p.evaluate(() => __wos.outbox.unsent().find(i => i.kind === 'new')?.sessionId);
    const a = sid ? await rowAt(p, wid, sid) : { sec: null };
    ok(a.sec === 'working' && /Sending/.test(a.pv), 'new chat: in Working at once with Sending…', JSON.stringify(a));
    ok(await p.locator(`.win[data-win="${wid}"] .ch-pill:not(.sent)`).count() === 0, 'new chat: no duplicate Sending pill while its row shows the status');
    await shot(p, '4-new-chat');
    await p.waitForFunction(() => __wos.outbox.unsent().length === 0, null, { timeout: 8000 }).catch(() => {});
    await p.waitForTimeout(300);
    const b2 = await rowAt(p, wid, sid);
    ok(b2.sec === 'working' && /Starting|Working/.test(b2.pv), 'new chat: accepted → still Working, status moves on', JSON.stringify(b2));
    ok(errs.length === 0, 'no page errors (new chat)', errs.join(' | '));
    await p.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {}); await ctx.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {}); await ctx.close();
  }
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
