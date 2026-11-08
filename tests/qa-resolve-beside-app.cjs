'use strict';
// James, 6 Nov 2026: Resolve this on a notification beside an app spread the chat full width behind the app panel.
// Real AI-apps shell on a synthetic origin only (synthetic notifications, every write refused, /v1/runs aborted).
// Real clicks on "Have Wizard handle it" in tiled / centred / side-by-side / full screen; the chat pane keeps its geometry
// and stays above the app's stacking, and the app pane is unchanged. Screenshots on two skins (Nebula, Sepia).
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const origin = 'https://resolve-sheet.test', prefix = '/wizard-os-home/', root = path.resolve(process.env.QA_WEB || path.join(__dirname, '../web'));
const out = process.env.QA_OUT || 'resolve-sheet-evidence'; fs.mkdirSync(out, { recursive: true });
const now = Math.floor(Date.now() / 1000);
const NOTES = ['a', 'b', 'c', 'd'].map((k, n) => ({ id: 'qa-note-' + k, title: 'Synthetic alert ' + k.toUpperCase(), message: 'A synthetic notification for the Resolve layout check.', time: now - n * 60, source: 'preview', priority: 3, read: false, archived: false }));
const report = { cases: [] };
(async () => {
  const browser = await chromium.launch(); let p;
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
        if (u.pathname === prefix + 'store/index.html') return r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset="utf-8"><body style="background:#2a2a38;color:#eee;font:16px system-ui;padding:24px"><h1>Synthetic app</h1>' });
        if (u.pathname === '/notifications/api/items') return r.fulfill({ json: { items: NOTES } });
        if (u.pathname === '/notifications/api/count') return r.fulfill({ json: { unread: NOTES.length, needs: 0 } });
        if (u.pathname.startsWith('/notifications/')) return r.fulfill({ json: {} });
        if (u.pathname === '/wizard/v1/apps') return r.fulfill({ json: { apps: [{ id: 'notifications', name: 'Notifications', type: 'agent', source: 'apps.json' }] } });
        if (u.pathname === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
        if (u.pathname === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: [], has_more: false } });
        if (u.pathname.startsWith('/wizard/')) return r.fulfill({ json: ownerRead(u.pathname) });
        if (u.pathname.startsWith(prefix)) { const f = path.resolve(root, u.pathname.slice(prefix.length) || 'index.html'); if (f.startsWith(root + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile()) return r.fulfill({ path: f }); }
        return r.fulfill({ json: { apps: [], agents: [], sessions: [], connected: false } });
      });
      p = await c.newPage(); p.on('pageerror', e => errors.push(e.message));
      const settle = async () => { await p.waitForTimeout(250); await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); };
      const box = async role => p.locator('#stage > .wsp[data-aad-role="' + role + '"]').boundingBox();
      const z = role => p.evaluate(r => getComputedStyle(document.querySelector('#stage > .wsp[data-aad-role="' + r + '"]')).zIndex, role);
      await p.goto(origin + prefix + 'desktop.html');
      await p.waitForFunction(() => window.__wux && document.documentElement.dataset.aiApps === 'desktop' && !window.WosWelcome?.active && document.querySelector('.ch-compose'));
      await p.waitForFunction(() => (window.WosBell?.items?.() || []).length >= 4 && window.WosSkinHost?.inboxThreads);
      await p.evaluate(() => __wux.openApp(WizCore.apps('desktop').APP['app-store']));
      await p.waitForFunction(() => document.documentElement.dataset.aadSplit === 'on'); await settle();
      let i = 0;
      for (const mode of ['tiled', 'centre', 'pair', 'full']) {
        await p.evaluate(m => WizCore.panes.set({ mode: m, focus: 'chats' }), mode); await settle();
        await p.evaluate(id => WosSkinHost.inboxAct('open', id), NOTES[i++].id);
        await p.waitForFunction(() => document.documentElement.hasAttribute('data-aad-chat') && [...document.querySelectorAll('[data-chact="resolve"]')].some(b => b.getClientRects().length)); await settle();
        const before = { chat: await box('chat'), app: await box('app') };
        await p.locator('#stage > .wsp[data-aad-role="chat"] [data-chact="resolve"]').click();
        await settle(); await p.waitForTimeout(600);
        const after = { chat: await box('chat'), app: await box('app'), docked: await p.evaluate(() => document.documentElement.hasAttribute('data-aad-chat')), z: await z('chat') };
        const hit = await p.evaluate(() => { const r = document.querySelector('#stage > .wsp[data-aad-role="chat"]').getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('.wsp')?.dataset.aadRole || 'none'; });
        const file = path.join(out, `${skin}-${mode}-after-resolve.png`); await p.screenshot({ path: file });
        report.cases.push({ skin, mode, before, after, hit, file });
        assert.ok(after.docked, mode + ': chat stays docked');
        assert.deepEqual(after.chat, before.chat, mode + ': chat pane keeps its geometry');
        assert.deepEqual(after.app, before.app, mode + ': app pane unchanged');
        assert.equal(after.z, '3', mode + ': chat pane stacked with the app pane');
        assert.equal(hit, 'chat', mode + ': chat pane on top at its centre');
      }
      assert.deepEqual(errors, []); assert.deepEqual(runs, []);
      report.cases.push({ skin, writes, runs, errors }); await c.close();
    }
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log('PASS Resolve this beside an app stays in the chat column: tiled, centred, side by side, full screen; nebula + sepia; synthetic only');
  } catch (e) { await p?.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {}); fs.writeFileSync(path.join(out, 'partial-report.json'), JSON.stringify(report, null, 2)); throw e; } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
