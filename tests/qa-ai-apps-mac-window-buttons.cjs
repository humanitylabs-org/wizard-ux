'use strict';
// AI apps view inside Wizard for Mac (wizard-os issue 543): the Mac window draws its red/yellow/green buttons over the
// top-left of a full-size web view, so the sidebar header (Wizard name, search, collapse), the folded rail's first
// button and the chat title beside the rail must sit clear of them. Real browser, disposable synthetic data; the page
// is told it is in the Mac app (webkit.messageHandlers.wizardNative), and the window-button area is the 12..80 x
// 0..28 px box the Mac app keeps for them (WizardDragView leaves x < 96 to the buttons).
// QA_EXPECT=broken checks the overlap is really there (baseline on main); default checks it is gone.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = 'https://mac-window-buttons.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'mac-window-buttons-evidence');
const BROKEN = process.env.QA_EXPECT === 'broken';
// the traffic lights' box in page px at zoom 100%; zoomed out to 80% the same points cover more CSS px, and the Mac app
// reports --wz-titlebar-left = 100px (try-wizard WizardTitleBarInset: (buttons' end + 12) / zoom)
const BOX = zoom => ({ x0: 12 / zoom, x1: 80 / zoom, y0: 0, y1: 28 / zoom });
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const ROWS = [['qa-a', 'Write three-word greeting'], ['qa-b', 'Run sleep 900 in background']].map(([id, title], i) => ({
  id, title, runtime: 'direct', status: 'completed', updated_at: iso(now - (i + 1) * 36e5), updatedAt: iso(now - (i + 1) * 36e5),
  last_active: (now - (i + 1) * 36e5) / 1000, message_count: 2, messageCount: 2, archived: false, preview: 'Done.' }));
let BUTTONS = BOX(1);
const hits = (b) => b && b.width > 0 && b.height > 0 && b.x < BUTTONS.x1 && b.x + b.width > BUTTONS.x0 && b.y < BUTTONS.y1 && b.y + b.height > BUTTONS.y0;
const report = { web, expect: BROKEN ? 'broken' : 'fixed', cases: [] };

(async () => {
  const browser = await chromium.launch();
  try {
    for (const [mode, zoom] of [['open', 0], ['rail', 0], ['open', 0.8], ['rail', 0.8]]) {
      BUTTONS = BOX(zoom || 1);
      const entry = { mode, zoom: zoom || 'not reported', errors: [], overlaps: [] }; report.cases.push(entry);
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        await context.addInitScript(({ mode }) => {
          if (window !== top) return;
          window.webkit = { messageHandlers: { wizardNative: { postMessage() {} } } };
          if (sessionStorage.getItem('qaBoot')) return; sessionStorage.setItem('qaBoot', '1');
          for (const [k, v] of Object.entries({ 'wos.shell': 'desktop', 'wux.shell': 'desktop', 'wos.desktop-view.v1': 'ai-apps', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': 'nebula',
            'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix: { 'wizard/desktop-chats': true } }) })) localStorage.setItem(k, v);
          if (mode === 'rail') for (const k of ['wux.aad.side', 'wos.aad.side', 'wux.ai-apps.side']) localStorage.setItem(k, 'rail');
        }, { mode });
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
          if (u.origin !== origin) return r.abort();
          if (!['GET', 'HEAD'].includes(method)) {
            if (p === '/wizard/thread-seen') return r.fulfill({ json: { ok: true } });
            return r.fulfill({ status: 405, json: { error: 'Synthetic fixture refuses this write' } });
          }
          if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
          if (p.startsWith(prefix)) {
            const f = decodeURIComponent(p.slice(prefix.length) || 'index.html'), abs = path.resolve(web, f);
            if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
            if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return r.fulfill({ path: abs });
            return r.fulfill({ status: 404, body: 'No synthetic static asset' });
          }
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: ROWS, has_more: false } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) { const s = ROWS.find(x => x.id === decodeURIComponent(m[1])); if (!s) return r.fulfill({ status: 404, json: { error: 'missing' } });
            return r.fulfill({ json: m[2] ? { messages: [{ role: 'user', content: 'Say hi in three words', timestamp: now / 1000 - 600 }, { role: 'assistant', content: 'Hello there, friend.', timestamp: now / 1000 - 590 }] } : { session: s } }); }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + prefix + 'desktop.html');
        await page.waitForFunction(() => window.__wux && !window.WosWelcome?.active && document.documentElement.dataset.layout === 'ai-apps', null, { timeout: 20000 });
        assert.equal(await page.evaluate(() => document.documentElement.dataset.nativeChrome), 'mac');
        await page.locator('.aad-side').waitFor({ timeout: 15000 });
        if (mode === 'rail' && await page.evaluate(() => document.documentElement.dataset.aadSide) !== 'rail') {
          await page.keyboard.press('Control+Shift+S'); await nap(400);
          if (await page.evaluate(() => document.documentElement.dataset.aadSide) !== 'rail') await page.locator('.aad-sh .aad-ib').last().click();
        }
        await page.waitForFunction(m => document.documentElement.dataset.aadSide === m, mode, { timeout: 5000 });
        if (zoom) await page.evaluate(z => document.documentElement.style.setProperty('--wz-titlebar-left', Math.ceil(80 / z) + 'px'), zoom);
        // open a chat so the top row shows its title beside the sidebar / rail
        const row = page.locator('.aad-side .aad-row').filter({ visible: true }).first();
        if (await row.count()) { await row.click().catch(() => {}); await nap(600); }
        else if (mode === 'rail') {
          await page.evaluate(() => { const r = document.querySelector('[data-sid="qa-a"], .aad-rail [data-sid]'); r?.click(); }); await nap(600);
        }
        await page.evaluate(() => document.fonts.ready); await nap(400);
        const boxes = await page.evaluate(() => {
          const sel = 'button, a, input, [role="button"], .aad-wsn, .aad-tt';
          const roots = [...document.querySelectorAll('.aad-side, .aad-top, .aad-hback')];
          const seen = new Set(), list = [];
          for (const root of roots) for (const n of [root, ...root.querySelectorAll(sel)]) {
            if (seen.has(n) || !n.matches(sel)) continue; seen.add(n);
            const cs = getComputedStyle(n); if (cs.visibility === 'hidden' || cs.display === 'none' || n.closest('[hidden]')) continue;
            if (n.matches('.aad-tt') && !n.textContent.trim()) continue;
            const r = n.getBoundingClientRect(); if (!r.width || !r.height) continue;
            list.push({ what: (n.className && String(n.className)) || n.tagName, label: n.getAttribute('aria-label') || n.textContent.trim().slice(0, 30), x: r.x, y: r.y, width: r.width, height: r.height });
          }
          return list;
        });
        entry.overlaps = boxes.filter(hits);
        entry.checked = boxes.length;
        await page.screenshot({ path: path.join(out, `ai-apps-${mode}${zoom ? '-zoom80' : ''}-${BROKEN ? 'before' : 'after'}.png`), clip: { x: 0, y: 0, width: 640, height: 240 } });
        // draw the window buttons on a second capture so a reader sees where they would be
        await page.evaluate(({ x0 }) => { const k = x0 / 12, d = document.createElement('div'); d.id = 'qa-lights'; d.style.cssText = `position:fixed;z-index:99999;top:${8 * k}px;left:${20 * k}px;display:flex;gap:${8 * k}px;pointer-events:none`;
          for (const c of ['#ff5f57', '#febc2e', '#28c840']) { const b = document.createElement('i'); b.style.cssText = `width:${12 * k}px;height:${12 * k}px;border-radius:50%;background:${c};display:block`; d.append(b); } document.body.append(d); }, BUTTONS);
        await page.screenshot({ path: path.join(out, `ai-apps-${mode}${zoom ? '-zoom80' : ''}-${BROKEN ? 'before' : 'after'}-lights.png`), clip: { x: 0, y: 0, width: 640, height: 240 } });
        if (BROKEN) assert.ok(entry.overlaps.length > 0, mode + ': expected controls under the window buttons on the baseline');
        else assert.deepEqual(entry.overlaps.map(o => o.label || o.what), [], mode + ': controls under the window buttons');
        assert.ok(entry.checked > 2, mode + ': found the sidebar controls');
        entry.pass = true;
      } finally { await context.close(); }
    }
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report.cases.map(c => ({ mode: c.mode, zoom: c.zoom, pass: !!c.pass, checked: c.checked, overlaps: c.overlaps.map(o => `${o.label || o.what} @${Math.round(o.x)},${Math.round(o.y)}`), errors: c.errors.slice(0, 3) })), null, 1));
  }
})().catch(e => { console.error(e); process.exit(1); });
