'use strict';
// Issue 1561: stock look, Tinfoil connected -> the model menu under the composer lists GLM, Kimi, DeepSeek Flash.
// QA_TREE=<checkout> QA_OUT=<dir> QA_PLAYWRIGHT=<module> node qa.cjs
const fs = require('node:fs'), path = require('node:path');
const { chromium } = require(process.env.QA_PLAYWRIGHT);
const TREE = path.resolve(process.env.QA_TREE), OUT = process.env.QA_OUT; fs.mkdirSync(OUT, { recursive: true });
const origin = 'https://qa1561.test', prefix = '/wizard-os-home/';
const mime = f => f.endsWith('.js') || f.endsWith('.mjs') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : f.endsWith('.svg') ? 'image/svg+xml' : f.endsWith('.json') ? 'application/json' : f.endsWith('.png') ? 'image/png' : 'text/html';
const now = Date.now() / 1000, SID = 'qa-thread';
const row = { id: SID, title: 'Plan the week', source: 'wizard-mobile', status: 'completed', archived: false, hidden: false, message_count: 2, started_at: now - 600, last_active: now - 60, wizard_last_user_at: now - 90, wizard_last_assistant_at: now - 60, preview: 'Here is a plan', model: 'claude-opus-5-5', provider: 'anthropic' };
const OPTIONS = { provider: 'anthropic', model: 'claude-opus-5-5', providers: [
  { slug: 'anthropic', authenticated: true, models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5', 'claude-fable-5-1'] },
  { slug: 'openai-codex', authenticated: true, models: ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-luna'] },
  { slug: 'wizard-tinfoil', name: 'wizard-tinfoil', is_user_defined: true, authenticated: true, models: ['glm-5-3', 'kimi-k3-1-pro', 'deepseek-v4-1-flash'] },
] };
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const writes = [], errors = [];
  await ctx.routeWebSocket('**/*', w => w.close());
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url()), m = q.method();
    if (u.origin !== origin) return r.abort();
    if (u.pathname.includes('/v1/runs')) return r.abort();
    if (u.pathname.startsWith(prefix)) {
      const rel = decodeURIComponent(u.pathname.slice(prefix.length) || 'index.html'), abs = path.resolve(TREE, 'web', rel);
      if (!abs.startsWith(path.join(TREE, 'web') + path.sep) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) return r.fulfill({ status: 404, body: 'missing' });
      return r.fulfill({ body: fs.readFileSync(abs), contentType: mime(rel) });
    }
    if (m !== 'GET' && m !== 'HEAD') { writes.push({ method: m, path: u.pathname, body: q.postData() }); return r.fulfill({ json: { ok: true, state: { initializedAt: 1, threads: {} } } }); }
    if (u.pathname === '/wizard/hermes/api/sessions') return r.fulfill({ json: { object: 'list', data: [row], has_more: false, limit: 100, offset: 0, snapshot: 'qa' } });
    if (/\/sessions\/[^/]+\/messages$/.test(u.pathname)) return r.fulfill({ json: { object: 'list', has_more: false, data: [{ id: 1, session_id: SID, role: 'user', content: 'Plan my week please', timestamp: now - 90 }, { id: 2, session_id: SID, role: 'assistant', content: 'Here is a plan for your week.', timestamp: now - 60 }] } });
    if (/\/sessions\/[^/]+$/.test(u.pathname)) return r.fulfill({ json: { session: row } });
    if (u.pathname === '/wizard/thread-seen') return r.fulfill({ json: { state: { initializedAt: 1, threads: {} } } });
    if (u.pathname === '/wizard/v1/ui-preferences') return r.fulfill({ json: { spaces: [], pinnedChats: [], migrations: { 'launcher.v1': true, 'launcher-seed-v1': true } } });
    if (u.pathname === '/wizard/v1/boomerangs') return r.fulfill({ json: { reminders: [] } });
    if (u.pathname === '/wizard/v1/schedules') return r.fulfill({ json: { schedules: [] } });
    if (u.pathname === '/wizard/hermes/api/model/options') return r.fulfill({ json: OPTIONS });
    if (u.pathname === '/wizard-tinfoil/api/status') return r.fulfill({ json: { provider: 'tinfoil', credentialStored: true } });
    if (u.pathname === '/wizard-claude/api/accounts') return r.fulfill({ json: { accounts: [{ id: 'a1', status: 'ready' }] } });
    if (u.pathname === '/wizard/v1/setup') return r.fulfill({ json: { first_run: false, seen: true } });
    return r.fulfill({ json: {} });
  });
  await ctx.addInitScript(() => {
    if (window !== top) return;
    for (const [k, v] of Object.entries({ 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.tour.done': '1', 'wos.welcome.v1': 'done', 'wos.voiceTipSeen': 'true', 'wos.skin': 'nebula', 'wos.shell': 'phone', 'wux.shell': 'phone' })) localStorage.setItem(k, v);
  });
  const page = await ctx.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + prefix + 'index.html?phone', { waitUntil: 'load' });
  await page.waitForFunction(id => window.__wos && window.WizLive?.ok && window.WizLive.session?.(id), SID);
  await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
  await page.evaluate(id => window.__wos.openWizardThread(id), SID);
  await page.waitForSelector('[data-chmodel]:visible');
  await page.waitForFunction(() => window.WosModels?.ready);
  await page.locator('[data-chmodel]:visible').first().click();
  await page.waitForSelector('.ch-mpop .mrow');
  await page.waitForTimeout(400);
  const rows = await page.$$eval('.ch-mpop .mrow b', bs => bs.map(b => b.textContent.trim()));
  await page.screenshot({ path: path.join(OUT, 'menu.png') });
  const out = { rows, errors };
  const ds = page.locator('.ch-mpop .mrow', { hasText: 'DeepSeek Flash' });
  if (await ds.count()) {
    await ds.first().click(); await page.waitForTimeout(800);
    out.picked = await page.evaluate(id => window.WosModels.snapshot(id), SID);
    out.label = await page.locator('[data-chmodel]:visible').first().textContent();
    out.writes = writes.filter(w => /model|sessions/.test(w.path)).slice(-3);
    await page.screenshot({ path: path.join(OUT, 'picked.png') });
  }
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
