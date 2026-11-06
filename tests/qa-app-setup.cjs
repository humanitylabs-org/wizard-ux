// Isolated light Chromium QA: actual phone/desktop entrypoints and Store. All APIs are fixtures;
// no live shell, owner data, credentials, installs or external network are touched.
const { chromium } = require('../tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const web = path.resolve(__dirname, '../web'), out = process.env.QA_OUT || path.resolve('qa/app-setup');
const origin = 'http://setup.qa', prefix = '/wizard-os-home/';
const sha = 'a'.repeat(40);
const app = (id, name, extra = {}) => ({ id, name, summary: name, publisher: 'QA', version: '1', type: 'view', category: 'Utilities', repo: `https://github.com/qa/${id}`, source: 'standard', channel: 'standard', commit: sha, releases: [], ...extra });
const recorder = app('wizard-recorder', 'Recorder', { icon: 'mic' });
const tinfoil = app('wizard-tinfoil', 'Wizard Tinfoil', { type: 'service', category: 'Connections', provides: ['live-transcription', 'ai-connection'], private: true });
const local = app('wizard-local', 'Local models', { type: 'service', category: 'Connections', provides: ['live-transcription', 'ai-connection'], private: true });
const catalog = { apps: [recorder, tinfoil, local], sources: [], next_offset: null };
const tile = a => ({ ...a, kind: 'wizard', url: '/' + a.id + '/', source: 'apps.json' });
// Captured owner-needs contract from the Recorder integration (no owner content/credentials).
const before = require('./fixtures/recorder-needs-before.json'), connected = require('./fixtures/recorder-needs-ready.json');
function needs(st) {
  const data = structuredClone(st.mode === 'ready' ? connected : before);
  if (st.mode === 'optional') { data.ready_to_open = true; [...data.models, ...data.services].forEach(n => n.required = false); }
  if (st.mode === 'blocked') data.services[0].status = 'blocked';
  data.providers = [{ ...local, status: 'connected', models: [{ id: 'deepseek-v4-1-flash', tier: 'fast' }] }, ...(st.providerInstalled ? data.providers : [])];
  return data;
}
let passes = 0;
const check = (condition, title) => { assert.ok(condition, title); passes++; console.log('PASS', title); };
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME ? { executablePath: process.env.QA_CHROME } : {}) });
  try {
    for (const shell of ['phone', 'desktop', 'store']) for (const skin of ['nebula', 'grove']) {
      const st = { mode: 'missing', providerInstalled: false, recorderInstalled: shell !== 'store', installs: [], errors: [], reads: 0 };
      const ctx = await browser.newContext({ viewport: { width: shell === 'desktop' ? 1280 : 390, height: 844 }, isMobile: shell !== 'desktop', hasTouch: shell !== 'desktop', serviceWorkers: 'block' });
      await ctx.addInitScript(({ skin, tile }) => {
        localStorage.setItem('wos.skin', skin); localStorage.setItem('wos.tour.done', '1'); localStorage.setItem('wos.coached', 'true');
        localStorage.setItem('wux.apps.v1', JSON.stringify([tile]));
      }, { skin, tile: tile(recorder) });
      const json = (r, body, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      await ctx.route('**/*', async r => {
        const u = new URL(r.request().url()), p = u.pathname, method = r.request().method();
        if (u.origin !== origin) return r.abort();
        if (p === prefix + 'store-data/wizard/v1/index/search') return json(r, catalog);
        if (p === prefix + 'store-data/api/apps/installed') return json(r, { installed: [] });
        if (p === prefix + 'store-data/wizard/v1/installed-apps') return json(r, { complete: true, architecture: 'amd64', wam: [local, ...(st.recorderInstalled ? [recorder] : []), ...(st.providerInstalled ? [tinfoil] : [])].map(a => ({ ...a, status: 'running' })), shell: [] });
        if (p === prefix + 'store-data/router/v1/needs/' + recorder.id) { st.reads++; return st.mode === 'old' ? json(r, {}, 501) : st.mode === '404' ? json(r, {}, 404) : st.mode === 'offline' ? r.abort() : json(r, needs(st)); }
        if (p.startsWith(prefix + 'store-data/router/v1/needs/')) return json(r, { models: [], services: [], providers: [], ready_to_open: true });
        if (p.startsWith(prefix + 'store-install/') && method === 'POST') {
          const id = p.split('/').at(-1), selection = JSON.parse(r.request().postData()); st.installs.push({ id, selection });
          if (id === recorder.id) st.recorderInstalled = true; if (id === tinfoil.id) st.providerInstalled = true;
          return json(r, { state: 'installed', selection });
        }
        if (p === '/wizard/v1/bootstrap') return json(r, { bootstrap: 1, settings: { owner: {}, agent: { name: 'Wizard' }, clock: {}, voice: {} }, endpoints: { apps: '/fixture/apps' }, capabilities: {} });
        if (p === '/fixture/apps') return json(r, { apps: [tile(recorder), tile(local), ...(st.providerInstalled ? [tile(tinfoil)] : [])] });
        if (p === '/wizard/v1/agents') return json(r, { agents: [] });
        if (p === '/wizard-tinfoil/' || p === '/wizard-local/') return r.fulfill({ contentType: 'text/html', body: `<h1>${p.includes('tinfoil') ? 'Tinfoil' : 'Local models'} connect page</h1><button>Connect privately</button>` });
        if (p === '/wizard-recorder/') return r.fulfill({ contentType: 'text/html', body: '<h1>Recorder opened</h1>' });
        const rel = p.startsWith(prefix) ? p.slice(prefix.length) || 'index.html' : '';
        const f = path.resolve(web, rel);
        if (rel && f.startsWith(web + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile()) return r.fulfill({ contentType: { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
        if (p.endsWith('/data.js') || p.endsWith('/summaries.js')) return r.fulfill({ contentType: 'text/javascript', body: '' });
        if (method !== 'GET' && method !== 'HEAD') return json(r, {}, 404);
        return json(r, {}, 404);
      });
      const p = await ctx.newPage(); p.on('pageerror', e => st.errors.push(e.message));
      const tag = `${shell}-${skin}`, screen = async name => { const dest = path.join(out, `${tag}-${name}.png`); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(250); await p.screenshot({ path: dest, fullPage: true, animations: 'disabled' }); console.log('SCREENSHOT', dest); };
      const entry = shell === 'store' ? 'store/index.html?app=wizard-recorder' : shell === 'desktop' ? 'desktop.html?open=wizard-recorder' : 'index.html?open=wizard-recorder';
      await p.goto(origin + prefix + entry);
      if (shell === 'store') {
        await p.locator('#detail [data-get]').first().click(); await p.locator('#sheet .was-checklist').waitFor();
        check(st.installs.length === 1, tag + ' existing Store install path creates shared checklist');
        check(await p.locator('#sheet .was-primary').textContent() === 'Set up with Tinfoil', tag + ' one recommended setup action');
        await screen('install-checklist');
        await p.locator('#sheet .was-link').click();
        check(await p.locator('[data-was-alternatives]').count() === 1, tag + ' alternative installed private provider listed');
        await p.locator('#sheet [data-back]').first().click();
        check(await p.locator('[data-was-alternatives]').count() === 0 && await p.locator('#sheet:not([hidden])').count() === 1, tag + ' nested Back keeps Store sheet open');
        await p.locator('#sheet [data-back]').first().click();
        await p.locator('#detail .was-checklist').waitFor();
        check(true, tag + ' Models and connections uses same checklist');
      } else {
        await p.locator('.was-overlay h2').waitFor({ timeout: 15000 });
        check(await p.locator('.was-overlay h2').textContent() === 'Set up Recorder', tag + ' deep link hits required-needs gate');
        check(await p.locator('iframe[src*="wizard-recorder"]').count() === 0, tag + ' app frame not created behind required gate');
        check(await p.locator('[data-was-continue]').count() === 0, tag + ' required gap cannot continue');
        check(await p.locator('.was-primary').textContent() === 'Set up with Tinfoil', tag + ' one recommended setup button');
        check(!/Tested on|deepseek|Required|Private data|Words appear|Your choice|Needs a provider/.test(await p.locator('.was-card').innerText()), tag + ' collapsed rows show no jargon, purpose or warnings');
        check(await p.locator('.was-card .mc-btn:visible').count() === 1, tag + ' only one visible primary button');
        await screen('required-checklist');
        const geometry = await p.evaluate(() => ({ width: document.querySelector('.was-overlay').scrollWidth, viewport: innerWidth, min: Math.min(...[...document.querySelectorAll('.was-card button,.was-card summary')].filter(b => b.getClientRects().length).map(b => b.getBoundingClientRect().height)) }));
        check(geometry.width <= geometry.viewport && geometry.min >= 44, tag + ' no horizontal overflow and 44px touch targets');
        await p.locator('[data-mc-slot="live-transcription"] summary').click();
        check(await p.getByText('Words appear as you speak', { exact: true }).isVisible(), tag + ' tapping a row reveals purpose and advanced actions');
        await screen('expanded-row');
        await p.evaluate(() => window.__wos ? __wos.onBack() : __wux.escStep());
        check(await p.locator('.was-checklist details[open]').count() === 0 && await p.locator('.was-overlay').count() === 1, tag + ' Back peels expanded row without leaving setup');
        await p.locator('.was-link').click();
        check(await p.locator('[data-was-alternatives] [data-mc-connect="wizard-local"]').count() === 1, tag + ' Use another lists installed private service');
        await screen('use-another');
        await p.evaluate(() => window.__wos ? __wos.onBack() : __wux.escStep());
        check(await p.locator('[data-was-alternatives]').count() === 0 && await p.locator('.was-overlay').count() === 1, tag + ' nested Back returns to checklist without leaving shell');
        await p.locator('.was-link').click();
        await p.locator('[data-was-store]').click();
        const store = p.frameLocator('.was-overlay iframe');
        await store.locator('#q').waitFor();
        await store.locator('html[data-wz-hosted]').waitFor();
        check(await store.locator('html').getAttribute('data-skin') === skin, tag + ' nested Store receives current Appearance skin');
        check(await store.locator('#q').inputValue() === 'live-transcription', tag + ' Use another opens Store filtered by service slot');
        await store.locator('[data-app^="wizard-local"]').first().click();
        await screen('hosted-store-alternative');
        const toolbar = await p.locator('.was-overlay .ls-bar').boundingBox();
        check(toolbar.y >= 0 && toolbar.y + toolbar.height <= 844, tag + ' nested provider toolbar stays on screen after checklist scroll');
        await store.locator('#detail [data-open]').click();
        await p.frameLocator('.was-overlay iframe').locator('h1').filter({ hasText: 'Local models connect page' }).waitFor();
        check(/Local models/.test(await p.frameLocator('.was-overlay iframe').locator('h1').textContent()), tag + ' exact nested Store frame can open installed alternative');
        await p.locator('.was-overlay [data-ls="close"]').last().click();
        await p.waitForFunction(() => !document.querySelector('[data-was-alternatives]'));
        await p.locator('.was-link').click();
        await p.locator('[data-was-alternatives] [data-mc-connect="wizard-local"]').click();
        await p.frameLocator('.was-overlay iframe').locator('h1').waitFor();
        check(/Local models/.test(await p.frameLocator('.was-overlay iframe').locator('h1').textContent()) && st.installs.length === 0, tag + ' alternative opens selected local provider, not recommended fix URL');
        await p.evaluate(() => window.__wos ? __wos.onBack() : __wux.escStep());
        await p.waitForFunction(() => !document.querySelector('[data-was-alternatives]'));
        await p.locator('.was-primary').click();
        await p.frameLocator('.was-overlay iframe').locator('h1').filter({ hasText: 'Tinfoil connect page' }).waitFor();
        check(st.installs.length === 1 && st.installs[0].id === tinfoil.id && st.installs[0].selection.commit === sha, tag + ' one qualified Store install then provider connect page');
        await p.evaluate(() => window.__wos ? __wos.onBack() : __wux.escStep());
        await p.locator('.was-primary').waitFor();
        await p.locator('.was-primary').click();
        await p.frameLocator('.was-overlay iframe').locator('h1').filter({ hasText: 'Tinfoil connect page' }).waitFor();
        check(st.installs.length === 1, tag + ' installed signed-out provider opens connect without reinstalling');
        const reads = st.reads; st.mode = 'ready';
        await p.evaluate(() => window.__wos ? __wos.onBack() : __wux.escStep());
        await p.locator('[data-was-continue]').waitFor();
        check(st.reads > reads && /Open Recorder/.test(await p.locator('[data-was-continue]').textContent()), tag + ' returning from connect page rechecks needs');
        await screen('ready');
        check(await p.locator('.was-card .mc-state.ready').count() === 3, tag + ' all three needs show green checks');
        await p.locator('[data-was-continue]').click();
        await p.locator('iframe[src*="wizard-recorder"]').first().waitFor();
        check(await p.locator('.was-overlay').count() === 0, tag + ' required-ready app opens only after explicit continuation');
        // Real launcher path, not only direct module invocation.
        st.mode = 'optional'; await p.evaluate(() => WizOpenApp('wizard-recorder'));
        await p.locator('[data-was-continue]').waitFor();
        check(await p.locator('[data-was-continue]').textContent() === 'Open Recorder' && await p.locator('.was-link').count() === 0, tag + ' optional-only gaps open without nagging');
        await screen('optional-checklist'); await p.locator('[data-was-continue]').click();
        st.mode = 'blocked'; await p.evaluate(() => WizOpenApp('wizard-recorder')); await p.locator('.was-overlay').waitFor();
        check(!/public provider cannot receive/.test(await p.locator('.was-overlay').innerText()) && await p.locator('[data-was-continue]').count() === 0, tag + ' blocked private-data state cannot bypass');
        let focusReads = st.reads; st.mode = 'optional';
        await p.evaluate(() => window.dispatchEvent(new Event('focus')));
        await p.locator('[data-was-continue]').waitFor();
        check(st.reads > focusReads, tag + ' window focus rechecks needs');
        focusReads = st.reads; st.mode = 'blocked';
        await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
        await p.waitForFunction(() => !document.querySelector('[data-was-continue]'));
        check(st.reads > focusReads, tag + ' visibility return rechecks needs');
        await p.evaluate(() => window.__wos ? __wos.onBack() : __wux.escStep());
        check(p.url().startsWith(origin + prefix) && await p.locator('.was-overlay').count() === 0, tag + ' root Back cancels setup and stays in shell');
        for (const mode of ['old', '404', 'offline']) {
          st.mode = mode; const before = st.reads; await p.evaluate(() => WizOpenApp('wizard-recorder'));
          await p.waitForFunction(() => !WosAppSetup.isOpen()); await p.waitForTimeout(100);
          check(st.reads > before && await p.locator('.was-overlay').count() === 0, tag + ' Router ' + mode + ' opens normally');
        }
      }
      check(st.errors.length === 0, tag + ' no page errors: ' + st.errors.join('; '));
      await ctx.close();
    }
  } finally { await browser.close(); }
  console.log(`${passes} browser checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
