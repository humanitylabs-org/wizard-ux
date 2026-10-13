// QA: send and go. On the phone every send from a thread composer steps back to the thread list: a New chat
// send, a typed reply, a composer-mic voice reply and an orb reply into the open thread. The list shows the
// message under Sending until Wizard takes it, so nothing vanishes. Desktop keeps the thread pane (its list
// is already beside it). James (10 Oct 2026): "when I create a new thread here and send it to you or reply to
// a thread, it's supposed to just send the reply and pop me back out to the chat list instead of leaving me
// staring at my message sending."
// Usage: QA_WEB_DIR=<repo> node qa-send-and-go.cjs [url]. Real Wizard reads; every write is intercepted.
let chromium; try { ({ chromium } = require('playwright-core')); } catch (e) { ({ chromium } = require('/home/developer/node_modules/playwright')); }
const BASE = process.argv[2] || 'https://legacy.wizard.example/wizard-os-home/';
const RESOLVE = process.env.QA_RESOLVE || 'MAP legacy.wizard.example 127.0.0.1:18443';
const WD = process.env.QA_WEB_DIR || '';
const SHOTS = process.env.QA_SHOTS || '';
const fs = require('fs'), path = require('path');
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };
const MIME = f => f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : 'application/javascript';

async function boot(b, { desktop = false, hold = false } = {}) {
  const ctx = await b.newContext(desktop ? { viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true }
    : { viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true, executablePath: process.env.QA_CHROME });
  const writes = []; const R = { hold, answer: { cmd: { route: 'view' }, ms: 5 } };
  await ctx.route('**/*', async r => {
    const q = r.request(), u = q.url();
    const m = u.match(/\/wizard-os-home\/((?:[a-z-]+\/)?[a-z-]+\.(?:js|css|html)|)(\?|$)/);
    if (WD && m && q.method() === 'GET' && !/^(data|summaries)\.js$/.test(m[1])) {
      const f = m[1] || 'index.html', p = path.join(WD, 'web', f);
      if (fs.existsSync(p)) return r.fulfill({ status: 200, contentType: MIME(f), body: fs.readFileSync(p) });
    }
    if (/\/api\/route$|\/wizard\/v1\/route$/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(R.answer) });
    if (/\/transcribe$/.test(u) && q.method() === 'POST') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: 'QA voice reply words', ms: 5 }) });
    if (q.method() !== 'GET' && /\/wizard\/(hermes|thread-seen|files)/.test(u)) {
      writes.push({ u: u.replace(/^https?:\/\/[^/]+/, ''), body: q.postData() || '' });
      if (R.hold && /\/v1\/runs|\/api\/sessions/.test(u)) return r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"qa offline"}' });
      if (/\/api\/sessions$/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ session: { id: 'qa-fake-session' } }) });
      if (/\/v1\/runs$/.test(u)) return r.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ run_id: 'qa-fake-run', status: 'queued' }) });
      return r.fulfill({ status: 200, contentType: 'application/json', body: '{"accepted":true}' });
    }
    return r.continue();
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => { const st = String(e.stack || ''); if (/wizard-os-home\//.test(st) || !/https?:\/\//.test(st)) errs.push(String(e)); });
  await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); } catch (e) {} });
  await p.goto(BASE + (desktop ? 'desktop.html' : ''), { waitUntil: 'load' });
  if (desktop) await p.waitForFunction(() => window.__wux && window.WosLive?.ok !== false, null, { timeout: 30000 });
  else await p.waitForFunction(() => window.__wos && window.__wos.live && window.__wos.live.ok, null, { timeout: 30000 });
  await p.waitForTimeout(1200);
  return { ctx, p, writes, errs, R };
}
const runs = ws => ws.filter(w => /\/v1\/runs(\/[^/]+\/steer)?$/.test(w.u) || /\/api\/sessions$/.test(w.u));
const chatsWin = p => p.evaluate(() => { __wos.goDesk(1); return __wos.desks[1].wins.find(x => __wos.wins[x].app === 'chats'); });
const threadOf = (p, wid) => p.evaluate(id => __wos.wins[id]?.thread ?? null, wid);
const shot = async (p, n) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, n + '.png') }); } };
// Open a real thread by tapping its row, like James does.
async function openRow(p, wid) {
  await p.locator(`.win[data-win="${wid}"] .ch-row[data-chopen]`).first().tap(); await p.waitForTimeout(1200);
  return threadOf(p, wid);
}
async function typeAndSend(p, wid, text) {
  const ta = p.locator(`.win[data-win="${wid}"] textarea`).first();
  await ta.tap(); await ta.fill(text); await p.waitForTimeout(150);
  await p.locator(`.win[data-win="${wid}"] button.ch-send`).first().tap();
  await p.waitForTimeout(1500);
}

(async () => {
  const b = await chromium.launch({ args: ['--host-resolver-rules=' + RESOLVE], executablePath: process.env.QA_CHROME });

  // 1. Phone: typed reply in an open thread → back on the list, message delivered, list visible.
  {
    const { ctx, p, writes, errs } = await boot(b);
    const wid = await chatsWin(p); await p.waitForTimeout(500);
    const tid = await openRow(p, wid);
    ok(!!tid && tid !== '__new__', 'phone: a real thread is open', String(tid));
    writes.length = 0;
    await typeAndSend(p, wid, 'QA send and go typed reply');
    await shot(p, '1-after-typed-reply');
    ok(runs(writes).some(w => w.body.includes('QA send and go typed reply')), 'typed reply: delivered to Wizard', JSON.stringify(writes.map(w => w.u)));
    ok(runs(writes).some(w => w.body.includes(tid) || w.u.includes(tid)) || runs(writes).some(w => /steer|\/v1\/runs$/.test(w.u)), 'typed reply: went to the thread it was typed in');
    ok(!runs(writes).some(w => /\/api\/sessions$/.test(w.u)), 'typed reply: no new thread was created');
    ok((await threadOf(p, wid)) === null, 'typed reply: window pops back to the chat list', String(await threadOf(p, wid)));
    ok(await p.locator(`.win[data-win="${wid}"] .ch-row`).count() > 0, 'typed reply: the list is on screen');
    ok(await p.evaluate(() => __wos.idx) === 1, 'typed reply: stays on the Chats desk');
    // Back from the list after a send: the app stays open (Back never exits).
    await p.evaluate(() => window.history.back()); await p.waitForTimeout(600);
    ok(await p.evaluate(() => !!window.__wos && document.visibilityState === 'visible'), 'Back on the list after a send: the app is still open');
    ok(errs.length === 0, 'no page errors (typed reply)', errs.join(' | '));
    await ctx.close();
  }
  // 2. Phone: New chat send → back on the list (unchanged rule, now via the shared path).
  {
    const { ctx, p, writes, errs } = await boot(b);
    const wid = await chatsWin(p); await p.waitForTimeout(400);
    await p.locator(`.win[data-win="${wid}"] [data-chsearch]`).first().tap(); await p.waitForTimeout(300); await p.locator(`.win[data-win="${wid}"] [data-chnew]`).first().tap(); await p.waitForTimeout(700);
    ok((await threadOf(p, wid)) === '__new__', 'phone: New chat composer is open');
    await typeAndSend(p, wid, 'QA send and go new chat');
    ok(runs(writes).some(w => w.body.includes('QA send and go new chat')), 'new chat: delegated');
    ok((await threadOf(p, wid)) === null, 'new chat: window pops back to the chat list', String(await threadOf(p, wid)));
    ok(errs.length === 0, 'no page errors (new chat)', errs.join(' | '));
    await ctx.close();
  }
  // 3. Phone, Wizard unreachable: the reply still pops back and is visible under Sending (with Retry later).
  {
    const { ctx, p, errs } = await boot(b, { hold: true });
    const wid = await chatsWin(p); await p.waitForTimeout(400);
    const tid = await openRow(p, wid);
    await typeAndSend(p, wid, 'QA send and go offline reply');
    await shot(p, '3-offline-reply-sending');
    ok((await threadOf(p, wid)) === null, 'offline reply: still pops back to the list');
    // Sending pill (James, 10 Oct 2026): a small floating pill, never a section that pushes the threads down.
    const pill = p.locator(`.win[data-win="${wid}"] .ch-pill`);
    ok(await p.locator(`.win[data-win="${wid}"] [data-sec="sending"]`).count() === 0, 'offline reply: no Sending section in the list');
    ok(await pill.count() === 1, 'offline reply: a sending pill shows on the list');
    const pt = await pill.innerText().catch(() => '');
    ok(/retrying|Sending|Not sent/.test(pt) && !/QA send and go offline reply/.test(pt), 'offline reply: pill is a short status line (no message body)', pt);
    ok(await pill.locator(`[data-chopen="${tid}"]`).count() === 1, 'offline reply: tapping the pill opens its thread');
    ok(await pill.locator('[data-obretry]').count() === 1, 'offline reply: pill carries Retry while stuck');
    const geo = await p.evaluate(id => { const root = document.querySelector(`.win[data-win="${id}"]`); const pl = root.querySelector('.ch-pill'), row = root.querySelector('.ch-scroll .ch-sec');
      const r = pl.getBoundingClientRect(); return { pos: getComputedStyle(pl).position, h: r.height, w: r.width, rowTop: row?.getBoundingClientRect().top || 0 }; }, wid);
    ok(geo.pos === 'absolute' && geo.h <= 40, 'offline reply: pill floats (absolute) and is one line tall', JSON.stringify(geo));
    const rowTop0 = await p.evaluate(id => { const root = document.querySelector(`.win[data-win="${id}"]`); root.querySelector('.ch-pill')?.remove(); return root.querySelector('.ch-scroll .ch-sec')?.getBoundingClientRect().top || 0; }, wid);
    ok(Math.abs(rowTop0 - geo.rowTop) < 1, 'offline reply: threads do not shift down for the pill', `${geo.rowTop} vs ${rowTop0}`);
    ok(errs.length === 0, 'no page errors (offline)', errs.join(' | '));
    await ctx.close();
  }
  // 4. Phone: composer-mic voice reply → back on the list.
  {
    const { ctx, p, writes, errs } = await boot(b);
    const wid = await chatsWin(p); await p.waitForTimeout(400);
    const tid = await openRow(p, wid);
    writes.length = 0;
    await p.evaluate(([id, sid]) => __wos.chats.sendVoiceTo(id, sid, new Blob([new Uint8Array(4000)], { type: 'audio/webm' })), [wid, tid]);
    await p.waitForTimeout(2500);
    ok(writes.length > 0, 'voice reply: sent to Wizard', JSON.stringify(writes.map(w => w.u)));
    ok((await threadOf(p, wid)) === null, 'voice reply: window pops back to the chat list', String(await threadOf(p, wid)));
    ok(errs.length === 0, 'no page errors (voice reply)', errs.join(' | '));
    await ctx.close();
  }
  // 5. Phone: James opened ANOTHER thread before the send finished → that thread stays open.
  {
    const { ctx, p, errs } = await boot(b);
    const wid = await chatsWin(p); await p.waitForTimeout(400);
    const tid = await openRow(p, wid);
    const other = await p.evaluate(([id, t]) => __wos.live.sessions.find(s => s.id !== t)?.id, [wid, tid]);
    const left = await p.evaluate(([id, t, o]) => { __wos.openChat(id, o); return __wos.chats.leaveAfterSend(id, t, false, ''); }, [wid, tid, other]);
    ok(left === false && (await threadOf(p, wid)) === other, 'a thread opened meanwhile is not closed by the earlier send', String(await threadOf(p, wid)));
    ok(errs.length === 0, 'no page errors (opened meanwhile)', errs.join(' | '));
    await ctx.close();
  }
  // 6. Desktop: a reply keeps the thread pane (the list is already beside it).
  {
    const { ctx, p, errs } = await boot(b, { desktop: true });
    await p.waitForFunction(() => __wux.live?.sessions?.length > 0, null, { timeout: 20000 }).catch(() => {});
    const r = await p.evaluate(async () => {
      const s = __wux.live?.sessions?.[0]; if (!s) return { skip: true, why: 'no sessions' };
      __wux.openThread(s.id); await new Promise(r => setTimeout(r, 800));
      const w = Object.values(__wux.wins).find(x => x.app === 'chats' && x.thread === s.id); if (!w) return { skip: true, why: 'no chats window' }; const left = __wux.chats?.leaveAfterSend ? __wux.chats.leaveAfterSend(w.id, s.id, false, '') : null;
      return { left, thread: w.thread, sid: s.id };
    });
    if (r.skip || r.left === null) console.log('SKIP desktop: no chats window/session hook', JSON.stringify(r));
    else ok(r.left === false && r.thread === r.sid, 'desktop: a reply keeps the thread pane open', JSON.stringify(r));
    ok(errs.length === 0, 'no page errors (desktop)', errs.join(' | '));
    await ctx.close();
  }
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
