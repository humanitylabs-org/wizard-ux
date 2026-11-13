'use strict';
// wizard-ux issue 1440 in a real browser: inside a channel (# Philosophy) there is no Open / Needs you / All row; the
// feed lists every post and the thread's own jump pills (issue 1359) point at posts that need you (amber) or have
// unread replies (green). From the end: "↑ 1 Needs you 2 New"; a tap lands on the amber post first, below the pill
// (never under it), then the nearest green; the pill goes once none are left above (the last one peeks in on screen); at the top a "↓" pill points at
// the amber post below. Opening a green post (its unread clears) drops the count when Back returns to the feed.
// Phone 412x915 (Chats list) and desktop 1440x900 (Classic Chats window and the AI apps feed column), Nebula + Grove, Channels on.
// Synthetic transport only; writes are answered in memory. QA_WEB=<main>/web QA_EXPECT=broken runs the baseline
// (the filter row is there and no pill shows). QA_OUT=<dir> keeps the screenshots.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = 'https://chat-feed-jump.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'feed-jump-evidence');
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const N = 22, ids = Array.from({ length: N }, (_, i) => 'qa-p' + i);
const SPACES = [{ id: 'philo', name: 'Philosophy', agent: 'hermes', threads: ids, createdAt: iso(now - 9e8) }];
// p1, p2: unread replies (green); p6: needs you (amber, read); p20: needs you near the end; the rest read.
const GREEN = new Set(['qa-p1', 'qa-p2']), AMBER = { 'qa-p6': 'Pick a reading', 'qa-p20': 'Which essay first?' };
const at = i => now - (N - i) * 3 * 36e5;
const ROWS = ids.map((id, i) => ({ id, title: 'Question ' + i, runtime: 'direct', status: 'completed', started_at: iso(at(i) - 6e5), updated_at: iso(at(i)), updatedAt: iso(at(i)), last_assistant_at: iso(at(i)),
  last_active: at(i) / 1000, message_count: 2, messageCount: 2, archived: false, preview: 'An answer about question ' + i + '.', ...(AMBER[id] ? { wizard_attention: { state: 'needs_you', ask: AMBER[id] } } : {}) }));
const SEEN = { initializedAt: 1, threads: Object.fromEntries(ROWS.map(s => ['direct:' + s.id, GREEN.has(s.id)
  ? { messageCount: 1, status: 'completed', updatedAt: iso(Date.parse(s.updated_at) - 36e5), assistantActivityAt: iso(Date.parse(s.updated_at) - 36e5), seenAt: Date.parse(s.updated_at) - 36e5 }
  : { messageCount: 2, status: 'completed', updatedAt: s.updated_at, assistantActivityAt: s.updated_at, seenAt: now }])) };
const ask = i => `Question ${i}: what would a careful reader of the Stoics say about attention, and how does that change the way we plan a week? Keep it short.`;
const cases = (process.env.QA_CASES || 'phone,classic,ai-apps').split(','), expectBroken = process.env.QA_EXPECT === 'broken';
(async () => {
  const browser = await chromium.launch(), report = [];
  try {
    for (const shell of cases) for (const skin of ['nebula', 'grove']) {
      const phone = shell === 'phone', ai = shell === 'ai-apps', R = ai ? '.aad-feed ' : '', stem = `${shell}-${skin}`, entry = { stem, errors: [], writes: [], steps: [] }; report.push(entry);
      const context = await browser.newContext({ viewport: phone ? { width: 412, height: 915 } : { width: 1440, height: 900 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', reducedMotion: 'reduce',
        ...(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' } : {}) });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        const mix = { 'wizard/desktop-chats': true, 'wizard/chat-channels': true };
        await context.addInitScript(({ phone, ai, skin, mix, spaces }) => {
          if (window !== top) return;
          for (const [k, v] of Object.entries({ 'wos.shell': phone ? 'phone' : 'desktop', 'wos.desktop-view.v1': ai ? 'ai-apps' : 'classic', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
            'wos.chats.spaces.v1': JSON.stringify(spaces), 'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v);
        }, { phone, ai, skin, mix, spaces: SPACES });
        const prefs = { migrations: { 'launcher-seed-v1': true }, spaces: structuredClone(SPACES) };
        let seen = structuredClone(SEEN);
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), p = u.pathname, method = q.method();
          if (u.origin !== origin) return r.abort();
          if (!['GET', 'HEAD'].includes(method)) {
            entry.writes.push(method + ' ' + p);
            if (method === 'PUT' && p === '/wizard/thread-seen') { const next = q.postDataJSON(); seen = next?.threads ? next : seen; return r.fulfill({ json: { ok: true, state: seen } }); }
            return r.fulfill({ json: p === '/wizard/v1/ui-preferences' ? prefs : { ok: true } });
          }
          if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
          if (p.startsWith(prefix)) {
            const abs = path.resolve(web, decodeURIComponent(p.slice(prefix.length) || 'index.html'));
            if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
            return fs.existsSync(abs) && fs.statSync(abs).isFile() ? r.fulfill({ path: abs }) : r.fulfill({ status: 404, body: 'none' });
          }
          if (p === '/wizard/thread-seen') return r.fulfill({ json: { state: seen } });
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: prefs });
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: ROWS, has_more: false } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) { const i = ids.indexOf(decodeURIComponent(m[1])), s = ROWS[i]; if (!s) return r.fulfill({ status: 404, json: {} });
            return r.fulfill({ json: m[2] ? { messages: [{ role: 'user', content: ask(i), timestamp: at(i) / 1000 - 600 }, { role: 'assistant', content: s.preview, timestamp: at(i) / 1000 }] } : { session: s } }); }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
        await page.waitForFunction(() => (window.__wux || window.__wos) && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        await page.waitForFunction(() => (document.documentElement.dataset.tweaks || '').split(' ').includes('wizard/chat-channels'), null, { timeout: 15000 });
        if (ai) await page.waitForFunction(() => document.documentElement.dataset.layout === 'ai-apps', null, { timeout: 15000 });
        else await page.evaluate(phone => phone ? __wos.openSheet('inbox') : __wux.openChatsList(), phone);
        await page.evaluate(() => document.fonts.ready); await nap(600);
        const vis = sel => page.locator(sel).filter({ visible: true }).first();
        const S = ai ? '.aad-chan ' : '';
        await vis(S + '[data-chview="channels"]').click(); await vis(S + '[data-chchan="philo"]').click();
        await vis(R + '.ch-chan-feed [data-morph-key="post:qa-p21"]').waitFor(); await nap(1500);
        entry.filterRow = await page.locator(R + '[data-chchanf]').filter({ visible: true }).count();
        const pills = () => page.evaluate(R => Object.fromEntries(['up', 'down'].map(d => { const b = [...document.querySelectorAll(`${R}.ch-list [data-chjump="${d}"]`)].find(n => !n.hidden && n.getClientRects().length); return [d, b ? [...b.children].map(c => c.textContent.trim()).join(' ') : '']; })), R);
        const feedBox = async () => vis(R + '.ch-list > .ch-scroll').boundingBox();
        const wheel = async dy => { const b = await feedBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, dy / 6); await nap(40); } await nap(400); };
        const step = async (name, want) => { await nap(300); const got = await pills(); entry.steps.push({ name, got, want }); if (!expectBroken) assert.deepEqual(want.down === undefined ? { up: got.up } : got, want, `${stem}: ${name}`); };
        const tap = async dir => { await vis(`${R}.ch-list [data-chjump="${dir}"]`).click(); await nap(500); };
        // The landed post: whole below the ↑ pill when one is showing, and inside the feed's scroller.
        const landed = id => page.evaluate(([id, R]) => { const n = [...document.querySelectorAll(`${R}.ch-chan-feed [data-morph-key="post:${id}"]`)].find(x => x.getClientRects().length), sc = n.closest('.ch-scroll');
          const up = [...document.querySelectorAll(R + '.ch-list [data-chjump="up"]')].find(x => !x.hidden && x.getClientRects().length), r = n.getBoundingClientRect(), s = sc.getBoundingClientRect();
          return { top: Math.round(r.top - s.top), covered: !!up && up.getBoundingClientRect().bottom > r.top, inView: r.top >= s.top - 1 && r.top < s.bottom }; }, [id, R]);
        if (expectBroken) { await wheel(30000); entry.ok = !entry.filterRow && !!(await pills()).up; await page.screenshot({ path: path.join(out, `${stem}-baseline.png`) }); continue; }
        assert.equal(entry.filterRow, 0, `${stem}: no Open / Needs you / All row`);
        await wheel(30000); await step('at the end', { up: '↑ 1 Needs you 2 New', down: '' });
        await page.screenshot({ path: path.join(out, `${stem}-pill.png`) });
        await tap('up'); const a = await landed('qa-p6'); entry.steps.push({ name: 'landed on the amber post', got: a });
        assert.ok(a.inView && !a.covered, `${stem}: amber post lands in view, not under the pill ${JSON.stringify(a)}`);
        await step('after the amber (p20 below may show ↓)', { up: '↑ 2 New' });
        await page.screenshot({ path: path.join(out, `${stem}-landed.png`) });
        await tap('up'); const g = await landed('qa-p2'); entry.steps.push({ name: 'landed on the nearer green post', got: g });
        assert.ok(g.inView && !g.covered, `${stem}: green post lands in view, not under the pill ${JSON.stringify(g)}`);
        // p1 sits right above p2, so it peeks into the gap left for the pill: on screen, nothing is left above.
        await step('none left above', { up: '' });
        await wheel(-30000); await wheel(400);
        const top = await pills(); entry.steps.push({ name: 'near the top', got: top });
        assert.match(top.down, /^↓ [12] Needs you$/, `${stem}: the amber post below gets the ↓ pill`);
        await page.screenshot({ path: path.join(out, `${stem}-down-pill.png`) });
        // Opening a green post clears its unread: back on the feed the count has dropped.
        await vis(R + '.ch-chan-feed [data-morph-key="post:qa-p2"] .ch-post-b').click();
        await page.waitForFunction(() => [...document.querySelectorAll('.ch-msgs .msg.a')].some(n => n.getClientRects().length), null, { timeout: 15000 }); await nap(800);
        if (ai) await page.keyboard.press('Escape'); else await vis('.ch-thread .ch-back, .ch-thread [data-chback]').click().catch(async () => { await page.keyboard.press('Escape'); });
        await vis(R + '.ch-chan-feed').waitFor(); await nap(800);
        assert.equal(await page.locator(R + '.ch-chan-feed').filter({ visible: true }).count(), 1, `${stem}: Back stays in the channel`);
        await wheel(30000); await step('end after opening one green post', { up: '↑ 1 Needs you 1 New', down: '' });
        entry.ok = true;
        assert.equal(entry.writes.filter(w => !w.startsWith('PUT /wizard/thread-seen') && !w.startsWith('PUT /wizard/v1/channels/') ).length, 0, 'only seen marks are written: ' + entry.writes.join(', '));
        assert.deepEqual(entry.errors, []);
      } finally { await context.close(); }
    }
    if (expectBroken) assert.ok(report.every(e => !e.ok), 'baseline: expected the filter row and no pill');
  } finally {
    await browser.close(); fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    for (const e of report) console.log(e.stem, e.ok ? 'OK' : 'FAIL', JSON.stringify(e.steps));
  }
})().catch(e => { console.error(e); process.exit(1); });
