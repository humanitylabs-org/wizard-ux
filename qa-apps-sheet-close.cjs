// Browser regression: the visible phone Apps grip closes the sheet without an edge swipe.
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('./tools/qa-playwright.cjs');

const root = __dirname;
const port = Number(process.env.QA_PORT || 19490);
const origin = `http://127.0.0.1:${port}`;
const source = process.env.QA_SOURCE || '';
const out = process.env.QA_SHOTS || path.join(os.tmpdir(), 'wizard-ux-apps-sheet-close');
const overrides = new Map();
for (const file of ['web/index.html', 'web/styles.css', 'web/app.js']) {
  if (source) overrides.set('/wizard-os-home/' + file.slice(4), execFileSync('git', ['show', `${source}:${file}`], { cwd: root }));
}
if (source) overrides.set('/wizard-os-home/', overrides.get('/wizard-os-home/index.html'));
const skins = ['nebula', 'grove', 'tide', 'ember', 'signal'];
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
  settings: { owner: { name: 'Owner', place: '' }, agent: { name: 'Main' }, clock: { timezone: 'UTC', day_starts_at: '00:00' }, voice: { language: '', vocabulary: [] } },
  capabilities: {},
  endpoints: { apps: '/wizard/v1/apps', sessions: '/wizard/hermes/api/sessions' },
};

(async () => {
  await ready;
  fs.mkdirSync(out, { recursive: true });
  const launch = { headless: true };
  if (process.env.QA_CHROME) launch.executablePath = process.env.QA_CHROME;
  const browser = await chromium.launch(launch);
  const report = [];
  try {
    for (const skin of skins) {
      const context = await browser.newContext({
        viewport: { width: 393, height: 852 },
        isMobile: true,
        hasTouch: true,
        serviceWorkers: 'block',
      });
      await context.addInitScript(skinId => {
        localStorage.setItem('wos.skin', skinId);
        localStorage.setItem('wux.shell', 'phone');
        localStorage.setItem('wos.tour.v1', 'true');
        localStorage.setItem('wos.tour.done', '1');
        localStorage.setItem('wos.coached', 'true');
        localStorage.setItem('wos.rvCoached', 'true');
        localStorage.setItem('wos.welcome.v1', 'done');
      }, skin);
      await context.route('**/*', route => {
        const request = route.request();
        const url = new URL(request.url());
        if (overrides.has(url.pathname)) {
          const type = url.pathname.endsWith('.css') ? 'text/css' : url.pathname.endsWith('.js') ? 'application/javascript' : 'text/html';
          return route.fulfill({ status: 200, contentType: type, body: overrides.get(url.pathname) });
        }
        if (url.pathname === '/wizard/v1/bootstrap') return json(route, bootstrap);
        if (url.pathname === '/wizard/v1/setup') return json(route, { first_run: false });
        if (url.pathname === '/wizard/hermes/api/model/options') return json(route, { provider: 'fixture', providers: [{ slug: 'fixture', authenticated: true }] });
        if (url.pathname === '/wizard/v1/apps') return json(route, { apps: [] });
        if (url.pathname === '/wizard/v1/agents') return json(route, { agents: [{ id: 'hermes', label: 'Main', is_default: true, status: 'running' }] });
        if (url.pathname === '/wizard/v1/pages') return json(route, { pages: [] });
        if (url.pathname === '/wizard/hermes/api/sessions') return json(route, { data: [], has_more: false });
        if (!['GET', 'HEAD'].includes(request.method())) return json(route, { error: 'read_only_fixture' }, 403);
        return route.continue();
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin + '/wizard-os-home/?shell=phone&myskin=off', { waitUntil: 'load' });
      await page.waitForFunction(() => window.__wos?.live?.ok && window.WizCore?.apps, null, { timeout: 20000 });
      await page.locator('#orb').focus();
      await page.evaluate(() => window.__wos.openSheet('launcher'));
      await page.waitForFunction(() => window.__wos.sheet === 'launcher' && document.querySelector('#launcher.open'));
      await page.locator('#launcher').evaluate(async element => {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await Promise.allSettled(element.getAnimations({ subtree: true }).map(animation => animation.finished));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });

      const close = page.locator('[data-launcher-close]');
      assert.equal(await close.count(), 1, `${skin}: visible Apps grip is a close control`);
      const geometry = await close.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const bar = getComputedStyle(element, '::after');
        const points = [
          [rect.left + rect.width / 2, rect.top + 1],
          [rect.right - 1, rect.top + rect.height / 2],
          [rect.left + rect.width / 2, rect.bottom - 1],
          [rect.left + 1, rect.top + rect.height / 2],
          [rect.left + rect.width / 2, rect.top + rect.height / 2],
        ];
        const hits = points.map(([x, y]) => document.elementFromPoint(x, y));
        const sheet = element.closest('.sheet').getBoundingClientRect();
        const orb = document.querySelector('#orbWrap')?.getBoundingClientRect();
        return {
          width: rect.width,
          height: rect.height,
          top: rect.top,
          bottom: rect.bottom,
          transparentTarget: style.backgroundColor === 'rgba(0, 0, 0, 0)',
          visibleBar: bar.backgroundColor !== 'rgba(0, 0, 0, 0)',
          barWidth: parseFloat(bar.width),
          barHeight: parseFloat(bar.height),
          insideSheet: rect.top >= sheet.top && rect.bottom <= sheet.bottom,
          ownsHits: hits.every(hit => hit === element || element.contains(hit)),
          hits: hits.map(hit => hit ? `${hit.tagName.toLowerCase()}#${hit.id}.${hit.className}` : 'none'),
          orb: orb ? { left: orb.left, top: orb.top, right: orb.right, bottom: orb.bottom } : null,
        };
      });
      assert.ok(geometry.width >= 44 && geometry.height >= 44, `${skin}: grip close target is at least 44px (${geometry.width}x${geometry.height})`);
      assert.equal(geometry.transparentTarget, true, `${skin}: enlarged target remains invisible`);
      assert.equal(geometry.visibleBar, true, `${skin}: close keeps a visible grip`);
      assert.deepEqual([geometry.barWidth, geometry.barHeight], [40, 4], `${skin}: visible grip remains 40x4px`);
      assert.equal(geometry.insideSheet, true, `${skin}: full close target stays inside the clipped sheet (${JSON.stringify(geometry)})`);
      assert.equal(geometry.ownsHits, true, `${skin}: grip owns its centre and edge hit points (${JSON.stringify(geometry)})`);
      await page.screenshot({ path: path.join(out, `${skin}.png`), animations: 'disabled' });

      await close.tap();
      await page.waitForFunction(() => window.__wos.sheet === null && !document.querySelector('#launcher.open'));
      await page.evaluate(() => window.__wos.openSheet('launcher'));
      await close.focus();
      await close.press('Enter');
      await page.waitForFunction(() => window.__wos.sheet === null && !document.querySelector('#launcher.open'));
      assert.equal(await page.evaluate(() => document.activeElement?.id), 'orb', `${skin}: keyboard close restores the opener`);
      assert.deepEqual(errors, [], `${skin}: no page errors`);
      report.push({ skin, geometry, tapClosed: true, keyboardClosed: true });
      await context.close();
    }
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`PASS Apps sheet close grip: ${report.length} skins (${source || 'working tree'})`);
  } finally {
    await browser.close();
    fixture.kill();
  }
})().catch(error => {
  console.error(error);
  fixture.kill();
  process.exit(1);
});
