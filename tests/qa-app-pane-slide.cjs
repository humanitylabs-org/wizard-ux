'use strict';
// Real desktop shell, synthetic reads only. No owner content or outgoing writes.
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const origin = 'https://pane.test', prefix = '/wizard-os-home/';
const out = process.env.QA_OUT || 'app-pane-slide-evidence';
fs.mkdirSync(out, { recursive: true });
(async () => {
 const browser = await chromium.launch();
 try {
  for (const view of ['ai-apps', 'classic']) for (const skin of ['nebula', 'sepia']) {
   const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, serviceWorkers: 'block' });
   await context.routeWebSocket('**/*', ws => ws.close());
   await context.addInitScript(({ view, skin }) => {
    if (window !== top) return;
    localStorage.setItem('wos.shell', 'desktop'); localStorage.setItem('wos.desktop-view.v1', view);
    for (const [k, v] of Object.entries({ 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin })) localStorage.setItem(k, v);
   }, { view, skin });
   const writes = [], errors = [], evidence = [];
   await context.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url());
    if (u.origin !== origin) return r.abort();
    if (!['GET', 'HEAD'].includes(q.method())) { writes.push(q.method() + ' ' + u.pathname); return r.fulfill({ status: 403, json: {} }); }
    if (u.pathname === prefix + 'store/index.html') return r.fulfill({ contentType: 'text/html', body: '<!doctype html><style>body{background:#171722;color:#eee;padding:40px}</style><h1>Synthetic app</h1><input value="unsent"><script>window.documentId=Math.random()<\/script>' });
    if (u.pathname.startsWith('/wizard/')) return r.fulfill({ json: ownerRead(u.pathname) });
    if (u.pathname.startsWith(prefix)) {
     const root = path.resolve(__dirname, '../web'), file = path.resolve(root, u.pathname.slice(prefix.length) || 'index.html');
     if (file.startsWith(root + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) return r.fulfill({ path: file });
    }
    return r.fulfill({ json: { apps: [], agents: [], sessions: [], connected: false } });
   });
   const p = await context.newPage(); p.on('pageerror', e => errors.push(e.message));
   try {
    await p.goto(origin + prefix + 'desktop.html');
    await p.waitForFunction(() => window.__wux && !WosWelcome.active && !WosExperience.state.busy);
    if (view === 'ai-apps') await p.waitForFunction(() => document.documentElement.dataset.aiApps === 'desktop' && document.querySelector('.ch-compose'));
    await p.evaluate(() => __wux.openApp(WizCore.apps('desktop').APP['app-store']));
    const field = p.frameLocator('iframe[src*="/store/index.html"]').locator('input'); await field.waitFor();
    const documentId = await field.evaluate(() => window.documentId);
    const settle = () => p.waitForFunction(() => !document.getAnimations().some(a => a.playState === 'running' && Number.isFinite(a.effect?.getComputedTiming().endTime)));
    await settle();
    // Shared oracle samples the visible title and body in the same animation frame.
    await p.evaluate(view => {
     window.samplePane = (action) => new Promise(resolve => {
      const desk = document.querySelector('#stage > .wsp[data-aad-role="app"]');
      const win = desk?.querySelector('.win:not(.gone)') || [...document.querySelectorAll('.win:not(.gone)')].find(w => w.querySelector('iframe[src*="/store/index.html"]'));
      const header = view === 'ai-apps' ? document.querySelector('.aad-ptop') : win.querySelector('.wbar');
      const body = win.querySelector('.wbody');
      const rows = [], started = performance.now();
      const sample = () => {
       const h = header.getBoundingClientRect(), b = body.getBoundingClientRect();
       rows.push({ t: performance.now() - started, hx: h.x, bx: b.x, hw: h.width, bw: b.width, ht: h.top, hb: h.bottom, bt: b.top, hidden: header.hidden });
       if (performance.now() - started < 380) requestAnimationFrame(sample); else resolve(rows);
      };
      sample(); action();
     });
    }, view);
    const tab = '.aad-vtab[data-app="app-store"]';
    const sample = async (kind, selector) => {
     const rows = await p.evaluate(selector => samplePane(() => document.querySelector(selector).click()), selector);
     fs.writeFileSync(path.join(out, view + '-' + skin + '-' + kind + '.json'), JSON.stringify(rows, null, 2));
     assert.ok(rows.length >= 5, 'enough animation frames');
     // Final frame may park the header after minimize; compare every rendered frame.
     const rendered = rows.filter(r => !r.hidden && r.hw > 0 && r.bw > 0);
     assert.ok(rendered.length >= 3, kind + ': rendered samples');
     const first = rendered[0], gap = first.hx - first.bx;
     for (const r of rendered) assert.ok(Math.abs((r.hx - r.bx) - gap) <= 0.6, kind + ' split pane: ' + JSON.stringify(r));
     if (view === 'ai-apps') {
      assert.ok(rendered.some(r => Math.abs(r.bx - first.bx) > 4), kind + ': real mid-animation movement');
      // Borderless skins retain their existing 4px window inset below the
      // layout header. Preserve that seam; neither child may drift on either axis.
      const seam = first.bt - first.hb;
      for (const r of rendered) assert.ok(Math.abs((r.bt - r.hb) - seam) <= 0.6, kind + ': header/body seam drift ' + JSON.stringify(r));
     }
     evidence.push({ kind, rows }); await settle();
    };
    if (view === 'ai-apps') {
     assert.equal(await p.locator('#stage > .wsp[data-aad-role="app"] > .aad-ptop').count(), 1);
     await sample('minimize-button', '.aad-px');
     await sample('open', tab);
     await sample('minimize-tab', tab);
     await sample('reopen', tab);
     // Live skin switch must retain the app document and header ownership.
     const other = skin === 'nebula' ? 'sepia' : 'nebula';
     await p.evaluate(s => WosSkin.set(s), other);
     await p.waitForFunction(s => WosSkin.current === s && !WosExperience.state.busy, other);
     await settle(); await sample('switched-skin-minimize', '.aad-px'); await sample('switched-skin-open', tab);
     await p.screenshot({ path: path.join(out, view + '-' + skin + '-switched.png') });
     await p.emulateMedia({ reducedMotion: 'reduce' });
     await p.locator('.aad-px').click();
     assert.equal(await p.locator('.aad-ptop').isVisible(), false, 'reduced-motion minimize immediate');
     await p.locator(tab).click(); await settle();
     assert.equal(await p.locator('#stage > .wsp[data-aad-role="app"] > .aad-ptop').count(), 1);
    } else {
     // Classic already has a single .win owner; source repair must not split it.
     const geometry = await p.evaluate(() => {
      const f = document.querySelector('iframe[src*="/store/index.html"]'), w = f.closest('.win');
      return { title: w.querySelector('.wbar').getBoundingClientRect().x, body: w.querySelector('.wbody').getBoundingClientRect().x };
     });
     assert.ok(Math.abs(geometry.title - geometry.body) <= 2); evidence.push({ kind: 'classic-single-window', geometry });
    }
    assert.equal(await field.evaluate(() => window.documentId), documentId, 'app iframe never remounted');
    assert.equal(await field.inputValue(), 'unsent');
    await p.screenshot({ path: path.join(out, view + '-' + skin + '.png') });
    assert.deepEqual(errors, []);
    assert.ok(writes.every(w => /thread-seen|ui-preferences|appearance/.test(w)), JSON.stringify(writes));
    fs.writeFileSync(path.join(out, view + '-' + skin + '.json'), JSON.stringify({ view, skin, writes, errors, evidence }, null, 2));
    console.log('PASS', view, skin, 'one title/body trajectory, iframe retained');
   } catch (e) { await p.screenshot({ path: path.join(out, view + '-' + skin + '-failure.png') }).catch(() => {}); console.error({ view, skin, errors }); throw e; }
   finally { await context.close(); }
  }
 } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
