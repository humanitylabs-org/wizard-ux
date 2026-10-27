// Synthetic-only phone acceptance: never contacts an owner service or reads private chats.
// QA_BASELINE_SOURCE=baseline/web QA_SOURCE=candidate/web QA_OUT=dir node tools/qa-orb-icon-core.cjs
const { chromium } = require('./qa-playwright.cjs');
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const OUT = process.env.QA_OUT || 'qa-orb-icon-core';
const skins = ['nebula', 'grove', 'tide', 'ember', 'signal'];
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const results = [];
  try {
    for (const skin of skins) for (const variant of ['before', 'after']) {
      const source = path.resolve(variant === 'before' ? process.env.QA_BASELINE_SOURCE : process.env.QA_SOURCE || 'web');
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
      await context.route('**/*', route => {
        const request = route.request(), url = new URL(request.url());
        if (!['GET', 'HEAD'].includes(request.method())) return route.abort();
        if (url.hostname !== 'orb.test') return route.abort();
        if (url.pathname.startsWith('/wizard-os-home/')) {
          const rel = decodeURIComponent(url.pathname.slice('/wizard-os-home/'.length)) || 'index.html';
          const file = path.resolve(source, rel);
          if (file.startsWith(source + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) return route.fulfill({ body: fs.readFileSync(file), contentType: types[path.extname(file)] || 'application/octet-stream' });
          return route.fulfill({ status: 404, body: '' });
        }
        let data = {};
        if (url.pathname.includes('/sessions')) data = { data: [], sessions: [], total: 0, has_more: false };
        else if (url.pathname.endsWith('/apps')) data = { apps: [] };
        else if (url.pathname.endsWith('/agents')) data = { agents: [{ id: 'hermes', name: 'Archimedes', kind: 'main' }] };
        else if (/thread-seen|thread-dispositions/.test(url.pathname)) data = { state: {} };
        return route.fulfill({ json: data });
      });
      await context.addInitScript(skin => {
        localStorage.setItem('wos.skin', skin);
        localStorage.setItem('wos.skin.composition.v1', JSON.stringify({ version: 1, extends: skin }));
        localStorage.setItem('wos.tour.done', '1');
        localStorage.setItem('wos.stripSeeded', 'true');
        localStorage.setItem('wos.wins4', JSON.stringify({ qa: { id: 'qa', app: 'chats', thread: null } }));
        localStorage.setItem('wos.strip', JSON.stringify([{ id: 'home', home: true, wins: [], focus: null }, { id: 'qa-chats', wins: ['qa'], focus: 'qa' }]));
        localStorage.setItem('wos.idxDesk', JSON.stringify('qa-chats'));
        // Freeze shader time only, not the interpolation clock: before/after have the same galaxy.
        const names = new WeakMap(), proto = WebGLRenderingContext.prototype;
        const location = proto.getUniformLocation, uniform = proto.uniform1f;
        proto.getUniformLocation = function (program, name) { const loc = location.call(this, program, name); if (loc) names.set(loc, name); return loc; };
        proto.uniform1f = function (loc, value) { const name = loc && names.get(loc); if (name === 'core') window.__qaCore = value; return uniform.call(this, loc, name === 't' ? 8 : value); };
      }, skin);
      const page = await context.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto('http://orb.test/wizard-os-home/?shell=phone', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#orbApp .sgi');
      await page.waitForFunction(() => window.Orb?.webgl && window.__qaCore !== undefined);
      await page.waitForTimeout(1900);
      const idle = await page.evaluate(() => {
        const style = getComputedStyle(document.getElementById('orbApp'));
        return { skin: document.documentElement.dataset.skin, opacity: +style.opacity, display: style.display, core: window.__qaCore, desk: window.__wos?.desks[window.__wos.idx] };
      });
      assert.equal(idle.skin, skin); assert.notEqual(idle.display, 'none'); assert.ok(idle.opacity > .5);
      assert.ok(variant === 'before' ? idle.core > .54 : idle.core < .001, JSON.stringify({ skin, variant, idle }));
      const dock = await page.locator('.dock').boundingBox();
      const clip = { x: 0, y: Math.max(0, Math.floor(dock.y - 20)), width: 390, height: Math.min(844 - Math.max(0, Math.floor(dock.y - 20)), Math.ceil(dock.height + 40)) };
      await page.screenshot({ path: `${OUT}/${skin}-${variant}.png`, clip });
      if (skin === 'nebula' && variant === 'after') await page.screenshot({ path: `${OUT}/orb-no-dot-nebula.png` });
      const states = [];
      if (variant === 'after') {
        for (const state of ['listen', 'paused', 'launcher', 'idle']) {
          await page.evaluate(state => {
            const device = document.getElementById('device');
            delete device.dataset.sheet; delete device.dataset.voice;
            if (state === 'launcher') device.dataset.sheet = 'launcher';
            else if (state !== 'idle') device.dataset.voice = state;
            Orb.setMode(state === 'listen' || state === 'paused' ? state : 'idle');
          }, state);
          await page.waitForTimeout(1800);
          const value = await page.evaluate(() => ({ opacity: +getComputedStyle(document.getElementById('orbApp')).opacity, core: window.__qaCore }));
          assert.ok(state === 'idle' ? value.opacity > .5 && value.core < .001 : value.opacity < .01 && value.core > (state === 'listen' ? .99 : state === 'paused' ? .299 : .549), JSON.stringify({ skin, state, value }));
          states.push({ state, ...value });
        }
      }
      assert.deepEqual(errors, []);
      results.push({ skin, variant, idle, states, errors });
      console.log('PASS', skin, variant, JSON.stringify({ idle, states }));
      fs.writeFileSync(`${OUT}/result.json`, JSON.stringify(results, null, 2));
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
