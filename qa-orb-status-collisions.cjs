// Browser regression: phone orb status dots avoid the scrub handle and app count badge.
const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('./tools/qa-playwright.cjs');

const root = __dirname;
const port = Number(process.env.QA_PORT || 19486);
const origin = `http://127.0.0.1:${port}`;
const source = process.env.QA_SOURCE || '';
const out = process.env.QA_SHOTS || path.join(os.tmpdir(), 'wizard-ux-orb-status-collisions');
const appJs = source ? execFileSync('git', ['show', `${source}:web/app.js`], { cwd: root }) : null;
const skins = ['nebula', 'grove', 'tide', 'ember', 'signal'];
const widths = [320, 393];

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
const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

(async () => {
  await ready;
  fs.mkdirSync(out, { recursive: true });
  const launch = { headless: true };
  if (process.env.QA_CHROME) launch.executablePath = process.env.QA_CHROME;
  const browser = await chromium.launch(launch);
  const report = [];
  try {
    for (const skin of skins) {
      for (const width of widths) {
        const context = await browser.newContext({
          viewport: { width, height: width === 320 ? 700 : 852 },
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
          if (appJs && url.pathname === '/wizard-os-home/app.js') return route.fulfill({ status: 200, contentType: 'application/javascript', body: appJs });
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
        await page.waitForFunction(() => window.__wos?.live?.ok && window.WizCore?.workspaceNav && document.querySelector('#orbWrap'), null, { timeout: 20000 });
        await page.evaluate(() => window.__wos.openApp(window.WizCore.apps('mobile').APP.wizard));
        await page.waitForFunction(() => window.__wos.desks[window.__wos.idx]?.wins.some(id => window.__wos.wins[id]?.app === 'chats'));

        for (let count = 0; count <= 8; count++) {
          const state = await page.evaluate(n => {
            const live = window.__wos.live;
            const now = new Date().toISOString();
            const readyCount = n === 8 ? 5 : Math.ceil(n / 2);
            live.sessions = Array.from({ length: n }, (_, index) => index < readyCount ? {
              id: `ready-${index}`, title: `Ready ${index}`, runtime: 'direct', status: 'completed',
              attention: { state: 'needs_you' }, updatedAt: now, previewAt: now, lastAssistantAt: now,
              previewRole: 'assistant', preview: 'Ready fixture', messageCount: 2,
            } : {
              id: `working-${index}`, title: `Working ${index}`, runtime: 'direct', status: 'running',
              updatedAt: now, previewAt: now, previewRole: 'assistant', preview: 'Working fixture', messageCount: 2,
            });
            live.ok = true;
            live.at = Date.now();
            live.seen = { initializedAt: Date.now(), threads: {} };
            live.emit();
            window.WizCore.workspaceNav.setCount('wizard', n ? (n === 8 ? 12 : 1) : 0);
            const rect = element => {
              const r = element.getBoundingClientRect();
              return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
            };
            const dots = [...document.querySelectorAll('#moons i')].map(rect);
            const handle = rect(document.querySelector('#scrub i'));
            const badgeElement = document.querySelector('#orbBadge');
            const badge = badgeElement.hidden ? null : rect(badgeElement);
            return { dots, handle, badge, badgeText: badgeElement.textContent, skin: document.documentElement.dataset.skin };
          }, count);
          assert.equal(state.skin, skin, `${skin}/${width}: active skin`);
          assert.equal(state.dots.length, count, `${skin}/${width}: ${count} product-rendered dots`);
          assert.equal(state.badgeText, count ? (count === 8 ? '12' : '1') : '', `${skin}/${width}: authoritative count badge`);
          for (const [index, dot] of state.dots.entries()) {
            assert.equal(intersects(dot, state.handle), false, `${skin}/${width}/count-${count}: dot ${index} clears scrub handle`);
            if (state.badge) assert.equal(intersects(dot, state.badge), false, `${skin}/${width}/count-${count}: dot ${index} clears count badge (${JSON.stringify({ dot, badge: state.badge })})`);
          }
          if (count === 8) {
            const motion = await page.evaluate(async () => {
              const orb = document.querySelector('#orbWrap');
              orb.dataset.mode = 'listen';
              await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
              const moons = document.querySelector('#moons');
              const animation = getComputedStyle(moons).animationName;
              orb.dataset.mode = 'idle';
              return animation;
            });
            assert.equal(motion, 'none', `${skin}/${width}: voice mode cannot rotate safe angles over controls`);
            await page.screenshot({ path: path.join(out, `${skin}-${width}.png`), animations: 'disabled' });
          }
          report.push({ skin, width, count, dots: state.dots.length, badge: state.badgeText });
        }
        assert.deepEqual(errors, [], `${skin}/${width}: no page errors`);
        await context.close();
      }
    }
    console.log(`PASS orb status collisions: ${report.length} skin/width/count cases (${source || 'working tree'})`);
  } finally {
    await browser.close();
    fixture.kill();
  }
})().catch(error => {
  console.error(error);
  fixture.kill();
  process.exit(1);
});
