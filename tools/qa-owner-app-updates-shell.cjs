#!/usr/bin/env node
// In-shell owner app-update captures: the real phone/desktop shell from this checkout, Settings opened
// through the canonical deep link, Miguel's Obsidian and Landscapes skins chosen before boot.
// Only the Store `_updates` listener is a fixture; every other API answers empty and nothing leaves the page.
// Proves presentation and request flow only, never a live App Manager update.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), web = path.join(root, 'web');
const out = process.env.OUT || path.join(root, 'tmp', 'owner-app-updates-shell');
fs.mkdirSync(out, { recursive: true });
const ORIGIN = 'http://owner-updates.test';
const TYPES = { '.css': 'text/css', '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const initial = () => ({
  installed: '0.3.73', latest: '0.3.73', update_available: false, checked: true, mode: 'ask', chosen: true, channel: 'stable',
  apps: { app_mode: 'auto', chosen: false, holds: ['music'],
    due: [{ id: 'notes', from: 3, to: 4, status: 'running', skip: null }, { id: 'meditate', from: 7, to: 8, status: 'running', skip: null }],
    skipped: [{ id: 'my-app', skip: 'owner-source' }, { id: 'music', skip: 'held' }], last: { updated: ['outline'] } },
});
const webDigest = () => {
  const h = crypto.createHash('sha256');
  const walk = d => fs.readdirSync(d).sort().forEach(n => { const p = path.join(d, n); const s = fs.lstatSync(p);
    if (s.isDirectory()) walk(p); else if (s.isFile()) h.update(path.relative(web, p) + '\0').update(fs.readFileSync(p)); });
  walk(web); return h.digest('hex');
};
(async () => {
  const browser = await chromium.launch({ headless: true });
  const rows = [];
  for (const shell of ['phone', 'desktop']) for (const skin of ['obsidian', 'landscapes']) {
    const ctx = await browser.newContext(shell === 'phone'
      ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
      : { viewport: { width: 1440, height: 900 } });
    const state = { saved: initial(), calls: [], failReadback: false, outside: [] };
    await ctx.route('**/*', r => {
      const req = r.request(), u = new URL(req.url());
      if (u.origin !== ORIGIN) { state.outside.push(u.origin); return r.abort(); }
      if (u.pathname.endsWith('/store-install/_updates')) {
        const body = req.postData() ? JSON.parse(req.postData()) : undefined;
        state.calls.push({ method: req.method(), body });
        if (req.method() === 'POST') {
          if (body?.action === 'apply-apps') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ started: true }) });
          if (body?.app_mode) state.saved.apps = { ...state.saved.apps, app_mode: body.app_mode, chosen: true };
          return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state.saved) });
        }
        if (state.failReadback) return r.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"fixture readback failure"}' });
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state.saved) });
      }
      const rel = decodeURIComponent(u.pathname.replace(/^\/wizard-os-home\//, '')) || 'index.html';
      const f = path.resolve(web, rel);
      if (req.method() === 'GET' && f.startsWith(web + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile())
        return r.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
      if (req.method() !== 'GET') return r.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"qa refuses writes"}' });
      const body = /\/sessions$/.test(u.pathname) ? { data: [], has_more: false } : {};
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await ctx.addInitScript(({ shell, skin }) => {
      try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.tour', 'done'); localStorage.setItem('wos.tour.done', '1');
        localStorage.setItem('wux.shell', shell); localStorage.setItem('wos.skin', skin); } catch (_) {}
    }, { shell, skin });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
    const entry = shell === 'phone' ? '?shell=phone&view=settings&updates' : 'desktop.html?view=settings&updates';
    await page.goto(`${ORIGIN}/wizard-os-home/${entry}`, { waitUntil: 'load' });
    await page.waitForFunction(s => document.documentElement.dataset.shell === s, shell, { timeout: 30000 });
    await page.waitForFunction(s => document.documentElement.dataset.skin === s, skin, { timeout: 30000 });
    const section = page.locator('[data-app-updates]');
    await section.waitFor({ state: 'visible', timeout: 30000 });
    await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });
    await section.evaluate(e => e.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(800);
    const hint = async () => (await section.innerText()).replace(/\s+/g, ' ');
    const before = await hint();
    if (!before.includes('Default: Automatic.')) throw Error(`${shell}/${skin}: default not labelled as default: ${before}`);
    if (!before.includes('my-app (your code needs review)') || !before.includes('music (kept on this version)')) throw Error(`${shell}/${skin}: kept apps not shown`);
    await page.screenshot({ path: path.join(out, `${shell}-${skin}-1-default.png`) });

    const manual = section.getByRole('radio', { name: 'Manual', exact: true });
    await manual.click();
    await page.waitForFunction(() => window.WosUpdates?.state?.apps?.app_mode === 'ask' && window.WosUpdates.state.apps.chosen === true);
    await page.waitForFunction(() => document.querySelector('[data-app-updates] [role="radio"][aria-checked="true"]')?.textContent.trim() === 'Manual');
    const after = await hint();
    if (after.includes('Default:') || !after.includes('No automatic app updates.')) throw Error(`${shell}/${skin}: saved Manual not shown: ${after}`);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(out, `${shell}-${skin}-2-manual-saved.png`) });

    await section.getByRole('button', { name: 'Update apps now', exact: true }).click();
    await page.waitForTimeout(600);
    if (!state.calls.some(c => c.body?.action === 'apply-apps')) throw Error(`${shell}/${skin}: Update apps now sent nothing`);
    if (state.saved.apps.app_mode !== 'ask' || state.saved.mode !== 'ask') throw Error(`${shell}/${skin}: one-shot changed policy`);

    // Failed readback: Automatic is not shown as saved and the owner sees why.
    state.failReadback = true;
    await section.getByRole('radio', { name: 'Automatic', exact: true }).click();
    const toast = page.getByText('Couldn’t confirm the saved app-update setting. Try again.');
    await toast.waitFor({ state: 'visible', timeout: 10000 });
    const stillManual = await page.evaluate(() => window.WosUpdates.state.apps.app_mode);
    if (stillManual !== 'ask') throw Error(`${shell}/${skin}: failed readback presented as saved (${stillManual})`);
    await page.screenshot({ path: path.join(out, `${shell}-${skin}-3-readback-failed.png`) });
    state.failReadback = false;

    rows.push({ shell, skin, before, after, calls: state.calls, outside: [...new Set(state.outside)], errors });
    await ctx.close();
  }
  await browser.close();
  const result = { passed: rows.length, web_sha256: webDigest(), rows };
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ passed: rows.length, web_sha256: result.web_sha256, out }));
})().catch(e => { console.error(e); process.exitCode = 1; });
