'use strict';
// wizard-ux issue 1533 in a real browser: the phone bottom bar with switch wizard/phone-nav.
// Phones 393 and 320 px wide (Android) plus an iPhone, Nebula and Grove, six desks, the main agent's Chats count at 3.
// On: the orb is 72 px (66 px at 360 px or less) with one thin ring, no orbit dots, no spinning arcs, no sparkles;
// side icons are 32 px in 44 px buttons; the one yellow badge sits on the ring at 45 degrees (its centre on the
// ring, the number centred) on the main agent's desk only; Home and + always show and nothing in the bar overlaps;
// on iPhone the bar is 78 px tall and every page above it ends at its top edge; tap, hold and swipe on the orb work.
// QA_SWITCH=off: the same pages with the switch off must match main (QA_WEB=<main>/web) and the checks are skipped.
// Synthetic transport only (no box is reached). Shots and a report go to QA_OUT.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = 'https://phone-nav.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'phone-nav-evidence');
const SW = 'wizard/phone-nav', on = process.env.QA_SWITCH !== 'off';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const CASES = [
  { name: 'android-393', width: 393, height: 852, ua: ANDROID },
  { name: 'android-320', width: 320, height: 640, ua: ANDROID },
  { name: 'iphone-393', width: 393, height: 852, ua: IPHONE },
].filter(c => !process.env.QA_CASES || process.env.QA_CASES.split(',').includes(c.name));
const SKINS = (process.env.QA_SKINS || 'nebula,grove').split(',');
fs.mkdirSync(out, { recursive: true });
const nap = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch(), report = [];
  let failed = 0;
  try {
    for (const c of CASES) for (const skin of SKINS) {
      const tag = `${c.name}-${skin}-${on ? 'on' : 'off'}`, steps = { tag }, errors = [];
      const context = await browser.newContext({ viewport: { width: c.width, height: c.height }, isMobile: true, hasTouch: true, serviceWorkers: 'block', userAgent: c.ua });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        await context.addInitScript(({ skin, on, SW }) => {
          if (window !== top) return;
          const seed = { 'wos.shell': 'phone', 'wux.shell': 'phone', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin };
          if (on) seed['wos.skin-tweaks.v1'] = JSON.stringify({ version: 1, preset: 'none', off: {}, mix: { 'wizard/desktop-chats': true, [SW]: true } });
          for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
        }, { skin, on, SW });
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
        if (on) await page.waitForFunction(id => (document.documentElement.dataset.tweaks || '').split(' ').includes(id), SW, { timeout: 15000 });
        await nap(800);
        await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
        // Six desks: Home, Chats and four apps. The main agent (Chats) has 3 waiting, Notes-like apps 2.
        await page.evaluate(() => {
          const apps = WizCore.apps('mobile').APPS;
          const chats = apps.find(a => a.id === 'wizard'); if (chats) __wos.openApp(chats);
          for (const a of apps.filter(a => a.id !== 'wizard')) { if (__wos.desks.length >= 6) break; try { __wos.openApp(a); } catch (_) {} }
          __wos.closeSheets?.();
        });
        await nap(500);
        const deskApps = await page.evaluate(() => __wos.desks.map(d => d.home ? 'home' : (d.wins || []).map(id => (__wos.W?.[id] || {}).app).join('+')));
        steps.desks = deskApps;
        const chatsAt = await page.evaluate(() => __wos.desks.findIndex(d => !d.home && (d.wins || []).some(id => document.querySelector(`[data-chats="${id}"]`))));
        steps.chatsAt = chatsAt;
        const otherAt = await page.evaluate(i => __wos.desks.findIndex((d, k) => k !== i && !d.home && d.wins.length), chatsAt);
        await page.evaluate(() => { WizCore.workspaceNav.setCount('wizard', 3); });
        const go = async i => { await page.evaluate(i => __wos.goDesk(i, true), i); await page.evaluate(() => WizCore.workspaceNav.setCount('wizard', 3)); await nap(700); };
        const shot = s => page.screenshot({ path: path.join(out, `${tag}-${s}.png`) });
        const clipShot = async s => { const b = await page.evaluate(() => { const r = document.querySelector('#dock').getBoundingClientRect(); return { y: r.top, h: r.height }; }); const y = Math.max(0, Math.floor(b.y - 70)); await page.screenshot({ path: path.join(out, `${tag}-${s}-bar.png`), clip: { x: 0, y, width: c.width, height: Math.min(c.height - y, Math.ceil(b.h + 70)) } }); };
        const measure = () => page.evaluate(() => {
          const q = s => document.querySelector(s), box = el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; };
          const vis = el => { if (!el) return false; const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > 0 && r.width > 0 && r.height > 0; };
          const wrap = q('#orbWrap'), ring = q('.orb-ring'), badge = q('#orbBadge'), dock = q('#dock');
          const rb = getComputedStyle(ring, '::before'), ra = getComputedStyle(ring, '::after');
          const arcs = [rb, ra].filter(s => s.display !== 'none' && s.content !== 'none' && (s.borderTopColor !== 'rgba(0, 0, 0, 0)' || s.borderBottomColor !== 'rgba(0, 0, 0, 0)') && s.animationName !== 'none').length;
          const moons = [...document.querySelectorAll('#moons i')].filter(vis).length + (getComputedStyle(q('#moons')).display === 'none' ? 0 : 1000);
          const items = [...dock.querySelectorAll('.desk-dots > *')].filter(vis).map(el => ({ el, b: box(el) }));
          const buttons = items.filter(i => i.el.matches('.ddot'));
          let overlaps = 0; const all = [...items.map(i => i.b), box(wrap)];
          for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) { const a = all[i], b = all[j]; if (a.x < b.x + b.w - .5 && b.x < a.x + a.w - .5 && a.y < b.y + b.h - .5 && b.y < a.y + a.h - .5) overlaps++; }
          const off = items.filter(i => i.b.x < -0.5 || i.b.x + i.b.w > innerWidth + .5).length;
          const icons = buttons.filter(i => i.el.matches('[data-goto]')).map(i => { const d = i.el.querySelector('.dsg'); const r = d.getBoundingClientRect(); return { btn: Math.round(i.b.w) + 'x' + Math.round(i.b.h), icon: Math.round(r.width) + 'x' + Math.round(r.height) }; });
          const app = q('#orbApp .dsg'), appBox = app && vis(q('#orbApp')) ? box(app) : null, w = box(wrap);
          let badgeInfo = null;
          if (vis(badge)) {
            const b = box(badge), rr = box(ring), r = rr.w / 2, dx = b.cx - rr.cx, dy = rr.cy - b.cy;
            const range = document.createRange(); range.selectNodeContents(badge); const t = range.getBoundingClientRect();
            badgeInfo = { text: badge.textContent, size: Math.round(b.w) + 'x' + Math.round(b.h), offRing: +(Math.hypot(dx, dy) - r).toFixed(2), angle: +(Math.atan2(dy, dx) * 180 / Math.PI).toFixed(1), textDx: +((t.left + t.width / 2) - b.cx).toFixed(2), textDy: +((t.top + t.height / 2) - b.cy).toFixed(2) };
          }
          const db = box(dock), cs = getComputedStyle(document.documentElement);
          // Pages above the bar end at its top edge: the desk content area and full-screen tiles.
          const desk = [...document.querySelectorAll('.desk')].find(d => { const r = d.getBoundingClientRect(); return r.left >= -1 && r.left < 2; });
          const tiles = desk?.querySelector('.tiles'), tb = tiles && vis(tiles) ? box(tiles) : null;
          return { orb: Math.round(w.w) + 'x' + Math.round(w.h), ring: Math.round(box(ring).w), ringBorder: getComputedStyle(ring).borderTopWidth, arcs, moons, buttons: buttons.length, overlaps, offscreen: off, icons, home: buttons.some(i => i.el.matches('.dhome')), plus: buttons.some(i => i.el.matches('[data-plus]')),
            orbApp: appBox ? { size: Math.round(appBox.w) + 'x' + Math.round(appBox.h), dy: +(appBox.cy - w.cy).toFixed(2), hat: !!q('#orbApp .sg-hat, #orbApp .sg-hat-private') } : null,
            badge: badgeInfo, dockH: +parseFloat(cs.getPropertyValue('--dock-h')).toFixed(1), dockTop: Math.round(db.y), dockBottom: Math.round(db.y + db.h), tilesBottom: tb ? Math.round(tb.y + tb.h) : null,
            orbCy: +w.cy.toFixed(1), platform: document.documentElement.dataset.phoneNavIos !== undefined ? 'ios' : 'other' };
        });
        // 1) In Chats (the main agent's desk).
        assert.ok(chatsAt > 0, `a Chats desk is open (${JSON.stringify(deskApps)})`);
        await go(chatsAt); steps.chats = await measure(); await shot('chats'); await clipShot('chats');
        // 2) On Home.
        await go(0); steps.home = await measure(); await clipShot('home');
        // 3) On another app's desk: never the main agent's badge.
        if (otherAt > 0) { await go(otherAt); steps.other = await measure(); await clipShot('other'); }
        // 4) A zero count hides the badge.
        await go(chatsAt); await page.evaluate(() => WizCore.workspaceNav.setCount('wizard', 0)); await nap(300); steps.zero = await measure();
        // 5) A full bar: the last desk of many, and the middle one.
        await page.evaluate(() => { const apps = WizCore.apps('mobile').APPS.filter(a => a.id !== 'wizard'); for (const a of apps) { if (__wos.desks.length >= 9) break; try { __wos.openApp(a); } catch (_) {} } __wos.closeSheets?.(); });
        await nap(400); const n = await page.evaluate(() => __wos.desks.length); steps.deskCount = n;
        await go(Math.floor(n / 2)); steps.fullMid = await measure(); await clipShot('full-mid');
        await go(n - 1); steps.fullEnd = await measure(); await clipShot('full-end');
        // 6) The orb still answers: a tap starts a take, a hold opens the command take, a swipe up opens Apps.
        const cdp = await context.newCDPSession(page);
        await go(chatsAt);
        const orbAt = await page.evaluate(() => { const r = document.querySelector('#orb').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; });
        const voice = () => page.evaluate(() => document.querySelector('#device').dataset.voice || 'idle');
        const touch = async (pts, holdMs = 60) => { const t0 = Date.now() / 1000; await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pts[0]], timestamp: t0 }); let k = 0; for (const p of pts.slice(1)) { k++; await nap(30); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [p], timestamp: t0 + k * .03 }); } await nap(holdMs); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: t0 + k * .03 + holdMs / 1000 }); };
        await page.evaluate(() => { navigator.mediaDevices && (navigator.mediaDevices.getUserMedia = () => new Promise(() => {})); });
        await touch([orbAt]); await nap(500); steps.tap = await voice(); await nap(1200); await clipShot('listening');
        // While recording, the voice buttons sit level with the orb's centre and never touch the orb.
        steps.arcs = await page.evaluate(() => { const o = document.querySelector('#orbWrap').getBoundingClientRect(), cy = o.top + o.height / 2, cx = o.left + o.width / 2;
          return [...document.querySelectorAll('.voice.on .arc')].filter(a => getComputedStyle(a).display !== 'none').map(a => { const r = a.getBoundingClientRect(); return { id: a.id, dy: +((r.top + r.height / 2) - cy).toFixed(1), gap: +(Math.abs((r.left + r.width / 2) - cx) - r.width / 2 - o.width / 2).toFixed(1), left: Math.round(r.left), right: Math.round(r.right) }; }); });
        if (on) for (const a of steps.arcs) { assert.ok(Math.abs(a.dy) <= 1.5, `${a.id} level with the orb (${a.dy})`); assert.ok(a.gap >= 0, `${a.id} clear of the orb (${a.gap})`); assert.ok(a.left >= 0 && a.right <= c.width, `${a.id} on screen`); }
        await page.evaluate(() => { try { __wos.cancelVoice?.(); } catch (_) {} document.querySelector('#arcCancel')?.click(); }); await nap(600);
        steps.afterCancel = await voice();
        await touch([orbAt, { x: orbAt.x, y: orbAt.y - 40 }, { x: orbAt.x, y: orbAt.y - 90 }, { x: orbAt.x, y: orbAt.y - 160 }], 20); await nap(600);
        steps.swipeUp = await page.evaluate(() => ({ sheet: __wos.sheet || document.querySelector('#device').dataset.sheet || null, ov: !!document.querySelector('.ov.open') }));
        await page.evaluate(() => { __wos.closeSheets?.(); __wos.closeOverview?.(); }); await nap(500);
        await go(chatsAt);
        await touch([orbAt, { x: orbAt.x - 20, y: orbAt.y }, { x: orbAt.x - 50, y: orbAt.y }, { x: orbAt.x - 80, y: orbAt.y }], 20); await nap(800);
        steps.swipeSide = await page.evaluate(() => __wos.idx);
        steps.errors = errors;
        if (on) {
          const small = c.width <= 360, want = small ? 66 : 72;
          for (const k of ['chats', 'home', 'zero', 'fullMid', 'fullEnd', ...(steps.other ? ['other'] : [])]) {
            const m = steps[k];
            assert.equal(m.orb, `${want}x${want}`, `${k}: orb ${want} px`); assert.equal(m.ring, want, `${k}: the ring is the orb's edge`);
            assert.equal(m.arcs, 0, `${k}: no spinning arcs`); assert.equal(m.moons, 0, `${k}: no orbit dots`);
            assert.equal(m.overlaps, 0, `${k}: nothing in the bar overlaps`); assert.equal(m.offscreen, 0, `${k}: nothing off the bar`);
            for (const i of m.icons) { assert.equal(i.btn, '44x44', `${k}: 44 px buttons`); assert.equal(i.icon, '32x32', `${k}: 32 px icons`); }
            assert.equal(m.dockH, c.ua === IPHONE ? 78 : 66, `${k}: bar height`);
            if (m.tilesBottom !== null) assert.ok(m.tilesBottom <= m.dockTop + 1, `${k}: the page above ends at the bar (${m.tilesBottom} vs ${m.dockTop})`);
          }
          for (const k of ['fullMid', 'fullEnd']) assert.ok(steps[k].plus, `${k}: + shows`);
          assert.ok(steps.fullMid.home && steps.fullEnd.home, 'Home shows');
          const b = steps.chats.badge; assert.ok(b, 'the main agent desk shows its count');
          assert.equal(b.text, '3'); assert.ok(Math.abs(b.offRing) <= 1, `badge centre on the ring (${b.offRing})`); assert.ok(Math.abs(b.angle - 45) <= 2, `badge at 45 degrees (${b.angle})`);
          assert.ok(Math.abs(b.textDx) <= 1 && Math.abs(b.textDy) <= 1.5, `number centred (${b.textDx}, ${b.textDy})`);
          assert.equal(steps.home.badge, null, 'Home: no badge'); if (steps.other) assert.equal(steps.other.badge, null, 'another desk never shows the main agent badge');
          assert.equal(steps.zero.badge, null, 'a zero count hides the badge');
          assert.ok(steps.chats.orbApp, 'the open app mark shows in the orb');
          assert.equal(steps.chats.orbApp.size, steps.chats.orbApp.hat ? '34x34' : '36x36', 'mark size in the orb');
          assert.equal(steps.home.orbApp?.size, '36x36', 'Home mark 36 px');
          if (steps.chats.orbApp.hat) assert.ok(Math.abs(steps.chats.orbApp.dy + 1.5) <= .3, `hat lifted 1.5 px (${steps.chats.orbApp.dy})`);
          // The orb's centre over the bar's bottom edge: 38 px on a 66 px bar, 12 px higher (50) on iPhone's 78 px bar.
          for (const k of ['chats', 'home']) assert.ok(Math.abs(steps[k].dockBottom - steps[k].orbCy - (c.ua === IPHONE ? 50 : 38)) <= 1, `${k}: orb height over the bottom edge (${steps[k].dockBottom - steps[k].orbCy})`);
        }
        assert.ok(steps.tap === 'listen' || steps.tap === 'paused', `a tap on the orb starts a take (${steps.tap})`);
        assert.ok(steps.swipeUp.sheet || steps.swipeUp.ov, `a swipe up on the orb opens what it always opened (${JSON.stringify(steps.swipeUp)})`);
        assert.notEqual(steps.swipeSide, chatsAt, 'a sideways swipe on the orb changes desk');
        assert.deepEqual(errors, [], 'no page errors');
        steps.ok = true;
      } catch (e) { failed++; steps.ok = false; steps.error = e.message; } finally { await context.close(); }
      report.push(steps); console.log(JSON.stringify(steps));
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(out, `report-${on ? 'on' : 'off'}.json`), JSON.stringify(report, null, 1));
  console.log(failed ? `FAIL ${failed}/${report.length}` : `PASS ${report.length}/${report.length}`);
  process.exit(failed ? 1 : 0);
})();
