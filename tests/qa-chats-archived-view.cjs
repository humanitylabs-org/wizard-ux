'use strict';
// The Chats switcher's Archived view (wizard-ux issue 1998) in a real browser, disposable synthetic box only. Phone
// 412x915 (Android), Nebula and a light skin, the switcher's fixture (tests/qa-chats-switcher.cjs) plus 160 archived
// chats. It checks, as a person would do it: Inbox has no Archived fold; the sheet's Archived lists every archived chat
// as Inbox-style thread rows (no message bubbles), newest first, all 160 by scrolling, each with Restore; a tap opens
// the chat; Restore puts it back in Inbox; the bar step and the tile flip into Archived show the same list.
// Shots and report.json go to QA_OUT.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://chats-archived-1998.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'chats-archived-evidence');
const SKINS = (process.env.QA_SKINS || 'nebula,obsidian-light').split(',');
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms)), M = 60e3, D = 864e5;
const CHANNELS = [
  { id: 'philosopher', agent: 'hermes', name: '🧠 Philosopher', order: 0, createdAt: iso(now - 9e8), archived: false, pinned: false },
  { id: 'launch', agent: 'hermes', name: '🚀 WizardOS Launch', order: 1, createdAt: iso(now - 8e8), archived: false, pinned: false },
  { id: 'trip', agent: 'hermes', name: '✈️ Trip', order: 2, createdAt: iso(now - 8e8), archived: false, pinned: false },
  // Enough tags for a third row: the grid scrolls inside the sheet.
  ...['💰 Money', '🏡 Home', '📚 Reading', '🎵 Music'].map((name, i) => ({ id: 'more' + i, agent: 'hermes', name, order: 3 + i, createdAt: iso(now - 7e8), archived: false, pinned: false })),
];
const AGENTS = [
  { id: 'hermes', label: 'Wizard', harness: 'hermes', privacy: 'standard', is_default: true, status: 'running', appearance: { glyph: 'a', hue: 260 } },
  { id: 'claude', label: 'Claude', harness: 'claude', privacy: 'standard', status: 'running', appearance: { glyph: 'c', hue: 20 } },
];
const ARC_N = 160;
const fresh = () => ({
  'qa-new': { title: 'Weather tomorrow', at: now - 20 * M, channel: 'trip', msgs: [['user', 'Tell me the weather in Lisbon tomorrow', 0], ['assistant', 'Sunny, 18 °C.', 30]] },
  'qa-read': { title: 'Garden plan', at: now - 3 * D, msgs: [['user', 'Plan the garden beds', 0], ['assistant', 'Tomatoes by the wall.', 60]] },
  'qa-needs': { title: 'Dentist slot', at: now - 50 * M, attention: { state: 'needs_you', ask: 'Tuesday or Thursday?' }, msgs: [['user', 'Find a dentist slot', 0], ['assistant', 'Tuesday 10:00 or Thursday 16:00?', 60]] },
  'qa-phil': { title: 'Free will and agents', at: now - 2 * 36e5, channel: 'philosopher', msgs: [['user', 'Can an agent have free will?', 0], ['assistant', 'Compatibilism says yes, in a sense.', 60]] },
  'qa-launch': { title: 'Launch checklist', at: now - 30 * M, channel: 'launch', msgs: [['user', 'What is left before launch?', 0], ['assistant', 'Three things.', 60]] },
  'qa-old': { title: 'Old archived', at: now - 6 * D, archived: true, msgs: [['user', 'Old question', 0], ['assistant', 'Old answer', 60]] },
  // 160 more archived chats (James's box had 156): every one must be a row in Archived.
  ...Object.fromEntries(Array.from({ length: ARC_N }, (_, i) => ['qa-arc-' + String(i).padStart(3, '0'), { title: 'Archived chat ' + (i + 1), at: now - 7 * D - i * 36e5, archived: true, channel: i % 3 === 0 ? 'trip' : undefined, msgs: [['user', 'Archived question ' + (i + 1), 0], ['assistant', 'Archived answer ' + (i + 1), 60]] }])),
});
const raw = (sid, s) => ({ id: sid, title: s.title, runtime: 'direct', status: s.status || 'completed', updated_at: iso(s.at), updatedAt: iso(s.at), last_active: s.at / 1000, message_count: s.msgs.length, messageCount: s.msgs.length,
  preview: s.msgs.at(-1)?.[1] || '', latest_message: { role: s.msgs.at(-1)?.[0], content: s.msgs.at(-1)?.[1], timestamp: s.at / 1000 }, startedAt: iso(s.at - 6e5), archived: !!s.archived,
  ...(s.msgs.some(m => m[0] === 'assistant') ? { last_assistant_at: iso(s.at) } : {}), ...(s.attention ? { wizard_attention: s.attention } : {}),
  ...(s.channel ? { channel: s.channel, tags: [s.channel] } : { tags: [] }) });
const CLAUDE = { title: 'Claude essay', at: now - 40 * M, msgs: [['user', 'Draft an essay', 0], ['assistant', 'Here is a draft.', 60]] };
const SENT = () => ({ rows: [{ id: 'sent_' + 'c'.repeat(24), at: now - 5 * D, source: 'orb', text: 'Plan the garden beds', route: 'agent', decided_by: 'model', state: 'done', thread_id: 'qa-read', tags: [] }], next: null, check: null });
const report = { origin, web, cases: [] };

(async () => {
  const browser = await chromium.launch();
  try {
    for (const skin of SKINS) {
      const stem = `on-${skin}`, entry = { stem, errors: [], refused: [], writes: [], steps: {} }; report.cases.push(entry);
      const threads = fresh();
      const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block', userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        await context.addInitScript(({ skin }) => {
          if (window !== top) return;
          if (sessionStorage.getItem('qaBoot')) return; sessionStorage.setItem('qaBoot', '1');
          for (const [k, v] of Object.entries({ 'wos.shell': 'phone', 'wux.shell': 'phone', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.tour.done': '1', 'wos.welcome.v1': 'done', 'wos.voiceTipSeen': 'true', 'wos.skin': skin,
            'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix: {} }) })) localStorage.setItem(k, v);
        }, { skin });
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
          if (u.origin !== origin) { entry.refused.push({ method, url: q.url(), reason: 'external' }); return r.abort(); }
          if (p.includes('/v1/runs')) return r.abort();
          if (!['GET', 'HEAD'].includes(method)) {
            entry.writes.push({ method, path: p, body: q.postData() || '' });
            if (method === 'PUT' && p === '/wizard/thread-seen') return r.fulfill({ json: { ok: true, state: q.postDataJSON() } });
            if (method === 'PUT' && p === '/wizard/v1/channels/read') return r.fulfill({ json: { schema: 'wizard.channel-reads/1', at: {} } });
            if (p === '/wizard/v1/ui-preferences' && ['PUT', 'PATCH'].includes(method)) return r.fulfill({ json: { ...(q.postDataJSON() || {}) } });
            // Restore: the box un-archives the thread (live.js restore).
            const rm = /^\/wizard\/hermes\/api\/sessions\/([^/]+)$/.exec(p);
            if (method === 'PATCH' && rm && threads[decodeURIComponent(rm[1])]) { const s = threads[decodeURIComponent(rm[1])], b = q.postDataJSON() || {}; if (b.archived === false) s.archived = false; s.at = Date.now(); return r.fulfill({ json: { session: raw(decodeURIComponent(rm[1]), s) } }); }
            if (p.startsWith('/wizard/v1/agent-inbox')) return r.fulfill({ json: { ok: true, records: [] } });
            entry.refused.push({ method, path: p, reason: 'unexpected-write' }); return r.fulfill({ status: 405, json: { error: 'Synthetic fixture refuses this write' } });
          }
          if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
          if (p.startsWith(prefix)) {
            const f = decodeURIComponent(p.slice(prefix.length) || 'index.html'), abs = path.resolve(web, f);
            if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
            if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return r.fulfill({ path: abs });
            return r.fulfill({ status: 404, body: 'No synthetic static asset' });
          }
          if (p === '/wizard/v1/agents') return r.fulfill({ json: { agents: AGENTS } });
          if (p === '/wizard/v1/sent') return r.fulfill({ json: SENT() });
          if (p === '/wizard/v1/agent-inbox') return r.fulfill({ json: { records: [], check: null, stay: [] } });
          if (p === '/wizard/thread-seen') return r.fulfill({ json: { state: { initializedAt: 1, threads: Object.fromEntries(Object.entries(threads).filter(([k]) => k !== 'qa-new').map(([k, s]) => [`direct:${k}`, { updatedAt: iso(s.at), assistantActivityAt: iso(s.at), seenAt: s.at + 60e3 }])) } } });
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true, 'launcher.v1': true }, spaces: [], pinnedChats: [] } });
          if (p === '/wizard/v1/setup') return r.fulfill({ json: { first_run: false, seen: true } });
          if (p === '/wizard/v1/channels') return r.fulfill({ json: { schema: 'wizard.channels/1', sort: 'az', migratedAt: iso(now - D), channels: CHANNELS.map(c => ({ ...c, count: Object.values(threads).filter(t => t.channel === c.id).length })), tags: true } });
          if (p === '/wizard/v1/channels/read') return r.fulfill({ json: { schema: 'wizard.channel-reads/1', at: {} } });
          if (p === '/wizard/v1/channels/tags') { const t = threads[u.searchParams.get('sessionId')]; return r.fulfill({ json: { sessionId: u.searchParams.get('sessionId'), tags: t?.channel ? [t.channel] : [] } }); }
          if (p === '/wizard/v1/boomerangs') return r.fulfill({ json: { reminders: [] } });
          if (p === '/wizard/hermes/api/sessions' && u.searchParams.has('channel')) {
            const id = u.searchParams.get('channel'), data = Object.entries(threads).filter(([, s]) => s.channel === id).map(([k, s]) => ({ ...raw(k, s), listVersion: 1, agent: '', createdAt: iso(s.at) }));
            return r.fulfill({ json: { object: 'list', data, offset: 0, limit: 100, has_more: false, snapshot: 'snap', window: 'channel', channel: id, order: 'oldest', channel_total: data.length, view: 'list', list_version: 1 } });
          }
          if (p === '/wizard/hermes/api/sessions') {
            const ag = u.searchParams.get('agent') || '';
            if (ag && ag !== 'hermes') return r.fulfill({ json: { data: [raw('qa-claude', CLAUDE)], has_more: false } });
            return r.fulfill({ json: { data: Object.entries(threads).map(([k, s]) => raw(k, s)), has_more: false } });
          }
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) {
            const sid = decodeURIComponent(m[1]), s = sid === 'qa-claude' ? CLAUDE : threads[sid]; if (!s) return r.fulfill({ status: 404, json: { error: 'missing' } });
            const t0 = s.at / 1000 - 600;
            return r.fulfill({ json: m[2] ? { messages: s.msgs.map(([role, content, dt]) => ({ role, content, timestamp: t0 + dt })) } : { session: raw(sid, s) } });
          }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + prefix + 'index.html?phone');
        await page.waitForFunction(() => window.__wos && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
        await page.waitForFunction(() => document.querySelector('.sec-tile'));
        await nap(900);
        const cdp = await context.newCDPSession(page);
        const shot = async name => { await page.evaluate(() => document.fonts.ready); await nap(250); await page.screenshot({ path: path.join(out, `${stem}-${name}.png`) }); };
        const center = sel => page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; }, sel);
        const touch = async (pts, holdMs = 40, stepMs = 16) => {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pts[0]] });
          for (const p of pts.slice(1)) { await nap(stepMs); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [p] }); }
          await nap(holdMs);
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        };
        const tapAt = async sel => { await page.evaluate(s => document.querySelector(s)?.scrollIntoView?.({ block: 'nearest' }), sel); const p = await center(sel); await page.touchscreen.tap(p.x, p.y); await nap(700); };
        const sideways = async (sel, dx, stepMs = 16) => { const p = await center(sel); await touch([p, ...[1, 2, 3, 4, 5].map(k => ({ x: p.x + dx * k / 5, y: p.y }))], 10, stepMs); await nap(900); };
        // What a person sees in the Chats list.
        const look = () => page.evaluate(() => {
          const seen = n => !!n && n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden' && getComputedStyle(n).display !== 'none';
          const list = [...document.querySelectorAll('.ch-list')].find(seen), tb = list?.querySelector('.ch-tbar-t'), S = window.WizCore.chatsSwitcher;
          const rows = list ? [...list.querySelectorAll('.ch-ib-archived [data-chopen]')].filter(seen) : [];
          const r0 = rows[0]?.closest('.ch-ib-wrap, .ch-ib-row') || rows[0];
          return { title: tb ? tb.innerText.replace(/\s+/g, ' ').trim() : '', view: S ? S.view() : '', section: window.WizCore.phoneSections.current(),
            fold: !!list?.querySelector('.ch-sec[data-sec="archived"]'), foldText: list?.querySelector('.ch-sec[data-sec="archived"]')?.innerText.replace(/\s+/g, ' ').trim() || '',
            arcRows: rows.map(b => b.dataset.chopen), restore: list ? list.querySelectorAll('.ch-ib-archived [data-chibrestore]').length : 0,
            archiveBtns: list ? list.querySelectorAll('.ch-ib-archived [data-chibarch]').length : 0,
            posts: list ? list.querySelectorAll('.ch-post, .ch-feed, [data-chpost]').length : 0,
            inboxRows: list ? [...list.querySelectorAll('.ch-sec[data-sec="ready"] [data-chopen], .ch-tb-main[data-sec="ready"] [data-chopen]')].map(b => b.dataset.chopen) : [],
            firstRowText: rows[0] ? rows[0].innerText.replace(/\s+/g, ' ').trim() : '',
            firstAv: !!r0?.querySelector('.ch-ib-av'), thread: !!document.querySelector('.ch-thread, [data-part="thread"]') && seen(document.querySelector('.ch-thread, [data-part="thread"]')),
            rowBg: rows[0] ? getComputedStyle(rows[0]).color : '' };
        });
        const S = entry.steps;
        await tapAt('.sec-tile[data-sec="chats"]'); await nap(900);
        await page.waitForFunction(() => document.querySelector('.ch-list [data-chopen="qa-new"]'), null, { timeout: 15000 });
        await nap(600);
        // 4. Inbox: no Archived fold (the switcher's Archived is its own view).
        S.inbox = await look(); await shot('1-inbox');
        assert.equal(S.inbox.view, 'inbox'); assert.ok(!S.inbox.fold, 'Inbox draws no Archived fold ' + S.inbox.foldText);
        assert.ok(S.inbox.inboxRows.includes('qa-new') && !S.inbox.inboxRows.some(id => id.startsWith('qa-arc-') || id === 'qa-old'), 'Inbox lists only Inbox threads ' + JSON.stringify(S.inbox.inboxRows));
        // 1. Sheet → Archived: every archived chat as thread rows, newest first, with Restore.
        await tapAt('.sec-tile[data-sec="chats"]');
        await tapAt('#chatsSwitch [data-csview="archived"]'); await nap(600);
        S.arc = await look(); await shot('2-archived');
        assert.equal(S.arc.view, 'archived'); assert.match(S.arc.title, /^Archived\b/);
        const want = Object.entries(threads).filter(([, s]) => s.archived).sort((a, b) => b[1].at - a[1].at).map(([k]) => k);
        assert.deepEqual(S.arc.arcRows, want, 'every archived chat, newest first (' + S.arc.arcRows.length + ' of ' + want.length + ')');
        assert.ok(S.arc.arcRows.length >= 150, 'a box with 150+ archived chats shows them all');
        assert.equal(S.arc.posts, 0, 'no message bubbles'); assert.equal(S.arc.restore, want.length, 'Restore on each row'); assert.equal(S.arc.archiveBtns, 0, 'no Archive on an archived row');
        assert.ok(S.arc.firstAv, 'rows have the Inbox avatar'); assert.match(S.arc.firstRowText, /Old archived/, 'title on the row'); assert.match(S.arc.firstRowText, /Old answer/, 'preview on the row');
        // ...all of them by scrolling: the last row is reachable.
        S.scroll = await page.evaluate(() => { const sc = [...document.querySelectorAll('.ch-list .ch-scroll')].find(n => n.getClientRects().length); sc.scrollTop = sc.scrollHeight; const last = [...sc.querySelectorAll('.ch-ib-archived [data-chopen]')].at(-1); const r = last.getBoundingClientRect(), b = sc.getBoundingClientRect(); return { scrolls: sc.scrollHeight > sc.clientHeight, last: last.dataset.chopen, inView: r.top >= b.top - 1 && r.bottom <= b.bottom + 1 }; });
        await nap(400); await shot('3-archived-end');
        assert.ok(S.scroll.scrolls && S.scroll.inView && S.scroll.last === want.at(-1), 'scrolls to the last archived chat ' + JSON.stringify(S.scroll));
        await page.evaluate(() => { const sc = [...document.querySelectorAll('.ch-list .ch-scroll')].find(n => n.getClientRects().length); sc.scrollTop = 0; }); await nap(300);
        // 2. A tap on a row opens that chat; Back returns to Archived.
        await tapAt('.ch-list .ch-ib-archived [data-chopen="qa-old"]'); await nap(900);
        S.opened = await page.evaluate(() => { const w = Object.values(__wos.W || {}).find(x => x && x.thread); return w ? w.thread : (document.querySelector('[data-part="thread"]') ? 'thread' : ''); });
        S.openedText = await page.evaluate(() => document.body.innerText.includes('Old question'));
        await shot('4-opened');
        assert.ok(S.opened === 'qa-old' || S.openedText, 'the tap opens the chat ' + S.opened);
        await page.evaluate(() => __wos.onBack()); await nap(900);
        S.back = await look(); assert.equal(S.back.view, 'archived', 'Back from the chat returns to Archived');
        // 2. Restore puts it back in Inbox.
        const restoreId = want[1];
        await tapAt(`.ch-list [data-chibrestore="${restoreId}"]`); await nap(1200);
        S.restored = await look();
        S.restoreWrite = entry.writes.filter(x => x.method === 'PATCH' && x.path.endsWith('/' + restoreId));
        assert.ok(S.restoreWrite.length && /"archived":false/.test(S.restoreWrite[0].body), 'Restore un-archives it on the box ' + JSON.stringify(entry.writes.slice(-3)));
        assert.ok(!S.restored.arcRows.includes(restoreId), 'it leaves Archived'); assert.equal(S.restored.arcRows.length, want.length - 1);
        await tapAt('.sec-tile[data-sec="chats"]'); await tapAt('#chatsSwitch [data-csview="inbox"]'); await nap(700);
        S.inbox2 = await look(); await shot('5-restored-inbox');
        assert.ok(S.inbox2.inboxRows.includes(restoreId), 'Restore puts it back in Inbox ' + JSON.stringify(S.inbox2.inboxRows)); assert.ok(!S.inbox2.fold, 'still no fold');
        // 3. The bar's sideways step into Archived (Inbox → Sent → Archived) shows the same list.
        await sideways('.sec-tile[data-sec="home"]', -44, 8); await sideways('.sec-tile[data-sec="home"]', -44, 8);
        S.step = await look(); assert.equal(S.step.view, 'archived', 'the bar steps to Archived');
        assert.deepEqual(S.step.arcRows, S.restored.arcRows, 'the step shows the same list'); assert.equal(S.step.posts, 0);
        // 3. The orb step too: back one with the orb (to Sent), then forward one (to Archived).
        const orb = await center('#orb');
        await touch([orb, ...[1, 2, 3, 4].map(k => ({ x: orb.x + 20 * k, y: orb.y }))], 20); await nap(900);
        await touch([orb, ...[1, 2, 3, 4].map(k => ({ x: orb.x - 20 * k, y: orb.y }))], 20); await nap(900);
        S.orb = await look(); assert.equal(S.orb.view, 'archived', 'the orb steps to Archived'); assert.deepEqual(S.orb.arcRows, S.restored.arcRows);
        // 3. The tile flip (Inbox ↔ Archived, the last two views picked) lands on the same list.
        await tapAt('.sec-tile[data-sec="chats"]'); await tapAt('#chatsSwitch [data-csview="inbox"]'); await nap(500);
        await sideways('.sec-tile[data-sec="chats"]', -60); S.flip = await look();
        assert.equal(S.flip.view, 'archived', 'the tile flip goes to Archived ' + S.flip.view); assert.deepEqual(S.flip.arcRows, S.restored.arcRows, 'the flip shows the same list');
        await shot('6-flipped');
        assert.equal(entry.errors.length, 0, 'browser errors: ' + entry.errors.join('; '));
        assert.equal(entry.refused.filter(x => x.reason === 'unexpected-write').length, 0, 'unexpected writes: ' + JSON.stringify(entry.refused));
        entry.pass = true;
      } catch (e) { entry.failure = e.stack; const pages = context.pages(); if (pages[0]) await pages[0].screenshot({ path: path.join(out, stem + '-failure.png') }).catch(() => {}); }
      finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await context.close(); }
    }
  } finally { await browser.close(); }
  const failed = report.cases.filter(c => !c.pass);
  console.log(JSON.stringify({ cases: report.cases.length, passed: report.cases.length - failed.length, failed: failed.map(c => c.stem + ': ' + String(c.failure).split('\n').slice(0, 2).join(' ')), screenshots: fs.readdirSync(out).filter(f => f.endsWith('.png')).length }));
  if (failed.length || !report.cases.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
