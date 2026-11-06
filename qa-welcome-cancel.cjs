// Browser regression for escaping Welcome after a Wizard is already configured.
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('./tools/qa-playwright.cjs');

const repo = __dirname;
const port = Number(process.env.QA_PORT || 19481);
const origin = `http://127.0.0.1:${port}`;
const out = process.env.QA_OUTPUT || path.join(os.tmpdir(), 'wizard-ux-welcome-cancel');
const source = process.env.QA_SOURCE || '';
const override = source ? {
  js: execFileSync('git', ['show', `${source}:web/core/welcome.js`], { cwd: repo }),
  css: execFileSync('git', ['show', `${source}:web/core/welcome.css`], { cwd: repo }),
} : null;
fs.mkdirSync(out, { recursive: true });

const fixture = spawn(process.execPath, ['tools/fake-setup-api.cjs', String(port)], {
  cwd: repo,
  stdio: ['ignore', 'pipe', 'inherit'],
});
const ready = new Promise((resolve, reject) => {
  fixture.stdout.on('data', chunk => { if (String(chunk).includes('fake-setup-api')) resolve(); });
  fixture.on('error', reject);
  fixture.on('exit', code => reject(new Error(`fixture exited ${code}`)));
});
const reset = () => fetch(origin + '/__fake/reset', { method: 'POST' });
const modelOptions = {
  provider: 'openai-codex',
  providers: [{ slug: 'openai-codex', authenticated: false, source: 'hermes' }],
};
const bootstrap = {
  bootstrap: 1,
  settings: { owner: { name: 'Owner', place: '' }, agent: { name: 'Main' }, clock: { timezone: '', day_starts_at: '00:00' }, voice: { language: '', vocabulary: [] } },
  capabilities: {},
  endpoints: {},
};

(async () => {
  await ready;
  const launch = { headless: true };
  if (process.env.QA_CHROME) launch.executablePath = process.env.QA_CHROME;
  const browser = await chromium.launch(launch);
  const report = [];
  try {
    for (const mode of ['phone', 'desktop']) {
      await reset();
      const phone = mode === 'phone';
      const context = await browser.newContext({
        viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
        isMobile: phone,
        hasTouch: phone,
        serviceWorkers: 'block',
      });
      await context.addInitScript(shell => {
        localStorage.setItem('wux.shell', shell);
        localStorage.setItem('wos.tour.v1', 'true');
        localStorage.setItem('wos.coached', 'true');
        localStorage.removeItem('wos.welcome.v1');
      }, mode);
      await context.route('**/*', route => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname === '/wizard/hermes/api/model/options') {
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(modelOptions) });
        }
        if (pathname === '/wizard/v1/bootstrap') {
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bootstrap) });
        }
        if (override && pathname === '/wizard-os-home/core/welcome.js') {
          return route.fulfill({ status: 200, contentType: 'application/javascript', body: override.js });
        }
        if (override && pathname === '/wizard-os-home/core/welcome.css') {
          return route.fulfill({ status: 200, contentType: 'text/css', body: override.css });
        }
        return route.continue();
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const entry = phone ? '/wizard-os-home/?shell=phone' : '/wizard-os-home/desktop.html?shell=desktop';
      await page.goto(origin + entry, { waitUntil: 'load' });
      await page.locator('#wosWelcome h2').waitFor({ timeout: 15000 });
      assert.equal(await page.locator('#wosWelcome h2').textContent(), 'Connect your AI');
      await page.screenshot({ path: path.join(out, `${mode}.png`), fullPage: true, animations: 'disabled' });

      const cancel = page.locator('#wosWelcome [data-wl="cancel"]');
      assert.equal(await cancel.count(), 1, `${mode}: Welcome must expose Cancel setup`);
      const geometry = await cancel.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return {
          width: rect.width,
          height: rect.height,
          inside: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
          ownsHit: hit === element || element.contains(hit),
        };
      });
      assert.ok(geometry.width >= 44 && geometry.height >= 44, `${mode}: cancel target is at least 44px`);
      assert.equal(geometry.inside, true, `${mode}: cancel target stays inside the viewport`);
      assert.equal(geometry.ownsHit, true, `${mode}: cancel target owns its hit point`);

      if (phone) await cancel.tap(); else await cancel.click();
      await page.locator('#wosWelcome').waitFor({ state: 'detached' });
      assert.equal(await page.evaluate(() => localStorage.getItem('wos.welcome.v1')), 'done');
      const log = await (await fetch(origin + '/__fake/log')).json();
      assert.equal(log.filter(row => row.method === 'POST' && row.path === '/wizard/v1/setup/seen').length, 1);
      await page.reload({ waitUntil: 'load' });
      await page.waitForTimeout(750);
      assert.equal(await page.locator('#wosWelcome').count(), 0, `${mode}: dismissed Welcome stays dismissed`);
      assert.deepEqual(errors, []);
      report.push({ mode, geometry, pageErrors: errors.length });
      await context.close();
    }

    await reset();
    await fetch(origin + '/__fake/state', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ firstRun: false }),
    });
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      serviceWorkers: 'block',
    });
    await context.addInitScript(() => {
      localStorage.setItem('wux.shell', 'phone');
      localStorage.setItem('wos.tour.v1', 'true');
      localStorage.setItem('wos.coached', 'true');
      localStorage.setItem('wos.welcome.v1', 'ai');
    });
    await context.route('**/*', route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/wizard/hermes/api/model/options') return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(modelOptions),
      });
      if (pathname === '/wizard/v1/bootstrap') return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(bootstrap),
      });
      if (override && pathname === '/wizard-os-home/core/welcome.js') return route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: override.js,
      });
      if (override && pathname === '/wizard-os-home/core/welcome.css') return route.fulfill({
        status: 200,
        contentType: 'text/css',
        body: override.css,
      });
      return route.continue();
    });
    const page = await context.newPage();
    await page.goto(origin + '/wizard-os-home/?shell=phone', { waitUntil: 'load' });
    await page.waitForTimeout(1200);
    assert.equal(await page.locator('#wosWelcome').count(), 0, 'configured Wizard ignores stale Welcome progress');
    assert.equal(await page.evaluate(() => localStorage.getItem('wos.welcome.v1')), 'done');
    report.push({ mode: 'phone', configuredWizard: true, welcome: false });
    await context.close();

    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`PASS welcome cancel: ${report.length} cases (${source || 'working tree'})`);
  } finally {
    await browser.close();
    fixture.kill();
  }
})().catch(error => {
  console.error(error);
  fixture.kill();
  process.exit(1);
});
