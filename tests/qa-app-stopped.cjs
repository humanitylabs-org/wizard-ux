'use strict';
// A stopped app says so in its window (wizard-ux issue 1464: Robert opened Messenger after a failed update left it
// stopped and saw a completely blank white page). Real Chromium, a disposable synthetic transport (no box is read or
// written), Messenger's address answering like Tailscale Serve with nothing behind it: HTTP 502, empty body.
// Cases (QA_CASES=phone,desktop): the phone shell opens Messenger; the classic desktop restores a Messenger window.
// Fixed: the window says "Messenger is stopped." with Start (wizard-ux issue 1475); Start calls the App Manager's
// stand-in owner route POST store-install/_start/messenger, polls it to `running`, and the window loads Messenger.
// QA_EXPECT=broken (QA_WEB=<main worktree>/web) asserts main shows an empty page and no message.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://app-stopped.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'app-stopped-evidence');
const CASES = (process.env.QA_CASES || 'phone,desktop').split(',');
const EXPECT = process.env.QA_EXPECT || 'fixed';
const APP = { id: 'messenger', name: 'Messenger', url: '/messenger/', source: 'apps.json', type: 'view', kind: 'wizard', status: 'running' };
const PAGE = '<!doctype html><meta charset="utf-8"><title>Messenger</title><body style="font:16px system-ui;padding:24px;background:#fff"><h1 id="up">Messenger (stand-in)</h1></body>';
fs.mkdirSync(out, { recursive: true });
const nap = ms => new Promise(r => setTimeout(r, ms));
const report = { origin, web, expect: EXPECT, cases: [] };
(async () => {
  const browser = await chromium.launch();
  try {
    for (const kind of CASES) {
      const stem = `app-stopped-${kind}-${EXPECT}`, entry = { stem, errors: [], refused: [], starts: [] }; report.cases.push(entry);
      const phone = kind === 'phone';
      const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 }, serviceWorkers: 'block', ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
      let up = false;
      try {
        await context.routeWebSocket('**/*', w => w.close());
        await context.addInitScript(({ phone, app }) => {
          if (window !== top) return;
          if (sessionStorage.getItem('qaBoot')) return; sessionStorage.setItem('qaBoot', '1');
          const shell = phone ? 'phone' : 'desktop';
          localStorage.setItem('wux.apps.v1', JSON.stringify([app]));
          if (!phone) {
            localStorage.setItem('wux.desk.wins', JSON.stringify({ wqa1: { id: 'wqa1', app: 'frame', appId: app.id, url: app.url, title: app.name } }));
            localStorage.setItem('wux.desk.ws', JSON.stringify([{ id: 'dqa1', wins: ['wqa1'], focus: 'wqa1', mono: false }]));
            localStorage.setItem('wux.desk.cur', '0'); localStorage.setItem('wux.desk.layoutVersion', '2'); localStorage.setItem('wux.desk.homeOpen', 'false');
          }
          for (const [k, v] of Object.entries({ 'wos.shell': shell, 'wux.shell': shell, 'wos.desktop-view.v1': 'classic', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': 'nebula' })) localStorage.setItem(k, v);
        }, { phone, app: APP });
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
          if (u.origin !== origin) { entry.refused.push({ method, url: q.url(), reason: 'external' }); return r.abort(); }
          if (p.startsWith(APP.url)) return up ? r.fulfill({ body: PAGE, contentType: 'text/html' }) : r.fulfill({ status: 502, body: '' });
          if (p === prefix + 'store-install/_start/messenger') {
            entry.starts.push({ method, body: q.postData(), store: q.headers()['x-wizard-store'] || '' });
            if (method === 'POST') return r.fulfill({ status: 202, json: { app: 'messenger', state: 'starting', status: 'stopped' } });
            up = true; return r.fulfill({ json: { app: 'messenger', state: 'running', status: 'running' } });
          }
          if (!['GET', 'HEAD'].includes(method)) {
            if (method === 'PUT' && p === '/wizard/thread-seen') return r.fulfill({ json: { ok: true, state: q.postDataJSON() } });
            if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
            entry.refused.push({ method, path: p, reason: 'unexpected-write' }); return r.fulfill({ status: 405, json: { error: 'Synthetic fixture refuses this write' } });
          }
          if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
          if (p.startsWith(prefix)) {
            const f = decodeURIComponent(p.slice(prefix.length) || 'index.html'), abs = path.resolve(web, f);
            if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
            if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return r.fulfill({ path: abs });
            return r.fulfill({ status: 404, body: 'No synthetic static asset' });
          }
          if (p === '/wizard/v1/apps') return r.fulfill({ json: { apps: [APP] } });
          if (p === '/wizard/v1/setup') return r.fulfill({ json: { first_run: false } });
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: [], has_more: false } });
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
        await page.waitForFunction(phone => (phone ? window.__wos : window.__wux) && !window.WosWelcome?.active, phone, { timeout: 20000 });
        await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
        if (phone) await page.evaluate(() => window.WizOpenApp('messenger'));
        const frame = page.locator('iframe[data-own-app="messenger"]').filter({ visible: true }).first();
        await frame.waitFor({ timeout: 15000 });
        await nap(2500);
        const panel = page.locator('.wos-app-stopped').filter({ visible: true });
        entry.panel = await panel.count();
        entry.frameText = await page.evaluate(() => { try { return document.querySelector('iframe[data-own-app="messenger"]').contentDocument.body?.innerText || ''; } catch (e) { return 'x:' + e.name; } });
        await page.screenshot({ path: path.join(out, stem + '-1-stopped.png') });
        if (EXPECT === 'broken') {
          assert.equal(entry.panel, 0, 'main: no message in the window');
          assert.equal(entry.frameText.trim(), '', 'main: the app window is an empty page');
          entry.pass = true; continue;
        }
        assert.equal(entry.panel, 1, 'the window says the app is stopped');
        const text = await panel.innerText();
        assert.match(text, /Messenger is stopped\./); assert.doesNotMatch(text, /Ask your Wizard/);
        // Start starts it through the App Manager route and the window loads Messenger by itself.
        await panel.getByRole('button', { name: 'Start' }).click();
        await page.frameLocator('iframe[data-own-app="messenger"] >> visible=true').locator('#up').waitFor({ timeout: 10000 });
        await nap(600);
        assert.equal(await page.locator('.wos-app-stopped').count(), 0, 'the message goes once Messenger answers');
        assert.deepEqual(entry.starts.map(x => x.method), ['POST', 'GET'], 'POST the start, then GET the job');
        assert.equal(entry.starts[0].body, '{}'); assert.equal(entry.starts[0].store, '1');
        await page.screenshot({ path: path.join(out, stem + '-2-started.png') });
        assert.equal(entry.errors.length, 0, 'browser errors: ' + entry.errors.join('; '));
        entry.pass = true;
      } catch (e) { entry.failure = e.stack; const pages = context.pages(); if (pages[0]) await pages[0].screenshot({ path: path.join(out, stem + '-failure.png') }).catch(() => {}); }
      finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await context.close(); }
    }
  } finally { await browser.close(); }
  const failed = report.cases.filter(c => !c.pass);
  for (const c of report.cases) console.log(`${c.pass ? 'PASS' : 'FAIL'} ${c.stem}${c.failure ? '\n' + c.failure : ''}`);
  if (failed.length) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
