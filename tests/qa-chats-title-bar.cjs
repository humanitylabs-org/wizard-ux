'use strict';
// Chats title bar (wizard-ux issue 1836, on for everyone) in a real browser, disposable synthetic box only.
// Phone 412x915 and Classic desktop 1440x960, Nebula and a light skin, with James's switches (desktop-chats,
// Inbox until archived and Inbox rows are on for everyone):
//   The top of Chats is one title bar naming the tab, "Inbox" with its count pill (= the Inbox rows), then the
//   search and filter icons; no "All chats", no "Inbox ^ · Newest first" section row: the rows start right under the bar.
//   The filter (≡) sheet holds the sort (Newest first by default); Oldest first reverses the unpinned rows and is kept.
//   The search icon opens the field, a query finds a row, the icon closes it again. Tags and Sent: the title follows the
//   tab. Archiving a row: the Archived fold still shows at the bottom.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://chats-title-bar-1836.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'chats-title-bar-evidence');
const SHELLS = (process.env.QA_SHELLS || 'phone,classic').split(','), SKINS = (process.env.QA_SKINS || 'nebula,obsidian-light').split(','), ROWS = true; // Inbox rows are on for everyone (wizard-ux issue 1779)
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms)), M = 60e3, D = 864e5;
const REC = 'inbox_' + 'b'.repeat(24), TODAY = new Date(now).toISOString().slice(0, 10);
const CHANNELS = [
  { id: 'daily', agent: 'hermes', name: 'Daily', order: -2, createdAt: iso(now - 9e8), archived: false, pinned: true, pinOrder: 0, kind: 'daily' },
  { id: 'priority', agent: 'hermes', name: '🔥 Priority', order: 0, createdAt: iso(now - 8e8), archived: false, pinned: false },
  { id: 'trip', agent: 'hermes', name: '✈️ Trip', order: 1, createdAt: iso(now - 8e8), archived: false, pinned: false },
];
let THREADS, BOX;
const fresh = () => ({
  'qa-new': { title: 'Weather tomorrow', at: now - 20 * M, channel: 'trip', msgs: [['user', 'Tell me the weather in Lisbon tomorrow', 0], ['assistant', 'Sunny, 18 °C, light wind from the north.', 30]] },
  'qa-read': { title: 'Garden plan', at: now - 3 * D, msgs: [['user', 'Plan the garden beds', 0], ['assistant', 'Tomatoes by the wall, herbs near the door.', 60]] },
  'qa-needs': { title: 'Dentist slot', at: now - 50 * M, attention: { state: 'needs_you', ask: 'Tuesday 10:00 or Thursday 16:00?' }, msgs: [['user', 'Find a dentist slot this week', 0], ['assistant', 'Two slots are free. Tuesday 10:00 or Thursday 16:00?', 60]] },
  'qa-failed': { title: 'Book the train', at: now - 70 * M, status: 'failed', msgs: [['user', 'Book the 9:10 train to Porto', 0]] },
  'qa-quiet': { title: 'Sent to Miguel', at: now - 10 * M, quiet: true, attention: { state: 'done', ask: 'Sent.' }, msgs: [['user', 'Sent to Miguel, done', 0], ['assistant', 'Noted.', 20]] },
  'qa-working': { title: 'Summarise the report', at: now - 2 * M, status: 'running', msgs: [['user', 'Summarise the quarterly report', 0]] },
  'qa-daily': { title: 'Daily · today', at: now - 4 * 3600e3, channel: 'daily', msgs: [['user', 'signal sweep', 0], ['assistant', 'Two things wait on you; the rest is done.', 30]] },
  'qa-prio': { title: 'Tax return', at: now - 2 * D, channel: 'priority', msgs: [['user', 'File the tax return', 0], ['assistant', 'Drafted; one number to confirm.', 60]] },
  'qa-urgent': { title: 'Call the plumber', at: now - 5 * D, msgs: [['user', 'Urgent: the kitchen tap is leaking', 0], ['assistant', 'The plumber can come at 15:00.', 60]] },
});
const boxFresh = () => ({ records: [{ id: REC, kind: 'needs_you', failed: true, state: 'new', agent: 'hermes', thread_id: 'qa-bg', title: 'Renew the parking permit', last_update: 'Stalled: the council site asked for a login.', created_at: now - 3 * 3600e3, updated_at: now - 30 * M }], patches: [] });
const raw = (sid, s) => ({ id: sid, title: s.title, runtime: 'direct', status: s.status || 'completed', updated_at: iso(s.at), updatedAt: iso(s.at), last_active: s.at / 1000, message_count: s.msgs.length, messageCount: s.msgs.length,
  preview: s.msgs.at(-1)?.[1] || '', latest_message: { role: s.msgs.at(-1)?.[0], content: s.msgs.at(-1)?.[1], timestamp: s.at / 1000 },
  ...(s.msgs.some(m => m[0] === 'assistant') ? { last_assistant_at: iso(s.at) } : {}), ...(s.status === 'running' ? { wizard_run_id: 'run-' + sid, wizard_last_run_status: 'running' } : {}),
  ...(s.attention ? { wizard_attention: s.attention } : {}), ...(s.quiet ? { wizard_quiet_reply: true } : {}), ...(s.channel ? { channel: s.channel } : {}), ...(s.archived ? { archived: true } : {}) });
// Seen: every thread but qa-new was read at its last reply (qa-new is the one new reply).
const SEEN = () => ({ state: { initializedAt: 1, threads: Object.fromEntries(Object.entries(THREADS).filter(([k]) => k !== 'qa-new').map(([k, s]) => [`direct:${k}`, { updatedAt: iso(s.at), assistantActivityAt: iso(s.at), seenAt: s.at + 60e3 }])) } });
const SENT = () => ({ rows: [{ id: 'sent_' + 'c'.repeat(24), at: now - 5 * D, source: 'orb', text: 'Urgent: the kitchen tap is leaking', route: 'agent', decided_by: 'model', state: 'done', thread_id: 'qa-urgent', urgent: true, tags: [] }], next: null, check: null });
const report = { origin, web, cases: [] };
(async () => {
  const browser = await chromium.launch();
  try {
    for (const shell of SHELLS) for (const skin of SKINS) {
      const phone = shell === 'phone', stem = `${shell}-${skin}`;
      const entry = { stem, errors: [], refused: [], writes: [] }; report.cases.push(entry);
      THREADS = fresh(); BOX = boxFresh();
      const context = await browser.newContext({ viewport: phone ? { width: 412, height: 915 } : { width: 1440, height: 960 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', ...(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' } : {}) });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        const mix = { 'wizard/desktop-chats': true };
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
            if (method === 'PUT' && p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { ...(q.postDataJSON() || {}) } });
            const am = /^\/wizard\/v1\/agent-inbox\/(inbox_[a-f0-9]{24})$/.exec(p);
            if (method === 'PATCH' && am) { const b = q.postDataJSON() || {}; BOX.patches.push({ id: am[1], ...b }); const rec = BOX.records.find(x => x.id === am[1]); if (!rec) return r.fulfill({ status: 404, json: { error: 'not_found' } }); if (b.action === 'archive') rec.state = 'archived'; return r.fulfill({ json: { record: rec } }); }
            const pm = /^\/wizard\/hermes\/api\/sessions\/([^/]+)$/.exec(p);
            if (method === 'PATCH' && pm && THREADS[decodeURIComponent(pm[1])]) { const s = THREADS[decodeURIComponent(pm[1])], b = q.postDataJSON() || {}; if ('archived' in b) s.archived = !!b.archived; return r.fulfill({ json: { session: raw(decodeURIComponent(pm[1]), s) } }); }
            entry.refused.push({ method, path: p, reason: 'unexpected-write' }); return r.fulfill({ status: 405, json: { error: 'Synthetic fixture refuses this write' } });
          }
          if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
          if (p.startsWith(prefix)) {
            const f = decodeURIComponent(p.slice(prefix.length) || 'index.html'), abs = path.resolve(web, f);
            if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
            if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return r.fulfill({ path: abs });
            return r.fulfill({ status: 404, body: 'No synthetic static asset' });
          }
          if (p === '/wizard/v1/sent') return r.fulfill({ json: SENT() });
          if (p === '/wizard/v1/agent-inbox') {
            if (u.searchParams.get('kind') === 'needs_you') { entry.needsReads = (entry.needsReads || 0) + 1; return r.fulfill({ json: { records: BOX.records.filter(x => x.state === 'new'), check: null, stay: ['qa-daily'] } }); }
            return r.fulfill({ json: { records: [], check: null, stay: ['qa-daily'] } });
          }
          if (p === '/wizard/thread-seen') return r.fulfill({ json: SEEN() });
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
          if (p === '/wizard/v1/channels') return r.fulfill({ json: { schema: 'wizard.channels/1', sort: 'az', migratedAt: iso(now - D), channels: CHANNELS } });
          if (p === '/wizard/v1/channels/read') return r.fulfill({ json: { at: {} } });
          if (p === '/wizard/v1/channels/daily/days') return r.fulfill({ json: { today: 'qa-daily', days: [{ day: TODAY, sessionId: 'qa-daily', title: 'Daily · today', opener: 'signal sweep', count: 2, lastAt: iso(now - 4 * 3600e3) }], next: null } });
          if (p === '/wizard/hermes/api/sessions' && u.searchParams.has('channel')) {
            const id = u.searchParams.get('channel'), data = Object.entries(THREADS).filter(([, s]) => s.channel === id).map(([k, s]) => ({ ...raw(k, s), listVersion: 1, agent: '', createdAt: iso(s.at) }));
            return r.fulfill({ json: { object: 'list', data, offset: 0, limit: 100, has_more: false, snapshot: 'snap', window: 'channel', channel: id, order: 'oldest', channel_total: data.length, view: 'list', list_version: 1 } });
          }
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: Object.entries(THREADS).map(([k, s]) => raw(k, s)), has_more: false } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) {
            const sid = decodeURIComponent(m[1]);
            if (sid === 'qa-bg') return r.fulfill({ json: m[2] ? { messages: [{ role: 'user', content: 'Renew the parking permit', timestamp: now / 1000 - 3 * 3600 }, { role: 'assistant', content: 'The council site asked for a login; I stopped there.', timestamp: now / 1000 - 1800 }] } : { session: { ...raw('qa-bg', { title: 'Renew the parking permit', at: now - 30 * M, msgs: [['user', 'x', 0], ['assistant', 'y', 1]] }), hidden: true } } });
            const s = THREADS[sid]; if (!s) return r.fulfill({ status: 404, json: { error: 'missing' } });
            const t0 = s.at / 1000 - 600;
            return r.fulfill({ json: m[2] ? { messages: s.msgs.map(([role, content, dt]) => ({ role, content, timestamp: t0 + dt })) } : { session: raw(sid, s) } });
          }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
        await page.waitForFunction(() => (window.__wux || window.__wos) && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
        if (phone) await page.evaluate(() => __wos.openSheet('inbox')); else await page.evaluate(() => __wux.openChatsList());
        const vis = sel => page.locator(sel).filter({ visible: true }).first();
        const shot = async name => { await page.evaluate(() => document.fonts.ready); await nap(300); await page.screenshot({ path: path.join(out, `${stem}-${name}.png`) }); };
        // The top of the list as a person sees it.
        const bar = () => page.evaluate(() => {
          const seen = n => !!n && n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden' && getComputedStyle(n).display !== 'none';
          const list = [...document.querySelectorAll('.ch-list')].find(seen), tb = list.querySelector('.ch-tbar'), r = tb && seen(tb) ? tb.getBoundingClientRect() : null;
          const sec = list.querySelector('section.ch-sec[data-sec="ready"]'), first = sec && [...sec.querySelectorAll('.ch-row')].find(seen), fr = first?.getBoundingClientRect();
          const rows = sec ? [...sec.querySelectorAll('[data-chopen],[data-chrunopen],[data-chnotif]')].filter(seen).map(b => b.dataset.chopen || b.dataset.chrunopen || b.dataset.chnotif) : [];
          return { title: r ? tb.querySelector('.ch-tbar-t span')?.textContent.trim() : '', n: r ? tb.querySelector('.ch-tbar-n')?.textContent.trim() || '' : '',
            search: seen(tb?.querySelector('[data-chtbsearch]')), filter: seen(tb?.querySelector('[data-chfbtn]')), field: seen(list.querySelector('[data-chsearch]')),
            allChats: /All chats/.test(document.body.innerText), dc: [...document.querySelectorAll('.dc-head')].some(seen),
            secRow: !!sec?.querySelector(':scope > .ch-sec-h, :scope > .ch-sec-hl'), sort: !!list.querySelector('[data-chactorder]'), backRow: seen(list.querySelector('.ch-sent-h')),
            gap: r && fr ? Math.round(fr.top - r.bottom) : null, rows, secs: [...list.querySelectorAll('section.ch-sec[data-sec]')].map(s => s.dataset.sec + (s.querySelector(':scope > .ch-sec-h') ? ':fold' : '')) };
        });
        await vis('.ch-tabbar').waitFor({ timeout: 15000 });
        await vis('.ch-list [data-chopen="qa-new"]').waitFor({ timeout: 15000 });
        if (ROWS) await page.waitForFunction(() => !!document.querySelector('.ch-list [data-chrunopen="qa-bg"]'), null, { timeout: 15000 }).catch(() => {});
        await nap(800);
        entry.first = await bar();
        await shot('1-inbox');
        const B = entry.first;
        assert.equal(B.title, 'Inbox', 'the title names the tab ' + JSON.stringify(B));
        assert.ok(!B.allChats && !B.dc, 'no "All chats" and no second bar');
        assert.ok(B.rows.length >= 5, 'Inbox rows ' + JSON.stringify(B.rows));
        assert.equal(B.n, String(B.rows.length), 'the count pill is the Inbox count');
        assert.ok(B.search && B.filter && !B.field, 'search and filter are icons in the bar; the field is folded ' + JSON.stringify(B));
        assert.ok(!B.secRow && !B.sort, 'no Inbox section row and no sort on it ' + JSON.stringify(B));
        assert.ok(B.gap !== null && B.gap >= 0 && B.gap <= 12, 'the rows start right under the bar: gap ' + B.gap);
        // Sort from the filter sheet.
        await vis('.ch-tbar [data-chfbtn]').click();
        await vis('.ch-fsheet [data-chfsort="newest"]').waitFor({ timeout: 5000 });
        entry.sheet = await page.evaluate(() => [...document.querySelectorAll('.ch-fsheet [data-chfsort]')].filter(n => n.getClientRects().length).map(n => n.dataset.chfsort + ':' + n.getAttribute('aria-pressed')));
        assert.deepEqual(entry.sheet, ['newest:true', 'oldest:false', 'priority:false'], 'the sort is in the filter sheet, Newest first by default');
        await shot('2-filter-sort');
        await vis('.ch-fsheet [data-chfsort="oldest"]').click();
        await page.waitForFunction(() => ![...document.querySelectorAll('.ch-fsheet')].some(n => n.getClientRects().length), null, { timeout: 5000 });
        await nap(700);
        entry.oldest = await bar();
        const pinN = ROWS ? 3 : 0, free = B.rows.slice(pinN);
        assert.deepEqual(entry.oldest.rows.slice(pinN), [...free].reverse(), 'Oldest first reverses the unpinned rows ' + JSON.stringify([B.rows, entry.oldest.rows]));
        assert.deepEqual([...entry.oldest.rows.slice(0, pinN)].sort(), [...B.rows.slice(0, pinN)].sort(), 'pins stay on top');
        assert.ok(entry.writes.some(x => x.method === 'PUT' && x.path === '/wizard/v1/ui-preferences'), 'the order is saved like before');
        await vis('.ch-tbar [data-chfbtn]').click();
        await vis('.ch-fsheet [data-chfsort="oldest"][aria-pressed="true"]').waitFor({ timeout: 5000 });
        await vis('.ch-fsheet [data-chfsort="newest"]').click();
        await nap(700);
        assert.deepEqual((await bar()).rows, B.rows, 'Newest first again');
        // Search from the bar's icon.
        await vis('.ch-tbar [data-chtbsearch]').click();
        await vis('.ch-list [data-chsearch]').waitFor({ timeout: 5000 });
        assert.ok(await page.evaluate(() => document.activeElement?.matches?.('[data-chsearch]')), 'the field opens focused');
        await page.keyboard.type('Dentist');
        await vis('.ch-list [data-chopen="qa-needs"]').waitFor({ timeout: 8000 });
        await nap(400);
        assert.ok(!(await page.locator('.ch-list [data-chopen="qa-new"]').filter({ visible: true }).count()), 'search narrows the list');
        await shot('3-search');
        await vis('.ch-tbar [data-chtbsearch]').click();
        await nap(600);
        const closed = await bar();
        assert.ok(!closed.field && closed.rows.length === B.rows.length, 'the icon closes search and the Inbox is back ' + JSON.stringify(closed));
        // The title follows the tab.
        await vis('.ch-tabbar [data-chtab="tags"]').click(); await nap(700);
        entry.tags = await bar(); assert.equal(entry.tags.title, 'Tags', 'Tags tab'); assert.equal(entry.tags.n, '', 'no Inbox count on Tags');
        await shot('4-tags');
        await vis('.ch-tabbar [data-chtab="sent"]').click(); await nap(900);
        entry.sent = await bar(); assert.equal(entry.sent.title, 'Sent', 'Sent tab'); assert.ok(!entry.sent.backRow, 'no second "Sent" back row');
        await shot('5-sent');
        await vis('.ch-tabbar [data-chtab="inbox"]').click(); await nap(700);
        assert.equal((await bar()).title, 'Inbox', 'back on Inbox');
        // Archive a row: the Archived fold at the bottom stays a fold.
        if (ROWS) {
          await vis('.ch-list [data-chibarch="qa-read"]').click();
          await page.waitForFunction(() => !!document.querySelector('.ch-list section[data-sec="archived"]'), null, { timeout: 5000 });
          await nap(900);
          entry.archived = await bar();
          assert.ok(entry.archived.secs.includes('archived:fold'), 'Archived keeps its fold ' + JSON.stringify(entry.archived.secs));
          assert.ok(!entry.archived.secs.includes('ready:fold'), 'Inbox has none');
          assert.equal(entry.archived.n, String(entry.archived.rows.length), 'the count follows');
          await shot('6-archived');
        }
        assert.equal(entry.errors.length, 0, 'browser errors: ' + entry.errors.join('; '));
        assert.equal(entry.refused.filter(x => x.reason === 'unexpected-write').length, 0, 'unexpected writes: ' + JSON.stringify(entry.refused));
        entry.pass = true;
      } catch (e) { entry.failure = e.stack; const pages = context.pages(); if (pages[0]) { entry.body = (await pages[0].locator('body').innerText().catch(() => '')).slice(0, 1500); await pages[0].screenshot({ path: path.join(out, stem + '-failure.png') }).catch(() => {}); } }
      finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await context.close(); }
    }
  } finally { await browser.close(); }
  const failed = report.cases.filter(c => !c.pass);
  console.log(JSON.stringify({ cases: report.cases.length, passed: report.cases.length - failed.length, failed: failed.map(c => c.stem + ': ' + String(c.failure).split('\n')[0]), screenshots: fs.readdirSync(out).filter(f => f.endsWith('.png')).length }));
  if (failed.length || !report.cases.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
