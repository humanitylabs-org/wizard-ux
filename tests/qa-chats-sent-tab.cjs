'use strict';
// Chats Sent tab and the bottom tabs Inbox · Tags · Sent (switch wizard/chats-inbox, needs wizard/agent-inbox;
// wizard-ux issue 1778) in a real browser. Disposable synthetic transport only: a fake box keeps a Sent log
// (GET /wizard/v1/sent, POST /wizard/v1/sent/<id>/correct) and an agent inbox with one running task; its worker thread
// is hidden (stock Hermes leaves hidden sessions out of /api/sessions) but reads by id.
// Phone 412x915 and Classic desktop 1440x960, Nebula + Light (obsidian-light):
//   Chats has Inbox · Tags · Sent at the bottom (Inbox on), no Channels | Activity toggle at the top, no Running row,
//   the + button floats above the tabs; Tags shows the Channels list; Sent lists every capture newest first with
//   route, state and why ("would have gone to background" on a typed row); Working shows only what runs; Didn't need a
//   reply posts the correction and the row changes in place; a tap opens the (hidden) thread; Back returns to Sent,
//   Back again to Inbox, Back again leaves the app open.
// QA_ONLY_OFF=1: wizard/chats-inbox stays off (agent-inbox on); writes the list markup to off-<stem>.html (diff it
// against a run with QA_WEB=<main>/web) and checks that nothing asks for the Sent log.
// QA_SHOTS=1 also writes the phone shots named for the pitch (before/after).
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://chats-sent-tab.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'chats-sent-tab-evidence');
const off = process.env.QA_ONLY_OFF === '1';
const SHELLS = (process.env.QA_SHELLS || 'phone,classic').split(','), SKINS = (process.env.QA_SKINS || 'nebula,obsidian-light').split(',');
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
const report = { origin, web, off, cases: [] };
(async () => {
  const browser = await chromium.launch();
  try {
    for (const shell of SHELLS) for (const skin of SKINS) {
      const phone = shell === 'phone', stem = `${shell}-${skin}${off ? '-off' : ''}`;
      const entry = { stem, errors: [], refused: [], writes: [], sentReads: 0, corrections: [] }; report.cases.push(entry);
      SENT = SENT.map(r => { const { corrected, ...rest } = r; return rest; });
      const context = await browser.newContext({ viewport: phone ? { width: 412, height: 915 } : { width: 1440, height: 960 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', ...(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' } : {}) });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        const mix = { 'wizard/desktop-chats': true, 'wizard/agent-inbox': true, ...(off ? {} : { 'wizard/chats-inbox': true }) };
        await context.addInitScript(({ shell, skin, mix }) => {
          if (window !== top) return;
          if (sessionStorage.getItem('qaBoot')) return; sessionStorage.setItem('qaBoot', '1');
          for (const [k, v] of Object.entries({ 'wos.shell': shell === 'phone' ? 'phone' : 'desktop', 'wux.shell': shell === 'phone' ? 'phone' : 'desktop', 'wos.desktop-view.v1': 'classic', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
            'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v);
        }, { shell, skin, mix });
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
          if (u.origin !== origin) { entry.refused.push({ method, url: q.url(), reason: 'external' }); return r.abort(); }
          const fix = /^\/wizard\/v1\/sent\/(sent_[a-f0-9]{24})\/correct$/.exec(p);
          if (fix && method === 'POST') {
            const body = q.postDataJSON(); entry.corrections.push({ id: fix[1], body });
            await nap(400); // the box takes a moment: the buttons wait, then the row changes in place
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
        await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
        await page.waitForFunction(() => (window.__wux || window.__wos) && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
        await page.waitForFunction(want => want.every(t => (document.documentElement.dataset.tweaks || '').split(' ').includes(t)), off ? ['wizard/agent-inbox'] : ['wizard/agent-inbox', 'wizard/chats-inbox'], { timeout: 15000 });
        if (phone) await page.evaluate(() => __wos.openSheet('inbox')); else await page.evaluate(() => __wux.openChatsList());
        const vis = sel => page.locator(sel).filter({ visible: true }).first();
        const count = sel => page.locator(sel).filter({ visible: true }).count();
        const back = () => page.evaluate(() => window.__wos ? __wos.onBack() : __wux.escStep());
        await vis('.ch-list [data-chopen="qa-chat-1"]').waitFor({ timeout: 15000 });
        const shot = async name => { await page.evaluate(() => document.fonts.ready); await nap(300); await page.screenshot({ path: path.join(out, `${stem}-${name}.png`) }); };
        if (off) {
          await vis('.ch-running').waitFor({ timeout: 10000 });
          await nap(1200);
          assert.equal(await count('.ch-tabbar'), 0, 'switch off: no bottom tabs');
          assert.equal(await count('.ch-chan-tabs [data-chview]'), 2, 'switch off: the Channels | Activity toggle stays');
          assert.equal(entry.sentReads, 0, 'switch off: nothing asks for the Sent log');
          const html = await vis('.ch-list').evaluate(n => n.outerHTML.replace(/<time>[^<]*<\/time>/g, '<time></time>').replace(/Running \d+ min/g, 'Running N min'));
          fs.writeFileSync(path.join(out, `off-${stem}.html`), html);
          await shot('before');
          entry.pass = true; continue;
        }
        // 1. Inbox: the bottom tabs, Inbox selected; no top toggle and no Running row; New chat floats above the tabs.
        await vis('.ch-tabbar').waitFor({ timeout: 10000 });
        const tabs = () => page.locator('.ch-tabbar').filter({ visible: true }).first().locator('[role=tab]').evaluateAll(b => b.map(x => `${x.innerText.trim()}${x.getAttribute('aria-selected') === 'true' ? '*' : ''}`));
        entry.tabs = await tabs();
        assert.deepEqual(entry.tabs, ['Inbox*', 'Tags', 'Sent'], 'three tabs, Inbox on');
        assert.equal(await count('.ch-chan-tabs [data-chview]'), 0, 'the top Channels | Activity toggle is gone');
        await nap(800);
        assert.equal(await count('.ch-running'), 0, 'no Running row while the tabs are on');
        entry.geometry = await page.evaluate(() => {
          const v = s => [...document.querySelectorAll(s)].find(n => n.getClientRects().length);
          const bar = v('.ch-tabbar').getBoundingClientRect(), fab = v('.ch-fab')?.getBoundingClientRect(), list = v('.ch-list').getBoundingClientRect();
          return { barTop: bar.top, barBottom: bar.bottom, barH: bar.height, listBottom: list.bottom, fabBottom: fab?.bottom, fabTop: fab?.top, panel: getComputedStyle(v('.ch-tabbar')).backgroundColor };
        });
        assert.ok(entry.geometry.fabBottom && entry.geometry.fabBottom <= entry.geometry.barTop + 1, '+ floats above the tabs: ' + JSON.stringify(entry.geometry));
        assert.ok(Math.abs(entry.geometry.barBottom - entry.geometry.listBottom) < 2, 'the tabs sit at the bottom of Chats: ' + JSON.stringify(entry.geometry));
        assert.ok(entry.geometry.barH >= 48, 'thumb-size tabs');
        assert.doesNotMatch(entry.geometry.panel, /rgba\(.*, 0\)|transparent/, 'opaque tab bar: ' + entry.geometry.panel);
        await shot('1-inbox');
        // 2. Tags: today's Channels list; Inbox again.
        await vis('.ch-tabbar [data-chtab="tags"]').click();
        await vis('.ch-chan-list').waitFor({ timeout: 8000 });
        assert.deepEqual(await tabs(), ['Inbox', 'Tags*', 'Sent']);
        await shot('2-tags');
        await vis('.ch-tabbar [data-chtab="inbox"]').click();
        await vis('.ch-list [data-chopen="qa-chat-1"]').waitFor({ timeout: 8000 });
        // 3. Sent: every capture newest first, with route, state and why.
        await vis('.ch-tabbar [data-chtab="sent"]').click();
        await vis('.ch-sent-row').waitFor({ timeout: 8000 });
        assert.deepEqual(await tabs(), ['Inbox', 'Tags', 'Sent*']);
        const rows = () => page.locator('.ch-sent-row').filter({ visible: true }).evaluateAll(b => b.map(x => x.querySelector('.ch-sent-open').innerText.replace(/\s+/g, ' ').trim()));
        entry.rows = await rows();
        assert.equal(entry.rows.length, 5, 'one row per capture: ' + JSON.stringify(entry.rows));
        assert.match(entry.rows[0], /Note to self: call mom.*Background · Running · you said note to self/, entry.rows[0]);
        assert.match(entry.rows[1], /Tell me the weather tomorrow.*Thread · Done · you said tell me/, entry.rows[1]);
        assert.match(entry.rows[2], /Find a dentist slot.*Thread · Done · you typed it.*would have gone to background/, entry.rows[2]);
        assert.match(entry.rows[3], /Book a table.*Background · Needs you · model.*#family/, entry.rows[3]);
        assert.match(entry.rows[4], /What is on my calendar.*Thread · Failed · fallback: router timed out/, entry.rows[4]);
        entry.rowPanel = await vis('.ch-sent-row').evaluate(n => getComputedStyle(n).backgroundColor);
        assert.doesNotMatch(entry.rowPanel, /rgba\(.*, 0\)|transparent/, 'opaque row panels: ' + entry.rowPanel);
        await shot('3-sent');
        // 4. Working: only what still runs.
        await vis('[data-chsentfilter="working"]').click(); await nap(200);
        entry.working = await rows();
        assert.equal(entry.working.length, 1, 'Working: the running one only');
        assert.match(entry.working[0], /call mom/);
        await shot('4-working');
        await vis('[data-chsentfilter="all"]').click(); await nap(200);
        // 5. Didn't need a reply on the weather row: the correction goes to the box, the row changes in place.
        const fixBtn = page.locator(`.ch-sent-row[data-morph-key="sent:${id('b')}"] [data-chsentfix="quiet"]`).filter({ visible: true }).first();
        await fixBtn.click();
        await page.waitForFunction(sid => [...document.querySelectorAll(`.ch-sent-row[data-morph-key="sent:${sid}"] [data-chsentfix="quiet"]`)].some(b => b.getClientRects().length && b.disabled), id('b'), { timeout: 3000 });
        await page.waitForFunction(sid => [...document.querySelectorAll(`.ch-sent-row[data-morph-key="sent:${sid}"] [data-chsentfix="quiet"]`)].some(b => b.getClientRects().length && b.getAttribute('aria-pressed') === 'true' && !b.disabled), id('b'), { timeout: 5000 });
        assert.deepEqual(entry.corrections, [{ id: id('b'), body: { should_reply: false } }], 'one correction posted');
        assert.equal((await rows()).length, 5, 'still every row (in place)');
        await shot('5-corrected');
        // 6. A tap opens the hidden worker thread by id; Back → Sent; Back → Inbox; Back again: the app is still open.
        await vis(`[data-chsentopen="${id('a')}"]`).click();
        const thread = () => page.locator('.ch-thread').filter({ visible: true }).first();
        await thread().getByText('Added a reminder to call mom about Sunday lunch.').waitFor({ timeout: 10000 });
        assert.ok(entry.reads.some(x => x.startsWith('qa-worker-1')), 'read by id');
        await shot('6-thread');
        if (phone) { await back(); await nap(500); }
        else { await thread().getByText('Added a reminder to call mom about Sunday lunch.').click(); await back(); await nap(600); }
        await vis('.ch-sent-h').waitFor({ timeout: 8000 });
        assert.equal(await count('.ch-sent-row'), 5, 'Back from the thread: Sent');
        if (!phone) await vis('.ch-sent-h').click();
        await back(); await nap(500);
        assert.equal(await count('.ch-sent-h'), 0, 'Back from Sent leaves Sent');
        await vis('.ch-list [data-chopen="qa-chat-1"]').waitFor({ timeout: 8000 });
        assert.deepEqual(await tabs(), ['Inbox*', 'Tags', 'Sent'], 'Back from Sent: Inbox');
        const url = page.url();
        await back(); await nap(500); await back(); await nap(500);
        assert.equal(page.url(), url, 'Back at Inbox never leaves the app');
        assert.ok(await page.evaluate(() => !!(window.__wos || window.__wux) && document.visibilityState === 'visible'), 'the app is still open');
        // 7. A switch flip repaints at once: off = today's list (toggle and Running row back), on = the tabs again.
        if (phone) await page.evaluate(() => __wos.openSheet('inbox')); else await page.evaluate(() => __wux.openChatsList());
        const flip = on => page.evaluate(on => { const h = document.documentElement, t = (h.dataset.tweaks || '').split(' ').filter(x => x && x !== 'wizard/chats-inbox'); h.dataset.tweaks = (on ? t.concat('wizard/chats-inbox') : t).join(' '); window.dispatchEvent(new CustomEvent('wos:experience')); }, on);
        await flip(false); await nap(300);
        assert.equal(await count('.ch-tabbar'), 0, 'switch off: the tabs go at once');
        await vis('.ch-running').waitFor({ timeout: 5000 });
        assert.equal(await count('.ch-chan-tabs [data-chview]'), 2, 'switch off: the toggle is back');
        await flip(true); await vis('.ch-tabbar').waitFor({ timeout: 3000 });
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
