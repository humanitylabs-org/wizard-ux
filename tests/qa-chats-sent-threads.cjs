'use strict';
// Sent as threads (wizard-ux issue 1880, switch wizard/sent-threads, off by default) in a real browser. Disposable
// synthetic transport only. Phone 412x915, Classic desktop and the AI apps desktop's Chats sidebar (1440x960), in Nebula
// and Light (obsidian-light), with James's pilot switches (wizard/sent-rows; QA_ROWS=off drops it; Inbox rows are on for everyone).
// Threads and what the box says about each:
//   qa-trip   three sends from him, the agent answered each quietly            → Sent, ONE row titled "Lyon trip"
//   qa-quiet  "Sent to Miguel, done", answered quietly                         → Sent; then it needs him → Inbox; then quiet again → Sent
//   qa-mac    "is the mac app ready?", answered (he asked)                     → Inbox
//   qa-needs  answered needs you                                               → Inbox
//   qa-run    he sent again and it is working now                              → Sent › Working
//   a background task whose hidden worker thread isn't listed (record "Call mom", running) → Sent › Working, titled "Call mom"
// Checked as a person sees it: Inbox ∩ Sent = ∅ by thread id; one Sent row per thread (qa-trip once); every Sent row's
// title is its thread's title (never his words); the same thread shows the same title (and sender, avatar) in Inbox and
// in Sent as it moves, with no reload; no "in Inbox" text in Sent; Working then Processed; the row's actions sheet (hold
// on the phone, right-click on desktop) lists the thread's three sends; a tap opens the thread.
// QA_SWITCH=off: the Sent list's HTML is written to sent-<stem>.html, so a run with QA_WEB=<main checkout>/web can be
// compared byte for byte (nothing changes with the switch off).
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://chats-sent-threads-1880.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'chats-sent-threads-evidence');
const SHELLS = (process.env.QA_SHELLS || 'phone,classic,aiapps').split(','), SKINS = (process.env.QA_SKINS || 'nebula,obsidian-light').split(',');
const ON = process.env.QA_SWITCH !== 'off', ROWS = process.env.QA_ROWS !== 'off';
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms)), M = 60e3;
const fyi = ask => ({ state: 'fyi', ask });
let THREADS, SENT;
const fresh = () => ({
  'qa-trip': { title: 'Lyon trip', at: now - 4 * M, quiet: true, attention: fyi('Booked.'), msgs: [['user', 'Find the cheapest train to Lyon on Saturday', 0], ['assistant', 'The 9:04 is €29.', 20], ['user', 'Take the earlier one', 100], ['assistant', 'Done.', 120], ['user', 'Thanks, that works', 200], ['assistant', 'Booked: the 9:04 train, seat 42.', 220]] },
  'qa-quiet': { title: 'Clip edit', at: now - 6 * M, quiet: true, attention: fyi('Clip edit is with Miguel. Nothing needed from you.'), msgs: [['user', 'Send the clip edit to Miguel', 0], ['assistant', 'Sent.', 20], ['user', 'Sent to Miguel, done', 200], ['assistant', 'Nothing needed from you.', 220]] },
  'qa-mac': { title: 'Mac app', at: now - 8 * M, attention: fyi('The Mac app build is still running.'), msgs: [['user', 'is the mac app ready?', 0], ['assistant', 'The Mac app build is still running.', 30]] },
  'qa-needs': { title: 'Flight booking', at: now - 12 * M, attention: { state: 'needs_you', ask: 'Which seat do you want, window or aisle?' }, msgs: [['user', 'Book the Friday flight', 0], ['assistant', 'Which seat do you want, window or aisle?', 30]] },
  'qa-run': { title: 'Photo folder', at: now - 2 * M, status: 'running', msgs: [['user', 'Clean the photo folder', 0], ['assistant', 'Looking at it.', 20], ['user', 'Keep the RAW files', 100]] },
  'qa-worker': { title: 'Call mom', at: now - 3 * M, hidden: true, msgs: [['user', 'Note to self: call mom about Sunday lunch', 0], ['assistant', 'Adding the reminder.', 20]] },
});
const sid = c => 'sent_' + c.repeat(24), rid = c => 'inbox_' + c.repeat(24);
const S = (c, min, thread, text, extra) => ({ id: sid(c), at: now - min * M, source: 'orb', text, route: 'agent', decided_by: 'owner_words', rules_matched: ['task_verb'], tags: [], urgent: false, thread_id: thread, record_id: null, state: 'done', wants_reply: true, ...extra });
const freshSent = () => [
  S('a', 2, 'qa-run', 'Keep the RAW files', { route: 'thread', state: 'running' }),
  S('e', 3, 'qa-worker', 'Note to self: call mom about Sunday lunch', { route: 'dump', rules_matched: ['no_reply:note to self'], record_id: rid('e'), state: 'running', wants_reply: false }),
  S('1', 4, 'qa-trip', 'Thanks, that works', { route: 'thread', wants_reply: false, quiet: true }),
  S('2', 5, 'qa-trip', 'Take the earlier one', { route: 'thread', wants_reply: false, quiet: true }),
  S('b', 6, 'qa-quiet', 'Sent to Miguel, done', { route: 'thread', rules_matched: ['no_reply:done'], wants_reply: false, quiet: true, answer: 'Nothing needed from you.' }),
  S('c', 8, 'qa-mac', 'is the mac app ready?', { route: 'thread', rules_matched: ['short_question'] }),
  S('d', 12, 'qa-needs', 'Book the Friday flight', { state: 'needs_you' }),
  S('3', 30, 'qa-trip', 'Find the cheapest train to Lyon on Saturday', { wants_reply: false }),
  S('f', 40, 'qa-quiet', 'Send the clip edit to Miguel', {}),
  S('0', 50, 'qa-run', 'Clean the photo folder', {}),
];
const RECORDS = () => [{ id: rid('e'), agent: 'hermes', thread_id: 'qa-worker', state: 'running', kind: 'note', title: 'Call mom', last_update: 'Adding the reminder', created_at: now - 3 * M, updated_at: now - 2 * M }];
const raw = (id, s) => ({ id, title: s.title, runtime: 'direct', status: s.status || 'completed', updated_at: iso(s.at), updatedAt: iso(s.at), last_active: s.at / 1000,
  message_count: s.msgs.length, messageCount: s.msgs.length, preview: s.msgs.at(-1)?.[1] || '', preview_role: s.msgs.at(-1)?.[0],
  ...(s.attention ? { wizard_attention: s.attention } : {}), ...(s.quiet ? { wizard_quiet_reply: true } : {}), ...(s.hidden ? { hidden: true } : {}) });
const SEEN = () => ({ state: { initializedAt: 1, threads: Object.fromEntries(Object.entries(THREADS).map(([id, s]) => [id, { updatedAt: iso(s.at), assistantActivityAt: iso(s.at), seenAt: now }])) } });
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
        const mix = { 'wizard/desktop-chats': true, ...(ROWS ? { 'wizard/sent-rows': true } : { 'wizard/inbox-until-archived': true }), ...(ON ? { 'wizard/sent-threads': true } : {}) };
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
            if (method === 'PATCH' && p === '/wizard/v1/ui-preferences') return r.fulfill({ json: {} });
            if (method === 'PUT' && p === '/wizard/v1/ui-preferences') return r.fulfill({ json: {} });
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
          if (p === '/wizard/v1/agent-inbox') return r.fulfill({ json: { records: RECORDS(), check: null } });
          const one = /^\/wizard\/v1\/agent-inbox\/(inbox_[a-f0-9]{24})$/.exec(p);
          if (one) { const rec = RECORDS().find(x => x.id === one[1]); return rec ? r.fulfill({ json: { record: rec } }) : r.fulfill({ status: 404, json: { error: 'not_found' } }); }
          if (p === '/wizard/thread-seen') return r.fulfill({ json: SEEN() });
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
          if (p === '/wizard/v1/channels') return r.fulfill({ json: { schema: 'wizard.channels/1', sort: 'az', channels: [] } });
          if (p === '/wizard/v1/channels/read') return r.fulfill({ json: { at: {} } });
          if (p === '/wizard/hermes/api/sessions' && u.searchParams.has('channel')) return r.fulfill({ json: { object: 'list', data: [], offset: 0, limit: 100, has_more: false, snapshot: 'snap', window: 'channel', channel: u.searchParams.get('channel'), order: 'recent' } });
          // Stock Hermes leaves hidden worker sessions out of the list; they read by id.
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: Object.entries(THREADS).filter(([, s]) => !s.hidden).map(([id, s]) => raw(id, s)), has_more: false } });
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
        if (ON) await page.waitForFunction(() => (document.documentElement.dataset.tweaks || '').split(' ').includes('wizard/sent-threads'), null, { timeout: 15000 });
        if (aad) await page.waitForFunction(() => document.documentElement.dataset.layout === 'ai-apps', null, { timeout: 15000 });
        else if (phone) await page.evaluate(() => __wos.openSheet('inbox')); else await page.evaluate(() => __wux.openChatsList());
        const L = aad ? '.aad-side .aad-chan' : '.ch-list';
        const vis = sel => page.locator(sel).filter({ visible: true }).first();
        const shot = async name => { await page.evaluate(() => document.fonts.ready); await nap(300); await page.screenshot({ path: path.join(out, `${stem}-${name}.png`) }); };
        const openSecs = aad ? async () => { for (const k of ['working', 'ready', 'recent']) { const h = page.locator(`.aad-side .aad-sec[data-sec="${k}"]`).filter({ visible: true }).first(); if (await h.count() && await h.getAttribute('aria-expanded') === 'false') { await h.click(); await nap(250); } } } : async () => { for (const k of ['working', 'ready', 'recent']) { const h = page.locator(`.ch-list section[data-sec="${k}"] > .ch-sec-h, .ch-list section[data-sec="${k}"] .ch-sec-hl > .ch-sec-h`).filter({ visible: true }).first(); if (await h.count() && await h.getAttribute('aria-expanded') === 'false') { await h.click(); await nap(250); } } };
        // Inbox as a person sees it: thread id → { section, title, from }.
        const inbox = () => page.evaluate(aad => {
          const out = {};
          if (aad) {
            for (const b of document.querySelectorAll('.aad-side .aad-sec-b[id^="aad-sec-"]')) for (const r of b.querySelectorAll('.aad-rw[data-sid]')) if (r.getClientRects().length) out[r.dataset.sid] = { sec: b.id.slice(8), title: (r.querySelector('.aad-row-t')?.innerText || '').split('\n')[0].trim() };
            return out;
          }
          const list = [...document.querySelectorAll('.ch-list')].find(n => n.getClientRects().length);
          for (const s of list.querySelectorAll('section.ch-sec[data-sec]')) for (const r of s.querySelectorAll('[data-chopen]')) if (r.getClientRects().length) out[r.dataset.chopen] = { sec: s.dataset.sec, title: (r.querySelector('.ch-ib-t') || r.querySelector('.tt, b'))?.innerText.trim() || '', from: r.querySelector('.ch-ib-from')?.innerText.trim() || '', av: r.querySelector('.ch-ib-av')?.innerHTML || '' };
          return out;
        }, aad);
        // Sent as a person sees it: each visible row, the thread it is, its title, sender, avatar and the words on it.
        const sentRows = () => page.evaluate(L => [...document.querySelectorAll(`${L} [data-part="thread-row"]`)].filter(n => n.getClientRects().length && n.closest('.ch-st')).map(n => ({
          key: n.dataset.chsentthread || '', open: n.dataset.chopen || '', title: n.querySelector('.ch-ib-t')?.innerText.trim() || '', from: n.querySelector('.ch-ib-from')?.innerText.trim() || '', av: n.querySelector('.ch-ib-av')?.innerHTML || '',
          sec: n.closest('section')?.dataset.sec || '', text: n.innerText.replace(/\s+/g, ' ').trim() })), L);
        const tab = async k => { await vis(`${L} .ch-tabbar [data-chtab="${k}"]`).click(); await nap(700); };
        await vis(`${L} .ch-tabbar`).waitFor({ timeout: 15000 });
        await page.waitForFunction(() => window.WizLive?.sentLog?.state?.().ok, null, { timeout: 15000 }); await nap(1500);
        if (!ON) {
          await tab('sent'); await nap(800);
          fs.writeFileSync(path.join(out, `sent-${shell}-${skin}.html`), await page.locator(aad ? `${L} .ch-list` : '.ch-list').filter({ visible: true }).first().evaluate(n => n.outerHTML.replace(/ data-chats="[^"]*"/g, '')));
          await shot('2-sent'); entry.pass = true; continue;
        }
        const place = async tag => {
          await tab('inbox'); await openSecs(); const i = await inbox(); await shot(tag + '-inbox');
          await tab('sent'); await vis(`${L} .ch-st [data-part="thread-row"]`).waitFor({ timeout: 8000 }); const s = await sentRows(); await shot(tag + '-sent');
          const inInbox = Object.entries(i).filter(([, v]) => ['ready', 'working', 'recent', 'saved'].includes(v.sec)).map(([id]) => id).sort();
          return { inbox: i, inInbox, sent: s, sentIds: s.map(r => r.key), both: inInbox.filter(id => s.some(r => r.key === id)) };
        };
        entry.before = await place('1');
        const b = entry.before;
        assert.deepEqual(b.both, [], 'Inbox ∩ Sent = ∅: ' + JSON.stringify(b));
        assert.deepEqual(b.inInbox, ['qa-mac', 'qa-needs'], 'Inbox: what needs him ' + JSON.stringify(b.inInbox));
        assert.deepEqual(b.sentIds, ['qa-run', 'qa-worker', 'qa-trip', 'qa-quiet'], 'Sent: one row per thread, Working first ' + JSON.stringify(b.sent));
        assert.deepEqual(b.sent.map(r => r.sec), ['sentWorking', 'sentWorking', 'sentProcessed', 'sentProcessed']);
        assert.deepEqual(b.sent.map(r => r.title), ['Photo folder', 'Call mom', 'Lyon trip', 'Clip edit'], 'each row is titled with its thread, never his words');
        for (const r of b.sent) assert.doesNotMatch(r.text, /in Inbox/, 'no "in Inbox" row: ' + r.text);
        assert.equal(b.sent.filter(r => r.key === 'qa-trip').length, 1, 'three sends, one row');
        assert.match(b.sent.find(r => r.key === 'qa-trip').text, /Booked: the 9:04 train, seat 42\./, 'the last message under the title');
        // The actions sheet lists the thread's three sends.
        const trip = vis(`${L} [data-chsentthread="qa-trip"]`);
        if (phone) { const bb = await trip.boundingBox(), cdp = await context.newCDPSession(page), pt = [{ x: bb.x + 120, y: bb.y + bb.height / 2 }]; await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt }); await nap(800); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
        else await trip.click({ button: 'right' });
        await vis('.ch-sheet').waitFor({ timeout: 5000 });
        await vis('.ch-sheet .ch-st-sends').waitFor({ timeout: 5000 });
        entry.sheet = await page.evaluate(() => { const s = [...document.querySelectorAll('.ch-sheet')].find(n => n.getClientRects().length); return { title: s.querySelector('.ch-sheet-t')?.innerText.trim(), sends: [...s.querySelectorAll('.ch-st-sends li b')].map(x => x.innerText.trim()), buttons: [...s.querySelectorAll('button')].map(x => x.innerText.trim()) }; });
        assert.equal(entry.sheet.title, 'Lyon trip');
        assert.deepEqual(entry.sheet.sends, ['Thanks, that works', 'Take the earlier one', 'Find the cheapest train to Lyon on Saturday'], 'his three sends, newest first');
        await shot('2-sheet');
        await page.keyboard.press('Escape'); await nap(300);
        if (await page.locator('.ch-sheet').filter({ visible: true }).count()) { await page.evaluate(() => window.__wos ? __wos.onBack() : __wux.escStep()); await nap(400); }
        // Same thread, same row: qa-quiet now needs him → it leaves Sent and is in Inbox with the same title (no reload).
        const sentQuiet = b.sent.find(r => r.key === 'qa-quiet');
        THREADS['qa-quiet'].quiet = false; THREADS['qa-quiet'].attention = { state: 'needs_you', ask: 'Miguel asked for the raw files. Send them?' }; THREADS['qa-quiet'].msgs.push(['assistant', 'Miguel asked for the raw files. Send them?', 300]); THREADS['qa-quiet'].at = Date.now();
        SENT = SENT.map(r => r.id === sid('b') ? { ...r, state: 'needs_you', quiet: false } : r);
        await page.evaluate(() => { window.WizLive?.refresh?.(); window.WizLive?.sentLog?.fresh?.(); window.WizLive?.sentLog?.read?.(); });
        await tab('inbox'); await openSecs();
        await page.waitForFunction(sel => [...document.querySelectorAll(sel)].some(n => n.getClientRects().length), aad ? '.aad-side .aad-rw[data-sid="qa-quiet"]' : '.ch-list [data-chopen="qa-quiet"]', { timeout: 20000 });
        entry.moved = await place('3');
        assert.deepEqual(entry.moved.both, [], 'never in both after the move');
        assert.ok(entry.moved.inInbox.includes('qa-quiet') && !entry.moved.sentIds.includes('qa-quiet'), 'needs him: Inbox only ' + JSON.stringify(entry.moved.sentIds));
        assert.equal(entry.moved.inbox['qa-quiet'].title, sentQuiet.title, 'the same title in Inbox as in Sent');
        if (!aad && ROWS) assert.deepEqual([entry.moved.inbox['qa-quiet'].from, entry.moved.inbox['qa-quiet'].av], [sentQuiet.from, sentQuiet.av], 'the same sender and avatar');
        // Answered, nothing more for him: back to Sent, the same row.
        THREADS['qa-quiet'].quiet = true; THREADS['qa-quiet'].attention = fyi('Sent the raw files.'); THREADS['qa-quiet'].msgs.push(['user', 'yes send them', 400], ['assistant', 'Sent the raw files.', 420]); THREADS['qa-quiet'].at = Date.now();
        SENT = [S('4', 0, 'qa-quiet', 'yes send them', { route: 'thread', wants_reply: false, quiet: true }), ...SENT.map(r => r.id === sid('b') ? { ...r, state: 'done', quiet: true } : r)];
        await page.evaluate(() => { window.WizLive?.refresh?.(); window.WizLive?.sentLog?.fresh?.(); window.WizLive?.sentLog?.read?.(); });
        await tab('sent');
        await page.waitForFunction(L => [...document.querySelectorAll(`${L} .ch-st [data-chsentthread="qa-quiet"]`)].some(n => n.getClientRects().length), L, { timeout: 20000 });
        entry.back = await place('4');
        assert.deepEqual(entry.back.both, []);
        assert.ok(!entry.back.inInbox.includes('qa-quiet') && entry.back.sentIds.includes('qa-quiet'), 'nothing for him: Sent again');
        assert.equal(entry.back.sent.find(r => r.key === 'qa-quiet').title, 'Clip edit');
        // A tap opens the thread.
        await tab('sent'); await vis(`${L} [data-chsentthread="qa-trip"]`).click();
        await page.locator('.ch-thread').filter({ visible: true }).first().getByText('Booked: the 9:04 train, seat 42.').first().waitFor({ timeout: 10000 });
        assert.equal(entry.errors.length, 0, 'browser errors: ' + entry.errors.join('; '));
        assert.deepEqual(entry.refused.filter(x => x.reason === 'unexpected-write'), [], 'no unexpected writes');
        entry.pass = true;
      } catch (e) { entry.failure = e.stack; const pages = context.pages(); if (pages[0]) { entry.body = (await pages[0].locator('body').innerText().catch(() => '')).slice(0, 1500); await pages[0].screenshot({ path: path.join(out, stem + '-failure.png') }).catch(() => {}); } }
      finally { fs.writeFileSync(path.join(out, `report-${ON ? 'on' : 'off'}.json`), JSON.stringify(report, null, 2)); await context.close(); }
    }
  } finally { await browser.close(); }
  const failed = report.cases.filter(c => !c.pass);
  console.log(JSON.stringify({ on: ON, rows: ROWS, cases: report.cases.length, passed: report.cases.length - failed.length, failed: failed.map(c => c.stem + ': ' + String(c.failure).split('\n')[0]) }, null, 1));
  if (failed.length || !report.cases.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
