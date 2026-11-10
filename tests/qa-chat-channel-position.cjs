'use strict';
// Where a long channel opens (wizard/chat-channels, wizard-ux issue 1263), in a real browser on a disposable synthetic
// transport (no box reads or writes). Phone 390x844 + desktop 1440x960, Nebula + Grove. A 120-post # Launch channel
// whose first messages load slowly (0.2–3 s each, so the feed keeps growing after it opens):
//  - everything read: it opens at the very bottom (the newest post above the message box) and stays there for 5 s;
//  - unread posts: it opens at the first unread post under a "New" line, and that post stays put for 5 s;
//  - scrolled up, a thread opened from the feed and Back: the same post is back where it was;
//  - switch off: no "New" line anywhere.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://chat-channel-position.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'chat-channel-position-evidence');
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const N = 120, ids = Array.from({ length: N }, (_, i) => 'qa-p' + String(i).padStart(3, '0'));
const SPACES = [{ id: 'launch', name: 'Launch', agent: 'hermes', threads: ids, createdAt: iso(now - 9e8) }];
// Oldest first: qa-p000 is 120 × 40 min old, qa-p119 the newest.
const ROWS = ids.map((id, i) => { const at = now - (N - i) * 40 * 6e4; return { id, title: 'Post ' + i, runtime: 'direct', status: 'completed', updated_at: iso(at), updatedAt: iso(at), last_active: at / 1000, message_count: 2, messageCount: 2, archived: false, preview: 'Reply ' + i }; });
const FIRST_UNREAD = 104; // qa-p104 … qa-p119 are unread in the "unread" case
const words = i => `Post ${i}: ` + 'the launch plan needs a look, here is what changed and what is still open. '.repeat(1 + (i * 7) % 5);
const PNG = fs.readFileSync(path.join(repo, 'web', 'robert-thread-orb.png'));
const report = { origin, web, cases: [] };
(async () => {
  const browser = await chromium.launch();
  try {
    for (const shell of ['phone', 'desktop']) for (const skin of ['nebula', 'grove']) for (const mode of ['read', 'unread', 'off']) {
      const phone = shell === 'phone', on = mode !== 'off', stem = `${shell}-${skin}-${mode}`;
      const entry = { stem, errors: [], refused: [] }; report.cases.push(entry);
      const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 960 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', ...(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' } : {}) });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        const mix = { 'wizard/desktop-chats': true, ...(on ? { 'wizard/chat-channels': true } : {}) };
        await context.addInitScript(({ shell, skin, mix, spaces }) => {
          if (window !== top) return;
          for (const [k, v] of Object.entries({ 'wos.shell': shell, 'wos.desktop-view.v1': 'classic', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
            'wos.chats.view.v1': 'channels', 'wos.chats.spaces.v1': JSON.stringify(spaces), 'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v);
        }, { shell, skin, mix, spaces: SPACES });
        const prefs = { migrations: { 'launcher-seed-v1': true }, spaces: structuredClone(SPACES) };
        const readUpTo = mode === 'unread' ? FIRST_UNREAD : N;
        let seen = { initializedAt: 1, threads: Object.fromEntries(ROWS.slice(0, readUpTo).map(s => ["direct:" + s.id, { messageCount: 2, status: 'completed', updatedAt: s.updatedAt, seenAt: now }])) };
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
          if (u.origin !== origin) { entry.refused.push({ method, url: q.url(), reason: 'external' }); return r.abort(); }
          if (!['GET', 'HEAD'].includes(method)) {
            if (method === 'PUT' && p === '/wizard/thread-seen') { seen = q.postDataJSON() || seen; return r.fulfill({ json: { ok: true, state: seen } }); }
            entry.refused.push({ method, path: p, reason: 'unexpected-write' }); return r.fulfill({ status: 405, json: { error: 'Synthetic fixture refuses this write' } });
          }
          if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
          if (p.startsWith(prefix)) {
            const f = decodeURIComponent(p.slice(prefix.length) || 'index.html'), abs = path.resolve(web, f);
            if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
            if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return r.fulfill({ path: abs });
            return r.fulfill({ status: 404, body: 'No synthetic static asset' });
          }
          if (p === '/wizard/thread-seen') return r.fulfill({ json: { state: seen } });
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: prefs });
          if (/^\/wizard\/files\/qa-img-\d+\/content$/.test(p)) { await nap(400 + Math.random() * 1500); return r.fulfill({ body: PNG, contentType: 'image/png' }); }
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: ROWS, has_more: false } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) { const i = ids.indexOf(decodeURIComponent(m[1])), s = ROWS[i]; if (!s) return r.fulfill({ status: 404, json: { error: 'missing' } });
            if (m[2]) await nap(200 + Math.random() * 2800); // first messages fill in late
            const chip = i % 9 === 0 ? `\n\n[WIZARD_FILE_CHIPS_V1][{"id":"qa-img-${i}","filename":"board.png","mime":"image/png"}][/WIZARD_FILE_CHIPS_V1]` : '';
            return r.fulfill({ json: m[2] ? { messages: [{ role: 'user', content: words(i) + chip, timestamp: Date.parse(s.updatedAt) / 1000 - 60 }, { role: 'assistant', content: s.preview, timestamp: Date.parse(s.updatedAt) / 1000 }] } : { session: s } }); }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
        await page.waitForFunction(() => (window.__wux || window.__wos) && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        if (on) await page.waitForFunction(() => (document.documentElement.dataset.tweaks || '').split(' ').includes('wizard/chat-channels'), null, { timeout: 15000 }).catch(() => {});
        await page.evaluate(phone => phone ? __wos.openSheet('inbox') : __wux.openChatsList(), phone);
        const vis = sel => page.locator(sel).filter({ visible: true }).first();
        if (!on) {
          await vis('.ch-list [data-chopen]').waitFor();
          entry.newLines = await page.locator('.ch-chan-new').count();
          assert.equal(entry.newLines, 0, 'switch off: no New line');
          assert.equal(await page.locator('.ch-chan-tabs').count(), 0, 'switch off: no Channels tabs');
          await page.screenshot({ path: path.join(out, stem + '.png') }); entry.pass = true; continue;
        }
        await page.evaluate(() => document.fonts.ready);
        await vis('.ch-chan-open[data-chchan="launch"]').click();
        await vis('.ch-chan-h').waitFor();
        // The feed's scroller and the place of a post in it, sampled every 100 ms for 5 s of lazy fill-in.
        const probe = () => page.evaluate(({ first }) => {
          const sc = [...document.querySelectorAll('.ch-list > .ch-scroll')].find(e => e.getClientRects().length && e.querySelector('.ch-chan-feed'));
          if (!sc) return null;
          const edge = sc.getBoundingClientRect().top, post = sc.querySelector(`[data-morph-key="post:${first}"]`), line = sc.querySelector('.ch-chan-new');
          return { top: Math.round(sc.scrollTop), gap: Math.round(sc.scrollHeight - sc.scrollTop - sc.clientHeight), h: sc.scrollHeight, client: sc.clientHeight,
            postY: post ? Math.round(post.getBoundingClientRect().top - edge) : null, lineY: line ? Math.round(line.getBoundingClientRect().top - edge) : null,
            lineNext: line?.nextElementSibling?.dataset.morphKey || null, lines: sc.querySelectorAll('.ch-chan-new').length, posts: sc.querySelectorAll('.ch-post').length,
            waiting: sc.querySelectorAll('.ch-post-wait').length, bar: (b => b && getComputedStyle(b).position === 'sticky' ? Math.round(b.getBoundingClientRect().bottom - edge) : 0)(sc.querySelector('.ch-chan-feed')?.firstElementChild) };
        }, { first: ids[FIRST_UNREAD] });
        const samples = []; for (let t = 0; t < 50; t++) { samples.push(await probe()); await nap(100); }
        entry.first = samples[2]; entry.last = samples.at(-1);
        entry.grewBy = entry.last.h - samples[2].h; entry.waitingAtStart = samples[2].waiting;
        const settled = samples.slice(3);
        if (mode === 'read') {
          entry.maxGap = Math.max(...settled.map(s => s.gap));
          assert.ok(entry.maxGap <= 2, `${stem}: stays at the very bottom while posts fill in (max gap ${entry.maxGap}px)`);
          assert.equal(entry.last.lines, 0, 'all read: no New line');
        } else {
          assert.equal(entry.last.lines, 1, 'one New line');
          assert.equal(entry.last.lineNext, 'post:' + ids[FIRST_UNREAD], 'the New line sits directly above the first unread post');
          const ys = settled.map(s => s.lineY);
          entry.lineYs = [Math.min(...ys), Math.max(...ys)];
          assert.ok(entry.lineYs[1] - entry.lineYs[0] <= 2, `${stem}: the first unread holds its place while posts fill in (${entry.lineYs})`);
          assert.ok(entry.lineYs[0] >= entry.last.bar && entry.lineYs[1] < entry.last.client / 2, `${stem}: the New line is near the top of the view, below the sticky filter bar (${entry.lineYs}, bar ${entry.last.bar})`);
        }
        await page.screenshot({ path: path.join(out, stem + '-open.png') });
        // Scroll up a bit, open a thread from the feed, then Back: the same post is where it was.
        await page.mouse.move(phone ? 195 : 400, 400);
        const sc = '.ch-list > .ch-scroll';
        await page.locator(sc).filter({ visible: true }).first().evaluate(e => e.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -600 })));
        await page.locator(sc).filter({ visible: true }).first().evaluate(e => { e.scrollTop -= 600; });
        await nap(600);
        const pick = await page.evaluate(() => {
          const sc = [...document.querySelectorAll('.ch-list > .ch-scroll')].find(e => e.getClientRects().length && e.querySelector('.ch-chan-feed'));
          const edge = sc.getBoundingClientRect().top + 60, post = [...sc.querySelectorAll('.ch-post[data-morph-key]')].find(p => p.getBoundingClientRect().top >= edge);
          return { key: post.dataset.morphKey, y: Math.round(post.getBoundingClientRect().top - sc.getBoundingClientRect().top) };
        });
        entry.picked = pick;
        await vis(`.ch-post-b[data-chopen="${pick.key.slice(5)}"]`).click();
        await page.waitForFunction(() => document.querySelector('.ch-msgs') && [...document.querySelectorAll('.ch-msgs')].some(e => e.getClientRects().length), null, { timeout: 8000 });
        await nap(500);
        await page.evaluate(() => window.__wos ? __wos.onBack() : __wux.escStep());
        await vis('.ch-chan-h').waitFor(); await nap(1500);
        entry.backY = await page.evaluate(key => {
          const sc = [...document.querySelectorAll('.ch-list > .ch-scroll')].find(e => e.getClientRects().length && e.querySelector('.ch-chan-feed'));
          const post = sc?.querySelector(`[data-morph-key="${key}"]`); return post ? Math.round(post.getBoundingClientRect().top - sc.getBoundingClientRect().top) : null;
        }, pick.key);
        assert.ok(entry.backY != null && Math.abs(entry.backY - pick.y) <= 3, `${stem}: Back from a thread returns to the same place (${pick.y} → ${entry.backY})`);
        await page.screenshot({ path: path.join(out, stem + '-back.png') });
        assert.deepEqual(entry.errors, [], 'no page errors');
        assert.deepEqual(entry.refused, [], 'no unexpected requests');
        entry.pass = true;
      } catch (e) { entry.pass = false; entry.failure = String(e.message || e).slice(0, 600); }
      finally { await context.close(); }
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
  for (const c of report.cases) console.log(c.pass ? 'PASS' : 'FAIL', c.stem, c.failure || '', JSON.stringify({ first: c.first, last: c.last, maxGap: c.maxGap, lineYs: c.lineYs, bar: c.last?.bar, picked: c.picked, backY: c.backY }));
  process.exit(report.cases.every(c => c.pass) ? 0 : 1);
})();
