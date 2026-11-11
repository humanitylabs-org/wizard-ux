'use strict';
// Channel posts stay in posting order (wizard/chat-channels, wizard-ux issue 1289, James: "Posts should appear in the
// order they were posted ... the paradigm here is threads on Slack"), in a real browser on a disposable synthetic
// transport (no box reads or writes). Phone 412x915 (the phone feed) and desktop 1440x900 AI apps (the main-column
// feed), Nebula + Grove. # Launch holds four posts started 4, 3, 2 and 1 hours ago; the OLDEST one just got a reply,
// so its latest activity is the newest of all. The feed must still list them oldest post first, with that post's reply
// line showing the new reply count and time.
// QA_EXPECT=broken (with QA_WEB=<main>/web) asserts the old behaviour instead: the replied post sits at the bottom.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://chat-channel-posting-order.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'chat-channel-posting-order-evidence');
const broken = process.env.QA_EXPECT === 'broken';
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms)), M = 6e4, H = 36e5;
const POSTS = [
  { id: 'qa-o0', ask: 'Draft the launch email for Friday', started: now - 4 * H, last: now - 1 * M, replies: 2 },
  { id: 'qa-o1', ask: 'Check the press list', started: now - 3 * H, last: now - 3 * H + 2 * M, replies: 1 },
  { id: 'qa-o2', ask: 'Book the photographer', started: now - 2 * H, last: now - 2 * H + 2 * M, replies: 1 },
  { id: 'qa-o3', ask: 'Order the banners', started: now - 1 * H, last: now - 1 * H + 2 * M, replies: 1 },
];
const POSTED = POSTS.map(p => p.id), BY_ACTIVITY = [...POSTS].sort((a, b) => a.last - b.last).map(p => p.id);
const SPACES = [{ id: 'launch', name: 'Launch', agent: 'hermes', threads: POSTED, createdAt: iso(now - 9e8) }];
const ROWS = POSTS.map(p => ({ id: p.id, title: p.ask, runtime: 'direct', status: 'completed', started_at: p.started / 1000, updated_at: iso(p.last), last_active: p.last / 1000,
  wizard_last_assistant_at: p.last / 1000, message_count: 2 * p.replies, archived: false, preview: 'Done.' }));
const history = p => {
  const rows = [{ role: 'user', content: p.ask, timestamp: p.started / 1000 }, { role: 'assistant', content: 'On it.', timestamp: p.started / 1000 + 60 }];
  if (p.replies > 1) rows.push({ role: 'user', content: 'Add the venue', timestamp: p.last / 1000 - 60 }, { role: 'assistant', content: 'Added.', timestamp: p.last / 1000 });
  return rows;
};
const report = { origin, web, expect: broken ? 'broken' : 'fixed', cases: [] };
(async () => {
  const browser = await chromium.launch();
  try {
    for (const shell of ['phone', 'desktop']) for (const skin of ['nebula', 'grove']) {
      const phone = shell === 'phone', stem = `${phone ? 'phone' : 'ai-apps'}-${skin}`;
      const entry = { stem, errors: [], refused: [] }; report.cases.push(entry);
      const context = await browser.newContext({ viewport: phone ? { width: 412, height: 915 } : { width: 1440, height: 900 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', ...(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' } : {}) });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        const mix = { 'wizard/desktop-chats': true, 'wizard/chat-channels': true };
        await context.addInitScript(({ phone, skin, mix, spaces }) => {
          if (window !== top) return;
          for (const [k, v] of Object.entries({ 'wos.shell': phone ? 'phone' : 'desktop', 'wux.shell': phone ? 'phone' : 'desktop', 'wos.desktop-view.v1': phone ? 'classic' : 'ai-apps', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
            'wos.chats.view.v1': 'channels', 'wos.chats.spaces.v1': JSON.stringify(spaces), 'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v);
        }, { phone, skin, mix, spaces: SPACES });
        const prefs = { migrations: { 'launcher-seed-v1': true }, spaces: structuredClone(SPACES) };
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
          if (u.origin !== origin) { entry.refused.push({ method, url: q.url(), reason: 'external' }); return r.abort(); }
          if (!['GET', 'HEAD'].includes(method)) {
            if (method === 'PUT' && p === '/wizard/thread-seen') return r.fulfill({ json: { ok: true, state: q.postDataJSON() } });
            entry.refused.push({ method, path: p, reason: 'unexpected-write' }); return r.fulfill({ status: 405, json: { error: 'Synthetic fixture refuses this write' } });
          }
          if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
          if (p.startsWith(prefix)) {
            const f = decodeURIComponent(p.slice(prefix.length) || 'index.html'), abs = path.resolve(web, f);
            if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
            if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return r.fulfill({ path: abs });
            return r.fulfill({ status: 404, body: 'No synthetic static asset' });
          }
          if (p === '/wizard/thread-seen') return r.fulfill({ json: { state: { initializedAt: 1, threads: {} } } });
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: prefs });
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: ROWS, has_more: false } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) { const i = POSTED.indexOf(decodeURIComponent(m[1])); if (i < 0) return r.fulfill({ status: 404, json: { error: 'missing' } });
            return r.fulfill({ json: m[2] ? { messages: history(POSTS[i]) } : { session: ROWS[i] } }); }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
        await page.waitForFunction(() => (window.__wux || window.__wos) && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        await page.waitForFunction(() => (document.documentElement.dataset.tweaks || '').split(' ').includes('wizard/chat-channels'), null, { timeout: 15000 });
        const vis = sel => page.locator(sel).filter({ visible: true }).first();
        let feed;
        if (phone) {
          await page.evaluate(() => __wos.openSheet('inbox'));
          await vis('.ch-chan-open[data-chchan="launch"]').click();
          feed = '.ch-chan-feed';
        } else {
          await page.waitForFunction(() => document.documentElement.dataset.layout === 'ai-apps', null, { timeout: 15000 });
          await vis('.aad-chan [data-chview="channels"]').click();
          await vis('.aad-chan .ch-chan-open[data-chchan="launch"]').click();
          feed = '.aad-feed .ch-chan-feed';
        }
        await vis(`${feed} .ch-post-b`).waitFor();
        // Every post's words and reply line read in.
        await page.waitForFunction(f => { const n = [...document.querySelectorAll(f + ' .ch-post')].filter(x => x.offsetParent); return n.length === 4 && n.every(x => x.querySelector('.ch-post-t') && /repl/.test(x.querySelector('.ch-post-r')?.textContent || '')); }, feed, { timeout: 15000 });
        await page.evaluate(() => document.fonts.ready); await nap(500);
        const posts = await page.locator(`${feed} .ch-post`).filter({ visible: true }).evaluateAll(n => n.map(x => ({ id: x.dataset.morphKey.slice(5), words: x.querySelector('.ch-post-t')?.textContent || '', head: x.querySelector('.ch-post-h time')?.textContent || '', replies: x.querySelector('.ch-post-r')?.textContent.trim() || '' })));
        entry.order = posts.map(p => p.id); entry.posts = posts;
        await page.screenshot({ path: path.join(out, stem + (broken ? '-before' : '-after') + '.png') });
        if (broken) assert.deepEqual(entry.order, BY_ACTIVITY, stem + ': main moves the replied post to the bottom');
        else {
          assert.deepEqual(entry.order, POSTED, stem + ': posting order, oldest post first');
          const first = posts[0];
          assert.equal(first.words, POSTS[0].ask);
          assert.match(first.replies, /^2 replies/, stem + ': the reply line counts the new reply');
          assert.match(first.head, /4h|4 h/, stem + ': the header keeps the post\'s own time');
        }
        assert.deepEqual(entry.errors, []); assert.deepEqual(entry.refused, []);
        entry.pass = true;
      } catch (e) { entry.error = e.stack || String(e); throw e; } finally { await context.close(); }
    }
  } finally {
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close();
  }
  console.log(JSON.stringify(report.cases.map(c => ({ stem: c.stem, order: c.order, first: c.posts?.[0], pass: !!c.pass }))));
})().catch(e => { console.error(e); process.exit(1); });
