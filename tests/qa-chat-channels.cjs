'use strict';
// Channels in Chats (wizard/chat-channels, wizard-ux issue 1254) in a real browser. Disposable synthetic transport only:
// no owner API reads or writes reach a box; the only writes allowed are the synthetic send and the Space filing it
// makes. Phone 390x844 (desktop-style list, the default) + desktop 1440x960 (classic Chats window), Nebula + Grove.
// Per case: switch off = no tabs, rows as today; switch on = Activity with "# channel", Channels (order, General last,
// aggregate marker, chevron), a channel feed (oldest to newest, filters, post opens the thread), Back thread → channel
// → list, and a new post from the feed filed into its Space.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://chat-channels.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'chat-channels-evidence');
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const SPACES = [
  { id: 'launch', name: 'Launch', agent: 'hermes', threads: ['qa-l1', 'qa-l2', 'qa-l3'], createdAt: iso(now - 9e8) },
  { id: 'voice', name: 'Voice', agent: 'hermes', threads: ['qa-v1'], createdAt: iso(now - 8e8) },
];
const ROWS = [
  { id: 'qa-l1', title: 'Launch checklist', status: 'completed', at: now - 5 * 36e5, attention: { state: 'needs_you', ask: 'Pick a date' }, preview: 'Which date works?' },
  { id: 'qa-l2', title: 'Press notes', status: 'running', at: now - 30 * 6e4, preview: 'Drafting…' },
  { id: 'qa-l3', title: 'Old launch idea', status: 'completed', at: now - 3 * 864e5, archived: true, preview: 'Done.' },
  { id: 'qa-v1', title: 'Voice keys', status: 'completed', at: now - 2 * 36e5, preview: 'Shipped.' },
  { id: 'qa-g1', title: 'Weekend plans', status: 'completed', at: now - 60 * 6e4, preview: 'Here is a plan.' },
].map(s => ({ id: s.id, title: s.title, runtime: 'direct', status: s.status, updated_at: iso(s.at), updatedAt: iso(s.at), last_active: s.at / 1000, message_count: 4, messageCount: 4, archived: !!s.archived, preview: s.preview,
  ...(s.attention ? { wizard_attention: s.attention } : {}), ...(s.status === 'running' ? { wizard_run_id: 'run-' + s.id, wizard_assigned_at: iso(s.at) } : {}) }));
const report = { origin, web, cases: [] };
(async () => {
  const browser = await chromium.launch();
  try {
    for (const shell of ['phone', 'desktop']) for (const skin of ['nebula', 'grove']) for (const on of [false, true]) {
      const phone = shell === 'phone', stem = `${shell}-${skin}-${on ? 'on' : 'off'}`;
      const entry = { stem, errors: [], refused: [], writes: [] }; report.cases.push(entry);
      const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 960 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', ...(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' } : {}) });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        const mix = { 'wizard/desktop-chats': true, ...(on ? { 'wizard/chat-channels': true } : {}) };
        await context.addInitScript(({ shell, skin, mix, spaces }) => {
          if (window !== top) return;
          for (const [k, v] of Object.entries({ 'wos.shell': shell, 'wos.desktop-view.v1': 'classic', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
            'wos.chats.spaces.v1': JSON.stringify(spaces), 'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v);
        }, { shell, skin, mix, spaces: SPACES });
        let prefs = { migrations: { 'launcher-seed-v1': true }, spaces: structuredClone(SPACES) };
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
          if (u.origin !== origin) { entry.refused.push({ method, url: q.url(), reason: 'external' }); return r.abort(); }
          if (!['GET', 'HEAD'].includes(method)) {
            entry.writes.push({ method, path: p });
            if (method === 'PUT' && p === '/wizard/thread-seen') return r.fulfill({ json: { ok: true, state: q.postDataJSON() } });
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
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: ROWS, has_more: false } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) { const s = ROWS.find(x => x.id === decodeURIComponent(m[1])); if (!s) return r.fulfill({ status: 404, json: { error: 'missing' } });
            return r.fulfill({ json: m[2] ? { messages: [{ role: 'user', content: 'Synthetic ask for ' + s.title, timestamp: now / 1000 - 600 }, { role: 'assistant', content: s.preview, timestamp: now / 1000 - 590 }] } : { session: s } }); }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
        await page.waitForFunction(() => (window.__wux || window.__wos) && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        assert.equal(await page.evaluate(() => document.documentElement.dataset.skin), skin);
        if (on) await page.waitForFunction(() => (document.documentElement.dataset.tweaks || '').split(' ').includes('wizard/chat-channels'), null, { timeout: 15000 }).catch(() => {});
        entry.tweaks = await page.evaluate(() => ({ attr: document.documentElement.dataset.tweaks, state: WosExperience.state.tweaks.filter(t => t.on).map(t => t.id) }));
        assert.equal(entry.tweaks.attr.split(' ').includes('wizard/chat-channels'), on, stem + ': switch state');
        await page.evaluate(phone => phone ? __wos.openSheet('inbox') : __wux.openChatsList(), phone);
        const vis = sel => page.locator(sel).filter({ visible: true }).first();
        await vis('.ch-list [data-chopen="qa-g1"]').waitFor();
        await page.evaluate(() => document.fonts.ready); await nap(300);
        const rowBox = async id => (await vis(`.ch-list [data-chopen="${id}"]`).boundingBox());
        entry.activityRowHeight = Math.round((await rowBox('qa-g1')).height);
        if (!on) {
          assert.equal(await page.locator('.ch-chan-tabs').count(), 0, 'switch off: no tabs');
          assert.equal(await page.locator('.ch-chan-line, .ch-chan-tag').count(), 0, 'switch off: no channel line');
          await page.screenshot({ path: path.join(out, stem + '-activity.png') });
          entry.pass = true; continue;
        }
        // Activity: today's list plus "# channel".
        const tabs = vis('.ch-chan-tabs'); await tabs.waitFor();
        assert.equal(await vis('[data-chview="activity"]').getAttribute('aria-pressed'), 'true', 'Activity is the default');
        entry.channelLine = await vis('.ch-list [data-chopen="qa-l1"]').innerText();
        assert.match(entry.channelLine, /# Launch/); assert.match(await vis('.ch-list [data-chopen="qa-g1"]').innerText(), /# General/);
        await page.screenshot({ path: path.join(out, stem + '-activity.png') });
        // Channels: same-frame paint on the tap.
        await page.evaluate(() => { window.paintReceipt = null; addEventListener('click', e => { if (!e.target.closest('[data-chview="channels"]')) return; requestAnimationFrame(() => { window.paintReceipt = [...document.querySelectorAll('.ch-chan-open')].filter(b => b.getClientRects().length).map(b => b.dataset.chchan); }); }, { capture: true, once: true }); });
        await vis('[data-chview="channels"]').click();
        await page.waitForFunction(() => window.paintReceipt);
        entry.channels = await page.evaluate(() => paintReceipt);
        assert.deepEqual(entry.channels, ['launch', 'voice', '__general__'], 'Spaces order, General last, painted on the tap frame');
        const launch = vis('.ch-chan-open[data-chchan="launch"]');
        assert.equal(await launch.locator('.ch-chan-dot').count(), 1, 'Launch: amber (needs you beats working)');
        assert.equal(await vis('.ch-chan-open[data-chchan="voice"]').locator('.ch-chan-dot, .ch-spin').count(), 0, 'Voice: nothing open');
        entry.channelRowHeight = Math.round((await launch.boundingBox()).height);
        await vis('[data-chchanx="launch"]').click();
        const recent = await page.locator('.ch-chan-recent [data-chopen]').filter({ visible: true }).evaluateAll(b => b.map(x => x.dataset.chopen));
        entry.recent = recent; assert.deepEqual(recent, ['qa-l2', 'qa-l1'], 'chevron: working and needs-you posts, newest first');
        await page.screenshot({ path: path.join(out, stem + '-channels.png') });
        // Feed.
        await launch.click();
        await vis('.ch-chan-h').waitFor();
        assert.match(await vis('.ch-chan-h').innerText(), /#\s*Launch/);
        const posts = async () => page.locator('.ch-chan-feed .ch-post-b').filter({ visible: true }).evaluateAll(b => b.map(x => x.dataset.chopen));
        entry.feedOpen = await posts(); assert.deepEqual(entry.feedOpen, ['qa-l1', 'qa-l2'], 'Open: oldest to newest, archived left out');
        assert.match(await vis('.ch-post-r[data-chopen="qa-l2"]').innerText(), /3 replies[\s\S]*Working/);
        await page.screenshot({ path: path.join(out, stem + '-feed.png') });
        await vis('[data-chchanf="needs"]').click(); assert.deepEqual(await posts(), ['qa-l1']);
        await vis('[data-chchanf="all"]').click(); assert.deepEqual(await posts(), ['qa-l3', 'qa-l1', 'qa-l2']);
        await vis('[data-chchanf="open"]').click();
        // A post opens today's thread; Back: thread → channel → list, never out of Chats.
        await vis('.ch-post-b[data-chopen="qa-l1"]').click();
        await vis('.ch-thread').waitFor();
        assert.match(await vis('.ch-thread').innerText(), /Synthetic ask for Launch checklist/);
        if (!phone) { assert.ok(await vis('.ch-chan-h').isVisible(), 'desktop: the feed stays in the list pane beside the thread'); await page.screenshot({ path: path.join(out, stem + '-thread.png') }); }
        const back = () => page.evaluate(() => window.__wos ? __wos.onBack() : __wux.escStep());
        entry.back = [await back()]; await nap(150);
        if (!phone && await page.locator('.ch-thread').filter({ visible: true }).count()) { entry.back.push(await back()); await nap(150); }
        await vis('.ch-chan-h').waitFor(); assert.deepEqual(await posts(), ['qa-l1', 'qa-l2'], 'Back from the thread lands on the channel');
        entry.back.push(await back()); await nap(150);
        await vis('.ch-chan-open[data-chchan="launch"]').waitFor();
        assert.equal(await page.locator('.ch-chan-h').filter({ visible: true }).count(), 0, 'Back from the channel lands on the Channels list');
        // One more Back is the list's own (unchanged): the desktop stays on the list, the phone sheet goes Home as today.
        entry.back.push(await back()); await nap(150);
        if (phone) await page.evaluate(() => __wos.openSheet('inbox')); else assert.ok(await vis('.ch-list').isVisible(), 'desktop Back at the list stays in Chats');
        await vis('[data-chview="channels"][aria-pressed="true"]').waitFor();
        // Posting: New chat from the Voice feed, filed into Voice at send.
        await vis('.ch-chan-open[data-chchan="voice"]').click(); await vis('.ch-chan-h').waitFor();
        assert.match(await vis('.ch-fab').getAttribute('aria-label'), /New post in # Voice/);
        await vis('.ch-fab').click();
        const ta = vis('.ch-compose textarea'); await ta.waitFor();
        await ta.fill('Synthetic new post for the Voice channel');
        await vis('.ch-compose [type="submit"], .ch-compose .send, .ch-compose [data-chsend]').click().catch(async () => { await ta.press('Enter'); });
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('wos.chats.spaces.v1') || '[]').find(s => s.id === 'voice')?.threads.length === 2, null, { timeout: 8000 });
        entry.filed = await page.evaluate(() => JSON.parse(localStorage.getItem('wos.chats.spaces.v1')).find(s => s.id === 'voice').threads);
        assert.equal(entry.errors.length, 0, 'browser errors: ' + entry.errors.join('; '));
        entry.pass = true;
      } catch (e) { entry.failure = e.stack; const pages = context.pages(); if (pages[0]) { entry.body = (await pages[0].locator('body').innerText().catch(() => '')).slice(0, 1500); await pages[0].screenshot({ path: path.join(out, stem + '-failure.png') }).catch(() => {}); } }
      finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await context.close(); }
    }
  } finally { await browser.close(); }
  const failed = report.cases.filter(c => !c.pass);
  console.log(JSON.stringify({ cases: report.cases.length, passed: report.cases.length - failed.length, failed: failed.map(c => c.stem + ': ' + String(c.failure).split('\n')[0]), screenshots: fs.readdirSync(out).filter(f => f.endsWith('.png')).length }));
  if (failed.length || report.cases.length !== 8) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
