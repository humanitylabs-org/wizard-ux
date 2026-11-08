'use strict';
// Window modes keep the skin colour (James, 6 Nov 2026). Real AI-apps shell on a synthetic origin only:
// never touches the owner's Look, history or runs. Per skin: tiled, centred and full-screen chat, with the
// pane's computed background and a decoded pixel from the pane's blank margin in each mode.
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const origin = 'https://window-modes.test', prefix = '/wizard-os-home/', root = path.resolve(__dirname, '../web');
const out = process.env.QA_OUT || 'window-modes-skin-evidence'; fs.mkdirSync(out, { recursive: true });
const report = { cases: [] }; const fails = [];
(async () => {
  const browser = await chromium.launch();
  try {
    for (const skin of ['nebula', 'sepia']) {
      const c = await browser.newContext({ viewport: { width: 1440, height: 960 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
      const writes = [], runs = [], errors = [];
      await c.routeWebSocket('**/*', ws => ws.close());
      await c.addInitScript(skin => { if (window !== top) return; for (const [k, v] of Object.entries({ 'wos.shell': 'desktop', 'wos.desktop-view.v1': 'ai-apps', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin })) if (localStorage.getItem(k) === null) localStorage.setItem(k, v); }, skin);
      await c.route('**/*', async r => {
        const q = r.request(), u = new URL(q.url()); if (u.origin !== origin) return r.abort();
        if (u.pathname.includes('/v1/runs')) { runs.push(u.pathname); return r.abort(); }
        if (!['GET', 'HEAD'].includes(q.method())) { writes.push(q.method() + ' ' + u.pathname); return r.fulfill({ status: 403, json: { error: 'QA refuses writes' } }); }
        if (u.pathname === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
        if (u.pathname === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: [{ id: 'qa-thread', title: 'Window modes — synthetic chat', status: 'completed', updatedAt: '2026-11-05T00:00:00Z' }], has_more: false } });
        if (u.pathname.startsWith('/wizard/')) return r.fulfill({ json: ownerRead(u.pathname) });
        if (u.pathname.startsWith(prefix)) { const f = path.resolve(root, u.pathname.slice(prefix.length) || 'index.html'); if (f.startsWith(root + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile()) return r.fulfill({ path: f }); }
        return r.fulfill({ json: { apps: [], agents: [], sessions: [], connected: false } });
      });
      const p = await c.newPage(); p.on('pageerror', e => errors.push(e.message));
      const settle = async () => { await p.waitForFunction(() => !document.getAnimations().some(a => a.playState === 'running' && Number.isFinite(a.effect?.getComputedTiming().endTime))); await p.evaluate(() => document.fonts.ready); await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); };
      await p.goto(origin + prefix + 'desktop.html');
      await p.waitForFunction(() => window.__wux && document.documentElement.dataset.aiApps === 'desktop' && !WosWelcome.active && !WosExperience.state.busy && document.querySelector('.ch-compose'));
      await settle(); await p.evaluate(() => __wux.openThread('qa-thread')); await p.waitForFunction(() => document.documentElement.hasAttribute('data-aad-chat')); await settle();
      const probe = async mode => {
        const info = await p.evaluate(() => {
          const desk = document.querySelector('#stage > .wsp[data-aad-role="chat"]'), win = desk.querySelector('.win:not(.gone)'), top = desk.querySelector('.aad-ctop');
          const b = win.getBoundingClientRect(), cs = e => e && getComputedStyle(e).backgroundImage + ' | ' + getComputedStyle(e).backgroundColor;
          const probe = document.createElement('div'); probe.style.cssText = 'position:fixed;left:-9px;width:1px;height:1px;background:var(--wz-panel)'; document.body.append(probe); const panel = getComputedStyle(probe).backgroundColor; probe.remove();
          return { skin: document.documentElement.dataset.skin, mode: WizCore.panes.get().mode, box: { x: b.x, y: b.y, w: b.width, h: b.height }, desk: cs(desk), win: cs(win), top: cs(top), wzPanel: panel };
        });
        const pt = { x: Math.round(info.box.x + 10), y: Math.round(info.box.y + info.box.h / 2) };
        const buf = await p.screenshot({ clip: { x: pt.x, y: pt.y, width: 1, height: 1 } });
        info.pixel = await p.evaluate(async b => { const i = new Image(); i.src = 'data:image/png;base64,' + b; await i.decode(); const cv = document.createElement('canvas'); cv.width = cv.height = 1; const x = cv.getContext('2d'); x.drawImage(i, 0, 0); return [...x.getImageData(0, 0, 1, 1).data]; }, buf.toString('base64'));
        info.pixelAt = pt; info.file = path.join(out, skin + '-' + mode + '.png'); await p.screenshot({ path: info.file });
        report.cases.push(info); return info;
      };
      const tiled = await probe('tiled');
      for (const mode of ['centre', 'full']) {
        await p.locator('.aad-ctop [data-mode="' + mode + '"]').click(); await settle();
        const m = await probe(mode);
        if (m.mode !== mode) fails.push(skin + ' mode ' + m.mode + ' != ' + mode);
        if (m.pixel.slice(0, 3).some((v, i) => Math.abs(v - tiled.pixel[i]) > 2)) fails.push(skin + ' ' + mode + ' pixel ' + m.pixel + ' != tiled ' + tiled.pixel);
      }
      report.cases.push({ skin, writes, runs, errors }); if (runs.length) fails.push(skin + ' runs ' + runs);
      await c.close();
    }
  } finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ ...report, fails }, null, 2)); await browser.close(); }
  if (fails.length) { console.error('FAIL', fails); process.exit(1); }
  console.log('PASS window modes keep the tiled pane colour on nebula and sepia; synthetic origin only');
})().catch(e => { console.error(e); process.exit(1); });
