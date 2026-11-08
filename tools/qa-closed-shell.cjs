'use strict';
// Offline, synthetic only. Browser execution belongs to the forum queue, never the VPS.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium, devices } = require('./qa-playwright.cjs');
const TREE = path.resolve(process.env.QA_TREE || path.join(__dirname, '..')), OUT = process.env.QA_OUT;
assert(OUT, 'QA_OUT required'); fs.mkdirSync(OUT, { recursive: true });
const ORIGIN = 'http://wizard-qa.invalid', PREFIX = '/wizard-os-home/';
const FIXTURE_NOW = Date.parse('2026-11-04T12:00:00Z'), USER_AT = (FIXTURE_NOW - 180000) / 1000;
const report = { source: process.env.QA_SOURCE_SHA, synthetic: true, cases: [], requests: [], refusedWrites: [], unknown: [], errors: [], captures: [] };
const json = (r, body, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const raw = (id, at, attention = 'needs_you', extra = {}) => ({ id, title: 'Synthetic ' + id, runtime: 'direct', status: 'completed', source: 'api_server',
  created_at: USER_AT - 60, last_user_at: USER_AT, last_active: at / 1000, preview_at: at / 1000, last_assistant_at: at / 1000,
  preview: 'Synthetic answer — no private data', preview_role: 'assistant', last_role: 'assistant', message_count: 2,
  latest_message: { role: 'assistant', content: extra.preview || 'Synthetic answer — no private data', timestamp: at / 1000 },
  wizard_attention: { state: attention, ask: 'Synthetic ' + attention + ' status', subject: 'Synthetic QA' }, ...extra });
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
async function boot(phone, configure, evidenceSink = null, chatActions = null) {
  // No arbitrary origin override: only a live server created by our evidence helper.
  const origin = evidenceSink ? require('./qa-recorder-stop-evidence.cjs').origin(evidenceSink) : ORIGIN;
  const c = await browser.newContext({ ...(phone ? devices['Pixel 7'] : { viewport: { width: 1440, height: 900 } }), deviceScaleFactor: 1, serviceWorkers: 'block' });
  await c.routeWebSocket('**/*', w => w.close());
  const at = FIXTURE_NOW - 120000;
  const s = { rows: [raw('badge-read-ready', at)], seen: { initializedAt: 1, threads: { 'direct:badge-read-ready': { seenAt: at + 1000, assistantActivityAt: new Date(at).toISOString() } } } };
  s.preferences = { migrations: {}, ...(chatActions ? { chatAfterAction: chatActions.after || 'stay' } : {}) };
  if (chatActions) s.rows = chatActions.rows || [raw('badge-read-ready', at), raw('badge-other-ready', at - 1000)];
  s.actionWrites = [];
  const launcherContext = { window: {} };
  require('node:vm').runInNewContext(fs.readFileSync(path.join(TREE, 'web/core/launcher-defaults.js'), 'utf8'), launcherContext);
  const launcherDefaults = JSON.parse(JSON.stringify(launcherContext.window.WizLauncherDefaults));
  await c.addInitScript(phone => {
    if (window !== window.top) return;
    for (const [k, v] of Object.entries({ 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': 'nebula', 'wux.shell': phone ? 'phone' : 'desktop' })) localStorage.setItem(k, v);
  }, phone);
  // Exact read contracts from this tree's consumers; no catch-all owner/API fallback.
  const reads = new Map([
    ['/wizard/v1/agents', { agents: [] }],
    ['/wizard/v1/agent-options', { harnesses: [], providers: [], presets: [], wizard_apps: [], agent_apps: [], outside_tools: [] }],
    ['/wizard/v1/app-bindings', { bindings: [] }],
    // notif-bell.js getFeed: synthetic Recorder has no pending inbox items.
    ['/mizel/api/inbox', { inbox: 1, items: [] }],
    // app-setup/store-router: this synthetic app declares no model/service requirements.
    ['/wizard-os-home/store-data/router/v1/needs/mizel', { app_id: 'mizel', models: [], services: [], ready_to_open: true }],
    ['/wizard/v1/skins', { skins: [], active: null }],
    ['/wizard/v1/pages', { pages: [] }],
    ['/wizard/v1/schedules', { schedules: [] }],
    ['/wizard/attention', { attention: [] }],
    ['/wizard/thread-dispositions', { state: {} }],
    ['/wizard/v1/setup', { first_run: false }],
    // Settings/desktop reads only: this offline fixture has no pairing or host metrics.
    ['/wizard/v1/setup/phone', { step: 'unavailable', phones: [] }],
    ['/api/system/load', { available: false, reason: 'synthetic fixture has no host metrics' }],
    ['/api/system/devices', { devices: [] }],
    ['/api/system/health', { available: false, reason: 'synthetic fixture has no host health' }],
    ['/wizard/ai-usage', { fetchedAt: new Date(FIXTURE_NOW).toISOString(), providers: [] }],
    ['/wizard-os-home/store-install/_updates', { mode: 'ask', chosen: true, installed: 'synthetic', latest: 'synthetic', update_available: false, unpinned: false, installing: false, interrupted: false }],
    ['/wizard-os-home/store-data/wizard/v1/installed-apps', { wam: [], shell: [], complete: true }],
    ['/wizard-os-home/store-data/wizard/v1/app-logos', { logos: {} }],
  ]);
  await c.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url()), p = u.pathname, method = q.method();
    report.requests.push({ method, path: p + u.search });
    if (u.origin !== origin) { report.unknown.push({ method, url: u.href }); return r.abort('blockedbyclient'); }
    // Optional action regression mode: only declared synthetic records can be changed, only in memory.
    if (chatActions && !['GET', 'HEAD'].includes(method)) {
      let body; try { body = q.postDataJSON(); } catch (_) { body = null; }
      const record = { u: p, body: q.postData() || '', method };
      if (method === 'PUT' && p === '/wizard/v1/ui-preferences') {
        assert.deepEqual(Object.keys(body), ['chatAfterAction']); assert(['stay','list'].includes(body.chatAfterAction));
        Object.assign(s.preferences, body); return json(r, s.preferences);
      }
      const match = p.match(/^\/wizard\/hermes\/api\/sessions\/([A-Za-z0-9_-]+)$/);
      if (match && method === 'PATCH') { const row = s.rows.find(x => x.id === match[1]); assert(row, 'only declared synthetic thread'); Object.assign(row, body); s.actionWrites.push(record); return json(r, { session: row }); }
      if (p === '/wizard/hermes/v1/runs' && method === 'POST') { s.actionWrites.push(record); return chatActions.hold ? json(r, { error: 'synthetic offline' }, 503) : json(r, { run_id: 'synthetic-run', status: 'queued' }, 202); }
      if (p === '/wizard/hermes/api/sessions' && method === 'POST') { s.actionWrites.push(record); return json(r, { session: { id: 'badge-new-chat' } }); }
      if (p === '/wizard/voice/transcribe' && method === 'POST') return json(r, { text: 'Synthetic voice reply', ms: 1 });
      if (p === '/wizard/v1/route' && method === 'POST') return json(r, chatActions.router?.answer || { cmd: { route: 'view' }, ms: 1 });
      if (p === '/wizard/boomerang' && method === 'POST') return json(r, { ok: true });
      if (p === '/wizard/thread-dispositions' && method === 'PUT') { assert(s.rows.some(x => x.id === body.sessionId)); return json(r, { record: { deferred: body.deferred, updatedAt: new Date(FIXTURE_NOW).toISOString() } }); }
    }
    // Only synthetic read receipts are accepted, in memory. All other writes (including sends) are refused.
    if (method === 'PUT' && p === '/wizard/thread-seen' && !u.search) {
      const next = q.postDataJSON();
      assert(next && typeof next.threads === 'object' && Object.keys(next.threads).every(k => s.rows.some(x => k === 'direct:' + x.id)), 'only synthetic thread receipts');
      s.seen = { ...s.seen, threads: { ...s.seen.threads, ...next.threads } }; return json(r, { state: s.seen });
    }
    // launcher.js owns this exact bootstrap migration; synthetic, in-memory and idempotent.
    if (method === 'POST' && p === '/wizard/v1/ui-preferences/seed' && !u.search) {
      const next = q.postDataJSON();
      assert.deepEqual(Object.keys(next).sort(), ['launcher', 'marker']);
      assert.equal(next.marker, 'launcher-seed-v1');
      assert.deepEqual(next.launcher, launcherDefaults, 'only pinned synthetic launcher defaults');
      if (!s.preferences.migrations[next.marker]) s.preferences = { ...s.preferences, launcher: next.launcher, migrations: { [next.marker]: true } };
      (report.mutations ??= []).push({ method, path: p, marker: next.marker, synthetic: true });
      return json(r, { preferences: s.preferences });
    }
    if (!['GET', 'HEAD'].includes(method)) { report.refusedWrites.push({ method, path: p }); return json(r, { error: 'fixture refuses owner writes' }, 403); }
    if (p === '/wizard/v1/my-skin' && !u.search) return r.fulfill({ contentType: 'text/css', body: '/* Synthetic QA: no personal CSS. */' });
    if (p === '/wizard/v1/my-skin' && u.search === '?format=json') return json(r, { exists: false, bytes: 0, script: { exists: false, bytes: 0 } });
    // This fixture has no cross-device sync service. Its source-defined 404 stops polling,
    // unlike an immediate constant-revision 200, which creates an unbounded long-poll loop.
    if (p === '/wizard/v1/workspaces' && /^\?since=-?\d+&wait=(?:0|25)$/.test(u.search)) return json(r, { error: 'not_found' }, 404);
    if (p === '/wizard-os-home/store-install/_connections/' && !u.search) return json(r, { error: 'not_found' }, 404);
    if (reads.has(p) && !u.search) return json(r, reads.get(p));
    if (p === '/wizard/v1/pages/wizard-look/look.json') return json(r, { error: 'no synthetic synced Look yet' }, 404);
    if (p === '/troubleshoot/api/ping') return json(r, { ok: true });
    if (p === '/troubleshoot/api/status') return json(r, { checks: [{ id: 'agent-service', ok: true }], ok: true });
    if (p === '/wizard-tinfoil/api/status') return json(r, { ready: false, configured: false });
    if (p === '/wizard-claude/api/accounts') return json(r, { accounts: [] });
    if (p === '/notifications/api/routes') return json(r, { routes: {} });
    if (p === '/notifications/api/marks') return json(r, { marks: {} });
    if (p === '/notifications/api/items') return json(r, { items: [] });
    if (p === '/notifications/api/count') return json(r, { unread: 0, needs: 0 });
    if (p === '/wizard/v1/bootstrap') return json(r, { bootstrap: 1, settings: { owner: { name: 'Synthetic QA' }, agent: { name: 'Synthetic Wizard' }, clock: { timezone: 'UTC' } }, endpoints: { apps: '/wizard/v1/apps', ...(chatActions ? { transcribe: '/wizard/voice/transcribe', route: '/wizard/v1/route', sessions: '/wizard/hermes/api/sessions', runs: '/wizard/hermes/v1/runs' } : {}) }, capabilities: chatActions ? { voice: true, router: true, steer: true, markdown: true } : {} });
    if (p === '/wizard/v1/apps') return json(r, { apps: [] });
    if (p === '/wizard/hermes/api/sessions') return json(r, { object: 'list', data: s.rows, has_more: false, limit: 100, offset: 0 });
    if (p === '/wizard/thread-seen') return json(r, { state: s.seen });
    if (p === '/wizard/v1/ui-preferences' && !u.search) return json(r, s.preferences);
    if (p === '/wizard/hermes/api/model/options') return json(r, { provider: 'qa', model: 'synthetic', providers: [{ slug: 'qa', name: 'Synthetic QA', authenticated: true, is_current: true, models: [{ id: 'synthetic', name: 'Synthetic' }] }] });
    const m = p.match(/^\/wizard\/hermes\/api\/sessions\/((?:badge-[a-z-]+|qa_return_\d+))(\/messages)?$/);
    if (m) { const item = s.rows.find(x => x.id === m[1]); if (!item) return json(r, { error: 'no synthetic thread' }, 404);
      return json(r, m[2] ? { data: [{ role: 'user', content: 'Synthetic question', timestamp: item.last_user_at }, { role: 'assistant', content: item.preview, timestamp: item.last_active }], has_more: false } : { session: item }); }
    if (p === PREFIX + 'data.js' || p === PREFIX + 'summaries.js') return r.fulfill({ contentType: 'application/javascript', body: '/* Synthetic QA: generated owner data intentionally absent. */' });
    // Build-generated version marker is absent in a Git export. Do not synthesize an
    // update version: a mismatch could start an unrelated update/reload during the test.
    if (p === PREFIX + 'ux-version.txt' && !u.search) return r.fulfill({ status: 404, contentType: 'text/plain', body: 'No generated version marker in synthetic source export.' });
    if (p === PREFIX + 'ux-changes.json') return json(r, []);
    if (p.startsWith(PREFIX)) {
      const root = path.join(TREE, 'web'), file = path.resolve(root, decodeURIComponent(p.slice(PREFIX.length) || 'index.html'));
      if (file.startsWith(root + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) return r.fulfill({ path: file });
    }
    if (p === '/favicon.ico') return r.fulfill({ status: 204, body: '' });
    report.unknown.push({ method, path: p + u.search }); return json(r, { error: 'uncatalogued synthetic request' }, 451);
  });
  if (configure) await configure(c);
  page = await c.newPage(); page.on('pageerror', e => report.errors.push(String(e)));
  await page.clock.install({ time: new Date(FIXTURE_NOW) });
  await page.goto(origin + PREFIX + (phone ? '' : 'desktop.html') + '?shell=' + (phone ? 'phone' : 'desktop') + '&view=chats');
  await page.waitForFunction(() => window.WizLive?.ok && document.documentElement.dataset.shell &&
    window.WosWelcome?.log.some(x => x === 'deeplink' || x === 'boot:true:done:false'));
  assert.equal(await page.evaluate(() => WosWelcome.active || !!document.getElementById('wosWelcome')), false, 'established owner boot must not show Welcome');
  assert.equal(await page.evaluate(() => WosSkin.current), 'nebula', 'initial real palette applied');
  return { c, s, at };
}
module.exports = { boot, settle, report, setBrowser: b => { browser = b; }, getPage: () => page };
