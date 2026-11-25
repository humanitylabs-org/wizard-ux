'use strict';
// The bottom tabs Inbox · Tags · Sent in the AI apps desktop's Chats sidebar pane (wizard-ux issue 1807, a part of issue
// 1778; on for everyone since issue 1778, no switch) in a real browser. Same disposable synthetic box as
// tests/qa-chats-sent-tab.cjs: a Sent log (GET /wizard/v1/sent, POST /wizard/v1/sent/<id>/correct), an agent inbox with
// one running task whose worker thread is hidden but reads by id.
// Desktop 1440x960, wos.desktop-view.v1 = ai-apps, Nebula + Light (obsidian-light):
//   the sidebar pane has Inbox · Tags · Sent at its bottom (Inbox on) and no Channels | Activity toggle at the top;
//   Inbox keeps the sidebar's own rows (Working, Ready); Tags shows the channel list; Sent lists every capture with
//   route, state, why and the two corrections; a correction posts and the row changes in place; a tap opens its thread
//   in the main chat column; Esc from Sent returns to Inbox.
// QA_EXPECT=broken: the run on main must show the bug (no tabs in the pane, the toggle still at the top).
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://chats-sent-ai-apps.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'chats-sent-tab-ai-apps-evidence');
const broken = process.env.QA_EXPECT === 'broken';
const SKINS = (process.env.QA_SKINS || 'nebula,obsidian-light').split(',');
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms)), M = 60e3, H = 36e5;
const THREADS = {
  'qa-chat-1': { title: 'Weather tomorrow', at: now - 20 * M, hidden: false, msgs: [['user', 'Tell me the weather tomorrow', 0], ['assistant', 'Sunny, 18 °C, light wind.', 30]] },
  'qa-chat-2': { title: 'Dentist slot', at: now - 50 * M, hidden: false, msgs: [['user', 'Find a dentist slot this week', 0], ['assistant', 'Thursday 10:00 is free at the practice on Main Street.', 60]] },
  'qa-worker-1': { title: 'Call mom', at: now - 3 * M, hidden: true, msgs: [['user', 'Note to self: call mom about Sunday lunch', 0], ['assistant', 'Added a reminder to call mom about Sunday lunch.', 20]] },
};
const id = c => 'sent_' + c.repeat(24), rid = c => 'inbox_' + c.repeat(24);
let SENT = [
  { id: id('a'), at: now - 3 * M, source: 'orb', text: 'Note to self: call mom about Sunday lunch', route: 'dump', decided_by: 'owner_words', rules_matched: ['no_reply:note to self'], model: '', tags: [], urgent: false, thread_id: 'qa-worker-1', record_id: rid('a'), state: 'running' },
  { id: id('b'), at: now - 20 * M, source: 'orb', text: 'Tell me the weather tomorrow', route: 'agent', decided_by: 'owner_words', rules_matched: ['wants_reply:tell me'], model: 'fast', tags: [], urgent: false, thread_id: 'qa-chat-1', record_id: null, state: 'done' },
  { id: id('c'), at: now - 50 * M, source: 'typed', text: 'Find a dentist slot this week', route: 'agent', decided_by: 'owner_words', rules_matched: ['typed'], model: '', tags: [], urgent: false, thread_id: 'qa-chat-2', record_id: null, state: 'done', would_route: 'dump', would_decided_by: 'model', would_rules: [] },
  { id: id('d'), at: now - 2 * H, source: 'orb', text: 'Book a table for four on Friday #family', route: 'dump', decided_by: 'model', rules_matched: ['tag:family'], model: 'fast', confidence: 0.82, tags: ['family'], urgent: false, thread_id: null, record_id: rid('d'), state: 'needs_you' },
  { id: id('e'), at: now - 3 * H, source: 'side', text: 'What is on my calendar', route: 'agent', decided_by: 'fallback', rules_matched: ['router_timeout'], model: 'fast', tags: [], urgent: false, thread_id: null, record_id: null, state: 'failed', error: 'router_timeout' },
];
const RECORDS = [{ id: rid('a'), agent: 'hermes', thread_id: 'qa-worker-1', state: 'running', kind: 'note', title: 'Call mom', last_update: 'Adding the reminder', created_at: now - 3 * M, updated_at: now - 2 * M }];
const raw = (sid, s) => ({ id: sid, title: s.title, runtime: 'direct', status: 'completed', updated_at: iso(s.at), updatedAt: iso(s.at), last_active: s.at / 1000, message_count: s.msgs.length, messageCount: s.msgs.length, preview: s.msgs.at(-1)?.[1] || '', ...(s.hidden ? { hidden: true } : {}) });
const report = { origin, web, broken, cases: [] };
(async () => {
  const browser = await chromium.launch();
  try {
    for (const skin of SKINS) {
      const stem = `ai-apps-${skin}${broken ? '-main' : ''}`;
      const entry = { stem, errors: [], refused: [], writes: [], sentReads: 0, corrections: [] }; report.cases.push(entry);
      SENT = SENT.map(r => { const { corrected, ...rest } = r; return rest; });
      const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, serviceWorkers: 'block' });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        const mix = { 'wizard/desktop-chats': true };
        await context.addInitScript(({ skin, mix }) => {
          if (window !== top) return;
          if (sessionStorage.getItem('qaBoot')) return; sessionStorage.setItem('qaBoot', '1');
          for (const [k, v] of Object.entries({ 'wos.shell': 'desktop', 'wux.shell': 'desktop', 'wos.desktop-view.v1': 'ai-apps', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
            'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v);
        }, { skin, mix });
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
          if (u.origin !== origin) { entry.refused.push({ method, url: q.url(), reason: 'external' }); return r.abort(); }
          const fix = /^\/wizard\/v1\/sent\/(sent_[a-f0-9]{24})\/correct$/.exec(p);
          if (fix && method === 'POST') {
            const body = q.postDataJSON(); entry.corrections.push({ id: fix[1], body });
            await nap(400);
            SENT = SENT.map(x => x.id === fix[1] ? { ...x, corrected: { should_reply: body.should_reply, at: Date.now() }, correction_id: 'ex_1' } : x);
            return r.fulfill({ json: { row: SENT.find(x => x.id === fix[1]), changed: true } });
          }
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
          if (p === '/wizard/v1/sent') { entry.sentReads++; return r.fulfill({ json: { rows: SENT, next: null, check: null } }); }
          if (p === '/wizard/v1/agent-inbox') return r.fulfill({ json: { records: RECORDS, check: null } });
          const one = /^\/wizard\/v1\/agent-inbox\/(inbox_[a-f0-9]{24})$/.exec(p);
          if (one) { const rec = RECORDS.find(x => x.id === one[1]); return rec ? r.fulfill({ json: { record: rec } }) : r.fulfill({ status: 404, json: { error: 'not_found' } }); }
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
          if (p === '/wizard/v1/channels') return r.fulfill({ json: { schema: 'wizard.channels/1', sort: 'az', channels: [] } });
          if (p === '/wizard/v1/channels/read') return r.fulfill({ json: { at: {} } });
          if (p === '/wizard/hermes/api/sessions' && u.searchParams.has('channel')) return r.fulfill({ json: { object: 'list', data: [], offset: 0, limit: 100, has_more: false, snapshot: 'snap', window: 'channel', channel: u.searchParams.get('channel'), order: 'oldest', channel_total: 0, view: 'list', list_version: 1 } });
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: Object.entries(THREADS).filter(([, s]) => !s.hidden).map(([sid, s]) => raw(sid, s)), has_more: false } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) {
            const sid = decodeURIComponent(m[1]), s = THREADS[sid]; if (!s) return r.fulfill({ status: 404, json: { error: 'missing' } });
            entry.reads = (entry.reads || []).concat(sid + (m[2] ? ':messages' : ''));
            const t0 = s.at / 1000 - 600;
            return r.fulfill({ json: m[2] ? { messages: s.msgs.map(([role, content, dt]) => ({ role, content, timestamp: t0 + dt })) } : { session: raw(sid, s) } });
          }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + prefix + 'desktop.html');
        await page.waitForFunction(() => window.__wux && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
        await page.waitForFunction(() => document.documentElement.dataset.layout === 'ai-apps', null, { timeout: 15000 });
        await page.waitForFunction(() => (document.documentElement.dataset.tweaks || '').split(' ').includes('wizard/desktop-chats'), null, { timeout: 15000 });
        const vis = sel => page.locator(sel).filter({ visible: true }).first();
        const count = sel => page.locator(sel).filter({ visible: true }).count();
        const sideRow = sid => vis(`.aad-side .aad-rw[data-sid="${sid}"] .aad-row`);
        await sideRow('qa-chat-1').waitFor({ timeout: 15000 });
        await page.evaluate(() => document.fonts.ready); await nap(800);
        const shot = async name => { await page.evaluate(() => document.fonts.ready); await nap(300); await page.screenshot({ path: path.join(out, `${stem}-${name}.png`) }); };
        const pane = '.aad-side .aad-chan';
        entry.toggle = await count(`${pane} .ch-chan-tabs [data-chview]`);
        entry.tabbar = await count(`${pane} .ch-tabbar`);
        if (broken) {
          await shot('before');
          assert.equal(entry.tabbar, 0, 'main: no bottom tabs in the pane');
          assert.equal(entry.toggle, 2, 'main: the Channels | Activity toggle is at the top');
          entry.pass = true; continue;
        }
        // 1. Inbox: the pane's bottom tabs, Inbox selected; no top toggle; the sidebar's own rows stay above the tabs.
        await vis(`${pane} .ch-tabbar`).waitFor({ timeout: 10000 });
        const tabs = () => page.locator(`${pane} .ch-tabbar`).filter({ visible: true }).first().locator('[role=tab]').evaluateAll(b => b.map(x => `${x.innerText.trim()}${x.getAttribute('aria-selected') === 'true' ? '*' : ''}`));
        entry.tabs = await tabs();
        assert.deepEqual(entry.tabs, ['Inbox*', 'Tags', 'Sent'], 'three tabs, Inbox on');
        assert.equal(entry.toggle, 0, 'the top Channels | Activity toggle is gone');
        const geo = () => page.evaluate(() => {
          const v = s => [...document.querySelectorAll(s)].find(n => n.getClientRects().length);
          const box = n => { const b = n?.getBoundingClientRect(); return b ? { top: Math.round(b.top), bottom: Math.round(b.bottom), height: Math.round(b.height), left: Math.round(b.left), right: Math.round(b.right) } : null; };
          const bar = v('.aad-side .ch-tabbar'), panel = v('.aad-side .aad-panel'), rows = [...document.querySelectorAll('.aad-side .aad-scroll .aad-row')].filter(n => n.getClientRects().length);
          return { bar: box(bar), panel: box(panel), lastRow: box(rows.at(-1)), rows: rows.length, foot: box(v('.aad-side .aad-foot')), barBg: bar ? getComputedStyle(bar).backgroundColor : '' };
        });
        entry.geometry = await geo();
        assert.ok(entry.geometry.rows >= 2, 'Inbox keeps the sidebar rows: ' + JSON.stringify(entry.geometry));
        assert.ok(entry.geometry.lastRow.bottom <= entry.geometry.bar.top + 1, 'the rows sit above the tabs: ' + JSON.stringify(entry.geometry));
        assert.ok(entry.geometry.panel.bottom - entry.geometry.bar.bottom <= (entry.geometry.foot ? entry.geometry.foot.height + 2 : 2), 'the tabs sit at the bottom of the pane: ' + JSON.stringify(entry.geometry));
        assert.ok(entry.geometry.bar.height >= 48, 'thumb-size tabs');
        assert.doesNotMatch(entry.geometry.barBg, /rgba\(.*, 0\)|transparent/, 'opaque tab bar: ' + entry.geometry.barBg);
        await shot('1-inbox');
        // 2. Tags: the channel list in the pane (the sidebar rows make room); Inbox again brings them back.
        await vis(`${pane} .ch-tabbar [data-chtab="tags"]`).click();
        await vis(`${pane} .ch-chan-list`).waitFor({ timeout: 8000 });
        assert.deepEqual(await tabs(), ['Inbox', 'Tags*', 'Sent']);
        assert.equal(await count('.aad-side .aad-scroll .aad-row'), 0, 'Tags: the channel list in place of the rows');
        await shot('2-tags');
        await vis(`${pane} .ch-tabbar [data-chtab="inbox"]`).click();
        await sideRow('qa-chat-1').waitFor({ timeout: 8000 });
        // 3. Sent: every capture newest first, with route, state and why, in the pane.
        await vis(`${pane} .ch-tabbar [data-chtab="sent"]`).click();
        await vis(`${pane} .ch-sent-row`).waitFor({ timeout: 8000 });
        assert.deepEqual(await tabs(), ['Inbox', 'Tags', 'Sent*']);
        assert.equal(await count('.aad-side .aad-scroll .aad-row'), 0, 'Sent: its rows in place of the sidebar rows');
        const rows = () => page.locator(`${pane} .ch-sent-row`).filter({ visible: true }).evaluateAll(b => b.map(x => x.querySelector('.ch-sent-open').innerText.replace(/\s+/g, ' ').trim()));
        entry.rows = await rows();
        assert.equal(entry.rows.length, 5, 'one row per capture: ' + JSON.stringify(entry.rows));
        assert.match(entry.rows[0], /Note to self: call mom.*Background · Running · you said note to self/, entry.rows[0]);
        assert.match(entry.rows[1], /Tell me the weather tomorrow.*Thread · Done · you said tell me/, entry.rows[1]);
        assert.match(entry.rows[2], /Find a dentist slot.*Thread · Done · you typed it.*would have gone to background/, entry.rows[2]);
        assert.match(entry.rows[3], /Book a table.*Background · Needs you · model.*#family/, entry.rows[3]);
        assert.match(entry.rows[4], /What is on my calendar.*Thread · Failed · fallback: router timed out/, entry.rows[4]);
        assert.equal(await count(`${pane} .ch-sent-row [data-chsentfix]`), 10, 'two correction buttons on every row');
        entry.sentGeometry = await page.evaluate(() => {
          const v = s => [...document.querySelectorAll(s)].find(n => n.getClientRects().length);
          const r = v('.aad-side .ch-sent-row').getBoundingClientRect(), p = v('.aad-side .aad-panel').getBoundingClientRect(), bar = v('.aad-side .ch-tabbar').getBoundingClientRect();
          return { rowLeft: r.left - p.left, rowRight: p.right - r.right, rowTop: r.top, barTop: bar.top, rowBg: getComputedStyle(v('.aad-side .ch-sent-row')).backgroundColor };
        });
        assert.ok(entry.sentGeometry.rowLeft >= 0 && entry.sentGeometry.rowRight >= 0 && entry.sentGeometry.rowTop < entry.sentGeometry.barTop, 'rows inside the pane, above the tabs: ' + JSON.stringify(entry.sentGeometry));
        assert.doesNotMatch(entry.sentGeometry.rowBg, /rgba\(.*, 0\)|transparent/, 'opaque row panels');
        await shot('3-sent');
        // 4. Didn't need a reply on the weather row: the correction goes to the box, the row changes in place.
        const fixBtn = page.locator(`${pane} .ch-sent-row[data-morph-key="sent:${id('b')}"] [data-chsentfix="quiet"]`).filter({ visible: true }).first();
        await fixBtn.click();
        await page.waitForFunction(sid => [...document.querySelectorAll(`.aad-side .ch-sent-row[data-morph-key="sent:${sid}"] [data-chsentfix="quiet"]`)].some(b => b.getClientRects().length && b.getAttribute('aria-pressed') === 'true' && !b.disabled), id('b'), { timeout: 5000 });
        assert.deepEqual(entry.corrections, [{ id: id('b'), body: { should_reply: false } }], 'one correction posted');
        assert.equal((await rows()).length, 5, 'still every row (in place)');
        // 5. Working: only what still runs.
        await vis(`${pane} [data-chsentfilter="working"]`).click(); await nap(200);
        assert.equal((await rows()).length, 1, 'Working: the running one only');
        await vis(`${pane} [data-chsentfilter="all"]`).click(); await nap(200);
        // 6. A tap opens the hidden worker thread by id in the main chat column; the pane stays on Sent.
        await vis(`${pane} [data-chsentopen="${id('a')}"]`).click();
        const thread = () => page.locator('.ch-thread').filter({ visible: true }).first();
        await thread().getByText('Added a reminder to call mom about Sunday lunch.').waitFor({ timeout: 10000 });
        assert.ok(entry.reads.some(x => x.startsWith('qa-worker-1')), 'read by id');
        entry.threadBox = await thread().evaluate(n => { const b = n.getBoundingClientRect(), s = document.querySelector('.aad-side .aad-panel').getBoundingClientRect(); return { left: b.left, mid: b.left + b.width / 2, sideRight: s.right }; });
        assert.ok(entry.threadBox.mid > entry.threadBox.sideRight + 200, 'the thread opens in the main column, beside the pane: ' + JSON.stringify(entry.threadBox));
        assert.equal(await count(`${pane} .ch-sent-row`), 5, 'the pane still shows Sent');
        await shot('4-thread');
        // 7. Esc from Sent (focus in the pane): Inbox again.
        await page.keyboard.press('Escape'); await nap(500); // closes the thread
        await vis(`${pane} .ch-sent-h`).click();
        await page.evaluate(() => __wux.escStep()); await nap(500);
        assert.equal(await count(`${pane} .ch-sent-h`), 0, 'Esc from Sent leaves Sent');
        await sideRow('qa-chat-1').waitFor({ timeout: 8000 });
        assert.deepEqual(await tabs(), ['Inbox*', 'Tags', 'Sent'], 'Esc from Sent: Inbox');
        assert.equal(entry.errors.length, 0, 'browser errors: ' + entry.errors.join('; '));
        assert.deepEqual(entry.refused.filter(x => x.reason === 'unexpected-write'), [], 'no unexpected writes');
        entry.pass = true;
      } catch (e) { entry.failure = e.stack; const pages = context.pages(); if (pages[0]) { entry.body = (await pages[0].locator('body').innerText().catch(() => '')).slice(0, 1500); await pages[0].screenshot({ path: path.join(out, stem + '-failure.png') }).catch(() => {}); } }
      finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await context.close(); }
    }
  } finally { await browser.close(); }
  const failed = report.cases.filter(c => !c.pass);
  console.log(JSON.stringify({ cases: report.cases.length, passed: report.cases.length - failed.length, failed: failed.map(c => c.stem + ': ' + String(c.failure).split('\n')[0]), screenshots: fs.readdirSync(out).filter(f => f.endsWith('.png')).length }));
  if (failed.length || !report.cases.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
