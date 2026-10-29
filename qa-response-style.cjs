// Synthetic full-shell proof: never connects to a live Wizard or reads owner history.
// QA_SERVICE=<service checkout> QA_OUT=<evidence dir> QA_CHROME=<chromium> node qa-response-style.cjs
// QA_EXPECT_PICKER=1 verifies the baseline markup without mutating its retired preference.
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
(async () => {
  assert.ok(process.env.QA_SERVICE && process.env.QA_OUT && process.env.QA_CHROME, 'Explicit synthetic service, evidence and browser paths required');
  const baseline = process.env.QA_EXPECT_PICKER === '1';
  const out = path.resolve(process.env.QA_OUT); fs.mkdirSync(out, { recursive: true });
  const root = fs.mkdtempSync(path.join(out, 'fixture-'));
  const load = file => import(pathToFileURL(path.join(process.env.QA_SERVICE, 'server', file)));
  const { createHermesFixture } = await load('fixture.mjs');
  const { createWizardServer, listen } = await load('service.mjs');
  const fixture = createHermesFixture({ expectedKey: 'synthetic-response-style' });
  const address = await listen(fixture);
  const settingsPath = path.join(root, 'settings.json');
  const initial = JSON.stringify({ response_style: 'summary', untouched: 'synthetic-owner-value' });
  fs.writeFileSync(settingsPath, initial);
  const server = createWizardServer({ upstreamOrigin: `http://127.0.0.1:${address.port}`, hermesKey: 'synthetic-response-style', requireAccess: false, settingsPath, wizardOsHome: path.join(root, 'os'), hermesHome: path.join(root, 'hermes'), hermesStatePath: path.join(root, 'absent.db'), uxDir: path.resolve(process.env.QA_SOURCE || 'web'), followThrough: false, skins: { relays: [], blossom: 'https://127.0.0.1/offline' } });
  const base = `http://127.0.0.1:${(await listen(server)).port}`;
  let browser; const checks = [], errors = [], writes = [];
  const ok = name => { checks.push(name); console.log('PASS', name); };
  try {
    browser = await chromium.launch({ executablePath: process.env.QA_CHROME, args: ['--no-sandbox'] });
    for (const phone of [true, false]) {
      const kind = phone ? 'phone' : 'desktop';
      const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block' });
      await context.addInitScript(() => { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.tour.done', '1'); });
      const page = await context.newPage(); page.on('pageerror', e => errors.push(String(e)));
      page.on('request', request => { if (request.url().includes('/wizard/v1/settings') && request.method() !== 'GET') writes.push(request.method()); });
      const enter = async () => {
        await page.goto(base + '/wizard-os-home/' + (phone ? '' : 'desktop.html') + '?view=response-style');
        await page.waitForFunction(() => !!window.WosSettings && !!(window.__wos || window.__wux));
        await page.evaluate(() => WizCore.deeplink.route('/wizard-os-home/?view=response-style'));
        if (baseline) await page.waitForSelector('[data-response-style]:not([disabled])');
        else await page.getByText('Each agent keeps its own. Tell an agent how you like replies and it remembers.', { exact: true }).waitFor({ state: 'visible' });
      };
      await enter();
      for (const skin of ['nebula', 'signal']) {
        await page.evaluate(skin => WosSkin.set(skin), skin);
        await page.waitForTimeout(800); // Let finite skin/sheet entrance transitions settle.
        assert.equal(await page.locator('[data-response-style]').count(), baseline ? 1 : 0);
        assert.equal(await page.locator('[data-response-style-retry]').count(), 0);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        if (!baseline) {
          const note = page.getByText('Each agent keeps its own. Tell an agent how you like replies and it remembers.', { exact: true });
          await note.scrollIntoViewIfNeeded();
          assert.ok(await note.isVisible());
        }
        await page.screenshot({ path: path.join(out, kind + '-' + skin + (baseline ? '-baseline.png' : '-own.png')) });
        ok(kind + ' ' + skin + (baseline ? ' baseline picker visible' : ' persona note visible, picker and retry absent, no overflow'));
      }
      await enter(); ok(kind + ' reload and deep link preserve the same reply-style screen');
      if (phone) {
        await page.locator('[data-st-back]').click();
        assert.equal(await page.locator('[data-settings-root]').getAttribute('data-settings-page'), ''); assert.equal(page.isClosed(), false); ok(kind + ' nested Back returns to Settings');
      } else {
        await page.locator('[data-st-page="appearance"]').click();
        assert.equal(await page.locator('[data-settings-root]').getAttribute('data-settings-page'), 'appearance'); ok(kind + ' shared category navigation stays in Settings');
      }
      await context.close();
    }
    assert.equal(fs.readFileSync(settingsPath, 'utf8'), initial); ok('owner settings bytes stay unchanged');
    assert.deepEqual(writes, []); ok('neither shell writes a retired response-style preference');
    assert.deepEqual(errors, []); ok('no page errors');
    fs.writeFileSync(path.join(out, 'proof.json'), JSON.stringify({ synthetic: true, baseline, checks, errors, writes }, null, 2));
  } finally {
    await browser?.close(); server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); await fixture.closeFixture(); fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
