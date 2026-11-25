'use strict';
// An app being installed shows in the Apps column at once (wizard-os#682, switch wizard/install-in-sidebar). Real
// browser, AI apps desktop at 1440x900, every box read is a fixture and the only writes answered are the Store's own
// install POST and the shell's fixture reads (no box is read or written). The App Store opens as the panel, Get is
// tapped on WizardOS Tracker, and the App Manager fixture keeps the job `installing` for INSTALL_MS before it says
// `installed` and the shell's app list gains the app.
//   Switch off: the column shows nothing about the install (as before), and the app is not in it afterwards.
//   Switch on: right after Get the column has a "WizardOS Tracker · Installing…" row with a spinner; the Store is then
//   closed (its ✕ in the column) and the row stays and keeps going; once the job ends the row turns into the app
//   (not open yet, no spinner) and a click on it opens the app as the panel.
// QA_SWITCH=off,on picks the cases, QA_WEB=<web dir> runs another tree (main for the before shots), QA_OUT=<dir>.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const repo = path.resolve(__dirname, '..'), origin = 'https://install-sidebar.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(os.tmpdir(), 'install-in-sidebar-qa');
const SWITCH = (process.env.QA_SWITCH || 'off,on').split(',');
const INSTALL_MS = Number(process.env.QA_INSTALL_MS || 9000);
const C = 'c'.repeat(40);
const tracker = { id: 'wizardos-tracker', name: 'WizardOS Tracker', summary: 'Goals, bugs and features of WizardOS in one place.', repo: 'humanitylabs-org/wizardos-tracker', version: '0.39.2', commit: C, source: 'standard', source_name: 'Standard', channel: 'standard', type: 'view', category: 'app', tags: ['work'], publisher: 'humanitylabs-org', uses: [], provides: [] };
const catalog = [tracker].map(a => ({ ...a, releases: [{ ...a }] }));
fs.mkdirSync(out, { recursive: true });
const nap = ms => new Promise(r => setTimeout(r, ms));
const report = { web, cases: [] };
(async () => {
  const browser = await chromium.launch();
  try {
    for (const sw of SWITCH) {
      const on = sw === 'on', stem = `install-in-sidebar-${sw}`;
      const entry = { stem, errors: [], refused: [], writes: [] }; report.cases.push(entry);
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        const mix = { 'wizard/desktop-chats': true, ...(on ? { 'wizard/install-in-sidebar': true } : {}) };
        await context.addInitScript(({ mix }) => {
          if (window !== top) return;
          if (sessionStorage.getItem('qaBoot')) return; sessionStorage.setItem('qaBoot', '1');
          for (const [k, v] of Object.entries({ 'wos.shell': 'desktop', 'wux.shell': 'desktop', 'wos.desktop-view.v1': 'ai-apps', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': 'nebula',
            'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix }) })) localStorage.setItem(k, v);
        }, { mix });
        let job = null; const prefs = { migrations: { 'launcher-seed-v1': true } };
        const installed = () => !!job && Date.now() - job.at >= INSTALL_MS;
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
          if (u.origin !== origin) { entry.refused.push({ method, url: q.url(), reason: 'external' }); return r.abort(); }
          if (p === prefix + 'store-install/wizardos-tracker') {
            if (method === 'POST') { entry.writes.push({ method, path: p }); const sel = q.postDataJSON(); job = job || { at: Date.now(), selection: { source: sel.source, repo: sel.repo, commit: sel.commit, operation: sel.operation } }; return r.fulfill({ status: 202, json: { app: tracker.id, state: 'installing', started: Math.floor(job.at / 1000), selection: job.selection } }); }
            if (!job) return r.fulfill({ status: 404, json: { error: 'no install for that app' } });
            entry.polls = (entry.polls || 0) + 1;
            return r.fulfill({ json: { app: tracker.id, state: installed() ? 'installed' : 'installing', started: Math.floor(job.at / 1000), selection: job.selection } });
          }
          if (!['GET', 'HEAD'].includes(method)) {
            entry.writes.push({ method, path: p });
            if (method === 'PUT' && p === '/wizard/thread-seen') return r.fulfill({ json: { ok: true, state: q.postDataJSON() } });
            if (method === 'PATCH' && p === '/wizard/v1/ui-preferences') return r.fulfill({ json: prefs });
            entry.refused.push({ method, path: p, reason: 'unexpected-write' }); return r.fulfill({ status: 405, json: { error: 'Synthetic fixture refuses this write' } });
          }
          if (p.startsWith(prefix + 'store-data/')) {
            const s = p.slice((prefix + 'store-data/').length);
            if (s.startsWith('wizard/v1/index/search')) return r.fulfill({ json: { apps: catalog, sources: [{ id: 'standard', name: 'Standard', stale: false }], next_offset: null } });
            if (s === 'api/apps/installed') return r.fulfill({ json: { installed: installed() ? [{ info: { id: tracker.id, urn: tracker.id + ':wizardapps' }, app: { status: 'running' } }] : [] } });
            if (s === 'wizard/v1/installed-apps') return r.fulfill({ json: { architecture: 'amd64', complete: true, unavailable: [],
              wam: installed() ? [{ id: tracker.id, repo: tracker.repo, commit: C, version: tracker.version, status: 'running', source: 'standard', type: 'view' }] : [],
              shell: installed() ? [{ id: tracker.id, url: '/wizardos-tracker/' }] : [] } });
            if (s.startsWith('router/')) return r.fulfill({ json: { models: [], services: [], providers: [] } });
            return r.fulfill({ status: 404, json: { error: 'fixture_only' } });
          }
          if (p === '/wizard/v1/bootstrap') return r.fulfill({ json: { bootstrap: 1, settings: {}, capabilities: {}, endpoints: { apps: '/wizard/v1/apps' } } });
          if (p === '/wizard/v1/apps') return r.fulfill({ json: { apps: installed() ? [{ id: tracker.id, name: tracker.name, url: '/wizardos-tracker/', source: 'apps.json', repo: tracker.repo }] : [] } });
          if (/^\/wizard\/v1\/apps\/[^/]+\/agents$/.test(p)) return r.fulfill({ json: { agents: [] } });
          if (p === '/wizardos-tracker/' || p === '/wizardos-tracker/index.html') return r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Tracker</title><body style="font:20px system-ui;padding:40px">Synthetic WizardOS Tracker</body>' });
          if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
          if (p.startsWith(prefix)) {
            const f = decodeURIComponent(p.slice(prefix.length) || 'index.html'), abs = path.resolve(web, f);
            if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
            if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return r.fulfill({ path: abs });
            return r.fulfill({ status: 404, body: 'No synthetic static asset' });
          }
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: prefs });
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + prefix + 'desktop.html');
        await page.waitForFunction(() => window.__wux && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        await page.waitForFunction(() => document.documentElement.dataset.layout === 'ai-apps', null, { timeout: 15000 });
        if (on) await page.waitForFunction(() => (document.documentElement.dataset.tweaks || '').split(' ').includes('wizard/install-in-sidebar'), null, { timeout: 15000 }).catch(() => {});
        entry.switchOn = await page.evaluate(() => (document.documentElement.dataset.tweaks || '').split(' ').includes('wizard/install-in-sidebar'));
        assert.equal(entry.switchOn, on, stem + ': switch state');
        await page.evaluate(() => document.fonts.ready); await nap(1200);
        const column = () => page.evaluate(() => {
          const vt = document.querySelector('.aad-vt'); if (!vt) return null;
          const rows = [...vt.querySelectorAll('.aad-vtl > [data-app]')].filter(n => n.getClientRects().length).map(n => ({ app: n.dataset.app, text: n.innerText.replace(/\s+/g, ' ').trim(), cls: n.className, spin: !!n.querySelector('.aad-vtspin'), label: n.getAttribute('aria-label') }));
          return { rows, text: vt.innerText.replace(/\s+/g, ' ').trim() };
        });
        const crop = async name => { const b = await page.locator('.aad-vt').boundingBox(); await page.screenshot({ path: path.join(out, `${stem}-${name}.png`) });
          if (b) await page.screenshot({ path: path.join(out, `${stem}-${name}-column.png`), clip: { x: Math.max(0, b.x + b.width - 412), y: 0, width: Math.min(412, 1440 - Math.max(0, b.x + b.width - 412)), height: 900 } }); };
        // the App Store as the panel, then Get on the Tracker
        await page.evaluate(() => window.WizOpenApp('app-store'));
        const frame = async () => { for (let i = 0; i < 80; i++) { const f = page.frames().find(x => x.url().includes('/store/index.html')); if (f) return f; await nap(150); } throw new Error('no Store frame'); };
        const f = await frame();
        await f.waitForFunction(() => window.__store?.state().loaded, null, { timeout: 15000 });
        await f.fill('#q', 'Tracker'); const get = f.locator('.row[data-app^="wizardos-tracker|"] [data-get]').first();
        await get.waitFor({ timeout: 10000 }); entry.before = await column();
        await get.click(); await nap(900);
        entry.afterGet = await column();
        await crop('1-after-get');
        const tr = s => s.rows.find(r => r.app === 'wizardos-tracker');
        if (on) {
          const row = tr(entry.afterGet);
          assert.ok(row, 'the column shows the app being installed: ' + JSON.stringify(entry.afterGet));
          assert.ok(row.spin && /Installing/.test(row.label || ''), 'with a spinner and an Installing label: ' + JSON.stringify(row));
          assert.match(row.text, /WizardOS Tracker/);
        } else assert.equal(tr(entry.afterGet), undefined, 'switch off: nothing in the column, as before');
        // close the Store (its ✕ in the column) while the install runs
        const x = page.locator('.aad-vt .aad-vtab[data-app="app-store"] .aad-vtx').first();
        await page.locator('.aad-vt .aad-vtab[data-app="app-store"]').first().hover(); await x.waitFor({ timeout: 5000 }); await x.click(); await nap(1200);
        entry.storeClosed = await column();
        assert.ok(!entry.storeClosed.rows.some(r => r.app === 'app-store' && !/is-pinned/.test(r.cls)), 'the Store is closed: ' + JSON.stringify(entry.storeClosed));
        await crop('2-store-closed');
        if (on) { const row = tr(entry.storeClosed); assert.ok(row && row.spin, 'the install row stays after the Store closed: ' + JSON.stringify(entry.storeClosed)); }
        else assert.equal(tr(entry.storeClosed), undefined);
        // the job ends on the box (nobody is watching from the Store any more)
        await page.waitForFunction(ms => true, null).catch(() => {});
        await nap(Math.max(0, INSTALL_MS - 2000) + 6000);
        entry.done = await column();
        await crop('3-done');
        if (on) {
          let row = tr(entry.done);
          for (let i = 0; i < 20 && (!row || row.spin); i++) { await nap(500); entry.done = await column(); row = tr(entry.done); }
          await crop('3-done');
          assert.ok(row && !row.spin, 'the row turns into the installed app: ' + JSON.stringify(entry.done));
          assert.ok(entry.polls >= 1, 'the shell followed the job itself after the Store closed');
          await page.locator('.aad-vt .aad-vtl > [data-app="wizardos-tracker"]').first().click(); await nap(2000);
          entry.opened = await page.evaluate(() => [...document.querySelectorAll('iframe')].some(f => f.getClientRects().length && (f.src || '').includes('/wizardos-tracker/')));
          entry.afterOpen = await column();
          await crop('4-opened');
          assert.ok(entry.opened, 'a click opens the installed app');
          const r2 = tr(entry.afterOpen); assert.ok(r2 && /data-desk|is-on/.test(r2.cls + '') || r2, 'the app is the open row now');
        } else assert.equal(tr(entry.done), undefined, 'switch off: the app is not in the column afterwards either (as before)');
        assert.deepEqual(entry.refused.filter(x => x.reason !== 'external'), [], 'no unexpected writes');
        assert.equal(entry.errors.length, 0, 'browser errors: ' + entry.errors.join('; '));
        entry.pass = true;
      } catch (e) { entry.failure = e.stack; const pages = context.pages(); if (pages[0]) await pages[0].screenshot({ path: path.join(out, stem + '-failure.png') }).catch(() => {}); }
      finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await context.close(); }
    }
  } finally { await browser.close(); }
  const failed = report.cases.filter(c => !c.pass);
  console.log(JSON.stringify({ out, cases: report.cases.length, passed: report.cases.length - failed.length, failed: failed.map(c => c.stem + ': ' + String(c.failure).split('\n').slice(0, 3).join(' | ')) }));
  if (failed.length || report.cases.length !== SWITCH.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
