'use strict';
// The app panel on the left (wizard-os#639, switch wizard/app-panel-left). Real browser, AI apps desktop at 1440x900,
// the synthetic transport of tests/qa-desktop-reload-app-beside.cjs (no box is read or written). Switch off: no
// button, the Pages panel sits on the right beside the open-apps column, as before. Switch on: the panel header's
// "Move the app to the left" button puts the panel right after the sidebar with Home's composer clear of it, a chat
// opened from the sidebar docks to the RIGHT of the panel, a reload keeps the choice (this device), and ⌥⇧M moves
// it back. QA_SWITCH=off,on picks the cases.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://reload-restore.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'desktop-app-panel-left-evidence');
const SKINS = (process.env.QA_SKINS || 'nebula').split(',');
const SWITCH = (process.env.QA_SWITCH || 'off,on').split(',');
const DESK = () => ({ wins: { wqa0: { id: 'wqa0', app: 'chats', thread: 'qa-l1' }, wqa1: { id: 'wqa1', app: 'pages', appId: 'pages' } },
    ws: [{ id: 'dqa0', wins: ['wqa0'], focus: 'wqa0', mono: false }, { id: 'dqa1', wins: ['wqa1'], focus: 'wqa1', mono: false }], cur: 0 });
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
    for (const skin of SKINS) for (const sw of SWITCH) {
      const on = sw === 'on', stem = `app-panel-left-${skin}-${sw}`, desk = DESK();
      const entry = { stem, errors: [], refused: [], writes: [] }; report.cases.push(entry);
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        const mix = { 'wizard/desktop-chats': true, ...(on ? { 'wizard/app-panel-left': true } : {}) };
        await context.addInitScript(({ skin, mix, spaces, desk }) => {
          if (window !== top) return;
          if (sessionStorage.getItem('qaBoot')) return; sessionStorage.setItem('qaBoot', '1');
          localStorage.setItem('wux.desk.wins', JSON.stringify(desk.wins)); localStorage.setItem('wux.desk.ws', JSON.stringify(desk.ws)); localStorage.setItem('wux.desk.cur', String(desk.cur)); localStorage.setItem('wux.desk.layoutVersion', '2');
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
        await page.waitForFunction(() => document.documentElement.dataset.layout === 'ai-apps', null, { timeout: 15000 });
        await page.waitForFunction(() => true, null, { timeout: 15000 }).catch(() => {});
        if (on) await page.waitForFunction(() => (document.documentElement.dataset.tweaks || '').split(' ').includes('wizard/app-panel-left'), null, { timeout: 15000 }).catch(() => {});
        entry.tweaks = await page.evaluate(() => document.documentElement.dataset.tweaks);
        assert.equal(entry.tweaks.split(' ').includes('wizard/app-panel-left'), on, stem + ': switch state');
        const vis = sel => page.locator(sel).filter({ visible: true }).first();
        const sideRow = id => vis(`.aad-side .aad-rw[data-sid="${id}"] .aad-row`);
        await sideRow('qa-g1').waitFor({ timeout: 15000 });
        await page.evaluate(() => document.fonts.ready); await nap(1500);
        const seen = () => page.evaluate(() => {
          const box = sel => { const n = [...document.querySelectorAll(sel)].find(x => x.getClientRects().length); if (!n) return null; const b = n.getBoundingClientRect(); return b.width ? [Math.round(b.left), Math.round(b.width)] : null; };
          const r = document.documentElement.dataset, btn = [...document.querySelectorAll('.aad-ptop .aad-pside')].find(b => !b.hidden && b.getClientRects().length);
          return { appSide: r.aadAppSide || '', chatOn: !!r.aadChat, side: box('.aad-side'), vt: box('.aad-vt'), app: box('#stage > .wsp[data-aad-role="app"]:not([data-aad-omitted])'),
            chat: r.aadChat ? box('#stage > .wsp[data-aad-role="chat"]') : null, composer: !r.aadChat ? box('#stage > .wsp[data-aad-role="chat"] .pane-main .ch-compose') : null,
            grip: box('.aad-grip[data-grip="app"]'), button: btn ? btn.getAttribute('aria-label') : null };
        });
        const pagesTab = vis('.aad-vtab[data-app="pages"]');
        await pagesTab.waitFor({ timeout: 15000 }); await pagesTab.click(); await nap(1500);
        if (!(await seen()).app) { await pagesTab.click(); await nap(1500); }
        entry.start = await seen();
        assert.ok(entry.start.app?.[1] > 300, 'the Pages panel shows: ' + JSON.stringify(entry.start));
        const right = s => s.app[0] + s.app[1] >= s.vt[0] - 2;   // the panel's right edge meets the open-apps column
        const left = s => Math.abs(s.app[0] - (s.side[0] + s.side[1])) <= 2;   // its left edge meets the sidebar
        assert.ok(right(entry.start), 'the panel starts on the right, as before: ' + JSON.stringify(entry.start));
        await page.screenshot({ path: path.join(out, stem + '-1-start.png') });
        if (!on) {
          assert.equal(entry.start.button, null, 'switch off: no Move button');
          await page.keyboard.press('Alt+Shift+KeyM'); await nap(800);
          entry.afterKey = await seen();
          assert.ok(right(entry.afterKey) && entry.afterKey.appSide !== 'start', 'switch off: ⌥⇧M does nothing ' + JSON.stringify(entry.afterKey));
          assert.equal(entry.errors.length, 0, 'browser errors: ' + entry.errors.join('; '));
          entry.pass = true; continue;
        }
        assert.equal(entry.start.button, 'Move the app to the left (⌥⇧M)');
        await vis('.aad-ptop .aad-pside').click(); await nap(1200);
        entry.left = await seen();
        await page.screenshot({ path: path.join(out, stem + '-2-left.png') });
        assert.equal(entry.left.appSide, 'start');
        assert.ok(left(entry.left), 'the panel moved next to the sidebar: ' + JSON.stringify(entry.left));
        assert.equal(entry.left.button, 'Move the app to the right (⌥⇧M)');
        if (entry.left.chatOn) {   // (the restored desk has a chat docked: close it to see Home's composer beside the panel)
          await page.evaluate(() => [...document.querySelectorAll('.aad-cx')].find(b => !b.hidden && b.getClientRects().length)?.click()); await nap(1500);
          entry.left = await seen();
          await page.screenshot({ path: path.join(out, stem + '-2b-left-home.png') });
          assert.ok(left(entry.left), 'still next to the sidebar without the chat: ' + JSON.stringify(entry.left));
        }
        assert.ok(entry.left.composer && entry.left.composer[0] >= entry.left.app[0] + entry.left.app[1], "Home's composer is clear of the panel: " + JSON.stringify(entry.left));
        assert.ok(entry.left.grip && Math.abs(entry.left.grip[0] - (entry.left.app[0] + entry.left.app[1])) <= 8, 'the resize grip sits on the panel edge that faces the room: ' + JSON.stringify(entry.left));
        // a chat from the sidebar docks to the right of the panel
        await sideRow('qa-g1').click(); await nap(2000);
        entry.withChat = await seen();
        await page.screenshot({ path: path.join(out, stem + '-3-left-with-chat.png') });
        assert.ok(entry.withChat.chat && entry.withChat.app, 'chat and app both show: ' + JSON.stringify(entry.withChat));
        assert.ok(left(entry.withChat) && entry.withChat.chat[0] >= entry.withChat.app[0] + entry.withChat.app[1] - 2, 'the chat is right of the panel: ' + JSON.stringify(entry.withChat));
        // the choice is kept on this device
        await page.reload();
        await page.waitForFunction(() => window.__wux && !window.WosExperience?.state.busy && document.documentElement.dataset.layout === 'ai-apps', null, { timeout: 15000 });
        await page.evaluate(() => document.fonts.ready); await nap(2500);
        entry.reloaded = await seen();
        assert.equal(entry.reloaded.appSide, 'start', 'a reload keeps the panel on the left: ' + JSON.stringify(entry.reloaded));
        entry.saved = await page.evaluate(() => JSON.parse(localStorage.getItem('wos.pane-layout.v1') || '{}').appSide);
        assert.equal(entry.saved, 'start');
        // ⌥⇧M moves it back to the right
        await page.mouse.click(720, 450).catch(() => {}); await page.evaluate(() => document.activeElement?.blur?.());
        await page.keyboard.press('Alt+Shift+KeyM'); await nap(1200);
        entry.back = await seen();
        await page.screenshot({ path: path.join(out, stem + '-4-back-right.png') });
        assert.notEqual(entry.back.appSide, 'start', '⌥⇧M moved the panel back: ' + JSON.stringify(entry.back));
        if (entry.back.app) assert.ok(right(entry.back), 'back on the right: ' + JSON.stringify(entry.back));
        assert.equal(entry.errors.length, 0, 'browser errors: ' + entry.errors.join('; '));
        entry.pass = true;
      } catch (e) { entry.failure = e.stack; const pages = context.pages(); if (pages[0]) await pages[0].screenshot({ path: path.join(out, stem + '-failure.png') }).catch(() => {}); }
      finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await context.close(); }
    }
  } finally { await browser.close(); }
  const failed = report.cases.filter(c => !c.pass);
  console.log(JSON.stringify({ cases: report.cases.length, passed: report.cases.length - failed.length, failed: failed.map(c => c.stem + ': ' + String(c.failure).split('\n').slice(0, 2).join(' | ')) }));
  if (failed.length || report.cases.length !== SKINS.length * SWITCH.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
