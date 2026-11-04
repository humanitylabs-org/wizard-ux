// Browser regression: owner-operated screens stay in Apps in both Wizard shells.
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('./tools/qa-playwright.cjs');

const root = __dirname;
const port = Number(process.env.QA_PORT || 19483);
const origin = `http://127.0.0.1:${port}`;
const source = process.env.QA_SOURCE || '';
const out = process.env.QA_SHOTS || path.join(os.tmpdir(), 'wizard-ux-human-app-placement');
const overrides = new Map();
for (const file of ['web/core/app-kinds.js', 'web/core/apps.js', 'web/app.js', 'web/desktop/desktop.js']) {
  if (source) overrides.set('/wizard-os-home/' + file.slice(4), execFileSync('git', ['show', `${source}:${file}`], { cwd: root }));
}

const fixture = spawn(process.execPath, ['tools/fake-setup-api.cjs', String(port)], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'inherit'],
});
const ready = new Promise((resolve, reject) => {
  fixture.stdout.on('data', chunk => { if (String(chunk).includes('fake-setup-api')) resolve(); });
  fixture.on('error', reject);
  fixture.on('exit', code => reject(new Error(`fixture exited ${code}`)));
});
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const bootstrap = {
  bootstrap: 1,
  settings: { owner: { name: 'Owner', place: '' }, agent: { name: 'Personal' }, clock: { timezone: 'UTC', day_starts_at: '00:00' }, voice: { language: '', vocabulary: [] } },
  capabilities: {},
  endpoints: { apps: '/wizard/v1/apps', sessions: '/wizard/hermes/api/sessions' },
};
const installed = {
  apps: [
    { id: 'notifications', name: 'Notifications', url: '/notifications/', source: 'apps.json', type: 'view', category: 'system', system: true },
    { id: 'sync-helper', name: 'Sync helper', url: '', source: 'apps.json', type: 'service', category: 'agent' },
    { id: 'wizard-google', name: 'Google', url: '', source: 'apps.json', type: 'external', category: 'system' },
  ],
};
const agents = { agents: [
  { id: 'hermes', label: 'Personal', is_default: true, harness: 'hermes', status: 'running', privacy: 'standard' },
  { id: 'specialist', label: 'Specialist', is_default: false, harness: 'hermes', status: 'running', privacy: 'standard' },
] };
const skins = ['nebula', 'grove', 'tide', 'ember', 'signal'];

async function inspectGroups(page, shell) {
  return page.evaluate(shellName => {
    const { APPS, APP } = window.WizCore.apps(shellName);
    const kinds = window.WosAppKinds.kinds(APPS, APP);
    const rows = window.WosAppKinds.rows(APPS, APP, app => app.id);
    const opensScreen = window.WosAppKinds.opensScreen || (app => !!app && (!!app.url || app.kind !== 'wizard'));
    const group = id => Object.entries(kinds).find(([, list]) => Array.isArray(list) && list.some(app => app.id === id))?.[0] || '';
    const rowGroup = id => Object.entries(rows).find(([, list]) => Array.isArray(list) && list.some(app => app.id === id))?.[0] || '';
    return {
      groups: Object.fromEntries(['wizard', 'notifications', 'pages', 'agent:specialist', 'sync-helper', 'wizard-google'].map(id => [id, group(id)])),
      rowGroups: Object.fromEntries(['wizard', 'notifications', 'pages', 'agent:specialist', 'sync-helper', 'wizard-google'].map(id => [id, rowGroup(id)])),
      mainName: kinds.apps.find(app => app.id === 'wizard')?.name || '',
      pagesOpens: opensScreen(APP.pages),
      helperOpens: opensScreen((window.WizCore.backendApps() || []).find(app => app.id === 'sync-helper')),
    };
  }, shell);
}

function verifyPlacement(result, label) {
  const expected = {
    wizard: 'apps', notifications: 'apps', pages: 'apps',
    'agent:specialist': 'agents', 'sync-helper': 'wiz', 'wizard-google': 'conns',
  };
  assert.deepEqual(result.groups, expected, `${label}: classifier placement`);
  assert.deepEqual(result.rowGroups, expected, `${label}: shared layout rows`);
  assert.equal(result.mainName, 'Personal Main Agent', `${label}: dynamic main-agent label`);
  assert.equal(result.pagesOpens, true, `${label}: Pages opens its screen`);
  assert.equal(result.helperOpens, false, `${label}: screenless service opens settings`);
}

(async () => {
  await ready;
  fs.mkdirSync(out, { recursive: true });
  const launch = { headless: true };
  if (process.env.QA_CHROME) launch.executablePath = process.env.QA_CHROME;
  const browser = await chromium.launch(launch);
  const report = [];
  try {
    for (const skin of skins) {
      for (const shell of ['mobile', 'desktop']) {
        const phone = shell === 'mobile';
        const context = await browser.newContext({
          viewport: phone ? { width: 393, height: 852 } : { width: 1440, height: 900 },
          isMobile: phone,
          hasTouch: phone,
          serviceWorkers: 'block',
        });
        await context.addInitScript(({ skinId, shellName }) => {
          localStorage.setItem('wos.skin', skinId);
          localStorage.setItem('wux.shell', shellName === 'mobile' ? 'phone' : 'desktop');
          localStorage.setItem('wos.tour.v1', 'true');
          localStorage.setItem('wos.tour.done', '1');
          localStorage.setItem('wos.coached', 'true');
          localStorage.setItem('wos.rvCoached', 'true');
          localStorage.setItem('wos.welcome.v1', 'done');
        }, { skinId: skin, shellName: shell });
        await context.route('**/*', route => {
          const request = route.request();
          const url = new URL(request.url());
          if (overrides.has(url.pathname)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: overrides.get(url.pathname) });
          if (url.pathname === '/wizard/v1/bootstrap') return json(route, bootstrap);
          if (url.pathname === '/wizard/v1/setup') return json(route, { first_run: false });
          if (url.pathname === '/wizard/hermes/api/model/options') return json(route, { provider: 'fixture', providers: [{ slug: 'fixture', authenticated: true }] });
          if (url.pathname === '/wizard/v1/apps') return json(route, installed);
          if (url.pathname === '/wizard/v1/agents') return json(route, agents);
          if (url.pathname === '/wizard/v1/pages') return json(route, { pages: [] });
          if (url.pathname === '/wizard/hermes/api/sessions') return json(route, { data: [], has_more: false });
          if (url.pathname === '/notifications/' || url.pathname === '/notifications/index.html') return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Notifications</title><main>Notifications</main>' });
          if (!['GET', 'HEAD'].includes(request.method())) return json(route, { error: 'read_only_fixture' }, 403);
          return route.continue();
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const entry = phone ? '/wizard-os-home/?shell=phone&myskin=off' : '/wizard-os-home/desktop.html?shell=desktop&myskin=off';
        await page.goto(origin + entry, { waitUntil: 'load' });
        await page.waitForFunction(() => window.WizCore?.apps && window.WosAppKinds && window.WosAgents?.list?.length >= 2 && window.WosPages?.available, null, { timeout: 20000 });
        await page.evaluate(async shellName => {
          window.WizCore.apps(shellName);
          await window.WosAgents.load(true);
          await window.WizCore.refreshApps({ afterPending: true });
        }, shell);
        await page.waitForFunction(shellName => {
          const registry = window.WizCore.apps(shellName);
          return !!registry.APP['agent:specialist'] && !!registry.APP.notifications && !!registry.APP.pages &&
            (window.WizCore.backendApps() || []).some(app => app.id === 'sync-helper');
        }, shell, { timeout: 20000 });
        const result = await inspectGroups(page, shell);
        verifyPlacement(result, `${skin}/${shell}`);

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
              return rect.left >= 0 && rect.right <= innerWidth && rect.top < innerHeight && rect.bottom > 0 && rect.width > 0 && node.contains(hit);
            });
            if (!desk) return null;
            desk.dataset.qaActive = 'true';
            const tile = id => desk.querySelector(`[data-app="${id}"], [data-appinfo="${id}"]`);
            const group = id => tile(id)?.closest('.lgroup')?.className.match(/kg-([a-z]+)/)?.[1] || '';
            return {
              groups: Object.fromEntries(['wizard', 'notifications', 'pages', 'agent:specialist', 'sync-helper', 'wizard-google'].map(id => [id, group(id)])),
              mainName: tile('wizard')?.querySelector('.nm')?.textContent || '',
              counts: Object.fromEntries(['wizard', 'notifications', 'pages', 'agent:specialist', 'sync-helper', 'wizard-google'].map(id => [id, desk.querySelectorAll(`[data-app="${id}"], [data-appinfo="${id}"]`).length])),
            };
          });
          assert.ok(rendered, `${skin}/mobile: visible New desk exists`);
          assert.deepEqual(rendered.groups, result.groups, `${skin}/mobile: rendered groups match classifier`);
          assert.equal(rendered.mainName, 'Personal Main Agent', `${skin}/mobile: rendered dynamic label`);
          assert.deepEqual(rendered.counts, { wizard: 1, notifications: 1, pages: 1, 'agent:specialist': 1, 'sync-helper': 1, 'wizard-google': 1 }, `${skin}/mobile: one tile per target`);
          await page.screenshot({ path: path.join(out, `${skin}-phone.png`), animations: 'disabled' });
          if (skin === 'nebula') {
            await page.locator('[data-qa-active="true"]').evaluate(async node => {
              await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
              await Promise.allSettled(node.getAnimations({ subtree: true }).map(animation => animation.finished));
              await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            });
            await page.locator('[data-qa-active="true"] [data-app="pages"]').click();
            await page.locator('.pg-host.pg-root').waitFor({ state: 'attached', timeout: 10000 });
          }
        } else {
          await page.evaluate(() => window.__wux.openPicker());
          await page.waitForFunction(() => !document.querySelector('#palette')?.hidden && document.querySelectorAll('#palList .pal-app').length > 0);
          rendered = await page.evaluate(() => {
            return [...document.querySelectorAll('#palList .pal-app .nm')].map(node => node.textContent.trim());
          });
          assert.ok(rendered.includes('Pages'), `${skin}/desktop: owner-facing Pages is in the visible picker`);
          assert.ok(rendered.includes('Notifications'), `${skin}/desktop: owner-facing Notifications is in the visible picker`);
          await page.screenshot({ path: path.join(out, `${skin}-desktop.png`), animations: 'disabled' });
          if (skin === 'nebula') {
            await page.locator('#palList .pal-app .nm').filter({ hasText: /^Pages$/ }).click();
            await page.locator('.pg-host.pg-root').waitFor({ state: 'attached', timeout: 10000 });
          }
        }
        assert.deepEqual(errors, [], `${skin}/${shell}: no page errors`);
        report.push({ skin, shell, result, rendered, pageErrors: errors.length });
        await context.close();
      }
    }
    console.log(`PASS human app placement: ${report.length} shell/skin cases (${source || 'working tree'})`);
  } finally {
    await browser.close();
    fixture.kill();
  }
})().catch(error => {
  console.error(error);
  fixture.kill();
  process.exit(1);
});
