'use strict';
// Scratch evidence for issue 1644 (not committed): a reply into a thread whose scheduled watch run waits its turn.
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = 'https://queued-watch.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT, tag = process.env.QA_TAG || 'after';
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const RUN = 'wizardq_ff940d509f9f4e058ff0a4c5ee0b4e19', SID = 'qa-forum';
const rows = [{ id: SID, title: 'Private-first Forum setup', runtime: 'direct', status: 'queued', wizard_run_id: RUN, updated_at: iso(now - 6e4), message_count: 2, preview: '[Wizard schedule] watch' }];
const said = [];
(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block',
    userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' });
  const log = { steer: 0, runs: 0 };
  try {
    await context.routeWebSocket('**/*', w => w.close());
    await context.addInitScript(() => { if (window !== top) return;
      for (const [k, v] of Object.entries({ 'wos.shell': 'phone', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': 'nebula' })) localStorage.setItem(k, v); });
    await context.route('**/*', async r => {
      const q = r.request(), u = new URL(q.url()), p = u.pathname, method = q.method();
      if (u.origin !== origin) return r.abort();
      if (p === '/wizard/health') return r.fulfill({ json: { status: 'ok' } });
      if (method === 'POST' && p === `/wizard/hermes/v1/runs/${RUN}/steer`) { log.steer++; return r.fulfill({ status: 409, json: { error: { code: 'dispatch_already_attempted', message: 'Delivery may already have started; this reply cannot be changed' } } }); }
      if (method === 'GET' && p === `/wizard/hermes/v1/runs/${RUN}`) return r.fulfill({ json: { run_id: RUN, session_id: SID, status: 'queued', queue_reason: 'capacity' } });
      if (method === 'POST' && p === '/wizard/hermes/v1/runs') { log.runs++; const b = q.postDataJSON() || {}; said.push(String(b.input || '')); return r.fulfill({ status: 202, json: { run_id: 'wizardq_reply_' + log.runs, status: 'queued', queue_reason: 'capacity' } }); }
      if (method === 'PUT' && p === '/wizard/thread-seen') return r.fulfill({ json: { ok: true, state: q.postDataJSON() } });
      if (!['GET', 'HEAD'].includes(method)) return r.fulfill({ json: { ok: true } });
      if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
      if (p.startsWith(prefix)) {
        const abs = path.resolve(web, decodeURIComponent(p.slice(prefix.length) || 'index.html'));
        if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
        return fs.existsSync(abs) && fs.statSync(abs).isFile() ? r.fulfill({ path: abs }) : r.fulfill({ status: 404, body: 'none' });
      }
      if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
      if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
      if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: rows, has_more: false } });
      if (p.startsWith('/wizard/hermes/v1/runs/')) return r.fulfill({ json: { run_id: p.split('/')[5], session_id: SID, status: 'queued' } });
      const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
      if (m) {
        const msgs = [{ role: 'user', content: 'Set up the private-first forum', timestamp: now / 1000 - 3600 }, { role: 'assistant', content: 'Done. I will watch it on a schedule.', timestamp: now / 1000 - 3590 }];
        return r.fulfill({ json: m[2] ? { messages: msgs } : { session: rows[0] } });
      }
      return r.fulfill({ json: ownerRead(p) });
    });
    const page = await context.newPage();
    await page.goto(origin + prefix + 'index.html?phone');
    await nap(4000);
    await page.evaluate(id => window.__wos.openWizardThread(id), SID);
    const vis = sel => page.locator(sel).filter({ visible: true }).first();
    await vis('.ch-compose textarea').waitFor({ timeout: 15000 });
    await vis('.ch-compose textarea').fill('Here are the two screenshots for the forum');
    await vis('.ch-compose .ch-send').click();
    await page.waitForFunction(() => [...(window.WosOutbox?._items?.values() || [])].some(it => ['sent', 'failed'].includes(it.state)), null, { timeout: 20000 });
    await nap(3000);
    const items = await page.evaluate(() => [...(window.WosOutbox?._items?.values() || [])].map(it => ({ state: it.state, error: it.error })));
    await page.screenshot({ path: path.join(out, `queued-watch-reply-${tag}.png`) });
    console.log(JSON.stringify({ tag, log, items }));
  } finally { await context.close(); await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
