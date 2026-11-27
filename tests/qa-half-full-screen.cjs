'use strict';
// wizard-ux issue 1813: AI apps desktop arrangement group = one pair (Full screen, Half screen), shown once and only
// with two windows; Half screen's centre divider drags, Half screen again re-centres. Real AI-apps shell, synthetic
// origin only; never touches owner Look or history. QA_PLAYWRIGHT=<playwright> node tests/qa-half-full-screen.cjs
// QA_EXPECT=broken runs the same steps against a build without it (QA_WEB=<that build's web dir>) and expects them to fail.
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const origin = 'https://half-full-screen.test', prefix = '/wizard-os-home/', root = path.resolve(process.env.QA_WEB || path.join(__dirname, '../web'));
const out = process.env.QA_OUT || 'half-full-screen-evidence'; fs.mkdirSync(out, { recursive: true });
const report = { cases: [] };
(async () => {
  const browser = await chromium.launch(); let p;
  try {
    for (const skin of (process.env.QA_SKINS || 'nebula,obsidian-light').split(',')) {
      const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
      const errors = [];
      await c.routeWebSocket('**/*', ws => ws.close());
      await c.addInitScript(skin => { if (window !== top) return; for (const [k, v] of Object.entries({ 'wos.shell': 'desktop', 'wos.desktop-view.v1': 'ai-apps', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin })) if (localStorage.getItem(k) === null) localStorage.setItem(k, v); }, skin);
      await c.route('**/*', async r => {
        const q = r.request(), u = new URL(q.url()); if (u.origin !== origin) return r.abort();
        if (u.pathname.includes('/v1/runs')) return r.abort();
        if (!['GET', 'HEAD'].includes(q.method())) return r.fulfill({ status: 403, json: { error: 'QA refuses writes' } });
        if (u.pathname === prefix + 'store/index.html') return r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset="utf-8"><style>body{background:#171722;color:#eee;padding:24px;font:16px system-ui}</style><h1>Synthetic app</h1>' });
        if (u.pathname === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
        if (u.pathname === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: [{ id: 'qa-thread', title: 'Half screen — synthetic chat', status: 'completed', updatedAt: '2026-11-05T00:00:00Z' }], has_more: false } });
        if (u.pathname.startsWith('/wizard/')) return r.fulfill({ json: ownerRead(u.pathname) });
        if (u.pathname.startsWith(prefix)) { const f = path.resolve(root, u.pathname.slice(prefix.length) || 'index.html'); if (f.startsWith(root + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile()) return r.fulfill({ path: f }); }
        return r.fulfill({ json: { apps: [], agents: [], sessions: [], connected: false } });
      });
      p = await c.newPage(); p.on('pageerror', e => errors.push(e.message));
      const settle = async () => { await p.waitForTimeout(150); await p.waitForFunction(() => !document.getAnimations().some(a => a.playState === 'running' && Number.isFinite(a.effect?.getComputedTiming().endTime))); await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); };
      const boot = async () => { await p.waitForFunction(() => window.__wux && document.documentElement.dataset.aiApps === 'desktop' && !WosWelcome.active && !WosExperience.state.busy && document.querySelector('.ch-compose')); await settle(); };
      const model = () => p.evaluate(() => WizCore.panes.get());
      const box = role => p.locator('#stage > .wsp[data-aad-role="' + role + '"]').boundingBox();
      // every arrangement button on screen, wherever it sits
      const shown = () => p.evaluate(() => [...document.querySelectorAll('.aad-modes [data-mode], .aad-ctop [data-mode], .aad-ptop [data-mode], .aad-stop [data-mode]')].filter(b => b.getClientRects().length && b.getBoundingClientRect().width > 0 && getComputedStyle(b).visibility !== 'hidden').map(b => b.dataset.mode));
      const shot = async name => { const file = path.join(out, skin + '-' + name + '.png'); await p.screenshot({ path: file }); report.cases.push({ skin, name, file, model: await model(), shown: await shown() }); };
      const halfBtn = () => p.locator('.aad-modes [data-mode="half"]:visible');
      const fullBtn = () => p.locator('.aad-modes [data-mode="full"]:visible');
      await p.goto(origin + prefix + 'desktop.html'); await boot();
      await p.evaluate(() => __wux.openThread('qa-thread')); await p.waitForFunction(() => document.documentElement.hasAttribute('data-aad-chat')); await settle();
      // 1 window: no arrangement buttons anywhere
      assert.deepEqual(await shown(), [], 'one window: no arrangement buttons'); await shot('one-window');
      await p.evaluate(() => __wux.openApp(WizCore.apps('desktop').APP['app-store'])); await p.waitForFunction(() => document.documentElement.hasAttribute('data-aad-split')); await settle();
      // 2 windows: exactly one group of two buttons
      assert.deepEqual((await shown()).sort(), ['full', 'half'], 'two windows: exactly Full screen and Half screen, once');
      assert.equal(await p.locator('.aad-modes:visible').count(), 1, 'one group');
      assert.equal(await p.locator('.aad-modes').count(), 1, 'no second copy anywhere (hidden or not)');
      assert.deepEqual(await p.locator('.aad-modes:visible [data-mode]').evaluateAll(n => n.map(b => b.getAttribute('aria-label'))), ['Full screen', 'Half screen']);
      await shot('two-windows');
      // Half screen: centre divider drags live (the chat keeps its 30% minimum, the app panel its 360 px)
      await halfBtn().click(); await settle();
      let chat = await box('chat'), app = await box('app');
      assert.ok(Math.abs(chat.width - app.width) <= 2, `half: equal widths ${chat.width} vs ${app.width}`);
      const grip = p.locator('.aad-grip[data-grip="app"]'); const g = await grip.boundingBox(); assert.ok(g && g.width > 0, 'divider shows');
      assert.ok(Math.abs(g.x + g.width / 2 - (chat.x + chat.width)) <= 8, 'divider sits between the panes');
      await shot('half-centred');
      await p.mouse.move(g.x + g.width / 2, g.y + 200); await p.mouse.down(); await p.mouse.move(g.x + g.width / 2 + 40, g.y + 200, { steps: 4 }); await p.mouse.move(g.x + g.width / 2 + 80, g.y + 200, { steps: 4 }); await p.mouse.up(); await settle();
      chat = await box('chat'); app = await box('app');
      assert.ok(chat.width - app.width > 120, `dragged right: chat wider ${chat.width} / ${app.width}`);
      const dragged = { chat: chat.width, app: app.width }; await shot('half-dragged');
      // reload keeps the split
      await p.reload(); await boot(); await p.evaluate(() => __wux.openThread('qa-thread')); await p.evaluate(() => __wux.openApp(WizCore.apps('desktop').APP['app-store'])); await p.waitForFunction(() => document.documentElement.hasAttribute('data-aad-split') && document.documentElement.hasAttribute('data-aad-chat')); await settle();
      chat = await box('chat'); app = await box('app');
      assert.ok(Math.abs(chat.width - dragged.chat) <= 2 && Math.abs(app.width - dragged.app) <= 2, `reload keeps the split ${chat.width}/${app.width} vs ${dragged.chat}/${dragged.app}`);
      // Full screen, then Half screen: back to the remembered split
      await fullBtn().click(); await settle(); assert.equal((await model()).mode, 'full');
      assert.deepEqual((await shown()).sort(), ['full', 'half'], 'full screen: the group stays');
      await shot('full');
      await halfBtn().click(); await settle(); assert.equal((await model()).mode, 'tiled');
      chat = await box('chat'); app = await box('app');
      assert.ok(Math.abs(chat.width - dragged.chat) <= 2, 'full then half: back to the remembered split');
      // Half screen again: re-centres
      await halfBtn().click(); await settle();
      chat = await box('chat'); app = await box('app');
      assert.ok(Math.abs(chat.width - app.width) <= 2, `half again: re-centred ${chat.width} vs ${app.width}`);
      // close one window: the group disappears
      await p.evaluate(() => document.querySelector('.aad-ptop .aad-px, .aad-ptop [aria-label^="Hide"]')?.click()); await settle();
      await p.waitForFunction(() => !document.documentElement.hasAttribute('data-aad-split'));
      assert.deepEqual(await shown(), [], 'one window again: group gone'); await shot('closed-one');
      assert.deepEqual(errors, [], 'no page errors');
      await c.close();
    }
    report.ok = true;
  } catch (e) {
    report.ok = false; report.error = String(e.stack || e);
    if (p) await p.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
    if (process.env.QA_EXPECT !== 'broken') { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); console.error(e); process.exitCode = 1; }
  } finally {
    await browser.close();
    if (process.env.QA_EXPECT === 'broken') { if (report.ok) { console.error('expected the old build to fail'); process.exitCode = 1; } else console.log('old build fails as expected:', report.error.split('\n')[0]); }
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    if (report.ok) console.log('ok', out);
  }
})();
