'use strict';
// wizard-ux issue 1564 in a real browser, frame by frame: going back out of a thread (Back button and a real swipe
// right; thread opened from Activity and from a channel feed; the list scrolled part way) is one horizontal slide only.
// James, 18 Nov 2026: "not smooth on going back from a thread. It glitches and does like a vertical movement where the
// chats look like they slide down from the top momentarily". Phone 412x915, Nebula + Grove, in the phone browser and
// in the Android app's document-scrolled thread (`WizardOS-DocScroll` user agent; QA_SHELLS=phone,phone-doc).
// A requestAnimationFrame sampler reads, every frame from the release / tap on: the page's own scroll, the restored
// list's scrollTop, the header's and a tracked row's top edge, and any translateY on them or their ancestors. Every
// frame the list is on screen must show it exactly where it was left: no vertical move, no scroll jump.
// QA_EXPECT=broken (with QA_WEB=<main>/web) asserts the jump instead, as the baseline. QA_SWITCH=off: the switch-off
// path (no slide) also keeps the list still. Synthetic transport only; real CDP touches.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = 'https://chat-back-vertical.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'chat-back-vertical-evidence');
const broken = process.env.QA_EXPECT === 'broken', off = process.env.QA_SWITCH === 'off';
const shells = (process.env.QA_SHELLS || 'phone,phone-doc').split(','), skins = (process.env.QA_SKINS || 'nebula,grove').split(',');
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
// A real-sized list: 40 chats in Activity, 30 of them in the one channel, so both lists scroll.
const ROWS = Array.from({ length: 40 }, (_, i) => ({ id: 'qa-r' + i, title: 'Chat number ' + i, at: now - 6e5 - i * 9e5 }))
  .map(s => ({ id: s.id, title: s.title, runtime: 'direct', status: 'completed', updated_at: iso(s.at), updatedAt: iso(s.at), last_active: s.at / 1000, message_count: 2, messageCount: 2, preview: 'Done.' }));
const SPACES = [{ id: 'apps', name: 'WizardOS Apps', agent: 'hermes', threads: ROWS.slice(0, 30).map(r => r.id), createdAt: iso(now - 9e8) }];
// A long thread, so the Android app's document scroll sits far down when Back runs.
const LONG = Array.from({ length: 30 }, (_, i) => [{ role: 'user', content: 'Question ' + i + ' ' + 'about the plan '.repeat(4), timestamp: now / 1000 - 6000 + i * 60 },
  { role: 'assistant', content: 'Answer ' + i + '. ' + 'Here is a longer reply that wraps over a few lines. '.repeat(3), timestamp: now / 1000 - 5990 + i * 60 }]).flat();
(async () => {
  const browser = await chromium.launch(), report = [];
  try {
    for (const shell of shells) for (const skin of skins) {
      const doc = shell === 'phone-doc';
      const ua = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' + (doc ? ' WizardOS-DocScroll' : '');
      const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block', userAgent: ua });
      const errors = [], steps = {};
      try {
        await context.routeWebSocket('**/*', w => w.close());
        await context.addInitScript(({ skin, spaces, off }) => {
          if (window !== top) return;
          const mix = off ? {} : { 'wizard/chat-channels': true };
          for (const [k, v] of Object.entries({ 'wos.shell': 'phone', 'wux.shell': 'phone', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
            'wos.chats.spaces.v1': JSON.stringify(spaces), 'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v);
          // The sampler: the visible list's place on screen, every frame.
          window.__frames = [];
          const ty = n => { let y = 0; for (; n && n !== document.documentElement; n = n.parentElement) { const t = getComputedStyle(n).transform; if (t && t !== 'none') y += new DOMMatrixReadOnly(t).m42; } return Math.round(y * 10) / 10; };
          const tick = () => {
            if (window.__sample) {
              const list = [...document.querySelectorAll('.ch-list:not(.ch-side)')].find(n => n.getClientRects().length && !n.closest('[hidden]'));
              const thread = [...document.querySelectorAll('[data-part="thread"]')].some(n => n.getClientRects().length && n.getBoundingClientRect().right > 0 && n.getBoundingClientRect().left < innerWidth);
              const f = { t: performance.now(), doc: Math.round(document.scrollingElement.scrollTop), thread, list: null };
              if (list && !thread) {
                const sc = list.querySelector(':scope > .ch-scroll'), head = list.querySelector('.ch-head, .ch-chan-h, .ch-chan-tabs');
                const row = window.__track && list.querySelector(`[data-chopen="${window.__track}"]`);
                f.list = { top: Math.round(sc?.scrollTop ?? -1), head: head ? Math.round(head.getBoundingClientRect().top) : null, row: row ? Math.round(row.getBoundingClientRect().top) : null, ty: ty(row || sc || list), x: Math.round(list.getBoundingClientRect().left) };
              }
              window.__frames.push(f);
            }
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
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
            return r.fulfill({ json: m[2] ? { messages: LONG } : { session: s } }); }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
        await page.goto(origin + prefix + 'index.html?phone');
        await page.waitForFunction(() => window.__wos && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        if (!off) await page.waitForFunction(() => true, null, { timeout: 15000 });
        await page.evaluate(() => __wos.openSheet('inbox'));
        await nap(800);
        const vis = sel => page.locator(sel).filter({ visible: true }).first();
        const cdp = await context.newCDPSession(page);
        const swipe = async (x, y, dx, ms = 260) => {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
          for (let i = 1; i <= 12; i++) { await nap(ms / 12); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * i / 12, y }] }); }
          await page.evaluate(() => { window.__release = performance.now(); });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        };
        // Scroll the visible list part way and note where a row in the middle of the screen sits.
        const scrollList = async px => { // a real wheel scroll over the list, so the list's own scroll handlers see it
          await page.mouse.move(200, 520);
          for (let left = px; left > 0; left -= 100) { await page.mouse.wheel(0, Math.min(100, left)); await nap(60); }
        };
        const rest = () => page.evaluate(() => {
          const list = [...document.querySelectorAll('.ch-list:not(.ch-side)')].find(n => n.getClientRects().length);
          const sc = list.querySelector(':scope > .ch-scroll'), edge = sc.getBoundingClientRect();
          const row = [...sc.querySelectorAll('[data-chopen]')].find(r => r.getBoundingClientRect().top > edge.top + 200);
          const head = list.querySelector('.ch-head, .ch-chan-h, .ch-chan-tabs');
          return { id: row.dataset.chopen, top: Math.round(sc.scrollTop), row: Math.round(row.getBoundingClientRect().top), head: head ? Math.round(head.getBoundingClientRect().top) : null };
        });
        // One back step out of a thread opened from the list as it is now; returns the sampled frames after release.
        const backFrom = async (how) => {
          const was = await rest();
          await vis(`.ch-list [data-chopen="${was.id}"]`).click(); await nap(1400);
          // The Android app's thread scrolls the page itself: read down the thread as James would.
          await page.evaluate(() => { const se = document.scrollingElement; se.scrollTop = se.scrollHeight; });
          await nap(300);
          const docAt = await page.evaluate(() => document.scrollingElement.scrollTop);
          await page.evaluate(id => { window.__track = id; window.__frames = []; window.__sample = true; window.__release = performance.now(); }, was.id);
          if (how === 'button') await vis('[data-part="thread"] [data-chback]').click();
          else await swipe(120, 500, 230);
          await nap(900);
          const fr = await page.evaluate(() => { window.__sample = false; return window.__frames.filter(f => f.t >= window.__release); });
          const shown = fr.filter(f => f.list);
          // Every frame the restored list shows: no page scroll, no translateY, and the list's scroll, header and tracked
          // row exactly where its first frame put them (the row may sit elsewhere than before the thread: it was just
          // read). The list keeps its place: never back at its top.
          const f0 = shown[0]?.list || {};
          const bad = shown.filter(f => f.doc !== 0 || f.list.ty !== 0 || f.list.top !== f0.top || f.list.row !== f0.row || f.list.head !== f0.head || (was.top > 50 && f.list.top < 50) || (was.head !== null && Math.abs(f.list.head - was.head) > 4));
          return { was, docAt, frames: shown.length, bad: bad.length, first: shown.slice(0, 4).map(f => ({ ...f.list, doc: f.doc })), worst: bad.slice(0, 4).map(f => ({ ...f.list, doc: f.doc })), slid: shown.some(f => f.list.x < -10), end: shown.at(-1)?.list };
        };
        // 1. Activity (the default page with Channels on; the plain list with the switch off), scrolled part way.
        if (!off) { await vis('[data-chview="activity"]').click(); await nap(400); }
        await scrollList(600); await nap(300);
        steps.activityButton = await backFrom('button'); await nap(400);
        steps.activitySwipe = await backFrom('swipe'); await nap(400);
        if (!off) {
          // 2. A channel's feed, scrolled part way.
          await vis('[data-chview="channels"]').click(); await nap(300);
          await vis('.ch-chan-open[data-chchan="apps"]').click(); await nap(900);
          await scrollList(500); await nap(300);
          steps.feedButton = await backFrom('button'); await nap(400);
          steps.feedSwipe = await backFrom('swipe'); await nap(400);
        }
        await page.screenshot({ path: path.join(out, `${shell}-${skin}${off ? '-off' : ''}-after-back${broken ? '-before' : ''}.png`) });
        report.push({ shell, skin, off, steps, errors });
        for (const [k, s] of Object.entries(steps)) {
          assert.ok(s.frames > 3, `${shell} ${skin} ${k}: the list was sampled ${JSON.stringify(s)}`);
          if (broken) continue;
          assert.equal(s.bad, 0, `${shell} ${skin} ${k}: the list never moves vertically or jumps scroll ${JSON.stringify(s)}`);
          if (!off) assert.ok(s.slid, `${shell} ${skin} ${k}: the list still slides in from the left ${JSON.stringify(s.first)}`);
        }
        // Main: the phone browser was already still; the Android app's document-scrolled thread dropped the list in.
        if (broken && doc && !off) assert.ok(Object.values(steps).every(s => s.bad > 0), `${shell} ${skin}: main shows the vertical jump ${JSON.stringify(steps)}`);
        assert.deepEqual(errors, [], `${shell} ${skin}: no page errors`);
      } finally { if (!report.some(r => r.skin === skin && r.shell === shell)) report.push({ shell, skin, off, steps, errors, unfinished: true }); await context.close(); }
    }
  } finally { await browser.close(); fs.writeFileSync(path.join(out, `report${off ? '-off' : ''}${broken ? '-before' : ''}.json`), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); }
})().catch(e => { console.error(e); process.exit(1); });
