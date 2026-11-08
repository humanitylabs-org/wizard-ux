#!/usr/bin/env node
// Isolated real-shell acceptance for Skin families and their Colors, phone + desktop.
// Static assets are this checkout; APIs are empty fixtures. No live box/network/writes.
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const { chromium } = require('./tools/qa-playwright.cjs');
const root = __dirname, web = path.join(root, 'web');
const out = process.env.OUT || path.join(root, 'tmp', 'look-separation');
const ORIGIN = 'http://look-separation.test';
const TYPES = { '.css': 'text/css', '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
fs.mkdirSync(out, { recursive: true });
const rows = [];
async function families(page) {
  return page.locator('[data-skinfamily]:visible').evaluateAll(es => es.map(e => e.dataset.skinfamily));
}
async function colours(page) {
  return page.locator('[data-skinpick]:visible').evaluateAll(es => es.map(e => e.dataset.skinpick));
}
async function check(page, skin) {
  await page.waitForFunction(id => window.WosSkin?.current === id, skin);
  const expected = await page.evaluate(() => WosSkin.families.find(f => f.id === WosSkin.familyOf(WosSkin.current)).palettes);
  assert.deepEqual(await colours(page), expected, 'Colors shows only the chosen skin family');
  assert.equal(await page.locator('[data-stgroup="look"] > h4:visible').textContent(), 'Skin');
  assert.equal(await page.locator('.skp-colours > h4:visible').textContent(), 'Colors');
  assert.equal(await page.locator('[data-skinpick][aria-pressed="true"]:visible').getAttribute('data-skinpick'), skin);
  assert.deepEqual(await families(page), await page.evaluate(() => WosSkin.families.map(f => f.id)));
}
async function capture(page, shell, skin) {
  // Restore the pane's top after clicks; both control groups must be visible in the shot.
  await page.locator('.st-page:visible').evaluate(e => { e.scrollTop = 0; });
  await page.locator('[data-stgroup="look"] > h4').scrollIntoViewIfNeeded();
  const geometry = await page.locator('[data-stgroup="look"]').evaluate(e => {
    const tiles = [...e.querySelectorAll('[data-skinfamily], .skp-colours [data-skinpick]')];
    const r = el => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
    return { viewport: { width: innerWidth, height: innerHeight }, overflow: document.documentElement.scrollWidth > innerWidth, tiles: tiles.map(r) };
  });
  assert.equal(geometry.overflow, false, 'no horizontal overflow');
  for (const b of geometry.tiles) { assert.ok(b.x >= 0 && b.x + b.width <= geometry.viewport.width + 1, 'tile stays inside viewport'); }
  for (let i = 0; i < geometry.tiles.length; i++) for (let j = i + 1; j < geometry.tiles.length; j++) {
    const a = geometry.tiles[i], b = geometry.tiles[j];
    assert.ok(a.x + a.width <= b.x + 1 || b.x + b.width <= a.x + 1 || a.y + a.height <= b.y + 1 || b.y + b.height <= a.y + 1, 'tiles do not overlap');
  }
  const panel = shell === 'phone' ? '#settings.open' : '#dsettings:not([hidden])';
  const material = await page.locator(panel).evaluate(e => { const s = getComputedStyle(e); return { background: s.backgroundColor, image: s.backgroundImage, opacity: s.opacity, backdrop: s.backdropFilter }; });
  const file = `${shell}-${skin}-look.png`;
  await page.screenshot({ path: path.join(out, file) });
  rows.push({ shell, skin, file, geometry, material });
}
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--disable-lcd-text', '--disable-gpu'] });
  try {
    for (const shell of ['phone', 'desktop']) {
      const ctx = await browser.newContext(shell === 'phone'
        ? { viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true }
        : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
      const writes = [], errors = [];
      await ctx.route('**/*', route => {
        const req = route.request(), u = new URL(req.url());
        if (u.origin !== ORIGIN) return route.abort();
        const rel = decodeURIComponent(u.pathname.replace(/^\/wizard-os-home\//, '')) || 'index.html';
        const f = path.resolve(web, rel);
        if (req.method() === 'GET' && f.startsWith(web + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile())
          return route.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
        if (req.method() !== 'GET') { writes.push({ method: req.method(), path: u.pathname }); return route.fulfill({ status: 403, contentType: 'application/json', body: '{}' }); }
        if (u.pathname === '/wizard/v1/skins') return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({skins:[],active:null})});
        if (/\/skins(?:\/|$)|\/bootstrap$|\/_connections\//.test(u.pathname)) return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(/\/sessions$/.test(u.pathname) ? { data: [], has_more: false } : {}) });
      });
      await ctx.addInitScript(shell => {
        localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.tour', 'done'); localStorage.setItem('wos.tour.done', '1');
        localStorage.setItem('wux.shell', shell); localStorage.setItem('wos.skin', 'nebula');
      }, shell);
      const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message));
      const entry = shell === 'phone' ? '?shell=phone&view=skin' : 'desktop.html?view=skin';
      await page.goto(`${ORIGIN}/wizard-os-home/${entry}`, { waitUntil: 'load' });
      await page.locator('[data-skinfamily="wizard"]:visible').waitFor({ timeout: 30000 });
      await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });
      await check(page, 'nebula');
      await page.waitForFunction(() => !document.querySelector('.skp-wait'));
      await capture(page, shell, 'nebula');
      await page.locator('[data-skinpick="grove"]:visible').click(); await check(page, 'grove');
      await page.locator('[data-skinfamily="mizel"]:visible').click(); await check(page, 'obsidian');
      await page.locator('[data-skinpick="obsidian-light"]:visible').click(); await check(page, 'obsidian-light');
      await capture(page, shell, 'obsidian-light');
      await page.locator('[data-skinfamily="wizard"]:visible').click(); await check(page, 'grove');
      await page.locator('[data-skinfamily="mizel"]:visible').click(); await check(page, 'obsidian-light');
      await page.locator('[data-newskin]:visible').click();
      await page.locator('[data-skin-name]:visible').fill('Quiet morning');
      await page.locator('[data-skin-base]:visible').selectOption('wizard');
      assert.deepEqual(await colours(page), await page.evaluate(() => WosSkin.families.find(f => f.id === 'wizard').palettes));
      assert.equal(await page.locator('[data-skin-name]').inputValue(), 'Quiet morning');
      assert.equal(await page.evaluate(() => WosSkin.current), 'obsidian-light', 'draft family choice does not change worn colour');
      await page.locator('[data-skinpick="ember"]:visible').click();
      await page.screenshot({ path: path.join(out, `${shell}-new-skin.png`) });
      rows.push({shell,view:'new-skin',file:`${shell}-new-skin.png`});
      await page.locator('[data-st-back]:visible').click();
      await check(page, 'obsidian-light');
      const previewBytes = JSON.stringify({version:1,active:null,skins:[{id:'device-fixture',name:'Synthetic device preview',base:'grove',tweaks:{'wizard/two-orbs':false}}]});
      await page.evaluate(async bytes => {localStorage.setItem('wos.own-skins.v1',bytes); await WosMySkin.refresh();},previewBytes);
      await page.getByText('Recover device skins',{exact:true}).click();
      await page.locator('[data-skin-preview="device-fixture"]').click();
      await page.locator('[data-skin-name]:visible').waitFor();
      assert.equal(await page.locator('[data-skin-name]').inputValue(),'Synthetic device preview');
      assert.equal(await page.evaluate(()=>WosSkin.current),'obsidian-light','recovering a draft never changes the worn skin');
      await page.screenshot({path:path.join(out,`${shell}-device-recovery.png`)});
      rows.push({shell,view:'device-recovery',file:`${shell}-device-recovery.png`});
      await page.locator('[data-st-back]:visible').click();
      await page.getByText('Recover device skins',{exact:true}).click();
      await page.locator('[data-skin-preview-dismiss="device-fixture"]').click();
      assert.equal(await page.evaluate(()=>WosMySkin.previews.length),0);
      assert.equal(await page.evaluate(()=>localStorage.getItem('wos.own-skins.v1')),previewBytes,'explicit dismissal retains preview bytes');
      const url = page.url();
      await page.goBack(); // exercise shell's native-history guard, never navigate out of Wizard
      await page.waitForFunction(() => document.querySelector('[data-settings-root]'));
      assert.equal(new URL(page.url()).origin, ORIGIN, 'Back never exits');
      // Reopen from Home so outside-tap acceptance applies to an actual sheet/dialog, not a desk window.
      if (shell === 'phone') {
        await page.evaluate(() => window.__wos.openSheet('settings'));
        await page.locator('#settings.open').waitFor();
        await page.locator('#scrim').click({ position: { x: 10, y: 10 }, force: true });
        await page.waitForFunction(() => !document.querySelector('#settings.open'));
      } else {
        await page.keyboard.press('Escape');
        await page.evaluate(() => window.__wux.goHome());
        await page.locator('[data-home-settings]').click();
        await page.locator('#dsettings.is-modal:not([hidden])').waitFor();
        await page.locator('.dsettings-scrim').click({ position: { x: 5, y: 5 } });
        await page.waitForFunction(() => document.querySelector('#dsettings').hidden);
      }
      assert.equal(writes.filter(w => /\/skins(?:\/|$)/.test(w.path)).length, 0, 'plain family/colour choices never write own-skin API');
      assert.deepEqual(errors, [], 'no uncaught browser errors');
      rows.push({ shell, behaviour: 'PASS', backStayed: true, outsideCloses: true, originalUrl: url, writes });
      await ctx.close();
    }
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ pass: true, rows }, null, 2));
    console.log(JSON.stringify({ pass: true, screenshots: rows.filter(r => r.file).length, out, rows }, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
