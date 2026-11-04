'use strict';
// Offline, synthetic only. Browser execution belongs to the forum queue, never the VPS.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium, devices } = require('./tools/qa-playwright.cjs');
const TREE = path.resolve(process.env.QA_TREE || __dirname), OUT = process.env.QA_OUT;
assert(OUT, 'QA_OUT required'); fs.mkdirSync(OUT, { recursive: true });
const ORIGIN = 'http://wizard-qa.invalid', PREFIX = '/wizard-os-home/';
const report = { source: process.env.QA_SOURCE_SHA, synthetic: true, cases: [], requests: [], refusedWrites: [], unknown: [], errors: [], captures: [] };
const json = (r, body, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const raw = (id, at, attention = 'needs_you', extra = {}) => ({ id, title: 'Synthetic ' + id, runtime: 'direct', status: 'completed', source: 'api_server',
  created_at: at / 1000 - 60, last_active: at / 1000, preview_at: at / 1000, last_assistant_at: at / 1000,
  preview: 'Synthetic answer — no private data', preview_role: 'assistant', last_role: 'assistant', message_count: 2,
  latest_message: { role: 'assistant', content: extra.preview || 'Synthetic answer — no private data', timestamp: at / 1000 },
  wizard_attention: { state: attention }, ...extra });
let browser, page, active = 'boot';
const check = async (name, fn) => { active = name; await fn(); report.cases.push(name); console.log('PASS', name); };
const count = p => p.evaluate(() => WizCore.workspaceNav.counts.wizard || 0);
async function expectCount(p, n) { await p.waitForFunction(n => (WizCore.workspaceNav.counts.wizard || 0) === n, n, { timeout: 7000 }); assert.equal(await count(p), n); }
async function settle(p) {
  await p.waitForFunction(() => !window.WosExperience?.state?.busy);
  await p.waitForFunction(() => !document.getAnimations().some(a => a.playState === 'running' && Number.isFinite(a.effect?.getComputedTiming().endTime)), null, { timeout: 9000 });
  await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
}
async function snap(name, phone) {
  await settle(page); const file = path.join(OUT, name + '.png');
  const state = await page.evaluate(() => ({ shell: document.documentElement.dataset.shell, skin: document.documentElement.dataset.skin,
    count: WizCore.workspaceNav.counts.wizard || 0, ready: WizLive.workGroups().ready.length,
    unread: WizLive.visibleUnread(WizLive.unified()).map(s => s.id), title: document.title,
    badges: [...document.querySelectorAll('#orbBadge, .dbg, .dw-badge, [data-badge="wizard"]')].map(n => ({ text: n.textContent, hidden: n.hidden, box: n.getBoundingClientRect().toJSON() })),
    width: innerWidth, height: innerHeight, touch: navigator.maxTouchPoints, ua: navigator.userAgent }));
  assert.equal(state.shell, phone ? 'phone' : 'desktop'); if (phone) assert(state.touch > 0 && /Android/.test(state.ua));
  if (state.count > 0) assert(state.badges.some(b => !b.hidden && b.box.width > 0 && b.box.height > 0 && b.text.trim() === String(state.count)), 'positive app count must reach a rendered shell badge');
  await page.screenshot({ path: file });
  const b = fs.readFileSync(file); assert.equal(b.readUInt32BE(16), state.width); assert.equal(b.readUInt32BE(20), state.height);
  report.captures.push({ file, ...state }); fs.writeFileSync(path.join(OUT, 'captures.json'), JSON.stringify(report.captures, null, 2));
}
async function boot(phone) {
  const c = await browser.newContext({ ...(phone ? devices['Pixel 7'] : { viewport: { width: 1440, height: 900 } }), deviceScaleFactor: 1, serviceWorkers: 'block' });
  await c.routeWebSocket('**/*', w => w.close());
  const at = Date.now() - 120000;
  const s = { rows: [raw('badge-read-ready', at)], seen: { initializedAt: 1, threads: { 'direct:badge-read-ready': { seenAt: at + 1000, assistantActivityAt: new Date(at).toISOString() } } } };
  await c.addInitScript(phone => {
    if (window !== window.top) return;
    for (const [k, v] of Object.entries({ 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': 'nebula', 'wux.shell': phone ? 'phone' : 'desktop' })) localStorage.setItem(k, v);
  }, phone);
  const empties = new Set(['/wizard/v1/agents', '/wizard/v1/boomerangs', '/wizard/thread-dispositions', '/wizard/v1/setup', '/wizard/v1/notifications', '/wizard/ai-usage', '/wizard/v1/health', '/wizard/v1/voice/status', '/wizard/hermes/api/cron/jobs', '/wizard/scheduler/jobs', '/wizard/hermes/v1/runs', '/wizard/notifications/v1/counts', '/wizard/notifications/v1/items', '/wizard-os-home/store-data/router/v1/status', '/wizard-os-home/api/apps', '/wizard-os-home/installed-apps', '/wizard-os-home/app-logos']);
  await c.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url()), p = u.pathname, method = q.method();
    report.requests.push({ method, path: p + u.search });
    if (u.origin !== ORIGIN) { report.unknown.push({ method, url: u.href }); return r.abort('blockedbyclient'); }
    // Only synthetic read receipts are accepted, in memory. All other writes (including sends) are refused.
    if (method === 'PUT' && p === '/wizard/thread-seen') { const next = q.postDataJSON(); s.seen = { ...s.seen, threads: { ...s.seen.threads, ...(next.threads || {}) } }; return json(r, { state: s.seen }); }
    if (!['GET', 'HEAD'].includes(method)) { report.refusedWrites.push({ method, path: p }); return json(r, { error: 'fixture refuses owner writes' }, 403); }
    if (p === '/wizard/v1/pages/wizard-look/look.json') return json(r, { error: 'no synthetic synced Look yet' }, 404);
    if (p === '/troubleshoot/api/ping') return json(r, { ok: true });
    if (p === '/troubleshoot/api/status') return json(r, { checks: [{ id: 'agent-service', ok: true }], ok: true });
    if (p === '/wizard-tinfoil/api/status') return json(r, { ready: false, configured: false });
    if (p === '/wizard-claude/api/accounts') return json(r, { accounts: [] });
    if (p === '/notifications/api/routes') return json(r, { routes: {} });
    if (p === '/notifications/api/marks') return json(r, { marks: {} });
    if (p === '/notifications/api/items') return json(r, { items: [] });
    if (p === '/notifications/api/count') return json(r, { unread: 0, needs: 0 });
    if (p === '/wizard/v1/bootstrap') return json(r, { bootstrap: 1, settings: { owner: { name: 'Synthetic QA' }, agent: { name: 'Synthetic Wizard' }, clock: { timezone: 'UTC' } }, endpoints: { apps: '/wizard/v1/apps' }, capabilities: {} });
    if (p === '/wizard/v1/apps') return json(r, { apps: [] });
    if (p === '/wizard/hermes/api/sessions') return json(r, { object: 'list', data: s.rows, has_more: false, limit: 100, offset: 0 });
    if (p === '/wizard/thread-seen') return json(r, { state: s.seen });
    if (p === '/wizard/v1/ui-preferences') return json(r, { preferences: {}, migrations: {} });
    if (p === '/wizard/hermes/api/model/options') return json(r, { provider: 'qa', model: 'synthetic', providers: [] });
    const m = p.match(/^\/wizard\/hermes\/api\/sessions\/(badge-[a-z-]+)(\/messages)?$/);
    if (m) { const item = s.rows.find(x => x.id === m[1]); if (!item) return json(r, { error: 'no synthetic thread' }, 404);
      return json(r, m[2] ? { data: [{ role: 'user', content: 'Synthetic question', timestamp: item.last_active - 1 }, { role: 'assistant', content: item.preview, timestamp: item.last_active }], has_more: false } : { session: item }); }
    if (empties.has(p)) return json(r, p.endsWith('agents') ? { agents: [] } : p.endsWith('items') ? { items: [] } : p.endsWith('counts') ? { unread: 0, needs: 0 } : {});
    if (p === PREFIX + 'data.js' || p === PREFIX + 'summaries.js') return r.fulfill({ contentType: 'application/javascript', body: '/* Synthetic QA: generated owner data intentionally absent. */' });
    if (p === PREFIX + 'ux-changes.json') return json(r, []);
    if (p.startsWith(PREFIX)) {
      const root = path.join(TREE, 'web'), file = path.resolve(root, decodeURIComponent(p.slice(PREFIX.length) || 'index.html'));
      if (file.startsWith(root + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) return r.fulfill({ path: file });
      // Known optional local catalogues absent in git: explicit empty fixtures, not owner reads.
      if (/^\/wizard-os-home\/(?:store-data\/|installed-apps\/|app-logos\/)/.test(p)) return json(r, { apps: [], items: [], installed: [], complete: true });
    }
    if (p === '/favicon.ico') return r.fulfill({ status: 204, body: '' });
    report.unknown.push({ method, path: p + u.search }); return json(r, { error: 'uncatalogued synthetic request' }, 451);
  });
  page = await c.newPage(); page.on('pageerror', e => report.errors.push(String(e)));
  await page.clock.install();
  await page.goto(ORIGIN + PREFIX + (phone ? '' : 'desktop.html') + '?shell=' + (phone ? 'phone' : 'desktop') + '&view=chats');
  await page.waitForFunction(() => window.WizLive?.ok && document.documentElement.dataset.shell && !window.WosWelcome?.active);
  return { c, s, at };
}
async function refresh() { await page.evaluate(() => WizLive.refresh()); }
async function routeView(view) { await page.evaluate(view => { WizCore.deeplink.route(location.origin + '/wizard-os-home/?view=' + view); }, view); }
async function showList(phone) {
  const back = page.locator('[data-chback]:visible').first();
  if (await back.count()) { if (phone) await back.tap(); else await back.click(); }
  await routeView('chats'); await settle(page);
}
async function tapThread(id, phone) {
  await showList(phone);
  const row = page.locator(`[data-chopen="${id}"]:visible`).first();
  await row.waitFor(); if (phone) await row.tap(); else await row.click();
  await page.locator('.ch-thread:visible .ch-msgs').first().waitFor();
}
(async () => {
  try {
    browser = await chromium.launch({ args: ['--disable-background-networking', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    for (const phone of process.env.QA_NEGATIVE_CONTROL === '1' ? [true] : [true, false]) {
      const mode = phone ? 'phone' : 'desktop', { c, s, at } = await boot(phone);
      await check(mode + ': read Ready contributes zero (specific regression oracle)', async () => {
        assert.equal(await page.evaluate(() => WizLive.workGroups().ready.filter(x => x.id === 'badge-read-ready').length), 1);
        assert.equal(await page.evaluate(() => WizLive.isUnread(WizLive.sessions.find(x => x.id === 'badge-read-ready'))), false);
        await snap(mode + '-read-ready', phone);
        assert.equal(await count(page), 0, 'REGRESSION_READ_READY_BADGE_MUST_BE_ZERO');
      });
      if (process.env.QA_NEGATIVE_CONTROL === '1') throw Error('BASELINE_UNEXPECTEDLY_PASSED');
      await check(mode + ': unread done/FYI count once each, even with many messages', async () => {
        s.rows.push(raw('badge-done', at, 'done', { message_count: 50 }), raw('badge-fyi', at, 'fyi'));
        await refresh(); await expectCount(page, 2); await snap(mode + '-unread-two-nebula', phone);
      });
      await check(mode + ': trusted reading clears badge despite Ready inventory persisting', async () => {
        await tapThread('badge-done', phone); await expectCount(page, 1);
        assert.equal(await page.evaluate(() => WizLive.workGroups().ready.filter(x => x.id === 'badge-read-ready').length), 1);
        await snap(mode + '-read-one', phone);
      });
      await check(mode + ': later reply restores one thread, not three messages', async () => {
        await showList(phone);
        const now = await page.evaluate(() => Date.now());
        Object.assign(s.rows.find(x => x.id === 'badge-done'), raw('badge-done', now, 'done', { message_count: 53, preview: 'Synthetic later reply' }));
        await refresh(); await expectCount(page, 2); await snap(mode + '-later-reply', phone);
      });
      await check(mode + ': live skin selection retains unread count and existing tokens', async () => {
        await routeView('settings'); const cat = page.locator('[data-st-page="appearance"]:visible').first(); await cat.click();
        const family = page.locator('[data-skinfamily="mizel"]:visible').first(); if (await family.count() && await family.getAttribute('aria-pressed') !== 'true') await family.click();
        const target = page.locator('[data-skinpick="obsidian-light"]:visible').first(); await target.waitFor();
        const doc = await page.evaluate(() => (window.__badgeDoc = Math.random())); if (phone) await target.tap(); else await target.click();
        await page.waitForFunction(() => document.documentElement.dataset.skin === 'obsidian-light');
        assert.equal(await page.evaluate(() => __badgeDoc), doc, 'skin changed live, not by reload');
        assert(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--wz-base').trim()));
        if (phone) { for (let i = 0; i < 3; i++) await page.evaluate(() => window.__wosNativeBack?.()); }
        else await page.keyboard.press('Escape');
        await routeView('chats'); await expectCount(page, 2); await snap(mode + '-unread-two-obsidian-light', phone);
      });
      await check(mode + ': unattended open thread does not eat a later reply', async () => {
        await tapThread('badge-fyi', phone); await expectCount(page, 1);
        await page.clock.fastForward(70000);
        const now = await page.evaluate(() => Date.now()); Object.assign(s.rows.find(x => x.id === 'badge-fyi'), raw('badge-fyi', now, 'fyi'));
        await refresh(); await expectCount(page, 2);
        await page.locator('.ch-thread:visible .ch-msgs').first().click();
        await page.evaluate(() => dispatchEvent(new CustomEvent('wizard:live'))); await expectCount(page, 1);
      });
      await c.close();
    }
    assert.deepEqual(report.unknown, [], 'unknown fixture reads must be explicitly catalogued');
    assert.equal(report.refusedWrites.filter(x => /\/runs|\/messages|\/sessions/.test(x.path)).length, 0, 'no sends');
    assert.deepEqual(report.errors, [], 'no page exceptions');
  } catch (e) {
    report.failedCase = active; report.error = String(e.stack || e); process.exitCode = 1;
    if (page && !page.isClosed()) { try { await page.screenshot({ path: path.join(OUT, 'REJECTED.png') }); } catch {} }
    console.error(e);
  } finally {
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2)); if (browser) await browser.close();
  }
})();
