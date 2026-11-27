'use strict';
// Chats on the phone and in the AI apps desktop sidebar are one design (wizard-ux issues 1966 and 1992, on for everyone;
// James, 27 Nov 2026: "Let's have the same styling on mobile and desktop, not two totally different stylings of core app
// functionality"). A real browser, a disposable synthetic box only (every write answered locally, nothing reached).
// The same synthetic data is drawn on the phone (390x844) and in the AI apps sidebar pane (its <agent>::side window) at
// 1440x900 and 1024x768, Nebula and a light skin. For Inbox, Tags, Sent and one tag the list's structure is read with
// sizes stripped (the title bar: title, count, its buttons; each section: key, fold, open; each row in order: its key,
// its parts, its words; the tabs) and must be the same on both. Any difference fails. Run it on every Chats change.
//   The sidebar also: no rows of its own (.aad-rw) and no "Inbox N · Newest" section row of its own; a row click opens
//   that thread in the main column and marks the row current; right-click opens the row's actions sheet; ⌥↓ opens the
//   first Inbox row; the row's Archive archives it.
// QA_SKINS / QA_SIZES pick cases; QA_OUT keeps the screenshots; QA_EXPECT=broken (a build from before issue 1966) asserts
// the sidebar still differs.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://chats-shell-parity-1966.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'chats-shell-parity-evidence');
const SKINS = (process.env.QA_SKINS || 'nebula,obsidian-light').split(','), SIZES = (process.env.QA_SIZES || '1440x900,1024x768').split(',');
const broken = process.env.QA_EXPECT === 'broken';
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
const SENT = () => ({ rows: [{ id: 'sent_' + 'c'.repeat(24), at: now - 5 * D, source: 'orb', text: 'Urgent: the kitchen tap is leaking', route: 'agent', decided_by: 'model', state: 'done', thread_id: 'qa-urgent', urgent: true, tags: [] },
  { id: 'sent_' + 'd'.repeat(24), at: now - 10 * M, source: 'orb', text: 'Tell Miguel it is sent', route: 'agent', decided_by: 'model', state: 'done', thread_id: 'qa-quiet', tags: [] }], next: null, check: null });
const report = { origin, web, cases: [] };
// The list's structure without sizes: what a person reads, in order.
function structure(root) {
  const seen = n => !!n && n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden' && getComputedStyle(n).display !== 'none';
  const STATE = new Set(['cur', 'on', 'open', 'swiped', 'swiping']);
  const cls = n => [...n.classList].filter(c => !STATE.has(c)).sort().join('.');
  const parts = n => [...n.querySelectorAll('*')].filter(seen).map(x => x.tagName.toLowerCase() + (cls(x) ? '.' + cls(x) : '')).join(' ');
  const text = n => (n?.textContent || '').replace(/\s+/g, ' ').trim();
  const list = root, tb = list.querySelector(':scope > .ch-tbar');
  const out = {
    bar: tb && seen(tb) ? { title: text(tb.querySelector('.ch-tbar-t')), buttons: [...tb.querySelectorAll('button')].filter(seen).map(b => b.getAttribute('aria-label')) } : null,
    heads: [...list.querySelectorAll(':scope > .ch-top:not(.ch-tbar), :scope > .ch-chan-h, :scope > .ch-sent-h')].filter(seen).map(n => cls(n) + ':' + text(n)),
    sections: [...list.querySelectorAll('section.ch-sec[data-sec]')].filter(seen).map(s => s.dataset.sec + (s.querySelector(':scope > .ch-sec-h, :scope > .ch-sec-hl') ? ':fold' : '') + (s.classList.contains('open') ? ':open' : '') + (s.querySelector('[data-chactorder]') ? ':sort' : '')),
    // (a row's words without its relative time: the cases run minutes apart on one fixed clock)
    rows: [...list.querySelectorAll('.ch-scroll .ch-row-wrap, .ch-scroll .ch-chan, .ch-scroll .ch-post')].filter(seen).map(r => { const c = r.cloneNode(true); c.querySelectorAll('time').forEach(t => t.remove()); return { key: r.dataset.morphKey || '', cls: cls(r), parts: parts(r), words: text(c) }; }),
    tabs: [...list.querySelectorAll(':scope > .ch-tabbar [data-chtab]')].filter(seen).map(b => b.dataset.chtab + (b.getAttribute('aria-selected') === 'true' ? '*' : '')),
  };
  return out;
}
(async () => {
  const browser = await chromium.launch();
  try {
    for (const skin of SKINS) {
      // The phone first, then the sidebar at each size, from fresh copies of the same data.
      const phone = {};
      for (const shell of ['phone', ...SIZES.map(s => 'aiapps-' + s)]) {
        const isPhone = shell === 'phone', [vw, vh] = isPhone ? [390, 844] : shell.slice(7).split('x').map(Number), stem = `${shell}-${skin}`;
        const entry = { stem, errors: [], refused: [], writes: [] }; report.cases.push(entry);
        THREADS = fresh(); BOX = boxFresh();
        const context = await browser.newContext({ viewport: { width: vw, height: vh }, isMobile: isPhone, hasTouch: isPhone, serviceWorkers: 'block', ...(isPhone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' } : {}) });
        try {
          await context.routeWebSocket('**/*', w => w.close());
          await context.addInitScript(({ isPhone, skin }) => {
            if (window !== top) return;
            if (sessionStorage.getItem('qaBoot')) return; sessionStorage.setItem('qaBoot', '1');
            for (const [k, v] of Object.entries({ 'wos.shell': isPhone ? 'phone' : 'desktop', 'wux.shell': isPhone ? 'phone' : 'desktop', 'wos.desktop-view.v1': 'ai-apps', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
              'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix: {} }) })) localStorage.setItem(k, v);
          }, { isPhone, skin });
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
          await page.goto(origin + prefix + (isPhone ? 'index.html?phone' : 'desktop.html'));
          await page.waitForFunction(() => (window.__wux || window.__wos) && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
          await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
          if (isPhone) await page.evaluate(() => __wos.openSheet('inbox'));
          const LIST = isPhone ? '.ch-list' : '.aad-chan > .ch-list';
          const vis = sel => page.locator(sel).filter({ visible: true }).first();
          const shot = async name => { await page.evaluate(() => document.fonts.ready); await new Promise(r => setTimeout(r, 300)); await page.screenshot({ path: path.join(out, `${stem}-${name}.png`) }); };
          const read = () => page.evaluate(([sel, fn]) => { const seen = n => !!n && n.getClientRects().length > 0; const root = [...document.querySelectorAll(sel)].find(seen); return root ? (0, eval)('(' + fn + ')')(root) : null; }, [LIST, structure.toString()]);
          await vis(LIST + ' > .ch-tabbar').waitFor({ timeout: 15000 });
          await vis(LIST + ' [data-chopen="qa-new"]').waitFor({ timeout: 15000 });
          await page.waitForFunction(sel => !!document.querySelector(sel + ' [data-chrunopen="qa-bg"]'), LIST, { timeout: 15000 }).catch(() => {});
          await new Promise(r => setTimeout(r, 900));
          const got = {};
          got.inbox = await read(); await shot('1-inbox');
          await vis(LIST + ' > .ch-tabbar [data-chtab="tags"]').click(); await new Promise(r => setTimeout(r, 800));
          got.tags = await read(); await shot('2-tags');
          await vis(LIST + ' > .ch-tabbar [data-chtab="sent"]').click(); await new Promise(r => setTimeout(r, 1000));
          got.sent = await read(); await shot('3-sent');
          await vis(LIST + ' > .ch-tabbar [data-chtab="tags"]').click(); await new Promise(r => setTimeout(r, 800));
          // One tag: on the phone its list opens in place; on the desktop in the main column, beside the sidebar.
          await vis(LIST + ' [data-chchan="trip"]').click(); await new Promise(r => setTimeout(r, 1200));
          got.tag = isPhone ? await read() : await page.evaluate(([fn]) => { const seen = n => !!n && n.getClientRects().length > 0; const root = [...document.querySelectorAll('.aad-feed .ch-list')].find(seen); return root ? (0, eval)('(' + fn + ')')(root) : null; }, [structure.toString()]);
          await shot('4-tag');
          entry.got = got;
          if (isPhone) Object.assign(phone, got);
          else {
            entry.side = await page.evaluate(() => ({ ownRows: [...document.querySelectorAll('.aad-scroll .aad-rw')].filter(n => n.getClientRects().length).length, ownSec: [...document.querySelectorAll('.aad-scroll .aad-sec')].filter(n => n.getClientRects().length).map(n => n.textContent.trim()) }));
            const diff = [];
            for (const k of ['inbox', 'tags', 'sent']) {
              const a = JSON.stringify(phone[k]), b = JSON.stringify(got[k]);
              if (a !== b) diff.push(k + ':\n phone ' + a.slice(0, 1600) + '\n side  ' + b.slice(0, 1600));
            }
            // The tag's posts: the same rows in the same order (its header is the column's own on the desktop).
            const tp = JSON.stringify(phone.tag?.rows), td = JSON.stringify(got.tag?.rows);
            if (!phone.tag?.rows?.length || tp !== td) diff.push('tag rows:\n phone ' + String(tp).slice(0, 1600) + '\n side  ' + String(td).slice(0, 1600));
            for (const k of ['inbox', 'tags', 'sent']) if (!phone[k]?.rows?.length) diff.push(k + ': the phone drew no rows to compare');
            entry.diff = diff;
            if (broken) { assert.ok(diff.length || entry.side.ownRows, 'before the fix the sidebar differs from the phone'); entry.pass = true; continue; }
            assert.deepEqual(diff, [], 'the sidebar draws what the phone draws:\n' + diff.join('\n'));
            assert.equal(entry.side.ownRows, 0, 'no rows of the sidebar\'s own');
            assert.deepEqual(entry.side.ownSec, [], 'no section rows of the sidebar\'s own');
            assert.equal(got.inbox.bar?.title?.replace(/\d+/g, '').trim(), 'Inbox', 'one title bar named Inbox');
            // Back to Inbox: a click opens the thread in the main column and marks the row current.
            await page.keyboard.press('Escape'); await new Promise(r => setTimeout(r, 500));
            await vis(LIST + ' > .ch-tabbar [data-chtab="inbox"]').click(); await new Promise(r => setTimeout(r, 700));
            await vis(LIST + ' [data-chopen="qa-read"]').click();
            await page.waitForFunction(sel => document.querySelector(sel + ' [data-chopen="qa-read"]')?.getAttribute('aria-current') === 'page', LIST, { timeout: 8000 });
            entry.opened = await page.evaluate(() => [...document.querySelectorAll('.msg, .ch-msg, [data-role]')].filter(n => n.getClientRects().length).map(n => n.textContent).join(' ').includes('Tomatoes by the wall'));
            assert.ok(entry.opened, 'the thread shows in the main column');
            await shot('5-open');
            // Right-click: the row's actions sheet.
            await vis(LIST + ' [data-chopen="qa-prio"]').click({ button: 'right' });
            await vis('.ch-sheet').waitFor({ timeout: 5000 });
            entry.sheet = await page.evaluate(() => [...document.querySelectorAll('.ch-sheet button')].filter(n => n.getClientRects().length).map(n => n.textContent.trim()).slice(0, 12));
            assert.ok(entry.sheet.some(t => /Pin|Unpin/.test(t)) && entry.sheet.some(t => /Archive/.test(t)), 'the row menu has Pin and Archive ' + JSON.stringify(entry.sheet));
            await shot('6-menu');
            await page.keyboard.press('Escape'); await new Promise(r => setTimeout(r, 500));
            // ⌥↓ from the open thread: the next Inbox row as drawn.
            const ids = await page.evaluate(sel => [...document.querySelectorAll(sel + ' section[data-sec="ready"] [data-chopen]')].map(b => b.dataset.chopen), LIST);
            const nextId = ids[ids.indexOf('qa-read') + 1] || ids[0];
            await page.keyboard.press('Alt+ArrowDown');
            await page.waitForFunction(([sel, id]) => document.querySelector(sel + ` [data-chopen="${id}"]`)?.getAttribute('aria-current') === 'page', [LIST, nextId], { timeout: 8000 });
            entry.altDown = nextId;
            // The row's Archive.
            await vis(LIST + ' [data-chibarch="qa-urgent"]').click();
            await page.waitForFunction(sel => !document.querySelector(sel + ' section[data-sec="ready"] [data-chopen="qa-urgent"]'), LIST, { timeout: 8000 });
            assert.ok(entry.writes.some(x => x.method === 'PATCH' && /qa-urgent/.test(x.path)), 'archived on the box');
          }
          assert.equal(entry.errors.length, 0, 'browser errors: ' + entry.errors.join('; '));
          assert.equal(entry.refused.filter(x => x.reason === 'unexpected-write').length, 0, 'unexpected writes: ' + JSON.stringify(entry.refused));
          entry.pass = true;
        } catch (e) {
          // (before the fix the sidebar has no shared list to read at all: that is the difference QA_EXPECT=broken looks for)
          if (broken && !isPhone && !/before the fix the sidebar differs/.test(e.message)) { entry.pass = true; entry.differs = String(e.message).split('\n')[0]; continue; }
          entry.failure = e.stack; const pages = context.pages(); if (pages[0]) await pages[0].screenshot({ path: path.join(out, stem + '-failure.png') }).catch(() => {}); }
        finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await context.close(); }
      }
    }
  } finally { await browser.close(); }
  const failed = report.cases.filter(c => !c.pass);
  console.log(JSON.stringify({ cases: report.cases.length, passed: report.cases.length - failed.length, failed: failed.map(c => c.stem + ': ' + String(c.failure).split('\n').slice(0, 8).join('\n')), screenshots: fs.readdirSync(out).filter(f => f.endsWith('.png')).length }, null, 1));
  if (failed.length || !report.cases.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
