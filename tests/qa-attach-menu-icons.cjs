'use strict';
// wizard-ux issue 1639 in a real browser: James, 19 Nov 2026, "probably these would be more intuitive with icons."
// With switch wizard/attach-menu-icons on, the Android app's attach menu (a chat's +, a New chat's +) shows a round
// icon tile before each choice (camera, picture, paperclip) on taller rows, coloured from the skin's --wz-* tokens,
// on an opaque panel. With the switch off the menu is exactly today's plain text rows. Each choice still opens
// the same picker. Phone 412x915, Android user agent, skins nebula + grove. Synthetic transport only.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = 'https://attach-menu.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'attach-menu-icons-evidence');
const skins = (process.env.QA_SKINS || 'nebula,grove').split(',');
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const ROWS = [{ id: 'qa-attach', title: 'Attach test', runtime: 'direct', status: 'completed', updated_at: iso(now - 6e5), updatedAt: iso(now - 6e5), last_active: (now - 6e5) / 1000, message_count: 2, messageCount: 2, preview: 'Done.' }];
const MSGS = [{ role: 'user', content: 'Hello', timestamp: now / 1000 - 700 }, { role: 'assistant', content: 'Hi, send me a picture.', timestamp: now / 1000 - 690 }];
const UA = 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36';
async function run(browser, skin, on) {
  const native = true;
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block', userAgent: UA });
  const errors = [], got = {};
  try {
    await context.routeWebSocket('**/*', w => w.close());
    const mix = on ? { 'wizard/attach-menu-icons': true } : {};
    await context.addInitScript(({ skin, native, mix }) => {
      if (window !== top) return;
      if (native) window.WizardOSNative = {}; // the Android app's bridge object (no methods needed here)
      for (const [k, v] of Object.entries({ 'wos.shell': 'phone', 'wux.shell': 'phone', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
        'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v);
    }, { skin, native, mix });
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
      const cs = getComputedStyle(m), alpha = (cs.backgroundColor.match(/rgba?\(([^)]+)\)/)?.[1].split(/[ ,/]+/).filter(Boolean)[3]);
      return { items: [...m.querySelectorAll('[role="menuitem"]')].map(x => x.textContent), withIcons: m.classList.contains('wos-cm-icons'),
        rows: [...m.querySelectorAll('[role="menuitem"]')].map(b => { const t = b.querySelector('.wos-cm-tile'), r = b.getBoundingClientRect();
          return { label: b.textContent, h: Math.round(r.height), tile: t ? { w: Math.round(t.getBoundingClientRect().width), round: getComputedStyle(t).borderRadius, hidden: t.getAttribute('aria-hidden'), paths: t.querySelectorAll('svg path').length, color: getComputedStyle(t).color } : null }; }),
        accent: getComputedStyle(m).getPropertyValue('--wz-accent').trim(), bg: cs.backgroundColor, opaque: alpha === undefined || Number(alpha) === 1 }; });
    await plus.click(); await nap(300);
    got.menu = await menu();
    await page.screenshot({ path: path.join(out, `menu-${skin}-${on ? 'on' : 'off'}.png`) });
    got.file = await chooser(() => page.locator('.wos-context-menu').getByRole('menuitem', { name: 'File', exact: true }).click());
    await plus.click(); await nap(200);
    got.camera = await chooser(() => page.locator('.wos-context-menu').getByRole('menuitem', { name: 'Camera', exact: true }).click());
    // New chat: the same menu, the same icons.
    await vis('[data-part="thread"] [data-chback]').click(); await nap(700);
    await vis('[data-chnew]').click(); await nap(900);
    await vis('[data-part="thread"] [data-chattach]').click(); await nap(300);
    got.newMenu = await menu();
    await page.mouse.click(200, 200); await nap(200);
    got.errors = errors;
  } finally { await context.close(); }
  return got;
}
(async () => {
  const browser = await chromium.launch(), report = [];
  try {
    for (const skin of skins) {
      const on = await run(browser, skin, true), off = await run(browser, skin, false);
      report.push({ skin, on, off });
      for (const m of [on.menu, on.newMenu]) {
        assert.ok(m && m.withIcons, 'switch on: the menu has icon rows');
        assert.deepEqual([...m.items].sort(), ['Camera', 'File', 'Photo or video'], 'the same three choices, words unchanged');
        for (const r of m.rows) {
          assert.ok(r.tile, `${r.label}: has an icon tile`);
          assert.equal(r.tile.round, '50%', `${r.label}: the tile is round`);
          assert.equal(r.tile.hidden, 'true', `${r.label}: the icon is hidden from screen readers (the words name it)`);
          assert.ok(r.tile.paths >= 1 && r.tile.w === 40, `${r.label}: a drawn 40 px icon`);
          assert.ok(r.h >= 56, `${r.label}: a tall touch target (${r.h} px)`);
        }
        assert.ok(m.opaque, `opaque panel (${m.bg})`);
      }
      assert.deepEqual(on.file?.multiple, true, 'File still opens the file picker');
      assert.deepEqual(on.camera, { accept: 'image/*', capture: true, multiple: false }, 'Camera still opens the camera');
      for (const m of [off.menu, off.newMenu]) {
        assert.ok(m && !m.withIcons && m.rows.every(r => !r.tile), 'switch off: plain text rows as today');
      }
      assert.deepEqual(off.menu.items, on.menu.items, 'same choices in the same order either way');
      assert.deepEqual(on.errors, []); assert.deepEqual(off.errors, []);
    }
    const tiles = report.map(r => r.on.menu.rows[0].tile.color);
    assert.notEqual(tiles[0], tiles[1], 'the icon colour follows the skin (' + tiles.join(' vs ') + ')');
    console.log(JSON.stringify(report, null, 1));
    console.log('attach menu icons ok');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
