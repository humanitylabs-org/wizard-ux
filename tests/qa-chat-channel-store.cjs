'use strict';
// Chats channels on the Agent Service channel store (wizard/chat-channels, wizard-ux issue 1261) in a real browser.
// Disposable synthetic transport only: a fake store answers /wizard/v1/channels (GET, PATCH, PUT membership) and the
// channel feed (sessions?view=list&channel=); nothing reaches a box. Phone 390x844 + desktop 1440x960, Nebula + Grove,
// store on, plus one store-off case per shell (404: Channels stay on Spaces, phase 1).
// Store on: the Channels list is the store's (Alerts pinned at the top, the archived channel in Archive), a row's
// "# channel" is its list row's `channel`, pin and sort are PATCHes, the Launch feed holds a post only the channel's own
// list has (with its firstRequest words) and opens it, and "Move to channel" is one PUT membership with the row's agent.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://chat-channel-store.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'chat-channel-store-evidence');
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
// The ui-preferences projection the store serves to older shells: deliberately stale (qa-l1 is in Launch on its row).
const SPACES = [
  { id: 'launch', name: 'Launch', threads: ['qa-l2'], createdAt: iso(now - 9e8) },
  { id: 'voice', name: 'Voice', threads: ['qa-l1', 'qa-v1'], createdAt: iso(now - 8e8) },
  { id: 'ideas', name: 'Ideas', threads: [], createdAt: iso(now - 7e8) },
];
const CHANNELS = () => [
  { id: 'alerts', agent: 'hermes', name: 'Alerts', order: -1, createdAt: iso(now - 1e8), archived: false, pinned: true, pinOrder: 0, kind: 'alerts' },
  { id: 'launch', agent: 'hermes', name: 'Launch', order: 0, createdAt: iso(now - 9e8), archived: false, pinned: false },
  { id: 'voice', agent: 'hermes', name: 'Voice', order: 1, createdAt: iso(now - 8e8), archived: false, pinned: false },
  { id: 'ideas', agent: 'hermes', name: 'Ideas', order: 2, createdAt: iso(now - 7e8), archived: false, pinned: false },
  { id: 'old-stuff', agent: 'hermes', name: 'Old stuff', order: 3, createdAt: iso(now - 7e8), archived: true, archivedAt: iso(now - 864e5), pinned: false },
];
const raw = s => ({ id: s.id, title: s.title, runtime: 'direct', status: s.status, updated_at: iso(s.at), updatedAt: iso(s.at), last_active: s.at / 1000, message_count: 2, messageCount: 2, archived: !!s.archived, preview: s.preview,
  ...(s.channel ? { channel: s.channel } : {}), ...(s.firstRequest ? { firstRequest: s.firstRequest } : {}), ...(s.status === 'running' ? { wizard_run_id: 'run-' + s.id, wizard_assigned_at: iso(s.at) } : {}) });
const LIVE_ROWS = [
  { id: 'qa-l1', title: 'Launch checklist', status: 'completed', at: now - 5 * 36e5, preview: 'Which date works?', channel: 'launch', firstRequest: 'Get the launch checklist ready for Friday' },
  { id: 'qa-l2', title: 'Press notes', status: 'running', at: now - 30 * 6e4, preview: 'Drafting…', channel: 'launch', firstRequest: 'Draft the press notes' },
  { id: 'qa-v1', title: 'Voice keys', status: 'completed', at: now - 2 * 36e5, preview: 'Shipped.', channel: 'voice', firstRequest: 'Ship the voice keys' },
  { id: 'qa-g1', title: 'Weekend plans', status: 'completed', at: now - 60 * 6e4, preview: 'Here is a plan.', firstRequest: 'Plan my weekend' },
];
// Only the channel's own list has it: five days old and Done, outside the live list.
const OLD = { id: 'qa-old', title: 'Launch venue', status: 'completed', at: now - 5 * 864e5, preview: 'Booked.', channel: 'launch', firstRequest: 'Find a venue for the launch party' };
const report = { origin, web, cases: [] };
(async () => {
  const browser = await chromium.launch();
  try {
    for (const [shell, skin, storeOn] of [['phone', 'nebula', true], ['phone', 'grove', true], ['phone', 'nebula', false], ['desktop', 'nebula', true], ['desktop', 'grove', true], ['desktop', 'nebula', false]]) {
      const phone = shell === 'phone', stem = `${shell}-${skin}-store-${storeOn ? 'on' : 'off'}`;
      const entry = { stem, errors: [], refused: [], writes: [], feedReads: [] }; report.cases.push(entry);
      const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 960 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', ...(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' } : {}) });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        const mix = { 'wizard/desktop-chats': true, 'wizard/chat-channels': true };
        await context.addInitScript(({ shell, skin, mix, spaces }) => {
          if (window !== top) return;
          for (const [k, v] of Object.entries({ 'wos.shell': shell, 'wos.desktop-view.v1': 'classic', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin, 'wos.chats.view.v1': 'channels',
            'wos.chats.spaces.v1': JSON.stringify(spaces), 'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v);
        }, { shell, skin, mix, spaces: SPACES });
        const box = { sort: 'az', channels: CHANNELS(), members: {} };
        for (const s of [...LIVE_ROWS, OLD]) if (s.channel) box.members['hermes|' + s.id] = s.channel;
        const rowsNow = () => LIVE_ROWS.map(s => raw({ ...s, channel: box.members['hermes|' + s.id] }));
        const prefs = { migrations: { 'launcher-seed-v1': true }, spaces: structuredClone(SPACES) };
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
          if (u.origin !== origin) { entry.refused.push({ method, url: q.url(), reason: 'external' }); return r.abort(); }
          if (p.startsWith('/wizard/v1/channels') && !storeOn) return r.fulfill({ status: 404, json: { error: 'not_found' } });
          if (!['GET', 'HEAD'].includes(method)) {
            entry.writes.push({ method, path: p, body: q.postDataJSON?.() ?? null });
            if (method === 'PUT' && p === '/wizard/thread-seen') return r.fulfill({ json: { ok: true, state: q.postDataJSON() } });
            if (method === 'PATCH' && p === '/wizard/v1/channels') {
              const b = q.postDataJSON();
              if (b.sort) box.sort = b.sort;
              const c = box.channels.find(x => x.id === b.id);
              if (c && b.pinned === true && !c.pinned) { c.pinned = true; c.pinOrder = Math.max(-1, ...box.channels.filter(x => x.pinned && x !== c).map(x => x.pinOrder)) + 1; }
              if (c && b.pinned === false) { c.pinned = false; delete c.pinOrder; }
              return r.fulfill({ json: c || { schema: 'wizard.channels/1', sort: box.sort, channels: box.channels } });
            }
            if (method === 'PUT' && p === '/wizard/v1/channels/membership') { const b = q.postDataJSON(); if (b.channelId) box.members[(b.agent || 'hermes') + '|' + b.sessionId] = b.channelId; else delete box.members[(b.agent || 'hermes') + '|' + b.sessionId]; return r.fulfill({ json: { sessionId: b.sessionId, agent: b.agent || 'hermes', channel: b.channelId } }); }
            if (method === 'PATCH' && p === '/wizard/v1/ui-preferences') return r.fulfill({ json: prefs });
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
          if (p === '/wizard/v1/channels') return r.fulfill({ json: { schema: 'wizard.channels/1', sort: box.sort, migratedAt: iso(now - 864e5), channels: box.channels } });
          if (p === '/wizard/hermes/api/sessions' && u.searchParams.has('channel')) {
            const id = u.searchParams.get('channel'); entry.feedReads.push(u.search);
            if (!box.channels.some(c => c.id === id)) return r.fulfill({ status: 404, json: { error: 'not_found' } });
            const data = [OLD, ...LIVE_ROWS].filter(s => box.members['hermes|' + s.id] === id).sort((a, b) => a.at - b.at).map(s => ({ ...raw({ ...s, channel: id }), listVersion: 1, agent: '', updatedAt: iso(s.at), createdAt: iso(s.at) }));
            return r.fulfill({ json: { object: 'list', data, offset: 0, limit: 100, has_more: false, snapshot: 'snap', window: 'channel', channel: id, order: 'oldest', channel_total: data.length, view: 'list', list_version: 1 } });
          }
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: rowsNow(), has_more: false } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) { const s = [...LIVE_ROWS, OLD].find(x => x.id === decodeURIComponent(m[1])); if (!s) return r.fulfill({ status: 404, json: { error: 'missing' } });
            return r.fulfill({ json: m[2] ? { messages: [{ role: 'user', content: s.firstRequest, timestamp: s.at / 1000 - 600 }, { role: 'assistant', content: s.preview, timestamp: s.at / 1000 - 590 }] } : { session: raw(s) } }); }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
        await page.waitForFunction(() => (window.__wux || window.__wos) && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        await page.waitForFunction(() => (document.documentElement.dataset.tweaks || '').split(' ').includes('wizard/chat-channels'), null, { timeout: 15000 });
        assert.equal(await page.evaluate(() => document.documentElement.dataset.skin), skin);
        await page.evaluate(phone => phone ? __wos.openSheet('inbox') : __wux.openChatsList(), phone);
        const vis = sel => page.locator(sel).filter({ visible: true }).first();
        const menu = async loc => {
          if (!phone) return loc.click({ button: 'right' });
          const b = await loc.boundingBox(), at = { pointerType: 'touch', pointerId: 7, isPrimary: true, button: 0, clientX: b.x + b.width / 2, clientY: b.y + b.height / 2 };
          await loc.dispatchEvent('pointerdown', at); await nap(650); await loc.dispatchEvent('pointerup', at);
        };
        const order = () => page.locator('.ch-chan-list > .ch-chan .ch-chan-open').filter({ visible: true }).evaluateAll(b => b.map(x => x.dataset.chchan));
        await vis('.ch-chan-open[data-chchan="launch"]').waitFor();
        // The store answers after the first paint (or never, store off): wait for its list.
        if (storeOn) await vis('.ch-chan-open[data-chchan="alerts"]').waitFor({ timeout: 8000 }); else await nap(1500);
        await page.evaluate(() => document.fonts.ready); await nap(300);
        entry.order = await order();
        if (!storeOn) {
          assert.deepEqual(entry.order, ['ideas', 'launch', 'voice', '__general__'], 'store off: the Spaces, A–Z, no Alerts');
          await page.screenshot({ path: path.join(out, stem + '-channels.png') });
          await menu(vis('.ch-chan-open[data-chchan="voice"]')); await vis('.ch-sheet [data-rschpin]').click(); await nap(200);
          assert.deepEqual(await order(), ['voice', 'ideas', 'launch', '__general__']);
          entry.localPrefs = await page.evaluate(() => JSON.parse(localStorage.getItem('wos.chats.channel-prefs.v1') || 'null'));
          assert.deepEqual(entry.localPrefs.pins, ['voice'], 'store off: the pin stays on this device, as in phase 1');
          assert.equal(entry.writes.filter(w => w.path.startsWith('/wizard/v1/channels')).length, 0);
          assert.equal(entry.errors.length, 0, 'browser errors: ' + entry.errors.join('; '));
          entry.pass = true; continue;
        }
        assert.deepEqual(entry.order, ['alerts', 'ideas', 'launch', 'voice', '__general__'], 'the store list: Alerts pinned at the top, A–Z, General last');
        assert.equal(await vis('[data-chchanarch]').innerText().then(t => t.replace(/\s+/g, ' ').trim().toLowerCase()), 'archive 1', 'the store-archived channel waits in Archive');
        await page.screenshot({ path: path.join(out, stem + '-channels.png') });
        // Pin Voice: one PATCH; it goes under Alerts.
        await menu(vis('.ch-chan-open[data-chchan="voice"]')); await vis('.ch-sheet [data-rschpin]').click(); await nap(300);
        entry.pinned = await order();
        assert.deepEqual(entry.pinned, ['alerts', 'voice', 'ideas', 'launch', '__general__']);
        await vis('[data-chchansort="za"]').click(); await nap(300);
        entry.za = await order(); assert.deepEqual(entry.za, ['alerts', 'voice', 'launch', 'ideas', '__general__']);
        await page.screenshot({ path: path.join(out, stem + '-channels-pinned-za.png') });
        await vis('[data-chchansort="az"]').click(); await nap(300);
        const patches = entry.writes.filter(w => w.method === 'PATCH' && w.path === '/wizard/v1/channels').map(w => w.body);
        assert.deepEqual(patches, [{ id: 'voice', pinned: true }, { sort: 'za' }, { sort: 'az' }], 'pin and sort are store PATCHes');
        assert.equal(await page.evaluate(() => localStorage.getItem('wos.chats.channel-prefs.v1')), null, 'nothing kept on this device');
        // The Launch feed: the store-only post is there with its own words, between the live ones by time.
        await vis('.ch-chan-open[data-chchan="launch"]').click(); await vis('.ch-chan-h').waitFor();
        await vis('.ch-post-b[data-chopen="qa-old"]').waitFor({ timeout: 8000 });
        const posts = () => page.locator('.ch-chan-feed .ch-post-b').filter({ visible: true }).evaluateAll(b => b.map(x => x.dataset.chopen));
        entry.feed = await posts(); assert.deepEqual(entry.feed, ['qa-old', 'qa-l1', 'qa-l2']);
        entry.oldText = (await vis('.ch-post-b[data-chopen="qa-old"] .ch-post-t').innerText()).trim();
        assert.equal(entry.oldText, OLD.firstRequest, 'the post says firstRequest from the row');
        assert.ok(entry.feedReads.some(s => /view=list&channel=launch&limit=100&offset=0/.test(s)), 'read from the channel feed: ' + entry.feedReads);
        await page.screenshot({ path: path.join(out, stem + '-feed.png') });
        await vis('.ch-post-b[data-chopen="qa-old"]').click();
        await vis('.ch-thread').waitFor();
        await page.locator('.ch-thread').filter({ visible: true, hasText: 'Find a venue for the launch party' }).first().waitFor({ timeout: 8000 });
        await page.screenshot({ path: path.join(out, stem + '-feed-thread.png') });
        const back = () => page.evaluate(() => window.__wos ? __wos.onBack() : __wux.escStep());
        for (let i = 0; i < 4 && !(await page.locator('.ch-chan-open[data-chchan="launch"]').filter({ visible: true }).count()); i++) { await back(); await nap(200); if (phone && !(await page.locator('.ch-list').filter({ visible: true }).count())) await page.evaluate(() => __wos.openSheet('inbox')); }
        // Activity: the "# channel" comes from the row (the projection still says Voice for qa-l1).
        await vis('[data-chview="activity"]').click(); await vis('.ch-list [data-chopen="qa-g1"]').waitFor();
        entry.line = (await vis('.ch-list [data-chopen="qa-l1"]').innerText()).replace(/\s+/g, ' ');
        assert.match(entry.line, /# Launch/);
        // Move to channel: one PUT membership with the row's agent; the line follows at once.
        await menu(vis('.ch-list [data-chopen="qa-g1"]'));
        await vis('.ch-sheet [data-rsspacepicker]').click();
        await vis('.ch-space-picker [data-spspace="ideas"]').click(); await nap(400);
        entry.move = entry.writes.filter(w => w.path === '/wizard/v1/channels/membership').map(w => w.body);
        assert.deepEqual(entry.move, [{ sessionId: 'qa-g1', channelId: 'ideas', agent: 'hermes' }]);
        await page.waitForFunction(() => [...document.querySelectorAll('.ch-list [data-chopen="qa-g1"]')].some(x => x.getClientRects().length && /# Ideas/.test(x.innerText)), null, { timeout: 5000 });
        assert.equal(entry.writes.filter(w => w.path === '/wizard/v1/ui-preferences').length, 0, 'nothing through ui-preferences');
        await page.screenshot({ path: path.join(out, stem + '-moved.png') });
        assert.equal(entry.errors.length, 0, 'browser errors: ' + entry.errors.join('; '));
        entry.pass = true;
      } catch (e) { entry.failure = e.stack; const pages = context.pages(); if (pages[0]) { entry.body = (await pages[0].locator('body').innerText().catch(() => '')).slice(0, 1500); await pages[0].screenshot({ path: path.join(out, stem + '-failure.png') }).catch(() => {}); } }
      finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await context.close(); }
    }
  } finally { await browser.close(); }
  const failed = report.cases.filter(c => !c.pass);
  console.log(JSON.stringify({ cases: report.cases.length, passed: report.cases.length - failed.length, failed: failed.map(c => c.stem + ': ' + String(c.failure).split('\n')[0]), screenshots: fs.readdirSync(out).filter(f => f.endsWith('.png')).length }));
  if (failed.length || report.cases.length !== 6) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
