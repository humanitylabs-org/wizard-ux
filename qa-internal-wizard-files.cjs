// Browser regression: Files is one launcher entry while wizard-files remains an internal provider.
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('./tools/qa-playwright.cjs');

const root = __dirname;
const port = Number(process.env.QA_PORT || 19488);
const origin = `http://127.0.0.1:${port}`;
const source = process.env.QA_SOURCE || '';
const out = process.env.QA_SHOTS || path.join(os.tmpdir(), 'wizard-ux-files-deduplication');
const appsJs = source ? execFileSync('git', ['show', `${source}:web/core/apps.js`], { cwd: root }) : null;
const fixture = spawn(process.execPath, ['tools/fake-setup-api.cjs', String(port)], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
const ready = new Promise((resolve, reject) => {
  fixture.stdout.on('data', chunk => { if (String(chunk).includes('fake-setup-api')) resolve(); });
  fixture.on('error', reject);
  fixture.on('exit', code => reject(new Error(`fixture exited ${code}`)));
});
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const bootstrap = {
  bootstrap: 1,
  settings: { owner: { name: 'Owner', place: '' }, agent: { name: 'Main' }, clock: { timezone: 'UTC', day_starts_at: '00:00' }, voice: { language: '', vocabulary: [] } },
  capabilities: {},
  endpoints: { apps: '/wizard/v1/apps', sessions: '/wizard/hermes/api/sessions' },
};
const files = { id: 'files', name: 'Files', url: '/files/', source: 'apps.json', type: 'view', category: 'system', provides: ['files'] };
const provider = { id: 'wizard-files', name: 'Wizard Files', url: '/wizard-files/', source: 'apps.json', type: 'service', category: 'system', provides: ['files'] };
const nativeFiles = { id: 'files', name: 'Files', href: 'intent://files' };

(async () => {
  await ready;
  fs.mkdirSync(out, { recursive: true });
  const launch = { headless: true };
  if (process.env.QA_CHROME) launch.executablePath = process.env.QA_CHROME;
  const browser = await chromium.launch(launch);
  const report = [];
  try {
    for (const mode of ['owner', 'native', 'fallback']) {
      for (const shell of ['mobile', 'desktop']) {
        const phone = shell === 'mobile';
        const context = await browser.newContext({
          viewport: phone ? { width: 393, height: 852 } : { width: 1440, height: 900 },
          isMobile: phone,
          hasTouch: phone,
          serviceWorkers: 'block',
        });
        await context.addInitScript(shellName => {
          localStorage.setItem('wos.skin', 'nebula');
          localStorage.setItem('wux.shell', shellName === 'mobile' ? 'phone' : 'desktop');
          localStorage.setItem('wos.tour.v1', 'true');
          localStorage.setItem('wos.tour.done', '1');
          localStorage.setItem('wos.coached', 'true');
          localStorage.setItem('wos.rvCoached', 'true');
          localStorage.setItem('wos.welcome.v1', 'done');
        }, shell);
        await context.route('**/*', route => {
          const request = route.request();
          const url = new URL(request.url());
          if (appsJs && url.pathname === '/wizard-os-home/core/apps.js') return route.fulfill({ status: 200, contentType: 'application/javascript', body: appsJs });
          if (url.pathname === '/wizard/v1/bootstrap') return json(route, bootstrap);
          if (url.pathname === '/wizard/v1/setup') return json(route, { first_run: false });
          if (url.pathname === '/wizard/hermes/api/model/options') return json(route, { provider: 'fixture', providers: [{ slug: 'fixture', authenticated: true }] });
          if (url.pathname === '/wizard/v1/ui-preferences') return json(route, { migrations: { 'launcher-seed-v1': true }, launcher: { nativeLinks: mode === 'native' ? [nativeFiles] : [] } });
          if (url.pathname === '/wizard/v1/apps') return json(route, { apps: mode === 'owner' ? [files, provider] : [provider] });
          if (url.pathname === '/wizard/v1/agents') return json(route, { agents: [{ id: 'hermes', label: 'Main', is_default: true, status: 'running' }] });
          if (url.pathname === '/wizard/v1/pages') return json(route, { pages: [] });
          if (url.pathname === '/wizard/hermes/api/sessions') return json(route, { data: [], has_more: false });
          if (url.pathname === '/wizard-files/' || url.pathname === '/wizard-files/index.html') return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Wizard Files</title><main>Wizard Files provider</main>' });
          if (!['GET', 'HEAD'].includes(request.method())) return json(route, { error: 'read_only_fixture' }, 403);
          return route.continue();
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const entry = phone ? '/wizard-os-home/?shell=phone&myskin=off' : '/wizard-os-home/desktop.html?shell=desktop&myskin=off';
        await page.goto(origin + entry, { waitUntil: 'load' });
        await page.waitForFunction(async shellName => {
          if (!window.WizCore?.apps || !window.WosAppKinds || !window.WizLauncher?.settled) return false;
          await window.WizCore.refreshApps({ afterPending: true });
          const registry = window.WizCore.apps(shellName);
          return !!registry.APP['wizard-files'] && (shellName === 'desktop' || !!window.__wos);
        }, shell, { timeout: 20000 });

        const classified = await page.evaluate(shellName => {
          const { APPS, APP } = window.WizCore.apps(shellName);
          const rows = window.WosAppKinds.rows(APPS, APP, app => app.id, shellName);
          const ids = Object.values(rows).flat().map(row => row.id);
          return {
            hasFilesRecord: !!APP.files,
            hasProviderRecord: !!APP['wizard-files'],
            providerInternal: window.WizCore.isMaintenanceApp(APP['wizard-files'], shellName),
            filesRows: ids.filter(id => id === 'files').length,
            providerRows: ids.filter(id => id === 'wizard-files').length,
          };
        }, shell);
        assert.equal(classified.hasProviderRecord, true, `${shell}: provider remains addressable`);
        const providerInternal = mode === 'owner' || (mode === 'native' && phone);
        assert.equal(classified.providerInternal, providerInternal, `${shell}: provider internal only when an owner Files surface exists on this shell`);
        assert.equal(classified.hasFilesRecord, mode === 'owner' || (mode === 'native' && phone), `${shell}: owner Files record follows fixture`);
        assert.equal(classified.filesRows, mode === 'owner' ? 1 : 0, `${shell}: one owner-facing Files row`);
        assert.equal(classified.providerRows, providerInternal ? 0 : 1, `${shell}: provider fallback row`);

        let rendered = null;
        if (phone) {
          await page.evaluate(() => window.__wos.openOverview());
          await page.waitForTimeout(350);
          await page.locator('[data-ovadd]:visible').tap();
          await page.waitForTimeout(750);
          rendered = await page.evaluate(() => {
            const desk = [...document.querySelectorAll('.new-desk')].find(node => {
              const rect = node.getBoundingClientRect();
              const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + Math.min(rect.height / 2, 160));
              return rect.left >= 0 && rect.right <= innerWidth && rect.top < innerHeight && rect.bottom > 0 && node.contains(hit);
            });
            return {
              files: desk?.querySelectorAll('[data-app="files"], [data-appinfo="files"]').length || 0,
              provider: desk?.querySelectorAll('[data-app="wizard-files"], [data-appinfo="wizard-files"]').length || 0,
            };
          });
          assert.deepEqual(rendered, { files: mode === 'owner' ? 1 : 0, provider: mode === 'fallback' ? 1 : 0 }, 'phone New desk matches shared rows');
          await page.screenshot({ path: path.join(out, `${mode}-phone.png`), animations: 'disabled' });
        } else {
          await page.evaluate(() => window.__wux.openPicker());
          await page.waitForFunction(() => !document.querySelector('#palette')?.hidden && document.querySelectorAll('#palList .pal-app').length > 0);
          rendered = await page.evaluate(() => {
            const labels = [...document.querySelectorAll('#palList .pal-app .nm')].map(node => node.textContent.trim());
            return {
              files: labels.filter(label => label === 'Files').length,
              provider: labels.filter(label => label === 'Wizard Files').length,
            };
          });
          assert.deepEqual(rendered, {
            files: mode === 'owner' ? 1 : 0,
            provider: mode === 'owner' ? 0 : 1,
          }, 'desktop picker keeps a Files entry when a native-only link is unavailable');
          await page.screenshot({ path: path.join(out, `${mode}-desktop.png`), animations: 'disabled' });
        }
        assert.deepEqual(errors, [], `${shell}: no page errors`);
        report.push({ mode, shell, classified, rendered });
        await context.close();
      }
    }
    console.log(`PASS Files provider deduplication: ${report.length} browser cases (${source || 'working tree'})`);
  } finally {
    await browser.close();
    fixture.kill();
  }
})().catch(error => {
  console.error(error);
  fixture.kill();
  process.exit(1);
});
