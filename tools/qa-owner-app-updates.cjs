#!/usr/bin/env node
// Browser fixture (not a live-box test): real update module/CSS, explicit in-memory Store responses.
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const out = process.env.OUT || path.join(root, 'tmp', 'owner-app-updates');
fs.mkdirSync(out, { recursive: true });
const moduleSource = fs.readFileSync(path.join(root, 'web/core/os-updates.js'), 'utf8');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = [];
  for (const shell of ['phone', 'desktop']) for (const skin of ['obsidian', 'landscapes']) {
    const page = await browser.newPage({ viewport: shell === 'phone' ? { width: 390, height: 844 } : { width: 1280, height: 900 } });
    await page.route('https://owner-update.test/**', route => route.fulfill({ body: '<!doctype html><html><head></head><body><main id="settings"></main></body></html>', contentType: 'text/html' }));
    await page.goto('https://owner-update.test/wizard-os-home/');
    const files = ['core/base.css', 'styles.css', 'desktop/desktop.css', 'core/settings.css', 'core/skins.css', `skins/${skin}/skin.css`];
    await page.addStyleTag({ content: files.filter(f => fs.existsSync(path.join(root, 'web', f))).map(f => fs.readFileSync(path.join(root, 'web', f), 'utf8')).join('\n') });
    await page.evaluate(({ shell, skin }) => {
      document.documentElement.dataset.shell = shell;
      document.documentElement.dataset.skin = skin === 'landscapes' ? 'landscapes-dawn' : skin;
      document.body.style.background = 'var(--bg, #111)';
      document.querySelector('main').style.cssText = 'max-width:560px;margin:auto;padding:16px;';
      window.fixture = { calls: [], saved: { mode: 'ask', chosen: true, installed: '0.3.73', latest: '0.3.73', update_available: false, checked: true, apps: { app_mode: 'auto', chosen: false, due: [{ id: 'notes' }], skipped: [{ id: 'my-app', skip: 'owner-source' }] } } };
      window.fetch = async (_url, opts = {}) => {
        const body = opts.body && JSON.parse(opts.body);
        window.fixture.calls.push({ method: opts.method || 'GET', body });
        if (body?.app_mode) window.fixture.saved.apps = { ...window.fixture.saved.apps, app_mode: body.app_mode, chosen: true };
        return { ok: true, status: 200, json: async () => body?.action ? { started: true } : structuredClone(window.fixture.saved) };
      };
      const render = () => { document.querySelector('main').innerHTML = window.WosUpdates?.html() || ''; };
      window.WosSettings = { register() {}, refresh: render };
      document.addEventListener('click', e => { if (e.target.closest('[data-osu]')) window.WosUpdates.act(e.target, { render, toast() {} }); });
    }, { shell, skin });
    await page.addScriptTag({ content: moduleSource });
    await page.getByRole('radio', { name: 'Manual', exact: true }).waitFor();
    await page.getByRole('radio', { name: 'Manual', exact: true }).click();
    await page.waitForFunction(() => window.WosUpdates.state.apps.app_mode === 'ask');
    if (await page.getByRole('radio', { name: 'Manual', exact: true }).getAttribute('aria-checked') !== 'true') throw Error('Manual not visibly selected');
    await page.getByRole('button', { name: 'Update apps now', exact: true }).click();
    await page.waitForFunction(() => window.fixture.calls.some(r => r.body?.action === 'apply-apps'));
    const result = await page.evaluate(() => ({ apps: window.fixture.saved.apps.app_mode, system: window.fixture.saved.mode, calls: window.fixture.calls }));
    if (result.apps !== 'ask' || result.system !== 'ask') throw Error('Manual one-shot changed policy');
    await page.screenshot({ path: path.join(out, `${shell}-${skin}.png`), fullPage: true });
    results.push({ shell, skin, ...result });
    await page.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ passed: results.length, results }, null, 2));
  console.log(JSON.stringify({ passed: results.length, out }));
})().catch(e => { console.error(e); process.exitCode = 1; });
