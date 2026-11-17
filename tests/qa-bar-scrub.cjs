'use strict';
// wizard-ux issue 1491 in a real browser: phone 412x915, Nebula + Grove, real CDP touches on the bottom bar.
// Switch wizard/bar-scrub on: no little handle under the orb; hold and drag left on the bar from desk 3 of 6 steps one
// desk to the right per ~26 px with the desk name above the bar and lands on release; drag right goes left; on Home a
// drag right does nothing; a quick flick moves one desk; a dot tap still goes to its desk; a drag that rises or starts
// in the home-indicator strip leaves the desk where it started. QA_SWITCH=off checks the old bar + handle unchanged
// (handle visible, a slow drag on the bar moves exactly one desk). Synthetic transport only (no box is reached).
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = 'https://bar-scrub.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'bar-scrub-evidence');
const off = process.env.QA_SWITCH === 'off', ID = 'wizard/bar-scrub';
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
        await context.addInitScript(({ skin, off, ID }) => {
          if (window !== top) return;
          const mix = off ? { 'wizard/desktop-chats': true } : { 'wizard/desktop-chats': true, [ID]: true };
          for (const [k, v] of Object.entries({ 'wos.shell': 'phone', 'wux.shell': 'phone', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
            'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v);
        }, { skin, off, ID });
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
        if (!off) await page.waitForFunction(id => (document.documentElement.dataset.tweaks || '').split(' ').includes(id), ID, { timeout: 15000 });
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
        const shot = s => page.screenshot({ path: path.join(out, `${skin}${off ? '-off' : ''}-${s}.png`) });
        const cdp = await context.newCDPSession(page);
        const bar = await page.evaluate(() => { const r = document.querySelector('#dock').getBoundingClientRect(), o = document.querySelector('#orbWrap').getBoundingClientRect(); return { y: Math.round(r.top + 22), orbL: o.left, orbR: o.right, bottom: r.bottom }; });
        const handle = () => page.evaluate(() => { const s = document.querySelector('#scrub'), i = s?.querySelector('i'); if (!i) return false; const b = i.getBoundingClientRect(); return getComputedStyle(i).display !== 'none' && getComputedStyle(s).display !== 'none' && b.width > 0 && +getComputedStyle(i).opacity > 0; });
        // A finger on the bar: hold `hold` ms, then move dx in `moves` steps over `ms`, sampling the label as it goes.
        const drag = async (x, dx, { y = bar.y, dy = 0, hold = 220, ms = 900, moves = 24, cancel = false, sample = true } = {}) => {
          // Event times are given to Chrome (timestamp, seconds), so a slow host never turns a flick into a hold.
          const labels = [], t0 = Date.now() / 1000;
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }], timestamp: t0 });
          await nap(hold);
          for (let k = 1; k <= moves; k++) {
            await nap(ms / moves);
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * k / moves, y: y + dy * k / moves }], timestamp: t0 + (hold + ms * k / moves) / 1000 });
            const l = sample && await page.evaluate(() => { const s = document.querySelector('#scrub'); return s?.classList.contains('on') ? s.querySelector('.sc-label').textContent : ''; });
            if (l && labels.at(-1) !== l) labels.push(l);
          }
          if (labels.length) await shot('scrubbing');
          await cdp.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [], timestamp: t0 + (hold + ms + 10) / 1000 });
          await nap(700);
          return labels;
        };
        const left = 40, right = 372; // bar edges, away from the orb in the middle
        const desk = await names();
        if (off) {
          steps.handle = await handle(); assert.equal(steps.handle, true, 'switch off: the little handle is there');
          await go(2); await drag(right, -130, { hold: 0, ms: 600, sample: false }); steps.slowDragOff = await at();
          assert.equal(steps.slowDragOff, 3, 'switch off: a slow drag on the bar moves one desk, as before');
          await shot('bar');
        } else {
          steps.handle = await handle(); assert.equal(steps.handle, false, 'no little handle under the orb');
          await shot('bar');
          await go(2); steps.leftLabels = await drag(right, -84); steps.left = await at();
          assert.equal(steps.left, 5, 'drag left 84 px from desk 3 lands three desks to the right');
          assert.deepEqual(steps.leftLabels, desk.slice(3, 6), 'label names each desk as you go');
          await go(4); steps.rightLabels = await drag(left, 60, { hold: 0, moves: 5, ms: 500 }); steps.right = await at();
          assert.equal(steps.right, 2, 'drag right 60 px from desk 5 lands two desks to the left');
          await go(0); await drag(left, 120, { hold: 0, moves: 10, ms: 500 }); steps.homeRight = await at();
          assert.equal(steps.homeRight, 0, 'on Home a drag right does nothing');
          await go(2); await drag(right, -110, { hold: 0, ms: 60, moves: 4, sample: false }); steps.flickLeft = await at();
          assert.equal(steps.flickLeft, 3, 'a quick flick left moves one desk');
          await drag(left, 110, { hold: 0, ms: 60, moves: 4, sample: false }); steps.flickRight = await at();
          assert.equal(steps.flickRight, 2, 'a quick flick right moves one desk');
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
        report.push({ skin, off, desks: n, ...steps });
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(out, `report${off ? '-off' : ''}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
