'use strict';
// Agent inbox Running view (wizard-ux issue 1569; on for everyone since wizard-ux issue 1778, no switch) in a real browser.
// Disposable synthetic transport only: a fake box lists one ordinary chat and keeps two background tasks in its agent
// inbox (GET /wizard/v1/agent-inbox?state=running,stale), one running and one quiet for 6 h. Their worker threads are
// hidden, so the box never lists them (stock Hermes leaves hidden sessions out of /api/sessions) but reads them by id.
// Phone 390x844 and Classic desktop 1440x960 (and the phone with Channels on), Nebula + Grove:
//   the list never shows the worker threads, and no "2 running" row: the bottom tabs Inbox · Tags · Sent (also on for
//   everyone since issue 1778) replace it, and the sweep card's Running link is the way in, so the run taps a
//   data-chrunning button in the list (the same click handler); the Running view shows title, last update, how long it
//   runs, "No news for 6 h" on the quiet one; a row opens its thread; Back returns to the Running view; Back again
//   returns to Chats, which still does not list the worker thread; a live skin change repaints the view.
// AI apps desktop 1440x960 (shell ai-apps, wizard-ux issue 1599, on for everyone): the sweep card's Running
//   link (a data-chsweeprunning button in the open thread, the same click handler) opens the Running view in the sidebar's
//   Chats pane; a row opens its thread in the main column with the view still in the sidebar; Esc closes the thread, Esc
//   again returns to the sidebar's own rows; the view's ‹ and the Tags tab leave it too.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://agent-inbox-running.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'agent-inbox-running-evidence');
const SHELLS = (process.env.QA_SHELLS || 'phone,classic,phone-channels,ai-apps').split(','), SKINS = (process.env.QA_SKINS || 'nebula,grove').split(',');
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms)), M = 60e3, H = 36e5;
const THREADS = {
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
// The AI apps desktop (wizard-ux issue 1599).
async function aiApps(page, vis, entry, stem, skin) {
  await page.waitForFunction(() => document.documentElement.dataset.layout === 'ai-apps', null, { timeout: 15000 });
  // The sidebar draws the shared Inbox rows (wizard-ux issue 1999): one data-chopen button per listed thread.
  const sideRow = id => vis(`.aad-side .ch-row[data-chopen="${id}"]`);
  await sideRow('qa-chat-1').waitFor({ timeout: 15000 });
  await page.waitForFunction(() => window.WizLive?.agentInbox?.records?.('hermes')?.length === 2, null, { timeout: 10000 });
  await nap(500);
  const sideIds = () => page.locator('.aad-side .ch-row[data-chopen]').filter({ visible: true }).evaluateAll(b => [...new Set(b.map(x => x.dataset.chopen))]);
  entry.sideListed = await sideIds();
  assert.deepEqual(entry.sideListed, ['qa-chat-1'], 'the worker threads never list in the sidebar');
  const runHead = () => page.locator('.aad-chan .ch-run-h').filter({ visible: true }).count();
  // The sweep card's Running link, in the open thread (the same data-chsweeprunning handler the card's link uses).
  const runLink = async () => {
    await vis('.ch-thread').evaluate(n => { const b = document.createElement('button'); b.type = 'button'; b.dataset.chsweeprunning = ''; b.textContent = 'Running: 2'; b.className = 'qa-run-go'; (n.querySelector('.ch-msgs, .ch-scroll') || n).prepend(b); });
    await vis('.ch-thread .qa-run-go').click(); await nap(700);
  };
  await sideRow('qa-chat-1').click();
  await vis('.ch-thread').getByText('A walk by the river, then the market.').waitFor({ timeout: 10000 });
  await page.evaluate(() => document.fonts.ready); await nap(300);
  // 1. The Running link: the view in the sidebar's Chats pane, the sidebar's own rows step aside, the thread stays.
  await runLink();
  await vis('.aad-chan .ch-run-h').waitFor({ timeout: 8000 });
  assert.equal(await page.locator('.aad-scroll').filter({ visible: true }).count(), 0, 'the sidebar rows step aside');
  assert.ok(await vis('.ch-thread').getByText('A walk by the river, then the market.').isVisible(), 'the thread stays in the main column');
  const rows = page.locator('.aad-chan .ch-run-row').filter({ visible: true });
  entry.rows = await rows.evaluateAll(b => b.map(x => ({ thread: x.dataset.chrunopen, text: x.innerText.replace(/\s+/g, ' ').trim() })));
  assert.deepEqual(entry.rows.map(r => r.thread), ['qa-worker-1', 'qa-worker-2'], 'every running record');
  assert.match(entry.rows[0].text, /Lisbon flights.*Comparing three fares.*Running 2\d min/, 'title, last update, age: ' + entry.rows[0].text);
  assert.match(entry.rows[1].text, /Dentist slot.*No news for 6 h:.*Asked two practices.*Running 8 h/, 'the quiet one is marked: ' + entry.rows[1].text);
  entry.fits = await page.locator('.aad-chan .ch-run-row').filter({ visible: true }).evaluateAll(n => { const side = n[0].closest('.aad-side').getBoundingClientRect(); return n.every(x => x.getBoundingClientRect().right <= side.right + 0.5); });
  assert.ok(entry.fits, 'rows fit the sidebar');
  await page.screenshot({ path: path.join(out, stem + '-1-running.png') });
  // 2. A row opens its thread in the main column; the view stays in the sidebar.
  await rows.first().click();
  await vis('.ch-thread').getByText('Comparing three fares for Friday morning.').waitFor({ timeout: 10000 });
  assert.ok(entry.reads.some(x => x.startsWith('qa-worker-1')), 'read by id');
  assert.equal(await runHead(), 1, 'the Running view stays in the sidebar');
  await page.screenshot({ path: path.join(out, stem + '-2-thread.png') });
  // 3. Esc closes the thread: the Running view is what is left.
  await vis('.ch-thread').getByText('Comparing three fares for Friday morning.').click(); await page.keyboard.press('Escape'); await nap(700);
  assert.equal(await page.getByText('Comparing three fares for Friday morning.').filter({ visible: true }).count(), 0, 'Esc closes the thread');
  assert.equal(await runHead(), 1, 'Esc returns to the Running view');
  // A live skin change repaints the view.
  const panel = () => vis('.aad-chan .ch-run').evaluate(n => getComputedStyle(n).backgroundColor + ' / ' + getComputedStyle(n.closest('.aad-side')).backgroundColor);
  entry.panel = await panel();
  const other = skin === 'nebula' ? 'grove' : 'nebula';
  await page.evaluate(s => WosSkin.set(s), other); await nap(700);
  entry.panelOther = await panel();
  assert.notEqual(entry.panelOther, entry.panel, `the ${other} skin repaints the view`);
  await page.evaluate(s => WosSkin.set(s), skin); await nap(500);
  // 4. Esc again: the sidebar's own rows, still without the worker threads.
  await page.keyboard.press('Escape'); await nap(700);
  assert.equal(await runHead(), 0, 'Esc again leaves the Running view');
  await sideRow('qa-chat-1').waitFor({ timeout: 8000 });
  entry.sideAfter = await sideIds();
  assert.deepEqual(entry.sideAfter, ['qa-chat-1'], 'opening a worker thread never lists it');
  await page.screenshot({ path: path.join(out, stem + '-3-back.png') });
  // 5. The view's ‹ and the Tags tab leave it too.
  await sideRow('qa-chat-1').click(); await vis('.ch-thread').getByText('A walk by the river, then the market.').waitFor({ timeout: 10000 });
  await runLink(); await vis('.aad-chan .ch-run-h').waitFor({ timeout: 8000 });
  await vis('.aad-chan [data-chrunback]').click(); await nap(500);
  assert.equal(await runHead(), 0, '‹ leaves the Running view');
  await runLink(); await vis('.aad-chan .ch-run-h').waitFor({ timeout: 8000 });
  await vis('.aad-chan [data-chtab="tags"]').click(); await nap(500);
  assert.equal(await runHead(), 0, 'Tags leaves the Running view');
  assert.ok(!entry.writes.some(w => w.method === 'PATCH' && /api\/sessions/.test(w.path)), 'opening never unhides it');
  assert.equal(entry.errors.length, 0, 'browser errors: ' + entry.errors.join('; '));
}

(async () => {
  const browser = await chromium.launch();
  try {
    for (const shell0 of SHELLS) for (const skin of SKINS) {
      const shell = shell0 === 'phone-channels' ? 'phone' : shell0, channels = shell0 === 'phone-channels', phone = shell === 'phone', stem = `${shell0}-${skin}`;
      const entry = { stem, errors: [], refused: [], writes: [], inboxReads: 0 }; report.cases.push(entry);
      const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 960 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', ...(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' } : {}) });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        const mix = { 'wizard/desktop-chats': true, ...(channels ? { 'wizard/chat-channels': true } : {}) };
        await context.addInitScript(({ shell, skin, mix }) => {
          if (window !== top) return;
          if (sessionStorage.getItem('qaBoot')) return; sessionStorage.setItem('qaBoot', '1');
          for (const [k, v] of Object.entries({ 'wos.shell': shell === 'phone' ? 'phone' : 'desktop', 'wux.shell': shell === 'phone' ? 'phone' : 'desktop', 'wos.desktop-view.v1': shell === 'ai-apps' ? 'ai-apps' : 'classic', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
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
            // Other inbox reads (alerts, Needs you: state=new...) share the route and hold nothing here.
            if (u.searchParams.get('state') !== 'running,stale') return r.fulfill({ json: { records: [], check: null } });
            entry.inboxReads++;
            return r.fulfill({ json: { records: RECORDS, check: null } });
          }
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
          if (p === '/wizard/v1/channels') return r.fulfill({ json: { schema: 'wizard.channels/1', sort: 'az', channels: [] } });
          if (p === '/wizard/v1/channels/read') return r.fulfill({ json: { at: {} } });
          if (p === '/wizard/hermes/api/sessions' && u.searchParams.has('channel')) return r.fulfill({ json: { object: 'list', data: [], offset: 0, limit: 100, has_more: false, snapshot: 'snap', window: 'channel', channel: u.searchParams.get('channel'), order: 'oldest', channel_total: 0, view: 'list', list_version: 1 } });
          // Stock Hermes lists no hidden session.
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: Object.entries(THREADS).filter(([, s]) => !s.hidden).map(([id, s]) => raw(id, s)), has_more: false } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) {
            const id = decodeURIComponent(m[1]), s = THREADS[id]; if (!s) return r.fulfill({ status: 404, json: { error: 'missing' } });
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
        const vis = sel => page.locator(sel).filter({ visible: true }).first();
        if (shell === 'ai-apps') { await aiApps(page, vis, entry, stem, skin); entry.pass = true; continue; }
        if (phone) await page.evaluate(() => __wos.openSheet('inbox')); else await page.evaluate(() => __wux.openChatsList());
        const back = () => page.evaluate(() => window.__wos ? __wos.onBack() : __wux.escStep());
        await vis('.ch-list [data-chopen="qa-chat-1"]').waitFor({ timeout: 15000 });
        const listed = () => page.locator('.ch-list [data-chopen]').filter({ visible: true }).evaluateAll(b => [...new Set(b.map(x => x.dataset.chopen))]);
        // 1. The list: the bottom tabs and no Running row (the tabs replace it), never the hidden worker threads.
        // (The phone has one bar and the Chats tile's view switcher instead of bottom tabs since wizard-ux issue 1957.)
        if (!phone) await vis('.ch-tabbar').waitFor({ timeout: 10000 });
        await page.waitForFunction(() => window.WizLive?.agentInbox?.records?.('hermes')?.length === 2, null, { timeout: 10000 });
        await nap(500);
        entry.runningRows = await page.locator('.ch-running').filter({ visible: true }).count();
        assert.equal(entry.runningRows, 0, 'no Running row while the tabs are on');
        entry.listed = await listed();
        assert.deepEqual(entry.listed, ['qa-chat-1'], 'the worker threads never list');
        await page.evaluate(() => document.fonts.ready); await nap(300);
        await page.screenshot({ path: path.join(out, stem + '-1-list.png') });
        // 2. One tap: the Running view (a data-chrunning button in the list, as the sweep card's Running link opens it).
        await vis('.ch-list').evaluate(n => { const b = document.createElement('button'); b.type = 'button'; b.dataset.chrunning = ''; b.textContent = 'Running'; b.className = 'qa-run-go'; (n.querySelector('.ch-scroll') || n).prepend(b); });
        await vis('.ch-list .qa-run-go').click();
        await vis('.ch-run-h').waitFor({ timeout: 8000 });
        entry.head = await vis('.ch-run-h').evaluate(n => { const b = n.querySelector('[data-chrunback]'), r = b?.getBoundingClientRect(); return { w: r?.width || 0, h: r?.height || 0, display: b ? getComputedStyle(b).display : '', html: n.outerHTML.slice(0, 300) }; });
        assert.ok(entry.head.w >= 40 && entry.head.h >= 40, 'a Back button on the Running view: ' + JSON.stringify(entry.head));
        const rows = page.locator('.ch-run-row').filter({ visible: true });
        entry.rows = await rows.evaluateAll(b => b.map(x => ({ thread: x.dataset.chrunopen, text: x.innerText.replace(/\s+/g, ' ').trim() })));
        assert.deepEqual(entry.rows.map(r => r.thread), ['qa-worker-1', 'qa-worker-2'], 'every running record, newest news first');
        assert.match(entry.rows[0].text, /Lisbon flights.*Comparing three fares.*Running 2\d min/, 'title, last update, age: ' + entry.rows[0].text);
        assert.match(entry.rows[1].text, /Dentist slot.*No news for 6 h:.*Asked two practices.*Running 8 h/, 'the quiet one is marked: ' + entry.rows[1].text);
        assert.ok(!entry.rows[0].text.includes('No news'), 'a running one is not marked');
        await page.screenshot({ path: path.join(out, stem + '-2-running.png') });
        // 3. A tap opens the hidden thread like any link.
        await rows.first().click();
        const thread = () => page.locator('.ch-thread').filter({ visible: true }).first();
        await thread().getByText('Comparing three fares for Friday morning.').waitFor({ timeout: 10000 });
        assert.ok(entry.reads.some(x => x.startsWith('qa-worker-1')), 'read by id');
        await page.screenshot({ path: path.join(out, stem + '-3-thread.png') });
        // 4. Back returns to the Running view. (Classic desktop opens the thread beside the list, so the Running view stays
        // on screen next to it; the thread's own close puts it away.)
        if (phone) { await back(); await nap(500); }
        else {
          await vis('.ch-run-h').waitFor({ timeout: 8000 });
          entry.besideThread = true;
          // Esc in the thread closes the thread and leaves the Running view as it was.
          await thread().getByText('Comparing three fares for Friday morning.').click(); await back(); await nap(600);
          entry.threadAfterEsc = await page.locator('.ch-thread').filter({ visible: true }).count();
        }
        await vis('.ch-run-h').waitFor({ timeout: 8000 });
        assert.equal(await page.locator('.ch-run-row').filter({ visible: true }).count(), 2, 'back on the Running view');
        // 5. A live skin change repaints the view without a reload.
        const panel = () => vis('.ch-run').evaluate(n => getComputedStyle(n).backgroundColor);
        entry.panel = await panel();
        const other = skin === 'nebula' ? 'grove' : 'nebula';
        await page.evaluate(s => WosSkin.set(s), other); await nap(700);
        entry.panelOther = await panel();
        assert.notEqual(entry.panelOther, entry.panel, `the ${other} skin repaints the panel (${entry.panel} → ${entry.panelOther})`);
        assert.equal(await page.locator('.ch-run-row').filter({ visible: true }).count(), 2, 'still the Running view after the skin change');
        await page.screenshot({ path: path.join(out, stem + '-4-live-skin-' + other + '.png') });
        await page.evaluate(s => WosSkin.set(s), skin); await nap(500);
        // 6. Back again: Chats, still without the worker threads.
        await back(); await nap(500);
        await vis('.ch-list [data-chopen="qa-chat-1"]').waitFor({ timeout: 8000 });
        assert.equal(await page.locator('.ch-run-h').filter({ visible: true }).count(), 0, 'Back leaves the Running view');
        entry.listedAfter = await listed();
        assert.deepEqual(entry.listedAfter, ['qa-chat-1'], 'opening a worker thread never lists it');
        assert.ok(!entry.writes.some(w => w.method === 'PATCH' && /api\/sessions/.test(w.path)), 'opening never unhides it');
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
