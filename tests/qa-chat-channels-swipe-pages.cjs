'use strict';
// wizard-ux issue 1467 in a real browser: phone 412x915, Nebula + Grove, Channels on. The Chats home reads
// Channels | Activity; a real touch swipe anywhere (row middle, empty space, top of the list) moves between them and
// the header tab follows; a vertical scroll never does; a swipe right steps back thread -> feed -> Channels and then
// does nothing (the app stays open); a thread opened from Activity goes back to Activity; a wide code block keeps
// its sideways scroll. QA_SWITCH=off checks the old list: Activity | Channels order is gone with the switch, and no
// swipe. Synthetic transport only (no box is reached; writes are answered in memory). Real touches via CDP.
// QA_EXPECT=broken (with QA_WEB=<main>/web) asserts the old order instead, as the baseline.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = 'https://chat-channels-swipe.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'chat-channels-swipe-evidence');
const broken = process.env.QA_EXPECT === 'broken', off = process.env.QA_SWITCH === 'off';
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const SPACES = [{ id: 'apps', name: 'WizardOS Apps', agent: 'hermes', threads: ['qa-a1'], createdAt: iso(now - 9e8) }];
const WIDE = 'Here is the config:\n\n```\n' + 'export WIZARD_SOME_VERY_LONG_SETTING_NAME=' + 'x'.repeat(220) + '\n```\n\nDone.';
const ROWS = [
  { id: 'qa-a1', title: 'App list', at: now - 36e5 },
  { id: 'qa-g1', title: 'Weekend plans', at: now - 6e5 },
  ...Array.from({ length: 14 }, (_, i) => ({ id: 'qa-f' + i, title: 'Filler chat ' + i, at: now - 72e5 - i * 6e5 })),
].map(s => ({ id: s.id, title: s.title, runtime: 'direct', status: 'completed', updated_at: iso(s.at), updatedAt: iso(s.at), last_active: s.at / 1000, message_count: 2, messageCount: 2, preview: 'Done.' }));
(async () => {
  const browser = await chromium.launch(), report = [];
  try {
    for (const skin of ['nebula', 'grove']) {
      const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block', userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' });
      const errors = [], steps = {};
      try {
        await context.routeWebSocket('**/*', w => w.close());
        await context.addInitScript(({ skin, spaces, off }) => {
          if (window !== top) return;
          const mix = off ? { 'wizard/desktop-chats': true } : { 'wizard/desktop-chats': true };
          for (const [k, v] of Object.entries({ 'wos.shell': 'phone', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
            'wos.chats.spaces.v1': JSON.stringify(spaces), 'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v);
        }, { skin, spaces: SPACES, off });
        const prefs = { migrations: { 'launcher-seed-v1': true }, spaces: structuredClone(SPACES) };
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), p = u.pathname, method = q.method();
          if (u.origin !== origin) return r.abort();
          if (!['GET', 'HEAD'].includes(method)) return r.fulfill({ json: p === '/wizard/v1/ui-preferences' ? prefs : { ok: true } });
          if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
          if (p.startsWith(prefix)) {
            const abs = path.resolve(web, decodeURIComponent(p.slice(prefix.length) || 'index.html'));
            if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
            return fs.existsSync(abs) && fs.statSync(abs).isFile() ? r.fulfill({ path: abs }) : r.fulfill({ status: 404, body: 'none' });
          }
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: prefs });
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: ROWS, has_more: false } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) { const s = ROWS.find(x => x.id === decodeURIComponent(m[1])); if (!s) return r.fulfill({ status: 404, json: {} });
            return r.fulfill({ json: m[2] ? { messages: [{ role: 'user', content: 'Ask for ' + s.title, timestamp: now / 1000 - 600 }, { role: 'assistant', content: s.id === 'qa-g1' ? WIDE : 'Done.', timestamp: now / 1000 - 590 }] } : { session: s } }); }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
        await page.goto(origin + prefix + 'index.html?phone');
        await page.waitForFunction(() => window.__wos && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        if (!off) await page.waitForFunction(() => true, null, { timeout: 15000 });
        await page.evaluate(() => __wos.openSheet('inbox'));
        await nap(600);
        const vis = sel => page.locator(sel).filter({ visible: true }).first();
        const shot = n => page.screenshot({ path: path.join(out, `${skin}${off ? '-off' : ''}-${n}${broken ? '-before' : ''}.png`) });
        const cdp = await context.newCDPSession(page);
        // A real finger: touchStart, 12 moves over `ms`, touchEnd.
        const swipe = async (x, y, dx, dy = 0, ms = 260) => {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
          for (let i = 1; i <= 12; i++) { await nap(ms / 12); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * i / 12, y: y + dy * i / 12 }] }); }
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          await nap(450);
        };
        const view = () => page.evaluate(() => document.querySelector('[data-chview][aria-pressed="true"]:not([hidden])')?.dataset.chview || null);
        const order = () => page.evaluate(() => [...document.querySelectorAll('.ch-chan-tabs [data-chview]')].filter(b => b.offsetParent).map(b => b.textContent.trim()));
        const where = () => page.evaluate(() => {
          const t = [...document.querySelectorAll('[data-part="thread"]')].some(n => n.offsetParent);
          const feed = [...document.querySelectorAll('[data-chchanback]')].some(n => n.offsetParent);
          const chats = [...document.querySelectorAll('.ch-list')].some(n => n.offsetParent);
          return t ? 'thread' : feed ? 'feed' : chats ? 'list' : 'gone';
        });
        const box = async sel => { const b = await vis(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
        if (off) {
          steps.tabs = await order();
          await swipe(200, 500, -180); await swipe(200, 500, 180);
          steps.afterSwipes = await where();
          await shot('1-off');
          report.push({ skin, off, steps, errors });
          assert.deepEqual(steps.tabs, [], `${skin}: no Channels tabs with the switch off`);
          assert.equal(steps.afterSwipes, 'list', `${skin}: swipes leave the list where it is`);
          assert.deepEqual(errors, [], `${skin}: no page errors`);
          continue;
        }
        steps.order = await order(); await shot('0-home');
        if (broken) { report.push({ skin, steps }); assert.deepEqual(steps.order, ['Activity', 'Channels']); continue; }
        assert.deepEqual(steps.order, ['Channels', 'Activity'], `${skin}: Channels | Activity, left to right`);
        // Start on Activity (the default): left does nothing, right from the middle of a row lands on Channels.
        if (await view() !== 'activity') await vis('[data-chview="activity"]').click();
        await nap(300);
        const tabsAt = (await box('.ch-chan-tabs')).y;
        await swipe(320, tabsAt, -200); steps.activityLeft = await view();
        // Leftward on an Activity row is the row's own action (its sheet), never a page change.
        const r0 = await box('.ch-list [data-chopen="qa-g1"]');
        await swipe(320, r0.y, -200); steps.activityLeftOnRow = await view(); steps.rowSheet = await page.locator('.ch-sheet').count() > 0;
        await page.keyboard.press('Escape'); await nap(300);
        if (await page.locator('.ch-sheet').count()) { await page.evaluate(() => document.querySelectorAll('.ch-sheet').forEach(n => n.remove())); }
        const row = await box('.ch-list [data-chopen="qa-g1"]');
        await swipe(120, row.y, 200); steps.activityRightFromRow = await view(); await shot('1-channels-after-swipe');
        // Channels: right does nothing and the app stays open; left from the middle of a channel row -> Activity.
        await swipe(120, 500, 200); steps.channelsRight = await view(); steps.channelsRightWhere = await where();
        const crow = await box('.ch-chan-open[data-chchan="apps"]');
        await swipe(300, crow.y, -200); steps.channelsLeftFromRow = await view();
        // From empty space low on the screen and from the top of the list.
        await swipe(120, 480, 200); steps.fromEmpty = await view();
        const top = await box('.ch-list .ch-scroll'); await swipe(300, top.y - (await vis('.ch-list .ch-scroll').boundingBox()).height / 2 + 12, -200); steps.fromTop = await view();
        // A vertical scroll never changes page.
        await swipe(200, 700, 10, -300, 300); steps.vertical = await view();
        // Back to Channels with the tab, then channel -> thread -> swipe right x3.
        await vis('[data-chview="channels"]').click(); await nap(300);
        await vis('.ch-chan-open[data-chchan="apps"]').click(); await nap(500);
        steps.feedOpen = await where(); await shot('2-feed');
        await vis('.ch-chan-feed [data-chopen="qa-a1"]').click(); await nap(700);
        steps.threadOpen = await where();
        await swipe(120, 500, 220); steps.back1 = await where(); await shot('3-back-to-feed');
        await swipe(120, 500, 220); steps.back2 = await where(); steps.back2View = await view();
        await swipe(120, 500, 220); steps.back3 = await where(); steps.back3View = await view(); await shot('4-back-to-channels');
        // A thread opened from Activity goes back to Activity; its wide code block keeps the sideways swipe.
        await vis('[data-chview="activity"]').click(); await nap(300);
        await vis('.ch-list [data-chopen="qa-g1"]').click(); await nap(800);
        steps.actThread = await where();
        const pre = vis('[data-part="thread"] pre');
        if (await pre.count()) {
          const p = await pre.boundingBox();
          await swipe(p.x + p.width - 20, p.y + p.height / 2, -200);
          await swipe(p.x + 40, p.y + p.height / 2, 200);
          steps.codeSwipe = await where();
        }
        await swipe(120, 300, 220); steps.actBack = await where(); steps.actBackView = await view(); await shot('5-back-to-activity');
        report.push({ skin, steps, errors });
        assert.equal(steps.activityLeft, 'activity', `${skin}: Activity, swipe left does nothing`);
        assert.equal(steps.activityLeftOnRow, 'activity', `${skin}: leftward on an Activity row stays the row's action`);
        assert.equal(steps.activityRightFromRow, 'channels', `${skin}: Activity, swipe right from a row's middle -> Channels`);
        assert.equal(steps.channelsRight, 'channels'); assert.equal(steps.channelsRightWhere, 'list', `${skin}: swipe right on Channels does nothing, Chats stays open`);
        assert.equal(steps.channelsLeftFromRow, 'activity', `${skin}: Channels, swipe left from a channel row -> Activity`);
        assert.equal(steps.fromEmpty, 'channels', `${skin}: from empty space`);
        assert.equal(steps.fromTop, 'activity', `${skin}: from the top of the list`);
        assert.equal(steps.vertical, 'activity', `${skin}: a vertical scroll never changes page`);
        assert.equal(steps.feedOpen, 'feed'); assert.equal(steps.threadOpen, 'thread');
        assert.equal(steps.back1, 'feed', `${skin}: thread -> channel feed`);
        assert.equal(steps.back2, 'list'); assert.equal(steps.back2View, 'channels', `${skin}: feed -> Channels list`);
        assert.equal(steps.back3, 'list'); assert.equal(steps.back3View, 'channels', `${skin}: a third swipe does nothing, app open`);
        assert.equal(steps.actThread, 'thread');
        if ('codeSwipe' in steps) assert.equal(steps.codeSwipe, 'thread', `${skin}: a swipe on the code block scrolls it, the thread stays`);
        assert.equal(steps.actBack, 'list'); assert.equal(steps.actBackView, 'activity', `${skin}: thread from Activity -> Activity`);
        assert.deepEqual(errors, [], `${skin}: no page errors`);
      } finally { if (!report.some(r => r.skin === skin)) report.push({ skin, off, steps, errors, unfinished: true }); await context.close(); }
    }
  } finally { await browser.close(); fs.writeFileSync(path.join(out, `report${off ? '-off' : ''}.json`), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); }
})().catch(e => { console.error(e); process.exit(1); });
