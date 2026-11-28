'use strict';
// wizard-ux issue 1955 in a real browser: the phone Apps tile's Favorites panel, the hold-for-nine bubbles and the bar
// swipe through Recent (on for everyone since the switch wizard/apps-panel went, like the four-section phone bar since #1956).
// Phones 393 and 360 px wide (QA_CASES=412 for pitch shots), Nebula and Light (obsidian-light), a synthetic box with six
// apps installed (one with a long name) and a Recent list. It checks every ask of the issue: the panel's place,
// size, rows and order; search and Enter; All apps; Edit (stars, drag, minus); the long-press menu; the Recent x; closing
// by a tap outside, Back, a swipe right and a swipe down; picking an app; the empty state; Favorites and the Recent x
// saved to ui-preferences and read on a second device; the nine bubbles (sizes, spacing, reach, newest bottom-right,
// slide and release, release outside cancels); a bar swipe (tile, gap, orb) steps one recent app with Apps in front and
// stops at the ends, while Home keeps today's section swipe; 44 px targets, no overflow, no number on the orb.
// Synthetic transport only (no box is reached). Shots and a report go to QA_OUT.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = 'https://apps-panel.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'apps-panel-evidence');
const ANDROID = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36';
const CASES = [{ name: '393', width: 393, height: 852 }, { name: '360', width: 360, height: 780 }, { name: '412', width: 412, height: 915, only: true }]
  .filter(c => process.env.QA_CASES ? process.env.QA_CASES.split(',').includes(c.name) : !c.only);
const SKINS = (process.env.QA_SKINS || 'nebula,obsidian-light').split(',');
const LONG = 'Wizard Extraordinarily Long Application Name';
const APPS = [['messenger', 'Messenger'], ['notes', 'Notes'], ['wizard-music', 'Music'], ['wizard-calendar', 'Calendar'], ['wizard-podcasts', 'Podcasts'], ['wizard-long', LONG]]
  .map(([id, name]) => ({ id, name, url: `/${id}/`, source: 'apps.json', kind: 'wizard' }));
const RECENT = ['wizard-music', 'notes', 'wizard-calendar', 'wizard-podcasts', 'wizard-long'];
fs.mkdirSync(out, { recursive: true });
const nap = ms => new Promise(r => setTimeout(r, ms));

async function boot(browser, c, skin, prefs, { recent = RECENT, local = {} } = {}) {
  const context = await browser.newContext({ viewport: { width: c.width, height: c.height }, isMobile: true, hasTouch: true, serviceWorkers: 'block', userAgent: ANDROID });
  const puts = [];
  await context.routeWebSocket('**/*', w => w.close());
  await context.addInitScript(({ skin, APPS, recent, local }) => {
    if (window !== top || sessionStorage.getItem('qa-seeded')) return;
    sessionStorage.setItem('qa-seeded', '1');
    const seed = { 'wux.apps.v1': JSON.stringify(APPS), 'wos.shell': 'phone', 'wux.shell': 'phone', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.tour.done': '1', 'wos.welcome.v1': 'done', 'wos.voiceTipSeen': 'true', 'wos.skin': skin,
      'wos.recent': JSON.stringify(recent), ...local };
    for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
  }, { skin, APPS, recent, local });
  await context.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url()), p = u.pathname, method = q.method();
    if (u.origin !== origin) return r.abort();
    if (p.includes('/v1/runs')) return r.abort();
    if (APPS.some(a => p.startsWith(a.url))) return r.fulfill({ contentType: 'text/html', body: `<!doctype html><meta name="viewport" content="width=device-width"><body style="margin:0;background:#26324d;color:#fff;font:22px system-ui"><h1 style="margin:24px">${p.split('/')[1]}</h1><div style="height:3000px"></div></body>` });
    if (p.startsWith(prefix)) {
      const abs = path.resolve(web, decodeURIComponent(p.slice(prefix.length) || 'index.html'));
      if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
      return fs.existsSync(abs) && fs.statSync(abs).isFile() ? r.fulfill({ path: abs }) : r.fulfill({ status: 404, body: 'none' });
    }
    // PATCH: the Agent Service's item operations (wizard-ux#2047: the panel sends add / remove / move one app id);
    // puts records the box after every write.
    if (p === '/wizard/v1/ui-preferences' && method === 'PATCH') {
      for (const o of JSON.parse(q.postData() || '{}').ops || []) {
        const had = Array.isArray(prefs[o.key]) ? prefs[o.key] : [], l = had.filter(x => x !== o.item), n = (o.items || []).find(x => l.includes(x));
        prefs[o.key] = o.op === 'remove' ? l : o.op === 'add' ? (had.includes(o.item) ? had : l.concat(o.item)) : !had.includes(o.item) ? had : n ? [...l.slice(0, l.indexOf(n)), o.item, ...l.slice(l.indexOf(n))] : l.concat(o.item);
      }
      puts.push(JSON.parse(JSON.stringify(prefs))); return r.fulfill({ json: prefs });
    }
    if (p === '/wizard/v1/ui-preferences' && method === 'PUT') { const body = JSON.parse(q.postData() || '{}'); puts.push(body); Object.assign(prefs, body); return r.fulfill({ json: prefs }); }
    if (!['GET', 'HEAD'].includes(method)) return r.fulfill({ json: { ok: true, state: { initializedAt: 1, threads: {} } } });
    if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
    if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: prefs });
    if (p === '/wizard/v1/setup') return r.fulfill({ json: { first_run: false, seen: true } });
    if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { object: 'list', data: [], has_more: false, limit: 100, offset: 0, snapshot: 'qa-apps-panel' } });
    if (p === '/wizard/thread-seen') return r.fulfill({ json: { state: { initializedAt: 1, threads: {} } } });
    if (p === '/wizard/v1/boomerangs') return r.fulfill({ json: { reminders: [] } });
    return r.fulfill({ json: ownerRead(p) });
  });
  const page = await context.newPage(), errors = []; page.setDefaultTimeout(15000);
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + prefix + 'index.html?phone');
  await page.waitForFunction(() => window.__wos && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
  await page.waitForFunction(() => document.querySelector('.sec-tile'));
  await nap(900);
  await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
  return { context, page, errors, puts };
}

const state = page => page.evaluate(() => {
  const P = WizCore.phoneSections, A = WizCore.appsPanel, d = __wos.desks[__wos.idx], w = d && __wos.wins[d.focus];
  const vis = el => !!el && !el.hidden && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
  return { cur: P ? P.current() : null, sheet: __wos.sheet, front: d?.home ? 'home' : w ? (w.appId || w.app) : '',
    panel: vis(document.querySelector('#appsPanel')), grid: vis(document.querySelector('#appsGrid')), favs: A ? A.favorites() : null, recent: A ? A.recent() : null,
    appsLabel: document.querySelector('.sec-tile[data-sec="apps"] .sec-nm')?.textContent || '', toast: document.querySelector('#toast.show')?.textContent || '',
    orbNum: (b => b && !b.hidden && getComputedStyle(b).display !== 'none' && b.getBoundingClientRect().width > 0 ? b.textContent : '')(document.querySelector('#orbBadge')) };
});
// The panel as a person sees it: its box, each part top to bottom, row sizes, what overflows.
const panel = page => page.evaluate(() => {
  const box = el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom }; };
  const el = document.querySelector('#appsPanel'), body = el.querySelector('.ap-body'), dock = { top: Math.min(document.querySelector('#dock .sec-tile').getBoundingClientRect().top, document.querySelector('#orbWrap').getBoundingClientRect().top) }; // the bar's top: its tiles or the orb, whichever is higher
  const parts = [];
  for (const n of el.querySelectorAll('.ap-top, .ap-h, .ap-row, .ap-empty, .ap-add, .ap-none')) {
    if (n.classList.contains('ap-top')) parts.push('search');
    else if (n.classList.contains('ap-h')) parts.push('h:' + n.querySelector('.ap-ht').textContent.trim() + (n.querySelector('[data-apedit]') ? '+edit' : '') + (n.querySelector('[data-apdone]') ? '+done' : ''));
    else if (n.classList.contains('ap-row')) parts.push((n.querySelector('.ap-x') ? 'x:' : n.querySelector('.ap-star') ? (n.querySelector('.ap-star.on') ? '*:' : 'o:') : '') + n.dataset.aprow);
    else parts.push(n.className.replace('ap-', '') + ':' + n.textContent.trim());
  }
  const targets = [...el.querySelectorAll('button, input, [data-apdrag]')].filter(b => b.getClientRects().length).map(b => { const r = b.getBoundingClientRect(); return { k: b.dataset.apopen ? 'row' : b.className || b.tagName, w: Math.round(r.width), h: Math.round(r.height) }; });
  const icons = [...el.querySelectorAll('.ap-ic')].map(i => Math.round(i.getBoundingClientRect().width));
  const names = [...el.querySelectorAll('.ap-nm')].map(n => ({ t: n.textContent, fs: getComputedStyle(n).fontSize, cut: n.scrollWidth > n.clientWidth + 1, ell: getComputedStyle(n).textOverflow }));
  const cs = getComputedStyle(el), bg = cs.backgroundColor, a = /rgba?\(([^)]+)\)/.exec(bg)?.[1].split(',').map(Number);
  return { box: box(el), dockTop: dock.top, width: innerWidth, height: innerHeight, scrollW: document.documentElement.scrollWidth, parts, targets, icons, names,
    bodyScroll: body.scrollHeight > body.clientHeight + 1, opaque: !a || a.length < 4 || a[3] === 1, bg, image: cs.backgroundImage.slice(0, 80), color: cs.color, radius: cs.borderTopLeftRadius,
    rows: [...el.querySelectorAll('.ap-row')].map(r => Math.round(r.getBoundingClientRect().height)),
    scrim: (s => s && !s.hidden ? +getComputedStyle(s).opacity : 0)(document.querySelector('#apScrim')) };
});
const bubbles = page => page.evaluate(() => {
  const t = document.querySelector('.sec-tile[data-sec="apps"]').getBoundingClientRect(), tc = { x: t.left + t.width / 2, y: t.top + t.height / 2 };
  const all = [...document.querySelectorAll('#appsGrid .ap-bub')].map(b => { const i = b.querySelector('.ap-bi').getBoundingClientRect(), n = b.querySelector('.ap-bn');
    return { id: b.dataset.apbub, x: i.left + i.width / 2, y: i.top + i.height / 2, d: Math.round(i.width), name: n.textContent, cut: n.scrollWidth > n.clientWidth + 1, glyph: Math.round(b.querySelector('.ap-bi .sgi, .ap-bi .sglogo')?.getBoundingClientRect().width || 0) }; });
  const dist = all.map(b => Math.round(Math.hypot(b.x - tc.x, b.y - tc.y)));
  const xs = [...new Set(all.map(b => Math.round(b.x)))].sort((a, b) => a - b), ys = [...new Set(all.map(b => Math.round(b.y)))].sort((a, b) => a - b);
  const br = all.reduce((m, b) => (!m || b.x + b.y > m.x + m.y ? b : m), null);
  const g = document.querySelector('#appsGrid').getBoundingClientRect();
  return { n: all.length, ids: all.map(b => b.id), sizes: [...new Set(all.map(b => b.d))], glyphs: [...new Set(all.map(b => b.glyph))], maxDist: Math.max(...dist), xs, ys,
    dx: xs.slice(1).map((x, i) => x - xs[i]), dy: ys.slice(1).map((y, i) => y - ys[i]), bottomRight: br?.id, cut: all.filter(b => b.cut).map(b => b.id), inScreen: g.left >= 0 && g.right <= innerWidth && g.top >= 0 };
});

(async () => {
  const browser = await chromium.launch(), report = [];
  let failed = 0;
  try {
    for (const c of CASES) for (const skin of SKINS) {
      const tag = `${c.name}-${skin}`, steps = { tag }, prefs = { migrations: { 'launcher-seed-v1': true, 'launcher.v1': true }, spaces: [], pinnedChats: [] };
      const { context, page, errors, puts } = await boot(browser, c, skin, prefs);
      const shot = s => page.screenshot({ path: path.join(out, `${tag}-${s}.png`) });
      const cdp = await context.newCDPSession(page);
      const center = sel => page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; }, sel);
      const touch = async (pts, holdMs = 40, stepMs = 16) => {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pts[0]] });
        if (pts.length === 1) await nap(holdMs);
        for (const p of pts.slice(1)) { await nap(stepMs); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [p] }); }
        if (pts.length > 1) await nap(holdMs);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      };
      const tapAt = async p => { await page.touchscreen.tap(p.x, p.y); await nap(500); };
      const tap = async sel => tapAt(await center(sel));
      const sideways = async (p, dx, stepMs = 16) => { await touch([p, ...[1, 2, 3, 4, 5].map(k => ({ x: p.x + dx * k / 5, y: p.y }))], 10, stepMs); await nap(1100); };
      const APPS_TILE = '.sec-tile[data-sec="apps"]';
      try {
        // 1-3) First tap: the panel, a new owner: no favorites yet, the empty line and Add favorites, then Recent with x.
        await tap(APPS_TILE); await nap(400); steps.first = await state(page); steps.p0 = await panel(page); await shot('panel-empty');
        assert.ok(steps.first.panel && steps.first.sheet == null, 'Apps opens the panel, not the Apps sheet');
        assert.deepEqual(steps.p0.parts, ['search', 'h:Favorites', 'empty:Star apps to keep them here', 'add:Add favorites', 'h:Recent', 'x:wizard-music', 'x:notes', 'x:wizard-calendar', 'x:wizard-podcasts'], `empty state then Recent (${steps.p0.parts})`);
        const b0 = steps.p0.box;
        assert.ok(Math.abs(b0.w - Math.max(190, c.width * .54)) <= 2, `about 54% wide, at least 190 px (${b0.w} of ${c.width})`);
        assert.ok(c.width - b0.r <= 8 && b0.r <= c.width, `anchored to the right edge (${c.width - b0.r} px in)`);
        assert.ok(b0.b <= steps.p0.dockTop + 1 && steps.p0.dockTop - b0.b < 24, `rises from the bar (${b0.b} vs the tiles at ${steps.p0.dockTop})`);
        assert.ok(!steps.p0.bodyScroll && b0.h < c.height * .7, `its height fits its content (${b0.h})`);
        assert.ok(steps.p0.opaque, `opaque (${steps.p0.bg})`); assert.ok(parseFloat(steps.p0.radius) >= 12, 'rounded'); assert.ok(steps.p0.scrim > .5, 'the rest dims');
        // 15) the orb: no number, untouched.
        assert.equal(steps.first.orbNum, '', 'no number on the orb');
        // 3) Add favorites: All apps with stars; star Notes, Music, Calendar; Done.
        await page.click('#appsPanel [data-apadd]'); await nap(300); steps.add = await panel(page); await shot('panel-add');
        assert.equal(steps.add.parts[1], 'h:Add favorites+done'); assert.ok(steps.add.parts.filter(p => p.startsWith('o:')).length >= 6, 'every app has a star');
        for (const id of ['notes', 'wizard-music', 'wizard-calendar']) { await page.click(`#appsPanel [data-apstar="${id}"]`); await nap(150); }
        steps.added = await panel(page); assert.deepEqual(steps.added.parts.filter(p => p.startsWith('*:')).sort(), ['*:notes', '*:wizard-calendar', '*:wizard-music']);
        await page.click('#appsPanel [data-apdone]'); await nap(300); steps.edit = await panel(page); await shot('panel-edit');
        assert.deepEqual(steps.edit.parts.slice(0, 2), ['search', 'h:Favorites+done'], 'back in Edit');
        // 6) Edit: drag Calendar to the top, minus on Notes, Done.
        const from = await center('#appsPanel [data-apdrag="wizard-calendar"]'), to = await center('#appsPanel [data-aprow="notes"]');
        await touch([from, { x: from.x, y: from.y - 20 }, { x: from.x, y: to.y - 30 }, { x: from.x, y: to.y - 34 }], 80, 40); await nap(400);
        steps.dragged = (await state(page)).favs; assert.deepEqual(steps.dragged, ['wizard-calendar', 'notes', 'wizard-music'], `drag reorders (${steps.dragged})`);
        await page.click('#appsPanel [data-apminus="notes"]'); await nap(300);
        await page.click('#appsPanel [data-apdone]'); await nap(300);
        steps.p1 = await panel(page); steps.s1 = await state(page); await shot('panel');
        assert.deepEqual(steps.s1.favs, ['wizard-calendar', 'wizard-music'], 'minus removed Notes');
        assert.deepEqual(steps.p1.parts, ['search', 'h:Favorites+edit', 'wizard-calendar', 'wizard-music', 'h:Recent', 'x:notes', 'x:wizard-podcasts', 'x:wizard-long'], `Favorites then Recent without them (${steps.p1.parts})`);
        assert.ok(puts.some(b => JSON.stringify(b.appFavorites) === JSON.stringify(['wizard-calendar', 'wizard-music'])), 'Favorites saved to the box (ui-preferences appFavorites)');
        // 2, 15) Rows: 44 px, 24 px icons, 14 px names; every target 44 px; the long name ends in an ellipsis; no overflow.
        assert.ok(steps.p1.rows.every(h => h === 44), `rows 44 px (${steps.p1.rows})`); assert.ok(steps.p1.icons.every(w => w === 24), `24 px icons (${steps.p1.icons})`);
        assert.ok(steps.p1.names.every(n => n.fs === '14px'), '14 px names');
        const small = steps.p1.targets.filter(t => t.h < 44 && t.k !== 'INPUT' || (t.k !== 'row' && t.k !== 'INPUT' && t.w < 36));
        const field = await page.evaluate(() => Math.round(document.querySelector('#appsPanel .ap-q').getBoundingClientRect().height)); assert.ok(field >= 44, `the search field is a 44 px target (${field})`); assert.deepEqual(small, [], `44 px targets (${JSON.stringify(small)})`);
        const long = steps.p1.names.find(n => n.t === LONG); assert.ok(long && long.cut && long.ell === 'ellipsis', 'a long name ends in an ellipsis');
        assert.equal(steps.p1.scrollW, steps.p1.width, 'no horizontal overflow');
        // 7) Long-press a Recent row: Add to Favorites, and Add to Home Screen (ux#2001).
        const lp = await center('#appsPanel [data-apopen="wizard-podcasts"]'); await touch([lp], 700); await nap(400);
        steps.menu = await page.evaluate(() => [...document.querySelectorAll('.wos-context-menu [role="menuitem"], .wos-context-menu button')].map(b => b.textContent.trim())); await shot('panel-menu');
        assert.deepEqual(steps.menu, ['Add to Favorites', 'Add to Home Screen'], `long-press menu (${steps.menu})`);
        await page.getByRole('menuitem', { name: 'Add to Favorites', exact: true }).click(); await nap(300);
        steps.s2 = await state(page); assert.deepEqual(steps.s2.favs, ['wizard-calendar', 'wizard-music', 'wizard-podcasts'], 'added from the menu');
        assert.ok(steps.s2.panel, 'the panel stays');
        // 7b) Long-press a Favorite: Add to Home Screen opens the home-screen sheet for that app (ux#2001).
        await touch([await center('#appsPanel [data-apopen="wizard-calendar"]')], 700); await nap(400);
        await page.getByRole('menuitem', { name: 'Add to Home Screen', exact: true }).click(); await nap(500);
        steps.pin = await page.evaluate(() => { const s = document.querySelector('.home-pin-sheet'), r = s?.getBoundingClientRect(); return s ? { label: s.getAttribute('aria-label'), shown: r.width > 0 && r.height > 0 } : null; });
        await shot('panel-home-pin');
        assert.ok(steps.pin?.shown && /Calendar/.test(steps.pin.label), `the home-screen sheet opens for Calendar (${JSON.stringify(steps.pin)})`);
        assert.equal(await page.evaluate(() => window.WizHomeScreenApps.back()), true); await nap(300);
        // 14) The x on a Recent row: off Recent (on the box too), the next one moves up; not unfavorited or uninstalled.
        const before = steps.s2.recent;
        await page.click('#appsPanel [data-apx="notes"]'); await nap(300); steps.s3 = await state(page);
        assert.ok(!steps.s3.recent.includes('notes') && before.includes('notes'), `Notes off Recent (${steps.s3.recent})`);
        assert.ok(puts.some(b => Array.isArray(b.appRecentHidden) && b.appRecentHidden.includes('notes')), 'saved to the box (appRecentHidden)');
        assert.ok(await page.evaluate(() => !!WizCore.apps('mobile').APP.notes), 'Notes is still installed');
        assert.equal((await panel(page)).parts.filter(p => p.startsWith('x:')).length, Math.min(4, before.length - 1), 'the next one moved up');
        // 4) Search: matching apps, best first, Enter opens the best.
        await page.fill('#appsPanel [data-apq]', 'cal'); await nap(250); steps.search = await panel(page); await shot('panel-search');
        assert.equal(steps.search.parts[1], 'wizard-calendar', `best match first (${steps.search.parts})`); assert.ok(!steps.search.parts.some(p => p.startsWith('h:')), 'Favorites and Recent are replaced');
        await page.press('#appsPanel [data-apq]', 'Enter'); await nap(1500);
        steps.opened = await state(page); await shot('calendar');
        assert.ok(!steps.opened.panel, 'the panel closed'); assert.equal(steps.opened.cur, 'apps'); assert.equal(steps.opened.front, 'wizard-calendar'); assert.equal(steps.opened.appsLabel, 'Calendar', 'the tile shows the app');
        // 5) All apps: A-Z from A, a back arrow, taller, search filters it.
        await tap(APPS_TILE); await nap(300); assert.ok((await state(page)).panel, 'a tap on Apps with the app in front opens the panel over it');
        await page.click('#appsPanel [data-apall]'); await nap(300); steps.all = await panel(page); await shot('panel-all');
        const names = await page.evaluate(() => [...document.querySelectorAll('#appsPanel .ap-row .ap-nm')].map(n => n.textContent));
        assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })), 'A-Z'); assert.equal(steps.all.parts[1], 'h:All apps');
        assert.ok(await page.evaluate(() => !!document.querySelector('#appsPanel [data-apback]')), 'a back arrow');
        assert.ok(steps.all.box.h > steps.p1.box.h, 'grows taller');
        await page.fill('#appsPanel [data-apq]', 'mu'); await nap(250); steps.allq = await panel(page); assert.equal(steps.allq.parts[1], 'wizard-music', 'search filters it');
        await page.fill('#appsPanel [data-apq]', ''); await page.click('#appsPanel [data-apback]'); await nap(250); assert.equal((await panel(page)).parts[1], 'h:Favorites+edit', 'back arrow returns');
        // 8) Closing: the tile again, a tap outside, Back, a swipe right, a swipe down.
        await tap(APPS_TILE); steps.c0 = (await state(page)).panel;
        await tap(APPS_TILE); await page.touchscreen.tap(30, 120); await nap(400); steps.c1 = (await state(page)).panel;
        await tap(APPS_TILE); await page.evaluate(() => __wos.onBack()); await nap(400); steps.c2 = (await state(page)).panel;
        await tap(APPS_TILE); const pm = await center('#appsPanel .ap-h'); await touch([pm, { x: pm.x + 40, y: pm.y }, { x: pm.x + 90, y: pm.y + 4 }, { x: pm.x + 120, y: pm.y + 6 }], 20); await nap(400); steps.c3 = (await state(page)).panel;
        await tap(APPS_TILE); const pt = await center('#appsPanel .ap-h'); await touch([pt, { x: pt.x, y: pt.y + 40 }, { x: pt.x + 2, y: pt.y + 90 }, { x: pt.x + 4, y: pt.y + 120 }], 20); await nap(400); steps.c4 = (await state(page)).panel;
        assert.deepEqual([steps.c0, steps.c1, steps.c2, steps.c3, steps.c4], [false, false, false, false, false], 'tile, outside, Back, swipe right, swipe down all close it');
        assert.equal((await state(page)).front, 'wizard-calendar', 'the app is untouched');
        // 11-12) Hold Apps: nine bubbles, recent first, newest bottom-right; slide onto one and let go opens it.
        const tc = await center(APPS_TILE);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [tc] }); await nap(750);
        steps.grid = await bubbles(page); steps.gs = await state(page); await shot('grid');
        assert.ok(steps.gs.grid && !steps.gs.panel, 'holding Apps shows the bubbles');
        assert.equal(steps.grid.n, Math.min(9, steps.grid.n)); assert.ok(steps.grid.n >= 6, `up to nine (${steps.grid.n})`);
        assert.equal(steps.grid.bottomRight, 'wizard-calendar', `the most recent bottom-right (${steps.grid.bottomRight})`);
        assert.ok(steps.grid.sizes.every(d => d >= 56 && d <= 60), `56-60 px bubbles (${steps.grid.sizes})`);
        assert.ok(steps.grid.glyphs.every(g => g >= 22 && g <= 30), `about 26 px icons (${steps.grid.glyphs})`);
        assert.ok([...steps.grid.dx, ...steps.grid.dy].every(v => v >= 68 && v <= 72), `68-72 px apart (${steps.grid.dx} / ${steps.grid.dy})`);
        if (c.width === 360) assert.ok(steps.grid.maxDist <= 250, `every bubble within 250 px of the tile at 360 px (${steps.grid.maxDist})`);
        assert.ok(steps.grid.inScreen, 'on screen');
        const target = await page.evaluate(() => { const b = [...document.querySelectorAll('#appsGrid .ap-bub')].find(x => x.dataset.apbub === 'wizard-music').querySelector('.ap-bi').getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }; });
        for (let k = 1; k <= 6; k++) { await nap(30); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: tc.x + (target.x - tc.x) * k / 6, y: tc.y + (target.y - tc.y) * k / 6 }] }); }
        await nap(200); steps.hot = await page.evaluate(() => document.querySelector('#appsGrid .ap-bub.hot')?.dataset.apbub || ''); await shot('grid-hot');
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await nap(1500);
        steps.fromGrid = await state(page);
        assert.equal(steps.hot, 'wizard-music', 'the bubble under the finger lights up');
        assert.ok(!steps.fromGrid.grid, 'the bubbles go away'); assert.equal(steps.fromGrid.front, 'wizard-music', 'release opens it'); assert.ok(!steps.fromGrid.panel, 'and no panel');
        // Release outside: nothing opens.
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [tc] }); await nap(500);
        for (let k = 1; k <= 4; k++) { await nap(30); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 40, y: tc.y - 40 * k }] }); }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await nap(900);
        steps.cancel = await state(page); assert.ok(!steps.cancel.grid && !steps.cancel.panel, 'released outside: closed'); assert.equal(steps.cancel.front, 'wizard-music', 'nothing opened');
        // 13) Apps in front: a bar swipe steps one recent app (left = older), stops at the ends; tile, gap and orb.
        steps.list = await page.evaluate(() => WizCore.appsPanel.stepList());
        const home = await center('.sec-tile[data-sec="home"]');
        await sideways(home, -60); steps.step1 = await state(page);
        assert.equal(steps.step1.front, steps.list[1], `swipe left: the next older (${steps.list} -> ${steps.step1.front})`); assert.equal(steps.step1.cur, 'apps'); assert.equal(steps.step1.appsLabel, APPS.find(a => a.id === steps.list[1]).name, 'the tile follows');
        await sideways(await center(APPS_TILE), -60); steps.step2 = await state(page); assert.equal(steps.step2.front, steps.list[2], 'swipe left on the Apps tile: one more');
        const gap = await page.evaluate(() => { const a = document.querySelector('.sec-tile[data-sec="slot"]').getBoundingClientRect(), o = document.querySelector('#orbWrap').getBoundingClientRect(); return { x: Math.round((o.right + a.left) / 2), y: Math.round(a.top + a.height / 2) }; });
        await sideways(gap, 60); steps.step3 = await state(page); assert.equal(steps.step3.front, steps.list[1], 'swipe right in a gap: back toward the newest');
        const orb = await center('#orb'); await touch([orb, ...[1, 2, 3, 4].map(k => ({ x: orb.x + 20 * k, y: orb.y }))], 20); await nap(1100);
        steps.step4 = await state(page); assert.equal(steps.step4.front, steps.list[0], 'the orb\'s sideways drag: one more toward the newest');
        await sideways(home, 60); steps.step5 = await state(page); assert.equal(steps.step5.front, steps.list[0], 'at the newest it stays (no wrap)');
        await shot('step');
        for (let k = 0; k < steps.list.length + 1; k++) await sideways(home, -60);
        steps.end = await state(page); assert.equal(steps.end.front, steps.list.at(-1), 'at the oldest it stays');
        // Home in front: today's section swipe.
        await tap('.sec-tile[data-sec="home"]'); await nap(400);
        await sideways(home, -44, 8); steps.homeSwipe = (await state(page)).cur; assert.equal(steps.homeSwipe, 'chats', 'from Home a bar swipe still steps sections');
        // 10) A second device: the same Favorites, and Notes still off Recent until it is opened again.
        const two = await boot(browser, c, skin, prefs, { recent: ['notes', 'wizard-music', 'wizard-podcasts'] });
        await two.page.waitForFunction(() => WizCore.appsPanel.favorites().length === 3, null, { timeout: 8000 }).catch(() => {});
        steps.second = await state(two.page); await two.page.screenshot({ path: path.join(out, `${tag}-second-device.png`) });
        assert.deepEqual(steps.second.favs, ['wizard-calendar', 'wizard-music', 'wizard-podcasts'], 'Favorites on the second device'); assert.ok(!steps.second.recent.includes('notes'), 'Notes off Recent there too');
        await two.context.close();
        // The way a person checks it (issue section 3): open Music, Notes, Calendar one after another, then walk back.
        for (const id of ['wizard-music', 'notes', 'wizard-calendar']) {
          await tap(APPS_TILE); await nap(400); if (!(await state(page)).panel) { await tap(APPS_TILE); await nap(400); }
          await page.click('#appsPanel [data-apall]'); await page.click(`#appsPanel [data-apopen="${id}"]`); await nap(1500);
        }
        steps.walk0 = (await state(page)).front; assert.equal(steps.walk0, 'wizard-calendar');
        await sideways(await center(APPS_TILE), 60); steps.walkR = (await state(page)).front;
        assert.equal(steps.walkR, 'wizard-calendar', 'swipe right on the newest app: it stays (no wrap)');
        await sideways(await center(APPS_TILE), -60); steps.walkL1 = (await state(page)).front;
        await sideways(await center('.sec-tile[data-sec="chats"]'), -60); steps.walkL2 = await state(page);
        assert.deepEqual([steps.walkL1, steps.walkL2.front], ['notes', 'wizard-music'], 'swipe left twice (Apps tile, then Chats tile): Notes, then Music, one at a time');
        assert.equal(steps.walkL2.cur, 'apps', 'it stays in Apps'); assert.equal(steps.walkL2.appsLabel, 'Music', 'the tile follows');
        await sideways(await center('.sec-tile[data-sec="home"]'), 60); steps.walkR2 = (await state(page)).front;
        assert.equal(steps.walkR2, 'notes', 'swipe right: back toward the newest');
        await tap(APPS_TILE); await nap(500); if (!(await state(page)).panel) await tap(APPS_TILE); // from Chats the first tap goes to the app in Apps
        await page.click('#appsPanel [data-apall]'); await page.click('#appsPanel [data-apopen="notes"]'); await nap(1500);
        steps.back = await state(page); assert.equal(steps.back.front, 'notes');
        assert.ok(puts.some(b => Array.isArray(b.appRecentHidden) && !b.appRecentHidden.includes('notes')), 'opened again: back on Recent on the box');
        assert.equal(steps.back.orbNum, '', 'still no number on the orb');
        assert.deepEqual(errors, [], 'no page errors');
        steps.ok = true;
      } catch (e) { failed++; steps.ok = false; steps.error = e.message; await shot('fail').catch(() => {}); } finally { await context.close(); }
      report.push(steps); console.log(JSON.stringify({ tag: steps.tag, ok: steps.ok, error: steps.error || undefined }));
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
  console.log(failed ? `FAIL ${failed}/${report.length}` : `PASS ${report.length}/${report.length}`);
  process.exit(failed ? 1 : 0);
})();
