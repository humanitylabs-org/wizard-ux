'use strict';
// Slim pin page (wizard-ux issue 1584, on for everyone: the switch wizard/pin-slim-doc is removed). Real Chromium,
// synthetic transport (no box read or written). A home-screen app session (index.html?app-session=wisdom) opens a
// stand-in app that uses the real app-client.js. Five cold opens at 4x CPU slowdown: when the app's own page starts,
// how many shell scripts the page holds by then, and that the page has no errors. Then, in one session: the
// app's Share opens Wizard's share sheet and Android Back (window.__wosNativeBack) closes the sheet first, then the
// app's own layer; the app opens a hosted Chats thread (Wisdom may host threads) and Back leaves it; the app's own
// page sees the shell's appearance tokens (--wz-*). QA_RUNS sets the open count. QA_WEB=<older checkout>/web with
// QA_OLD=1 measures a tree from before the slim page (the full shell, no slim page expected).
// Measured 18 Nov 2026 (QA_RUNS=3, 4x CPU): off 1253 ms / 119 scripts, on 758 ms / 34 scripts to the app's first script.
// Since issue 1696 the app frame waits for the services an app reads at load (core/pin-doc.js kind 'a': live.js, chat-kit...):
// 21 Nov 2026 on a busy 2-CPU box (QA_RUNS=5, 4x CPU): off 1823 ms / 197 scripts, on 1321 ms / 47 scripts.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://pin-slim.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'pin-slim-evidence');
const RUNS = +process.env.QA_RUNS || 5, CPU = +process.env.QA_CPU || 4;
const SLIM = !process.env.QA_OLD;
const APP = { id: 'wisdom', name: 'Wisdom', url: '/wisdom/', source: 'apps.json', type: 'view', kind: 'wizard', status: 'running' };
const MESSENGER = { id: 'messenger', name: 'Messenger', url: '/messenger/', source: 'apps.json', type: 'view', kind: 'wizard', status: 'running' };
const PAGE = `<!doctype html><meta charset="utf-8"><title>Wisdom</title><body style="font:18px system-ui;padding:24px;background:#fff">
<script>try { top.__appStart = Date.now(); top.__appScripts = top.document.scripts.length; } catch (_) {}</script>
<h1>Wisdom (stand-in)</h1><section id="now" style="border:2px solid #333;padding:16px"><h2>Chapter</h2><p>Some text</p>
<button id="share" style="font-size:18px">Share</button> <button id="thread" style="font-size:18px">Ask</button></section>
<script src="/wizard-os-home/core/app-client.js"></script><script>
window.nowOpen = true;
WizardApp.back.register({ canGoBack: () => window.nowOpen, back: () => { window.nowOpen = false; document.getElementById('now').hidden = true; return true; } });
document.getElementById('share').onclick = () => { window.outcome = 'pending'; WizardApp.share.text({ title: 'Chapter', text: 'From Wisdom' }).then(o => { window.outcome = o; }); };
document.getElementById('thread').onclick = () => { window.threadAsked = WizardApp.nav.openThread('qa-thread-1'); };
WizardApp.ready?.();
</script></body>`;
fs.mkdirSync(out, { recursive: true });
const nap = ms => new Promise(r => setTimeout(r, ms));
const median = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const SESSION = { id: 'qa-thread-1', title: 'Synthetic thread', source: 'wizard', started_at: 1, last_active: 2, message_count: 0 };

async function context(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await ctx.routeWebSocket('**/*', w => w.close());
  await ctx.addInitScript(([apps]) => {
    if (window !== top) return;
    localStorage.setItem('wux.apps.v1', JSON.stringify(apps));
    for (const [k, v] of Object.entries({ 'wos.shell': 'phone', 'wux.shell': 'phone', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': 'nebula' })) localStorage.setItem(k, v);
  }, [[APP, MESSENGER]]);
  const reads = [];
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
    if (u.origin !== origin) return r.abort();
    if (p.startsWith(APP.url)) return r.fulfill({ body: PAGE, contentType: 'text/html' });
    if (!['GET', 'HEAD'].includes(method)) {
      if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
      return r.fulfill({ status: 405, json: { error: 'Synthetic fixture refuses this write' } });
    }
    if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
    if (p.startsWith(prefix)) {
      const f = decodeURIComponent(p.slice(prefix.length) || 'index.html'), abs = path.resolve(web, f);
      if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return r.fulfill({ path: abs });
      return r.fulfill({ status: 404, body: 'No synthetic static asset' });
    }
    reads.push(p);
    if (p === '/wizard/v1/bootstrap') return r.fulfill({ json: { bootstrap: 1, capabilities: {}, endpoints: {}, settings: {} } });
    if (p === '/wizard/v1/apps') return r.fulfill({ json: { apps: [APP, MESSENGER] } });
    if (p === '/wizard/v1/setup') return r.fulfill({ json: { first_run: false } });
    if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
    if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: [SESSION], has_more: false } });
    if (p.startsWith('/wizard/hermes/api/sessions/')) return r.fulfill({ json: { session: SESSION, messages: [], data: [], has_more: false } });
    return r.fulfill({ json: ownerRead(p) });
  });
  return { ctx, reads };
}

async function open(browser) {
  const { ctx, reads } = await context(browser);
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  await page.goto(origin + prefix + 'index.html?app-session=wisdom', { waitUntil: 'commit' });
  const app = page.frameLocator('iframe.appframe').first();
  await app.locator('#share').waitFor({ timeout: 30000 });
  const at = await page.evaluate(() => ({ start: top.__appStart - performance.timeOrigin, scripts: top.__appScripts, slim: document.documentElement.dataset.pinDoc === '1' }));
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  return { ctx, page, app, errors, reads, at };
}

(async () => {
  const browser = await chromium.launch(), report = {};
  try {
    {
      const side = SLIM ? 'on' : 'old', on = SLIM, times = [], scripts = [];
      for (let i = 0; i < RUNS; i++) {
        const o = await open(browser);
        assert.equal(o.at.slim, on, `${side}: slim page ${on ? 'used' : 'not used'}`);
        times.push(Math.round(o.at.start)); scripts.push(o.at.scripts);
        assert.deepEqual(o.errors, [], `${side}: no page errors`);
        await o.ctx.close();
      }
      // One session: share + Back, hosted thread + Back, appearance tokens, the rest of the host arriving.
      const o = await open(browser);
      const { page, app } = o;
      const frame = page.frames().find(f => f.url().includes(APP.url));
      await nap(on ? 2500 : 800);
      const extras = await page.evaluate(() => ({ chats: !!window.WizChatsHost, live: !!window.WizLive, viewer: !!window.WosChat?.viewer, scripts: document.scripts.length }));
      const tokens = await frame.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--wz-bg').trim() || getComputedStyle(document.documentElement).getPropertyValue('--wz-accent').trim());
      await page.screenshot({ path: path.join(out, `pin-slim-${side}-1-open.png`) });
      await app.locator('#share').tap();
      await page.locator('.wos-share.on').waitFor({ timeout: 8000 });
      await nap(500);
      await page.screenshot({ path: path.join(out, `pin-slim-${side}-2-share.png`) });
      const state = async () => ({ sheet: await page.evaluate(() => !!window.WosShareSheet?.isOpen?.()), now: await frame.evaluate(() => window.nowOpen), outcome: await frame.evaluate(() => window.outcome) });
      const b1 = await page.evaluate(() => window.__wosNativeBack()); await nap(600); const s1 = await state();
      await app.locator('#thread').tap();
      await page.locator('#singleApp [data-chback]').first().waitFor({ timeout: 10000 });
      await nap(400);
      await page.screenshot({ path: path.join(out, `pin-slim-${side}-3-thread.png`) });
      const asked = await frame.evaluate(() => window.threadAsked);
      const b2 = await page.evaluate(() => window.__wosNativeBack()); await nap(600);
      const threadGone = await page.evaluate(() => !document.querySelector('#singleApp [data-chback]'));
      const b3 = await page.evaluate(() => window.__wosNativeBack()); await nap(300);
      const s3 = await state();
      const b4 = await page.evaluate(() => window.__wosNativeBack());
      report[side] = { firstAppMs: times, medianMs: median(times), scriptsAtAppStart: scripts, extras, tokens, b1, s1, asked, b2, threadGone, b3, s3, b4, errors: o.errors, bootstrapReads: o.reads.filter(p => p === '/wizard/v1/bootstrap').length };
      assert.equal(s1.sheet, false, `${side}: Back #1 closes the share sheet`); assert.equal(s1.now, true, `${side}: the app layer stays`); assert.equal(s1.outcome, 'cancelled');
      assert.equal(asked, true, `${side}: the hosted thread was accepted`);
      assert.equal(b2, 'thread', `${side}: Back in the thread leaves the thread`); assert.equal(threadGone, true);
      assert.equal(s3.now, false, `${side}: next Back closes the app's own layer`);
      assert.equal(b4, 'root', `${side}: Back at the app's root is consumed (never exits)`);
      assert.ok(tokens, `${side}: the app sees the shell's appearance tokens`);
      assert.equal(extras.chats && extras.live && extras.viewer, true, `${side}: Chats host, live and media viewer are there`);
      assert.deepEqual(o.errors, [], `${side}: no page errors`);
      assert.equal(report[side].bootstrapReads, 1, `${side}: one bootstrap read`);
      await o.ctx.close();
    }
    console.log(JSON.stringify(report, null, 1));
    fs.writeFileSync(path.join(out, 'pin-slim-report.json'), JSON.stringify(report, null, 1));
    console.log('PASS');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
