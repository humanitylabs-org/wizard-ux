'use strict';
// wizard-ux issue 1538 in a real browser: phone 412x915. Open Home's Resources sheet, pick each tab (Devices, Health,
// AI accounts) and leave it three ways: the sheet's ‹ button, the phone Back (history back), and a tap outside the
// sheet. Every way must close the sheet on every tab. Synthetic transport only (no box).
// QA_EXPECT=broken (with QA_WEB=<main>/web) asserts the old behaviour instead, as the baseline.
const assert = require('node:assert/strict');
const pw = require('../tools/qa-playwright.cjs');
const engine = process.env.QA_ENGINE || 'chromium';
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = 'https://resources-close.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'resources-close-evidence');
const broken = process.env.QA_EXPECT === 'broken', tag = broken ? '-before' : '';
const skins = (process.env.QA_SKINS || 'nebula,landscapes').split(',');
fs.mkdirSync(out, { recursive: true });
const iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const rich = () => ({ fetchedAt: iso(Date.now()), providers: [
  { id: 'claude', name: 'Claude', status: 'ok', plan: 'Max', fetchedAt: iso(Date.now()), limits: [{ id: 'session', label: 'Session', remainingPercent: 88, resetsAt: iso(Date.now() + 3e6) }, { id: 'weekly', label: 'Weekly · All models', remainingPercent: 70, resetsAt: iso(Date.now() + 864e5) }, { id: 'fable', label: 'Weekly · Fable', remainingPercent: 12, resetsAt: iso(Date.now() + 864e5) }], paid: { type: 'spend', enabled: true, usedMinor: 1234, limitMinor: 5000, exponent: 2, currency: 'USD' } },
  { id: 'chatgpt', name: 'ChatGPT', status: 'unavailable', fetchedAt: iso(Date.now()), limits: [], error: { code: 'signed_out', message: "ChatGPT isn't signed in. Open the \"ChatGPT\" app & press Connect." } },
  { id: 'tinfoil', name: 'Tinfoil', status: 'ok', fetchedAt: iso(Date.now()), limits: [], paid: { type: 'credits', balanceMinor: 731, limitMinor: 2000, exponent: 2, currency: 'USD' } },
  { id: 'gemini', name: 'Gemini', status: 'stale', fetchedAt: iso(Date.now() - 36e5), limits: [{ id: 'daily', label: 'Daily', remainingPercent: 50, resetsAt: iso(Date.now() + 4e7) }], error: { message: "Couldn't refresh <now>" } }] });
const usage = () => process.env.QA_USAGE === 'rich' ? rich() : ({ fetchedAt: iso(Date.now()), providers: [
  { id: 'claude', name: 'Claude', status: 'ok', fetchedAt: iso(Date.now()), limits: [{ id: 'weekly', label: 'Weekly', remainingPercent: 70, resetsAt: iso(Date.now() + 864e5) }] },
  { id: 'chatgpt', name: 'ChatGPT', status: 'ok', fetchedAt: iso(Date.now()), limits: [{ id: 'weekly', label: 'Weekly', remainingPercent: 40, resetsAt: iso(Date.now() + 864e5) }] }] });
(async () => {
  const browser = await pw[engine].launch(), report = [];
  try {
    for (const skin of skins) {
      const context = await browser.newContext(engine === 'webkit'
        ? { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, serviceWorkers: 'block', userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' }
        : { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block', userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' });
      const errors = [];
      try {
        await context.routeWebSocket('**/*', w => w.close());
        await context.addInitScript(({ skin }) => {
          if (window !== top || sessionStorage.getItem('qa.seeded')) return;
          sessionStorage.setItem('qa.seeded', '1');
          for (const [k, v] of Object.entries({ 'wos.shell': 'phone', 'wux.shell': 'phone', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin })) localStorage.setItem(k, v);
        }, { skin });
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
          if (p === '/api/system/devices') return r.fulfill({ json: { devices: [] } });
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
        await nap(1200); if (process.env.QA_DEBUG) { console.log(await page.evaluate(() => ({ n: document.querySelectorAll('[data-res-open]').length, home: document.querySelectorAll('[data-home-resources]').length, idx: window.__wos.idx, html: (document.querySelector('[data-home-resources]')?.outerHTML||'').slice(0,500) }))); await page.screenshot({ path: path.join(out, 'debug.png') }); }
        const open = () => page.evaluate(() => !!window.WosResources.state.panel);
        const tap = async (x, y) => { await page.touchscreen.tap(x, y); await nap(500); };
        const tapSel = async sel => { const b = await page.evaluate(sel => { const el = [...document.querySelectorAll(sel)].find(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }, sel); if (!b) await page.screenshot({ path: path.join(out, 'nobox.png') }); assert.ok(b, `no box for ${sel}`); await tap(b.x + b.width / 2, b.y + b.height / 2); };
        for (const from of (process.env.QA_FROM || 'home,settings').split(',')) for (const tab of ['server', 'health', 'ai']) {
          for (const way of (process.env.QA_WAYS || 'button,back,outside').split(',')) {
            if (from === 'settings') { await page.evaluate(() => window.__wos.openSettings('usage')); await nap(900); await tapSel('#settingsBody [data-res-open]'); }
            else await tapSel('[data-res-open]');
            await page.waitForFunction(() => !!window.WosResources.state.panel, null, { timeout: 5000 });
            await tapSel(`.rs-sheet [data-res-tab="${tab}"]`);
            await nap(700);
            if (process.env.QA_DEBUG) console.log('churn', tab, await page.evaluate(() => new Promise(res => { const b = document.querySelector('.rs-sheet [data-res-body]'); let n = 0; const mo = new MutationObserver(l => { n += l.length; }); mo.observe(b, { childList: true, subtree: true }); let frames = 0; const t0 = performance.now(); const f = () => { frames++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else { mo.disconnect(); res({ n, frames }); } }; requestAnimationFrame(f); })));
            if (way === 'button') await page.screenshot({ path: path.join(out, `${skin}-${from}-${tab}-open${tag}.png`) });
            if (way === 'button') { if (process.env.QA_DEBUG) console.log(await page.evaluate(() => { const S = document.querySelector('.rs-sheet'); const r = S.getBoundingClientRect(); const at = (x, y) => { const e = document.elementFromPoint(x, y); return e ? e.tagName + '.' + String(e.className).slice(0, 40) : null; }; return JSON.stringify({ r: [r.top, r.bottom], top: at(206, r.top / 2), dock: at(206, (r.bottom + innerHeight) / 2), dockOrb: at(206, innerHeight - 40), side: at(4, 400) }); })); await tapSel('.rs-sheet [data-res-close]'); }
            else if (way === 'back') { await page.evaluate(() => history.back()); await nap(800); }
            else if (way === 'esc') { await page.keyboard.press('Escape'); await nap(800); }
            else if (way === 'native') { await page.evaluate(() => window.__wosNativeBack()); await nap(800); }
            else {
              // Tap outside: the strip just above the sheet, or below it (over the dock), wherever the sheet leaves room.
              const box = await page.locator('.rs-sheet').boundingBox();
              const y = box.y > 8 ? box.y / 2 : Math.min(910, box.y + box.height + 4);
              await tap(206, y);
            }
            const still = await open();
            report.push({ skin, from, tab, way, closed: !still }); if (process.env.QA_DEBUG) console.log(JSON.stringify(report.at(-1)));
            if (process.env.QA_DEBUG && way === 'button') console.log(await page.evaluate(() => { const S = document.querySelector('.rs-sheet'); if (!S) return 'no sheet'; const r = S.getBoundingClientRect(); const at = (x, y) => { const e = document.elementFromPoint(x, y); return e ? e.tagName + '.' + String(e.className).slice(0, 40) : null; }; return JSON.stringify({ r: [r.top, r.bottom], top: at(206, r.top / 2), dock: at(206, (r.bottom + innerHeight) / 2), dockOrb: at(206, innerHeight - 40), side: at(4, 400) }); }));
            if (still) { await page.screenshot({ path: path.join(out, `${skin}-${from}-${tab}-${way}-stuck${tag}.png`) }); await page.evaluate(() => window.WosResources.back()); await nap(300); }
          }
        }
        assert.deepEqual(errors, [], 'no page errors');
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
  console.log(JSON.stringify(report));
  const stuck = report.filter(r => !r.closed);
  if (broken) assert.ok(stuck.length, 'main leaves the Resources sheet stuck at least once');
  else assert.deepEqual(stuck, [], 'every tab closes every way');
  console.log(broken ? 'baseline: stuck on main as reported' : 'ok: Resources closes on every tab, every way');
})().catch(e => { console.error(e); process.exit(1); });
