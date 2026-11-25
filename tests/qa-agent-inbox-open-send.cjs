'use strict';
// Open / Send to inbox (wizard-ux issue 1570; on for everyone since wizard-ux issue 1778, no switch) in a real browser, built on the Running view
// harness (tests/qa-agent-inbox-running.cjs); the Running view opens from a data-chrunning button, as there.
// Disposable synthetic transport only: a fake box lists one ordinary chat and keeps two background tasks in its agent
// inbox; their worker threads are hidden (never listed, read by id). POST /wizard/v1/agent-inbox/open|send flips a
// thread's hidden flag, answered after a 1.2 s delay so the run can tell the tap frame from the box's answer.
// Phone 390x844 and Classic desktop 1440x960, Nebula + Grove:
//   1. the Running view shows Open on each task; Open lists the thread on the tap frame (before the box answers);
//   2. a hidden worker thread opened by id shows "In the background · Open" in its header; Open removes it on the tap
//      frame and the thread lists in Chats;
//   3. the row menu of a visible thread has Send to inbox (a pinned, Daily or Alerts thread has none); it leaves the list
//      on the tap frame;
//   4. a live skin change repaints the buttons.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://agent-inbox-running.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'agent-inbox-open-send-evidence');
const SHELLS = (process.env.QA_SHELLS || 'phone,classic').split(','), SKINS = (process.env.QA_SKINS || 'nebula,grove').split(',');
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms)), M = 60e3, H = 36e5;
const THREADS = {
  'qa-chat-2': { title: 'Plan with Jan', at: now - 40 * M, hidden: false, msgs: [['user', 'Let us plan the offsite together', 0], ['assistant', 'Happy to. Dates first?', 60]] },
  'qa-daily-1': { title: 'Daily · Wed 18 Nov', at: now - 90 * M, hidden: false, msgs: [['user', 'Good morning, what is on today?', 0], ['assistant', 'Three things today.', 60]] },
  'qa-alert-1': { title: 'Disk almost full', at: now - 60 * M, hidden: false, msgs: [['user', 'Tell me when the disk is nearly full', 0], ['assistant', 'The disk is 92% full.', 60]] },
  'qa-chat-1': { title: 'Weekend plans', at: now - 20 * M, hidden: false, msgs: [['user', 'What should we do on Saturday?', 0], ['assistant', 'A walk by the river, then the market.', 60]] },
  'qa-worker-1': { title: 'Lisbon flights', at: now - 3 * M, hidden: true, msgs: [['user', 'Research flights to Lisbon by Friday', 0], ['assistant', 'Comparing three fares for Friday morning.', 120]] },
  'qa-worker-2': { title: 'Dentist slot', at: now - 7 * H, hidden: true, msgs: [['user', 'Find a dentist slot this week', 0], ['assistant', 'Asked two practices, waiting to hear back.', 300]] },
};
const RECORDS = [
  { id: 'inbox_' + 'a'.repeat(24), agent: 'hermes', thread_id: 'qa-worker-1', state: 'running', kind: 'note', title: 'Lisbon flights', last_update: 'Comparing three fares for Friday morning', created_at: now - 25 * M, updated_at: now - 3 * M },
  { id: 'inbox_' + 'b'.repeat(24), agent: 'hermes', thread_id: 'qa-worker-2', state: 'stale', kind: 'note', title: 'Dentist slot', last_update: 'Asked two practices, waiting to hear back', created_at: now - 8 * H, updated_at: now - 7 * H },
];
const raw = (id, s) => ({ id, title: s.title, runtime: 'direct', status: 'completed', updated_at: iso(s.at), updatedAt: iso(s.at), last_active: s.at / 1000, message_count: s.msgs.length, messageCount: s.msgs.length, preview: s.msgs.at(-1)?.[1] || '', ...(s.hidden ? { hidden: true } : {}) });
const report = { origin, web, cases: [] };
(async () => {
  const browser = await chromium.launch();
  try {
    for (const shell0 of SHELLS) for (const skin of SKINS) {
      const shell = shell0 === 'phone-channels' ? 'phone' : shell0, channels = shell0 === 'phone-channels', phone = shell === 'phone', stem = `${shell0}-${skin}`;
      const entry = { stem, errors: [], refused: [], writes: [], moves: [], inboxReads: 0 }; report.cases.push(entry);
      const threads = JSON.parse(JSON.stringify(THREADS));
      const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 960 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', ...(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' } : {}) });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        const mix = { 'wizard/desktop-chats': true, ...(channels ? { 'wizard/chat-channels': true } : {}) };
        await context.addInitScript(({ shell, skin, mix }) => {
          if (window !== top) return;
          if (sessionStorage.getItem('qaBoot')) return; sessionStorage.setItem('qaBoot', '1');
          for (const [k, v] of Object.entries({ 'wos.shell': shell === 'phone' ? 'phone' : 'desktop', 'wux.shell': shell === 'phone' ? 'phone' : 'desktop', 'wos.desktop-view.v1': 'classic', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
            'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v);
        }, { shell, skin, mix });
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
          if (u.origin !== origin) { entry.refused.push({ method, url: q.url(), reason: 'external' }); return r.abort(); }
          if (!['GET', 'HEAD'].includes(method)) {
            entry.writes.push({ method, path: p });
            if (method === 'PUT' && p === '/wizard/thread-seen') return r.fulfill({ json: { ok: true, state: q.postDataJSON() } });
            if (method === 'PUT' && p === '/wizard/v1/channels/read') return r.fulfill({ json: { at: {} } });
            if (method === 'PATCH' && p === '/wizard/v1/ui-preferences') return r.fulfill({ json: {} });
            const mv = /^\/wizard\/v1\/agent-inbox\/(open|send)$/.exec(p);
            if (method === 'POST' && mv) {
              const body = q.postDataJSON(), t = threads[body.thread_id]; entry.moves.push({ kind: mv[1], ...body, at: Date.now() });
              await nap(1200);
              if (!t) return r.fulfill({ status: 404, json: { error: 'not_found' } });
              t.hidden = mv[1] === 'send';
              return r.fulfill({ json: { record: null, hidden: t.hidden, example: true } });
            }
            entry.refused.push({ method, path: p, reason: 'unexpected-write' }); return r.fulfill({ status: 405, json: { error: 'Synthetic fixture refuses this write' } });
          }
          if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
          if (p.startsWith(prefix)) {
            const f = decodeURIComponent(p.slice(prefix.length) || 'index.html'), abs = path.resolve(web, f);
            if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
            if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return r.fulfill({ path: abs });
            return r.fulfill({ status: 404, body: 'No synthetic static asset' });
          }
          if (p === '/wizard/v1/agent-inbox') {
            entry.inboxReads++;
            assert.equal(u.searchParams.get('state'), 'running,stale');
            // The box names the main agent's Daily and Alerts threads: Send to inbox is never offered for them.
            return r.fulfill({ json: { records: RECORDS, check: null, stay: ['qa-daily-1', 'qa-alert-1'] } });
          }
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
          if (p === '/wizard/v1/channels') return r.fulfill({ json: { schema: 'wizard.channels/1', sort: 'az', channels: [] } });
          if (p === '/wizard/v1/channels/read') return r.fulfill({ json: { at: {} } });
          if (p === '/wizard/hermes/api/sessions' && u.searchParams.has('channel')) return r.fulfill({ json: { object: 'list', data: [], offset: 0, limit: 100, has_more: false, snapshot: 'snap', window: 'channel', channel: u.searchParams.get('channel'), order: 'oldest', channel_total: 0, view: 'list', list_version: 1 } });
          // Stock Hermes lists no hidden session.
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: Object.entries(threads).filter(([, s]) => !s.hidden).map(([id, s]) => raw(id, s)), has_more: false } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) {
            const id = decodeURIComponent(m[1]), s = threads[id]; if (!s) return r.fulfill({ status: 404, json: { error: 'missing' } });
            entry.reads = (entry.reads || []).concat(id + (m[2] ? ':messages' : ''));
            const t0 = s.at / 1000 - 600;
            return r.fulfill({ json: m[2] ? { messages: s.msgs.map(([role, content, dt]) => ({ role, content, timestamp: t0 + dt })) } : { session: raw(id, s) } });
          }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
        await page.waitForFunction(() => (window.__wux || window.__wos) && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
        await page.waitForFunction(() => (document.documentElement.dataset.tweaks || '').split(' ').includes('wizard/desktop-chats'), null, { timeout: 15000 });
        const openList = () => phone ? page.evaluate(() => __wos.openSheet('inbox')) : page.evaluate(() => __wux.openChatsList());
        await openList();
        const vis = sel => page.locator(sel).filter({ visible: true }).first();
        const back = () => page.evaluate(() => window.__wos ? __wos.onBack() : __wux.escStep());
        await vis('.ch-list [data-chopen="qa-chat-1"]').waitFor({ timeout: 15000 });
        const listed = () => page.locator('.ch-list [data-chopen]').filter({ visible: true }).evaluateAll(b => [...new Set(b.map(x => x.dataset.chopen))].sort());
        // The row menu (long press on the phone, right click on the desktop) of one row; returns its buttons.
        const rowMenu = async id => {
          const row = vis(`.ch-list [data-chopen="${id}"]`);
          if (phone) await row.dispatchEvent('contextmenu'); else await row.click({ button: 'right' });
          await vis('.ch-sheet').waitFor({ timeout: 5000 });
          return page.locator('.ch-sheet button').filter({ visible: true }).evaluateAll(b => b.map(x => x.textContent.trim()));
        };
        const closeMenu = async () => { await page.keyboard.press('Escape'); await nap(300); if (await page.locator('.ch-sheet').filter({ visible: true }).count()) { await back(); await nap(300); } };
        // The Running view's way in: the list's Running row is gone (the bottom tabs Inbox · Tags · Sent replace it since
        // wizard-ux issue 1778) and the sweep card's Running link opens it, so the run taps a data-chrunning button in the
        // list (the same click handler) once the inbox has both tasks.
        await page.waitForFunction(() => window.WizLive?.agentInbox?.records?.('hermes')?.length === 2, null, { timeout: 10000 });
        const openRunning = async () => {
          await vis('.ch-list').evaluate(n => { n.querySelector('.qa-run-go')?.remove(); const b = document.createElement('button'); b.type = 'button'; b.dataset.chrunning = ''; b.textContent = 'Running'; b.className = 'qa-run-go'; (n.querySelector('.ch-scroll') || n).prepend(b); });
          await vis('.ch-list .qa-run-go').click();
        };
        await page.evaluate(() => document.fonts.ready); await nap(300);
        // 1. Running view: Open on every task; Open lists the thread on the tap frame.
        await openRunning();
        await vis('.ch-run-h').waitFor({ timeout: 8000 });
        entry.openButtons = await page.locator('.ch-run .ch-inbox-open').filter({ visible: true }).evaluateAll(b => b.map(x => { const r = x.getBoundingClientRect(); return { thread: x.dataset.chinboxopen, w: r.width, h: r.height, text: x.textContent.trim() }; }));
        assert.deepEqual(entry.openButtons.map(b => b.thread), ['qa-worker-1', 'qa-worker-2'], 'Open on each running task');
        assert.ok(entry.openButtons.every(b => b.h >= 30 && b.w >= 44), 'tappable: ' + JSON.stringify(entry.openButtons));
        await page.screenshot({ path: path.join(out, stem + '-1-running-open.png') });
        // Live skin change on the buttons.
        const colour = () => vis('.ch-run .ch-inbox-open').evaluate(n => getComputedStyle(n).backgroundColor + ' / ' + getComputedStyle(n).color);
        entry.btn = await colour();
        const other = skin === 'nebula' ? 'grove' : 'nebula';
        await page.evaluate(s => WosSkin.set(s), other); await nap(700);
        entry.btnOther = await colour();
        assert.notEqual(entry.btnOther, entry.btn, `the ${other} skin repaints Open (${entry.btn} → ${entry.btnOther})`);
        await page.screenshot({ path: path.join(out, stem + '-2-live-skin-' + other + '.png') });
        await page.evaluate(s => WosSkin.set(s), skin); await nap(500);
        const tap = await page.evaluate(() => {
          const b = [...document.querySelectorAll('.ch-run .ch-inbox-open')].find(x => x.dataset.chinboxopen === 'qa-worker-1' && x.getClientRects().length);
          b.click();
          // The same task as the tap: the row is in the chat list's data and the button is gone.
          return { listedNow: WizLive.sessions.some(s => s.id === 'qa-worker-1' && !s.hidden), buttonNow: [...document.querySelectorAll('.ch-run .ch-inbox-open')].filter(x => x.getClientRects().length).map(x => x.dataset.chinboxopen) };
        });
        entry.tap = tap;
        assert.equal(tap.listedNow, true, 'Open lists the thread on the tap frame');
        assert.deepEqual(tap.buttonNow, ['qa-worker-2'], 'its Open goes on the tap frame');
        await back(); await nap(300);
        entry.listedAfterOpen = await listed();
        entry.openAnsweredBeforeList = entry.moves.length ? Date.now() - entry.moves[0].at > 1200 : null;
        assert.ok(entry.listedAfterOpen.includes('qa-worker-1'), 'the opened thread is in Chats: ' + entry.listedAfterOpen.join(','));
        assert.deepEqual(entry.moves.map(m => [m.kind, m.thread_id]), [['open', 'qa-worker-1']]);
        await nap(1500);
        await page.screenshot({ path: path.join(out, stem + '-3-opened-in-chats.png') });
        // 2. A hidden worker thread read by id: "In the background · Open" in its header.
        await openRunning();
        await vis('.ch-run-h').waitFor({ timeout: 8000 });
        await vis('.ch-run-row[data-chrunopen="qa-worker-2"]').click();
        const thread = () => page.locator('.ch-thread').filter({ visible: true }).first();
        await thread().getByText('Asked two practices, waiting to hear back.').waitFor({ timeout: 10000 });
        const head = thread().locator('.ch-head .ch-inbox-open');
        await head.waitFor({ timeout: 5000 });
        entry.headText = (await thread().locator('.ch-head .ch-inbox-h').innerText()).replace(/\s+/g, ' ').trim();
        await page.screenshot({ path: path.join(out, stem + '-4-hidden-thread-header.png') });
        entry.headTap = await page.evaluate(() => {
          const b = [...document.querySelectorAll('.ch-thread .ch-head .ch-inbox-open')].find(x => x.getClientRects().length); b.click();
          return { listedNow: WizLive.sessions.some(s => s.id === 'qa-worker-2' && !s.hidden), headNow: [...document.querySelectorAll('.ch-thread .ch-head .ch-inbox-open')].filter(x => x.getClientRects().length).length };
        });
        assert.deepEqual(entry.headTap, { listedNow: true, headNow: 0 }, 'Open from the header lists it and the button goes on the tap frame');
        await nap(1500);
        // Back to Chats: both former worker threads list.
        if (phone) { await back(); await nap(400); }
        await back(); await nap(400);
        if (phone && !(await page.locator('.ch-list [data-chopen]').filter({ visible: true }).count())) { await openList(); await nap(400); }
        entry.listedAfterHead = await listed();
        assert.ok(entry.listedAfterHead.includes('qa-worker-2'), 'Open from the header lists it in Chats: ' + entry.listedAfterHead.join(','));
        // 3. Send to inbox from a visible thread's menu; never for a Daily or Alerts thread (issue 1569 review), nor a pinned one.
        for (const id of ['qa-daily-1', 'qa-alert-1']) {
          const menu = await rowMenu(id); (entry.stayMenus = entry.stayMenus || {})[id] = menu;
          assert.ok(menu.length && !menu.some(t => /Send to inbox/.test(t)), `${id} has no Send to inbox: ` + menu.join(' | '));
          if (id === 'qa-daily-1') await page.screenshot({ path: path.join(out, stem + '-5a-daily-no-send.png') });
          await closeMenu();
        }
        await page.evaluate(() => { const b = [...document.querySelectorAll('[data-chpin="qa-chat-2"]')].find(x => x.getClientRects().length); if (b) b.click(); else window.WosChatPins.toggle('qa-chat-2'); }); await nap(400);
        entry.pinned = await page.evaluate(() => window.WosChatPins.has('qa-chat-2'));
        assert.equal(entry.pinned, true, 'qa-chat-2 is pinned');
        entry.pinnedMenu = await rowMenu('qa-chat-2');
        assert.ok(!entry.pinnedMenu.some(t => /Send to inbox/.test(t)), 'a pinned thread has no Send to inbox: ' + entry.pinnedMenu.join(' | '));
        await closeMenu();
        entry.menu = await rowMenu('qa-chat-1');
        assert.ok(entry.menu.some(t => /Send to inbox/.test(t)), 'Send to inbox in the menu: ' + entry.menu.join(' | '));
        await page.screenshot({ path: path.join(out, stem + '-5-send-to-inbox-menu.png') });
        entry.sendTap = await page.evaluate(() => {
          [...document.querySelectorAll('.ch-sheet [data-rsinbox]')].find(x => x.getClientRects().length).click();
          return { listedNow: WizLive.sessions.some(s => s.id === 'qa-chat-1' && !s.hidden), rowNow: [...document.querySelectorAll('.ch-list [data-chopen="qa-chat-1"]')].filter(x => x.getClientRects().length).length };
        });
        assert.deepEqual(entry.sendTap, { listedNow: false, rowNow: 0 }, 'Send to inbox drops the row on the tap frame');
        await nap(1600);
        const sent = entry.moves.find(m => m.kind === 'send');
        assert.equal(sent?.thread_id, 'qa-chat-1');
        assert.equal(sent?.title, 'Weekend plans');
        entry.listedAfterSend = await listed();
        assert.ok(!entry.listedAfterSend.includes('qa-chat-1'), 'a sent thread stays out of Chats after the box answered');
        await page.screenshot({ path: path.join(out, stem + '-6-sent.png') });
        assert.equal(entry.errors.length, 0, 'browser errors: ' + entry.errors.join('; '));
        entry.pass = true;
      } catch (e) { entry.failure = e.stack; const pages = context.pages(); if (pages[0]) { entry.body = (await pages[0].locator('body').innerText().catch(() => '')).slice(0, 1500); await pages[0].screenshot({ path: path.join(out, stem + '-failure.png') }).catch(() => {}); } }
      finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await context.close(); }
    }
  } finally { await browser.close(); }
  const failed = report.cases.filter(c => !c.pass);
  console.log(JSON.stringify({ cases: report.cases.length, passed: report.cases.length - failed.length, failed: failed.map(c => c.stem + ': ' + String(c.failure).split('\n')[0]), screenshots: fs.readdirSync(out).filter(f => f.endsWith('.png')).length }));
  if (failed.length || !report.cases.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
