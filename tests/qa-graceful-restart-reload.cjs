'use strict';
// wizard-ux issue 1362 kick-back in a real browser: with the wizard/graceful-restart switch ALREADY on when the page
// loads (first load on a phone or second device, then a reload; no switch tap in this tab), the shell must read
// /wizard/health and show the restart note. Before the fix a first load made 0 health reads, because reach.js checked
// the switch before the skin host painted data-tweaks. Phone 412x915 (classic) and desktop 1440x900. Synthetic transport only (no box is reached).
// QA_EXPECT=broken (with QA_WEB=<main>/web) asserts the old behaviour instead, as the baseline.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = 'https://graceful-restart-reload.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'graceful-restart-reload-evidence');
const broken = process.env.QA_EXPECT === 'broken';
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const ROWS = [{ id: 'qa-long', title: 'Long research', status: 'running', at: now - 6e5 }, { id: 'qa-done', title: 'Weekend plans', status: 'completed', at: now - 36e5 }]
  .map(s => ({ id: s.id, title: s.title, runtime: 'direct', status: s.status, updated_at: iso(s.at), updatedAt: iso(s.at), last_active: s.at / 1000, message_count: 2, messageCount: 2, preview: 'Working on it.' }));
const HOLD = { phase: 'waiting', holding: true, reason: 'update', active: 1, held: 1, oldest_active_s: 40, wait_until: iso(now + 6e5) };
(async () => {
  const browser = await chromium.launch(), report = [];
  try {
    for (const shell of ['phone', 'desktop']) {
      const phone = shell === 'phone';
      const context = await browser.newContext({ viewport: phone ? { width: 412, height: 915 } : { width: 1440, height: 900 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block',
        ...(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' } : {}) });
      let health = 0;
      try {
        await context.routeWebSocket('**/*', w => w.close());
        await context.addInitScript(({ shell }) => {
          if (window !== top) return;
          for (const [k, v] of Object.entries({ 'wos.shell': shell, 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': 'nebula', 'wos.desktop-view.v1': 'classic',
            'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix: { 'wizard/graceful-restart': true } }) })) localStorage.setItem(k, v);
        }, { shell });
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), p = u.pathname, method = q.method();
          if (u.origin !== origin) return r.abort();
          if (p === '/wizard/health') { health++; return r.fulfill({ json: { status: 'ok', restart: HOLD } }); }
          if (!['GET', 'HEAD'].includes(method)) return r.fulfill({ json: { ok: true } });
          if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
          if (p.startsWith(prefix)) {
            const abs = path.resolve(web, decodeURIComponent(p.slice(prefix.length) || 'index.html'));
            if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
            return fs.existsSync(abs) && fs.statSync(abs).isFile() ? r.fulfill({ path: abs }) : r.fulfill({ status: 404, body: 'none' });
          }
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: ROWS, has_more: false } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) { const s = ROWS.find(x => x.id === decodeURIComponent(m[1])); if (!s) return r.fulfill({ status: 404, json: {} });
            return r.fulfill({ json: m[2] ? { messages: [{ role: 'user', content: 'Ask for ' + s.title, timestamp: now / 1000 - 600 }] } : { session: s } }); }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage();
        for (const round of ['first load', 'reload']) {
          health = 0;
          if (round === 'reload') await page.reload(); else await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
          await page.waitForFunction(() => String(document.documentElement.dataset.tweaks || '').includes('wizard/graceful-restart'), null, { timeout: 15000 });
          await nap(4000);
          const st = await page.evaluate(() => window.WizReach?.restart?.() || null);
          const row = { shell, round, healthReads: health, phase: st?.phase || null };
          if (round === 'reload') {
            // Open a chat so a message box is on screen: the note sits beside it.
            await page.evaluate(() => (window.__wos?.openChat || window.WizOpenChat)?.('qa-done'));
            await nap(2500);
            row.note = await page.evaluate(() => document.querySelector('[data-restart-notice]')?.textContent || '');
            await page.screenshot({ path: path.join(out, `${shell}-${broken ? 'before' : 'after'}.png`) });
          }
          report.push(row); console.log(JSON.stringify(row));
          // On main a reload can work by luck (the skin host's cached list of last-worn tweaks is on <html> early);
          // a device's first load with the switch on (phone, second device, cleared cache) never does.
          if (broken) { if (round === 'first load') { assert.equal(health, 0, `${shell} ${round}: main makes no health read`); assert.equal(st, null); } }
          else { assert.ok(health >= 1, `${shell} ${round}: health read`); assert.equal(st?.phase, 'waiting', `${shell} ${round}: restart known`); }
        }
      } finally { await context.close(); }
    }
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(broken ? 'baseline confirmed: no health read after load' : 'ok: the restart watch starts after load and reload');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
