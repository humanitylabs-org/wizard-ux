'use strict';
// Swap sides (wizard-ux issue 1526, switch wizard/swap-sides). Real browser, AI apps desktop at 1440x900, the synthetic
// transport of tests/qa-desktop-reload-app-beside.cjs (no box is read or written). Switch off: no button, ⌥⇧L does nothing,
// the chats sidebar is left and the Apps column right, as before. Switch on: the chats sidebar header's "Move the chats to
// the right" button puts the chats sidebar on the right and the Apps column on the left, the Pages panel next to the Apps
// column and a docked chat beside the chats sidebar; ⌥L folds the left side (Apps) and ⌥R the right side (chats) to
// their rails, the folded chats rail opens its list to its left, the sidebar's grip sits on its left edge and dragging it
// left widens it, Home's composer stays clear of the panel, a reload keeps the choice (this device), and ⌥⇧L swaps
// back. QA_SWITCH=off,on picks the cases.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://reload-restore.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'desktop-swap-sides-evidence');
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
      const on = sw === 'on', stem = `swap-sides-${skin}-${sw}`, desk = DESK();
      const entry = { stem, errors: [], refused: [], writes: [] }; report.cases.push(entry);
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        const mix = { 'wizard/desktop-chats': true, ...(on ? { 'wizard/swap-sides': true } : {}) };
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
        if (on) await page.waitForFunction(() => (document.documentElement.dataset.tweaks || '').split(' ').includes('wizard/swap-sides'), null, { timeout: 15000 }).catch(() => {});
        entry.tweaks = await page.evaluate(() => document.documentElement.dataset.tweaks);
        assert.equal(entry.tweaks.split(' ').includes('wizard/swap-sides'), on, stem + ': switch state');
        const vis = sel => page.locator(sel).filter({ visible: true }).first();
        const sideRow = id => vis(`.aad-side .aad-rw[data-sid="${id}"] .aad-row`);
        await sideRow('qa-g1').waitFor({ timeout: 15000 });
        await page.evaluate(() => document.fonts.ready); await nap(1500);
        const seen = () => page.evaluate(() => {
          const box = sel => { const n = [...document.querySelectorAll(sel)].find(x => x.getClientRects().length && getComputedStyle(x).visibility !== 'hidden'); if (!n) return null; const b = n.getBoundingClientRect(); return b.width ? [Math.round(b.left), Math.round(b.width)] : null; };
          const r = document.documentElement.dataset, btn = [...document.querySelectorAll('.aad-sh .aad-sswap')].find(b => !b.hidden && b.getClientRects().length);
          return { paneSide: r.aadPaneSide || '', appSide: r.aadAppSide || '', sideMode: r.aadSide || '', tabs: r.aadTabs || '', chatOn: !!r.aadChat, W: innerWidth,
            side: box('.aad-side'), vt: box('.aad-vt'), app: box('#stage > .wsp[data-aad-role="app"]:not([data-aad-omitted])'),
            chat: r.aadChat ? box('#stage > .wsp[data-aad-role="chat"]') : null, composer: !r.aadChat ? box('#stage > .wsp[data-aad-role="chat"] .pane-main .ch-compose') : null,
            sideGrip: box('.aad-grip[data-grip="side"]'), appGrip: box('.aad-grip[data-grip="app"]'), tabsGrip: box('.aad-grip[data-grip="tabs"]'),
            button: btn ? btn.getAttribute('aria-label') : null, togTitle: document.querySelector('.aad-sh .aad-tog')?.title || '', vtTogTitle: document.querySelector('.aad-vtog')?.title || '' };
        });
        const pagesTab = vis('.aad-vtab[data-app="pages"]');
        await pagesTab.waitFor({ timeout: 15000 }); await pagesTab.click(); await nap(1500);
        if (!(await seen()).app) { await pagesTab.click(); await nap(1500); }
        entry.start = await seen();
        assert.ok(entry.start.app?.[1] > 300, 'the Pages panel shows: ' + JSON.stringify(entry.start));
        const usual = s => s.side[0] === 0 && s.vt[0] + s.vt[1] === s.W;
        const mirrored = s => s.vt[0] === 0 && s.side[0] + s.side[1] === s.W;
        assert.ok(usual(entry.start), 'chats left, apps right to start with: ' + JSON.stringify(entry.start));
        await page.screenshot({ path: path.join(out, stem + '-1-start.png') });
        const blur = async () => { await page.evaluate(() => document.activeElement?.blur?.()); };
        if (!on) {
          assert.equal(entry.start.button, null, 'switch off: no Swap button');
          assert.equal(entry.start.paneSide, 'start');
          await blur(); await page.keyboard.press('Alt+Shift+KeyL'); await nap(800);
          entry.afterKey = await seen();
          assert.ok(usual(entry.afterKey) && entry.afterKey.paneSide === 'start', 'switch off: ⌥⇧L does nothing ' + JSON.stringify(entry.afterKey));
          // a model saved with the switch on is not read while it is off
          await page.evaluate(() => window.WizCore.panes.set({ side: 'end', dock: { edge: 'start' } })); await nap(800);
          entry.savedButOff = await seen();
          assert.ok(usual(entry.savedButOff) && entry.savedButOff.paneSide === 'start', 'switch off: a saved swap is ignored ' + JSON.stringify(entry.savedButOff));
          await page.keyboard.press('Alt+KeyL'); await nap(800);
          entry.altL = await seen(); assert.equal(entry.altL.sideMode, 'rail', 'switch off: ⌥L folds the chats sidebar as before');
          assert.equal(entry.errors.length, 0, 'browser errors: ' + entry.errors.join('; '));
          entry.pass = true; continue;
        }
        assert.equal(entry.start.button, 'Move the chats to the right (⌥⇧L)');
        await vis('.aad-sh .aad-sswap').click(); await nap(1200);
        entry.swapped = await seen();
        await page.screenshot({ path: path.join(out, stem + '-2-swapped.png') });
        assert.equal(entry.swapped.paneSide, 'end');
        assert.ok(mirrored(entry.swapped), 'chats right, apps left: ' + JSON.stringify(entry.swapped));
        assert.equal(entry.swapped.button, 'Move the chats to the left (⌥⇧L)');
        assert.ok(Math.abs(entry.swapped.app[0] - (entry.swapped.vt[0] + entry.swapped.vt[1])) <= 2, 'the panel sits next to the Apps column: ' + JSON.stringify(entry.swapped));
        assert.ok(Math.abs(entry.swapped.sideGrip[0] + entry.swapped.sideGrip[1] / 2 - entry.swapped.side[0]) <= 6, "the sidebar's grip is on its left edge: " + JSON.stringify(entry.swapped));
        assert.ok(Math.abs(entry.swapped.appGrip[0] + entry.swapped.appGrip[1] / 2 - (entry.swapped.app[0] + entry.swapped.app[1])) <= 6, "the panel's grip faces the room: " + JSON.stringify(entry.swapped));
        assert.ok(Math.abs(entry.swapped.tabsGrip[0] + entry.swapped.tabsGrip[1] / 2 - (entry.swapped.vt[0] + entry.swapped.vt[1])) <= 6, "the Apps column's grip is on its right edge: " + JSON.stringify(entry.swapped));
        assert.match(entry.swapped.togTitle, /⌥R/); assert.match(entry.swapped.vtTogTitle, /⌥L/);
        if (entry.swapped.chatOn) {   // (the restored desk has a chat docked: close it to see Home's composer beside the panel)
          entry.chatBeside = entry.swapped;
          assert.ok(entry.swapped.chat[0] >= entry.swapped.app[0] + entry.swapped.app[1] - 2 && entry.swapped.chat[0] + entry.swapped.chat[1] <= entry.swapped.side[0] + 2, 'the docked chat sits between the panel and the chats sidebar: ' + JSON.stringify(entry.swapped));
          await page.evaluate(() => [...document.querySelectorAll('.aad-cx')].find(b => !b.hidden && b.getClientRects().length)?.click()); await nap(1500);
          entry.home = await seen();
          await page.screenshot({ path: path.join(out, stem + '-2b-swapped-home.png') });
          assert.ok(entry.home.composer && entry.home.composer[0] >= entry.home.app[0] + entry.home.app[1] && entry.home.composer[0] + entry.home.composer[1] <= entry.home.side[0], "Home's composer sits between the panel and the chats sidebar: " + JSON.stringify(entry.home));
        }
        // dragging the sidebar's grip to the left widens it
        { const s = await seen(), x = s.sideGrip[0] + s.sideGrip[1] / 2;
          await page.mouse.move(x, 450); await page.mouse.down(); await page.mouse.move(x - 40, 450, { steps: 5 }); await page.mouse.up(); await nap(800);
          entry.dragged = await seen();
          assert.ok(entry.dragged.side[1] >= s.side[1] + 30 && entry.dragged.side[0] + entry.dragged.side[1] === entry.dragged.W, 'the grip widens the right-hand sidebar: ' + JSON.stringify([s.side, entry.dragged.side]));
          await page.mouse.dblclick(entry.dragged.sideGrip[0] + entry.dragged.sideGrip[1] / 2, 450); await nap(800); }
        // a chat opened from the sidebar docks beside it, right of the panel
        await sideRow('qa-g1').click(); await nap(2000);
        entry.withChat = await seen();
        await page.screenshot({ path: path.join(out, stem + '-3-swapped-with-chat.png') });
        assert.ok(entry.withChat.chat && entry.withChat.app && entry.withChat.chat[0] >= entry.withChat.app[0] + entry.withChat.app[1] - 2, 'the chat is right of the panel: ' + JSON.stringify(entry.withChat));
        // ⌥L folds the left side (now the Apps column), ⌥R the right side (now the chats)
        await page.mouse.click(720, 450).catch(() => {}); await blur();
        await page.keyboard.press('Alt+KeyL'); await nap(900);
        entry.altL = await seen();
        assert.equal(entry.altL.tabs, 'rail', '⌥L folds the Apps column on the left: ' + JSON.stringify(entry.altL));
        assert.equal(entry.altL.sideMode, 'open');
        assert.ok(entry.altL.vt[0] === 0 && entry.altL.vt[1] <= 60, 'the folded Apps rail stays at the left edge: ' + JSON.stringify(entry.altL));
        await page.keyboard.press('Alt+KeyR'); await nap(900);
        entry.altR = await seen();
        await page.screenshot({ path: path.join(out, stem + '-4-both-rails.png') });
        assert.equal(entry.altR.sideMode, 'rail', '⌥R folds the chats sidebar on the right: ' + JSON.stringify(entry.altR));
        assert.ok(entry.altR.side[0] + entry.altR.side[1] === entry.altR.W && entry.altR.side[1] <= 60, 'the folded chats rail stays at the right edge: ' + JSON.stringify(entry.altR));
        // the rail's Ready list opens to the rail's left, on screen
        const rk = vis('.aad-rail .aad-rk[data-k="ready"]');
        if (await rk.count()) {
          await rk.click(); await nap(700);
          entry.fly = await page.evaluate(() => { const c = document.querySelector('.aad-fly'); if (!c) return null; const b = c.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.width)]; });
          await page.screenshot({ path: path.join(out, stem + '-5-rail-list.png') });
          assert.ok(entry.fly && entry.fly[0] >= 0 && entry.fly[0] + entry.fly[1] <= entry.altR.side[0], "the rail's list opens to its left: " + JSON.stringify([entry.fly, entry.altR.side]));
          await page.keyboard.press('Escape'); await nap(400);
        } else entry.fly = 'no Ready on the rail';
        // folded to the rail, a chat's Back opens the chats over the page from the right edge, on screen
        const back = vis('.aad-cback');
        if (await back.count()) {
          await back.click(); await nap(900);
          entry.over = await seen();
          await page.screenshot({ path: path.join(out, stem + '-5b-over.png') });
          assert.equal(entry.over.sideMode, 'over', JSON.stringify(entry.over));
          assert.ok(entry.over.side[0] >= 0 && entry.over.side[0] + entry.over.side[1] === entry.over.W && entry.over.side[1] > 200, 'the sidebar opens over the page from the right edge: ' + JSON.stringify(entry.over));
          await page.keyboard.press('Escape'); await nap(700);
          entry.overClosed = await seen(); assert.equal(entry.overClosed.sideMode, 'rail', JSON.stringify(entry.overClosed));
        } else entry.over = 'no Back on the docked chat';
        await blur(); await page.keyboard.press('Alt+KeyR'); await nap(700); await page.keyboard.press('Alt+KeyL'); await nap(900);
        entry.reopened = await seen();
        assert.equal(entry.reopened.sideMode, 'open'); assert.equal(entry.reopened.tabs, 'open');
        assert.ok(mirrored(entry.reopened), 'both open again, still swapped: ' + JSON.stringify(entry.reopened));
        // full screen: a chat's Back opens the chats over the page from the window's right edge
        await sideRow('qa-v1').click(); await nap(1800);
        await vis('.aad-ctop [data-mode="full"]').click(); await nap(1000);
        entry.full = await page.evaluate(() => ({ mode: document.documentElement.dataset.aadMode, focus: JSON.parse(localStorage.getItem('wos.pane-layout.v1') || '{}').focus, back: [...document.querySelectorAll('.aad-cback')].map(b => [b.hidden, b.getClientRects().length]) }));
        const fullBack = vis('.aad-cback');
        if (await fullBack.count()) {
          await fullBack.click(); await nap(900);
          entry.fullOver = await seen();
          await page.screenshot({ path: path.join(out, stem + '-5c-full-over.png') });
          assert.equal(entry.fullOver.sideMode, 'over', JSON.stringify(entry.fullOver));
          assert.ok(entry.fullOver.side && entry.fullOver.side[0] + entry.fullOver.side[1] === entry.fullOver.W && entry.fullOver.side[1] > 200, 'full screen: the chats open over the page at the right edge: ' + JSON.stringify(entry.fullOver));
          await page.keyboard.press('Escape'); await nap(700);
        } else entry.fullOver = 'no Back in full screen';
        if (await page.evaluate(() => document.documentElement.dataset.aadMode !== 'tiled')) { await vis('.aad-ctop [data-mode="tiled"]').click().catch(() => {}); await nap(1000); }
        entry.tiledAgain = await seen(); assert.ok(mirrored(entry.tiledAgain), 'tiled again, still swapped: ' + JSON.stringify(entry.tiledAgain));
        await page.mouse.click(720, 450).catch(() => {}); await blur();
        // the choice is kept on this device
        await page.reload();
        await page.waitForFunction(() => window.__wux && !window.WosExperience?.state.busy && document.documentElement.dataset.layout === 'ai-apps', null, { timeout: 15000 });
        await page.evaluate(() => document.fonts.ready); await nap(2500);
        entry.reloaded = await seen();
        assert.equal(entry.reloaded.paneSide, 'end', 'a reload keeps the sides swapped: ' + JSON.stringify(entry.reloaded));
        assert.ok(mirrored(entry.reloaded), JSON.stringify(entry.reloaded));
        entry.saved = await page.evaluate(() => { const m = JSON.parse(localStorage.getItem('wos.pane-layout.v1') || '{}'); return [m.side, m.dock?.edge]; });
        assert.deepEqual(entry.saved, ['end', 'start']);
        // ⌥⇧L swaps back
        await page.mouse.click(720, 450).catch(() => {}); await blur();
        await page.keyboard.press('Alt+Shift+KeyL'); await nap(1200);
        entry.back = await seen();
        await page.screenshot({ path: path.join(out, stem + '-7-back.png') });
        assert.equal(entry.back.paneSide, 'start', '⌥⇧L swapped back: ' + JSON.stringify(entry.back));
        assert.ok(usual(entry.back), 'chats left, apps right again: ' + JSON.stringify(entry.back));
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
