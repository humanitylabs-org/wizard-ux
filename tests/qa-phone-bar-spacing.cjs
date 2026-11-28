'use strict';
// wizard-ux issue 1946 in a real browser: the phone bar's four tiles (on for everyone, no switch) are evenly spaced.
// Phones 412, 393 and 360 px wide, Nebula and Light, counts on Chats (12) and Messenger (3), and "WizardOS Tracker" open in
// Apps (a long name). It measures the visual centre of every icon (the ink in a screenshot, labels and badges hidden) and
// the orb's centre, and checks: the four gaps Home-Chats, Chats-orb, orb-Messenger, Messenger-Apps match within 3 px, the bar
// is mirrored around the orb, a badge does not move its icon, labels fit (the long app name may be cut with an ellipsis),
// 44 px targets, nothing overlaps or overflows, the orb is centred and at least today's 44 px.
// QA_EXPECT=broken (with QA_WEB=<main>/web) asserts the uneven gaps that issue 1946 reported on Nebula (the 44 px orb), for
// the baseline; Light's 66 px orb happened to come out nearly even before the fix.
// Synthetic transport only (no box is reached). Shots and a report go to QA_OUT.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = 'https://phone-sections.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'phone-bar-spacing-evidence');
const broken = process.env.QA_EXPECT === 'broken', TOL = 3;
const ANDROID = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36';
const CASES = [{ name: '412', width: 412, height: 915 }, { name: '393', width: 393, height: 852 }, { name: '360', width: 360, height: 780 }]
  .filter(c => !process.env.QA_CASES || process.env.QA_CASES.split(',').includes(c.name));
const SKINS = (process.env.QA_SKINS || 'nebula,obsidian-light').split(',');
const APPS = [['messenger', 'Messenger'], ['notes', 'Notes'], ['wizard-music', 'Music'], ['wizard-calendar', 'Calendar'], ['wizard-podcasts', 'Podcasts'], ['wizardos-tracker', 'WizardOS Tracker']]
  .map(([id, name]) => ({ id, name, url: `/${id}/`, source: 'apps.json', kind: 'wizard' }));
const now = Math.floor(Date.now() / 1000);
const THREAD = { id: 'qa-sections-1', title: 'Synthetic thread', source: 'wizard-mobile', status: 'completed', archived: false, hidden: false, message_count: 2, started_at: now - 600, last_active: now - 300, wizard_last_user_at: now - 400, wizard_last_assistant_at: now - 300, preview: 'Synthetic reply' };
fs.mkdirSync(out, { recursive: true });
const nap = ms => new Promise(r => setTimeout(r, ms));

async function boot(browser, c, skin) {
  const context = await browser.newContext({ viewport: { width: c.width, height: c.height }, isMobile: true, hasTouch: true, serviceWorkers: 'block', userAgent: ANDROID });
  const puts = [];
  await context.routeWebSocket('**/*', w => w.close());
  await context.addInitScript(({ skin, APPS }) => {
    if (window !== top) return;
    const seed = { 'wux.apps.v1': JSON.stringify(APPS), 'wos.shell': 'phone', 'wux.shell': 'phone', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.tour.done': '1', 'wos.welcome.v1': 'done', 'wos.voiceTipSeen': 'true', 'wos.skin': skin,
      'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix: {} }) };
    for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
  }, { skin, APPS });
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


// Visual centre of each tile's icon: screenshot the bar with labels and badges hidden, find the ink in each tile.
async function centres(page) {
  const boxes = await page.evaluate(() => {
    const r = el => { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; };
    const orb = document.querySelector('#orbWrap'), ob = r(orb);
    return { dpr: devicePixelRatio, orb: ob, tiles: [...document.querySelectorAll('.sec-tile')].map(t => ({ sec: t.dataset.sec, box: r(t), icon: r(t.querySelector('.dsg')) })) };
  });
  await page.addStyleTag({ content: '.sec-tile .sec-nm,.sec-tile .sec-bg{visibility:hidden!important}.sec-tile:not(.on)>.dsg{opacity:1!important}', }).then(h => h.evaluate(n => n.id = 'qaHide'));
  await nap(250);
  const out = [];
  for (const t of boxes.tiles) {
    const clip = { x: Math.floor(t.icon.x - 6), y: Math.floor(t.icon.y - 3), width: Math.ceil(t.icon.w + 12), height: Math.ceil(t.icon.h + 6) };
    const png = (await page.screenshot({ clip })).toString('base64');
    const ink = await page.evaluate(async ({ png }) => {
      const img = await createImageBitmap(await (await fetch('data:image/png;base64,' + png)).blob());
      const c = new OffscreenCanvas(img.width, img.height), g = c.getContext('2d'); g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, img.width, img.height).data, at = (x, y) => (y * img.width + x) * 4;
      const bg = [0, 1, 2].map(k => d[at(1, 1) + k]);
      let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
      for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
        const i = at(x, y); if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 60) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      }
      return x1 < 0 ? null : { x0, x1, y0, y1, w: img.width };
    }, { png });
    const scale = ink ? ink.w / clip.width : 1;
    out.push({ sec: t.sec, tileX: t.box.x + t.box.w / 2, boxX: t.icon.x + t.icon.w / 2, inkX: ink ? clip.x + (ink.x0 + ink.x1 + 1) / 2 / scale : null });
  }
  await page.evaluate(() => document.querySelector('#qaHide')?.remove());
  return { orbX: boxes.orb.x + boxes.orb.w / 2, orb: boxes.orb, tiles: out };
}
const bar = page => page.evaluate(() => {
  const box = el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  const tiles = [...document.querySelectorAll('.sec-tile')].map(el => { const n = el.querySelector('.sec-nm'); return { sec: el.dataset.sec, label: n.textContent, ...box(el), cut: n.scrollWidth > n.clientWidth + 1, ellipsis: getComputedStyle(n).textOverflow }; });
  const orb = box(document.querySelector('#orbWrap')); const all = [...tiles, orb]; let overlaps = 0;
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) { const a = all[i], b = all[j]; if (a.x < b.x + b.w - .5 && b.x < a.x + a.w - .5 && a.y < b.y + b.h - .5 && b.y < a.y + a.h - .5) overlaps++; }
  return { tiles, orb, overlaps, scrollW: document.documentElement.scrollWidth, width: innerWidth };
});
const r1 = n => Math.round(n * 10) / 10;

(async () => {
  const browser = await chromium.launch(), report = [];
  let failed = 0;
  try {
    for (const c of CASES) for (const skin of SKINS) {
      const tag = `${c.name}-${skin}`, steps = { tag };
      try {
        const { context, page, errors } = await boot(browser, c, skin);
        // No badges first, then counts on Chats and Messenger: the icons must not move.
        await page.evaluate(() => { WizCore.workspaceNav.setCount('wizard', 0); WizCore.workspaceNav.setCount('messenger', 0); }); await nap(400);
        steps.bare = await centres(page);
        await page.evaluate(() => { WizCore.workspaceNav.setCount('wizard', 12); WizCore.workspaceNav.setCount('messenger', 3); }); await nap(400);
        // Apps holds an app with a long name.
        await page.evaluate(() => { __wos.closeSheets?.(); }); 
        const ap = await page.evaluate(() => { const r = document.querySelector('.sec-tile[data-sec="apps"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
        await page.touchscreen.tap(ap.x, ap.y); await nap(800);
        // The Apps tile opens the Favorites panel (wizard-ux#1955): All apps, then the app.
        await page.click('#appsPanel [data-apall]'); await page.click('#appsPanel [data-apopen="wizardos-tracker"]');
        await page.waitForFunction(() => { const d = __wos.desks[__wos.idx], w = d && __wos.wins[d.focus]; return w?.appId === 'wizardos-tracker' && !__wos.sheet; }, null, { timeout: 8000 }).catch(() => {});
        await nap(800);
        steps.bar = await bar(page);
        await page.screenshot({ path: path.join(out, `${tag}-on.png`) });
        steps.m = await centres(page);
        const xs = steps.m.tiles.map(t => t.inkX), o = steps.m.orbX;
        steps.gaps = [xs[1] - xs[0], o - xs[1], xs[2] - o, xs[3] - xs[2]].map(r1);
        steps.mirror = [r1((o - xs[0]) - (xs[3] - o)), r1((o - xs[1]) - (xs[2] - o))];
        steps.badgeShift = steps.m.tiles.map((t, i) => r1(t.inkX - steps.bare.tiles[i].inkX));
        steps.labels = steps.bar.tiles.map(t => t.label + (t.cut ? ' (cut)' : ''));
        const spread = Math.max(...steps.gaps) - Math.min(...steps.gaps);
        console.log(tag, 'gaps', steps.gaps.join(' / '), 'spread', r1(spread), 'mirror', steps.mirror.join(','), 'badge shift', steps.badgeShift.join(','), 'labels', steps.labels.join(', '));
        assert.deepEqual(steps.bar.tiles.map(t => t.sec), ['home', 'chats', 'slot', 'apps']);
        if (broken && skin === 'nebula') {
          assert.ok(spread > 2 * TOL, `on main the gaps are uneven (spread ${r1(spread)} px)`);
          assert.ok(steps.gaps[0] > steps.gaps[1] + TOL, 'Home-Chats is wider than Chats-orb');
        } else if (!broken) {
          assert.ok(spread <= TOL, `the four gaps match within ${TOL} px (${steps.gaps.join(' / ')})`);
          assert.ok(steps.mirror.every(v => Math.abs(v) <= TOL), `mirrored around the orb (${steps.mirror})`);
          assert.ok(steps.badgeShift.every(v => Math.abs(v) <= 1), `badges do not move an icon (${steps.badgeShift})`);
          for (const t of steps.bar.tiles) {
            assert.ok(t.w >= 44 && t.h >= 44, `${t.sec}: a 44 px target (${t.w}x${t.h})`);
            if (t.sec === 'apps') assert.equal(t.ellipsis, 'ellipsis', 'a long app name ends in an ellipsis');
            else assert.ok(!t.cut, `${t.sec}: its label fits`);
          }
          assert.equal(steps.bar.overlaps, 0, 'nothing overlaps'); assert.equal(steps.bar.scrollW, steps.bar.width, 'no horizontal overflow');
          assert.ok(steps.bar.tiles.every(t => t.x >= -.5 && t.x + t.w <= c.width + .5), 'every tile on screen');
          assert.ok(steps.bar.orb.w >= 44 && steps.bar.orb.h >= 44, `the orb is today's size or larger (${steps.bar.orb.w}x${steps.bar.orb.h})`);
          assert.ok(Math.abs((steps.bar.orb.x + steps.bar.orb.w / 2) - c.width / 2) <= 1, 'the orb stays centred');
        }
        assert.deepEqual(errors, [], 'no page errors');
        steps.ok = true;
        await context.close();
      } catch (e) { failed++; steps.ok = false; steps.error = e.message; console.error(tag, 'FAIL', e.message); }
      report.push(steps);
    }
  } finally {
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close();
  }
  console.log(failed ? `${failed} case(s) failed` : `all ${report.length} cases passed${broken ? ' (QA_EXPECT=broken)' : ''}`);
  process.exit(failed ? 1 : 0);
})();
