'use strict';
// wizard-ux issue 1929 in a real browser: the phone bar's four sections around the orb (on for everyone, no switch).
// Phones 393 and 360 px wide, Nebula and Light (obsidian-light), a synthetic box with Messenger, Notes, Music, Calendar
// and Podcasts installed and one chat thread. It checks: Home · Chats · orb · Messenger · Apps, labels that fit,
// 44 px targets, no overflow or overlap, the orb at least today's 44 px; the Chats and Messenger badges; Apps
// steps 1-5 (selector, the app in Apps with its name on the tile, back with no reload, the selector over the app closed
// by a tap outside and by Back, the flip and its toasts, a third app closes the oldest); the Messenger pin and reset
// (saved to ui-preferences phoneSlot); Chats keeps its thread; Back goes thread -> list -> Home and stays; "open Notes"
// by voice; the orb's tap, hold, swipe up and swipe down; sideways swipes step through the sections in bar order.
// A device that saved the old switch wizard/phone-sections as off still gets the bar (the saved choice is cleared).
// Synthetic transport only (no box is reached). Shots and a report go to QA_OUT.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = 'https://phone-sections.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'phone-sections-evidence');
const OLD_SW = 'wizard/phone-sections', NAV = process.env.QA_PHONE_NAV === 'on' ? 'wizard/phone-nav' : '';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36';
const CASES = [{ name: '393', width: 393, height: 852 }, { name: '360', width: 360, height: 780 }, { name: '412', width: 412, height: 915, only: true }]
  .filter(c => process.env.QA_CASES ? process.env.QA_CASES.split(',').includes(c.name) : !c.only);
const SKINS = (process.env.QA_SKINS || 'nebula,obsidian-light').split(',');
const APPS = [['messenger', 'Messenger'], ['notes', 'Notes'], ['wizard-music', 'Music'], ['wizard-calendar', 'Calendar'], ['wizard-podcasts', 'Podcasts']]
  .map(([id, name]) => ({ id, name, url: `/${id}/`, source: 'apps.json', kind: 'wizard' }));
const now = Math.floor(Date.now() / 1000);
const THREAD = { id: 'qa-sections-1', title: 'Synthetic thread', source: 'wizard-mobile', status: 'completed', archived: false, hidden: false, message_count: 2, started_at: now - 600, last_active: now - 300, wizard_last_user_at: now - 400, wizard_last_assistant_at: now - 300, preview: 'Synthetic reply' };
fs.mkdirSync(out, { recursive: true });
const nap = ms => new Promise(r => setTimeout(r, ms));

async function boot(browser, c, skin) {
  const context = await browser.newContext({ viewport: { width: c.width, height: c.height }, isMobile: true, hasTouch: true, serviceWorkers: 'block', userAgent: ANDROID });
  const puts = [];
  await context.routeWebSocket('**/*', w => w.close());
  await context.addInitScript(({ skin, OLD_SW, NAV, APPS }) => {
    if (window !== top) return;
    const seed = { 'wux.apps.v1': JSON.stringify(APPS), 'wos.shell': 'phone', 'wux.shell': 'phone', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.tour.done': '1', 'wos.welcome.v1': 'done', 'wos.voiceTipSeen': 'true', 'wos.skin': skin,
      'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix: { [OLD_SW]: false, ...(NAV ? { [NAV]: true } : {}) } }) };
    for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
  }, { skin, OLD_SW, NAV, APPS });
  const prefs = { migrations: { 'launcher-seed-v1': true, 'launcher.v1': true }, spaces: [], pinnedChats: [] };
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
    if (p === '/wizard/v1/ui-preferences' && method === 'PUT') { const body = JSON.parse(q.postData() || '{}'); puts.push(body); Object.assign(prefs, body); return r.fulfill({ json: prefs }); }
    if (!['GET', 'HEAD'].includes(method)) return r.fulfill({ json: { ok: true, state: { initializedAt: 1, threads: {} } } });
    if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
    if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: prefs });
    if (p === '/wizard/v1/setup') return r.fulfill({ json: { first_run: false, seen: true } });
    if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { object: 'list', data: [THREAD], has_more: false, limit: 100, offset: 0, snapshot: 'qa-sections' } });
    if (/^\/wizard\/hermes\/api\/sessions\/[^/]+\/messages$/.test(p)) return r.fulfill({ json: { object: 'list', has_more: false, data: [{ id: 1, session_id: THREAD.id, role: 'user', content: 'Synthetic question', timestamp: now - 400 }, { id: 2, session_id: THREAD.id, role: 'assistant', content: 'Synthetic answer', timestamp: now - 300 }] } });
    if (/^\/wizard\/hermes\/api\/sessions\/[^/]+$/.test(p)) return r.fulfill({ json: { session: THREAD } });
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
  const P = WizCore.phoneSections, d = __wos.desks[__wos.idx], w = d && __wos.wins[d.focus];
  return { cur: P ? P.current() : null, secs: P ? P.sections() : null, sheet: __wos.sheet, idx: __wos.idx, desks: __wos.desks.length,
    front: d?.home ? 'home' : w ? (w.appId || w.app) + (w.thread ? ':' + w.thread : '') : '',
    tiles: [...document.querySelectorAll('.sec-tile')].map(b => ({ sec: b.dataset.sec, label: b.querySelector('.sec-nm').textContent, on: b.classList.contains('on'), badge: b.querySelector('.sec-bg')?.textContent || '' })),
    toast: document.querySelector('#toast.show')?.textContent || '',
    // wizard-ux#1950: the orb's own count badge, as a person sees it (shown and its number), '' when it is not on screen.
    orbNum: (b => b && !b.hidden && getComputedStyle(b).display !== 'none' && getComputedStyle(b).visibility !== 'hidden' && b.getBoundingClientRect().width > 0 ? b.textContent : '')(document.querySelector('#orbBadge')) };
});
const measure = page => page.evaluate(() => {
  const box = el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  const vis = el => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
  const tiles = [...document.querySelectorAll('.sec-tile')].map(el => { const n = el.querySelector('.sec-nm'); return { sec: el.dataset.sec, ...box(el), cut: n.scrollWidth > n.clientWidth + 1 }; });
  const orb = box(document.querySelector('#orbWrap')), dock = box(document.querySelector('#dock'));
  const all = [...tiles, orb]; let overlaps = 0;
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) { const a = all[i], b = all[j]; if (a.x < b.x + b.w - .5 && b.x < a.x + a.w - .5 && a.y < b.y + b.h - .5 && b.y < a.y + a.h - .5) overlaps++; }
  const covered = tiles.filter(t => document.elementFromPoint(t.x + t.w / 2, t.y + t.h / 2)?.closest('.sec-tile')?.dataset.sec !== t.sec).map(t => t.sec);
  return { tiles, order: tiles.map(t => t.sec), orb: Math.round(orb.w) + 'x' + Math.round(orb.h), overlaps, covered, scrollW: document.documentElement.scrollWidth, width: innerWidth,
    inBar: tiles.every(t => t.x >= -.5 && t.x + t.w <= innerWidth + .5 && t.y >= dock.y - .5), dots: vis(document.querySelector('#dotsL')) || vis(document.querySelector('#dotsR')), plus: vis(document.querySelector('[data-plus]')) };
});

(async () => {
  const browser = await chromium.launch(), report = [];
  let failed = 0;
  try {
    for (const c of CASES) for (const skin of SKINS) {
      const tag = `${c.name}-${skin}`, steps = { tag };
      const { context, page, errors, puts } = await boot(browser, c, skin);
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
      const tap = async sec => { const p = await center(`.sec-tile[data-sec="${sec}"]`); await page.touchscreen.tap(p.x, p.y); await nap(800); };
      const sideways = async (sel, dx, stepMs = 16) => { const p = await center(sel); await touch([p, ...[1, 2, 3, 4, 5].map(k => ({ x: p.x + dx * k / 5, y: p.y }))], 10, stepMs); await nap(900); };
      // The Apps tile's selector is the Favorites panel (wizard-ux#1955, on for everyone): All apps, then the app.
      const panelOpen = () => page.evaluate(() => !!WizCore.appsPanel?.isOpen());
      const openPanel = async () => { await tap('apps'); if (!(await panelOpen())) await tap('apps'); };
      const pick = async id => { await page.click('#appsPanel [data-apall]'); await page.click(`#appsPanel [data-apopen="${id}"]`); await page.waitForFunction(id => { const d = __wos.desks[__wos.idx], w = d && __wos.wins[d.focus]; return w?.appId === id && !__wos.sheet; }, id, { timeout: 8000 }).catch(() => {}); await nap(700); };
      const mark = () => page.evaluate(() => { for (const f of document.querySelectorAll('iframe.appframe')) try { f.contentWindow.__qaMark ||= f.closest('[data-win]').dataset.win + ':' + Math.random(); } catch (_) {} });
      const marks = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('iframe.appframe')].map(f => { try { return [f.contentWindow.location.pathname, f.contentWindow.__qaMark || '']; } catch (_) { return ['?', '']; } })));
      try {
        {
          // 1) The bar: four tiles around today's orb.
          await page.evaluate(() => { WizCore.workspaceNav.setCount('wizard', 12); WizCore.workspaceNav.setCount('messenger', 3); }); await nap(300);
          steps.bar = await measure(page); steps.home = await state(page); await shot('home');
          assert.deepEqual(steps.bar.order, ['home', 'chats', 'slot', 'apps'], 'Home, Chats | orb | Messenger, Apps');
          assert.deepEqual(steps.home.tiles.map(t => t.label), ['Home', 'Chats', 'Messenger', 'Apps'], 'labels');
          const orbX = await center('#orbWrap'); const xs = steps.bar.tiles.map(t => t.x + t.w / 2);
          assert.ok(xs[0] < xs[1] && xs[1] < orbX.x && orbX.x < xs[2] && xs[2] < xs[3], 'two tiles each side of the orb');
          for (const t of steps.bar.tiles) { assert.ok(t.w >= 44 && t.h >= 44, `${t.sec}: a 44 px target (${t.w}x${t.h})`); assert.ok(!t.cut, `${t.sec}: its label fits`); }
          assert.equal(steps.bar.overlaps, 0, 'nothing overlaps'); assert.deepEqual(steps.bar.covered, [], 'nothing covers a tile');
          assert.equal(steps.bar.scrollW, steps.bar.width, 'no horizontal overflow'); assert.ok(steps.bar.inBar, 'every tile on screen');
          assert.ok(!steps.bar.dots && !steps.bar.plus, 'no desk dots and no +');
          { const [ow, oh] = steps.bar.orb.split('x').map(Number); assert.ok(ow >= 44 && oh >= 44, `the orb is today's size or larger (${steps.bar.orb})`); }
          steps.stale = await page.evaluate(id => { const m = JSON.parse(localStorage.getItem('wos.skin-tweaks.v1') || '{}').mix || {}; return Object.hasOwn(m, id); }, OLD_SW);
          assert.equal(steps.stale, false, 'a saved choice for the old switch is cleared');
          assert.ok(steps.home.tiles[0].on && !steps.home.tiles[1].on, 'Home is lit, the others dim');
          // 2) Badges: Chats the unread/Ready count, Messenger its unread count, Apps none.
          assert.deepEqual(steps.home.tiles.map(t => t.badge), ['', '12', '3', ''], 'badges');
          // wizard-ux#1950 (James: "there should be no number above the orb"): the counts live only on the tiles.
          assert.equal(steps.home.orbNum, '', `no number on the orb at Home (${steps.home.orbNum})`);
          // 5) Apps, first tap: the App selector, the Favorites panel (search, Favorites, Recent; wizard-ux#1955).
          await tap('apps'); steps.selector = await state(page); steps.selector.panel = await panelOpen(); await shot('selector');
          assert.ok(steps.selector.panel, 'first Apps tap opens the Favorites panel'); assert.equal(steps.selector.sheet, null, 'not the old Apps sheet');
          steps.selectorParts = await page.evaluate(() => ({ groups: [...document.querySelectorAll('#appsPanel .ap-ht')].map(h => h.textContent.trim()), search: !!document.querySelector('#appsPanel [data-apq]')?.getClientRects().length }));
          assert.deepEqual(steps.selectorParts.groups, ['Favorites', 'Recent'], 'Favorites then Recent'); assert.ok(steps.selectorParts.search, 'the search field');
          // 6) Picking an app: it fills Apps and the tile wears its name.
          await pick('notes'); await mark(); steps.notes = await state(page); await shot('notes');
          assert.equal(steps.notes.cur, 'apps'); assert.equal(steps.notes.front, 'notes'); assert.equal(steps.notes.sheet, null);
          assert.equal(steps.notes.tiles[3].label, 'Notes', 'the Apps tile shows Notes'); assert.ok(steps.notes.tiles[3].on, 'Apps lit');
          const solo = await page.evaluate(() => { const el = document.querySelector('.desk:not(.parked) .win.solo iframe'); return !!el; }); assert.ok(solo, 'the app fills the section');
          // 7) Back to Apps from another section: the same app, not reloaded.
          const m1 = await marks();
          await tap('chats'); steps.chats = await state(page); assert.equal(steps.chats.cur, 'chats');
          await shot('chats'); assert.equal(steps.chats.orbNum, '', `no number on the orb in Chats (${steps.chats.orbNum})`);
          await tap('apps'); steps.back = await state(page); assert.equal(steps.back.cur, 'apps'); assert.equal(steps.back.front, 'notes');
          assert.deepEqual(await marks(), m1, 'Notes was not reloaded');
          // 8) The tile again on the app: the panel over it, dimmed; a tap outside closes it, so does Back.
          await tap('apps'); steps.over = await state(page); steps.over.panel = await panelOpen(); await shot('selector-over-app');
          assert.ok(steps.over.panel); assert.equal(steps.over.cur, 'apps');
          steps.dim = await page.evaluate(() => { const s = document.querySelector('.ap-scrim'); return !!s && !s.hidden && +getComputedStyle(s).opacity; }); assert.ok(steps.dim > .5, 'the app is dimmed behind it');
          await page.mouse.click(16, 20); await nap(600); assert.equal(await panelOpen(), false, 'a tap outside closes it');
          await tap('apps'); await page.evaluate(() => __wos.onBack()); await nap(600);
          steps.afterBack = await state(page); assert.equal(await panelOpen(), false, 'Back closes it'); assert.equal(steps.afterBack.front, 'notes', 'the app is untouched');
          assert.deepEqual(await marks(), m1, 'still not reloaded');
          // 9) The flip with one app, from Home (with Apps in front a swipe steps through Recent: qa-apps-panel.cjs).
          await tap('home'); await sideways('.sec-tile[data-sec="apps"]', -60); steps.flipOne = await state(page);
          assert.match(steps.flipOne.toast, /Open a second app to flip between them/); assert.equal(steps.flipOne.front, 'home');
          // A second app replaces Notes in Apps; the flip from Home goes back and forth with a toast, nothing reloads.
          await page.evaluate(() => __wos.closeSheets()); await openPanel(); await pick('wizard-music'); await mark();
          steps.music = await state(page); assert.equal(steps.music.front, 'wizard-music'); assert.equal(steps.music.tiles[3].label, 'Music');
          const m2 = await marks();
          await tap('home'); await sideways('.sec-tile[data-sec="apps"]', -60); steps.flip = await state(page); await shot('flip');
          assert.equal(steps.flip.front, 'notes'); assert.match(steps.flip.toast, /Notes ⇄ Music/); assert.equal(steps.flip.tiles[3].label, 'Notes');
          await tap('home'); await sideways('.sec-tile[data-sec="apps"]', 60); steps.flipBack = await state(page);
          assert.equal(steps.flipBack.front, 'wizard-music'); assert.match(steps.flipBack.toast, /Music ⇄ Notes/);
          assert.deepEqual(await marks(), m2, 'flipping reloads neither app');
          // A third app: only the last two stay open.
          await openPanel(); await pick('wizard-calendar'); steps.third = await state(page);
          steps.thirdFrames = Object.keys(await marks()).sort();
          assert.equal(steps.third.front, 'wizard-calendar'); assert.ok(!steps.thirdFrames.includes('/notes/'), `the oldest app closed (${steps.thirdFrames})`);
          // 10) Messenger: tap opens it; a long-press pins another app; Reset brings Messenger back.
          await tap('slot'); steps.slot = await state(page); assert.equal(steps.slot.cur, 'slot'); assert.equal(steps.slot.front, 'messenger');
          assert.equal(steps.slot.orbNum, '', `no number on the orb in Messenger (${steps.slot.orbNum})`);
          const sp = await center('.sec-tile[data-sec="slot"]'); await touch([sp], 650); await nap(700);
          steps.pin = await page.evaluate(() => ({ sheet: __wos.sheet, title: document.querySelector('#launcherBody .sec-pin h4')?.textContent, apps: [...document.querySelectorAll('#launcherBody [data-secpin]')].map(b => b.dataset.secpin), reset: document.querySelector('#launcherBody [data-secreset]')?.textContent }));
          await shot('pin');
          assert.equal(steps.pin.sheet, 'launcher'); assert.equal(steps.pin.title, 'Pin an app here'); assert.ok(steps.pin.apps.includes('wizard-podcasts')); assert.equal(steps.pin.reset, 'Reset to Messenger');
          await page.click('#launcherBody [data-secpin="wizard-podcasts"]'); await nap(1300);
          steps.pinned = await state(page); steps.pinStored = await page.evaluate(() => localStorage.getItem('wos.phone.slot.v1'));
          assert.equal(steps.pinned.tiles[2].label, 'Podcasts', 'the slot shows the pinned app'); assert.equal(steps.pinned.tiles[2].badge, '', 'no Messenger badge on a pinned app');
          assert.equal(steps.pinned.front, 'wizard-podcasts', 'the slot opens the pinned app'); assert.equal(steps.pinStored, 'wizard-podcasts');
          assert.ok(puts.some(b => b.phoneSlot === 'wizard-podcasts'), 'the pin is saved to the box (ui-preferences phoneSlot)');
          await shot('pinned');
          await touch([sp], 650); await nap(700); await page.click('#launcherBody [data-secreset]'); await nap(1200);
          steps.reset = await state(page);
          assert.equal(steps.reset.tiles[2].label, 'Messenger'); assert.equal(steps.reset.tiles[2].badge, '3', 'Messenger badge back');
          assert.ok(puts.some(b => b.phoneSlot === ''), 'the reset is saved to the box');
          // 11) Chats keeps its place; Back: thread -> list -> Home, then stays on Home.
          await page.evaluate(id => __wos.openWizardThread(id), THREAD.id); await nap(1200);
          steps.thread = await state(page); assert.equal(steps.thread.cur, 'chats'); assert.equal(steps.thread.front, 'chats:' + THREAD.id, 'a chat opened from a link or notification lands in Chats');
          await tap('home'); await tap('chats'); steps.threadAgain = await state(page); await shot('chats-thread');
          assert.equal(steps.threadAgain.front, 'chats:' + THREAD.id, 'Chats comes back to the open thread');
          await page.evaluate(() => __wos.onBack()); await nap(700); steps.back1 = await state(page); assert.equal(steps.back1.front, 'chats', 'Back: the thread goes back to the list');
          await page.evaluate(() => __wos.onBack()); await nap(700); steps.back2 = await state(page); assert.equal(steps.back2.cur, 'home', 'Back: then Home');
          await page.evaluate(() => __wos.onBack()); await nap(500); steps.back3 = await state(page); assert.equal(steps.back3.cur, 'home', 'Back at Home stays on Home');
          // 12) "open Notes" by voice opens it in Apps.
          await page.evaluate(() => __wos.runUtterance('open notes', 'command', true)); await nap(1500);
          steps.voice = await state(page); assert.equal(steps.voice.cur, 'apps'); assert.equal(steps.voice.front, 'notes'); assert.equal(steps.voice.tiles[3].label, 'Notes');
          // 4) Sideways swipes step through the sections in bar order: a flick on the bar, a slow scrub, the orb.
          await page.evaluate(() => __wos.goDesk(0)); await nap(700);
          await sideways('.sec-tile[data-sec="home"]', -44, 8); steps.flick1 = (await state(page)).cur;
          await sideways('.sec-tile[data-sec="chats"]', -44, 8); steps.flick2 = (await state(page)).cur;
          await sideways('.sec-tile[data-sec="slot"]', 44, 8); steps.flick3 = (await state(page)).cur;
          assert.deepEqual([steps.flick1, steps.flick2, steps.flick3], ['chats', 'slot', 'chats'], 'a flick on the bar moves one section');
          await page.evaluate(() => __wos.goDesk(0)); await nap(700);
          await sideways('.sec-tile[data-sec="home"]', -80, 120); steps.scrub = (await state(page)).cur;
          assert.equal(steps.scrub, 'apps', 'a slow scrub three steps along lands on Apps, never on a hidden desk');
          await page.evaluate(() => __wos.goDesk(0)); await nap(700);
          const orbAt = await center('#orb');
          await touch([orbAt, ...[1, 2, 3, 4].map(k => ({ x: orbAt.x - 20 * k, y: orbAt.y }))], 20); await nap(900);
          steps.orbSide = (await state(page)).cur; assert.notEqual(steps.orbSide, 'home', 'a sideways swipe on the orb moves to another section');
          assert.ok(['chats', 'slot', 'apps'].includes(steps.orbSide));
          // The orb itself: tap talks, hold is a command, swipe up opens the App selector, swipe down hides the bars.
          await page.evaluate(() => { __wos.goDesk(0); navigator.mediaDevices && (navigator.mediaDevices.getUserMedia = () => new Promise(() => {})); }); await nap(700);
          const voice = () => page.evaluate(() => document.querySelector('#device').dataset.voice || __wos.voice || 'idle');
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [orbAt] }); await nap(650);
          steps.orbHold = await page.evaluate(() => __wos.V.kind + ':' + __wos.voice);
          // wizard-ux#1958: the hold is the plain hold-to-command; the radial Orb switcher never opens over the bar.
          steps.orbHoldRadial = await page.evaluate(() => !!document.querySelector('.wor') || document.body.classList.contains('wor-open') || !!window.WosOrbSwitcher?.isOpen);
          await page.screenshot({ path: path.join(out, `${tag}-hold.png`) });
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await nap(300);
          await page.evaluate(() => { try { __wos.cancelVoice?.(); } catch (_) {} document.querySelector('#arcCancel')?.click(); }); await nap(700);
          await touch([orbAt], 60); await nap(500); steps.orbTap = await voice();
          await page.evaluate(() => { try { __wos.cancelVoice?.(); } catch (_) {} document.querySelector('#arcCancel')?.click(); }); await nap(700);
          await page.waitForFunction(() => __wos.voice === 'idle' && !document.querySelector('#toast.show'), null, { timeout: 8000 }).catch(() => {}); await nap(300);
          await touch([orbAt, { x: orbAt.x, y: orbAt.y - 40 }, { x: orbAt.x, y: orbAt.y - 90 }, { x: orbAt.x, y: orbAt.y - 160 }], 20); await nap(700);
          steps.orbUp = (await state(page)).sheet; await page.evaluate(() => __wos.closeSheets()); await nap(500);
          await touch([orbAt, { x: orbAt.x, y: orbAt.y + 20 }, { x: orbAt.x, y: orbAt.y + 45 }, { x: orbAt.x, y: orbAt.y + 70 }], 20); await nap(700);
          steps.orbDown = await page.evaluate(() => document.querySelector('#device').classList.contains('zen'));
          assert.ok(['listen', 'paused'].includes(steps.orbTap), `orb tap starts a take (${steps.orbTap})`);
          assert.match(steps.orbHold, /^command:/, `orb hold starts a command (${steps.orbHold})`);
          assert.notEqual(steps.orbHold, 'command:idle', `the orb hold actually starts a command take (${steps.orbHold})`);
          assert.equal(steps.orbHoldRadial, false, 'holding the orb never opens the radial Orb switcher (wizard-ux#1958)');
          await page.evaluate(() => __wos.openSettings('phone')); await nap(900);
          await page.screenshot({ path: path.join(out, `${tag}-settings-phone.png`) });
          steps.orbSwitcherRow = await page.evaluate(() => !!window.WosOrbSwitcher?.available || !!document.querySelector('[data-orbsw]'));
          await page.evaluate(() => __wos.closeSheets()); await nap(400);
          assert.equal(steps.orbSwitcherRow, false, 'no Orb switcher row in phone Settings while the bar is on');
          assert.equal(steps.orbUp, 'launcher', 'orb swipe up opens the App selector'); assert.ok(steps.orbDown, 'orb swipe down hides the bars');
          // 360 px and the pinned app's bar at the end, for the record.
          steps.endBar = await measure(page);
        }
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
