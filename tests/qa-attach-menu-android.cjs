'use strict';
// wizard-ux issue 1634 in a real browser: in the Android app, a chat composer's + (and the orb's Attach) opened
// Android's "Choose an action" Camera/Files sheet, because the shell clicked one file input with an empty accept.
// James, 19 Nov 2026 (0.10.54): "Come on bro, this should be simple." Now + shows the shell's own menu with Camera
// (accept image/*, capture: the camera at once), Photo or video (accept image/*,video/*: the photo grid at once,
// ux#1635) and File. Outside the Android app (no WizardOSNative) + keeps the plain file dialog.
// Phone 412x915, Android user agent, skins nebula + grove. QA_EXPECT=broken (QA_WEB=<main>/web) asserts the old
// direct empty-accept dialog instead. Synthetic transport only; every write is answered locally.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = 'https://attach-menu.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'attach-menu-evidence');
const broken = process.env.QA_EXPECT === 'broken', skins = (process.env.QA_SKINS || 'nebula,grove').split(',');
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const ROWS = [{ id: 'qa-attach', title: 'Attach test', runtime: 'direct', status: 'completed', updated_at: iso(now - 6e5), updatedAt: iso(now - 6e5), last_active: (now - 6e5) / 1000, message_count: 2, messageCount: 2, preview: 'Done.' }];
const MSGS = [{ role: 'user', content: 'Hello', timestamp: now / 1000 - 700 }, { role: 'assistant', content: 'Hi, send me a picture.', timestamp: now / 1000 - 690 }];
const UA = 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36';
async function run(browser, skin, native) {
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block', userAgent: UA });
  const errors = [], got = {};
  try {
    await context.routeWebSocket('**/*', w => w.close());
    await context.addInitScript(({ skin, native }) => {
      if (window !== top) return;
      if (native) window.WizardOSNative = {}; // the Android app's bridge object (no methods needed here)
      for (const [k, v] of Object.entries({ 'wos.shell': 'phone', 'wux.shell': 'phone', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin })) localStorage.setItem(k, v);
    }, { skin, native });
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
      if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: ROWS, has_more: false } });
      const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
      if (m) { const s = ROWS.find(x => x.id === decodeURIComponent(m[1])); if (!s) return r.fulfill({ status: 404, json: {} });
        return r.fulfill({ json: m[2] ? { messages: MSGS } : { session: s } }); }
      return r.fulfill({ json: ownerRead(p) });
    });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + prefix + 'index.html?phone');
    await page.waitForFunction(() => window.__wos && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
    await page.evaluate(() => __wos.openSheet('inbox')); await nap(900);
    const vis = sel => page.locator(sel).filter({ visible: true }).first();
    await vis('.ch-list [data-chopen="qa-attach"]').click(); await nap(1200);
    const plus = vis('[data-part="thread"] [data-chattach]');
    // A dialog that opens is caught here, with the input's accept/capture at that moment.
    const chooser = async (act) => {
      const ev = page.waitForEvent('filechooser', { timeout: 2500 }).catch(() => null);
      await act();
      const fc = await ev; if (!fc) return null;
      const info = await fc.element().evaluate(n => ({ accept: n.accept, capture: n.hasAttribute('capture'), multiple: n.multiple }));
      await fc.setFiles([]).catch(() => {});
      return info;
    };
    const menu = () => page.evaluate(() => { const m = document.querySelector('.wos-context-menu'); if (!m) return null;
      const r = m.getBoundingClientRect(), b = [...document.querySelectorAll('[data-part="thread"] [data-chattach]')].find(x => x.getClientRects().length)?.getBoundingClientRect();
      return { items: [...m.querySelectorAll('[role="menuitem"]')].map(x => x.textContent), top: r.top, bottom: r.bottom, plusTop: b?.top, inView: r.top >= 0 && r.bottom <= innerHeight }; });
    got.direct = await chooser(() => plus.click());
    got.menu = await menu();
    if (got.menu) {
      await page.screenshot({ path: path.join(out, `menu-${skin}.png`) });
      got.photo = await chooser(() => vis('.wos-context-menu [role="menuitem"]:text-is("Photo or video")').click());
      await plus.click(); await nap(200);
      got.camera = await chooser(() => vis('.wos-context-menu [role="menuitem"]:text-is("Camera")').click());
      await plus.click(); await nap(200);
      got.file = await chooser(() => vis('.wos-context-menu [role="menuitem"]:text-is("File")').click());
      await plus.click(); await nap(200);
      await page.mouse.click(200, 200); await nap(200);
      got.outsideClosed = !(await menu());
      await plus.click(); await nap(200);
      got.backHandled = await page.evaluate(() => { history.back(); return true; }); await nap(500);
      got.backClosed = !(await menu());
      got.stillInThread = await page.locator('[data-part="thread"]').filter({ visible: true }).count() > 0;
      // A New chat's composer: the same menu.
      await vis('[data-part="thread"] [data-chback]').click(); await nap(700);
      await vis('[data-chnew]').click(); await nap(900);
      got.newDirect = await chooser(() => vis('[data-part="thread"] [data-chattach]').click());
      got.newMenu = (await menu())?.items || null;
      await page.mouse.click(200, 200); await nap(200);
    }
    got.errors = errors;
  } finally { await context.close(); }
  return got;
}
// owner-correction: humanitylabs-org/wizard-ux#1634 · 2026-11-19 · "Come on bro, this should be simple."
(async () => {
  const browser = await chromium.launch(), report = [];
  try {
    for (const skin of skins) {
      const app = await run(browser, skin, true), web = await run(browser, skin, false);
      report.push({ skin, app, web });
      if (broken) {
        assert.equal(app.menu, null, 'baseline: no menu');
        assert.deepEqual(app.direct && { accept: app.direct.accept, capture: app.direct.capture }, { accept: '', capture: false }, 'baseline: + opens an empty-accept dialog (the Camera/Files sheet on Android)');
        continue;
      }
      assert.equal(app.direct, null, 'Android app: + opens no dialog straight away');
      assert.deepEqual(app.menu.items, ['Camera', 'Photo or video', 'File']);
      assert.ok(app.menu.inView && app.menu.bottom <= app.menu.plusTop, 'menu sits above the + on screen');
      assert.deepEqual(app.photo, { accept: 'image/*,video/*', capture: false, multiple: true }, 'Photo or video asks for the photo grid');
      assert.deepEqual(app.camera, { accept: 'image/*', capture: true, multiple: false }, 'Camera asks for the camera');
      assert.deepEqual(app.file, { accept: '', capture: false, multiple: true }, 'File asks for any file');
      assert.ok(app.outsideClosed, 'an outside tap closes the menu');
      assert.ok(app.backClosed && app.stillInThread, 'Back closes the menu and stays in the thread');
      assert.equal(app.newDirect, null, 'New chat: + opens no dialog straight away');
      assert.deepEqual(app.newMenu, ['Camera', 'Photo or video', 'File'], 'New chat: the same menu');
      assert.equal(web.menu, null, 'phone browser: no menu');
      assert.deepEqual(web.direct, { accept: '', capture: false, multiple: true }, 'phone browser keeps the plain file dialog');
      assert.deepEqual(app.errors, []); assert.deepEqual(web.errors, []);
    }
    console.log(JSON.stringify(report, null, 1));
    console.log(broken ? 'baseline reproduced: + opens the empty-accept dialog' : 'attach menu ok');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
