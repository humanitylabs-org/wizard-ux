'use strict';
// wizard-ux issue 1491 in a real browser: phone 412x915, Nebula + Grove, real CDP touches on the bottom bar.
// No little handle under the orb; hold and drag left on the bar from desk 3 of 6 steps one
// desk to the right per ~26 px with the desk name above the bar and lands on release; drag right goes left; on Home a
// drag right does nothing; a quick flick moves one desk; a dot tap still goes to its desk; a drag that rises or starts
// in the home-indicator strip leaves the desk where it started. Synthetic transport only (no box is reached).
// wizard-ux issue 1563: on for everyone, no switch. Default run = fresh state (no tweaks saved, Channels off);
// QA_CHANNELS=on runs the same cases with wizard/chat-channels on, to show the scrub does not depend on Channels.
// wizard-ux issue 1536: a sideways drag that starts on the orb scrubs the same as one on the bar; the scrub is live from
// the first move (no hold), a 20-30 px first move changes at most one desk, a steady 3 x 26 px drag lands three desks
// over. Orb up-swipes stay the orb's.
// Issue 1536 kick-back: a fast long swipe (bar or orb) lands by distance (only a short flick is one desk), and while the
// finger is down each step shows the hovered desk itself (rendered, on screen) before release.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = 'https://bar-scrub.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'bar-scrub-evidence');
const chan = process.env.QA_CHANNELS === 'on', CH = 'wizard/chat-channels', tag = chan ? '-channels-on' : '-fresh';
fs.mkdirSync(out, { recursive: true });
const nap = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch(), report = [];
  try {
    for (const skin of ['nebula', 'grove']) {
      const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block', userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' });
      const errors = [], steps = {};
      try {
        await context.routeWebSocket('**/*', w => w.close());
        await context.addInitScript(({ skin, chan, CH }) => {
          if (window !== top) return;
          const seed = { 'wos.shell': 'phone', 'wux.shell': 'phone', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin };
          // Fresh state saves no tweak choice at all; the Channels run turns only Channels on (plus the default desktop-chats).
          if (chan) seed['wos.skin-tweaks.v1'] = JSON.stringify({ version: 1, preset: 'none', off: {}, mix: { 'wizard/desktop-chats': true, [CH]: true } });
          for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
        }, { skin, chan, CH });
        const prefs = { migrations: { 'launcher-seed-v1': true } };
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
          if (p === '/wizard/v1/setup') return r.fulfill({ json: { first_run: false } });
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: [], has_more: false } });
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
        await page.goto(origin + prefix + 'index.html?phone');
        await page.waitForFunction(() => window.__wos && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        if (chan) await page.waitForFunction(id => (document.documentElement.dataset.tweaks || '').split(' ').includes(id), CH, { timeout: 15000 });
        await nap(800);
        steps.tweaks = await page.evaluate(() => document.documentElement.dataset.tweaks || '');
        assert.equal(steps.tweaks.split(' ').includes(CH), chan, `Channels ${chan ? 'on' : 'off'}`);
        assert.ok(!steps.tweaks.includes('bar-scrub'), 'no bar-scrub switch is worn');
        await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
        // Six desks: Home + five windows, each on its own desk.
        await page.evaluate(() => {
          const apps = WizCore.apps('mobile').APPS.filter(a => a.id !== 'wizard');
          for (const a of apps) { if (__wos.desks.length >= 6) break; try { __wos.openApp(a); } catch (_) {} }
          __wos.closeSheets?.();
        });
        await nap(500);
        const n = await page.evaluate(() => __wos.desks.length);
        assert.ok(n >= 6, `six desks to scrub (got ${n})`);
        const go = async i => { await page.evaluate(i => __wos.goDesk(i, true), i); await nap(700); };
        const at = () => page.evaluate(() => { const o = document.querySelector('.ov-hint'); if (o && o.offsetParent) throw new Error('the desk overview opened'); return __wos.idx; });
        const names = () => page.evaluate(() => __wos.desks.map((d, i) => document.querySelector(`[data-goto="${i}"]`)?.getAttribute('aria-label') || ''));
        const shot = s => page.screenshot({ path: path.join(out, `${skin}${tag}-${s}.png`) });
        const cdp = await context.newCDPSession(page);
        const bar = await page.evaluate(() => { const r = document.querySelector('#dock').getBoundingClientRect(), o = document.querySelector('#orbWrap').getBoundingClientRect(); return { y: Math.round(r.top + 22), orbL: o.left, orbR: o.right, orbX: Math.round(o.left + o.width / 2), orbY: Math.round(o.top + o.height / 2), bottom: r.bottom }; });
        const handle = () => page.evaluate(() => { const s = document.querySelector('#scrub'), i = s?.querySelector('i'); if (!i) return false; const b = i.getBoundingClientRect(); return getComputedStyle(i).display !== 'none' && getComputedStyle(s).display !== 'none' && b.width > 0 && +getComputedStyle(i).opacity > 0; });
        // A finger on the bar: hold `hold` ms, then move dx in `moves` steps over `ms`, sampling the label as it goes.
        // peek: after each move, the desk the scrub points at is rendered (not parked) and has slid on screen.
        const peekNow = () => page.evaluate(() => { const d = __wos.desks[__wos.idx], el = d && document.querySelector(`.desk[data-did="${d.id}"]`); if (!el) return null; const b = el.getBoundingClientRect(); const tr = el.parentElement; return { at: __wos.idx, shown: getComputedStyle(el).contentVisibility !== 'hidden' && !el.classList.contains('parked'), left: Math.round(b.left), dur: getComputedStyle(tr).transitionDuration, cls: tr.className, tf: tr.style.transform }; });
        const drag = async (x, dx, { y = bar.y, dy = 0, hold = 220, ms = 900, moves = 24, cancel = false, sample = true, lead = 0, peek = null } = {}) => {
          // Event times are given to Chrome (timestamp, seconds), so a slow host never turns a flick into a hold.
          const labels = [], t0 = Date.now() / 1000;
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }], timestamp: t0 });
          // lead: a first move at once (a real finger on the orb crosses its 14 px slop before the hold radial's timer;
          // this host takes 100-200 ms per CDP touch, so the drag's own first steps would be too late).
          if (lead) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + Math.sign(dx) * lead, y }], timestamp: t0 + 0.016 });
          await nap(hold);
          for (let k = 1; k <= moves; k++) {
            await nap(ms / moves);
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * k / moves, y: y + dy * k / moves }], timestamp: t0 + (hold + ms * k / moves) / 1000 });
            const l = sample && await page.evaluate(() => { const s = document.querySelector('#scrub'); return s?.classList.contains('on') ? s.querySelector('.sc-label').textContent : ''; });
            if (l && labels.at(-1) !== l) labels.push(l);
            if (peek) { await nap(260); let p = await peekNow(); if (p && Math.abs(p.left) >= 40) { await nap(400); p = await peekNow(); } if (p && peek.at(-1)?.at !== p.at) peek.push(p); } // a busy host can lag one frame
          }
          if (labels.length) await shot('scrubbing');
          await cdp.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [], timestamp: t0 + (hold + ms + 10) / 1000 });
          await nap(700);
          return labels;
        };
        const left = 40, right = 372; // bar edges, away from the orb in the middle
        const desk = await names();
        {
          steps.handle = await handle(); assert.equal(steps.handle, false, 'no little handle under the orb');
          await shot('bar');
          await go(2); steps.leftLabels = await drag(right, -84); steps.left = await at();
          assert.equal(steps.left, 5, 'drag left 84 px from desk 3 lands three desks to the right');
          assert.deepEqual(steps.leftLabels.slice(1), desk.slice(3, 6), 'label names each desk as you go'); assert.equal(steps.leftLabels.length, 4, 'the start desk\'s name is up first');
          // wizard-ux#1536: no hold, no first jump, the orb is part of the surface.
          await go(2); steps.instantLabels = await drag(right, -78, { hold: 0, ms: 900, moves: 26 }); steps.instant = await at();
          assert.equal(steps.instant, 5, 'a steady 3 x 26 px drag with no hold lands exactly three desks over');
          assert.equal(steps.instantLabels.length, 4, 'the label is up from the first move'); assert.deepEqual(steps.instantLabels.slice(1), desk.slice(3, 6));
          for (const first of [20, 25, 30]) {
            await go(2); await drag(right, -first, { hold: 0, ms: 300, moves: 1 }); const got = await at();
            steps['first' + first] = got; assert.ok(got === 2 || got === 3, `a ${first} px first move changes at most one desk (got ${got})`);
          }
          await go(2); steps.orbLabels = await drag(bar.orbX, -84, { y: bar.orbY, lead: 16, hold: 0 }); steps.orbLeft = await at();
          assert.equal(steps.orbLeft, 5, 'a drag left from the orb scrubs three desks to the right, like the bar');
          assert.deepEqual(steps.orbLabels, steps.leftLabels, 'same label steps as on the bar');
          await go(4); await drag(bar.orbX, 60, { y: bar.orbY, lead: 16, hold: 0, moves: 6, ms: 500 }); steps.orbRight = await at();
          assert.equal(steps.orbRight, 2, 'a drag right from the orb goes two desks to the left');
          await go(0); await drag(bar.orbX, 120, { y: bar.orbY, lead: 16, hold: 0, moves: 10, ms: 500 }); steps.orbHomeRight = await at();
          assert.equal(steps.orbHomeRight, 0, 'on Home a drag right from the orb does nothing');
          await go(2); await drag(bar.orbX, -44, { y: bar.orbY, lead: 16, hold: 0, ms: 60, moves: 2, sample: false }); steps.orbFlick = await at();
          assert.equal(steps.orbFlick, 3, 'a short quick flick on the orb moves one desk');
          await go(1); await drag(bar.orbX, -110, { y: bar.orbY, lead: 16, hold: 0, ms: 80, moves: 4, sample: false }); steps.orbFastLong = await at();
          assert.equal(steps.orbFastLong, 5, 'a fast long swipe on the orb (110 px in under 0.1 s) lands by distance, four desks over');
          // While the finger is down, each step shows the hovered desk itself (desks 3 and 4 are parked from desk 1).
          await go(1); steps.peek = []; await drag(bar.orbX, -84, { y: bar.orbY, lead: 16, hold: 0, ms: 1200, moves: 12, peek: steps.peek });
          steps.peek = steps.peek.filter(p => p.at !== 1); assert.deepEqual(steps.peek.map(p => p.at), [2, 3, 4], 'one peek per desk stepped');
          for (const p of steps.peek) assert.ok(p.shown && Math.abs(p.left) < 40, `desk ${p.at} is rendered and on screen before release (${JSON.stringify(p)})`);
          await go(2); await drag(bar.orbX, -84, { y: bar.orbY, lead: 16, hold: 0, dy: -70 }); steps.orbRose = await at();
          assert.equal(steps.orbRose, 2, 'a drag from the orb that rises leaves the desk where it started');
          await page.evaluate(() => { __wos.closeSheets?.(); __wos.closeOverview?.(); }); await nap(500);
          await go(2); await drag(bar.orbX, 0, { y: bar.orbY, dy: -160, hold: 0, ms: 300, moves: 8, sample: false });
          steps.orbUp = await page.evaluate(() => ({ idx: __wos.idx, sheet: __wos.sheet || null, overview: !!document.querySelector('.ov-hint')?.offsetParent || !!document.querySelector('.pill-ov.open, .ov.open') }));
          assert.equal(steps.orbUp.idx, 2, 'an upward orb swipe never moves desks');
          assert.ok(steps.orbUp.sheet || steps.orbUp.overview, 'an upward orb swipe still opens what it always opened');
          await page.evaluate(() => { __wos.closeSheets?.(); __wos.closeOverview?.(); }); await nap(500);
          await go(4); steps.rightLabels = await drag(left, 60, { hold: 0, moves: 5, ms: 500 }); steps.right = await at();
          assert.equal(steps.right, 2, 'drag right 60 px from desk 5 lands two desks to the left');
          await go(0); await drag(left, 120, { hold: 0, moves: 10, ms: 500 }); steps.homeRight = await at();
          assert.equal(steps.homeRight, 0, 'on Home a drag right does nothing');
          await go(2); await drag(right, -44, { hold: 0, ms: 60, moves: 2, sample: false }); steps.flickLeft = await at();
          assert.equal(steps.flickLeft, 3, 'a short quick flick left moves one desk');
          await drag(left, 44, { hold: 0, ms: 60, moves: 2, sample: false }); steps.flickRight = await at();
          assert.equal(steps.flickRight, 2, 'a short quick flick right moves one desk');
          // wizard-ux#1601: a flick that arrives as one or two merged moves is still exactly one desk; a single-move fast
          // long swipe lands by its whole distance (first move counted).
          for (const [px, ms, moves] of [[30, 81, 1], [44, 60, 1], [60, 90, 1], [40, 100, 2]]) {
            await go(2); await drag(right, -px, { hold: 0, ms, moves, sample: false }); const l = await at();
            await go(2); await drag(left, px, { hold: 0, ms, moves, sample: false }); const r = await at();
            steps[`flick${px}x${moves}`] = [l, r]; assert.deepEqual([l, r], [3, 1], `a ${px} px / ${ms} ms flick in ${moves} move(s): one desk each way`);
          }
          await go(2); await drag(bar.orbX, -40, { y: bar.orbY, lead: 16, hold: 0, ms: 60, moves: 1, sample: false }); steps.orbFlick1 = await at();
          assert.equal(steps.orbFlick1, 3, 'an orb flick that arrives as two moves moves one desk');
          await go(0); await drag(right, -100, { hold: 0, ms: 70, moves: 1, sample: false }); steps.oneMoveLong = await at();
          assert.equal(steps.oneMoveLong, 4, 'a 100 px / 80 ms swipe in one move lands four desks over, by distance');
          await go(1); await drag(right, -110, { hold: 0, ms: 80, moves: 4, sample: false }); steps.fastLong = await at();
          assert.equal(steps.fastLong, 5, 'a fast long swipe on the bar lands by distance, four desks over');
          await go(2); await drag(right, -84, { dy: -60 }); steps.rose = await at();
          assert.equal(steps.rose, 2, 'a drag that rises leaves the desk where it started');
          await go(2); await drag(right, -84, { cancel: true }); steps.cancelled = await at();
          assert.equal(steps.cancelled, 2, 'a cancelled touch leaves the desk where it started');
          await go(2); await drag(right, -84, { y: Math.round(bar.bottom - 8) }); steps.edge = await at();
          assert.equal(steps.edge, 2, 'a drag from the very bottom edge is the system\'s');
          // wizard-ux#1516: with Settings open, a scrub parks Settings on its desk (like a flick) and lands three desks over.
          const st = () => page.evaluate(() => ({ idx: __wos.idx, sheet: __wos.sheet, open: !!document.querySelector('.sheet-open'), parked: !!document.querySelector('.st-parked') }));
          await go(2); await page.evaluate(() => __wos.openSheet('settings')); await nap(700);
          await drag(right, -84); steps.settingsScrub = await st(); await shot('settings-after-scrub');
          assert.deepEqual(steps.settingsScrub, { idx: 5, sheet: null, open: false, parked: true }, 'a scrub with Settings open parks it and lands three desks over');
          await go(2); steps.settingsBack = await st();
          assert.deepEqual(steps.settingsBack, { idx: 2, sheet: 'settings', open: true, parked: false }, 'back on its desk Settings shows again');
          await page.evaluate(() => __wos.closeSheets()); await nap(500);
          await go(2); await page.locator('[data-goto="4"]').tap(); await nap(700); steps.dotTap = await at();
          assert.equal(steps.dotTap, 4, 'a dot tap still goes to its desk');
          const dot = await page.locator('[data-goto="3"]').boundingBox();
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: dot.x + dot.width / 2, y: dot.y + dot.height / 2 }] });
          await nap(900); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await nap(500);
          steps.longPressOverview = await page.evaluate(() => !!document.querySelector('.ov-hint')?.offsetParent);
          assert.equal(steps.longPressOverview, true, 'a long-press on the dots opens the overview');
          await page.evaluate(() => __wos.closeOverview()); await nap(500);
          await go(6); const before = await page.evaluate(() => __wos.desks.length);
          if (await page.locator('[data-plus]').filter({ visible: true }).count()) { await page.locator('[data-plus]').filter({ visible: true }).first().tap(); await nap(700); steps.plus = (await page.evaluate(() => __wos.desks.length)) - before + ' desk(s) added'; }
          steps.orbStill = await page.evaluate(() => !!document.querySelector('#orbWrap')?.offsetParent);
        }
        assert.deepEqual(errors, []);
        report.push({ skin, channels: chan, desks: n, ...steps });
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(out, `report${tag}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
