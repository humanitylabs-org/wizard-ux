// Scratch: in-shell screenshots for wizard-ux#1338, before (QA_WEB=main web) vs after, defaults and a saved Orb/Apps.
const { chromium } = require(process.env.QA_PLAYWRIGHT);
const fs = require('node:fs'), path = require('node:path');
const WEB = process.env.QA_WEB, OUT = process.env.QA_OUT; fs.mkdirSync(OUT, { recursive: true });
const saved = { 'wos.layout': 'orb', 'wos.desktop-view.v1': 'orb',
  'wos.skin-tweaks.v1': JSON.stringify({ version: 1, off: {}, preset: 'none', machinesHomeMoved: true, defaultsMigrated: true,
    mix: { 'miguel/orb-shell': true, 'miguel/apps-home': true }, views: { desktop: 'miguel/orb-shell', phone: 'miguel/apps-home' } }) };
(async () => {
  const b = await chromium.launch(); const report = [];
  for (const skin of ['nebula', 'grove']) for (const shell of ['phone', 'desktop']) for (const state of ['default', 'saved-orb-apps']) {
    const ctx = await b.newContext({ viewport: shell === 'phone' ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: shell === 'phone', hasTouch: shell === 'phone', serviceWorkers: 'block', reducedMotion: 'reduce' });
    const seed = { 'wos.shell': shell, 'wos.skin': skin, 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', ...(state === 'default' ? {} : saved) };
    await ctx.addInitScript(s => { if (window !== top) return; for (const [k, v] of Object.entries(s)) if (localStorage.getItem(k) === null) localStorage.setItem(k, v); }, seed);
    const errors = [], layoutReqs = [];
    await ctx.routeWebSocket('**/*', ws => ws.close());
    await ctx.route('**/*', async r => {
      const req = r.request(), u = new URL(req.url());
      if (!['GET', 'HEAD'].includes(req.method())) return r.abort();
      if (u.pathname.startsWith('/wizard-os-home/')) {
        const rel = u.pathname.slice('/wizard-os-home/'.length) || 'index.html';
        if (rel.startsWith('layouts/')) layoutReqs.push(rel);
        const file = path.join(WEB, rel);
        if (fs.existsSync(file) && fs.statSync(file).isFile()) return r.fulfill({ contentType: file.endsWith('.js') || file.endsWith('.mjs') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : file.endsWith('.json') ? 'application/json' : file.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream', body: fs.readFileSync(file) });
        return r.fulfill({ status: 404, body: '' });
      }
      if (u.pathname.endsWith('/v1/setup')) return r.fulfill({ json: { first_run: false } });
      if (u.pathname === '/wizard/v1/ui-preferences') return r.fulfill({ json: { launcher: {}, migrations: { 'launcher-seed-v1': true } } });
      if (u.pathname.endsWith('/v1/apps')) return r.fulfill({ json: { apps: [] } });
      return r.fulfill({ json: { sessions: [], agents: [], apps: [], connected: false } });
    });
    const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message));
    await p.goto('https://shell.test/wizard-os-home/' + (shell === 'desktop' ? 'desktop.html' : ''));
    await p.waitForTimeout(5000);
    await p.evaluate(() => { try { window.WosWelcome?.close?.(); } catch (_) {} document.getElementById('wosWelcome')?.remove(); document.querySelectorAll('.welcome,.wos-welcome,[data-welcome]').forEach(n => n.remove()); });
    await p.waitForTimeout(1500);
    const info = await p.evaluate(() => ({ layout: document.documentElement.dataset.layout || 'classic', desktopView: window.WosExperience?.desktopView ?? null, expErr: window.WosExperience?.state?.error || '', tweaks: (window.WosExperience?.state?.tweaks || []).filter(t => t.view).map(t => t.id + (t.on ? ':on' : '')) }));
    const shot = path.join(OUT, `${skin}-${shell}-${state}.png`); await p.screenshot({ path: shot });
    report.push({ skin, shell, state, ...info, layoutReqs: [...new Set(layoutReqs)], errors });
    await ctx.close();
  }
  await b.close();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  for (const r of report) console.log(r.skin, r.shell, r.state, 'layout=' + r.layout, 'view=' + r.desktopView, 'err=' + (r.expErr || '-'), 'views=' + r.tweaks.join(','), 'layoutReqs=' + r.layoutReqs.join(','), r.errors.length ? 'PAGEERR ' + r.errors.join(' | ').slice(0, 200) : '');
})().catch(e => { console.error(e); process.exit(2); });
