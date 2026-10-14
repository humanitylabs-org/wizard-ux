// Live-integration QA for Wizard OS Home, run against the real private origin.
// Safe by construction: blocks every Hermes write (no messages are sent), and the
// read-state test only touches one thread that the test itself makes look unread.
const { chromium } = require('/home/telos/node_modules/playwright');
const fs = require('fs');
const BASE = 'https://wizard.tailc0f369.ts.net';
const OUT = process.env.QA_OUT || __dirname + '/qa-live';
fs.mkdirSync(OUT, { recursive: true });
const TARGET = process.env.QA_THREAD || 'wizard-assistant-8a389cba6c4f4736e0dc6bbcd752aa75';
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

(async () => {
  const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP wizard.tailc0f369.ts.net 127.0.0.1:18443', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const writes = [];
  await ctx.route('**/*', async route => {
    const r = route.request(), u = new URL(r.url()), m = r.method();
    if (m !== 'GET' && m !== 'HEAD') {
      // Allow only the read-state PUT; everything else that writes is blocked.
      if (u.pathname === '/wizard/thread-seen' && m === 'PUT') { writes.push('PUT thread-seen'); return route.continue(); }
      writes.push(`${m} ${u.pathname}`); return route.abort();
    }
    return route.continue();
  });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(id => {
    try { localStorage.setItem('wos.coached', 'true'); } catch (e) {}
    // Make exactly one thread look unread for this test (shell page only, not the Wizard frame).
    if (location.pathname.startsWith('/wizard-os-home')) {
      try { const k = 'wizard.thread-seen.v1:wizard-account-local'; const v = JSON.parse(localStorage.getItem(k) || 'null'); if (v?.threads) { delete v.threads['direct:' + id]; localStorage.setItem(k, JSON.stringify(v)); } } catch (e) {}
      const f = window.fetch;
      window.fetch = async (u, init) => {
        const r = await f(u, init);
        if (String(u).endsWith('/wizard/thread-seen') && (!init || !init.method || init.method === 'GET')) {
          const j = await r.clone().json(); if (j.state?.threads) delete j.state.threads['direct:' + id];
          return new Response(JSON.stringify(j), { status: r.status, headers: { 'Content-Type': 'application/json' } });
        }
        return r;
      };
    }
  }, TARGET);
  await page.goto(BASE + '/wizard-os-home/');
  await page.waitForFunction(() => window.__wos?.live?.ok, null, { timeout: 30000 }).catch(() => {});
  const st = await page.evaluate(() => { const L = window.__wos.live, g = L.groups(); return { ok: L.ok, err: L.error, n: L.sessions.length, needs: g.needs.length, ready: g.ready.length, working: g.working.length, readyIds: g.ready.map(s => s.id), workingIds: g.working.map(s => s.id) }; });
  check('live sessions load from Wizard', st.ok && st.n > 20, `sessions=${st.n} err=${st.err}`);
  check('this thread shows as working or unread', st.readyIds.includes(TARGET) || st.workingIds.includes(TARGET), `ready=${st.ready} working=${st.working} needs=${st.needs}`);
  await page.screenshot({ path: OUT + '/20-home-live.png' });

  // Chats is an ordinary window (desk 2 on first run), a native client on the Wizard API.
  const cw = await page.evaluate(() => { const s = window.__wos; for (let i = 0; i < 5; i++) { const id = s.desks[i].wins.find(x => s.wins[x].app === 'chats'); if (id) return { i, id }; } return null; });
  check('Chats is a window on a desk (not pinned)', !!cw && cw.i === 1, JSON.stringify(cw));
  await page.evaluate(i => window.__wos.goDesk(i), cw.i); await page.waitForTimeout(800);
  const rows = await page.locator('.desk[data-desk="1"] .ch-row').count();
  check('Chats lists live Wizard threads', rows > 20, 'rows=' + rows);
  check('no bottom tabs, no second orb in Chats', await page.locator('.desk[data-desk="1"] .win.app-chats nav, .desk[data-desk="1"] .win.app-chats .orb').count() === 0);
  await page.screenshot({ path: OUT + '/21-chats-window.png' });

  // Swipe down: live inbox.
  await page.evaluate(() => window.__wos.goDesk(2)); await page.waitForTimeout(600);
  await page.evaluate(() => window.__wos.openSheet('inbox')); await page.waitForTimeout(700);
  const hasNote = await page.locator(`#inboxBody .note[data-note="${TARGET}"]`).count();
  check('inbox lists the unread/working thread', hasNote === 1);
  await page.screenshot({ path: OUT + '/22-inbox-live.png' });

  // Tap it: opens in the Chats window, and the read clears it everywhere.
  await page.locator(`#inboxBody .note[data-note="${TARGET}"]`).click(); await page.waitForTimeout(1500);
  const opened = await page.evaluate(id => { const s = window.__wos; const w = Object.values(s.wins).find(x => x.app === 'chats'); return { idx: s.idx, thread: w?.thread, desk: s.desks.findIndex(d => d.wins.includes(w?.id)) }; }, TARGET);
  check('tap opens the thread in the Chats window and goes there', opened.thread === TARGET && opened.idx === opened.desk, JSON.stringify(opened));
  const msgs = await page.locator('.win.app-chats .msg').count();
  check('the thread itself renders natively', msgs > 0, 'msgs=' + msgs);
  const after = await page.evaluate(id => { const g = window.__wos.live.groups(); return { ready: g.ready.some(s => s.id === id) }; }, TARGET);
  check('read thread leaves the Unread list', !after.ready);
  // Same key Wizard itself writes: proves the shared contract, not a local flag.
  const seenRec = await page.evaluate(id => { const s = JSON.parse(localStorage.getItem('wizard.thread-seen.v1:wizard-account-local') || '{}'); return s.threads?.[`direct:${id}`] || null; }, TARGET);
  check('Wizard read-state record written', !!seenRec, JSON.stringify(seenRec || {}).slice(0, 120));
  await page.waitForTimeout(1500);
  check('read state synced to the server (PUT)', writes.includes('PUT thread-seen'), writes.join(', '));
  await page.screenshot({ path: OUT + '/23-thread-in-chats.png' });

  // Reverse direction: a read made in the real Wizard app (other tab, same origin)
  // must clear the shell. Re-open only an ALREADY-read thread, so QA never consumes a real unread.
  const other = await page.evaluate(id => { const L = window.__wos.live; return L.sessions.find(s => s.id !== id && !s.hidden && !s.archived && !L.isNew(s) && !['running','queued','submitting'].includes(s.status))?.id || ''; }, TARGET);
  const p2 = await ctx.newPage();
  const before = Date.now();
  await p2.goto(BASE + '/wizard/?session=' + encodeURIComponent(other)); await p2.waitForTimeout(4000);
  await page.waitForTimeout(1500);
  const rec = await page.evaluate(id => window.__wos.live.seen?.threads?.['direct:' + id] || null, other);
  check('a read in the Wizard app reaches the shell (shared store)', !!rec && rec.seenAt >= before - 1000, `seenAt=${rec?.seenAt} start=${before}`);
  await p2.close();

  // Voice while a thread is in front: the shell knows the view.
  const vc = await page.evaluate(() => window.__wos.viewContext());
  check('orb knows the window in front', /Window in front: .*thread/i.test(vc), vc.slice(0, 160));

  check('no Hermes writes besides read state', writes.every(w => w === 'PUT thread-seen'), writes.join(', '));
  check('no page errors', errors.length === 0, errors.join(' | '));
  console.log(`${pass}/${pass + fail} passed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
