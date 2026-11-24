'use strict';
// wizard-ux issue 1548 in a real browser, frame by frame: phone 412x915 and a touch desktop 1280x800, Nebula + Grove,
// Channels on. Going back one layer (a real swipe right, the Back button, the shell's Back step) slides the previous
// view in from the left like the Channels/Activity page swipe: the leaving view never moves back toward rest before
// it goes, and the arriving view starts left of its place and only moves right until it rests. Opening a channel or a
// thread slides in from the right. A short swipe still eases back. QA_SWITCH=off: no slide anywhere (old behaviour).
// QA_EXPECT=broken (with QA_WEB=<main>/web) asserts the old snap-back instead, as the baseline. A requestAnimationFrame
// sampler reads every visible thread/list's computed transform each frame. Synthetic transport only; real CDP touches.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = 'https://chat-back-slide.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'chat-back-slide-evidence');
const broken = process.env.QA_EXPECT === 'broken', off = process.env.QA_SWITCH === 'off';
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const SPACES = [{ id: 'apps', name: 'WizardOS Apps', agent: 'hermes', threads: ['qa-a1'], createdAt: iso(now - 9e8) }];
const WIDE = 'Here is the config:\n\n```\n' + 'export WIZARD_SOME_VERY_LONG_SETTING_NAME=' + 'x'.repeat(220) + '\n```\n\nDone.';
const ROWS = [
  { id: 'qa-a1', title: 'App list', at: now - 36e5 },
  { id: 'qa-g1', title: 'Weekend plans', at: now - 6e5 },
  ...Array.from({ length: 14 }, (_, i) => ({ id: 'qa-f' + i, title: 'Filler chat ' + i, at: now - 72e5 - i * 6e5 })),
].map(s => ({ id: s.id, title: s.title, runtime: 'direct', status: 'completed', updated_at: iso(s.at), updatedAt: iso(s.at), last_active: s.at / 1000, message_count: 2, messageCount: 2, preview: 'Done.' }));
(async () => {
  const browser = await chromium.launch(), report = [];
  try {
    for (const [skin, dev] of [['nebula', 'phone'], ['grove', 'phone'], ['nebula', 'desktop'], ['grove', 'desktop']].filter(([, d]) => !process.env.QA_DEVS || process.env.QA_DEVS.split(',').includes(d))) {
      const phone = dev === 'phone';
      const context = await browser.newContext({ viewport: phone ? { width: 412, height: 915 } : { width: 1280, height: 800 }, isMobile: phone, hasTouch: true, serviceWorkers: 'block', ...(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' } : {}) });
      const errors = [], steps = {};
      try {
        await context.routeWebSocket('**/*', w => w.close());
        await context.addInitScript(({ skin, spaces, off, phone }) => {
          if (window !== top) return;
          const mix = off ? { 'wizard/desktop-chats': true } : { 'wizard/desktop-chats': true };
          for (const [k, v] of Object.entries({ 'wos.shell': phone ? 'phone' : 'desktop', 'wux.shell': phone ? 'phone' : 'desktop', 'wos.desktop-view.v1': 'classic', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
            'wos.chats.spaces.v1': JSON.stringify(spaces), 'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v);
          // The sampler: every frame, the x offset (computed transform) and opacity of each visible Chats view.
          const ids = new WeakMap(); let n = 0; window.__frames = [];
          const tick = () => {
            if (window.__sample) {
              const row = { t: performance.now(), v: [] };
              for (const el of document.querySelectorAll('[data-part="thread"], .ch-list:not(.ch-side), .ch-list:not(.ch-side) > .ch-scroll')) {
                if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') continue;
                if (!ids.has(el)) ids.set(el, ++n);
                // On-screen offset: the view's own transform plus its Chats container's (the slide moves the container).
                let x = 0, op = 1;
                for (let n = el; n && n !== document.body; n = n.parentElement) {
                  const cs = getComputedStyle(n); if (cs.transform && cs.transform !== 'none') x += new DOMMatrixReadOnly(cs.transform).m41; op *= Number(cs.opacity);
                  if (n.matches('[data-chats]')) break;
                }
                row.v.push({ id: ids.get(el), kind: el.dataset.part === 'thread' ? 'thread' : el.classList.contains('ch-scroll') ? 'body' : el.querySelector('[data-chchanback]') ? 'feed' : 'home', x: Math.round(x * 10) / 10, op });
              }
              window.__frames.push(row);
            }
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }, { skin, spaces: SPACES, off, phone });
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
            return r.fulfill({ json: m[2] ? { messages: [{ role: 'user', content: 'Ask for ' + s.title, timestamp: now / 1000 - 600 }, { role: 'assistant', content: s.id === 'qa-g1' ? WIDE : 'Done.', timestamp: now / 1000 - 590 }] } : { session: s } }); }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
        await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
        await page.waitForFunction(() => (window.__wux || window.__wos) && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        if (!off) await page.waitForFunction(() => true, null, { timeout: 15000 });
        await page.evaluate(phone => phone ? __wos.openSheet('inbox') : __wux.openChatsList(), phone);
        await nap(600);
        const vis = sel => page.locator(sel).filter({ visible: true }).first();
        const shot = n => page.screenshot({ path: path.join(out, `${dev}-${skin}${off ? '-off' : ''}-${n}${broken ? '-before' : ''}.png`) });
        const cdp = await context.newCDPSession(page);
        // A real finger: touchStart, 12 moves over `ms`, touchEnd.
        const swipe = async (x, y, dx, dy = 0, ms = 260, mark = false) => {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
          for (let i = 1; i <= 12; i++) { await nap(ms / 12); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * i / 12, y: y + dy * i / 12 }] }); }
          if (mark) await page.evaluate(() => { window.__release = performance.now(); });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          await nap(450);
        };
        const view = () => page.evaluate(() => document.querySelector('[data-chview][aria-pressed="true"]:not([hidden])')?.dataset.chview || null);
        const order = () => page.evaluate(() => [...document.querySelectorAll('.ch-chan-tabs [data-chview]')].filter(b => b.offsetParent).map(b => b.textContent.trim()));
        const where = () => page.evaluate(() => {
          const t = [...document.querySelectorAll('[data-part="thread"]')].some(n => n.offsetParent);
          const feed = [...document.querySelectorAll('[data-chchanback]')].some(n => n.offsetParent);
          const chats = [...document.querySelectorAll('.ch-list')].some(n => n.offsetParent);
          return t ? 'thread' : feed ? 'feed' : chats ? 'list' : 'gone';
        });
        const box = async sel => { const b = await vis(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
        const built = await page.evaluate(() => !!window.WosSkinHost?.env?.touch || matchMedia('(pointer: coarse)').matches);
        // Record frames around one step; returns the frames after `from` (release or tap time).
        const record = async (act) => {
          await page.evaluate(() => { window.__frames = []; window.__sample = true; window.__release = 0; });
          const t0 = await act();
          await nap(1200); // a slow host can take a moment to paint a thread
          return page.evaluate(t0 => { window.__sample = false; const r = window.__release || t0; return { before: window.__frames.filter(f => f.t < r), after: window.__frames.filter(f => f.t >= r) }; }, t0);
        };
        const tapAt = sel => async () => { const t = await page.evaluate(() => performance.now()); await vis(sel).click(); return t; };
        const backStep = async () => { const t = await page.evaluate(() => performance.now()); await page.keyboard.press('Escape'); return t; }; // Escape = the Back key (CloseWatcher / escape-back)
        // The arriving view: a view kind `to` that is on screen in the last frame. Its offsets from the first frame it
        // shows: starts left (< -20 px, or right for forward) and only moves toward 0, ending at 0.
        const judge = (rec, to, side) => {
          const last = rec.after.at(-1)?.v.find(v => v.kind === to); if (!last) return { ok: false, why: 'no ' + to + ' on screen' };
          const all = rec.after.map(f => f.v.find(v => v.id === last.id && v.kind === to)).filter(Boolean).map(v => v.x);
          const xs = all.slice(Math.max(0, all.findIndex(x => side * x > 0))); // from the first frame it is drawn off its place on that side
          const start = xs[0] ?? 0, mono = xs.every((x, i) => i === 0 || (side < 0 ? x >= xs[i - 1] - .5 : x <= xs[i - 1] + .5));
          return { ok: side * start > 20 && mono && xs.at(-1) === 0, start, end: xs.at(-1), mono, frames: xs.length, xs: xs.slice(0, 8) };
        };
        // The leaving view, from release until it is gone: never moves back toward rest (x never drops).
        const leaving = (rec, from) => {
          const lastBefore = rec.before.at(-1)?.v.find(v => v.kind === from); if (!lastBefore) return { ok: false, why: 'no ' + from + ' before release' };
          const xs = [lastBefore.x, ...rec.after.map(f => f.v.find(v => v.id === lastBefore.id && v.kind === from)).filter(Boolean).map(v => v.x)];
          return { ok: xs.every((x, i) => i === 0 || x >= xs[i - 1] - .5), xs: xs.slice(0, 6), atRelease: lastBefore.x };
        };
        const slid = rec => rec.after.some(f => f.v.some(v => Math.abs(v.x) > 20));
        // Where to put the finger: inside the view on screen (phone: the whole screen; desktop: the Chats window).
        const at = async sel => { // phone: the middle of the screen; desktop: inside the Chats window's pane on screen
          if (phone) return { x: 120, y: 500 };
          const b = await vis(sel).boundingBox(); return { x: b.x + Math.min(120, b.width / 4), y: b.y + b.height * .55 }; };
        const swipeIn = async (sel, dx, ms = 260, mark = true) => { const p = await at(sel); await swipe(p.x, p.y, dx, 0, ms, mark); return 0; };
        steps.touch = built;
        if (off) {
          // Switch off: a thread from the plain list; the swipe back snaps back and cuts, taps have no motion.
          steps.open = slid(await record(tapAt('.ch-list [data-chopen="qa-a1"]'))); await nap(500);
          const r = await record(() => swipeIn('[data-part="thread"]', 220));
          steps.swipe = { slid: slid({ after: r.after.map(f => ({ v: f.v.filter(v => v.kind !== 'thread') })) }), where: await where(), leave: leaving(r, 'thread') };
          await vis('.ch-list [data-chopen="qa-a1"]').click(); await nap(600);
          steps.button = phone ? slid(await record(tapAt('[data-part="thread"] [data-chback]'))) : slid(await record(async () => { const t = await page.evaluate(() => performance.now()); await page.keyboard.press('Escape'); return t; }));
          report.push({ skin, dev, off, steps, errors });
          assert.equal(steps.open, false, `${dev} ${skin}: off, opening a thread has no motion`);
          assert.equal(steps.swipe.slid, false, `${dev} ${skin}: off, no slide-in after the swipe`); assert.equal(steps.swipe.where, 'list');
          assert.equal(steps.button, false, `${dev} ${skin}: off, Back button has no motion`);
          assert.deepEqual(errors, [], `${dev} ${skin}: no page errors`);
          continue;
        }
        await vis('[data-chview="channels"]').click(); await nap(300);
        // 1. Open a channel (forward: from the right).
        steps.openFeed = judge(await record(tapAt('.ch-chan-open[data-chchan="apps"]')), 'feed', 1); await nap(300);
        // 2. Open a thread from the feed (forward).
        steps.openThread = judge(await record(tapAt('.ch-chan-feed [data-chopen="qa-a1"]')), 'thread', 1); await nap(500);
        // 3. A short swipe on the thread eases back; nothing changes.
        const short = await record(() => swipeIn('[data-part="thread"]', 70, 900));
        steps.short = { stays: await where(), end: short.after.at(-1)?.v.find(v => v.kind === 'thread')?.x };
        // 4. Swipe right out of the thread: leaving never moves back, the feed slides in from the left.
        const s1 = await record(() => swipeIn('[data-part="thread"]', 220));
        steps.swipeThread = { leave: leaving(s1, 'thread'), arrive: judge(s1, 'feed', -1), where: await where() };
        await shot('1-back-from-thread');
        // 5. Swipe right out of the feed: the Channels list slides in from the left.
        const s2 = await record(() => swipeIn('.ch-list', 220));
        steps.swipeFeed = { leave: leaving(s2, 'feed'), arrive: judge(s2, 'home', -1), where: await where(), view: await view() };
        // 6. A third swipe right does nothing and the app stays open.
        await swipeIn('.ch-list', 220, 260, false); steps.third = { where: await where(), view: await view() };
        // 7. Back button: feed -> thread -> Back button -> feed -> Back button -> Channels.
        await vis('.ch-chan-open[data-chchan="apps"]').click(); await nap(500);
        await vis('.ch-chan-feed [data-chopen="qa-a1"]').click(); await nap(700);
        // Classic desktop shows the thread in a pane beside the list and has no thread Back button: Esc closes the pane.
        if (phone) steps.buttonThread = judge(await record(tapAt('[data-part="thread"] [data-chback]')), 'feed', -1);
        else { await page.keyboard.press('Escape'); await nap(500); }
        steps.buttonFeed = judge(await record(tapAt('[data-chchanback]')), 'home', -1);
        // 8. The shell's Back step (hardware / gesture Back).
        await vis('.ch-chan-open[data-chchan="apps"]').click(); await nap(500);
        steps.shellBack = judge(await record(backStep), 'home', -1);
        // 9. The page swipe is unchanged: Channels -> Activity slides in from the right.
        const pg = await record(async () => { const p = await at('.ch-list'); await swipe(p.x + (phone ? 180 : 140), p.y, -200, 0, 260, true); return 0; });
        steps.page = { view: await view(), body: judge(pg, 'body', 1) };
        await shot('2-after');
        report.push({ skin, dev, off, steps, errors });
        const want = !off && !broken && built;
        if (!built) { assert.ok(!slid(s1), `${dev} ${skin}: no touch built-in, no motion`); }
        else if (want) {
          for (const k of ['openFeed', 'openThread', 'buttonThread', 'buttonFeed', 'shellBack']) if (k in steps) assert.ok(steps[k].ok, `${dev} ${skin}: ${k} slides ${JSON.stringify(steps[k])}`);
          assert.ok(steps.swipeThread.leave.ok, `${dev} ${skin}: the thread never snaps back before it leaves ${JSON.stringify(steps.swipeThread.leave)}`);
          // Phone: the feed comes back in place of the thread and slides in. Desktop: the feed pane was on screen beside
          // the thread all along, so only the thread pane closes (nothing arrives, nothing slides).
          if (phone) assert.ok(steps.swipeThread.arrive.ok, `${dev} ${skin}: the feed slides in from the left ${JSON.stringify(steps.swipeThread.arrive)}`);
          else assert.equal(steps.swipeThread.arrive.start, 0, `${dev} ${skin}: the feed pane beside the thread stays still`);
          assert.ok(steps.swipeFeed.leave.ok, `${dev} ${skin}: the feed never snaps back ${JSON.stringify(steps.swipeFeed.leave)}`);
          assert.ok(steps.swipeFeed.arrive.ok, `${dev} ${skin}: Channels slides in from the left ${JSON.stringify(steps.swipeFeed.arrive)}`);
        } else {
          for (const k of ['openFeed', 'openThread', 'buttonThread', 'buttonFeed', 'shellBack']) if (k in steps) assert.ok(!steps[k].ok, `${dev} ${skin}: ${k} has no slide (old behaviour)`);
          assert.ok(!steps.swipeThread.arrive.ok, `${dev} ${skin}: the old cut, no slide-in`);
        }
        assert.equal(steps.short.stays, 'thread'); assert.equal(steps.short.end, 0, `${dev} ${skin}: a short swipe eases back to rest`);
        assert.equal(steps.swipeThread.where, 'feed'); assert.equal(steps.swipeFeed.where, 'list'); assert.equal(steps.swipeFeed.view, 'channels');
        assert.equal(steps.third.where, 'list', `${dev} ${skin}: the app never exits on the last swipe`);
        if (built && !off) { assert.equal(steps.page.view, 'activity'); assert.ok(steps.page.body.ok, `the page swipe still slides in from the right ${JSON.stringify(steps.page.body)}`); }
        assert.deepEqual(errors, [], `${dev} ${skin}: no page errors`);
      } finally { if (!report.some(r => r.skin === skin && r.dev === dev)) report.push({ skin, dev, off, steps, errors, unfinished: true }); await context.close(); }
    }
  } finally { await browser.close(); fs.writeFileSync(path.join(out, `report${off ? '-off' : ''}.json`), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); }
})().catch(e => { console.error(e); process.exit(1); });
