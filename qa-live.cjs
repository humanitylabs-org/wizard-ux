// Live-integration QA for Wizard OS Home, run against the real private origin.
// Safe by construction: blocks every Hermes write (no messages are sent), and the
// read-state test only touches one thread that the test itself makes look unread.
const { chromium } = require('/home/telos/node_modules/playwright');
const fs = require('fs');
const BASE = 'https://private.wizard001.com';
const OUT = process.env.QA_OUT || __dirname + '/qa-live';
fs.mkdirSync(OUT, { recursive: true });
const TARGET = process.env.QA_THREAD || 'wizard-assistant-8a389cba6c4f4736e0dc6bbcd752aa75';
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

(async () => {
  const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP private.wizard001.com 127.0.0.1:18443', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
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

  // Desk 1 is the pinned Wizard chat list, running live.
  await page.evaluate(() => window.__wos.goDesk(0)); await page.waitForTimeout(800);
  const d0 = await page.evaluate(() => window.__wos.desks[0]);
  check('desk 1 pinned to Wizard', d0.kind === 'wizard' && d0.pinned, JSON.stringify(d0));
  const fr = page.frameLocator('.desk[data-desk="0"] iframe.appframe');
  const navOk = await fr.locator('nav.bottom-dock').waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
  check('Wizard chat list renders inside the desk', navOk);
  check('compact orb on app desk', await page.evaluate(() => document.querySelector('#device').classList.contains('mini')));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: OUT + '/21-wizard-desk.png' });

  // Swipe down: live inbox.
  await page.evaluate(() => window.__wos.goDesk(2)); await page.waitForTimeout(600);
  check('big orb back on home', await page.evaluate(() => !document.querySelector('#device').classList.contains('mini')));
  await page.evaluate(() => window.__wos.openSheet('inbox')); await page.waitForTimeout(700);
  const hasNote = await page.locator(`#inboxBody .note[data-note="${TARGET}"]`).count();
  check('inbox lists the unread/working thread', hasNote === 1);
  await page.screenshot({ path: OUT + '/22-inbox-live.png' });

  // Tap it: opens in the Wizard desk, and the read clears it everywhere.
  await page.locator(`#inboxBody .note[data-note="${TARGET}"]`).click(); await page.waitForTimeout(1200);
  check('tap opens Wizard desk', await page.evaluate(() => window.__wos.idx === 0), 'idx=' + await page.evaluate(() => window.__wos.idx));
  const chatOpen = await fr.locator('.chat-header').first().waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
  const blocked = await page.evaluate(() => document.querySelector('.desk[data-desk="0"] .frame-wrap')?.classList.contains('blocked'));
  const title = chatOpen ? (await fr.locator('.chat-header').first().innerText()).replace(/\s+/g, ' ').slice(0, 80) : '';
  check('the thread itself is open inside Wizard', chatOpen && !blocked, `blocked=${blocked} header="${title}" log=${JSON.stringify(await page.evaluate(() => window.__frameLog))}`);
  const after = await page.evaluate(id => { const g = window.__wos.live.groups(); return { ready: g.ready.some(s => s.id === id) }; }, TARGET);
  check('read thread leaves the Unread list', !after.ready);
  // Same key Wizard itself writes: proves the shared contract, not a local flag.
  const seenRec = await page.evaluate(id => { const s = JSON.parse(localStorage.getItem('wizard.thread-seen.v1:wizard-account-local') || '{}'); return s.threads?.[`direct:${id}`] || null; }, TARGET);
  check('Wizard read-state record written', !!seenRec, JSON.stringify(seenRec || {}).slice(0, 120));
  await page.waitForTimeout(1500);
  check('read state synced to the server (PUT)', writes.includes('PUT thread-seen'), writes.join(', '));
  await page.screenshot({ path: OUT + '/23-thread-in-desk.png' });

  // Reverse direction: open a chat from Wizard's own list inside the desk; the
  // shell must pick up Wizard's fresh read receipt (same-origin storage event).
  // Only ever re-open a thread that is ALREADY read, so QA never consumes a real unread.
  const other = await page.evaluate(id => { const L = window.__wos.live; return L.sessions.find(s => s.id !== id && !s.hidden && !s.archived && !L.isNew(s) && !['running','queued','submitting'].includes(s.status))?.id || ''; }, TARGET);
  await page.evaluate(() => { const f = document.querySelector('.desk[data-desk="0"] iframe'); f.src = '/wizard/?view=work'; });
  await page.waitForTimeout(1500);
  await fr.locator('nav.bottom-dock').waitFor({ timeout: 30000 });
  const otherTitle = await page.evaluate(id => window.__wos.live.session(id)?.title || '', other);
  const before = Date.now();
  const row = fr.getByText(otherTitle.slice(0, 24), { exact: false }).first();
  const found = await row.waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
  if (found) {
    await row.click(); await page.waitForTimeout(2500);
    const rec = await page.evaluate(id => window.__wos.live.seen?.threads?.['direct:' + id] || null, other);
    const cleared = await page.evaluate(id => !window.__wos.live.groups().ready.some(s => s.id === id), other);
    check('opening a chat inside Wizard updates the shell read state', !!rec && rec.seenAt >= before && cleared, `${otherTitle} seenAt=${rec?.seenAt} start=${before}`);
  } else check('opening a chat inside Wizard updates the shell read state', false, 'row not found: ' + otherTitle);

  // Mini-orb tuck and bring-back.
  await page.evaluate(() => window.__wos.openSheet('launcher')); await page.waitForTimeout(500);
  await page.locator('[data-act="orb-tuck"]').click(); await page.waitForTimeout(600);
  check('tuck hides the orb into an edge tab', await page.evaluate(() => document.querySelector('#device').classList.contains('tucked') && getComputedStyle(document.querySelector('#orbTab')).display !== 'none'));
  await page.screenshot({ path: OUT + '/24-tucked.png' });
  await page.locator('#orbTab').click(); await page.waitForTimeout(500);
  check('edge tab brings the orb back', await page.evaluate(() => !document.querySelector('#device').classList.contains('tucked')));

  // Recording from the mini orb: arc fans inward.
  await page.evaluate(() => window.__wos.startVoice && window.__wos.startVoice('auto'));
  await page.waitForTimeout(700);
  await page.screenshot({ path: OUT + '/25-mini-recording.png' });
  await page.evaluate(() => window.__wos.cancelVoice && window.__wos.cancelVoice(true));

  check('no Hermes writes besides read state', writes.every(w => w === 'PUT thread-seen'), writes.join(', '));
  check('no page errors', errors.length === 0, errors.join(' | '));
  console.log(`${pass}/${pass + fail} passed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
