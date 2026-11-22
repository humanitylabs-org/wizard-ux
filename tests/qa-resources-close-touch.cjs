'use strict';
// wizard-ux issue 1538 in a real browser at phone size (412x915, touch). The iPhone app could not close the
// Resources sheet on the AI accounts tab: neither the ‹ button nor a tap outside worked. Two causes, both checked here:
//  1. every touch inside the sheet rewrote the whole AI accounts (and Devices) body, because the browser writes
//     `data-usage` back as `data-usage=""` and the "did it change" check never matched;
//  2. iOS withholds the click after a tap that changes the page, and the sheet only closed on click.
// The test makes the page behave like that iPhone: trusted clicks are swallowed, so only the touch itself can close
// the sheet. Then, on every tab (Devices, Health, AI accounts), opened from Home and from Settings › Resources:
//  - a repaint with unchanged readings leaves the sheet's body untouched;
//  - a tap on ‹ closes the sheet, and so does a tap outside it;
//  - with clicks allowed (any other phone), the touch alone closes it and no click follows, so nothing under the
//    closed sheet (Home, Settings) is tapped by mistake.
// Synthetic transport only (no box). QA_EXPECT=broken (with QA_WEB=<main>/web) asserts the old behaviour instead.
const assert = require('node:assert/strict');
const pw = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = 'https://resources-close.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || '';
const broken = process.env.QA_EXPECT === 'broken';
if (out) fs.mkdirSync(out, { recursive: true });
const iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const usage = () => ({ fetchedAt: iso(Date.now()), providers: [
  { id: 'claude', name: 'Claude', status: 'ok', plan: 'Max', fetchedAt: iso(Date.now()), limits: [{ id: 'session', label: 'Session', remainingPercent: 88, resetsAt: iso(Date.now() + 3e6) }, { id: 'weekly', label: 'Weekly · All models', remainingPercent: 70, resetsAt: iso(Date.now() + 864e5) }] },
  { id: 'chatgpt', name: 'ChatGPT', status: 'unavailable', fetchedAt: iso(Date.now()), limits: [], error: { code: 'signed_out', message: "ChatGPT isn't signed in." } },
  { id: 'tinfoil', name: 'Tinfoil', status: 'ok', fetchedAt: iso(Date.now()), limits: [], paid: { type: 'credits', balanceMinor: 731, limitMinor: 2000, exponent: 2, currency: 'USD' } }] });
(async () => {
  const browser = await pw.chromium.launch(), report = [];
  try {
    for (const ios of [true, false]) {
      const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block',
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WizardOS-iOS/1.0' });
      const errors = [];
      try {
        await context.routeWebSocket('**/*', w => w.close());
        await context.addInitScript(({ ios }) => {
          if (window !== top) return;
          if (!sessionStorage.getItem('qa.seeded')) {
            sessionStorage.setItem('qa.seeded', '1');
            for (const [k, v] of Object.entries({ 'wos.shell': 'phone', 'wux.shell': 'phone', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': 'nebula' })) localStorage.setItem(k, v);
          }
          // Every click that reaches the page after a touch is counted; on the "iPhone" run it is swallowed too.
          window.__qaClicks = [];
          addEventListener('click', e => {
            if (!e.isTrusted) return;
            window.__qaClicks.push(String(e.target?.className || e.target?.tagName || ''));
            if (ios) { e.preventDefault(); e.stopImmediatePropagation(); }
          }, true);
        }, { ios });
        const prefs = { migrations: { 'launcher-seed-v1': true } };
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), p = u.pathname;
          if (u.origin !== origin) return r.abort();
          if (!['GET', 'HEAD'].includes(q.method())) return r.fulfill({ json: p === '/wizard/v1/ui-preferences' ? prefs : { ok: true } });
          if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
          if (p.startsWith(prefix)) {
            const abs = path.resolve(web, decodeURIComponent(p.slice(prefix.length) || 'index.html'));
            if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
            return fs.existsSync(abs) && fs.statSync(abs).isFile() ? r.fulfill({ path: abs }) : r.fulfill({ status: 404, body: 'none' });
          }
          if (p === '/wizard/ai-usage') return r.fulfill({ json: usage() });
          if (p === '/api/system/load') return r.fulfill({ json: { cpu: 12, memory: 40, disk: 55 } });
          if (p === '/api/system/health') return r.fulfill({ json: { available: false } });
          if (p === '/api/system/devices') return r.fulfill({ json: { devices: [{ id: 'box', name: 'Wizard box', kind: 'server', cpu: 12, memory: 40, disk: 55 }] } });
          if (p === '/v1/setup') return r.fulfill({ json: { first_run: false } });
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: prefs });
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
        await page.goto(origin + prefix + 'index.html?phone');
        await page.waitForFunction(() => window.WosResources && window.__wos, null, { timeout: 20000 });
        await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
        await page.evaluate(() => window.WosResources.update(true));
        await nap(1200);
        const isOpen = () => page.evaluate(() => !!window.WosResources.state.panel);
        const boxOf = sel => page.evaluate(sel => { const el = [...document.querySelectorAll(sel)].find(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, sel);
        // Open and pick a tab without touch, so only the closing tap is under test.
        const openOn = async (from, tab) => {
          await page.evaluate(() => window.WosResources.back());
          if (from === 'settings') { await page.evaluate(() => window.__wos.openSettings('usage')); await nap(900); }
          const opener = from === 'settings' ? '#settingsBody [data-res-open]' : '[data-res-open]';
          await page.evaluate(sel => [...document.querySelectorAll(sel)].find(e => e.getClientRects().length)?.click(), opener);
          await page.waitForFunction(() => !!window.WosResources.state.panel, null, { timeout: 5000 });
          await page.evaluate(tab => document.querySelector(`.rs-sheet [data-res-tab="${tab}"]`).click(), tab);
          await nap(400);
        };
        for (const from of ['home', 'settings']) for (const tab of ['server', 'health', 'ai']) {
          await openOn(from, tab);
          // 1. A repaint with the same readings leaves the body alone.
          const rewrites = await page.evaluate(() => new Promise(res => {
            const b = document.querySelector('.rs-sheet [data-res-body]'); let n = 0;
            const mo = new MutationObserver(l => { n += l.length; }); mo.observe(b, { childList: true, subtree: true });
            window.WosResources.sync(); window.WosResources.sync();
            setTimeout(() => { mo.disconnect(); res(n); }, 60);
          }));
          report.push({ ios, from, tab, check: 'repaint-keeps-body', ok: rewrites === 0, rewrites });
          for (const way of ['button', 'outside']) {
            await openOn(from, tab);
            if (out && way === 'button' && ios) await page.screenshot({ path: path.join(out, `${from}-${tab}-open${broken ? '-before' : ''}.png`) });
            let at;
            if (way === 'button') at = await boxOf('.rs-sheet [data-res-close]');
            else { const b = await page.locator('.rs-sheet').boundingBox(); at = { x: 206, y: b.y > 8 ? b.y / 2 : Math.min(910, b.y + b.height + 4) }; }
            assert.ok(at, `no place to tap for ${way}`);
            await page.evaluate(() => { window.__qaClicks = []; });
            await page.touchscreen.tap(at.x, at.y); await nap(500);
            const closed = !(await isOpen()), clicks = await page.evaluate(() => window.__qaClicks.slice());
            report.push({ ios, from, tab, check: way, ok: closed, clicks });
            if (!ios && closed) report.push({ ios, from, tab, check: `${way}-no-click-after`, ok: clicks.length === 0, clicks });
            if (!closed && out) await page.screenshot({ path: path.join(out, `${from}-${tab}-${way}-stuck${broken ? '-before' : ''}.png`) });
          }
          await page.evaluate(() => window.WosResources.back());
          if (from === 'settings') { await page.evaluate(() => window.__wos.onBack?.()); await nap(300); }
        }
        assert.deepEqual(errors, [], 'no page errors');
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
  const bad = report.filter(r => !r.ok);
  for (const r of report) console.log(JSON.stringify(r));
  if (broken) {
    assert.ok(bad.some(r => r.ios && r.check === 'button' && r.tab === 'ai'), 'main: ‹ does not close the AI accounts tab when the phone withholds the click');
    assert.ok(bad.some(r => r.check === 'repaint-keeps-body' && r.tab === 'ai'), 'main: a repaint rewrites the AI accounts body');
    console.log(`baseline: ${bad.length} of ${report.length} checks fail on main, as reported`);
  } else {
    assert.deepEqual(bad, [], 'Resources closes on every tab, from Home and Settings, on a touch tap');
    console.log(`ok: ${report.length} checks, Resources closes on every tab with a touch tap`);
  }
})().catch(e => { console.error(e); process.exit(1); });
