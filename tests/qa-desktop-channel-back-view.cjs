'use strict';
// Back (the "‹ # channel" button, and separately Esc) from a channel post's thread on an app desk keeps the selected
// view, the app panel and the feed's scroll place (wizard-ux issue 1325; James, 12 Nov 2026: "going back shouldn't change
// the user's selected view"). Real browser, AI apps desktop at 1440x900, Nebula + Grove, Channels on (wizard/chat-channels), the
// Pages app open on its own desk, and the same disposable synthetic transport as tests/qa-desktop-channel-back.cjs (no box
// is read or written). Per skin, per view (tiled, pair = 50/50, centre, full) and per way back (the Back button, Esc):
// open # Launch -> scroll the feed -> a post -> Back -> the desk is exactly as it was on the feed (view icon, chat column,
// app panel and their boxes) and the feed is at the same scroll place. QA_EXPECT=broken (QA_WEB=<main>/web, QA_VIEWS=full
// QA_WAYS=esc) asserts main's Esc on a full-screen post drops to tiled.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://chat-channels.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'desktop-channel-back-view-evidence');
const SKINS = (process.env.QA_SKINS || 'nebula,grove').split(',');
const EXPECT = process.env.QA_EXPECT || 'fixed';
const VIEWS = (process.env.QA_VIEWS || 'tiled,pair,centre,full').split(',');
const WAYS = (process.env.QA_WAYS || 'button,esc').split(',');
const DESK = { wins: { wqa1: { id: 'wqa1', app: 'pages', appId: 'pages' } }, ws: [{ id: 'dqa1', wins: ['wqa1'], focus: 'wqa1', mono: false }], home: false };
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const MANY = Array.from({ length: 24 }, (_, i) => ({ id: 'qa-p' + String(i).padStart(2, '0'), title: 'Launch post ' + i, status: 'completed', at: now - (20 + i) * 36e5, preview: 'Done ' + i }));
const SPACES = [
  { id: 'launch', name: 'Launch', agent: 'hermes', threads: ['qa-l1', 'qa-l2', 'qa-l3', ...MANY.map(r => r.id)], createdAt: iso(now - 9e8) },
  { id: 'voice', name: 'Voice', agent: 'hermes', threads: ['qa-v1'], createdAt: iso(now - 8e8) },
  { id: 'ideas', name: 'Ideas and a much longer channel name for the sidebar', agent: 'hermes', threads: [], createdAt: iso(now - 7e8) },
];
const FIRST = 'Can you get the launch checklist ready for Friday? I want the press notes, the store listing, the screenshots for both phones and the release notes in one place, and a short list of what is still open so I can decide what slips.';
const PNG = fs.readFileSync(path.join(repo, 'web', 'robert-thread-orb.png'));
const ROWS = [
  { id: 'qa-l1', title: 'Launch checklist', status: 'completed', at: now - 5 * 36e5, attention: { state: 'needs_you', ask: 'Pick a date' }, preview: 'Which date works?' },
  { id: 'qa-l2', title: 'Press notes', status: 'running', at: now - 30 * 6e4, preview: 'Drafting…' },
  { id: 'qa-l3', title: 'Old launch idea', status: 'completed', at: now - 3 * 864e5, archived: true, preview: 'Done.' },
  { id: 'qa-v1', title: 'Voice keys', status: 'completed', at: now - 2 * 36e5, preview: 'Shipped.' },
  ...MANY,
  { id: 'qa-g1', title: 'Weekend plans with a long title that has to fit the sidebar row', status: 'completed', at: now - 60 * 6e4, preview: 'Here is a plan.' },
].map(s => ({ id: s.id, title: s.title, runtime: 'direct', status: s.status, updated_at: iso(s.at), updatedAt: iso(s.at), last_active: s.at / 1000, message_count: 4, messageCount: 4, archived: !!s.archived, preview: s.preview,
  ...(s.attention ? { wizard_attention: s.attention } : {}), ...(s.status === 'running' ? { wizard_run_id: 'run-' + s.id, wizard_assigned_at: iso(s.at) } : {}) }));
const report = { origin, web, cases: [] };
(async () => {
  const browser = await chromium.launch();
  try {
    for (const skin of SKINS) for (const view of VIEWS) {
      for (const way of WAYS) {
      const on = true, stem = `channel-back-${skin}-${view}-${way}-${EXPECT}`;
      const entry = { stem, errors: [], refused: [], writes: [] }; report.cases.push(entry);
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        const mix = { 'wizard/desktop-chats': true, ...(on ? { 'wizard/chat-channels': true } : {}) };
        await context.addInitScript(({ skin, mix, spaces, desk }) => {
          if (window !== top) return;
          if (sessionStorage.getItem('qaBoot')) return; sessionStorage.setItem('qaBoot', '1');
          if (desk) { localStorage.setItem('wux.desk.wins', JSON.stringify(desk.wins)); localStorage.setItem('wux.desk.ws', JSON.stringify(desk.ws)); localStorage.setItem('wux.desk.cur', '0'); localStorage.setItem('wux.desk.layoutVersion', '2'); if (desk.home === false) localStorage.setItem('wux.desk.homeOpen', 'false'); }
          for (const [k, v] of Object.entries({ 'wos.shell': 'desktop', 'wux.shell': 'desktop', 'wos.desktop-view.v1': 'ai-apps', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
            'wos.chats.spaces.v1': JSON.stringify(spaces), 'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v);
        }, { skin, mix, spaces: SPACES, desk: DESK });
        let prefs = { migrations: { 'launcher-seed-v1': true }, spaces: structuredClone(SPACES) };
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
          if (u.origin !== origin) { entry.refused.push({ method, url: q.url(), reason: 'external' }); return r.abort(); }
          if (!['GET', 'HEAD'].includes(method)) {
            entry.writes.push({ method, path: p });
            if (method === 'PUT' && p === '/wizard/thread-seen') return r.fulfill({ json: { ok: true, state: q.postDataJSON() } });
            if (method === 'POST' && p === '/wizard/files/upload') { const id = 'qa-up-' + entry.writes.length; return r.fulfill({ json: { file: { id, filename: q.headers()['x-wizard-filename'], mime: q.headers()['x-wizard-mime'], bytes: PNG.length } } }); }
            if (method === 'POST' && p === '/wizard/hermes/api/sessions') { const b = q.postDataJSON() || {}; entry.created = b; return r.fulfill({ json: { session: { id: b.id } } }); }
            if (method === 'POST' && p === '/wizard/hermes/v1/runs') { entry.runs = (entry.runs || []).concat(q.postData() || ''); return r.fulfill({ json: { run_id: 'run-qa-' + entry.runs.length } }); }
            if (method === 'PATCH' && p === '/wizard/v1/ui-preferences') {
              for (const op of q.postDataJSON()?.ops || []) { const m = /^spaces\/([a-z0-9-]+)\/threads$/.exec(op.key); if (m && op.op === 'add') prefs.spaces = prefs.spaces.map(s => s.id === m[1] && !s.threads.includes(op.item) ? { ...s, threads: s.threads.concat(op.item) } : s); }
              return r.fulfill({ json: prefs });
            }
            entry.refused.push({ method, path: p, reason: 'unexpected-write' }); return r.fulfill({ status: 405, json: { error: 'Synthetic fixture refuses this write' } });
          }
          if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
          if (p.startsWith(prefix)) {
            const f = decodeURIComponent(p.slice(prefix.length) || 'index.html'), abs = path.resolve(web, f);
            if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
            if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return r.fulfill({ path: abs });
            return r.fulfill({ status: 404, body: 'No synthetic static asset' });
          }
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: prefs });
          if (/^\/wizard\/files\/qa-up-\d+\/content$/.test(p)) return r.fulfill({ body: PNG, contentType: 'image/png' });
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: ROWS, has_more: false } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) { const s = ROWS.find(x => x.id === decodeURIComponent(m[1])); if (!s) return r.fulfill({ status: 404, json: { error: 'missing' } });
            const ask = s.id === 'qa-l1' ? FIRST : 'Synthetic ask for ' + s.title;
            return r.fulfill({ json: m[2] ? { messages: [{ role: 'user', content: ask, timestamp: now / 1000 - 600 }, { role: 'assistant', content: s.preview, timestamp: now / 1000 - 590 }] } : { session: s } }); }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + prefix + 'desktop.html');
        await page.waitForFunction(() => window.__wux && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        assert.equal(await page.evaluate(() => document.documentElement.dataset.skin), skin);
        await page.waitForFunction(() => document.documentElement.dataset.layout === 'ai-apps', null, { timeout: 15000 });
        if (on) await page.waitForFunction(() => (document.documentElement.dataset.tweaks || '').split(' ').includes('wizard/chat-channels'), null, { timeout: 15000 }).catch(() => {});
        entry.tweaks = await page.evaluate(() => document.documentElement.dataset.tweaks);
        assert.equal(entry.tweaks.split(' ').includes('wizard/chat-channels'), on, stem + ': switch state');
        const vis = sel => page.locator(sel).filter({ visible: true }).first();
        const sideRow = id => vis(`.aad-side .aad-rw[data-sid="${id}"] .aad-row`);
        await sideRow('qa-g1').waitFor({ timeout: 15000 });
        await page.evaluate(() => document.fonts.ready); await nap(400);
        const startUrl = page.url();
        // The layout an owner sees: the pressed view icon, the chat column and the app panel, and where each sits.
        const layout = () => page.evaluate(() => {
          const r = document.documentElement, aad = document.querySelector('[data-aad-split], [data-aad-chat]');
          const box = n => { if (!n || !n.getClientRects().length) return null; const b = n.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.width)]; };
          const role = k => box(document.querySelector(`[data-aad-role="${k}"]:not([data-aad-omitted])`));
          return { view: [...document.querySelectorAll('.aad-ptop [data-mode][aria-pressed="true"]')].map(b => b.dataset.mode).join(),
            chatColumn: !!aad?.dataset.aadChat, appBeside: !!aad?.dataset.aadSplit, wide: r.hasAttribute('data-aad-wide') || !!document.querySelector('[data-aad-wide]'),
            app: role('app'), chat: aad?.dataset.aadChat ? role('chat') : null, feed: !!document.querySelector('[data-aad-feed]') };
        });
        // The Pages panel in front (a restored desk can paint it before its frame has a width: show it again).
        const pages = vis('.aad-vtab[data-app="pages"]'); await pages.waitFor({ timeout: 15000 }); await nap(1500);
        if (!(await layout()).app?.[1]) { await pages.click(); await nap(1200); if (!(await layout()).app?.[1]) { await pages.click(); await nap(1500); } }
        if (view !== 'tiled' && view !== 'full') { await vis(`.aad-ptop [data-mode="${view}"]`).click(); await nap(1200); }
        entry.start = await layout();
        assert.equal(entry.start.view, view === 'full' ? 'tiled' : view, 'the chosen view'); assert.ok(entry.start.app?.[1] > 300, 'the app panel shows: ' + JSON.stringify(entry.start));
        await page.screenshot({ path: path.join(out, stem + '-1-before.png') });
        // A channel's feed in the chat column, scrolled away from its start.
        await vis('.aad-chan [data-chview="channels"]').click();
        await vis('.aad-chan .ch-chan-open[data-chchan="launch"]').click();
        await vis('.aad-feed .ch-post-b[data-chopen="qa-p12"]').waitFor({ timeout: 8000 }); await nap(800);
        // full: the feed's own column full screen (its view icon), the same as an owner picking ⌥⇧F on the feed
        if (view === 'full') { await vis('.aad-ctop [data-mode="full"]').click(); await nap(1200); }
        const scroller = () => page.evaluate(() => { const f = document.querySelector('.aad-feed .ch-scroll'); return f ? { top: Math.round(f.scrollTop), max: f.scrollHeight - f.clientHeight } : null; });
        await vis('.aad-feed .ch-scroll').hover(); await page.mouse.wheel(0, -400); await nap(600);
        const target = vis('.aad-feed .ch-post-b[data-chopen="qa-p12"]');
        await target.scrollIntoViewIfNeeded(); await nap(400);
        entry.feedOpen = await layout(); entry.before = await scroller();
        assert.ok(entry.feedOpen.feed, 'the feed in the chat column ' + JSON.stringify(entry.feedOpen));
        assert.equal(entry.feedOpen.view, view, 'the feed open in the chosen view');
        await page.screenshot({ path: path.join(out, stem + '-2-feed.png') });
        await target.click();
        await page.waitForFunction(() => [...document.querySelectorAll('.ch-thread')].some(t => t.getClientRects().length && /Synthetic ask for Launch post 12/.test(t.innerText)), null, { timeout: 8000 });
        await nap(600); entry.thread = await layout();
        await page.screenshot({ path: path.join(out, stem + '-3-thread.png') });
        if (way === 'button') await vis('.aad-cback').click(); else await page.keyboard.press('Escape');
        if (EXPECT === 'broken' && view === 'full' && way === 'esc') {
          // main before issue 1325: Esc on a full-screen post leaves full screen for tiled and the thread stays
          await nap(1500); entry.back = await layout(); await page.screenshot({ path: path.join(out, stem + '-4-back.png') });
          assert.equal(entry.back.view, 'tiled', 'main: full screen falls back to tiled'); assert.equal(entry.back.feed, false, 'main: the thread stays');
          entry.pass = true; continue;
        }
        await vis('.aad-feed .ch-chan-feed').waitFor({ timeout: 5000 }); await nap(1200);
        entry.back = await layout(); entry.after = await scroller();
        await page.screenshot({ path: path.join(out, stem + '-4-back.png') });
        assert.equal(entry.thread.view, view, 'the post keeps the view');
        assert.deepEqual(entry.back, entry.feedOpen, 'Back leaves the desk exactly as it was on the feed');
        assert.ok(Math.abs(entry.after.top - entry.before.top) <= 4, `the feed at the same place: ${entry.before.top} -> ${entry.after.top}`);
        assert.equal(page.url(), startUrl, 'Back never leaves Wizard');
        assert.equal(entry.errors.length, 0, 'browser errors: ' + entry.errors.join('; '));
        entry.pass = true;
      } catch (e) { entry.failure = e.stack; const pages = context.pages(); if (pages[0]) await pages[0].screenshot({ path: path.join(out, stem + '-failure.png') }).catch(() => {}); }
      finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await context.close(); }
    }
    }
  } finally { await browser.close(); }
  const failed = report.cases.filter(c => !c.pass);
  console.log(JSON.stringify({ expect: EXPECT, cases: report.cases.length, passed: report.cases.length - failed.length, failed: failed.map(c => c.stem + ': ' + String(c.failure).split('\n').slice(0, 2).join(' | ')), cases_detail: report.cases.map(c => ({ stem: c.stem, feed: c.feedOpen, thread: c.thread, back: c.back, before: c.before, after: c.after })) }));
  if (failed.length || report.cases.length !== SKINS.length * VIEWS.length * WAYS.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
