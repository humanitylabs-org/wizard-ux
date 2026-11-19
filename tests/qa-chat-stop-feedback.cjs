'use strict';
// wizard-ux issue 1576 in a real browser (desktop 1440x900, AI apps, Nebula): Stop on a running chat while the box is
// slow to answer the stop (3 s). Expect: 200 ms after the tap the chat says Stopping… and shows no live Stop button;
// once the box has stopped the run, the chat shows it stopped within a few seconds (not at the next 15 s poll).
// Synthetic transport only (no box is reached). QA_EXPECT=broken (with QA_WEB=<main>/web) asserts the old behaviour.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = 'https://chat-stop-feedback.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'chat-stop-feedback-evidence');
const broken = process.env.QA_EXPECT === 'broken', tag = broken ? 'before' : 'after';
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const STOP_DELAY = 3000;
(async () => {
  const browser = await chromium.launch(), report = {};
  const row = { id: 'qa-long', title: 'Feature spec for photo capture inbox', runtime: 'direct', status: 'running', wizard_status: 'running',
    wizard_run_id: 'run_live', updated_at: iso(now - 6e4), updatedAt: iso(now - 6e4), last_active: (now - 6e4) / 1000, message_count: 1, messageCount: 1, preview: 'Searching…' };
  let stopAsked = 0, stoppedAt = 0;
  try {
    const dc = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    await dc.routeWebSocket('**/*', w => w.close());
    await dc.addInitScript(() => {
      if (window !== top) return;
      for (const [k, v] of Object.entries({ 'wos.shell': 'desktop', 'wux.shell': 'desktop', 'wos.desktop-view.v1': 'ai-apps', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': 'nebula',
        'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix: { 'wizard/desktop-chats': true } }) })) localStorage.setItem(k, v);
    });
    await dc.route('**/*', async r => {
      const q = r.request(), u = new URL(q.url()), p = u.pathname, method = q.method();
      if (u.origin !== origin) return r.abort();
      if (method === 'POST' && /^\/wizard\/hermes\/v1\/runs\/run_live\/stop$/.test(p)) {
        stopAsked = Date.now(); await nap(STOP_DELAY);
        row.status = row.wizard_status = 'cancelled'; row.wizard_last_run_status = 'cancelled'; stoppedAt = Date.now();
        return r.fulfill({ json: { run_id: 'run_live', status: 'stopping' } });
      }
      if (p === '/wizard/hermes/v1/runs/run_live') return r.fulfill({ json: { run_id: 'run_live', session_id: 'qa-long', status: row.status } });
      if (!['GET', 'HEAD'].includes(method)) return r.fulfill({ json: { ok: true } });
      if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
      if (p.startsWith(prefix)) {
        const abs = path.resolve(web, decodeURIComponent(p.slice(prefix.length) || 'index.html'));
        if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
        return fs.existsSync(abs) && fs.statSync(abs).isFile() ? r.fulfill({ path: abs }) : r.fulfill({ status: 404, body: 'none' });
      }
      if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
      if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
      if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: [row], has_more: false } });
      const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
      if (m) return r.fulfill({ json: m[2] ? { messages: [{ role: 'user', content: 'Write the feature spec for the photo capture inbox', timestamp: now / 1000 - 60 }] } : { session: row } });
      return r.fulfill({ json: ownerRead(p) });
    });
    const dp = await dc.newPage();
    await dp.goto(origin + prefix + 'desktop.html');
    await dp.waitForFunction(() => window.WizLive?.session?.('qa-long')?.runId === 'run_live', null, { timeout: 20000 });
    await dp.evaluate(() => window.__wux.openThread('qa-long'));
    const stop = dp.locator('.ch-compose [data-chstop]').filter({ visible: true }).first();
    await stop.waitFor({ timeout: 15000 });
    await nap(800);
    const state = () => dp.evaluate(() => {
      const vis = e => e && e.getClientRects().length;
      const b = [...document.querySelectorAll('.ch-compose [data-chstop]')].find(vis);
      return { status: window.WizLive.session('qa-long')?.status, stopLive: !!b && !b.disabled,
        work: [...document.querySelectorAll('details.steps.live summary')].filter(vis).map(e => e.textContent.replace(/\s+/g, ' ').trim()).join(' | ').slice(0, 160) };
    });
    report.beforeTap = await state();
    const t0 = Date.now();
    await stop.click();
    await nap(200);
    report.at200ms = await state(); console.log('200 ms after Stop', JSON.stringify(report.at200ms));
    await dp.screenshot({ path: path.join(out, `stop-200ms-${tag}.png`) });
    let shown = 0;
    for (let i = 0; i < 100; i++) { const s = await state(); if (s.status && !['running', 'stopping', 'queued', 'submitting'].includes(s.status)) { shown = Date.now(); report.settled = s; break; } await nap(250); }
    report.stopRequestMs = stopAsked - t0;
    report.settledAfterBoxMs = shown ? shown - stoppedAt : null;
    console.log('stop request left after', report.stopRequestMs, 'ms; chat showed it stopped', report.settledAfterBoxMs, 'ms after the box stopped it');
    await dp.screenshot({ path: path.join(out, `stop-settled-${tag}.png`) });
    fs.writeFileSync(path.join(out, `report-${tag}.json`), JSON.stringify(report, null, 2));
    if (broken) {
      assert.ok(report.at200ms.status !== 'stopping' || report.at200ms.stopLive || !(report.settledAfterBoxMs < 3000), 'main shows the slow Stop');
      console.log('baseline confirmed on main');
    } else {
      assert.equal(report.at200ms.status, 'stopping', 'the chat says Stopping… 200 ms after the tap');
      assert.equal(report.at200ms.stopLive, false, 'no live Stop button after the tap');
      assert.match(report.at200ms.work, /Stopping…/, 'the live work line in the thread says Stopping…');
      assert.ok(report.settledAfterBoxMs !== null && report.settledAfterBoxMs < 3000, `the chat shows it stopped within 3 s of the box (${report.settledAfterBoxMs} ms)`);
      console.log('ok: Stopping… on the tap, stopped shown within seconds');
    }
    await dc.close();
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
