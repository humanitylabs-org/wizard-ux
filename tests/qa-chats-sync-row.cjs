'use strict';
// The Chats "Not up to date" notice is one quiet row with an inline Troubleshoot text action (James, 7 Nov 2026:
// "a single row instead of a big pill button that knocks the whole UX down a few centimeters"). Real shell in
// Chromium against a disposable synthetic transport: no owner API reads or writes, every unexpected write refused.
// Per skin (Nebula, Grove) and shell (phone 390x844 Classic, desktop 1440x960 Classic Chats window): the healthy list
// (no notice) and the same list after a failed read (offline), one screenshot each. Asserts the notice is a single row
// no taller than a section header, the list moves down by that one row only, the action sits at the row's right end
// with a 44px touch target and no pill fill/border, no .pbtn in the row, and tapping it opens the Troubleshooter.
// (AI apps draws no copy of this notice; its sidebar has no sync bar, so the shared Chats list is the only surface.)
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://sync-row.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'sync-row-evidence');
fs.mkdirSync(out, { recursive: true });
const SHELLS = ['phone', 'desktop'], SKINS = ['nebula', 'grove'];
const EXPECTED_CASES = SHELLS.length * SKINS.length;
const report = { origin, web, cases: [] }, now = Date.now();
const iso = t => new Date(t).toISOString();
const rows = () => [
  ['qa-working', 'Synthetic working', 'running', 60e3], ['qa-ready', 'Synthetic ready', 'completed', 120e3],
  ['qa-ready-2', 'Synthetic second ready', 'completed', 300e3], ['qa-archived', 'Synthetic archived', 'completed', 240e3, true],
].map(([id, title, status, ago, archived]) => ({ id, title, runtime: 'direct', status, updated_at: iso(now - ago), updatedAt: iso(now - ago), lastAssistantAt: iso(now - ago), message_count: 2, messageCount: 2, archived: !!archived }));
(async () => {
  const browser = await chromium.launch();
  try {
    for (const shell of SHELLS) for (const skin of SKINS) {
      const phone = shell === 'phone', stem = `${shell}-${skin}`;
      const entry = { stem, errors: [], refused: [], writes: [] }; report.cases.push(entry);
      const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 960 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', ...(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' } : {}) });
      let down = false;
      try {
        await context.routeWebSocket('**/*', w => w.close());
        await context.addInitScript(({ shell, skin }) => {
          if (window !== top) return;
          for (const [k, v] of Object.entries({ 'wos.shell': shell, 'wos.desktop-view.v1': 'classic', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin, 'wos.chats.layout.v1': 'status' })) localStorage.setItem(k, v);
        }, { shell, skin });
        await context.route('**/*', async r => {
          const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
          if (u.origin !== origin) { entry.refused.push({ method, url: q.url(), reason: 'external' }); return r.abort(); }
          if (!['GET', 'HEAD'].includes(method)) {
            entry.writes.push({ method, path: p });
            if (method === 'PUT' && p === '/wizard/thread-seen') return r.fulfill({ json: { ok: true, state: q.postDataJSON() } });
            entry.refused.push({ method, path: p, reason: 'unexpected-write' }); return r.fulfill({ status: 405, json: { error: 'Synthetic fixture refuses this write' } });
          }
          // Offline: Wizard and its Troubleshooter probe are unreachable (network error), as on James's phone.
          if (down && (p.startsWith('/wizard/') || p.startsWith('/troubleshoot'))) return r.abort('internetdisconnected');
          if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
          if (p.startsWith(prefix)) {
            const f = decodeURIComponent(p.slice(prefix.length) || 'index.html'), abs = path.resolve(web, f);
            if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
            if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return r.fulfill({ path: abs });
            return r.fulfill({ status: 404, body: 'No synthetic static asset' });
          }
          if (p.startsWith('/troubleshoot')) return r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Troubleshooter</title><p>Synthetic Troubleshooter</p>' });
          if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true }, chatLayout: 'status' } });
          if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: rows(), has_more: false } });
          return r.fulfill({ json: ownerRead(p) });
        });
        const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
        await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
        await page.waitForFunction(() => (window.__wux || window.__wos) && !window.WosWelcome?.active && !window.WosExperience?.state.busy);
        assert.equal(await page.evaluate(() => document.documentElement.dataset.shell), shell);
        await page.evaluate(phone => phone ? __wos.openSheet('inbox') : __wux.openChatsList(), phone);
        const list = '.ch-list:visible';
        await page.locator(list + ' .ch-sec .ch-sec-h').first().waitFor({ timeout: 10000 });
        await page.waitForFunction(() => !WizLive.loading, null, { timeout: 10000 });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(400);
        const geo = () => page.evaluate(() => {
          const L = [...document.querySelectorAll('.ch-list')].find(n => n.getClientRects().length), r = n => n && n.getBoundingClientRect();
          const sync = L.querySelector('.ch-sync'), sec = L.querySelector('.ch-sec .ch-sec-h'), act = sync?.querySelector('[data-chtroubleshoot]'), span = sync?.querySelector(':scope > span');
          const cs = n => n && getComputedStyle(n);
          return { firstSecTop: r(sec)?.top - r(L).top, secH: r(sec)?.height, sync: sync && { cls: sync.className, text: sync.innerText, h: r(sync).height, top: r(sync).top, bottom: r(sync).bottom, left: r(sync).left, right: r(sync).right,
            pbtn: sync.querySelectorAll('.pbtn').length, buttons: sync.querySelectorAll('button').length, spanTitle: span?.getAttribute('title'), spanLines: span ? Math.round(span.getBoundingClientRect().height / parseFloat(cs(span).lineHeight || 16)) : 0,
            spanH: r(span)?.height, ws: cs(span)?.whiteSpace, color: cs(sync).color, opacity: cs(sync).opacity },
            act: act && { text: act.innerText, label: act.getAttribute('aria-label'), top: r(act).top, bottom: r(act).bottom, left: r(act).left, right: r(act).right, h: r(act).height, w: r(act).width,
              bg: cs(act).backgroundColor, border: cs(act).borderTopWidth, radius: cs(act).borderTopLeftRadius, color: cs(act).color, hit: (() => { const b = r(act); const e = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !!e && (e === act || act.contains(e)); })() } };
        });
        const healthy = await geo(); entry.healthy = healthy;
        assert.equal(healthy.sync, null, stem + ': no notice while the list is up to date');
        await page.screenshot({ path: path.join(out, stem + '-no-notice.png') });
        // A failed read: Wizard unreachable. Offsets are measured inside the list, so the separate global connection pill
        // (unchanged, appears later) never counts as this notice's height.
        down = true;
        await page.evaluate(() => WizLive.refresh());
        await page.locator(list + ' .ch-sync.off').waitFor({ timeout: 15000 });
        await page.waitForTimeout(600);
        const off = await geo(); entry.offline = off;
        const s = off.sync, a = off.act;
        assert.match(s.text, /Not up to date/, stem + ': says Not up to date');
        assert.equal(s.pbtn, 0, stem + ': no .pbtn pill'); assert.equal(s.buttons, 1, stem + ': one action');
        assert.ok(s.h <= Math.max(36, off.secH + 2), stem + `: one row (${s.h}px, section header ${off.secH}px)`);
        assert.equal(s.ws, 'nowrap', stem + ': single line'); assert.ok(s.spanH <= 20, stem + `: text is one line (${s.spanH}px)`);
        assert.ok(s.spanTitle && /Not up to date/.test(s.spanTitle), stem + ': full line in the title');
        assert.ok(off.firstSecTop - healthy.firstSecTop <= Math.max(36, off.secH + 2), stem + `: the list moves down by one row only (${off.firstSecTop - healthy.firstSecTop}px)`);
        assert.equal(a.text, 'Troubleshoot'); assert.equal(a.label, 'Open Troubleshooter');
        assert.ok(a.h >= 44, stem + `: 44px touch target (${a.h})`); assert.ok(a.right <= s.right + 1 && a.right >= s.right - 8, stem + ': action at the right end of the row');
        const mid = (a.top + a.bottom) / 2; assert.ok(mid >= s.top && mid <= s.bottom, stem + ': action on the same row');
        assert.equal(a.border, '0px', stem + ': no pill border'); assert.match(a.bg, /rgba\(0, 0, 0, 0\)|transparent/, stem + ': no pill fill');
        assert.equal(s.opacity, '1', stem + ': text is opaque'); assert.ok(a.hit, stem + ': nothing covers the action');
        await page.screenshot({ path: path.join(out, stem + '-offline.png') });
        // Tapping Troubleshoot opens the ordinary Troubleshooter window, as data-chtroubleshoot always has.
        await page.evaluate(() => { const o = window.WizOpenApp; window.__opened = []; window.WizOpenApp = (...x) => { window.__opened.push(x[0]); return o(...x); }; });
        const btn = page.locator(list + ' .ch-sync [data-chtroubleshoot]').first();
        if (phone) await btn.tap(); else await btn.click();
        await page.waitForFunction(() => window.__opened.includes('troubleshooter'), null, { timeout: 5000 });
        entry.troubleshooterFrame = await page.waitForFunction(() => [...document.querySelectorAll('iframe')].some(f => /troubleshoot/.test(f.src || f.getAttribute('src') || '')), null, { timeout: 8000 }).then(() => true, () => false);
        entry.opened = await page.evaluate(() => window.__opened);
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(out, stem + '-troubleshooter.png') });
        assert.equal(entry.refused.filter(x => x.reason === 'unexpected-write').length, 0, 'no unexpected mutations: ' + JSON.stringify(entry.refused));
        entry.pass = true;
      } catch (e) { entry.failure = e.stack; const pages = context.pages(); if (pages[0]) { entry.body = (await pages[0].locator('body').innerText().catch(() => '')).slice(0, 2000); await pages[0].screenshot({ path: path.join(out, stem + '-failure.png') }).catch(() => {}); } }
      finally { fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await context.close(); }
    }
    assert.equal(report.cases.length, EXPECTED_CASES);
  } finally { await browser.close(); }
  const failed = report.cases.filter(c => !c.pass);
  console.log(JSON.stringify({ cases: report.cases.length, passed: report.cases.length - failed.length, failed: failed.map(c => c.stem),
    rows: Object.fromEntries(report.cases.map(c => [c.stem, c.offline?.sync && { h: c.offline.sync.h, jump: c.offline.firstSecTop - c.healthy.firstSecTop, text: c.offline.sync.text }])) }, null, 1));
  if (failed.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
