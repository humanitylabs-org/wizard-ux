'use strict';
// A reload keeps what the AI apps desktop showed (wizard-ux issue 1339: James tapped the update's Reload and the page
// came back with the chat column empty, his channel gone). Real browser, AI apps desktop at 1440x900, Channels on
// (wizard/chat-channels), the same disposable synthetic transport as tests/qa-desktop-channel-esc-view.cjs (no box is
// read or written). Two desks: Chats with a thread open, and the Pages app. Per case (the Chats desk in front, or the
// app in front with the chat column beside it): reload -> the same chat; open # Launch's feed -> reload -> the same
// feed, the same desks, the same boxes. QA_EXPECT=broken (QA_WEB=<main worktree>/web) asserts main loses the feed.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://reload-restore.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'desktop-reload-restore-evidence');
const SKINS = (process.env.QA_SKINS || 'nebula').split(',');
const EXPECT = process.env.QA_EXPECT || 'fixed'; // 'broken': main before issue 1339 (the feed is gone after a reload)
const FRONTS = (process.env.QA_FRONTS || 'chats,app').split(',');
const DESK = front => ({ wins: { wqa0: { id: 'wqa0', app: 'chats', thread: 'qa-l1' }, wqa1: { id: 'wqa1', app: 'pages', appId: 'pages' } },
  ws: [{ id: 'dqa0', wins: ['wqa0'], focus: 'wqa0', mono: false }, { id: 'dqa1', wins: ['wqa1'], focus: 'wqa1', mono: false }], cur: front === 'app' ? 1 : 0 });
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
    for (const skin of SKINS) for (const front of FRONTS) {
      const on = true, stem = `reload-restore-${skin}-${front}-${EXPECT}`, desk = DESK(front);
      const entry = { stem, errors: [], refused: [], writes: [] }; report.cases.push(entry);
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        const mix = { 'wizard/desktop-chats': true, ...(on ? { 'wizard/chat-channels': true } : {}) };
        await context.addInitScript(({ skin, mix, spaces, desk }) => {
          if (window !== top) return;
          if (sessionStorage.getItem('qaBoot')) return; sessionStorage.setItem('qaBoot', '1');
          if (desk) { localStorage.setItem('wux.desk.wins', JSON.stringify(desk.wins)); localStorage.setItem('wux.desk.ws', JSON.stringify(desk.ws)); localStorage.setItem('wux.desk.cur', String(desk.cur)); localStorage.setItem('wux.desk.layoutVersion', '2'); if (desk.home === false) localStorage.setItem('wux.desk.homeOpen', 'false'); }
          for (const [k, v] of Object.entries({ 'wos.shell': 'desktop', 'wux.shell': 'desktop', 'wos.desktop-view.v1': 'ai-apps', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
            'wos.chats.spaces.v1': JSON.stringify(spaces), 'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v);
        }, { skin, mix, spaces: SPACES, desk });
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
        const boxOf = sel => { const n = document.querySelector(sel); if (!n || !n.getClientRects().length) return null; const b = n.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.width)]; };
        // What the owner sees: which desk is in front, the chat column (its title, a thread or the feed) and the app panel.
        const seen = () => page.evaluate(boxOf => {
          const box = new Function('return ' + boxOf)(), g = k => localStorage.getItem('wux.desk.' + k);
          const aad = document.querySelector('[data-aad-split], [data-aad-chat]');
          const thread = [...document.querySelectorAll('.ch-thread')].find(t => t.getClientRects().length && /Can you get the launch checklist/.test(t.innerText));
          return { desks: JSON.parse(g('ws') || '[]').map(d => d.wins.join()), cur: g('cur'), front: document.documentElement.dataset.aiFront,
            title: (document.querySelector('.aad-ctop')?.innerText || '').trim().split('\n')[0], thread: !!thread,
            feed: !!document.querySelector('[data-aad-feed]') && [...document.querySelectorAll('.aad-feed .ch-post-b[data-chopen="qa-p12"]')].some(n => n.getClientRects().length),
            chat: aad?.dataset.aadChat ? box('[data-aad-role="chat"]:not([data-aad-omitted])') : null, app: box('[data-aad-role="app"]:not([data-aad-omitted])') };
        }, boxOf.toString());
        const reload = async () => {
          await page.reload();
          await page.waitForFunction(() => window.__wux && !window.WosExperience?.state.busy && document.documentElement.dataset.layout === 'ai-apps', null, { timeout: 15000 });
          await page.evaluate(() => document.fonts.ready); await nap(2500);
        };
        await nap(1500);
        entry.start = await seen();
        assert.ok(entry.start.thread, 'the restored chat shows: ' + JSON.stringify(entry.start));
        if (front === 'app') assert.ok(entry.start.app?.[1] > 300 && entry.start.chat?.[1] > 300, 'the app with the chat beside it: ' + JSON.stringify(entry.start));
        await page.screenshot({ path: path.join(out, stem + '-1-chat.png') });
        await reload();
        entry.chatReloaded = await seen();
        assert.deepEqual(entry.chatReloaded, entry.start, 'a reload keeps the chat, the desks and their places');
        // The channel's feed in the chat column, then a reload.
        await vis('.aad-chan [data-chview="channels"]').click();
        await vis('.aad-chan .ch-chan-open[data-chchan="launch"]').click();
        await vis('.aad-feed .ch-post-b[data-chopen="qa-p12"]').waitFor({ timeout: 8000 }); await nap(800);
        entry.feed = await seen();
        assert.ok(entry.feed.feed && /# Launch/.test(entry.feed.title), 'the feed in the chat column: ' + JSON.stringify(entry.feed));
        await page.screenshot({ path: path.join(out, stem + '-2-feed.png') });
        await reload();
        entry.feedReloaded = await seen();
        await page.screenshot({ path: path.join(out, stem + '-3-feed-reloaded.png') });
        if (EXPECT === 'broken') {
          assert.equal(entry.feedReloaded.feed, false, 'main: the feed is gone after a reload');
          entry.pass = true; continue;
        }
        assert.deepEqual(entry.feedReloaded, entry.feed, 'a reload keeps the open channel feed, the desks and their places');
        // and it still works: a post opens its thread, Esc comes back to the feed
        await vis('.aad-feed .ch-post-b[data-chopen="qa-p12"]').click();
        await page.waitForFunction(() => [...document.querySelectorAll('.ch-thread')].some(t => t.getClientRects().length && /Synthetic ask for Launch post 12/.test(t.innerText)), null, { timeout: 8000 });
        await page.keyboard.press('Escape'); await vis('.aad-feed .ch-post-b[data-chopen="qa-p12"]').waitFor({ timeout: 5000 });
        // closing the feed is saved too: a reload does not bring it back
        await page.keyboard.press('Escape'); await nap(1200);
        assert.equal((await seen()).feed, false, 'Esc closed the feed');
        await reload();
        entry.closedReloaded = await seen();
        assert.equal(entry.closedReloaded.feed, false, 'a closed feed stays closed after a reload');
        assert.equal(entry.errors.length, 0, 'browser errors: ' + entry.errors.join('; '));
        entry.pass = true;
      } catch (e) { entry.failure = e.stack; const pages = context.pages(); if (pages[0]) await pages[0].screenshot({ path: path.join(out, stem + '-failure.png') }).catch(() => {}); }
      finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await context.close(); }
    }
  } finally { await browser.close(); }
  const failed = report.cases.filter(c => !c.pass);
  console.log(JSON.stringify({ expect: EXPECT, cases: report.cases.length, passed: report.cases.length - failed.length, failed: failed.map(c => c.stem + ': ' + String(c.failure).split('\n').slice(0, 2).join(' | ')) }));
  if (failed.length || report.cases.length !== SKINS.length * FRONTS.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
