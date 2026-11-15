'use strict';
// A chat link to a page inside an installed app keeps its #fragment (wizard-ux issue 1453: Oscar's
// /wizardos-tracker/#item/<owner>/<repo>/<n> opened the Tracker inside Wizard at its list, never the item: the desktop
// link route saw "the app's own address" and opened the app plainly, dropping the hash). Real browser, desktop at
// 1280x800, both views (QA_VIEWS=ai-apps,classic), the Tracker window already open on its own desk or not open
// (QA_STARTS=open,closed), a disposable synthetic transport (no box is read or written) and a stand-in Tracker page that
// records its hash on load and on hashchange (the links sit in an earlier reply, so Desks opens no view beside the thread). Tap item 627 -> the Tracker's window is at #item/…/627; then tap item 628
// -> the same window switches to it (a hashchange, no second window). QA_EXPECT=broken (QA_WEB=<main worktree>/web)
// asserts main lands on the list with no hash.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://app-link-hash.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'app-link-hash-evidence');
const VIEWS = (process.env.QA_VIEWS || 'ai-apps,classic').split(',');
const STARTS = (process.env.QA_STARTS || 'open,closed').split(',');
const EXPECT = process.env.QA_EXPECT || 'fixed';
const TRACKER = { id: 'wizardos-tracker', name: 'Tracker', url: '/wizardos-tracker/', source: 'apps.json', type: 'view', kind: 'wizard', status: 'running' };
const ITEM = n => `/wizardos-tracker/#item/humanitylabs-org/wizard-os/${n}`;
const PAGE = `<!doctype html><meta charset="utf-8"><title>Tracker</title><body style="font:16px system-ui;padding:24px">
<h1>Tracker (stand-in)</h1><p id="at"></p><script>
window.seen = [{ on: 'load', hash: location.hash }];
const show = () => { document.getElementById('at').textContent = location.hash ? 'Item open: ' + location.hash.slice(1) : 'List (no item open)'; };
addEventListener('hashchange', () => { seen.push({ on: 'hashchange', hash: location.hash }); show(); }); show();
</script></body>`;
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const ROW = { id: 'qa-t1', title: 'Tracker items', runtime: 'direct', status: 'completed', updated_at: iso(now - 36e5), updatedAt: iso(now - 36e5), last_active: (now - 36e5) / 1000, message_count: 4, messageCount: 4, archived: false, preview: 'Two items' };
const REPLY = `Here are the two items: [item 627](${ITEM(627)}) and [item 628](${ITEM(628)}).`;
const DESK = start => {
  const wins = { wqa0: { id: 'wqa0', app: 'chats', thread: 'qa-t1' } }, ws = [{ id: 'dqa0', wins: ['wqa0'], focus: 'wqa0', mono: false }];
  if (start === 'open') { wins.wqa1 = { id: 'wqa1', app: 'frame', appId: TRACKER.id, url: TRACKER.url, title: 'Tracker' }; ws.push({ id: 'dqa1', wins: ['wqa1'], focus: 'wqa1', mono: false }); }
  return { wins, ws, cur: 0 };
};
const report = { origin, web, cases: [] };
(async () => {
  const browser = await chromium.launch();
  try {
    for (const view of VIEWS) for (const start of STARTS) {
      const stem = `app-link-hash-${view}-${start}-${EXPECT}`, entry = { stem, errors: [], refused: [] }; report.cases.push(entry);
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
      try {
        await context.routeWebSocket('**/*', w => w.close());
        await context.addInitScript(({ view, desk, app }) => {
          if (window !== top) return;
          if (sessionStorage.getItem('qaBoot')) return; sessionStorage.setItem('qaBoot', '1');
          localStorage.setItem('wux.desk.wins', JSON.stringify(desk.wins)); localStorage.setItem('wux.desk.ws', JSON.stringify(desk.ws));
          localStorage.setItem('wux.desk.cur', String(desk.cur)); localStorage.setItem('wux.desk.layoutVersion', '2'); localStorage.setItem('wux.desk.homeOpen', 'false');
          localStorage.setItem('wux.apps.v1', JSON.stringify([app]));
          for (const [k, v] of Object.entries({ 'wos.shell': 'desktop', 'wux.shell': 'desktop', 'wos.desktop-view.v1': view, 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': 'nebula',
            'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix: { 'wizard/desktop-chats': true } }) })) localStorage.setItem(k, v);
        }, { view, desk: DESK(start), app: TRACKER });
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
          if (u.origin !== origin) { entry.refused.push({ method, url: q.url(), reason: 'external' }); return r.abort(); }
          if (p === TRACKER.url || p === TRACKER.url + 'index.html') return r.fulfill({ body: PAGE, contentType: 'text/html' });
          if (p.startsWith(TRACKER.url)) return r.fulfill({ json: {} });
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
          if (p === '/wizard/v1/apps') return r.fulfill({ json: { apps: [TRACKER] } });
          if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: [ROW], has_more: false } });
          const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
          if (m) { if (decodeURIComponent(m[1]) !== ROW.id) return r.fulfill({ status: 404, json: { error: 'missing' } });
            return r.fulfill({ json: m[2] ? { messages: [{ role: 'user', content: 'Which Tracker items are open?', timestamp: now / 1000 - 600 }, { role: 'assistant', content: REPLY, timestamp: now / 1000 - 590 }, { role: 'user', content: 'Thanks', timestamp: now / 1000 - 580 }, { role: 'assistant', content: 'You are welcome.', timestamp: now / 1000 - 570 }] } : { session: ROW } }); }
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + prefix + 'desktop.html');
        await page.waitForFunction(() => window.__wux && !window.WosWelcome?.active && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy);
        await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
        if (view === 'ai-apps') await page.waitForFunction(() => document.documentElement.dataset.layout === 'ai-apps', null, { timeout: 15000 });
        const link = n => page.locator(`.bub a[href="${ITEM(n)}"]`).filter({ visible: true }).first();
        await link(627).waitFor({ timeout: 15000 });
        await nap(1200);
        const tracker = async () => {
          const frames = page.frames().filter(f => new URL(f.url() || 'about:blank', origin).pathname === TRACKER.url);
          const rows = [];
          for (const f of frames) rows.push(await f.evaluate(() => ({ hash: location.hash, seen: window.seen || [] })).catch(() => null));
          return { windows: frames.length, rows: rows.filter(Boolean) };
        };
        const at = async want => { for (let i = 0; i < 40; i++) { const t = await tracker(); if (t.rows.some(r => r.hash === want)) return t; await nap(150); } return tracker(); };
        entry.before = await tracker();
        await link(627).click();
        entry.first = await at('#item/humanitylabs-org/wizard-os/627');
        await nap(800); entry.first = await tracker();
        await page.screenshot({ path: path.join(out, stem + '-1-item-627.png') });
        if (EXPECT === 'broken') {
          assert.ok(entry.first.windows >= 1, 'main: the Tracker opens: ' + JSON.stringify(entry.first));
          assert.ok(entry.first.rows.every(r => r.hash === ''), 'main: the Tracker is at its list, no item: ' + JSON.stringify(entry.first));
          entry.pass = true; continue;
        }
        assert.equal(entry.first.windows, 1, 'one Tracker window: ' + JSON.stringify(entry.first));
        assert.equal(entry.first.rows[0].hash, '#item/humanitylabs-org/wizard-os/627', 'the Tracker is at item 627: ' + JSON.stringify(entry.first));
        // the second link while the first item is open: the same window switches (the app gets a hashchange)
        const loads = entry.first.rows[0].seen.filter(s => s.on === 'load').length;
        // (Desks: the link took the owner to the Tracker's desk; back to the chat's desk, as ⌥← does)
        if (!(await link(628).isVisible().catch(() => false))) await page.evaluate(() => { const i = window.__wux.ws.findIndex(d => d.wins.includes('wqa0')); if (i >= 0) window.__wux.goWs(i); });
        await link(628).click();
        entry.second = await at('#item/humanitylabs-org/wizard-os/628');
        await page.screenshot({ path: path.join(out, stem + '-2-item-628.png') });
        assert.equal(entry.second.windows, 1, 'still one Tracker window: ' + JSON.stringify(entry.second));
        assert.equal(entry.second.rows[0].hash, '#item/humanitylabs-org/wizard-os/628', 'the Tracker switched to item 628: ' + JSON.stringify(entry.second));
        assert.equal(entry.second.rows[0].seen.filter(s => s.on === 'load').length, loads, 'no reload: the app got a hashchange: ' + JSON.stringify(entry.second));
        assert.equal(entry.errors.length, 0, 'browser errors: ' + entry.errors.join('; '));
        entry.pass = true;
      } catch (e) { entry.failure = e.stack; const pages = context.pages(); if (pages[0]) await pages[0].screenshot({ path: path.join(out, stem + '-failure.png') }).catch(() => {}); }
      finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await context.close(); }
    }
  } finally { await browser.close(); }
  const failed = report.cases.filter(c => !c.pass);
  console.log(JSON.stringify({ expect: EXPECT, cases: report.cases.length, passed: report.cases.length - failed.length, failed: failed.map(c => c.stem + ': ' + String(c.failure).split('\n').slice(0, 2).join(' | ')) }));
  if (failed.length || report.cases.length !== VIEWS.length * STARTS.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
