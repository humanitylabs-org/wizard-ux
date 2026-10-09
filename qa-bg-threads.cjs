// QA: a new thread is delegated in the background. Sending one (orb voice/typed, New chat composer,
// desktop ⌘K "Ask") never opens a Chats window, switches desk/workspace or focuses the new thread.
// James (9 Oct 2026): "when I hit the button and give you a new thread, I do not want you to automatically
// open a chat and go to that thread. Just delegate it in the background."
// Usage: QA_WEB_DIR=<repo> node qa-bg-threads.cjs [url]. Real Wizard reads; every write is intercepted.
const { chromium } = require('/home/telos/node_modules/playwright');
const BASE = process.argv[2] || 'https://private.wizard001.com/wizard-os-home/';
const RESOLVE = process.env.QA_RESOLVE || 'MAP private.wizard001.com 127.0.0.1:18443';
const WD = process.env.QA_WEB_DIR || '';
const fs = require('fs'), path = require('path');
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };
const MIME = f => f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : 'application/javascript';

async function boot(b, { desktop = false } = {}) {
  const ctx = await b.newContext(desktop ? { viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true }
    : { viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true });
  const writes = []; const R = { answer: { cmd: { route: 'agent' }, ms: 5 } };
  await ctx.route('**/*', r => {
    const q = r.request(), u = q.url();
    const m = u.match(/\/wizard-os-home\/((?:[a-z-]+\/)?[a-z-]+\.(?:js|css|html)|)(\?|$)/);
    if (WD && m && q.method() === 'GET' && !/^(data|summaries)\.js$/.test(m[1])) {
      const f = m[1] || 'index.html', p = path.join(WD, 'web', f);
      if (fs.existsSync(p)) return r.fulfill({ status: 200, contentType: MIME(f), body: fs.readFileSync(p) });
    }
    if (/\/api\/route$|\/wizard\/v1\/route$/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(R.answer) });
    if (q.method() !== 'GET' && /\/wizard\/(hermes|thread-seen|files)/.test(u)) {
      writes.push({ u: u.replace(/^https:\/\/[^/]+/, ''), body: q.postData() || '' });
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
const runs = ws => ws.filter(w => /\/v1\/runs$/.test(w.u));
const phoneState = p => p.evaluate(() => ({ idx: __wos.desks.findIndex((d, i) => i === __wos.idx), cur: __wos.idx,
  wins: __wos.desks.map(d => d.wins.map(id => ({ app: __wos.wins[id].app, thread: __wos.wins[id].thread || null }))),
  focus: __wos.desks.map(d => d.focus) }));

(async () => {
  const b = await chromium.launch({ args: ['--host-resolver-rules=' + RESOLVE] });

  // 1. Phone, Home desk: the orb sends a new request → delegated, nothing opens, no desk change.
  {
    const { ctx, p, writes, errs } = await boot(b);
    await p.evaluate(() => { const H = __wos.HOME; __wos.goDesk(H); }); await p.waitForTimeout(500);
    const before = await phoneState(p);
    await p.evaluate(() => __wos.handleText('QA background thread one: research foldable phones', 'auto', false, 0, null));
    await p.waitForTimeout(3500);
    const after = await phoneState(p);
    ok(runs(writes).some(w => w.body.includes('QA background thread one')), 'orb on Home: the new thread is delegated (run admitted)', JSON.stringify(writes.map(w => w.u)));
    ok(after.cur === before.cur, 'orb on Home: stays on the same desk', `${before.cur} → ${after.cur}`);
    ok(JSON.stringify(after.wins) === JSON.stringify(before.wins), 'orb on Home: no Chats window opened, no thread opened', JSON.stringify(after.wins));
    const listed = await p.evaluate(() => __wos.live.sessions.some(s => (s.preview || '').includes('QA background thread one')));
    ok(listed, 'orb on Home: the thread is listed in Wizard (Working) for later');
    ok(errs.length === 0, 'no page errors (orb on Home)', errs.join(' | '));
    await ctx.close();
  }
  // 2. Phone, orb aimed at another desk: no swipe to that desk, nothing opens there.
  {
    const { ctx, p, writes, errs } = await boot(b);
    await p.evaluate(() => __wos.goDesk(__wos.HOME)); await p.waitForTimeout(400);
    const before = await phoneState(p);
    const aim = before.cur === 1 ? 2 : 1;
    await p.evaluate(a => __wos.handleText('QA background thread two aimed at a desk', 'auto', false, 0, a), aim);
    await p.waitForTimeout(3500);
    const after = await phoneState(p);
    ok(runs(writes).some(w => w.body.includes('QA background thread two')), 'aimed orb: delegated');
    ok(after.cur === before.cur && JSON.stringify(after.wins) === JSON.stringify(before.wins), 'aimed orb: no desk switch, no window opened', JSON.stringify([before.cur, after.cur]));
    ok(errs.length === 0, 'no page errors (aimed orb)', errs.join(' | '));
    await ctx.close();
  }
  // 3. Phone, Chats → New chat composer → Send: back on the list, not inside the new thread.
  {
    const { ctx, p, writes, errs } = await boot(b);
    const wid = await p.evaluate(() => { __wos.goDesk(1); const id = __wos.desks[1].wins.find(x => __wos.wins[x].app === 'chats'); __wos.openChat(id, '__new__'); return id; });
    await p.waitForTimeout(500);
    await p.evaluate(id => __wos.sendChat(id, 'QA background thread three from New chat'), wid);
    await p.waitForTimeout(3000);
    const th = await p.evaluate(id => __wos.wins[id]?.thread ?? null, wid);
    ok(runs(writes).some(w => w.body.includes('QA background thread three')), 'New chat send: delegated');
    ok(th === null, 'New chat send: window returns to the thread list (does not open the new thread)', String(th));
    ok(await p.evaluate(() => __wos.idx) === 1, 'New chat send: stays on the Chats desk');
    ok(await p.locator('.ch-row').count() > 0, 'New chat send: the list is on screen');
    // An existing thread reply still stays in the thread (replies are not new threads).
    await p.evaluate(id => __wos.openChat(id, __wos.live.sessions.find(s => !/QA background/.test(s.preview || ''))?.id), wid); await p.waitForTimeout(1200);
    const tid = await p.evaluate(id => __wos.wins[id].thread, wid);
    await p.evaluate(id => __wos.sendChat(id, 'QA reply stays put'), wid); await p.waitForTimeout(1500);
    ok(await p.evaluate(id => __wos.wins[id].thread, wid) === tid && !!tid, 'reply in an open thread: thread stays open', tid);
    ok(errs.length === 0, 'no page errors (New chat)', errs.join(' | '));
    await ctx.close();
  }
  // 4. Desktop shell: ⌘K "Ask Archimedes" → delegated, focus and windows unchanged.
  {
    const { ctx, p, writes, errs } = await boot(b, { desktop: true });
    const snap = () => p.evaluate(() => JSON.stringify({ wins: Object.values(__wux.wins).map(w => [w.app, w.thread || null]), focus: document.querySelector('.win.focus')?.dataset.win || '' }));
    const before = await snap();
    await p.evaluate(() => __wux.ask ? __wux.ask('QA background thread four from desktop') : null);
    await p.waitForTimeout(3000);
    ok(runs(writes).some(w => w.body.includes('QA background thread four')), 'desktop ask: delegated', JSON.stringify(writes.map(w => w.u)));
    ok(await snap() === before, 'desktop ask: no window opened, focus unchanged', `${before} → ${await snap()}`);
    ok(errs.length === 0, 'no page errors (desktop)', errs.join(' | '));
    await ctx.close();
  }
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
