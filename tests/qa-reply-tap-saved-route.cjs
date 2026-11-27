'use strict';
// A reply-button tap (or a typed reply) in a thread a scheduled run posted must never fail on the model lookup
// (wizard-ux issue 1973, part 1; on for everyone). A disposable synthetic box: the Morning thread has one agent post
// with a Done button and no owner message; its list row names the thread's saved route (model + provider, the model
// lock the scheduled post set), its single-thread read (`?view=detail`) names the model but, like the Agent Service
// before the fix, no provider; and the phone's model list read fails (QA_MODELS=fail, default) or is empty
// (QA_MODELS=empty). Phone 412x915 and desktop 1440x900, Nebula, switch wizard/reply-buttons on.
//   Fixed: the tap goes as one run on the thread's saved route (claude-sonnet-5-5 / anthropic) and no "Not sent".
//   QA_DETAIL=bare also drops the thread from the list (only the single-thread read has it, like an archived thread
//   opened from its Inbox pin): the shell asks the box for the thread's saved route (QA_DETAIL=bare + QA_SAVED=1
//   answers it on the second read) and sends on it; with no saved route anywhere it shows the plain words.
//   QA_EXPECT=broken (QA_WEB=<main worktree>/web) records main: "Model provider unavailable".
// Screens in QA_OUT: <shell>-<case>.png.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://reply-tap-route.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'reply-tap-route-evidence');
const EXPECT = process.env.QA_EXPECT || 'fixed', SHELLS = (process.env.QA_SHELLS || 'phone,desktop').split(','), MODELS = process.env.QA_MODELS || 'fail';
fs.mkdirSync(out, { recursive: true });
const nap = ms => new Promise(r => setTimeout(r, ms)), iso = t => new Date(t).toISOString();
const MODEL = 'claude-sonnet-5-5', PROVIDER = 'anthropic', SID = 'wizard_1794031394533_qa0morning';
const GROUP = (group, ...b) => `[WIZARD_BUTTONS_V1]${JSON.stringify({ group, buttons: b.map(([id, label]) => ({ id, label })) })}[/WIZARD_BUTTONS_V1]`;
const POST = `Morning checklist\n\n1. Workout, 20 minutes\n${GROUP('Workout', ['done', 'Done'])}\n\n2. Read 10 pages\n${GROUP('Read', ['done', 'Done'])}`;
const AGENTS = [{ id: 'hermes', label: 'Wizard QA', harness: 'hermes', privacy: 'standard', is_default: true, status: 'running', appearance: { glyph: 'w', hue: 260 }, model: { provider: 'anthropic', model: 'claude-opus-4' } }];
const report = { origin, web, expect: EXPECT, models: MODELS, cases: [] };

function makeBox(c) {
  const t0 = Date.now() / 1000;
  const msgs = [{ id: 501, role: 'assistant', content: POST, timestamp: t0 - 60 }];
  const runs = []; let detailReads = 0, nextId = 900;
  const row = (withProvider) => ({ id: SID, title: 'Morning', runtime: 'direct', status: 'completed', updated_at: iso(t0 * 1000 - 60000), updatedAt: iso(t0 * 1000 - 60000),
    last_active: t0 - 60, message_count: msgs.length, messageCount: msgs.length, archived: false, preview: 'Morning checklist', model: MODEL,
    ...(withProvider ? { provider: PROVIDER, wizard_model_lock_updated_at: t0 - 3600 } : {}) });
  return { msgs, runs, row,
    list: () => (c.inList ? [row(true)] : []),
    detail() { detailReads++; return row(c.detailProvider || (c.savedOnSecond && detailReads > 1)); },
    get detailReads() { return detailReads; },
    run(body) { runs.push(body); msgs.push({ id: ++nextId, role: 'user', content: body.input, timestamp: Date.now() / 1000 }); return 'run_' + nextId; } };
}

async function boot(browser, box, shell, entry) {
  const phone = shell === 'phone';
  const context = await browser.newContext({ viewport: phone ? { width: 412, height: 915 } : { width: 1440, height: 900 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', ...(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' } : {}) });
  await context.routeWebSocket('**/*', w => w.close());
  await context.addInitScript(({ shell }) => {
    if (window !== top) return;
    for (const [k, v] of Object.entries({ 'wos.shell': shell, 'wux.shell': shell, 'wos.desktop-view.v1': 'classic', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': 'nebula',
      'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix: { 'wizard/reply-buttons': true } }) })) if (localStorage.getItem(k) === null || k === 'wos.skin-tweaks.v1') localStorage.setItem(k, v);
  }, { shell });
  await context.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
    if (u.origin !== origin) { entry.refused.push({ method, url: q.url(), reason: 'external' }); return r.abort(); }
    if (method === 'POST' && p === '/wizard/hermes/v1/runs') { const body = q.postDataJSON() || {}; return r.fulfill({ status: 202, json: { run_id: box.run(body), status: 'queued' } }); }
    const rm = /^\/wizard\/hermes\/v1\/runs\/([^/]+)$/.exec(p);
    if (rm && method === 'GET') return r.fulfill({ json: { run_id: rm[1], status: 'completed' } });
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
    if (p === '/wizard/hermes/api/model/options') return MODELS === 'empty' ? r.fulfill({ json: { model: '', provider: '', providers: [] } }) : r.fulfill({ status: 503, json: { error: 'models unavailable' } });
    if (p === '/wizard/v1/bootstrap') return r.fulfill({ json: { bootstrap: 1, settings: { agent: { name: 'Wizard QA' } }, capabilities: {}, endpoints: {} } });
    if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
    if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
    if (p === '/wizard/v1/agents') return r.fulfill({ json: { agents: AGENTS } });
    if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: u.searchParams.get('agent') ? [] : box.list(), has_more: false } });
    const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
    if (m) {
      if (decodeURIComponent(m[1]) !== SID) return r.fulfill({ status: 404, json: { error: 'missing' } });
      return r.fulfill({ json: m[2] ? { messages: box.msgs } : { session: box.detail() } });
    }
    return r.fulfill({ json: ownerRead(p) });
  });
  const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
  await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
  await page.waitForFunction(() => (window.__wux || window.__wos) && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy, null, { timeout: 30000 });
  await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
  return { context, page };
}
async function openMorning(page, phone, inList) {
  if (inList) {
    await page.evaluate(phone => phone ? __wos.openSheet('inbox') : __wux.openChatsList(), phone);
    const row = page.locator(`.ch-list [data-chopen="${SID}"]`).filter({ visible: true }).first();
    await row.waitFor({ timeout: 15000 }); await row.click();
  } else await page.evaluate(([phone, sid]) => phone ? __wos.openWizardThread(sid) : __wux.openThread(sid), [phone, SID]);
  await page.locator('.ch-thread .ch-rb[data-rb-group="Workout"] [data-rb]').filter({ visible: true }).first().waitFor({ timeout: 15000 });
  await nap(1200);
}
const until = async (fn, ms) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return v; await nap(200); } };
const notSent = page => page.evaluate(() => [...document.querySelectorAll('.ch-thread')].filter(n => n.getClientRects().length).map(n => n.innerText).join('\n').match(/Not sent[^\n]*(\n[^\n]*)?/)?.[0] || '');

const CASES = [
  // The live report: the thread is listed with its saved route; the single-thread read names no provider.
  { id: 'listed', inList: true, detailProvider: false, want: 'sent' },
  // Archived, opened from its pin: only the single-thread read has it. The fixed box's read names the provider.
  { id: 'pin-fixed-box', inList: false, detailProvider: true, want: 'sent' },
  // An older box that answers the provider only when asked again: the shell asks for the thread's saved route.
  { id: 'pin-asks-again', inList: false, detailProvider: false, savedOnSecond: true, want: 'sent' },
  // No saved route anywhere and no model list: plain words, nothing sent; once the box has the route, Retry sends it.
  { id: 'no-saved-route', inList: false, detailProvider: false, want: 'plain-error', retry: true },
  // A typed reply in the same thread goes the same way as a tap.
  { id: 'typed-reply', inList: false, detailProvider: false, savedOnSecond: true, want: 'sent', typed: 'On it' },
];

(async () => {
  const browser = await chromium.launch();
  try {
    for (const shell of SHELLS) for (const c0 of CASES) {
      const c = { ...c0 }; // a case's box may change during its run (Retry), never for the next shell
      const phone = shell === 'phone', stem = `${shell}-${c.id}${EXPECT === 'broken' ? '-main' : ''}`;
      const entry = { stem, case: c.id, errors: [], refused: [] }; report.cases.push(entry);
      const box = makeBox(c); let ctx;
      try {
        ctx = await boot(browser, box, shell, entry); const { page } = ctx;
        await openMorning(page, phone, c.inList);
        if (c.typed) {
          const box2 = page.locator('.ch-compose textarea').filter({ visible: true }).first();
          await box2.fill(c.typed); await page.locator('.ch-compose .ch-send').filter({ visible: true }).first().click();
        } else await page.locator('.ch-thread .ch-rb[data-rb-group="Workout"] [data-rb]').filter({ visible: true }).filter({ hasText: 'Done' }).first().click();
        await until(async () => box.runs.length > 0 || !!(await notSent(page)), 12000);
        await nap(800);
        entry.runs = box.runs.map(b => ({ model: b.model || '', provider: b.provider || '', input: String(b.input || '').split('\n')[0] }));
        entry.notSent = await notSent(page);
        entry.detailReads = box.detailReads;
        await page.screenshot({ path: path.join(out, stem + '.png') });
        if (EXPECT === 'broken') { entry.ok = true; continue; }
        if (c.want === 'sent') {
          assert.equal(box.runs.length, 1, 'the tap went as one run');
          assert.equal(box.runs[0].model, MODEL); assert.equal(box.runs[0].provider, PROVIDER, 'on the thread\'s saved route');
          assert.match(box.runs[0].input, c.typed ? new RegExp('^' + c.typed) : /^Tapped Done · Workout/);
          assert.equal(entry.notSent, '', 'no Not sent');
        } else {
          assert.equal(box.runs.length, 0, 'nothing sent without a route');
          assert.doesNotMatch(entry.notSent, /Model provider unavailable/, 'never the old words');
          assert.match(entry.notSent, /pick/i, 'plain words that say what to do');
          if (c.retry) { // the box now has the thread's saved route: Retry works it out again and sends on it
            c.detailProvider = true;
            await page.locator('.ch-thread [data-obretry]').filter({ visible: true }).first().click();
            await until(async () => box.runs.length > 0, 12000);
            entry.retried = box.runs.map(b => ({ model: b.model || '', provider: b.provider || '' }));
            assert.equal(box.runs.length, 1, 'Retry sent it once');
            assert.equal(box.runs[0].model, MODEL); assert.equal(box.runs[0].provider, PROVIDER);
            await nap(800); await page.screenshot({ path: path.join(out, stem + '-retried.png') });
          }
        }
        assert.deepEqual(entry.errors, []);
        entry.ok = true;
      } catch (e) { entry.ok = false; entry.failure = String(e.stack || e); }
      finally { await ctx?.context.close().catch(() => {}); }
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
  for (const c of report.cases) console.log(`${c.ok ? 'PASS' : 'FAIL'} ${c.stem} runs=${JSON.stringify(c.runs)} notSent=${JSON.stringify(c.notSent)}${c.retried ? ' retried=' + JSON.stringify(c.retried) : ''} detailReads=${c.detailReads}${c.failure ? '\n  ' + c.failure.split('\n')[0] : ''}`);
  process.exit(report.cases.every(c => c.ok) ? 0 : 1);
})();
