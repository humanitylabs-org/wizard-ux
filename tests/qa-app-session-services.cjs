'use strict';
// One-app page services (wizard-ux issue 1694). Real Chromium, synthetic transport (no box read or written).
// An app opened on its own (Android home-screen icon offline, a Mac Dock window, /wizard-os-home/app-session.html)
// must get the same shell services it gets inside the full shell. TG style reads parent.WizLive at load and showed
// "Open Telegram from Wizard" in app-session.html because live.js and the rest were never loaded there.
// For both pages (index.html?app-session=<id>, the slim pin page, and app-session.html?app-session=<id>)
// this opens a stand-in app and records which Wiz*/Wos* services its parent page holds once the app has loaded, then
// checks app-session.html holds every one the full shell holds, that the app sees WizLive/WosChat/WosModels from its own
// first script, that the Chats host is there, that Back at the app's root is still consumed, and that there are no errors.
// QA_TG_WEB=<telegram checkout>/web serves the real TG style app instead of the stand-in (screenshots only).
// index.html?app-session=<id> is the slim pin page for everyone (issue 1584; issue 1696): the app's first script must
// see the same services there, and once the rest of its host has arrived it is the reference for app-session.html.
// QA_WEB=<other checkout>/web runs against another tree (the baseline before the fix).
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://app-session.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'app-session-evidence');
const TG = process.env.QA_TG_WEB || '';
const APP = { id: 'tg-style', name: 'TG style', url: '/tg-style/', source: 'apps.json', type: 'view', kind: 'wizard', status: 'running' };
const PAGE = `<!doctype html><meta charset="utf-8"><title>TG style</title><body style="font:18px system-ui;padding:24px;background:#fff">
<script>
// What the app's own first script sees on its parent page (TG style reads parent.WizLive exactly like this).
window.seen = (() => { try { const P = parent; return { live: !!P.WizLive, chat: !!P.WosChat, models: !!P.WosModels, uploads: !!P.WizUploads, bell: !!P.WosBell }; } catch (_) { return null; } })();
</script>
<h1>TG style (stand-in)</h1><p id="state"></p>
<script src="/wizard-os-home/core/app-client.js"></script><script>
document.getElementById('state').textContent = window.seen?.live ? 'Wizard chats are here' : 'Open Telegram from Wizard';
WizardApp.ready?.();
</script></body>`;
fs.mkdirSync(out, { recursive: true });
const nap = ms => new Promise(r => setTimeout(r, ms));
const SESSION = { id: 'qa-thread-1', title: 'Synthetic thread', source: 'wizard', started_at: 1, last_active: 2, message_count: 0 };

async function open(browser, page_) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await ctx.routeWebSocket('**/*', w => w.close());
  await ctx.addInitScript(([apps]) => {
    if (window !== top) return;
    localStorage.setItem('wux.apps.v1', JSON.stringify(apps));
    for (const [k, v] of Object.entries({ 'wos.shell': 'phone', 'wux.shell': 'phone', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': 'nebula' })) localStorage.setItem(k, v);
  }, [[APP]]);
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
    if (u.origin !== origin) return r.abort();
    if (p.startsWith(APP.url)) {
      if (!TG) return r.fulfill({ body: PAGE, contentType: 'text/html' });
      const f = p.slice(APP.url.length) || 'index.html', abs = path.resolve(TG, f);
      if (abs.startsWith(path.resolve(TG) + path.sep) && fs.existsSync(abs)) return r.fulfill({ path: abs });
      return r.fulfill({ json: {} });
    }
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
    if (p === '/wizard/v1/bootstrap') return r.fulfill({ json: { bootstrap: 1, capabilities: {}, endpoints: {}, settings: {} } });
    if (p === '/wizard/v1/apps') return r.fulfill({ json: { apps: [APP] } });
    if (p === '/wizard/v1/setup') return r.fulfill({ json: { first_run: false } });
    if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
    if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: [SESSION], has_more: false } });
    if (p.startsWith('/wizard/hermes/api/sessions/')) return r.fulfill({ json: { session: SESSION, messages: [], data: [], has_more: false } });
    return r.fulfill({ json: ownerRead(p) });
  });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  // The slim pin page stops the shell's own load (window.stop()), so it never fires load: wait for the commit there.
  await page.goto(origin + prefix + page_ + '?app-session=' + APP.id, { waitUntil: page_ === 'index.html' ? 'commit' : 'load' });
  await page.locator('iframe.appframe').first().waitFor({ timeout: 30000 });
  await nap(TG ? 3500 : 1500);
  const frame = page.frames().find(f => f.url().includes(APP.url));
  const services = await page.evaluate(() => Object.keys(window).filter(k => /^(Wiz|Wos)[A-Z]/.test(k) && window[k] != null).sort());
  return { ctx, page, frame, errors, services };
}

(async () => {
  const browser = await chromium.launch(), report = {};
  try {
    // Slim pin page (issue 1584, issue 1696): the app's first script sees the same chat services.
    const slim = await open(browser, 'index.html');
    const full = slim;
    report.full = { services: full.services.length, errors: full.errors };
    report.slim = { pinDoc: await slim.page.evaluate(() => document.documentElement.dataset.pinDoc === '1'), errors: slim.errors };
    await slim.page.screenshot({ path: path.join(out, `app-session-2-slim${TG ? '-tg' : ''}.png`) });
    if (!TG) {
      report.slim.seen = await slim.frame.evaluate(() => window.seen);
      report.slim.host = await slim.page.evaluate(() => ({ chats: !!window.WizChatsHost, viewer: !!window.WosChat?.viewer, audio: !!window.WizBackgroundAudio }));
      report.slim.back = await slim.page.evaluate(() => window.__wosNativeBack());
    } else {
      report.slim.tgOff = await slim.frame.evaluate(() => !!document.querySelector('.tg-off'));
    }
    await slim.ctx.close();
    const one = await open(browser, 'app-session.html');
    // Not services for an app: core/pin-doc.js is not on this page (and the slim pin page never runs kind-s scripts,
    // which do nothing in a one-app session anyway: core/pin-doc.js FILES).
    const NOT_SERVICES = ['WizPinDoc', 'WosCreateOrbSwitcher', 'WosSetupLaunch', 'WosWelcome'];
    const missing = full.services.filter(k => !one.services.includes(k) && !NOT_SERVICES.includes(k));
    await one.page.screenshot({ path: path.join(out, `app-session-1-open${TG ? '-tg' : ''}.png`) });
    report.session = { services: one.services.length, missing, errors: one.errors };
    if (!TG) {
      report.session.seen = await one.frame.evaluate(() => window.seen);
      report.session.host = await one.page.evaluate(() => ({ chats: !!window.WizChatsHost, viewer: !!window.WosChat?.viewer, audio: !!window.WizBackgroundAudio }));
      report.session.back = await one.page.evaluate(() => window.__wosNativeBack());
    } else {
      report.session.tgOff = await one.frame.evaluate(() => !!document.querySelector('.tg-off'));
    }
    await one.ctx.close();
    console.log(JSON.stringify(report, null, 1));
    fs.writeFileSync(path.join(out, 'app-session-report.json'), JSON.stringify(report, null, 1));
    assert.deepEqual(missing, [], 'app-session.html holds every service the full shell holds');
    assert.deepEqual(one.errors, [], 'app-session.html: no page errors');
    if (TG) assert.equal(report.session.tgOff, false, 'TG style works on its own');
    else {
      assert.deepEqual(report.session.seen, { live: true, chat: true, models: true, uploads: true, bell: true }, "the app's first script sees the chat services");
      assert.deepEqual(report.session.host, { chats: true, viewer: true, audio: true }, 'Chats host, media viewer and background audio are there');
      assert.equal(report.session.back, 'root', 'Back at the app root is consumed, as before');
    }
    assert.equal(report.slim.pinDoc, true, 'the slim pin page is on');
    assert.deepEqual(slim.errors, [], 'slim pin page: no page errors');
    if (TG) assert.equal(report.slim.tgOff, false, 'TG style works on the slim pin page');
    else {
      assert.deepEqual(report.slim.seen, { live: true, chat: true, models: true, uploads: true, bell: true }, "slim pin page: the app's first script sees the chat services");
      assert.deepEqual(report.slim.host, { chats: true, viewer: true, audio: true }, 'slim pin page: Chats host, media viewer and background audio');
      assert.equal(report.slim.back, 'root', 'slim pin page: Back at the app root is consumed');
    }
    console.log('PASS');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
