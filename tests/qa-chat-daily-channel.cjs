'use strict';
// The Daily channel as one continuous chat (wizard/chat-channels, wizard-ux issue 1469) in a real browser.
// Disposable synthetic transport only: a fake box answers the channel store (Daily pinned at the top, kind 'daily'),
// GET /wizard/v1/channels/daily/days (two pages), POST /wizard/v1/channels/daily/today and the day threads' history;
// nothing reaches a box. Phone 390x844, Classic desktop 1440x960 and the AI apps desktop, Nebula + Grove.
// Starts before today's first post (the box says today: null): a tap on Daily opens the newest day's thread at once,
// under it an empty Today, above it the earlier day folded with its opener and count; a fold opens in place through the
// history read and closes again; the top reads the older page; the first send asks the box for today's thread and the
// view moves there without a reload (the send goes into that thread, yesterday becomes a fold); Back returns to Channels.
// QA_EXPECT=broken (with QA_WEB=<main>/web): Daily opens as a plain channel feed, no folds.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://chat-daily-channel.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'chat-daily-channel-evidence');
const broken = process.env.QA_EXPECT === 'broken';
const SHELLS = (process.env.QA_SHELLS || 'phone,classic,ai-apps').split(','), SKINS = (process.env.QA_SKINS || 'nebula,grove').split(',');
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const dayOf = t => new Date(t).toISOString().slice(0, 10), D = 864e5;
const Y = dayOf(now - D), Y2 = dayOf(now - 2 * D), Y3 = dayOf(now - 3 * D), T = dayOf(now);
const CHANNELS = [
  { id: 'daily', agent: 'hermes', name: 'Daily', order: -2, createdAt: iso(now - 9e8), archived: false, pinned: true, pinOrder: 0, kind: 'daily', dayStartsAt: '05:00' },
  { id: 'alerts', agent: 'hermes', name: 'Alerts', order: -1, createdAt: iso(now - 9e8), archived: false, pinned: true, pinOrder: 1, kind: 'alerts' },
  { id: 'launch', agent: 'hermes', name: 'Launch', order: 0, createdAt: iso(now - 9e8), archived: false, pinned: false },
];
const DAYS = {
  'qa-d1': { day: Y, at: now - D, opener: 'Signal: three things for Monday', msgs: [['user', '[Wizard schedule] Morning brief', 0], ['assistant', 'Signal: three things for Monday. Ship Daily, call the bank, plan the trip.', 60], ['user', 'Move the bank call to Tuesday', 3600], ['assistant', 'Done, the bank call is on Tuesday at 10:00.', 3660]] },
  'qa-d2': { day: Y2, at: now - 2 * D, opener: 'Signal: a quiet Sunday', msgs: [['assistant', 'Signal: a quiet Sunday. Nothing urgent today.', 0], ['user', 'Remind me to water the plants', 600], ['assistant', 'I will remind you at 18:00.', 660]] },
  'qa-d3': { day: Y3, at: now - 3 * D, opener: 'Signal: travel day', msgs: [['assistant', 'Signal: travel day. Your flight leaves at 14:20.', 0]] },
  'qa-d0': { day: T, at: now, opener: '', msgs: [] },
};
const raw = (id, s) => ({ id, title: 'Daily · ' + s.day, runtime: 'direct', status: 'completed', updated_at: iso(s.at), updatedAt: iso(s.at), last_active: s.at / 1000, message_count: s.msgs.length, messageCount: s.msgs.length, channel: 'daily', preview: s.msgs.at(-1)?.[1] || '' });
const dayRow = id => ({ day: DAYS[id].day, sessionId: id, title: 'Daily · ' + DAYS[id].day, opener: DAYS[id].opener, count: DAYS[id].msgs.length, lastAt: iso(DAYS[id].at) });
const report = { origin, web, broken, cases: [] };
(async () => {
  const browser = await chromium.launch();
  try {
    for (const shell of SHELLS) for (const skin of SKINS) {
      const phone = shell === 'phone', ai = shell === 'ai-apps', stem = `${shell}-${skin}`;
      const entry = { stem, errors: [], refused: [], writes: [], runs: [], today: 0 }; report.cases.push(entry);
      const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 960 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', ...(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' } : {}) });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        const mix = { 'wizard/desktop-chats': true };
        await context.addInitScript(({ shell, skin, mix }) => {
          if (window !== top) return;
          if (sessionStorage.getItem('qaBoot')) return; sessionStorage.setItem('qaBoot', '1');
          for (const [k, v] of Object.entries({ 'wos.shell': shell === 'phone' ? 'phone' : 'desktop', 'wux.shell': shell === 'phone' ? 'phone' : 'desktop', 'wos.desktop-view.v1': shell === 'ai-apps' ? 'ai-apps' : 'classic', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin, 'wos.chats.view.v1': 'channels',
            'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v);
        }, { shell, skin, mix });
        // The box: today has no thread until the first send after 05:00.
        const box = { today: null, live: ['qa-d1', 'qa-d2'] }; DAYS['qa-d0'].msgs = [];
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
          if (u.origin !== origin) { entry.refused.push({ method, url: q.url(), reason: 'external' }); return r.abort(); }
          if (!['GET', 'HEAD'].includes(method)) {
            entry.writes.push({ method, path: p });
            if (method === 'PUT' && p === '/wizard/thread-seen') return r.fulfill({ json: { ok: true, state: q.postDataJSON() } });
            if (method === 'PUT' && p === '/wizard/v1/channels/read') return r.fulfill({ json: { at: {} } });
            if (method === 'POST' && p === '/wizard/v1/channels/daily/today') { entry.today++; const created = !box.today; box.today = 'qa-d0'; if (!box.live.includes('qa-d0')) box.live.unshift('qa-d0'); return r.fulfill({ status: created ? 201 : 200, json: { channel: 'daily', agent: 'hermes', day: T, sessionId: 'qa-d0', created } }); }
            if (method === 'POST' && p === '/wizard/hermes/v1/runs') { const b = q.postDataJSON() || {}; entry.runs.push({ session: b.session_id || b.sessionId || b.session || '', input: String(b.input || b.message || '').slice(0, 80) }); DAYS['qa-d0'].msgs.push(['user', b.input || 'Plan the trip for Friday', Date.now() / 1000 - (DAYS['qa-d0'].at / 1000 - 4 * 3600)]); return r.fulfill({ json: { run_id: 'run-qa-' + entry.runs.length } }); }
            if (method === 'POST' && p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { session: { id: (q.postDataJSON() || {}).id } } });
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
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
          if (p === '/wizard/v1/channels') return r.fulfill({ json: { schema: 'wizard.channels/1', sort: 'az', channels: CHANNELS } });
          if (p === '/wizard/v1/channels/read') return r.fulfill({ json: { at: {} } });
          if (p === '/wizard/v1/channels/daily/days') {
            const cursor = u.searchParams.get('cursor');
            const all = [...(box.today ? ['qa-d0'] : []), 'qa-d1', 'qa-d2', 'qa-d3'];
            const list = cursor ? all.filter(id => DAYS[id].day < cursor) : all.slice(0, 2);
            entry.dayReads = (entry.dayReads || []).concat(cursor || 'first');
            return r.fulfill({ json: { channel: 'daily', agent: 'hermes', dayStartsAt: '05:00', today: box.today, days: list.map(dayRow), next: !cursor ? DAYS[list.at(-1)].day : null } });
          }
          if (p === '/wizard/hermes/api/sessions' && u.searchParams.has('channel')) {
            const id = u.searchParams.get('channel'), data = id === 'daily' ? box.live.slice().reverse().map(x => ({ ...raw(x, DAYS[x]), listVersion: 1, agent: '' })) : [];
            return r.fulfill({ json: { object: 'list', data, offset: 0, limit: 100, has_more: false, snapshot: 'snap', window: 'channel', channel: id, order: 'oldest', channel_total: data.length, view: 'list', list_version: 1 } });
          }
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: box.live.map(x => raw(x, DAYS[x])), has_more: false } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) {
            const id = decodeURIComponent(m[1]), s = DAYS[id]; if (!s) return r.fulfill({ status: 404, json: { error: 'missing' } });
            entry.reads = (entry.reads || []).concat(id + (m[2] ? ':messages' : ''));
            const t0 = s.at / 1000 - 4 * 3600;
            return r.fulfill({ json: m[2] ? { messages: s.msgs.map(([role, content, dt]) => ({ role, content, timestamp: t0 + dt })) } : { session: raw(id, s) } });
          }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
        await page.waitForFunction(() => (window.__wux || window.__wos) && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        await page.waitForFunction(() => true, null, { timeout: 15000 });
        await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
        if (ai) await page.waitForFunction(() => document.documentElement.dataset.layout === 'ai-apps', null, { timeout: 15000 });
        if (phone) await page.evaluate(() => __wos.openSheet('inbox')); else if (!ai) await page.evaluate(() => __wux.openChatsList());
        const scope = ai ? '.aad-chan ' : '';
        const vis = sel => page.locator(sel).filter({ visible: true }).first();
        if (ai) { await vis('.aad-chan [data-chview="channels"]').click().catch(() => {}); }
        await vis(scope + '.ch-chan-open[data-chchan="daily"]').waitFor({ timeout: 15000 });
        entry.order = await page.locator(scope + '.ch-chan-list > .ch-chan .ch-chan-open').filter({ visible: true }).evaluateAll(b => b.map(x => x.dataset.chchan));
        assert.equal(entry.order[0], 'daily', 'Daily sits at the top of Channels: ' + entry.order);
        await page.evaluate(() => document.fonts.ready); await nap(300);
        await page.screenshot({ path: path.join(out, stem + '-1-channels.png') });
        // One tap: straight into the chat (no post feed).
        await vis(scope + '.ch-chan-open[data-chchan="daily"]').click();
        const thread = () => page.locator('.ch-thread').filter({ visible: true }).first();
        if (broken) {
          await nap(1500);
          entry.feed = await page.locator('.ch-chan-feed').filter({ visible: true }).count();
          entry.folds = await page.locator('.ch-dday').count();
          assert.equal(entry.folds, 0, 'main has no Daily view');
          entry.pass = true; continue;
        }
        await thread().waitFor({ timeout: 10000 });
        // The thread's own header names the channel (AI apps draws its own column header with the day thread's title).
        if (!ai) await thread().locator('.ch-head').getByText('💬 Daily').waitFor({ timeout: 8000 });
        await thread().getByText('Done, the bank call is on Tuesday at 10:00.').waitFor({ timeout: 8000 });
        entry.feedShown = await page.locator('.ch-chan-feed').filter({ visible: true }).count();
        assert.equal(entry.feedShown, 0, 'no post feed in between');
        // Before today's first post: yesterday open, an empty Today under it, the day before folded above.
        assert.equal(await thread().locator('.ch-dday-today').count(), 1, 'the empty Today line');
        entry.folds = await thread().locator('.ch-dday-h').evaluateAll(b => b.map(x => x.innerText.replace(/\s+/g, ' ').trim()));
        // (A short view shows its top at once, so the older page may already be read: Saturday then sits above Sunday.)
        const sunday = entry.folds.find(t => /Signal: a quiet Sunday/.test(t));
        assert.ok(sunday && /3 messages/.test(sunday), 'the day before folded with its opener and count: ' + entry.folds);
        assert.ok(entry.folds.length <= 2 && !entry.folds.some(t => /three things for Monday/.test(t)), 'the open day is not a fold: ' + entry.folds);
        // The view is at the bottom (the Today line is on screen).
        await nap(600);
        entry.todayOnScreen = await thread().locator('.ch-dday-today').evaluate(n => { const r = n.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
        assert.ok(entry.todayOnScreen, 'opens at the bottom');
        await page.screenshot({ path: path.join(out, stem + '-2-daily-before-first-post.png') });
        // A fold opens in place through the history read, and closes again.
        await thread().locator('.ch-dday-h[data-chdday="' + Y2 + '"]').click();
        await thread().getByText('I will remind you at 18:00.').waitFor({ timeout: 8000 });
        assert.ok(entry.reads.includes('qa-d2:messages'), 'the normal history read');
        await thread().locator('.ch-dday-h[data-chdday="' + Y2 + '"]').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(out, stem + '-3-day-unfolded.png') });
        await thread().locator('.ch-dday-h[data-chdday="' + Y2 + '"]').click();
        await page.waitForFunction(() => !document.body.innerText.includes('I will remind you at 18:00.'));
        // The top reads older days (Earlier days scrolls into view, or a tap).
        const more = thread().locator('[data-chddaymore]');
        if (await more.count()) { await more.scrollIntoViewIfNeeded(); await nap(500); if (await more.count() && !(await more.isDisabled())) await more.click().catch(() => {}); }
        await thread().locator('.ch-dday-h[data-chdday="' + Y3 + '"]').waitFor({ timeout: 8000 });
        assert.ok(entry.dayReads.includes(Y2), 'paged with the oldest day as the cursor: ' + entry.dayReads);
        // The first send of the day: the box names today's thread, the view moves there, the send goes into it.
        const ta = thread().locator('.ch-compose textarea');
        await ta.click(); await ta.fill('Plan the trip for Friday');
        await thread().locator('.ch-compose .ch-send').click();
        await page.waitForFunction(() => { const r = window.WizLive?.chanDaily?.state('daily'); return r && r.today === 'qa-d0'; }, null, { timeout: 8000 });
        await page.waitForFunction(() => [...document.querySelectorAll('.ch-thread')].some(t => t.getClientRects().length && t.querySelector('.ch-dday-h[data-chdday]') && !t.querySelector('.ch-dday-today')), null, { timeout: 8000 });
        await nap(800);
        assert.equal(entry.today, 1, 'one POST /today');
        entry.boxAfter = await page.locator('.ch-thread .ch-compose textarea').filter({ visible: true }).first().inputValue();
        assert.equal(entry.boxAfter, '', 'the sent words leave the box');
        assert.ok(entry.runs.some(x => x.session === 'qa-d0'), 'the send went into today’s thread: ' + JSON.stringify(entry.runs));
        assert.ok(!entry.runs.some(x => x.session === 'qa-d1'), 'never into yesterday’s');
        if (!phone) {
          entry.foldsAfter = await thread().locator('.ch-dday-h').evaluateAll(b => b.map(x => x.dataset.chdday));
          assert.ok(entry.foldsAfter.includes(Y), 'yesterday is now a fold above today: ' + entry.foldsAfter);
          if (!ai) assert.ok(await thread().locator('.ch-head').getByText('💬 Daily').count());
          await page.screenshot({ path: path.join(out, stem + '-4-after-first-post.png') });
        }
        // Back: to the Channels list.
        if (phone) { if (!(await page.locator('.ch-thread').filter({ visible: true }).count())) await vis(scope + '.ch-chan-open[data-chchan="daily"]').click(); await thread().waitFor(); await page.screenshot({ path: path.join(out, stem + '-4-after-first-post.png') }); }
        if (await page.locator('.ch-thread').filter({ visible: true }).count()) {
          if (ai) await vis('.aad-cx, .ch-thread [data-chback]').click().catch(() => page.evaluate(() => __wux.escStep()));
          else await page.evaluate(() => window.__wos ? __wos.onBack() : __wux.escStep());
        }
        await nap(500);
        await vis(scope + '.ch-chan-open[data-chchan="daily"]').waitFor({ timeout: 5000 });
        if (!ai) assert.equal(await page.locator('.ch-thread').filter({ visible: true }).count(), 0, 'Back leaves the Daily view');
        assert.equal(entry.errors.length, 0, 'browser errors: ' + entry.errors.join('; '));
        entry.pass = true;
      } catch (e) { entry.failure = e.stack; const pages = context.pages(); if (pages[0]) { entry.body = (await pages[0].locator('body').innerText().catch(() => '')).slice(0, 1500); await pages[0].screenshot({ path: path.join(out, stem + '-failure.png') }).catch(() => {}); } }
      finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await context.close(); }
    }
  } finally { await browser.close(); }
  const failed = report.cases.filter(c => !c.pass);
  console.log(JSON.stringify({ cases: report.cases.length, passed: report.cases.length - failed.length, failed: failed.map(c => c.stem + ': ' + String(c.failure).split('\n')[0]), screenshots: fs.readdirSync(out).filter(f => f.endsWith('.png')).length }));
  if (failed.length || !report.cases.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
