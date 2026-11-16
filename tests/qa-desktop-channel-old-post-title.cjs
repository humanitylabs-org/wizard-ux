'use strict';
// An older post opened from a channel feed shows its title beside Back (wizard-ux issue 1329, follow-up to 1302).
// Real browser, AI apps desktop at 1440x900, Nebula + Grove, Channels on (wizard/chat-channels) with the channel store,
// and a disposable synthetic transport (no box is read or written). The Launch feed holds a post ("Launch venue") that
// only the channel's own list has: five days old, outside the loaded Activity list. Opening it must show
// "‹ # Launch" and "Launch venue" in the column header on every frame after the thread shows (no blank, no flicker).
// QA_EXPECT=broken (run with QA_WEB=<main worktree>/web) asserts main's blank title.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://chat-channels.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'desktop-channel-old-post-title-evidence');
const SKINS = (process.env.QA_SKINS || 'nebula,grove').split(',');
const EXPECT = process.env.QA_EXPECT || 'fixed';
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const SPACES = [{ id: 'launch', name: 'Launch', agent: 'hermes', threads: ['qa-l1', 'qa-l2'], createdAt: iso(now - 9e8) }];
const CHANNELS = () => [{ id: 'launch', agent: 'hermes', name: 'Launch', order: 0, createdAt: iso(now - 9e8), archived: false, pinned: false }];
const raw = s => ({ id: s.id, title: s.title, runtime: 'direct', status: s.status, updated_at: iso(s.at), updatedAt: iso(s.at), last_active: s.at / 1000, message_count: 2, messageCount: 2, archived: false, preview: s.preview,
  ...(s.channel ? { channel: s.channel } : {}), ...(s.firstRequest ? { firstRequest: s.firstRequest } : {}) });
const LIVE_ROWS = [
  { id: 'qa-l1', title: 'Launch checklist', status: 'completed', at: now - 5 * 36e5, preview: 'Which date works?', channel: 'launch', firstRequest: 'Get the launch checklist ready for Friday' },
  { id: 'qa-l2', title: 'Press notes', status: 'completed', at: now - 30 * 6e4, preview: 'Drafted.', channel: 'launch', firstRequest: 'Draft the press notes' },
  { id: 'qa-g1', title: 'Weekend plans', status: 'completed', at: now - 60 * 6e4, preview: 'Here is a plan.', firstRequest: 'Plan my weekend' },
];
// Only the channel's own list has it: older than the loaded Activity list.
const OLD = { id: 'qa-old', title: 'Launch venue', status: 'completed', at: now - 5 * 864e5, preview: 'Booked.', channel: 'launch', firstRequest: 'Find a venue for the launch party' };
const report = { origin, web, expect: EXPECT, cases: [] };
(async () => {
  const browser = await chromium.launch();
  try {
    for (const skin of SKINS) {
      const stem = `old-post-title-${skin}-${EXPECT}`, entry = { stem, errors: [], refused: [] }; report.cases.push(entry);
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        const mix = { 'wizard/desktop-chats': true, 'wizard/chat-channels': true };
        await context.addInitScript(({ skin, mix, spaces }) => {
          if (window !== top) return;
          if (sessionStorage.getItem('qaBoot')) return; sessionStorage.setItem('qaBoot', '1');
          for (const [k, v] of Object.entries({ 'wos.shell': 'desktop', 'wux.shell': 'desktop', 'wos.desktop-view.v1': 'ai-apps', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
            'wos.chats.spaces.v1': JSON.stringify(spaces), 'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v);
        }, { skin, mix, spaces: SPACES });
        const members = {}; for (const s of [...LIVE_ROWS, OLD]) if (s.channel) members[s.id] = s.channel;
        const prefs = { migrations: { 'launcher-seed-v1': true }, spaces: structuredClone(SPACES) };
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
          if (u.origin !== origin) { entry.refused.push({ method, url: q.url() }); return r.abort(); }
          if (!['GET', 'HEAD'].includes(method)) {
            if (method === 'PUT' && p === '/wizard/thread-seen') return r.fulfill({ json: { ok: true, state: q.postDataJSON() } });
            if (method === 'PATCH' && p === '/wizard/v1/ui-preferences') return r.fulfill({ json: prefs });
            return r.fulfill({ status: 405, json: { error: 'Synthetic fixture refuses this write' } });
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
          if (p === '/wizard/v1/channels') return r.fulfill({ json: { schema: 'wizard.channels/1', sort: 'az', migratedAt: iso(now - 864e5), channels: CHANNELS() } });
          if (p === '/wizard/hermes/api/sessions' && u.searchParams.has('channel')) {
            const id = u.searchParams.get('channel');
            const data = [OLD, ...LIVE_ROWS].filter(s => members[s.id] === id).sort((a, b) => a.at - b.at).map(s => ({ ...raw(s), listVersion: 1, agent: '', createdAt: iso(s.at) }));
            return r.fulfill({ json: { object: 'list', data, offset: 0, limit: 100, has_more: false, snapshot: 'snap', window: 'channel', channel: id, order: 'oldest', channel_total: data.length, view: 'list', list_version: 1 } });
          }
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: LIVE_ROWS.map(raw), has_more: false } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) { const s = [...LIVE_ROWS, OLD].find(x => x.id === decodeURIComponent(m[1])); if (!s) return r.fulfill({ status: 404, json: { error: 'missing' } });
            return r.fulfill({ json: m[2] ? { messages: [{ role: 'user', content: s.firstRequest, timestamp: s.at / 1000 - 600 }, { role: 'assistant', content: s.preview, timestamp: s.at / 1000 - 590 }] } : { session: raw(s) } }); }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + prefix + 'desktop.html');
        await page.waitForFunction(() => window.__wux && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        await page.waitForFunction(() => document.documentElement.dataset.layout === 'ai-apps', null, { timeout: 15000 });
        await page.waitForFunction(() => (document.documentElement.dataset.tweaks || '').split(' ').includes('wizard/chat-channels'), null, { timeout: 15000 });
        assert.equal(await page.evaluate(() => document.documentElement.dataset.skin), skin);
        const vis = sel => page.locator(sel).filter({ visible: true }).first();
        await page.evaluate(() => document.fonts.ready); await nap(400);
        await vis('.aad-chan [data-chview="channels"]').click();
        await vis('.aad-chan .ch-chan-open[data-chchan="launch"]').click();
        await vis('.aad-feed .ch-chan-feed').waitFor();
        const allF = page.locator('.aad-feed [data-chchanf="all"]').filter({ visible: true });
        if (await allF.count()) await allF.first().click();
        await vis('.aad-feed .ch-post-b[data-chopen="qa-old"]').waitFor({ timeout: 8000 }); await nap(500);
        // the old post is in no list the Activity sidebar holds
        entry.inActivity = await page.locator('.aad-side .aad-rw[data-sid="qa-old"]').count();
        assert.equal(entry.inActivity, 0, 'the old post is not in the loaded Activity list');
        // Sample the header title on every frame from the click on.
        await page.evaluate(() => { window.__ttLog = []; const tick = () => { const t = document.querySelector('.aad-tt'), th = [...document.querySelectorAll('.ch-thread')].some(x => x.getClientRects().length && x.innerText.includes('Find a venue')); if (th) window.__ttLog.push(t ? t.textContent : null); if (window.__ttLog.length < 90) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
        await vis('.aad-feed .ch-post-b[data-chopen="qa-old"]').click();
        await page.locator('.ch-thread').filter({ visible: true, hasText: 'Find a venue for the launch party' }).first().waitFor({ timeout: 8000 });
        await nap(1800);
        entry.frames = await page.evaluate(() => window.__ttLog);
        entry.title = await page.evaluate(() => (document.querySelector('.aad-tt')?.textContent || '').trim());
        entry.back = (await vis('.aad-cback').innerText()).trim();
        await page.screenshot({ path: path.join(out, stem + '-thread.png') });
        assert.equal(entry.back, '‹ # Launch');
        if (EXPECT === 'broken') { assert.equal(entry.title, '', 'main: blank title beside Back'); entry.pass = true; continue; }
        assert.equal(entry.title, 'Launch venue');
        assert.ok(entry.frames.length > 10, 'frames sampled: ' + entry.frames.length);
        const off = entry.frames.filter(t => t !== 'Launch venue');
        assert.equal(off.length, 0, 'the title on every frame once the thread shows (no flicker): ' + JSON.stringify([...new Set(off)]));
        // A live post still takes its title from the lists.
        await vis('.aad-cback').click(); await vis('.aad-feed .ch-chan-feed').waitFor({ timeout: 5000 }); await nap(500);
        await vis('.aad-feed .ch-post-b[data-chopen="qa-l1"]').click();
        await page.locator('.ch-thread').filter({ visible: true, hasText: 'Get the launch checklist' }).first().waitFor({ timeout: 8000 }); await nap(400);
        entry.liveTitle = (await vis('.aad-tt').innerText()).trim(); assert.equal(entry.liveTitle, 'Launch checklist');
        assert.equal(entry.errors.length, 0, 'browser errors: ' + entry.errors.join('; '));
        entry.pass = true;
      } catch (e) { entry.failure = e.stack; const pages = context.pages(); if (pages[0]) await pages[0].screenshot({ path: path.join(out, stem + '-failure.png') }).catch(() => {}); }
      finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await context.close(); }
    }
  } finally { await browser.close(); }
  const failed = report.cases.filter(c => !c.pass);
  console.log(JSON.stringify({ expect: EXPECT, cases: report.cases.length, passed: report.cases.length - failed.length, failed: failed.map(c => c.stem + ': ' + String(c.failure).split('\n').slice(0, 2).join(' | ')), detail: report.cases.map(c => ({ stem: c.stem, title: c.title, back: c.back, frames: c.frames && c.frames.length, live: c.liveTitle })) }));
  if (failed.length || report.cases.length !== SKINS.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
