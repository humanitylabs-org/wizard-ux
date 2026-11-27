'use strict';
// Sent rows (wizard-ux issue 1814, switch wizard/sent-rows, off by default) in a real browser. Disposable synthetic
// transport only: a fake box keeps a Sent log of 12 sends (GET /wizard/v1/sent, POST /wizard/v1/sent/<id>/correct) and an
// agent inbox; its worker thread is hidden (stock Hermes leaves hidden sessions out of /api/sessions) but reads by id.
// Phone 412x915, Classic desktop 1440x960 (the full Chats view) and the AI apps desktop's Chats panel 1440x960, in
// Nebula and Light (obsidian-light). With the switch on:
//   Sent has no "‹ Sent" back row and no All / Working pills; one list with Inbox's section header style, Working (the
//   running sends) then Processed (the finished ones); every row is a normal Chats row (.ch-row-wrap > .ch-row), as tall
//   as an Inbox row with the same title size; at least 9 rows show on the phone; no internal words on any row; a
//   long-press (phone), right-click and Shift+F10 (desktop) open the row actions sheet with why it went where it went,
//   Open chat and the two corrections; a correction posts and the row says Corrected; a tap opens the (hidden) thread;
//   Back returns to Sent, then Inbox; a live skin change repaints the rows.
// QA_SWITCH=off: today's Sent (cards, back row, pills); the Sent list's HTML is written to sent-<stem>.html so a run
// with QA_WEB=<main checkout>/web can be compared byte for byte.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://chats-sent-rows.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'chats-sent-rows-evidence');
const SW = 'wizard/sent-rows', ON = process.env.QA_SWITCH !== 'off';
const SHELLS = (process.env.QA_SHELLS || 'phone,classic,ai-apps').split(','), SKINS = (process.env.QA_SKINS || 'nebula,obsidian-light').split(',');
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms)), M = 60e3, H = 36e5;
const THREADS = {
  'qa-chat-1': { title: 'Weather tomorrow', at: now - 20 * M, hidden: false, msgs: [['user', 'Tell me the weather tomorrow', 0], ['assistant', 'Sunny, 18 °C, light wind.', 30]] },
  'qa-chat-2': { title: 'Dentist slot', at: now - 50 * M, hidden: false, msgs: [['user', 'Find a dentist slot this week', 0], ['assistant', 'Thursday 10:00 is free at the practice on Main Street.', 60]] },
  'qa-worker-1': { title: 'Call mom', at: now - 3 * M, hidden: true, msgs: [['user', 'Note to self: call mom about Sunday lunch', 0], ['assistant', 'Added a reminder to call mom about Sunday lunch.', 20]] },
};
const id = c => 'sent_' + c.repeat(24), rid = c => 'inbox_' + c.repeat(24);
const S = (c, min, text, extra) => ({ id: id(c), at: now - min * M, source: 'orb', text, route: 'agent', decided_by: 'model', rules_matched: [], model: 'fast', tags: [], urgent: false, thread_id: null, record_id: null, state: 'done', ...extra });
let SENT = [
  S('a', 3, 'Note to self: call mom about Sunday lunch', { route: 'dump', decided_by: 'owner_words', rules_matched: ['no_reply:note to self'], model: '', thread_id: 'qa-worker-1', record_id: rid('a'), state: 'running' }),
  S('1', 5, 'Find the cheapest train to Lyon on Saturday', { route: 'dump', state: 'running', record_id: rid('1') }),
  S('b', 20, 'Tell me the weather tomorrow', { decided_by: 'owner_words', rules_matched: ['wants_reply:tell me'], thread_id: 'qa-chat-1' }),
  S('c', 50, 'Find a dentist slot this week', { source: 'typed', decided_by: 'owner_words', rules_matched: ['typed'], model: '', thread_id: 'qa-chat-2', would_route: 'dump', would_decided_by: 'model' }),
  S('d', 120, 'Book a table for four on Friday #family', { route: 'dump', rules_matched: ['tag:family'], tags: ['family'], record_id: rid('d'), state: 'needs_you' }),
  S('e', 180, 'What is on my calendar', { source: 'side', decided_by: 'fallback', rules_matched: ['router_timeout'], state: 'failed', error: 'router_timeout' }),
  S('2', 200, 'Remind me to water the plants at six', { route: 'reminder', decided_by: 'owner_words', rules_matched: ['reminder'], urgent: true }),
  S('3', 240, 'Next desk', { route: 'command', decided_by: 'owner_words', rules_matched: ['task_verb'] }),
  S('4', 300, 'Sent to Miguel, done', { route: 'thread', source: 'typed', thread_id: 'qa-chat-2', wants_reply: false, quiet: true, answer: 'Nothing needed from you.' }),
  S('5', 360, 'Add milk and eggs to the shopping list', { route: 'dump', decided_by: 'correction' }),
  S('6', 420, 'Summarise the board meeting notes', { thread_id: 'qa-chat-1' }),
  S('7', 480, 'Log 5 km run this morning', { route: 'dump', decided_by: 'owner_words', rules_matched: ['no_reply:log'] }),
];
const RECORDS = [{ id: rid('a'), agent: 'hermes', thread_id: 'qa-worker-1', state: 'running', kind: 'note', title: 'Call mom', last_update: 'Adding the reminder', created_at: now - 3 * M, updated_at: now - 2 * M }];
const raw = (sid, s) => ({ id: sid, title: s.title, runtime: 'direct', status: 'completed', updated_at: iso(s.at), updatedAt: iso(s.at), last_active: s.at / 1000, message_count: s.msgs.length, messageCount: s.msgs.length, preview: s.msgs.at(-1)?.[1] || '', ...(s.hidden ? { hidden: true } : {}) });
const INTERNAL = /\bThread\b|you typed it|would have|router|fallback|owner_words|no_reply|wants_reply|\bmodel\b|Background ·/;
const report = { origin, web, on: ON, cases: [] };
(async () => {
  const browser = await chromium.launch();
  try {
    for (const shell of SHELLS) for (const skin of SKINS) {
      const phone = shell === 'phone', ai = shell === 'ai-apps', stem = `${shell}-${skin}-${ON ? 'on' : 'off'}`;
      const entry = { stem, errors: [], refused: [], writes: [], corrections: [] }; report.cases.push(entry);
      SENT = SENT.map(r => { const { corrected, ...rest } = r; return rest; });
      const context = await browser.newContext({ viewport: phone ? { width: 412, height: 915 } : { width: 1440, height: 960 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', ...(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' } : {}) });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        const mix = { 'wizard/desktop-chats': true, ...(ON ? { [SW]: true } : {}) };
        await context.addInitScript(({ shell, skin, mix }) => {
          if (window !== top) return;
          if (sessionStorage.getItem('qaBoot')) return; sessionStorage.setItem('qaBoot', '1');
          for (const [k, v] of Object.entries({ 'wos.shell': shell === 'phone' ? 'phone' : 'desktop', 'wux.shell': shell === 'phone' ? 'phone' : 'desktop', 'wos.desktop-view.v1': shell === 'ai-apps' ? 'ai-apps' : 'classic', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
            'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v);
        }, { shell, skin, mix });
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
          if (u.origin !== origin) { entry.refused.push({ method, url: q.url(), reason: 'external' }); return r.abort(); }
          const fix = /^\/wizard\/v1\/sent\/(sent_[a-f0-9]{24})\/correct$/.exec(p);
          if (fix && method === 'POST') {
            const body = q.postDataJSON(); entry.corrections.push({ id: fix[1], body });
            await nap(300);
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
          if (p === '/wizard/v1/sent') return r.fulfill({ json: { rows: SENT, next: null, check: null } });
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
        if (ON) await page.waitForFunction(sw => (document.documentElement.dataset.tweaks || '').split(' ').includes(sw), SW, { timeout: 15000 });
        if (ai) await page.waitForFunction(() => document.documentElement.dataset.layout === 'ai-apps', null, { timeout: 15000 });
        else if (phone) await page.evaluate(() => __wos.openSheet('inbox')); else await page.evaluate(() => __wux.openChatsList());
        const L = ai ? '.aad-side .aad-chan' : '.ch-list';
        const vis = sel => page.locator(sel).filter({ visible: true }).first();
        const count = sel => page.locator(sel).filter({ visible: true }).count();
        const back = () => page.evaluate(() => window.__wos ? __wos.onBack() : __wux.escStep());
        const shot = async name => { await page.evaluate(() => document.fonts.ready); await nap(300); await page.screenshot({ path: path.join(out, `${stem}-${name}.png`) }); };
        await vis(ai ? '.aad-side .aad-rw[data-sid="qa-chat-1"] .aad-row' : '.ch-list [data-chopen="qa-chat-1"]').waitFor({ timeout: 15000 });
        if (ON && !ai) await vis('.ch-list .ch-ib-row[data-chopen="qa-chat-1"]').waitFor({ timeout: 15000 });
        await vis(`${L} .ch-tabbar`).waitFor({ timeout: 10000 }); await nap(600);
        // 1. Inbox: its rows (the Inbox rows, on for everyone) are the yardstick for Sent's.
        const lookOf = (row, q) => {
          const cs = getComputedStyle(row), t = row.querySelector(q.title), pv = row.querySelector(q.line), av = q.av && row.querySelector(q.av);
          const f = n => n ? [getComputedStyle(n).fontSize, getComputedStyle(n).fontWeight, getComputedStyle(n).lineHeight, getComputedStyle(n).color].join(' ') : '';
          return { height: Math.round(row.getBoundingClientRect().height), pad: [cs.paddingTop, cs.paddingLeft, cs.paddingBottom].join(' '), gap: cs.columnGap, title: t ? [getComputedStyle(t).fontSize, getComputedStyle(t).lineHeight].join(' ') : '', line: f(pv), av: av ? [getComputedStyle(av).width, getComputedStyle(av).borderRadius, getComputedStyle(av).display].join(' ') : 'none', from: q.from && row.querySelector(q.from) ? f(row.querySelector(q.from)) : '' };
        };
        const IBQ = { title: '.ch-ib-t', line: '.ch-ib-pv', av: '.ch-ib-av', from: '.ch-ib-from' }, AADQ = { title: '.aad-row-t', line: '.aad-chan-line', av: null, from: null };
        entry.inbox = await page.evaluate(([ai, IBQ, AADQ, lookSrc]) => {
          const lookOf = eval(lookSrc);
          const row = [...document.querySelectorAll(ai ? '.aad-side .aad-row' : '.ch-list .ch-ib-row[data-chopen]')].find(n => n.getClientRects().length && (!ai || n.querySelector('.aad-chan-line')));
          const h = [...document.querySelectorAll(ai ? '.aad-side .aad-sec' : '.ch-list .ch-sec.ch-ib .ch-sec-h')].find(n => n.getClientRects().length);
          return { look: row ? lookOf(row, ai ? AADQ : IBQ) : null, head: h ? [getComputedStyle(h).fontSize, getComputedStyle(h).fontWeight, getComputedStyle(h).textTransform].join(' ') : null };
        }, [ai, IBQ, AADQ, lookOf.toString()]);
        if (ON || process.env.QA_INBOX_ONLY) assert.ok(entry.inbox.look, 'Inbox shows its rows');
        await shot('1-inbox');
        if (process.env.QA_INBOX_ONLY) { entry.pass = true; continue; } // the Inbox rows' look only (compare with main)
        await vis(`${L} .ch-tabbar [data-chtab="sent"]`).click();
        if (!ON) {
          await vis(`${L} .ch-sent-row`).waitFor({ timeout: 8000 });
          assert.equal(await count(`${L} .ch-sent-h`), 1, 'off: the back row stays');
          assert.equal(await count(`${L} [data-chsentfilter]`), 2, 'off: the All / Working pills stay');
          assert.equal(await count(`${L} .ch-sr-row`), 0, 'off: no new rows');
          await nap(500);
          fs.writeFileSync(path.join(out, `sent-${shell}-${skin}.html`), await page.locator(ai ? `${L} .ch-list` : '.ch-list').filter({ visible: true }).first().evaluate(n => n.outerHTML));
          await shot('2-sent');
          entry.pass = true; continue;
        }
        await vis(`${L} .ch-sr-row`).waitFor({ timeout: 8000 }); await nap(400);
        // 2. Sent: no back row, no pills, Working then Processed under Inbox's header, the new Inbox's own rows.
        assert.equal(await count(`${L} .ch-sent-h`), 0, 'no "‹ Sent" back row');
        assert.equal(await count(`${L} [data-chsentfilter], ${L} .ch-sent-filter`), 0, 'no All / Working pills or filter');
        assert.equal(await count(`${L} .ch-sent-row`), 0, 'no cards');
        entry.sections = await page.locator(`${L} .ch-sec.ch-sr > .ch-sec-h`).filter({ visible: true }).evaluateAll(b => b.map(x => x.innerText.replace(/\s+/g, ' ').trim()));
        assert.deepEqual(entry.sections.map(s => s.toLowerCase()), ['working 2', 'processed 10'], 'Working, then Processed: ' + JSON.stringify(entry.sections));
        entry.sent = await page.evaluate(([L, ai, IBQ, AADQ, lookSrc]) => {
          const lookOf = eval(lookSrc);
          const rows = [...document.querySelectorAll(`${L} .ch-ib-wrap.ch-sr-wrap > .ch-row.ch-ib-row.ch-sr-row`)].filter(n => n.getClientRects().length);
          const sc = rows[0].closest('.ch-scroll').getBoundingClientRect(), bar = document.querySelector(`${L} .ch-tabbar`)?.getBoundingClientRect();
          const bottom = Math.min(sc.bottom, bar ? bar.top : sc.bottom);
          const h = [...document.querySelectorAll(`${L} .ch-sec.ch-sr > .ch-sec-h`)].find(n => n.getClientRects().length);
          const text = n => { const c = [...n.querySelectorAll('.ch-ib-from, time, .ch-ib-t, .ch-ib-pv')].filter(x => x.getClientRects().length); return c.map(x => x.innerText.trim()).join(' | '); };
          const aadLook = r => { const t = r.querySelector('.ch-ib-t'), pv = r.querySelector('.ch-ib-pv'), cs = getComputedStyle(r); return { height: Math.round(r.getBoundingClientRect().height), pad: [cs.paddingTop, cs.paddingLeft, cs.paddingBottom].join(' '), gap: cs.columnGap, title: [getComputedStyle(t).fontSize, getComputedStyle(t).lineHeight].join(' '), line: [getComputedStyle(pv).fontSize, getComputedStyle(pv).fontWeight, getComputedStyle(pv).lineHeight, getComputedStyle(pv).color].join(' '), av: 'none', from: '' }; };
          return { n: rows.length, look: ai ? aadLook(rows[2]) : lookOf(rows[2], IBQ), heights: [...new Set(rows.map(r => Math.round(r.getBoundingClientRect().height)))], inView: rows.filter(r => { const b = r.getBoundingClientRect(); return b.top >= sc.top - 1 && b.bottom <= bottom + 1; }).length,
            head: [getComputedStyle(h).fontSize, getComputedStyle(h).fontWeight, getComputedStyle(h).textTransform].join(' '),
            marks: rows.map(r => r.querySelector('.ch-ib-mk i')?.className.split(' ')[0] || ''), texts: rows.map(text), arch: rows.filter(r => r.parentElement.querySelector('.ch-ib-arch')).length };
        }, [L, ai, IBQ, AADQ, lookOf.toString()]);
        assert.equal(entry.sent.n, 12, 'one row per send');
        // The same row design as Inbox beside it: height, padding, spacing, title, line, avatar, sender, section header.
        assert.deepEqual(entry.sent.look, entry.inbox.look, 'Sent rows look like the Inbox rows: ' + JSON.stringify([entry.sent.look, entry.inbox.look]));
        assert.deepEqual(entry.sent.heights, [entry.inbox.look.height], 'every Sent row is as tall as an Inbox row');
        if (!ai) assert.equal(entry.sent.head, entry.inbox.head, 'the same section header as Inbox');
        assert.equal(entry.sent.arch, 0, 'a send has no Archive button');
        // The issue's first "at least 9 rows" was for one-line rows; James's later word (25 Nov) is Inbox's own rows (77 px):
        // a 412x915 phone shows 7 whole ones (today's cards: 4 or 5), the same as Inbox.
        if (phone) assert.ok(entry.sent.inView >= 7, `Sent rows on the phone screen (Inbox-size rows): ${entry.sent.inView}`);
        assert.deepEqual(entry.sent.marks, ['ch-spin', 'ch-spin', '', '', 'ch-chan-dot', 'ch-chan-dot', '', '', '', '', '', ''], 'the spinner while it runs, the amber dot when it needs him or failed');
        for (const t of entry.sent.texts) assert.doesNotMatch(t, INTERNAL, 'no internal words: ' + t);
        assert.match(entry.sent.texts[0], /\d+m \| Note to self: call mom about Sunday lunch \| Ran quietly · Working$/);
        assert.match(entry.sent.texts[2], /\d+m \| Tell me the weather tomorrow \| Replied in chat · Done$/);
        assert.match(entry.sent.texts[4], /\d+h \| Book a table for four on Friday #family \| Ran quietly · Needs you · in Inbox$/);
        if (!ai) assert.match(entry.sent.texts[4], /^family \| /, 'a tag names the row, as in Inbox');
        assert.match(entry.sent.texts[5], /Failed · in Inbox$/);
        assert.match(entry.sent.texts[6], /Set a reminder · Done · Urgent$/);
        assert.match(entry.sent.texts[8], /Noted in its chat · Done$/);
        await shot('2-sent');
        // 3. The actions sheet: a long-press on the phone, right-click and Shift+F10 on desktop.
        const rowSel = c => `${L} [data-chsent="${id(c)}"]`;
        const sheetOpen = () => vis('.ch-sheet [data-rssentopen]').waitFor({ timeout: 4000 });
        if (phone) {
          const b = await vis(rowSel('b')).boundingBox(), cdp = await context.newCDPSession(page), pt = [{ x: b.x + 120, y: b.y + b.height / 2 }];
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt }); await nap(800);
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } else {
          await vis(rowSel('b')).click({ button: 'right' });
        }
        await sheetOpen();
        entry.sheet = await page.evaluate(() => { const s = [...document.querySelectorAll('.ch-sheet')].find(n => n.getClientRects().length); return { why: s.querySelector('.ch-sr-why')?.innerText, buttons: [...s.querySelectorAll('button')].map(b => b.innerText.trim()) }; });
        assert.equal(entry.sheet.why, 'Replied in chat because you said “tell me”.');
        assert.deepEqual(entry.sheet.buttons, ['Open chat', 'Should have replied', 'Didn’t need a reply']);
        await shot('3-sheet');
        if (!phone) {
          await page.keyboard.press('Escape'); await nap(300);
          assert.equal(await count('.ch-sheet'), 0, 'Esc closes the sheet');
          await vis(rowSel('b')).focus(); await page.keyboard.press('Shift+F10');
          await sheetOpen();
          entry.keyboard = true;
        }
        // 4. Didn't need a reply: the same correction as today; the row says Corrected.
        await vis('.ch-sheet [data-rssentfix="quiet"]').click();
        await page.waitForFunction(([L, sid]) => [...document.querySelectorAll(`${L} [data-chsent="${sid}"]`)].some(b => b.getClientRects().length && /Corrected/.test(b.innerText)), [L, id('b')], { timeout: 5000 });
        assert.deepEqual(entry.corrections, [{ id: id('b'), body: { should_reply: false } }], 'one correction posted');
        assert.equal(await count('.ch-sheet'), 0, 'the sheet closed');
        await shot('4-corrected');
        // A reply typed in a thread: why, Open, no corrections (nothing to move).
        if (!phone) {
          await vis(rowSel('4')).click({ button: 'right' }); await sheetOpen();
          const t = await page.evaluate(() => { const s = [...document.querySelectorAll('.ch-sheet')].find(n => n.getClientRects().length); return { why: s.querySelector('.ch-sr-why')?.innerText, n: s.querySelectorAll('[data-rssentfix]').length }; });
          assert.deepEqual(t, { why: 'Noted in its chat: nothing was needed from you, so it stayed out of Inbox.', n: 0 });
          await page.keyboard.press('Escape'); await nap(300);
        }
        // 5. A live skin change repaints the rows (tokens only).
        const colour = () => vis(rowSel('b')).evaluate(n => getComputedStyle(n.querySelector('.ch-ib-t')).color);
        const c0 = await colour(), other = skin === 'nebula' ? 'obsidian-light' : 'nebula';
        await page.evaluate(sk => WosSkin.set(sk), other); await nap(900);
        entry.liveSkin = { from: c0, to: await colour(), applied: await page.evaluate(() => document.documentElement.dataset.skin || '') };
        assert.notEqual(entry.liveSkin.to, entry.liveSkin.from, 'the rows follow a live skin change: ' + JSON.stringify(entry.liveSkin));
        await page.evaluate(sk => WosSkin.set(sk), skin); await nap(700);
        // 6. A tap opens the hidden worker thread by id; Back returns to Sent, then Inbox.
        await vis(rowSel('a')).click();
        const thread = () => page.locator('.ch-thread').filter({ visible: true }).first();
        await thread().getByText('Added a reminder to call mom about Sunday lunch.').waitFor({ timeout: 10000 });
        assert.ok(entry.reads.some(x => x.startsWith('qa-worker-1')), 'read by id');
        if (phone) { await back(); await nap(600); assert.equal(await count(`${L} .ch-sr-row`), 12, 'Back from the thread: Sent'); await back(); await nap(600); }
        else if (!ai) { await thread().getByText('Added a reminder to call mom about Sunday lunch.').click(); await back(); await nap(600); await vis(`${L} .ch-sr-row`).waitFor({ timeout: 8000 }); await vis(`${L} .ch-sec.ch-sr .ch-sec-h`).focus(); await back(); await nap(600); }
        else { await page.keyboard.press('Escape'); await nap(500); await vis(`${L} .ch-sec.ch-sr .ch-sec-h`).focus(); await page.evaluate(() => __wux.escStep()); await nap(600); }
        assert.equal(await count(`${L} .ch-sr-row`), 0, 'Back from Sent leaves Sent');
        entry.tabsAfter = await page.locator(`${L} .ch-tabbar`).filter({ visible: true }).first().locator('[role=tab]').evaluateAll(b => b.map(x => `${x.innerText.trim()}${x.getAttribute('aria-selected') === 'true' ? '*' : ''}`));
        assert.deepEqual(entry.tabsAfter, ['Inbox*', 'Tags', 'Sent'], 'Back from Sent: Inbox');
        assert.equal(entry.errors.length, 0, 'browser errors: ' + entry.errors.join('; '));
        assert.deepEqual(entry.refused.filter(x => x.reason === 'unexpected-write'), [], 'no unexpected writes');
        entry.pass = true;
      } catch (e) { entry.failure = e.stack; const pages = context.pages(); if (pages[0]) { entry.body = (await pages[0].locator('body').innerText().catch(() => '')).slice(0, 1500); await pages[0].screenshot({ path: path.join(out, stem + '-failure.png') }).catch(() => {}); } }
      finally { fs.writeFileSync(path.join(out, `report-${ON ? 'on' : 'off'}.json`), JSON.stringify(report, null, 2)); await context.close(); }
    }
  } finally { await browser.close(); }
  const failed = report.cases.filter(c => !c.pass);
  console.log(JSON.stringify({ on: ON, cases: report.cases.length, passed: report.cases.length - failed.length, failed: failed.map(c => c.stem + ': ' + String(c.failure).split('\n')[0]) }));
  if (failed.length || !report.cases.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
