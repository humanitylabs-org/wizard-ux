'use strict';
// Chats always shows a visible Back (James, 12 Nov 2026, the Mac app window at ~600 px: "I am missing a back button here
// at smaller width, so there's no way to go back to the channel list. Make sure the user always has a back button in
// chats. It either takes them back to the channels or the chats list, wherever is one level above where they were
// last."). Real browser, AI apps desktop, Channels on, two skins, widths 1440 / 760 / 600, the disposable synthetic
// transport of tests/qa-desktop-channel-back-view.cjs (no box is read or written). Per width:
//   - a chat from the list: "‹ Activity" in its header only where the list is not beside it (600; full screen at 1440);
//     Back (button, then Esc) closes it and shows the list over the page; Esc again closes the list; the root stays.
//   - a channel: its feed "‹ Channels" where the list is not beside; a post in it "‹ # Launch" at every width; Back
//     there is the feed; Back on the feed is the channel list. The page never navigates.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://chats-back.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'chats-back-narrow-evidence');
const SKINS = (process.env.QA_SKINS || 'nebula,grove').split(',');
const WIDTHS = (process.env.QA_WIDTHS || '1440,760,600').split(',').map(Number);
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
    for (const skin of SKINS) for (const width of WIDTHS) {
      const stem = `chats-back-${skin}-${width}`, entry = { stem, errors: [], refused: [], writes: [], steps: [] }; report.cases.push(entry);
      const context = await browser.newContext({ viewport: { width, height: 820 }, serviceWorkers: 'block' });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        const mix = { 'wizard/desktop-chats': true, 'wizard/chat-channels': true };
        await context.addInitScript(({ skin, mix, spaces }) => {
          if (window !== top) return;
          if (sessionStorage.getItem('qaBoot')) return; sessionStorage.setItem('qaBoot', '1');
          for (const [k, v] of Object.entries({ 'wos.shell': 'desktop', 'wux.shell': 'desktop', 'wos.desktop-view.v1': 'ai-apps', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
            'wos.chats.spaces.v1': JSON.stringify(spaces), 'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v);
        }, { skin, mix, spaces: SPACES });
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
        await page.waitForFunction(() => (document.documentElement.dataset.tweaks || '').split(' ').includes('wizard/chat-channels'), null, { timeout: 15000 });
        await page.evaluate(() => document.fonts.ready); await nap(600);
        const startUrl = page.url(), hist = await page.evaluate(() => history.length);
        await page.evaluate(() => { window.__qaSameDocument = true; }); // a real navigation (Back leaving Wizard) drops it
        const vis = sel => page.locator(sel).filter({ visible: true }).first();
        const side = () => page.evaluate(() => document.documentElement.dataset.aadSide || '');
        const back = () => page.evaluate(() => { const b = document.querySelector('.aad-cback'); return b && !b.hidden && b.getClientRects().length ? b.textContent : ''; });
        const thread = () => page.evaluate(() => { const t = [...document.querySelectorAll('.ch-thread')].find(t => t.getClientRects().length); return t ? t.innerText.slice(0, 400) : ''; });
        const step = async (name, extra = {}) => { const s = { name, side: await side(), back: await back(), ...extra }; entry.steps.push(s); await page.screenshot({ path: path.join(out, `${stem}-${String(entry.steps.length).padStart(2, '0')}-${name}.png`) }); return s; };
        const listBeside = width >= 680; // DOCKED_FROM: the sidebar open beside the chat (no app beside it here)
        // one app at a time under 1100 px (James, 12 Nov 2026): below 680 the list fills the window ('full'), the chat alone
        // ('none') after it; Back shows the list again in place (no list over the page), and at the list it stays
        const oneW = width < 1100, over = oneW ? 'full' : 'over';
        const showList = async () => { const v = await side(); if (v !== 'open' && v !== 'full') { await vis(oneW ? '.aad-cback, .aad-oneback' : '.aad-rtog').click(); await nap(500); } };
        // 1. A chat from the list (Activity).
        await showList();
        await vis(`.aad-side .aad-rw[data-sid="qa-g1"] .aad-row`).click();
        await page.waitForFunction(() => [...document.querySelectorAll('.ch-thread')].some(t => t.getClientRects().length && /Synthetic ask for Weekend plans/.test(t.innerText)), null, { timeout: 8000 });
        await nap(700);
        let s = await step('list-thread');
        assert.equal(s.back, listBeside ? '' : '‹ Activity', `${stem}: a list chat ${listBeside ? 'beside the list: no Back' : 'shows ‹ Activity'}`);
        if (!listBeside) {
          assert.equal(s.side, oneW ? 'none' : 'rail', 'the list is not beside it');
          await vis('.aad-cback').click(); await nap(700);
          s = await step('list-thread-back', { thread: await thread() });
          assert.equal(s.side, over, 'Back shows the list'); assert.equal(s.back, '', 'the chat closed');
          assert.ok(await vis(`.aad-side .aad-rw[data-sid="qa-g1"] .aad-row`).isVisible(), 'the list it came from');
          await page.keyboard.press('Escape'); await nap(500); assert.equal(await side(), oneW ? 'full' : 'rail', oneW ? 'at the list Esc stays' : 'Esc closes the list');
          // Esc instead of the button: the same one level
          await showList(); await vis(`.aad-side .aad-rw[data-sid="qa-g1"] .aad-row`).click(); await nap(900);
          assert.equal(await back(), '‹ Activity');
          await page.keyboard.press('Escape'); await nap(700);
          s = await step('list-thread-esc'); assert.equal(s.side, over, 'Esc: the list'); assert.equal(s.back, '');
          await page.keyboard.press('Escape'); await nap(400);
        } else if (width >= 1200) {
          // full screen hides the list: the chat's Back shows it over the page, still full screen
          await vis('.aad-ctop [data-mode="full"]').click(); await nap(900);
          s = await step('list-thread-full'); assert.equal(s.back, '‹ Activity', 'full screen: Back to the list');
          await page.keyboard.press('Escape'); await nap(700);
          s = await step('list-thread-full-esc', { mode: await page.evaluate(() => document.documentElement.dataset.aadMode || '') });
          assert.equal(s.side, 'over', 'the list over the page'); assert.equal(s.mode, 'full', 'still full screen');
          const box = await vis(`.aad-side .aad-rw[data-sid="qa-g1"] .aad-row`).boundingBox();
          assert.ok(box && box.height > 20 && box.width > 150, 'the list really shows: ' + JSON.stringify(box));
          await page.keyboard.press('Escape'); await nap(500);
          assert.notEqual(await side(), 'over', 'Esc again closes the list');
          await vis('.aad-ctop [data-mode="full"]').click().catch(() => {}); await nap(400);
          if ((await page.evaluate(() => document.documentElement.dataset.aadMode || '')) === 'full') { await page.keyboard.press('Escape'); await nap(500); }
        }
        // root: more Esc presses never leave Wizard
        for (let i = 0; i < 3; i++) { await page.keyboard.press('Escape'); await nap(200); }
        assert.equal(page.url(), startUrl, 'root Back stays in Wizard'); assert.ok(await page.evaluate(() => !!window.__wux));
        // 2. A channel: its feed, a post, Back to the feed, Back to the channel list.
        await showList();
        await vis('.aad-chan [data-chview="channels"]').click(); await nap(300);
        await vis('.aad-chan .ch-chan-open[data-chchan="launch"]').click();
        await vis('.aad-feed .ch-post-b[data-chopen="qa-p02"]').waitFor({ timeout: 8000 }); await nap(800);
        s = await step('feed'); assert.notEqual(s.side, 'over', 'the feed in front');
        assert.equal(s.back, listBeside ? '' : '‹ Channels', `${stem}: the feed ${listBeside ? 'beside the channel list' : 'shows ‹ Channels'}`);
        await vis('.aad-feed .ch-post-b[data-chopen="qa-p02"]').click();
        await page.waitForFunction(() => [...document.querySelectorAll('.ch-thread')].some(t => t.getClientRects().length && /Synthetic ask for Launch post 2/.test(t.innerText)), null, { timeout: 8000 }); await nap(700);
        s = await step('post'); assert.equal(s.back, '‹ # Launch', 'a post: back to its channel at every width');
        await vis('.aad-cback').click();
        await vis('.aad-feed .ch-chan-feed').waitFor({ timeout: 5000 }); await nap(800);
        s = await step('post-back'); assert.equal(s.back, listBeside ? '' : '‹ Channels', 'Back from the post: the feed');
        // Esc on the post too
        await vis('.aad-feed .ch-post-b[data-chopen="qa-p02"]').click(); await nap(900); assert.equal(await back(), '‹ # Launch');
        await page.keyboard.press('Escape'); await vis('.aad-feed .ch-chan-feed').waitFor({ timeout: 5000 }); await nap(600);
        // Back from the feed: the channel list
        if (!listBeside) await vis('.aad-cback').click(); else await page.keyboard.press('Escape');
        await nap(800);
        s = await step('feed-back');
        assert.ok(await vis('.aad-chan .ch-chan-open[data-chchan="launch"]').isVisible(), 'the channel list');
        assert.equal(await page.locator('.aad-feed .ch-chan-feed').filter({ visible: true }).count(), 0, 'the feed closed');
        if (!listBeside) assert.equal(s.side, over, 'the channel list');
        for (let i = 0; i < 4; i++) { await page.keyboard.press('Escape'); await nap(200); }
        assert.equal(page.url(), startUrl, 'root Back stays in Wizard');
        // (the shell arms one guard entry on the first tap, app-services.js, so the browser's Back never leaves Wizard)
        assert.ok(await page.evaluate(() => history.length) <= hist + 1, 'no history steps beyond the shell\'s own guard');
        assert.equal(await page.evaluate(() => window.__qaSameDocument === true), true, 'the page never navigated');
        assert.equal(entry.errors.length, 0, 'browser errors: ' + entry.errors.join('; '));
        entry.pass = true;
      } catch (e) { entry.failure = e.stack; const pages = context.pages(); if (pages[0]) await pages[0].screenshot({ path: path.join(out, stem + '-failure.png') }).catch(() => {}); }
      finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await context.close(); }
    }
  } finally { await browser.close(); }
  const failed = report.cases.filter(c => !c.pass);
  console.log(JSON.stringify({ cases: report.cases.length, passed: report.cases.length - failed.length, failed: failed.map(c => c.stem + ': ' + String(c.failure).split('\n').slice(0, 3).join(' | ')), steps: report.cases.map(c => ({ stem: c.stem, steps: c.steps.map(x => [x.name, x.side, x.back]) })) }));
  if (failed.length || report.cases.length !== SKINS.length * WIDTHS.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
