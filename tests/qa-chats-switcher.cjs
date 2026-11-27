'use strict';
// Phone Chats switcher (wizard-ux issue 1957, on for everyone) in a real browser, disposable synthetic box
// only. Phone 412x915 (Android), Nebula and a light skin, three tags (Philosopher, WizardOS Launch, Trip), a second
// agent (Claude), one archived chat and a Sent log. It checks, as a person would do it:
//   one bottom bar (no Inbox · Tags · Sent row, the list reaches the bar, the tile stays icon + "Chats" + its badge);
//   the title names the view with a ▾ and opens the sheet; tap Chats on Chats opens the sheet (Inbox with its count,
//   Sent, Archived at the bottom, tags and agents above, the view showing outlined), Chats again / a tap outside / Back
//   close it; Sent in two taps; Philosopher is one tile and opens the same list as Tags › Philosopher; hold Chats and
//   slide opens the item under the finger (letting go on nothing changes nothing); a sideways swipe on the Chats tile
//   flips the last two views (never the section swipe); a sideways swipe on the bar or the orb steps one view at a time
//   and stops at the ends; Back from a tag goes to Inbox, then Home; the badge counts the Inbox in every view; a live skin
//   change repaints the open sheet; no browser errors, no writes the box would refuse.
// Shots and report.json go to QA_OUT.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://chats-switcher-1957.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'chats-switcher-evidence');
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
const fresh = () => ({
  'qa-new': { title: 'Weather tomorrow', at: now - 20 * M, channel: 'trip', msgs: [['user', 'Tell me the weather in Lisbon tomorrow', 0], ['assistant', 'Sunny, 18 °C.', 30]] },
  'qa-read': { title: 'Garden plan', at: now - 3 * D, msgs: [['user', 'Plan the garden beds', 0], ['assistant', 'Tomatoes by the wall.', 60]] },
  'qa-needs': { title: 'Dentist slot', at: now - 50 * M, attention: { state: 'needs_you', ask: 'Tuesday or Thursday?' }, msgs: [['user', 'Find a dentist slot', 0], ['assistant', 'Tuesday 10:00 or Thursday 16:00?', 60]] },
  'qa-phil': { title: 'Free will and agents', at: now - 2 * 36e5, channel: 'philosopher', msgs: [['user', 'Can an agent have free will?', 0], ['assistant', 'Compatibilism says yes, in a sense.', 60]] },
  'qa-launch': { title: 'Launch checklist', at: now - 30 * M, channel: 'launch', msgs: [['user', 'What is left before launch?', 0], ['assistant', 'Three things.', 60]] },
  'qa-old': { title: 'Old archived', at: now - 6 * D, archived: true, msgs: [['user', 'Old question', 0], ['assistant', 'Old answer', 60]] },
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
        await context.addInitScript(({ skin, mix }) => {
          if (window !== top) return;
          if (sessionStorage.getItem('qaBoot')) return; sessionStorage.setItem('qaBoot', '1');
          for (const [k, v] of Object.entries({ 'wos.shell': 'phone', 'wux.shell': 'phone', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.tour.done': '1', 'wos.welcome.v1': 'done', 'wos.voiceTipSeen': 'true', 'wos.skin': skin,
            'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v);
          window.__vib = []; try { navigator.vibrate = ms => { window.__vib.push(ms); return true; }; } catch (_) {}
        }, { skin, mix: {} });
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
          if (u.origin !== origin) { entry.refused.push({ method, url: q.url(), reason: 'external' }); return r.abort(); }
          if (p.includes('/v1/runs')) return r.abort();
          if (!['GET', 'HEAD'].includes(method)) {
            entry.writes.push({ method, path: p });
            if (method === 'PUT' && p === '/wizard/thread-seen') return r.fulfill({ json: { ok: true, state: q.postDataJSON() } });
            if (method === 'PUT' && p === '/wizard/v1/channels/read') return r.fulfill({ json: { schema: 'wizard.channel-reads/1', at: {} } });
            if (p === '/wizard/v1/ui-preferences' && ['PUT', 'PATCH'].includes(method)) return r.fulfill({ json: { ...(q.postDataJSON() || {}) } });
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
          if (pts.length === 1) await nap(holdMs);
          for (const p of pts.slice(1)) { await nap(stepMs); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [p] }); }
          if (pts.length > 1) await nap(holdMs);
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        };
        const tapAt = async sel => { await page.evaluate(s => document.querySelector(s)?.scrollIntoView?.({ block: 'nearest' }), sel); const p = await center(sel); await page.touchscreen.tap(p.x, p.y); await nap(700); };
        const sideways = async (sel, dx, stepMs = 16) => { const p = await center(sel); await touch([p, ...[1, 2, 3, 4, 5].map(k => ({ x: p.x + dx * k / 5, y: p.y }))], 10, stepMs); await nap(900); };
        // What a person sees: the list's title, the tabs, the sheet, the bar.
        const look = () => page.evaluate(() => {
          const seen = n => !!n && n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden' && getComputedStyle(n).display !== 'none';
          const list = [...document.querySelectorAll('.ch-list')].find(seen), tb = list?.querySelector('.ch-tbar-t'), sheet = document.querySelector('#chatsSwitch');
          const tile = document.querySelector('.sec-tile[data-sec="chats"]'), dock = document.querySelector('#dock').getBoundingClientRect();
          const scroll = list?.querySelector(':scope > .ch-scroll')?.getBoundingClientRect();
          const S = window.WizCore.chatsSwitcher;
          return { title: tb ? tb.innerText.replace(/\s+/g, ' ').trim() : '', chev: !!tb?.querySelector('[data-chswitch] .ch-tbar-chev'), tabbar: seen(list?.querySelector('.ch-tabbar')),
            section: window.WizCore.phoneSections.current(), view: S ? S.view() : '', open: !!S && S.isOpen() && seen(sheet),
            sheet: seen(sheet) ? { base: [...sheet.querySelectorAll('.cs-base [data-csview]')].map(b => b.dataset.csview + (b.classList.contains('cur') ? '*' : '') + (b.querySelector('.cs-n') ? ':' + b.querySelector('.cs-n').textContent : '')),
              grid: [...sheet.querySelectorAll('.cs-grid [data-csview]')].map(b => b.dataset.csview + (b.classList.contains('cur') ? '*' : '')), bg: getComputedStyle(sheet).backgroundImage + ' ' + getComputedStyle(sheet).backgroundColor,
              box: (r => [r.left, r.top, r.width, r.height].map(Math.round))(sheet.getBoundingClientRect()),
              gridScrolls: (g => !!g && g.scrollHeight > g.clientHeight + 4)(sheet.querySelector('.cs-grid')), perRow: (g => g ? new Set([...g.children].map(b => Math.round(b.getBoundingClientRect().top))).size && [...g.children].filter(b => Math.round(b.getBoundingClientRect().top) === Math.round(g.children[0].getBoundingClientRect().top)).length : 0)(sheet.querySelector('.cs-grid')),
              baseSeen: [...sheet.querySelectorAll('.cs-base [data-csview]')].every(b => { const r = b.getBoundingClientRect(); return r.height >= 44 && r.bottom <= sheet.getBoundingClientRect().bottom + 1; }),
              minTarget: Math.min(...[...sheet.querySelectorAll('[data-csview]')].map(b => Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height))), aboveBar: Math.round(dock.top - sheet.getBoundingClientRect().bottom) } : null,
            tile: { label: tile?.querySelector('.sec-nm')?.textContent || '', lines: tile ? [...tile.querySelectorAll('.sec-nm')].length : 0, badge: tile?.querySelector('.sec-bg')?.textContent || '', text: tile?.innerText.replace(/\s+/g, ' ').trim() },
            gap: scroll ? Math.round(dock.top - scroll.bottom) : null, rows: list ? [...list.querySelectorAll('[data-chopen]')].filter(seen).map(b => b.dataset.chopen) : [],
            feedText: list ? list.innerText.slice(0, 400) : '' };
        });
        const S = entry.steps;
        await tapAt('.sec-tile[data-sec="chats"]'); await nap(900);
        await page.waitForFunction(() => document.querySelector('.ch-list [data-chopen="qa-new"]'), null, { timeout: 15000 });
        await nap(600);
        S.inbox = await look(); await shot('1-inbox');
        {
          // 1-3. One bar; the tile is icon + Chats + badge; the title names the view with a ▾.
          assert.ok(!S.inbox.tabbar, 'no second bar ' + JSON.stringify(S.inbox));
          assert.equal(S.inbox.tile.label, 'Chats'); assert.equal(S.inbox.tile.lines, 1, 'no second line on the tile');
          assert.ok(S.inbox.gap !== null && S.inbox.gap <= 2, 'the list reaches the main bar: gap ' + S.inbox.gap);
          assert.ok(/^Inbox\b/.test(S.inbox.title) && S.inbox.chev, 'the title names Inbox with a ▾ ' + JSON.stringify(S.inbox.title));
          const badge = S.inbox.tile.badge; assert.ok(badge, 'the Chats badge shows');
          // 5. Tap Chats on Chats: the sheet rises from the bar.
          await tapAt('.sec-tile[data-sec="chats"]'); S.sheet = await look(); await shot('2-sheet');
          assert.ok(S.sheet.open, 'tap Chats on Chats opens the sheet');
          assert.deepEqual(S.sheet.sheet.base, ['inbox*:' + badge, 'sent', 'archived'], 'Inbox (with its count) · Sent · Archived, Inbox outlined');
          for (const k of ['#philosopher', '#launch', '#trip', '#@agent:claude']) assert.ok(S.sheet.sheet.grid.includes(k), 'tile ' + k + ' ' + JSON.stringify(S.sheet.sheet.grid));
          assert.equal(S.sheet.sheet.grid.filter(k => k === '#philosopher').length, 1, 'Philosopher is one tile');
          assert.equal(S.sheet.sheet.perRow, 4, 'four per row'); assert.ok(S.sheet.sheet.gridScrolls, 'more than two rows: the grid scrolls'); assert.ok(S.sheet.sheet.baseSeen, 'the bottom row stays in the sheet');
          assert.ok(S.sheet.sheet.minTarget >= 44, 'targets of at least 44 px ' + S.sheet.sheet.minTarget);
          assert.ok(S.sheet.sheet.aboveBar >= 0 && S.sheet.sheet.aboveBar <= 30, 'the sheet sits on the bar ' + S.sheet.sheet.aboveBar);
          assert.ok(!/none/.test(S.sheet.sheet.bg.split(' ')[0]) || !/rgba\([^)]*, 0\)/.test(S.sheet.sheet.bg), 'opaque panel ' + S.sheet.sheet.bg);
          await tapAt('.sec-tile[data-sec="chats"]'); assert.ok(!(await look()).open, 'Chats again closes it');
          await tapAt('.sec-tile[data-sec="chats"]'); assert.ok((await look()).open);
          await page.touchscreen.tap(206, 200); await nap(500); assert.ok(!(await look()).open, 'a tap outside closes it');
          await tapAt('.sec-tile[data-sec="chats"]'); assert.ok((await look()).open);
          await page.evaluate(() => __wos.onBack()); await nap(500); S.backSheet = await look();
          assert.ok(!S.backSheet.open && S.backSheet.section === 'chats' && S.backSheet.view === 'inbox', 'Back closes only the sheet ' + JSON.stringify(S.backSheet));
          // From Inbox, Sent in two taps (Chats, Sent); the sheet goes in the same frame.
          await tapAt('.sec-tile[data-sec="chats"]');
          const p = await center('#chatsSwitch [data-csview="sent"]'); await page.touchscreen.tap(p.x, p.y);
          S.sentFrame = await page.evaluate(() => WizCore.chatsSwitcher.isOpen()); await nap(900);
          S.sent = await look(); await shot('3-sent');
          assert.equal(S.sentFrame, false, 'the sheet closes with the tap'); assert.equal(S.sent.view, 'sent'); assert.ok(/^Sent\b/.test(S.sent.title), 'title Sent ' + S.sent.title);
          assert.equal(S.sent.tile.badge, badge, 'the badge counts the Inbox on Sent too');
          // The title's ▾ opens the same sheet.
          await tapAt('.ch-list [data-chswitch]'); S.titleSheet = await look();
          assert.ok(S.titleSheet.open, 'the ▾ opens the bottom sheet'); assert.deepEqual(S.titleSheet.sheet.base, ['inbox:' + badge, 'sent*', 'archived']);
          // Philosopher: the same list as Tags › Philosopher.
          await tapAt('#chatsSwitch [data-csview="#philosopher"]'); await nap(600);
          S.phil = await look(); await shot('4-philosopher');
          assert.equal(S.phil.view, '#philosopher'); assert.match(S.phil.title, /🧠\s*Philosopher/); assert.ok(S.phil.chev);
          assert.match(S.phil.feedText, /Can an agent have free will\?/, 'the Philosopher list shows its chats');
          assert.equal(S.phil.tile.badge, badge, 'the badge counts the Inbox in a tag');
          // 7. A sideways swipe on the tile flips the last two views; never the section swipe.
          await sideways('.sec-tile[data-sec="chats"]', -60); S.flip1 = await look();
          assert.equal(S.flip1.view, 'sent', 'the tile flip goes back to Sent'); assert.equal(S.flip1.section, 'chats', 'no section swipe');
          await sideways('.sec-tile[data-sec="chats"]', 60); S.flip2 = await look(); await shot('5-flipped');
          assert.equal(S.flip2.view, '#philosopher', 'and forth'); assert.equal(S.flip2.section, 'chats');
          // 6. Hold Chats and slide: the sheet under the finger, letting go on Inbox opens it.
          const tile = await center('.sec-tile[data-sec="chats"]');
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [tile] }); await nap(500);
          S.holdOpen = await look(); await shot('6-hold');
          const ib = await center('#chatsSwitch [data-csview="inbox"]');
          await page.evaluate(() => { window.__vib = []; });
          for (let k = 1; k <= 6; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: tile.x + (ib.x - tile.x) * k / 6, y: tile.y + (ib.y - tile.y) * k / 6 }] }); await nap(30); }
          S.hot = await page.evaluate(() => [...document.querySelectorAll('#chatsSwitch .hot')].map(b => b.dataset.csview)); S.ticks = await page.evaluate(() => window.__vib.slice());
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await nap(900);
          S.held = await look();
          assert.ok(S.holdOpen.open, 'holding Chats opens the sheet'); assert.deepEqual(S.hot, ['inbox'], 'the item under the finger is lit'); assert.ok(S.ticks.includes(5), 'a light haptic tick on the new highlight ' + JSON.stringify(S.ticks));
          assert.ok(!S.held.open && S.held.view === 'inbox', 'letting go opens it ' + JSON.stringify(S.held.view));
          // Letting go on nothing (back on the tile): no change.
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [tile] }); await nap(500);
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: tile.x, y: tile.y - 200 }] }); await nap(60);
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [tile] }); await nap(60);
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await nap(700);
          S.heldNothing = await look(); assert.ok(!S.heldNothing.open && S.heldNothing.view === 'inbox', 'let go on the tile: nothing changes');
          // Back to Inbox with one swipe on the tile (Philosopher -> Inbox was the last pair? the last two are Inbox, Philosopher).
          await sideways('.sec-tile[data-sec="chats"]', -60); S.flip3 = await look(); assert.equal(S.flip3.view, '#philosopher');
          await sideways('.sec-tile[data-sec="chats"]', -60); S.flip4 = await look(); assert.equal(S.flip4.view, 'inbox', 'one swipe on the tile back to Inbox');
          // The bar and the orb step one view at a time (Inbox, Sent, Archived, then tags and agents), stopping at the ends.
          const order = await page.evaluate(() => WizCore.chatsSwitcher.order()); S.order = order;
          await sideways('.sec-tile[data-sec="home"]', 44, 8); S.step1 = await look();
          assert.equal(S.step1.view, 'inbox', 'a swipe right at the first view stays'); assert.equal(S.step1.section, 'chats');
          await sideways('.sec-tile[data-sec="home"]', -44, 8); S.step2 = await look();
          assert.equal(S.step2.view, 'sent', 'a swipe left on the bar steps to Sent'); assert.equal(S.step2.section, 'chats', 'no section change');
          const orb = await center('#orb');
          await touch([orb, ...[1, 2, 3, 4].map(k => ({ x: orb.x - 20 * k, y: orb.y }))], 20); await nap(900); S.step3 = await look();
          assert.equal(S.step3.view, 'archived', 'a sideways swipe on the orb steps to Archived'); assert.match(S.step3.title, /^Archived\b/);
          assert.ok(S.step3.rows.includes('qa-old'), 'Archived lists the archived chat ' + JSON.stringify(S.step3.rows));
          await shot('7-archived');
          await sideways('.sec-tile[data-sec="home"]', -44, 8); S.step4 = await look(); assert.equal(S.step4.view, order[3], 'then the first tag or agent');
          // (the grid is most recently active first, so a list read on the way may move a tile: read the order again)
          S.walk = await page.evaluate(() => { const seen = []; for (let i = 0; i < 30 && WizCore.chatsSwitcher.step(1); i++) seen.push(WizCore.chatsSwitcher.view()); return seen; }); await nap(900);
          const last = (await page.evaluate(() => WizCore.chatsSwitcher.order())).at(-1);
          S.end = await look(); assert.equal(S.end.view, last, 'the last view ' + JSON.stringify(S.walk));
          await sideways('.sec-tile[data-sec="home"]', -44, 8); S.pastEnd = await look(); assert.equal(S.pastEnd.view, last, 'stops at the end'); assert.equal(S.pastEnd.section, 'chats');
          // Another agent's chats: one tile, its own list.
          await tapAt('.sec-tile[data-sec="chats"]'); await tapAt('#chatsSwitch [data-csview="#@agent:claude"]'); await nap(600);
          S.claude = await look(); assert.equal(S.claude.view, '#@agent:claude'); assert.match(S.claude.title, /Claude/);
          // Back from a tag: Inbox (the Tags page is gone), then Home.
          await tapAt('.sec-tile[data-sec="chats"]'); await tapAt('#chatsSwitch [data-csview="#launch"]'); await nap(500);
          await page.evaluate(() => __wos.onBack()); await nap(700); S.back1 = await look();
          assert.equal(S.back1.view, 'inbox', 'Back from a tag goes to Inbox'); assert.ok(!S.back1.tabbar);
          await page.evaluate(() => __wos.onBack()); await nap(700); S.back2 = await look(); assert.equal(S.back2.section, 'home', 'then Home');
          // 4. Tap Chats from elsewhere: Chats in the view you left, no sheet.
          await tapAt('.sec-tile[data-sec="chats"]'); await tapAt('.sec-tile[data-sec="chats"]'); await tapAt('#chatsSwitch [data-csview="sent"]'); await nap(400);
          await tapAt('.sec-tile[data-sec="home"]'); await tapAt('.sec-tile[data-sec="chats"]'); S.returned = await look();
          assert.ok(S.returned.section === 'chats' && S.returned.view === 'sent' && !S.returned.open, 'Chats from Home: the view you left, no sheet ' + JSON.stringify([S.returned.view, S.returned.open]));
          // A live skin change repaints the open sheet.
          await tapAt('.sec-tile[data-sec="chats"]');
          const before = (await look()).sheet.bg, other = skin === 'nebula' ? 'obsidian-light' : 'nebula';
          await page.evaluate(id => WosSkin.set(id), other).catch(() => {}); await nap(900);
          S.liveSkin = { to: other, applied: await page.evaluate(() => WosSkin.current || document.documentElement.dataset.skin || ''), before, after: (await look()).sheet?.bg };
          assert.equal(S.liveSkin.applied, other, 'the skin changed live'); assert.notEqual(S.liveSkin.after, before, 'the sheet repainted in the new skin');
          await shot('8-live-skin');
        }
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
