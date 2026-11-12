'use strict';
// James, 6 Nov 2026: finish the desktop shell rebuild and trim what each shell loads.
// Real shells on a synthetic origin only (synthetic notifications, every write refused, /v1/runs aborted, no sockets).
// Per shell (AI apps desktop, Classic desktop, phone) on two skins: the first-party JS/CSS requests and bytes
// the page actually fetched, and an in-shell screenshot. QA_TAG=after also asserts the trim and the AI apps placement
// (an app beside the chat, Resolve this on a notification stays in the chat column).
//   QA_WEB=<web dir> QA_OUT=<dir> QA_TAG=before|after node tests/qa-shell-finish.cjs
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const origin = 'https://shell-finish.test', prefix = '/wizard-os-home/', root = path.resolve(process.env.QA_WEB || path.join(__dirname, '../web'));
const tag = process.env.QA_TAG || 'after', out = path.join(process.env.QA_OUT || 'shell-finish-evidence', tag); fs.mkdirSync(out, { recursive: true });
const now = Math.floor(Date.now() / 1000);
const NOTES = ['a', 'b'].map((k, n) => ({ id: 'qa-note-' + k, title: 'Synthetic alert ' + k.toUpperCase(), message: 'A synthetic notification for the shell check.', time: now - n * 60, source: 'preview', priority: 3, read: false, archived: false }));
const SHELLS = [
  { name: 'desktop-ai-apps', page: 'desktop.html', viewport: { width: 1440, height: 960 }, seed: { 'wos.shell': 'desktop', 'wos.desktop-view.v1': 'ai-apps' } },
  { name: 'desktop-classic', page: 'desktop.html', viewport: { width: 1440, height: 960 }, seed: { 'wos.shell': 'desktop', 'wos.desktop-view.v1': 'classic' } },
  { name: 'phone', page: 'index.html', viewport: { width: 390, height: 844 }, mobile: true, seed: { 'wos.shell': 'phone' } },
];
const report = { tag, root, shells: [] };
(async () => {
  const browser = await chromium.launch(); let p;
  try {
    for (const skin of ['nebula', 'sepia']) for (const S of SHELLS) {
      const c = await browser.newContext({ viewport: S.viewport, isMobile: !!S.mobile, hasTouch: !!S.mobile, deviceScaleFactor: S.mobile ? 2 : 1, serviceWorkers: 'block', reducedMotion: 'reduce' });
      const writes = [], runs = [], errors = [], files = [];
      await c.routeWebSocket('**/*', ws => ws.close());
      const seed = { 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin, ...S.seed };
      await c.addInitScript(seed => { if (window !== top) return; for (const [k, v] of Object.entries(seed)) if (localStorage.getItem(k) === null) localStorage.setItem(k, v); }, seed);
      await c.route('**/*', async r => {
        const q = r.request(), u = new URL(q.url()); if (u.origin !== origin) return r.abort();
        if (u.pathname.includes('/v1/runs')) { runs.push(u.pathname); return r.abort(); }
        if (!['GET', 'HEAD'].includes(q.method())) { writes.push(q.method() + ' ' + u.pathname); return r.fulfill({ status: 403, json: { error: 'QA refuses writes' } }); }
        if (u.pathname === prefix + 'store/index.html') return r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset="utf-8"><body style="background:#2a2a38;color:#eee;font:16px system-ui;padding:24px"><h1>Synthetic app</h1>' });
        if (u.pathname === '/notifications/api/items') return r.fulfill({ json: { items: NOTES } });
        if (u.pathname === '/notifications/api/count') return r.fulfill({ json: { unread: NOTES.length, needs: 0 } });
        if (u.pathname.startsWith('/notifications/')) return r.fulfill({ json: {} });
        if (u.pathname === '/wizard/v1/apps') return r.fulfill({ json: { apps: [{ id: 'notifications', name: 'Notifications', type: 'agent', source: 'apps.json' }] } });
        if (u.pathname === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
        if (u.pathname === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: [], has_more: false } });
        if (u.pathname.startsWith('/wizard/')) return r.fulfill({ json: ownerRead(u.pathname) });
        if (u.pathname.startsWith(prefix)) {
          const rel = u.pathname.slice(prefix.length) || 'index.html', f = path.resolve(root, rel);
          if (f.startsWith(root + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile()) {
            if (/\.(m?js|css)$/.test(rel) && q.frame() === p?.mainFrame()) files.push({ rel, type: q.resourceType(), bytes: fs.statSync(f).size });
            return r.fulfill({ path: f });
          }
        }
        return r.fulfill({ json: { apps: [], agents: [], sessions: [], connected: false } });
      });
      p = await c.newPage(); p.on('pageerror', e => errors.push(e.message));
      const settle = async () => { await p.waitForTimeout(300); await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); };
      await p.goto(origin + prefix + S.page);
      const desk = S.page === 'desktop.html';
      await p.waitForFunction(d => (d ? window.__wux : window.WosSkinHost) && document.readyState === 'complete' && !window.WosWelcome?.active, desk, { timeout: 30000 });
      if (desk) await p.waitForFunction(() => document.querySelector('.ch-compose'), null, { timeout: 30000 });
      if (S.name === 'desktop-ai-apps') await p.waitForFunction(() => document.documentElement.dataset.aiApps === 'desktop' && !document.documentElement.hasAttribute('data-layout-booting'));
      await p.waitForLoadState('networkidle').catch(() => {}); await settle(); await p.waitForTimeout(800);
      const boot = { requests: files.length, bytes: files.reduce((t, f) => t + f.bytes, 0), layout: files.filter(f => f.rel.startsWith('layouts/')).map(f => f.rel) };
      const shot = path.join(out, `${skin}-${S.name}.png`); await p.screenshot({ path: shot });
      const row = { skin, shell: S.name, ...boot, js: files.filter(f => /js$/.test(f.rel)).length, css: files.filter(f => /css$/.test(f.rel)).length, dupes: files.map(f => f.rel).filter((f, i, a) => a.indexOf(f) !== i), shot, files: files.map(f => f.rel) };
      if (S.name === 'desktop-ai-apps') {
        // placement: an app opens as the panel beside the chat (host placements), Resolve this keeps the chat pane put
        await p.evaluate(() => __wux.openApp(WizCore.apps('desktop').APP['app-store']));
        await p.waitForFunction(() => document.documentElement.dataset.aadSplit === 'on'); await settle();
        await p.waitForFunction(() => (window.WosBell?.items?.() || []).length >= 2 && window.WosSkinHost?.inboxThreads);
        await p.evaluate(id => WosSkinHost.inboxAct('open', id), NOTES[0].id);
        await p.waitForFunction(() => document.documentElement.hasAttribute('data-aad-chat') && [...document.querySelectorAll('[data-chact="resolve"]')].some(b => b.getClientRects().length)); await settle();
        const box = role => p.locator('#stage > .wsp[data-aad-role="' + role + '"]').boundingBox();
        const before = { chat: await box('chat'), app: await box('app') };
        await p.locator('#stage > .wsp[data-aad-role="chat"] [data-chact="resolve"]').click(); await settle(); await p.waitForTimeout(600);
        const after = { chat: await box('chat'), app: await box('app'), docked: await p.evaluate(() => document.documentElement.hasAttribute('data-aad-chat')) };
        row.placement = { before, after }; row.placementShot = path.join(out, `${skin}-${S.name}-app-beside-resolve.png`); await p.screenshot({ path: row.placementShot });
        if (tag === 'after') { assert.ok(before.app && before.chat, 'chat and app panes placed'); assert.ok(after.docked); assert.deepEqual(after.chat, before.chat, 'Resolve keeps the chat pane'); assert.deepEqual(after.app, before.app); }
      }
      row.writes = writes; row.runs = runs; row.errors = errors; report.shells.push(row);
      if (tag === 'after') {
        assert.deepEqual(errors, [], S.name + ' page errors'); assert.deepEqual(runs, []); assert.deepEqual(row.dupes, [], S.name + ' fetched a file twice');
        if (S.name === 'desktop-ai-apps') { assert.ok(!boot.layout.some(f => /^layouts\/ai-apps\/layout\.(js|css)$/.test(f)), 'AI apps desktop never loads the phone layout'); assert.ok(boot.layout.includes('layouts/ai-apps/desktop.js') && boot.layout.includes('layouts/ai-apps/desktop-boot.css')); }
        if (S.name === 'desktop-classic') assert.deepEqual(boot.layout, [], 'Classic loads no layout code');
        if (S.name === 'phone') { assert.deepEqual(boot.layout, []); assert.ok(!row.files.includes('core/pane-layout.js'), 'the phone never loads pane geometry'); }
      }
      await c.close();
    }
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    for (const r of report.shells) console.log(tag, r.skin, r.shell.padEnd(16), 'req', r.requests, 'bytes', r.bytes, 'layout', r.layout.join(',') || '-', r.errors.length ? 'ERR ' + r.errors.join(' | ') : '');
    console.log('PASS shell-finish', tag, 'nebula + sepia; AI apps desktop, Classic desktop, phone; synthetic only');
  } catch (e) { await p?.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {}); fs.writeFileSync(path.join(out, 'partial-report.json'), JSON.stringify(report, null, 2)); throw e; } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
