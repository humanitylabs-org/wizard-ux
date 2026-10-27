// Synthetic full-shell proof: never connects to a live Wizard or reads owner history.
// QA_SERVICE=<service checkout> QA_OUT=<evidence dir> QA_CHROME=<chromium> node qa-response-style.cjs
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
(async () => {
  assert.ok(process.env.QA_SERVICE && process.env.QA_OUT && process.env.QA_CHROME, 'Explicit synthetic service, evidence and browser paths required');
  const out = path.resolve(process.env.QA_OUT); fs.mkdirSync(out, { recursive: true });
  const root = fs.mkdtempSync(path.join(out, 'fixture-'));
  const load = file => import(pathToFileURL(path.join(process.env.QA_SERVICE, 'server', file)));
  const { createHermesFixture } = await load('fixture.mjs');
  const { createWizardServer, listen } = await load('service.mjs');
  const fixture = createHermesFixture({ expectedKey: 'synthetic-response-style' });
  const address = await listen(fixture);
  const settingsPath = path.join(root, 'settings.json');
  const server = createWizardServer({ upstreamOrigin: `http://127.0.0.1:${address.port}`, hermesKey: 'synthetic-response-style', requireAccess: false, settingsPath, wizardOsHome: path.join(root, 'os'), hermesHome: path.join(root, 'hermes'), hermesStatePath: path.join(root, 'absent.db'), uxDir: path.resolve('web'), followThrough: false, skins: { relays: [], blossom: 'https://127.0.0.1/offline' } });
  const base = `http://127.0.0.1:${(await listen(server)).port}`;
  let browser; const checks = [], errors = [];
  const ok = name => { checks.push(name); console.log('PASS', name); };
  try {
    browser = await chromium.launch({ executablePath: process.env.QA_CHROME, args: ['--no-sandbox'] });
    for (const phone of [true, false]) {
      const kind = phone ? 'phone' : 'desktop';
      const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block' });
      await context.addInitScript(() => { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.tour.done', '1'); });
      const page = await context.newPage(); page.on('pageerror', e => errors.push(String(e)));
      await page.goto(base + '/wizard-os-home/' + (phone ? '' : 'desktop.html') + '?view=response-style');
      await page.waitForSelector('[data-response-style]:not([disabled])', { timeout: 30000 });
      for (const skin of ['nebula', 'signal']) {
        await page.evaluate(skin => WosSkin.set(skin), skin);
        await page.locator('[data-response-style]').selectOption('summary');
        await page.waitForFunction(() => document.querySelector('[data-response-style]')?.value === 'summary' && !document.querySelector('[data-response-style]').disabled);
        // Let the shell/skin entrance transform finish before measuring or capturing.
        await page.waitForTimeout(800);
        await page.screenshot({ path: path.join(out, kind + '-' + skin + '-summary.png') });
        const layout = await page.locator('[data-response-style]').evaluate(el => ({ value: el.value, height: el.getBoundingClientRect().height, color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor, overflow: document.documentElement.scrollWidth > innerWidth }));
        assert.equal(layout.overflow, false); assert.ok(layout.height >= 44); assert.equal(layout.value, 'summary'); ok(kind + ' ' + skin + ' skinned Summary and touch target');
      }
      await page.locator('[data-response-style]').selectOption('concise');
      await page.waitForFunction(() => document.querySelector('[data-response-style]')?.value === 'concise' && !document.querySelector('[data-response-style]').disabled);
      assert.equal((await (await fetch(base + '/wizard/v1/settings')).json()).settings.response_style, 'concise'); ok(kind + ' change is saved on Service');
      await page.reload();
      await page.waitForFunction(() => !!window.WosSettings && !!(window.__wos || window.__wux));
      await page.evaluate(() => WizCore.deeplink.route('/wizard-os-home/?view=response-style'));
      await page.waitForSelector('[data-response-style]:not([disabled])');
      assert.equal(await page.locator('[data-response-style]').inputValue(), 'concise'); ok(kind + ' reload keeps owner selection');
      const deny = async route => route.request().method() === 'PUT' ? route.fulfill({ status: 503, json: { error: 'synthetic_save_failure' } }) : route.continue();
      await page.route('**/wizard/v1/settings', deny);
      await page.locator('[data-response-style]').selectOption('summary');
      await page.waitForSelector('[data-response-style-retry]');
      assert.equal(await page.locator('[data-response-style]').inputValue(), 'concise'); ok(kind + ' failed save preserves last confirmed choice');
      await page.unroute('**/wizard/v1/settings', deny); await page.locator('[data-response-style-retry]').click();
      await page.waitForSelector('[data-response-style]:not([disabled])');
      assert.equal(await page.locator('[data-response-style-retry]').count(), 0); ok(kind + ' retry reads current owner value');
      if (phone) {
        await page.locator('[data-st-back]').click();
        assert.equal(await page.locator('[data-settings-root]').getAttribute('data-settings-page'), ''); assert.equal(page.isClosed(), false); ok(kind + ' nested Back returns to Settings');
      } else {
        await page.locator('[data-st-page="appearance"]').click();
        assert.equal(await page.locator('[data-settings-root]').getAttribute('data-settings-page'), 'appearance'); ok(kind + ' shared category navigation stays in Settings');
      }
      await context.close();
    }
    const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.equal(raw.response_style, 'concise');
    assert.deepEqual(Object.keys(raw.response_style_experiment).sort(), ['assigned', 'source', 'switches']); ok('local experiment is content-free');
    assert.deepEqual(errors, []); ok('no page errors');
    fs.writeFileSync(path.join(out, 'proof.json'), JSON.stringify({ synthetic: true, checks, errors }, null, 2));
  } finally {
    await browser?.close(); server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); await fixture.closeFixture(); fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
