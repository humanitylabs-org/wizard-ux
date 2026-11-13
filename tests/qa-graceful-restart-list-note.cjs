'use strict';
// wizard-ux issue 1362 third re-review in a real browser: on the phone Chats list (no message box on screen) the
// restart note used to paint over the header with no panel behind it, and the desk name covered Restart now, so a tap
// never reached it. Now the note sits on its own opaque panel above the dock and the new-chat button, clear of the
// header, and a real tap on Restart now reaches the box's restart gate. Phone 412x915 on Nebula and Grove.
// Synthetic transport only (no box is reached). QA_EXPECT=broken (with QA_WEB=<main>/web) asserts the old overlap.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = 'https://graceful-restart-list.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'graceful-restart-list-evidence');
const broken = process.env.QA_EXPECT === 'broken';
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const row = (id, title, status, at) => ({ id, title, runtime: 'direct', status, updated_at: iso(at), last_active: at / 1000, message_count: 2, preview: 'Working on it.' });
(async () => {
  const browser = await chromium.launch(), report = {};
  try {
    for (const skin of ['nebula', 'grove']) {
      const hold = { phase: 'overdue', holding: true, reason: 'update', active: 1, held: 1, oldest_active_s: 700, wait_until: iso(now - 6e4) };
      const choices = [];
      const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
      const rows = [row('qa-long', 'Ferry research', 'running', now - 6e5), row('qa-done', 'Weekend plans', 'completed', now - 36e5)];
      await context.routeWebSocket('**/*', w => w.close());
      await context.addInitScript(skin => {
        if (window !== top) return;
        for (const [k, v] of Object.entries({ 'wos.shell': 'phone', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
          'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix: { 'wizard/graceful-restart': true } }) })) localStorage.setItem(k, v);
      }, skin);
      await context.route('**/*', async r => {
        const q = r.request(), u = new URL(q.url()), p = u.pathname, method = q.method();
        if (u.origin !== origin) return r.abort();
        if (p === '/wizard/health') return r.fulfill({ json: { status: 'ok', restart: hold } });
        if (p === '/wizard/v1/restart' && method === 'POST') { const b = q.postDataJSON() || {}; choices.push(b); if (b.now === true) hold.restart_now = true; return r.fulfill({ json: { ...hold } }); }
        if (!['GET', 'HEAD'].includes(method)) return r.fulfill({ json: { ok: true } });
        if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
        if (p.startsWith(prefix)) {
          const abs = path.resolve(web, decodeURIComponent(p.slice(prefix.length) || 'index.html'));
          if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
          return fs.existsSync(abs) && fs.statSync(abs).isFile() ? r.fulfill({ path: abs }) : r.fulfill({ status: 404, body: 'none' });
        }
        if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
        if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
        if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: rows, has_more: false } });
        if (/^\/wizard\/hermes\/api\/sessions\//.test(p)) return r.fulfill({ json: { messages: [] } });
        return r.fulfill({ json: ownerRead(p) });
      });
      const page = await context.newPage();
      await page.goto(origin + prefix + 'index.html?phone');
      await page.waitForFunction(() => window.WizReach?.restart?.()?.phase === 'overdue', null, { timeout: 20000 });
      await page.evaluate(() => window.__wos.openSheet('inbox'));
      await nap(2500);
      const geo = await page.evaluate(() => {
        const note = [...document.querySelectorAll('[data-restart-notice]')].find(e => e.getClientRects().length);
        if (!note) return null;
        const r = note.getBoundingClientRect(), b = note.querySelector('[data-restart-choice="now"]'), br = b.getBoundingClientRect();
        const hit = document.elementFromPoint(br.x + br.width / 2, br.y + br.height / 2);
        const head = [...document.querySelectorAll('.dc-name, .ch-head, .ch-title, h1, h2')].filter(e => e.getClientRects().length).map(e => e.getBoundingClientRect());
        const fab = [...document.querySelectorAll('.ch-fab')].find(e => e.getClientRects().length)?.getBoundingClientRect();
        const overlaps = (a, c) => !!a && !!c && a.left < c.right && c.left < a.right && a.top < c.bottom && c.top < a.bottom;
        return { text: note.textContent.trim(), rect: [r.x, r.y, r.width, r.height].map(Math.round), bg: getComputedStyle(note).backgroundColor,
          tapReaches: !!hit && (hit === b || b.contains(hit)), overHeader: head.some(h => overlaps(r, h)), overFab: overlaps(r, fab) };
      });
      assert.ok(geo, `${skin}: the note shows on the Chats list`);
      await page.screenshot({ path: path.join(out, `phone-${skin}-list-${broken ? 'before' : 'after'}.png`) });
      let tapped = false;
      if (geo.tapReaches) { await page.locator('[data-restart-choice="now"]').filter({ visible: true }).first().tap({ timeout: 3000 }); await nap(800); tapped = choices.some(c => c.now === true); }
      report[skin] = { ...geo, tapped }; console.log(skin, JSON.stringify(report[skin]));
      if (broken) assert.ok(!geo.tapReaches || geo.overHeader, `${skin}: main paints the note over the header`);
      else {
        assert.equal(geo.overHeader, false, `${skin}: the note is clear of the header`);
        assert.equal(geo.overFab, false, `${skin}: the note is clear of the new-chat button`);
        assert.notEqual(geo.bg, 'rgba(0, 0, 0, 0)', `${skin}: the note has an opaque panel`);
        assert.equal(geo.tapReaches, true, `${skin}: nothing covers Restart now`);
        assert.equal(tapped, true, `${skin}: a tap on Restart now reaches the restart gate`);
      }
      await context.close();
    }
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(broken ? 'baseline confirmed: the note covers the header on main' : 'ok: the note sits on its own panel and Restart now takes a tap');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
