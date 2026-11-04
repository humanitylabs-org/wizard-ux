/* Offline, synthetic, two-shell integration acceptance. Never contacts the owner's Wizard.
 * All requests are fulfilled from this immutable source packet or the explicit fixture below;
 * unknown requests and ALL agent writes are refused and make acceptance fail.
 * Browser coverage is Android-UA, not a physical-device installation claim. */
'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('./qa-playwright.cjs');
const ROOT = path.resolve(__dirname, '..'), WEB = path.join(ROOT, 'web');
const OUT = process.env.QA_OUT;
if (!OUT || !process.env.TMPDIR || !path.resolve(process.env.TMPDIR).startsWith('/srv/work/')) throw Error('Owned forum QA_OUT and regular-disk TMPDIR required');
fs.mkdirSync(OUT, { recursive: true });
const ORIGIN = 'http://wizard-qa.invalid';
const failures = [], refused = [], requests = [], assertions = [], screenshots = [], inventories = [];
let heldWrite = null, holdNext = false, version = 1;
let look = { version: 1, skin: { id: 'obsidian', at: 5 }, tweaks: { 'miguel/ai-apps': { on: true, at: 5 } }, defaults: { 'wizard/unified-inbox': { on: true, at: 5 } } };
const main = 'qa-operator', DAY = 864e5, now = Date.now();
const stamp = age => new Date(now - age).toISOString();
const sessions = [
  { id: 'qa-main-sync', title: 'Main sync', updated_at: stamp(DAY + 1000), message_count: 2 },
  { id: 'qa-meeting-chat', title: 'Meeting summaries', updated_at: stamp(3 * DAY), message_count: 2 },
  { id: 'qa-error', title: 'Synthetic failed chat', updated_at: stamp(1000), message_count: 2, status: 'failed' },
  { id: 'qa-ready', title: 'Synthetic ready chat', updated_at: stamp(1000), message_count: 2 },
].map(s => ({ agent: main, agent_id: main, source: 'api_server', ...s }));
const notes = [{ id: 'qa-granola-summary', title: 'Meeting summaries · synthetic recap', message: 'Synthetic meeting recap only.', time: now / 1000, source: 'granola', priority: 3, read: false, archived: false }];
const settings = { schema: 1, agents: { default_agent_id: main }, owner: { name: 'Synthetic owner' }, agent: { name: 'QA Operator' }, clock: { timezone: 'UTC', day_starts_at: '00:00' }, setup: { seen_at: stamp(0) }, network: { base_url: ORIGIN } };
const apps = [ { id: 'notifications', name: 'Notifications', kind: 'agent', source: 'wizard' },
  { id: 'qa-form', name: 'Synthetic form', url: '/qa-form/', source: 'wizard', kind: 'wizard' } ];
const optional404 = new Set(['/wizard/v1/workspaces', '/wizard/v1/health', '/wizard/v1/devices', '/wizard/v1/app-logos', '/wizard/v1/box-source', '/wizard/v1/os-updates', '/wizard/v1/updates', '/wizard/v1/update', '/wizard/v1/companion', '/wizard/v1/schedules', '/wizard/schedules', '/wizard/cancelled', '/wizard-tinfoil/api/status', '/wizard-claude/api/accounts', '/wizard/hermes/api/model/options', '/wizard/v1/my-skin/script', '/qa-form/api/inbox']);
const json = (r, body, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
async function route(r) {
  const q = r.request(), u = new URL(q.url()), m = q.method(), p = u.pathname;
  requests.push({ method: m, path: p + u.search });
  const deny = async reason => { refused.push({ method: m, path: u.href, reason }); await json(r, { error: 'synthetic_request_refused' }, 451); };
  if (u.origin !== ORIGIN) return deny('nonfixture origin');
  if (p === '/wizard/v1/pages/wizard-look/look.json') {
    if (m === 'GET') return json(r, { exists: true, text: JSON.stringify(look), version: String(version) });
    if (m !== 'PUT') return deny('unsupported look operation');
    if (holdNext) { holdNext = false; await new Promise(resolve => { heldWrite = resolve; }); }
    const body = q.postDataJSON();
    if (body.version !== String(version)) return json(r, { current: { exists: true, text: JSON.stringify(look), version: String(version) } }, 409);
    look = JSON.parse(body.text); version++; return json(r, { changed: true, version: String(version) });
  }
  // Viewing a thread may record seen state; that is not an agent action. It stays synthetic too.
  if (p === '/wizard/thread-seen' && ['PUT', 'POST'].includes(m)) return json(r, { state: { initializedAt: now, threads: {} } });
  if (!['GET', 'HEAD'].includes(m)) return deny('no writes except the shared look and synthetic seen bookkeeping');
  if (p.startsWith('/wizard-os-home/')) {
    let rel = decodeURIComponent(p.slice('/wizard-os-home/'.length)) || 'index.html';
    const file = path.resolve(WEB, rel);
    if (!file.startsWith(WEB + path.sep)) return deny('static traversal');
    if (rel === 'data.js' || rel === 'summaries.js') return r.fulfill({ contentType: 'application/javascript', body: '/* Synthetic fixture: no private release data. */' });
    if (rel === 'ux-version.txt') return r.fulfill({ contentType: 'text/plain', body: 'synthetic-pinned-candidate' });
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return deny('unavailable static resource');
    const ext = path.extname(file), mime = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' }[ext] || 'application/octet-stream';
    return r.fulfill({ status: 200, contentType: mime, body: fs.readFileSync(file) });
  }
  if (p === '/wizard/v1/bootstrap') return json(r, { settings, endpoints: { apps: '/wizard/v1/apps', sessions: '/wizard/hermes/api/sessions', runs: '/wizard/hermes/v1/runs' }, capabilities: {} });
  if (p === '/wizard/v1/setup') return json(r, { first_run: false });
  if (p === '/wizard/hermes/api/model/options') return json(r, { model: 'fixture', provider: 'fixture', providers: [{ slug: 'fixture', name: 'Synthetic connected provider', authenticated: true, is_current: true, models: ['fixture'] }] });
  if (p === '/wizard/v1/settings') return json(r, settings);
  if (p === '/wizard/v1/agents') return json(r, { agents: [{ id: main, label: 'QA Operator', privacy: 'standard', is_default: true, status: 'running', harness: 'hermes', appearance: { glyph: 'star', hue: 270 } }] });
  if (p === '/wizard/v1/apps') return json(r, { apps, chats: { default: 'wizard-chats' } });
  if (p === '/wizard/v1/agent-options') return json(r, { harnesses: [], providers: [], wizard_apps: [], agent_apps: [] });
  if (p === '/wizard/v1/app-bindings') return json(r, { bindings: [] });
  if (p === '/wizard/v1/pages') return json(r, { pages: [] });
  if (p === '/wizard/v1/skins') return json(r, { version: 1, skins: [], active: null, migrated: true });
  if (p === '/wizard/v1/my-skin') return u.search ? json(r, { exists: false, script: null }) : r.fulfill({ status: 200, contentType: 'text/css', body: '' });
  if (p === '/wizard/v1/ui-preferences') return json(r, { version: 1, build: 'qa', migrations: { 'launcher-seed-v1': true }, launcher: {}, archiveAfterDays: 7, chatLayout: 'day', spaces: [], pinnedChats: [] });
  if (p === '/wizard/hermes/api/sessions') {
    if (u.searchParams.get('agent') && u.searchParams.get('agent') !== main) return deny('nonfixture agent');
    const indexed = u.searchParams.get('view') === 'index';
    return json(r, indexed ? { data: sessions.map(s => ({ id: s.id, title: s.title, agent: main })), build: 'qa-index', account_scope: 'synthetic-owner', has_more: false } : { data: sessions, object: 'list', window: 'archive-50', archive_total: 0, archive_returned: 0, archive_cursor: '', has_more: false });
  }
  const session = /^\/wizard\/hermes\/api\/sessions\/(qa-[a-z-]+)(\/messages)?$/.exec(p);
  if (session) {
    const s = sessions.find(s => s.id === session[1]); if (!s) return deny('unknown synthetic session');
    return json(r, session[2] ? { data: [{ id: 'qa-msg', role: 'assistant', content: 'Synthetic transcript only.', timestamp: now / 1000 }], has_more: false } : { session: s });
  }
  if (p === '/wizard/thread-seen') return json(r, { state: { initializedAt: now, threads: {} } });
  if (p === '/wizard/thread-dispositions') return json(r, { state: { threads: {} } });
  if (p === '/wizard/attention') return json(r, { items: [], data: [] });
  if (p === '/wizard/cancelled-runs') return json(r, { items: [] });
  if (p === '/wizard/ai-usage') return json(r, { providers: [], accountCounts: [], fetchedAt: stamp(0) });
  if (p === '/wizard/files') return json(r, { files: [] });
  if (p === '/notifications/api/count') return json(r, { unread: 1, needs: 0 });
  if (p === '/notifications/api/items') return json(r, { items: notes });
  if (p === '/notifications/api/routes') return json(r, { routes: { notifications: 'chats' }, saved: true });
  if (p === '/notifications/api/marks') return json(r, { marks: {} });
  if (p === '/qa-form/') return r.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body style="background:#17151d;color:#eee"><label>Synthetic retained form<textarea id="qa-form"></textarea></label><a href="#local">Local navigation</a></body></html>' });
  if (optional404.has(p)) return json(r, { error: 'not_found' }, 404);
  return deny('uncatalogued request');
}
const check = (condition, name) => { assert.ok(condition, name); assertions.push(name); console.log('PASS', name); };
const shell = p => p.evaluate(() => window.__wux ? 'desktop' : 'phone');
async function settingsLook(p) { await p.evaluate(() => (window.__wux || window.__wos).openSettings('look')); await p.locator('[data-skinfamily]').first().waitFor(); }
async function closeSettings(p) { await p.evaluate(() => window.__wux ? __wux.closeSettings() : __wos.closeSheets(true)); }
function forbidAPIRequests(context) {
  // Preserve Playwright's owned _dispose lifecycle on the real object. API requests
  // bypass browser routing, so every public transport verb (including fetch) stays blocked.
  const deny = () => { throw Error('APIRequestContext forbidden in offline acceptance'); };
  for (const method of ['fetch', 'get', 'head', 'post', 'put', 'patch', 'delete'])
    Object.defineProperty(context.request, method, { value: deny, configurable: false, writable: false });
}
async function inventory(p) {
  const kind = await shell(p);
  if (kind === 'phone') { const b = p.locator('button[aria-label^="Open menu"]'); if (await b.isVisible()) await b.click(); }
  // Session polling and notification loading are independent asynchronous seams.
  // Require the fixture item to have loaded, not merely a session's first paint.
  await p.waitForFunction(() => WosBell.items().some(i => i.id === 'qa-granola-summary'), null, { timeout: 10000 });
  await p.waitForFunction(() => [...document.querySelectorAll('[data-sid]')].some(e => e.dataset.sid === 'qa-main-sync'));
  return p.locator('[data-sid]').evaluateAll(es => [...new Set(es.map(e => e.dataset.sid))].sort());
}
async function diagnoseInventory(p, expected) {
  const diagnostic = await p.evaluate(() => {
    const L = (window.__wux || window.__wos).live;
    const ids = rows => (rows || []).map(s => s.id).sort();
    const groups = L.workGroups(undefined, { flatReady: true });
    return { dom: ids([...document.querySelectorAll('[data-sid]')].map(e => ({ id: e.dataset.sid }))),
      sessions: ids(L.sessions), unified: ids(L.unified()), groups: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, ids(v)])),
      inbox: WosSkinHost.inboxList, notificationItems: ids(WosBell.items()), notificationRoutes: WosBell.routes(),
      layout: WosSkinHost.layout, experience: { busy: WosExperience.state.busy, error: WosExperience.state.error },
      sections: [...document.querySelectorAll('[data-sec]')].map(e => ({ section: e.dataset.sec, expanded: e.getAttribute('aria-expanded') })) };
  });
  const row = { shell: await shell(p), expected, ...diagnostic };
  inventories.push(row); console.log('INVENTORY', JSON.stringify(row));
}
async function screenshot(p, name) { const f = path.join(OUT, name + '.png'); await p.screenshot({ path: f, fullPage: true }); screenshots.push(f); }
(async () => {
  const contexts = []; let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.QA_CHROME || undefined, args: ['--disable-dev-shm-usage'] });
    for (const kind of ['phone', 'desktop']) {
      const context = await browser.newContext({ viewport: kind === 'phone' ? { width: 412, height: 915 } : { width: 1440, height: 1000 },
        isMobile: kind === 'phone', hasTouch: kind === 'phone', serviceWorkers: 'block',
        ...(kind === 'phone' ? { userAgent: 'Mozilla/5.0 (Linux; Android 16; SM-S938B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36' } : {}) });
      contexts.push(context);
      forbidAPIRequests(context);
      await context.route('**/*', route); await context.routeWebSocket('**/*', ws => ws.close());
      await context.addInitScript(({ kind }) => {
        localStorage.setItem('wux.shell', kind);
        localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.tour.v1', 'true'); localStorage.setItem('wos.welcome.v1', 'done'); localStorage.setItem('wos.wsync.off', 'true');
        localStorage.setItem('wos.skin', kind === 'phone' ? 'obsidian' : 'nebula');
        localStorage.setItem('wos.myskin.js.ok', 'qa-approval-' + kind);
        localStorage.setItem('wos.skin-tweaks.v1', JSON.stringify({ version: 1, preset: 'none', mix: {}, defaultsMigrated: true, machinesHomeMoved: true, defaultsOff: kind === 'desktop' ? ['wizard/unified-inbox'] : [] }));
      }, { kind });
      const p = await context.newPage(); context._qaPage = p;
      p.on('pageerror', e => failures.push(kind + ': ' + e.stack));
      await p.goto(ORIGIN + '/wizard-os-home/' + (kind === 'desktop' ? 'desktop.html' : ''), { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => (window.__wux || window.__wos)?.live.ok && WosLookSync.current.state.last === 'ok' && WosSkinHost.layout === 'ai-apps', null, { timeout: 45000 });
      await p.waitForFunction(() => (window.__welcomeLog || []).some(x => String(x).includes('boot:true:done:false')), null, { timeout: 10000 });
      check(await p.evaluate(() => !WosWelcome.active && !WosTour?.active), kind + ': real onboarding bootstrap completed without interception');
      check(await p.evaluate(() => WosSkin.current === 'obsidian' && WosSkinHost.inboxList), kind + ': colour, view and inbox converge at startup');
    }
    const phone = contexts[0]._qaPage, desktop = contexts[1]._qaPage;
    for (const p of [phone, desktop]) await p.evaluate(() => localStorage.setItem('wos.myskin.js.ok', 'qa-approval-' + (window.__wux ? 'desktop' : 'phone')));
    const want = sessions.map(s => s.id).concat(['notif:qa-granola-summary']).sort();
    for (const p of [phone, desktop]) {
      let actual;
      try { actual = await inventory(p); } finally { await diagnoseInventory(p, want); }
      assert.deepEqual(actual, want, (await shell(p)) + ': exact inventory (actual vs expected)');
      check(true, (await shell(p)) + ': exact inventory includes Main sync, old meetings, failed chat and Granola summary');
    }
    await screenshot(phone, 'phone-obsidian-inventory'); await screenshot(desktop, 'desktop-obsidian-inventory');
    // Open a real thread and retain its unsent draft while the OTHER device changes Look.
    await desktop.evaluate(() => __wux.openThread('qa-main-sync'));
    const compose = desktop.locator('[data-compose]:visible').first(); await compose.waitFor(); await compose.fill('Synthetic retained draft');
    const retained = await desktop.evaluate(() => ({ current: __wux.cur, wins: Object.values(__wux.wins).filter(w => w.app === 'chats').map(w => ({ id: w.id, thread: w.thread, focus: w.focus })) }));
    await settingsLook(phone);
    holdNext = true;
    await phone.locator('[data-skinfamily="wizard"]').click();
    await phone.waitForFunction(() => WosSkin.family === 'wizard');
    await phone.evaluate(() => document.addEventListener('click', e => { const b = e.target.closest('[data-skinpick]'); if (b) window.__qaClickPaint = { requested: b.dataset.skinpick, painted: WosSkin.current }; }));
    await phone.locator('[data-skinpick="grove"]').click();
    check(await phone.evaluate(() => WosSkin.current === 'grove' && __qaClickPaint.requested === 'grove' && __qaClickPaint.painted === 'grove'), 'phone colour click paints in its event frame before held backend write');
    await closeSettings(phone);
    const deadline = Date.now() + 10000; while (!heldWrite && Date.now() < deadline) await new Promise(r => setTimeout(r, 25));
    check(!!heldWrite, 'shared preference write really paused'); heldWrite(); heldWrite = null;
    // Do not focus/reload the desktop or invoke its sync: production foreground refresh must deliver this.
    await desktop.waitForFunction(() => WosSkin.current === 'grove', null, { timeout: 45000 });
    check(await compose.inputValue() === 'Synthetic retained draft', 'cross-device look refresh preserves unsent draft');
    check(JSON.stringify(await desktop.evaluate(() => ({ current: __wux.cur, wins: Object.values(__wux.wins).filter(w => w.app === 'chats').map(w => ({ id: w.id, thread: w.thread, focus: w.focus })) }))) === JSON.stringify(retained), 'cross-device look refresh preserves thread, focus and local desk');
    for (const p of [phone, desktop]) check(await p.evaluate(() => localStorage.getItem('wos.myskin.js.ok') === 'qa-approval-' + (window.__wux ? 'desktop' : 'phone')), (await shell(p)) + ': personal script approval stays device-local');
    await screenshot(phone, 'phone-wizard-grove'); await screenshot(desktop, 'desktop-wizard-grove-draft');
    // Real shell owns an ordinary form iframe: keep its unsaved value and own hash through a remote colour change.
    await desktop.evaluate(() => window.WizOpenApp('qa-form'));
    const frame = desktop.frameLocator('iframe[src*="/qa-form/"]'); await frame.locator('#qa-form').fill('Synthetic unsaved form');
    await frame.getByText('Local navigation', { exact: true }).click();
    await settingsLook(phone); await phone.locator('[data-skinfamily="mizel"]').click(); await phone.locator('[data-skinpick="landscapes"]').click(); await closeSettings(phone);
    await desktop.waitForFunction(() => WosSkin.current === 'landscapes', null, { timeout: 45000 });
    check(await frame.locator('#qa-form').inputValue() === 'Synthetic unsaved form', 'remote colour preserves unsaved iframe form');
    check((await frame.locator('body').evaluate(() => location.hash)) === '#local', 'remote colour preserves app-local navigation');
    // Confirm text-bearing row menu is fully opaque on the light colour; inspect screenshot too.
    await settingsLook(phone); await phone.locator('[data-skinpick="landscapes-light"]').click(); await closeSettings(phone);
    await desktop.waitForFunction(() => WosSkin.current === 'landscapes-light', null, { timeout: 45000 });
    await desktop.locator('.aad-more').first().click();
    const alpha = await desktop.locator('.aad-rowmenu').evaluate(e => { const c = getComputedStyle(e).backgroundColor; const m = c.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/); return m ? Number(m[1]) : c.startsWith('rgb(') ? 1 : 0; });
    check(alpha === 1, 'floating row-menu text panel is opaque');
    await screenshot(phone, 'phone-landscapes-light'); await screenshot(desktop, 'desktop-landscapes-light-row-menu');
    check(!requests.some(q => /\/runs(?:\/|$)|\/agents\/.*\/(start|stop)$/.test(q.path) && !['GET', 'HEAD'].includes(q.method)), 'zero agent writes');
    check(refused.length === 0, 'all browser requests remain in explicit offline fixture');
    check(failures.length === 0, 'no page exceptions');
  } catch (error) { failures.push(error.stack); console.error(error.stack); process.exitCode = 1; }
  finally {
    const save = () => fs.writeFileSync(path.join(OUT, 'browser-evidence.json'), JSON.stringify({ synthetic: true, physicalPhoneVerified: false, assertions, failures, refused, requests, screenshots, inventories }, null, 2));
    // Persist the original failure before teardown; cleanup must never erase its ledger.
    save();
    if (heldWrite) heldWrite();
    for (const [i, context] of contexts.entries()) {
      if (failures.length && context._qaPage) {
        try { await screenshot(context._qaPage, 'failure-' + (i ? 'desktop' : 'phone')); } catch (e) { failures.push('failure capture: ' + e.message); }
      }
      try { await context.close(); } catch (e) { failures.push('context cleanup: ' + e.stack); process.exitCode = 1; }
      save();
    }
    if (browser) { try { await browser.close(); } catch (e) { failures.push('browser cleanup: ' + e.stack); process.exitCode = 1; } }
    save();
  }
})();
