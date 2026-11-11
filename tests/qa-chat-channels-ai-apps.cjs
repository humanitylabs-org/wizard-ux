'use strict';
// Channels in the AI apps desktop sidebar (wizard/chat-channels, wizard-ux issue 1256) in a real browser. Same disposable
// synthetic transport as tests/qa-chat-channels.cjs: no owner API reads or writes reach a box; the only writes allowed
// are the synthetic send and the Space filing it makes. Desktop 1440x900, wos.desktop-view.v1 = ai-apps, Nebula + Grove.
// Per case: switch off = the sidebar as today (no tabs, no "# channel", no pane); switch on = Activity tabs over the
// sidebar's own rows, each with a muted "# channel" second line in a 56 px row; Channels (one line per Space plus
// General, the right-hand indicator slot, a chevron); a channel feed (Open / Needs you / All, posts with a reply line);
// a post opens the thread in the chat column and the feed stays; Back thread -> channel -> list; a new post from the
// feed's message box is filed into the channel; switching off inside a feed gives the sidebar back unchanged.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://chat-channels.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'chat-channels-ai-apps-evidence');
const SKINS = (process.env.QA_SKINS || 'nebula,grove').split(',');
// QA_START: how the desktop starts. 'chats' (default: a first run, the main Chats window on desk 1); 'app-desk' (a
// restored desktop whose only desk holds an app and no Chats window, as on James's desktop, wizard-ux issue 1256);
// 'no-chats' (an empty desk; the layout's Home makes a New chat); 'other-view' (the only Chats window is on another
// Chats view, so it is not the main one). The Channels tabs must show on the first paint in all of them.
const START = process.env.QA_START || 'chats';
const DESK = { chats: null, 'no-chats': { wins: {}, ws: [{ id: 'dqa1', wins: [], focus: null, mono: false }] },
  'app-desk': { wins: { wqa1: { id: 'wqa1', app: 'pages', appId: 'pages' } }, ws: [{ id: 'dqa1', wins: ['wqa1'], focus: 'wqa1', mono: false }], home: false },
  'other-view': { wins: { wqa1: { id: 'wqa1', app: 'chats', thread: null, chatsProvider: 'qa-other-chats' } }, ws: [{ id: 'dqa1', wins: ['wqa1'], focus: 'wqa1', mono: false }] } }[START];
assert.ok(DESK !== undefined, 'QA_START: chats, app-desk, no-chats or other-view');
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const SPACES = [
  { id: 'launch', name: 'Launch', agent: 'hermes', threads: ['qa-l1', 'qa-l2', 'qa-l3'], createdAt: iso(now - 9e8) },
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
  { id: 'qa-g1', title: 'Weekend plans with a long title that has to fit the sidebar row', status: 'completed', at: now - 60 * 6e4, preview: 'Here is a plan.' },
].map(s => ({ id: s.id, title: s.title, runtime: 'direct', status: s.status, updated_at: iso(s.at), updatedAt: iso(s.at), last_active: s.at / 1000, message_count: 4, messageCount: 4, archived: !!s.archived, preview: s.preview,
  ...(s.attention ? { wizard_attention: s.attention } : {}), ...(s.status === 'running' ? { wizard_run_id: 'run-' + s.id, wizard_assigned_at: iso(s.at) } : {}) }));
const report = { origin, web, cases: [] };
(async () => {
  const browser = await chromium.launch();
  try {
    for (const skin of SKINS) for (const on of [false, true]) {
      const stem = `ai-apps-${skin}-${on ? 'on' : 'off'}${START === 'chats' ? '' : '-' + START}`;
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
        entry.sideWidth = Math.round((await vis('.aad-side').boundingBox()).width);
        entry.bootWins = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('wux.desk.wins') || '{}')).map(w => [w.app, w.chatsProvider || '', w.agent || '']));
        entry.bootTabs = await page.locator('.aad-chan:not([hidden]) .ch-chan-tabs').count();
        // A desk with only an app open (no Chats window at all): the tabs are there on the first paint all the same.
        if (START === 'app-desk') assert.deepEqual(entry.bootWins, [['pages', '', '']], 'no Chats window when the sidebar first paints');
        if (on) assert.equal(entry.bootTabs, 1, 'the Activity / Channels tabs on the first paint');
        if (!on) {
          assert.equal(await page.locator('.aad-side .ch-chan-tabs, .aad-side .ch-chan-list').count(), 0, 'switch off: no tabs');
          assert.equal(await page.locator('.aad-chan-line').count(), 0, 'switch off: no channel line');
          assert.equal(await page.locator('.aad-chan:not([hidden])').count(), 0, 'switch off: no pane');
          entry.rowHeight = Math.round((await sideRow('qa-g1').boundingBox()).height);
          assert.equal(entry.rowHeight, 36, 'switch off: today\'s 36 px rows');
          await page.screenshot({ path: path.join(out, stem + '-activity.png') });
          entry.pass = true; continue;
        }
        // Activity: the tabs over the sidebar's own rows, each with a muted "# channel" on a second line.
        await vis('.aad-chan .ch-chan-tabs').waitFor();
        assert.equal(await vis('.aad-chan [data-chview="activity"]').getAttribute('aria-pressed'), 'true', 'Activity is the default');
        assert.ok(await vis('.aad-scroll').isVisible(), 'Activity: the sidebar\'s own rows');
        entry.channelLine = await sideRow('qa-v1').locator('.aad-chan-line').innerText();
        assert.equal(entry.channelLine, '# Voice');
        assert.equal(await sideRow('qa-g1').locator('.aad-chan-line').innerText(), '# General');
        const g1 = await sideRow('qa-g1').boundingBox(); entry.rowHeight = Math.round(g1.height);
        assert.equal(entry.rowHeight, 56, 'two lines at 56 px');
        entry.rowFits = await sideRow('qa-g1').evaluate(b => { const t = b.querySelector('.aad-row-t'), l = b.querySelector('.aad-chan-line'), r = b.getBoundingClientRect(), side = b.closest('.aad-side').getBoundingClientRect();
          return { inSide: r.right <= side.right + 0.5, title: t.scrollWidth > t.clientWidth ? 'ellipsis' : 'fits', lineColor: getComputedStyle(l).color, titleColor: getComputedStyle(t).color, lineTop: Math.round(l.getBoundingClientRect().top - r.top) }; });
        assert.ok(entry.rowFits.inSide, 'the row fits the sidebar');
        assert.notEqual(entry.rowFits.lineColor, entry.rowFits.titleColor, 'the channel line is muted');
        await page.screenshot({ path: path.join(out, stem + '-activity.png') });
        // Channels: one line per Space plus General, painted on the tap.
        await vis('.aad-chan [data-chview="channels"]').click();
        await vis('.aad-chan .ch-chan-list').waitFor();
        assert.equal(await page.locator('.aad-scroll').filter({ visible: true }).count(), 0, 'Channels replaces the rows');
        entry.channels = await page.locator('.aad-chan .ch-chan-list > .ch-chan .ch-chan-open').filter({ visible: true }).evaluateAll(b => b.map(x => x.dataset.chchan));
        assert.deepEqual(entry.channels, ['ideas', 'launch', 'voice', '__general__'], 'A–Z, General last');
        const launch = vis('.aad-chan .ch-chan-open[data-chchan="launch"]');
        entry.launchMarks = await launch.locator('.ch-chan-ind > *').evaluateAll(n => n.map(x => x.getAttribute('aria-label')));
        assert.deepEqual(entry.launchMarks, ['Working', 'Needs you', '1 unread'], 'one right-hand slot: spinner, amber, green (issue 1269)');
        entry.chanFits = await page.locator('.aad-chan .ch-chan').filter({ visible: true }).evaluateAll(n => { const side = n[0].closest('.aad-side').getBoundingClientRect(); return n.every(x => x.getBoundingClientRect().right <= side.right + 0.5 && x.scrollWidth <= x.clientWidth + 1); });
        assert.ok(entry.chanFits, 'channel lines fit the sidebar');
        await vis('.aad-chan [data-chchanx="launch"]').click(); await nap(150);
        entry.recent = await page.locator('.aad-chan .ch-chan-recent [data-chopen]').filter({ visible: true }).evaluateAll(b => b.map(x => x.dataset.chopen));
        assert.deepEqual(entry.recent, ['qa-l2', 'qa-l1'], 'chevron: working and needs-you posts, newest first');
        await page.screenshot({ path: path.join(out, stem + '-channels.png') });
        await vis('.aad-chan [data-chchanx="launch"]').click(); await nap(100);
        // The channel sheet on a right-click, as in Chats.
        await vis('.aad-chan .ch-chan-open[data-chchan="voice"]').click({ button: 'right' });
        await vis('.ch-sheet [data-rschpin]').waitFor();
        entry.sheet = (await page.locator('.ch-sheet .ch-sheet-b button').filter({ visible: true }).allInnerTexts()).map(t => t.trim());
        assert.deepEqual(entry.sheet, ['Pin', 'Rename', 'Archive channel', 'New post']);
        await page.screenshot({ path: path.join(out, stem + '-channel-sheet.png') });
        await page.keyboard.press('Escape'); await nap(800); // a right-click holds row taps for 700 ms (Chats' own long-press guard)
        assert.equal(await page.locator('.ch-sheet').count(), 0, 'Esc closes the channel sheet');
        // Feed.
        await launch.click();
        await vis('.aad-chan .ch-chan-h').waitFor();
        assert.match(await vis('.aad-chan .ch-chan-h').innerText(), /#\s*Launch/);
        const posts = async () => page.locator('.aad-chan .ch-chan-feed .ch-post-b').filter({ visible: true }).evaluateAll(b => b.map(x => x.dataset.chopen));
        entry.feedOpen = await posts(); assert.deepEqual(entry.feedOpen, ['qa-l1', 'qa-l2'], 'Open: oldest to newest, archived left out');
        await vis('.aad-chan .ch-post-b[data-chopen="qa-l1"] .ch-post-t:not(.ch-post-wait)').waitFor({ timeout: 8000 });
        entry.postText = (await vis('.aad-chan .ch-post-b[data-chopen="qa-l1"] .ch-post-t').innerText()).slice(0, 40);
        assert.ok(FIRST.startsWith(entry.postText), 'the first owner message: ' + entry.postText);
        await vis('.aad-chan [data-chchanf="needs"]').click(); assert.deepEqual(await posts(), ['qa-l1']);
        await vis('.aad-chan [data-chchanf="all"]').click(); assert.deepEqual(await posts(), ['qa-l3', 'qa-l1', 'qa-l2']);
        await vis('.aad-chan [data-chchanf="open"]').click();
        await page.waitForFunction(() => /1 reply|New reply|new repl/.test(document.querySelector('.aad-chan .ch-post-r[data-chopen="qa-l1"]')?.innerText || ''), null, { timeout: 8000 });
        entry.unreadLine = (await vis('.aad-chan .ch-post-r[data-chopen="qa-l1"]').innerText()).replace(/\s+/g, ' ').trim();
        assert.match(entry.unreadLine, /1 reply.*(New reply|1 new reply)/, 'the reply line with the green words on the right (issue 1269)');
        const box = vis('.aad-chan .ch-chan-compose');
        assert.equal(await box.locator('textarea').getAttribute('placeholder'), 'Message # Launch');
        entry.boxAtBottom = await page.evaluate(() => { const b = document.querySelector('.aad-chan .ch-chan-compose'), s = b.closest('.aad-panel').querySelector('.aad-foot'); return Math.round(s.getBoundingClientRect().top - b.getBoundingClientRect().bottom); });
        assert.ok(entry.boxAtBottom >= 0 && entry.boxAtBottom < 40, 'the box sits at the foot of the sidebar: ' + entry.boxAtBottom);
        entry.feedFits = await page.evaluate(() => { const f = document.querySelector('.aad-chan .ch-chan-feed'), side = f.closest('.aad-side').getBoundingClientRect(); return [...f.querySelectorAll('.ch-post')].every(p => p.getBoundingClientRect().right <= side.right + 0.5); });
        assert.ok(entry.feedFits, 'posts fit the sidebar');
        await page.screenshot({ path: path.join(out, stem + '-feed.png') });
        // A post opens the thread in the chat column; the feed stays in the sidebar; reading it clears its green dot.
        await vis('.aad-chan .ch-post-b[data-chopen="qa-l1"]').click();
        await page.waitForFunction(() => [...document.querySelectorAll('.ch-thread')].some(t => t.getClientRects().length && /launch checklist ready for Friday/.test(t.innerText)), null, { timeout: 8000 });
        assert.ok(await vis('.aad-chan .ch-chan-h').isVisible(), 'the feed stays in the sidebar beside the thread');
        await page.waitForFunction(() => !document.querySelector('.aad-chan .ch-post.unread[data-morph-key="post:qa-l1"]'), null, { timeout: 5000 });
        await page.screenshot({ path: path.join(out, stem + '-thread.png') });
        // Back: thread -> channel -> list.
        const back = () => page.evaluate(() => __wux.escStep());
        entry.back = [await back()]; await nap(250);
        for (let i = 0; i < 2 && await page.locator('.ch-thread').filter({ visible: true }).filter({ hasText: 'launch checklist ready for Friday' }).count(); i++) { entry.back.push(await back()); await nap(250); }
        assert.ok(await vis('.aad-chan .ch-chan-h').isVisible(), 'Back from the thread lands on the channel');
        entry.back.push(await back()); await nap(250);
        await vis('.aad-chan .ch-chan-open[data-chchan="launch"]').waitFor();
        assert.equal(await page.locator('.aad-chan .ch-chan-h').filter({ visible: true }).count(), 0, 'Back from the channel lands on the Channels list');
        entry.launchAfterRead = await vis('.aad-chan .ch-chan-open[data-chchan="launch"]').locator('.ch-chan-ind > *').evaluateAll(n => n.map(x => x.getAttribute('aria-label')));
        assert.deepEqual(entry.launchAfterRead, ['Working', 'Needs you'], 'read: no green dot on Launch');
        // A new post from the Voice feed's box is filed into Voice; the sidebar stays on the feed.
        await vis('.aad-chan .ch-chan-open[data-chchan="voice"]').click(); await vis('.aad-chan .ch-chan-h').waitFor(); await nap(400);
        const ta = vis('.aad-chan .ch-chan-compose textarea');
        await ta.fill('Synthetic new post for the Voice channel'); await nap(300);
        assert.equal(await ta.inputValue(), 'Synthetic new post for the Voice channel', 'the words stay in the channel box');
        await page.screenshot({ path: path.join(out, stem + '-channel-box.png') });
        await vis('.aad-chan .ch-chan-compose [type="submit"]').click();
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('wos.chats.spaces.v1') || '[]').find(s => s.id === 'voice')?.threads.length === 2, null, { timeout: 8000 });
        entry.filed = await page.evaluate(() => JSON.parse(localStorage.getItem('wos.chats.spaces.v1')).find(s => s.id === 'voice').threads);
        const newId = entry.filed[1];
        await vis(`.aad-chan .ch-post-b[data-chopen="${newId}"]`).waitFor({ timeout: 8000 });
        assert.ok(await vis('.aad-chan .ch-chan-h').isVisible(), 'stays in the channel');
        assert.match(await vis(`.aad-chan .ch-post-b[data-chopen="${newId}"]`).innerText(), /Synthetic new post for the Voice channel/);
        await nap(1200);
        assert.ok((entry.runs || []).length >= 1 && entry.runs[0].includes('Synthetic new post for the Voice channel'), 'the new chat was sent with the words');
        await page.screenshot({ path: path.join(out, stem + '-channel-posted.png') });
        // Switching off inside a feed: the sidebar as today.
        await page.evaluate(() => WosExperience.toggle('wizard/chat-channels'));
        await page.waitForFunction(() => !(document.documentElement.dataset.tweaks || '').split(' ').includes('wizard/chat-channels'));
        await nap(600);
        await sideRow('qa-g1').waitFor({ timeout: 5000 });
        assert.equal(await page.locator('.aad-chan:not([hidden]), .aad-side .ch-chan-tabs, .aad-side .ch-chan-h').filter({ visible: true }).count(), 0, 'switch off: no pane');
        assert.equal(await page.locator('.aad-chan-line').count(), 0, 'switch off: no channel line');
        entry.afterOff = await page.locator('.aad-scroll .aad-rw').filter({ visible: true }).evaluateAll(b => b.map(x => x.dataset.sid));
        assert.ok(entry.afterOff.includes('qa-g1') && entry.afterOff.includes('qa-v1'), 'switch off: the whole list, not the Voice channel: ' + entry.afterOff);
        await page.screenshot({ path: path.join(out, stem + '-switched-off-in-feed.png') });
        assert.equal(entry.errors.length, 0, 'browser errors: ' + entry.errors.join('; '));
        entry.pass = true;
      } catch (e) { entry.failure = e.stack; const pages = context.pages(); if (pages[0]) await pages[0].screenshot({ path: path.join(out, stem + '-failure.png') }).catch(() => {}); }
      finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await context.close(); }
    }
  } finally { await browser.close(); }
  const failed = report.cases.filter(c => !c.pass);
  console.log(JSON.stringify({ cases: report.cases.length, passed: report.cases.length - failed.length, failed: failed.map(c => c.stem + ': ' + String(c.failure).split('\n').slice(0, 2).join(' | ')), screenshots: fs.readdirSync(out).filter(f => f.endsWith('.png')).length }));
  if (failed.length || report.cases.length !== SKINS.length * 2) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
