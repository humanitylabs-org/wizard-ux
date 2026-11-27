'use strict';
// Smart inbox (wizard-ux issue 1883, switch wizard/smart-inbox, off by default) in a real browser. Disposable synthetic
// transport only. Phone 412x915, Classic desktop and the AI apps desktop's Chats sidebar (1440x960), in Nebula and Light
// (obsidian-light). Sent as threads and Inbox until archived are on for everyone (QA_ROWS changes nothing now).
// A copy of a real list: 30 threads, a mix of needs you / check / done / fyi / failed / approval / running, started by
// the owner (a Sent row) or by an agent (watches, schedules, helper results, threads older than the Sent log: no Sent
// row). Several of the agent-started ones are unread. With the switch on, Inbox holds only the blocking needs you, the
// failed runs, the approval and the answers he asked for (10 threads); every other thread is in Sent (20, the 4 running
// ones under Working), never in both. Then, with no reload: a needs-you thread is answered done → it moves to Sent; a
// done thread fails → it moves back to Inbox with one line saying why.
// QA_SWITCH=off: the Inbox and Sent lists' HTML is written to list-<stem>.html, so a run with QA_WEB=<main checkout>/web
// can be compared byte for byte (nothing changes with the switch off). QA_EXPECT=report: print where each thread is,
// assert nothing (how today's lists place the same 30 threads).
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://chats-smart-inbox-1883.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'chats-smart-inbox-evidence');
const SHELLS = (process.env.QA_SHELLS || 'phone,classic,aiapps').split(','), SKINS = (process.env.QA_SKINS || 'nebula,obsidian-light').split(',');
const ON = process.env.QA_SWITCH !== 'off', ROWS = process.env.QA_ROWS !== 'off', REPORT = process.env.QA_EXPECT === 'report';
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms)), M = 60e3;
const att = (state, ask) => ({ state, ask });
// id → { title, at (minutes ago), status, attention, msgs, mine (Sent row extras) or null, unread }
const T = (title, min, o = {}) => ({ title, at: now - min * M, status: 'completed', msgs: [['user', o.said || title, 0], ['assistant', o.answer || (o.attention?.ask) || 'Done.', 30]], ...o });
let THREADS, SENT;
const fresh = () => ({
  // Blocking needs you: Inbox.
  'n-seat': T('Flight seat', 5, { attention: att('needs_you', 'Window or aisle?'), mine: { text: 'Book the Friday flight', route: 'agent' } }),
  'n-lease': T('Lease renewal', 9, { attention: att('needs_you', 'The landlord wants an answer by Friday: renew for one or two years?'), mine: { text: 'Look at the lease renewal', route: 'agent' } }),
  'n-watch': T('Domain transfer', 14, { attention: att('needs_you', 'The registrar needs the auth code from your old account.'), unread: true }),
  'n-sched': T('Weekly payroll', 22, { attention: att('needs_you', 'Payroll is short by €240. Move it from savings?'), unread: true }),
  // Check / confirm asks: Sent (they wait for catch me up).
  'c-signal': T('Signal chat names', 6, { attention: att('check', 'Renamed the chats. Check they look right.'), mine: { text: 'Rename the Signal chats', route: 'agent' } }),
  'c-video': T('Messenger video playback', 11, { attention: att('check', 'The fix went through the builder. Try a video.'), mine: { text: 'Fix the video playback in Messenger', route: 'agent' } }),
  'c-forum': T('Forum setup', 18, { attention: att('check', 'Forum is set up. Have a look.'), unread: true }),
  'c-topbar': T('Chats top bar', 26, { attention: att('check', 'Turned on the two switches. Check it feels right.'), unread: true }),
  // Done: Sent.
  'd-clip': T('Clip edit', 7, { attention: att('done', 'Sent the clip to Miguel.'), mine: { text: 'Send the clip edit to Miguel', route: 'agent', rules_matched: ['task_verb'] } }),
  'd-groceries': T('Groceries', 12, { attention: att('done', 'Ordered for Saturday.'), mine: { text: 'Order the usual groceries for Saturday', route: 'agent', rules_matched: ['task_verb'] } }),
  'd-notes': T('Meeting notes', 16, { attention: att('done', 'Filed the notes.'), mine: { text: 'File these notes', route: 'thread', wants_reply: false, rules_matched: ['statement'] } }),
  'd-backup': T('Nightly backup', 3, { attention: att('done', 'Backup finished, 4.2 GB.'), unread: true }),
  'd-helper': T('Invoice helper', 13, { attention: att('done', 'Matched 12 invoices.'), unread: true }),
  'd-selfheal': T('Self-healing report', 20, { attention: att('done', 'All services healthy.'), unread: true }),
  // FYI: Sent.
  'f-weather': T('Weather', 8, { attention: att('fyi', 'Rain from 4 pm.'), mine: { text: 'Note: check the weather for the hike', route: 'agent', rules_matched: ['task_verb'] } }),
  'f-launch': T('One-week launch plan', 17, { attention: att('fyi', 'Plan updated for Tuesday.'), mine: { text: 'Keep the launch plan current', route: 'thread', wants_reply: false, rules_matched: ['statement'] } }),
  'f-morning': T('Morning report', 30, { attention: att('fyi', 'Three meetings today.'), unread: true }),
  'f-news': T('News watch', 40, { attention: att('fyi', 'Nothing new on the ruling.'), unread: true }),
  // Failed runs: Inbox.
  'x-export': T('Photo export', 10, { status: 'failed', mine: { text: 'Export the album', route: 'agent', state: 'failed' } }),
  'x-sync': T('Calendar sync', 24, { status: 'failed', unread: true }),
  // Approval: Inbox.
  'a-pay': T('Pay the plumber', 4, { status: 'waiting_for_approval', mine: { text: 'Pay the plumber', route: 'agent', state: 'running' } }),
  // Answers he asked for: Inbox.
  'q-mac': T('Mac app', 2, { attention: att('fyi', 'The Mac app build is still running.'), mine: { text: 'is the mac app ready?', route: 'thread', rules_matched: ['short_question'] } }),
  'q-tell': T('Train times', 15, { attention: att('done', 'The last train is 23:40.'), mine: { text: 'Tell me the last train home', route: 'agent', rules_matched: ['wants_reply:tell me'] } }),
  'q-know': T('Contract review', 28, { attention: att('done', 'Reviewed: two clauses to change.'), mine: { text: 'Review the contract and let me know when it is done', route: 'agent', rules_matched: ['task_verb'] } }),
  // Running: Sent › Working, whoever started it.
  'r-photos': T('Photo folder', 1, { status: 'running', mine: { text: 'Clean the photo folder', route: 'agent', state: 'running' } }),
  'r-deck': T('Pitch deck', 2, { status: 'running', mine: { text: 'Draft the pitch deck', route: 'agent', state: 'running' } }),
  'r-watch': T('Price watch', 3, { status: 'running' }),
  'r-sched': T('Inbox sweep', 4, { status: 'running' }),
  // A new chat's first message, nothing asked: Sent.
  'new-chat': T('Shopping list', 19, { attention: att('done', 'Started the list.'), mine: { text: 'Start a shopping list for the party', source: 'new_chat', route: 'agent', rules_matched: ['new_chat'] } }),
  // Older than the Sent log, finished, no status: Sent.
  'old': T('Tax folder', 60, { answer: 'Here is the folder.' }),
});
// Issue 1977: check asks and answers to his words (no keyword test) are Inbox too; Sent keeps what he didn't start.
const INBOX_WANT = ['a-pay', 'c-forum', 'c-signal', 'c-topbar', 'c-video', 'd-clip', 'd-groceries', 'd-notes', 'f-launch', 'f-weather', 'n-lease', 'n-sched', 'n-seat', 'n-watch', 'new-chat', 'q-know', 'q-mac', 'q-tell', 'x-export', 'x-sync'];
const sid = n => 'sent_' + n.toString(16).padStart(24, '0');
const freshSent = () => Object.entries(THREADS).filter(([, s]) => s.mine).map(([id, s], i) => ({ id: sid(i + 1), at: s.at - 60e3, source: 'orb', text: s.mine.text, route: 'agent', decided_by: 'owner_words', rules_matched: [], tags: [], urgent: false, thread_id: id, record_id: null, state: 'done', wants_reply: true, ...s.mine }));
const raw = (id, s) => ({ id, title: s.title, runtime: 'direct', status: s.status || 'completed', updated_at: iso(s.at), updatedAt: iso(s.at), last_active: s.at / 1000,
  message_count: s.msgs.length, messageCount: s.msgs.length, preview: s.msgs.at(-1)?.[1] || '', preview_role: s.msgs.at(-1)?.[0], last_assistant_at: iso(s.at),
  ...(s.attention ? { wizard_attention: s.attention } : {}) });
// Read up to now, except the unread ones (their newest answer is after the seen mark).
const SEEN = () => ({ state: { initializedAt: 1, threads: Object.fromEntries(Object.entries(THREADS).map(([id, s]) => [id, s.unread ? { updatedAt: iso(s.at - 3600e3), assistantActivityAt: iso(s.at - 3600e3), seenAt: s.at - 3600e3 } : { updatedAt: iso(s.at), assistantActivityAt: iso(s.at), seenAt: now }])) } });
const report = { origin, web, on: ON, rows: ROWS, cases: [] };
(async () => {
  const browser = await chromium.launch();
  try {
    for (const shell of SHELLS) for (const skin of SKINS) {
      const phone = shell === 'phone', aad = shell === 'aiapps', stem = `${shell}-${skin}-${ON ? 'on' : 'off'}`;
      const entry = { stem, errors: [], refused: [], writes: [] }; report.cases.push(entry);
      THREADS = fresh(); SENT = freshSent();
      const context = await browser.newContext({ viewport: phone ? { width: 412, height: 915 } : { width: 1440, height: 960 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', ...(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' } : {}) });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        const mix = { 'wizard/desktop-chats': true, ...(ON ? { 'wizard/smart-inbox': true } : {}) };
        await context.addInitScript(({ shell, skin, mix }) => {
          if (window !== top) return;
          if (sessionStorage.getItem('qaBoot')) return; sessionStorage.setItem('qaBoot', '1');
          for (const [k, v] of Object.entries({ 'wos.shell': shell === 'phone' ? 'phone' : 'desktop', 'wux.shell': shell === 'phone' ? 'phone' : 'desktop', 'wos.desktop-view.v1': shell === 'aiapps' ? 'ai-apps' : 'classic', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
            'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v);
        }, { shell, skin, mix });
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
          if (u.origin !== origin) { entry.refused.push({ method, url: q.url(), reason: 'external' }); return r.abort(); }
          if (!['GET', 'HEAD'].includes(method)) {
            entry.writes.push({ method, path: p });
            if (method === 'PUT' && p === '/wizard/thread-seen') return r.fulfill({ json: { ok: true, state: q.postDataJSON() } });
            if (method === 'PUT' && p === '/wizard/v1/channels/read') return r.fulfill({ json: { at: {} } });
            if (['PATCH', 'PUT'].includes(method) && p === '/wizard/v1/ui-preferences') return r.fulfill({ json: {} });
            entry.refused.push({ method, path: p, reason: 'unexpected-write' }); return r.fulfill({ status: 405, json: { error: 'Synthetic fixture refuses this write' } });
          }
          if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
          if (p.startsWith(prefix)) {
            const f = decodeURIComponent(p.slice(prefix.length) || 'index.html'), abs = path.resolve(web, f);
            if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
            if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return r.fulfill({ path: abs });
            return r.fulfill({ status: 404, body: 'No synthetic static asset' });
          }
          if (p === '/wizard/v1/sent') return r.fulfill({ json: { rows: SENT, next: null, check: null } });
          if (p === '/wizard/v1/agent-inbox') return r.fulfill({ json: { records: [], check: null } });
          if (p === '/wizard/thread-seen') return r.fulfill({ json: SEEN() });
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
          if (p === '/wizard/v1/channels') return r.fulfill({ json: { schema: 'wizard.channels/1', sort: 'az', channels: [] } });
          if (p === '/wizard/v1/channels/read') return r.fulfill({ json: { at: {} } });
          if (p === '/wizard/hermes/api/sessions' && u.searchParams.has('channel')) return r.fulfill({ json: { object: 'list', data: [], offset: 0, limit: 100, has_more: false, snapshot: 'snap', window: 'channel', channel: u.searchParams.get('channel'), order: 'recent' } });
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: Object.entries(THREADS).map(([id, s]) => raw(id, s)), has_more: false } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) {
            const id = decodeURIComponent(m[1]), s = THREADS[id]; if (!s) return r.fulfill({ status: 404, json: { error: 'missing' } });
            const t0 = s.at / 1000 - 600;
            return r.fulfill({ json: m[2] ? { messages: s.msgs.map(([role, content, dt]) => ({ role, content, timestamp: t0 + dt })) } : { session: raw(id, s) } });
          }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
        await page.waitForFunction(() => (window.__wux || window.__wos) && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
        if (ON) await page.waitForFunction(() => (document.documentElement.dataset.tweaks || '').split(' ').includes('wizard/smart-inbox'), null, { timeout: 15000 });
        if (aad) await page.waitForFunction(() => document.documentElement.dataset.layout === 'ai-apps', null, { timeout: 15000 });
        else if (phone) await page.evaluate(() => __wos.openSheet('inbox')); else await page.evaluate(() => __wux.openChatsList());
        const L = aad ? '.aad-side .aad-chan' : '.ch-list';
        const vis = sel => page.locator(sel).filter({ visible: true }).first();
        const shot = async name => { await page.evaluate(() => document.fonts.ready); await nap(300); await page.screenshot({ path: path.join(out, `${stem}-${name}.png`) }); };
        const openSecs = aad ? async () => { for (const k of ['working', 'ready', 'recent']) { const h = page.locator(`.aad-side .aad-sec[data-sec="${k}"]`).filter({ visible: true }).first(); if (await h.count() && await h.getAttribute('aria-expanded') === 'false') { await h.click(); await nap(250); } } } : async () => { for (const k of ['working', 'ready', 'recent']) { const h = page.locator(`.ch-list section[data-sec="${k}"] > .ch-sec-h, .ch-list section[data-sec="${k}"] .ch-sec-hl > .ch-sec-h`).filter({ visible: true }).first(); if (await h.count() && await h.getAttribute('aria-expanded') === 'false') { await h.click(); await nap(250); } } };
        // Show every row (no "Show all" page cut) so the lists are read whole.
        const showAll = async () => { for (let i = 0; i < 4; i++) { const b = page.locator(`${L} [data-secmore]`).filter({ visible: true }).first(); if (!await b.count()) break; await b.click(); await nap(300); } };
        // Inbox as a person sees it: thread id → { section, title, line }.
        const inbox = () => page.evaluate(aad => {
          const out = {};
          if (aad) {
            for (const b of document.querySelectorAll('.aad-side .aad-sec-b[id^="aad-sec-"]')) for (const r of b.querySelectorAll('.aad-rw[data-sid]')) if (r.getClientRects().length) out[r.dataset.sid] = { sec: b.id.slice(8), title: (r.querySelector('.aad-row-t')?.innerText || '').split('\n')[0].trim(), line: r.innerText.replace(/\s+/g, ' ').trim() };
            return out;
          }
          const list = [...document.querySelectorAll('.ch-list')].find(n => n.getClientRects().length);
          for (const s of list.querySelectorAll('section.ch-sec[data-sec]')) for (const r of s.querySelectorAll('[data-chopen]')) if (r.getClientRects().length && !r.closest('.ch-st')) out[r.dataset.chopen] = { sec: s.dataset.sec, title: (r.querySelector('.ch-ib-t') || r.querySelector('.tt, b'))?.innerText.trim() || '', line: r.innerText.replace(/\s+/g, ' ').trim() };
          return out;
        }, aad);
        const sentRows = () => page.evaluate(L => [...document.querySelectorAll(`${L} [data-part="thread-row"], ${L} [data-chsent], ${L} [data-chsentopen]`)].filter(n => n.getClientRects().length && n.closest('.ch-st, .ch-sr, .ch-sent')).map(n => ({
          key: n.dataset.chsentthread || n.dataset.chopen || n.dataset.chsent || n.dataset.chsentopen || '', title: (n.querySelector('.ch-ib-t') || n.querySelector('b'))?.innerText.trim() || '', sec: n.closest('section')?.dataset.sec || '' })), L);
        const tab = async k => { await vis(`${L} .ch-tabbar [data-chtab="${k}"]`).click(); await nap(700); };
        await vis(`${L} .ch-tabbar`).waitFor({ timeout: 15000 });
        await page.waitForFunction(() => window.WizLive?.sentLog?.state?.().ok, null, { timeout: 15000 }); await nap(1500);
        const listHtml = () => page.locator(aad ? `${L} .ch-list` : '.ch-list').filter({ visible: true }).first().evaluate(n => n.outerHTML.replace(/ data-chats="[^"]*"/g, '').replace(/<time>[^<]*<\/time>/g, '<time></time>'));
        const place = async tag => {
          await tab('inbox'); await openSecs(); await showAll(); const i = await inbox(); await shot(tag + '-inbox');
          const iHtml = await listHtml();
          await tab('sent'); await nap(500); await showAll(); const s = await sentRows(); await shot(tag + '-sent');
          const sHtml = await listHtml();
          const inInbox = Object.entries(i).filter(([, v]) => ['ready', 'working', 'recent', 'saved', 'errors', 'Inbox', 'inbox'].includes(v.sec) || /^(ready|working|recent|inbox)/i.test(v.sec)).map(([id]) => id).sort();
          const sentIds = [...new Set(s.map(r => r.key))];
          return { inbox: i, inInbox, sent: s, sentIds, both: inInbox.filter(id => sentIds.includes(id)), html: iHtml + '\n' + sHtml };
        };
        entry.before = await place('1');
        const b = entry.before;
        if (!ON) { fs.writeFileSync(path.join(out, `list-${shell}-${skin}.html`), b.html); }
        delete b.html;
        const all = Object.keys(THREADS).sort();
        entry.summary = { inbox: b.inInbox, sent: b.sentIds.slice().sort(), nowhere: all.filter(id => !b.inInbox.includes(id) && !b.sentIds.includes(id)), both: b.both };
        if (REPORT || !ON) { entry.pass = true; continue; }
        assert.deepEqual(b.both, [], 'Inbox ∩ Sent = ∅: ' + JSON.stringify(b.both));
        assert.deepEqual(b.inInbox, INBOX_WANT, 'Inbox: needs you, check, failed, approval and answers to his words ' + JSON.stringify(b.inInbox));
        assert.deepEqual(b.sentIds.slice().sort(), all.filter(id => !INBOX_WANT.includes(id)), 'Sent: every other thread ' + JSON.stringify(entry.summary));
        const working = b.sent.filter(r => r.sec === 'sentWorking').map(r => r.key).sort();
        assert.deepEqual(working, ['r-deck', 'r-photos', 'r-sched', 'r-watch'], 'Sent › Working: every running thread, whoever started it');
        // A failure says why in one line.
        assert.match(b.inbox['x-sync'].line, /Didn’t finish|couldn’t|isn’t available|Error/, 'failed row says why: ' + b.inbox['x-sync'].line);
        // Live: needs you → done moves to Sent; done → failed moves back to Inbox. No reload.
        THREADS['n-seat'].attention = att('done', 'Booked seat 14A, window.'); THREADS['n-seat'].msgs.push(['user', 'window', 60], ['assistant', 'Booked seat 14A, window.', 90]); THREADS['n-seat'].at = Date.now();
        SENT = [{ ...SENT.find(r => r.thread_id === 'n-seat'), id: sid(99), at: Date.now() - 1000, text: 'Tapped Window · Flight seat\n[WIZARD_TAPS_V1]{"taps":[]}[/WIZARD_TAPS_V1]', route: 'thread', wants_reply: false, rules_matched: ['statement'], state: 'done' }, ...SENT];
        THREADS['d-backup'].status = 'failed'; THREADS['d-backup'].attention = undefined; THREADS['d-backup'].at = Date.now();
        await page.evaluate(() => { window.WizLive?.refresh?.(); window.WizLive?.sentLog?.fresh?.(); window.WizLive?.sentLog?.read?.(); });
        await nap(2500);
        entry.moved = await place('2'); delete entry.moved.html;
        assert.deepEqual(entry.moved.both, [], 'never in both after the move');
        assert.ok(!entry.moved.inInbox.includes('n-seat') && entry.moved.sentIds.includes('n-seat'), 'needs you → tapped, done: Sent ' + JSON.stringify(entry.moved.inInbox));
        assert.ok(entry.moved.inInbox.includes('d-backup') && !entry.moved.sentIds.includes('d-backup'), 'done → failed: Inbox ' + JSON.stringify(entry.moved.inInbox));
        assert.equal(entry.errors.length, 0, 'browser errors: ' + entry.errors.join('; '));
        assert.deepEqual(entry.refused.filter(x => x.reason === 'unexpected-write'), [], 'no unexpected writes');
        entry.pass = true;
      } catch (e) { entry.failure = e.stack; const pages = context.pages(); if (pages[0]) { entry.body = (await pages[0].locator('body').innerText().catch(() => '')).slice(0, 1500); await pages[0].screenshot({ path: path.join(out, stem + '-failure.png') }).catch(() => {}); } }
      finally { fs.writeFileSync(path.join(out, `report-${ON ? 'on' : 'off'}.json`), JSON.stringify(report, null, 2)); await context.close(); }
    }
  } finally { await browser.close(); }
  const failed = report.cases.filter(c => !c.pass);
  console.log(JSON.stringify({ on: ON, rows: ROWS, cases: report.cases.length, passed: report.cases.length - failed.length, failed: failed.map(c => c.stem + ': ' + String(c.failure).split('\n')[0]),
    summary: report.cases.map(c => ({ stem: c.stem, inbox: c.summary?.inbox?.length, sent: c.summary?.sent?.length, nowhere: c.summary?.nowhere, both: c.summary?.both })) }, null, 1));
  if (failed.length || !report.cases.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
