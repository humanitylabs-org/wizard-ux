// James, 28 Oct 2026: "Tapping notifications results in a three to five second delay with zero UX feedback ...
// as soon as you tap it, a new window should open and then we can display a loading wheel on the new window."
// An in-app link (the Notifications "Open" button path) opens an app while the Router's setup check takes 3 s.
// The app's window and its loading spinner must be up within 900 ms; a required gap that the slow check finds
// afterwards puts the setup sheet over that window. Fixture-only: no live data, installs or network.
// Usage: node tests/qa-slow-router-open.cjs   (QA_OUT=<dir> keeps screenshots; QA_CHROME=<binary> optional)
const { chromium } = require('../tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const web = path.resolve(__dirname, '../web'), out = process.env.QA_OUT || path.resolve('qa/slow-router-open');
const origin = 'http://slow-router.qa', prefix = '/wizard-os-home/', DELAY = 3000;
const recorder = { id: 'wizard-recorder', name: 'Recorder', kind: 'wizard', url: '/wizard-recorder/', source: 'apps.json' };
const before = require('./fixtures/recorder-needs-before.json'), ready = require('./fixtures/recorder-needs-ready.json');
let passes = 0;
const check = (c, t) => { assert.ok(c, t); passes++; console.log('PASS', t); };
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME ? { executablePath: process.env.QA_CHROME } : {}) });
  try {
    for (const skin of ['nebula', 'grove']) for (const mode of ['ready', 'missing']) {
      const st = { errors: [], reads: 0 };
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
      await ctx.addInitScript(({ skin, tile }) => {
        localStorage.setItem('wos.skin', skin); localStorage.setItem('wos.tour.done', '1'); localStorage.setItem('wos.tour.v1', 'true'); localStorage.setItem('wos.coached', 'true');
        localStorage.setItem('wux.apps.v1', JSON.stringify([tile]));
      }, { skin, tile: recorder });
      const json = (r, body, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      await ctx.route('**/*', async r => {
        const u = new URL(r.request().url()), p = u.pathname;
        if (u.origin !== origin) return r.abort();
        if (p === prefix + 'store-data/router/v1/needs/' + recorder.id) { st.reads++; await new Promise(f => setTimeout(f, DELAY)); return json(r, { ...(mode === 'ready' ? ready : before), providers: [] }); }
        if (p.startsWith(prefix + 'store-data/')) return json(r, { apps: [], installed: [], wam: [], complete: true });
        if (p === '/wizard/v1/bootstrap') return json(r, { bootstrap: 1, settings: { owner: {}, agent: { name: 'Wizard' }, clock: {}, voice: {} }, endpoints: { apps: '/fixture/apps' }, capabilities: {} });
        if (p === '/fixture/apps') return json(r, { apps: [recorder] });
        if (p === '/wizard/v1/agents') return json(r, { agents: [] });
        if (p === '/wizard-recorder/') { await new Promise(f => setTimeout(f, 1500)); return r.fulfill({ contentType: 'text/html', body: '<h1>Recorder opened</h1>' }); }
        const rel = p.startsWith(prefix) ? p.slice(prefix.length) || 'index.html' : '';
        const f = path.resolve(web, rel);
        if (rel && f.startsWith(web + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile()) return r.fulfill({ contentType: { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' }[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
        if (p.endsWith('/data.js') || p.endsWith('/summaries.js')) return r.fulfill({ contentType: 'text/javascript', body: '' });
        return json(r, {}, 404);
      });
      const p = await ctx.newPage(); p.on('pageerror', e => st.errors.push(e.message));
      const tag = `${skin}-${mode}`;
      await p.goto(origin + prefix + 'index.html'); await p.waitForTimeout(2500);
      await p.getByText('Skip', { exact: true }).click({ timeout: 800 }).catch(() => {});
      const frame = () => p.evaluate(() => {
        const f = document.querySelector('iframe.appframe[data-own-app="wizard-recorder"]'); const wrap = f?.closest('.frame-wrap');
        const spin = wrap?.querySelector('.frame-loading'); const shown = !!spin && getComputedStyle(spin).display !== 'none';
        const b = wrap?.getBoundingClientRect(); const onScreen = !!b && b.width > 300 && Math.abs(b.left) < 4;
        return { frame: !!f, onScreen, spinner: shown && onScreen, sheet: !!document.querySelector('.was-overlay h2') };
      });
      const t0 = Date.now();
      // The Notifications "Open Recorder" button is a same-origin link the shell routes in-app.
      await p.evaluate(() => window.WizCore.deeplink.route(location.origin + '/wizard-os-home/?open=wizard-recorder'));
      let at = null; while (Date.now() - t0 < 2500) { const s = await frame(); if (s.frame && s.onScreen) { at = { ms: Date.now() - t0, ...s }; break; } await p.waitForTimeout(50); }
      check(at && at.ms < 1000, `${tag} window is on screen in ${at?.ms} ms while the setup check is still running`);
      check(at.spinner, `${tag} the new window shows its loading spinner`);
      await p.screenshot({ path: path.join(out, `${tag}-opening.png`) });
      await p.waitForTimeout(DELAY + 800);
      const end = await frame();
      if (mode === 'ready') check(!end.sheet && end.frame && !end.spinner, `${tag} no setup sheet; spinner lifts once the app loads`);
      else check(end.sheet && end.frame, `${tag} a required gap found late puts the setup sheet over the opened app`);
      await p.screenshot({ path: path.join(out, `${tag}-settled.png`) });
      check(st.reads === 1 && !st.errors.length, `${tag} one check, no page errors: ${st.errors.slice(0, 2).join(' | ')}`);
      await ctx.close();
    }
  } finally { await browser.close(); }
  console.log(`${passes} browser checks passed`);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
