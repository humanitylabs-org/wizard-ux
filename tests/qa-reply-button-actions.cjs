'use strict';
// Reply buttons that act on an app directly, with no agent turn (wizard-ux issue 1973, part 2; switch
// wizard/reply-actions on top of the reply buttons) in a real browser. A disposable synthetic box (nothing real is
// read or written) keeps one Morning thread whose agent post has an action button (Workout: Done -> app "checklist"),
// a plain button (Read: Done) and answers POST/GET /wizard/v1/reply-actions like the Agent Service: it reads the
// action from the thread's own message, runs it against an in-memory checklist app and saves the outcome per thread.
// The model list read always fails (503) and no AI is signed in. Phone 412x915 and desktop 1440x900 (Classic).
//   QA_SWITCH=on (default): the action tap posts only {thread, message, group, button}, the app's state changes, no
//     run is sent; ✓ and the app's line show; a reload and a second device show the same; a failing app shows its
//     error with Retry and Retry works once it is back; the plain button still sends an owner message (agent turn).
//   QA_SWITCH=off: the same post renders exactly as a post without actions and a tap is an owner message, as today.
// QA_SKIN (default nebula). Screens in QA_OUT: <shell>-<skin>-<switch>[-tapped|-failed|-retried|-device2].png.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://reply-button-actions.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'reply-button-actions-evidence');
const SWITCH = process.env.QA_SWITCH || 'on', SHELLS = (process.env.QA_SHELLS || 'phone,desktop').split(','), SKIN = process.env.QA_SKIN || 'nebula';
fs.mkdirSync(out, { recursive: true });
const nap = ms => new Promise(r => setTimeout(r, ms)), iso = t => new Date(t).toISOString();
const SID = 'wizard_1794031394533_qa0actions';
const GROUP = (group, buttons) => `[WIZARD_BUTTONS_V1]${JSON.stringify({ group, buttons })}[/WIZARD_BUTTONS_V1]`;
const ACTION = { app: 'checklist', tool: 'tick', args: { step: 'workout' } };
const POST = act => `**Morning checklist**\n\n1. Workout, 20 minutes\n${GROUP('Workout', [{ id: 'done', label: 'Done', ...(act ? { action: ACTION } : {}) }])}\n\n2. Read 10 pages\n${GROUP('Read', [{ id: 'done', label: 'Done' }])}`;
const AGENTS = [{ id: 'hermes', label: 'Wizard QA', harness: 'hermes', privacy: 'standard', is_default: true, status: 'running', appearance: { glyph: 'w', hue: 260 }, model: { provider: 'anthropic', model: 'claude-opus-4' } }];
const report = { origin, web, switch: SWITCH, skin: SKIN, cases: [] };

// The synthetic box. `act`: the post's Workout button declares the app action.
function makeBox(act = true) {
  const t0 = Date.now() / 1000;
  const box = { msgs: [{ id: 501, role: 'assistant', content: POST(act), timestamp: t0 - 60 }], runs: [], taps: [], saved: new Map(), app: { ticks: [], down: false }, nextId: 900 };
  box.row = () => ({ id: SID, title: 'Morning', runtime: 'direct', status: 'completed', updated_at: iso(t0 * 1000 - 60000), updatedAt: iso(t0 * 1000 - 60000), last_active: t0 - 60,
    message_count: box.msgs.length, messageCount: box.msgs.length, archived: false, preview: 'Morning checklist', model: 'claude-sonnet-5-5', provider: 'anthropic' });
  // What the Agent Service does: the action comes from the thread's own message, never from the request.
  box.tap = body => {
    box.taps.push(body);
    const m = box.msgs.find(x => String(x.id) === String(body.message) && x.role === 'assistant');
    const g = m && [...m.content.matchAll(/\[WIZARD_BUTTONS_V1\]([\s\S]*?)\[\/WIZARD_BUTTONS_V1\]/g)].map(x => JSON.parse(x[1])).find(x => x.group === body.group);
    const b = g?.buttons.find(x => x.id === body.button);
    if (!b) return { status: 404, json: { error: 'button_not_found' } };
    if (!b.action) return { status: 409, json: { error: 'no_action' } };
    const done = box.saved.get(`${body.message}\n${body.group}`);
    if (done?.ok && done.button === body.button) return { status: 200, json: { ok: true, action: { ...done, replayed: true } } };
    let rec;
    if (box.app.down) rec = { message: String(body.message), group: body.group, button: body.button, label: b.label, ok: false, error: 'Checklist could not run tick: it is not reachable.', at: Date.now() };
    else { box.app.ticks.push(b.action.args.step); rec = { message: String(body.message), group: body.group, button: body.button, label: b.label, ok: true, line: `Workout ticked · ${box.app.ticks.length} of 4`, at: Date.now() }; }
    box.saved.set(`${body.message}\n${body.group}`, rec);
    return { status: 200, json: { ok: rec.ok, action: rec } };
  };
  return box;
}

async function boot(browser, box, shell, entry) {
  const phone = shell === 'phone';
  const context = await browser.newContext({ viewport: phone ? { width: 412, height: 915 } : { width: 1440, height: 900 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', ...(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' } : {}) });
  await context.routeWebSocket('**/*', w => w.close());
  await context.addInitScript(({ shell, on, skin }) => {
    if (window !== top) return;
    for (const [k, v] of Object.entries({ 'wos.shell': shell, 'wux.shell': shell, 'wos.desktop-view.v1': 'classic', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
      'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix: on ? { 'wizard/reply-actions': true } : {} }) })) if (localStorage.getItem(k) === null || k === 'wos.skin-tweaks.v1') localStorage.setItem(k, v);
  }, { shell, on: SWITCH === 'on', skin: SKIN });
  await context.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
    if (u.origin !== origin) { entry.refused.push({ method, url: q.url(), reason: 'external' }); return r.abort(); }
    if (p === '/wizard/v1/reply-actions') {
      if (SWITCH !== 'on') return r.fulfill({ status: 404, json: { error: 'not_found' } });
      if (method === 'POST') { const a = box.tap(q.postDataJSON() || {}); return r.fulfill({ status: a.status, json: a.json }); }
      return r.fulfill({ json: { schema: 'wizard.reply-actions/1', thread: u.searchParams.get('thread'), actions: u.searchParams.get('thread') === SID ? [...box.saved.values()] : [] } });
    }
    if (method === 'POST' && p === '/wizard/hermes/v1/runs') { const body = q.postDataJSON() || {}; box.runs.push(body); box.msgs.push({ id: ++box.nextId, role: 'user', content: body.input, timestamp: Date.now() / 1000 }); return r.fulfill({ status: 202, json: { run_id: 'run_' + box.nextId, status: 'queued' } }); }
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
    if (p === '/wizard/hermes/api/model/options') return r.fulfill({ status: 503, json: { error: 'models unavailable' } }); // no model list, no AI
    if (p === '/wizard/v1/bootstrap') return r.fulfill({ json: { bootstrap: 1, settings: { agent: { name: 'Wizard QA' } }, capabilities: {}, endpoints: {} } });
    if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
    if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
    if (p === '/wizard/v1/agents') return r.fulfill({ json: { agents: AGENTS } });
    if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: u.searchParams.get('agent') ? [] : [box.row()], has_more: false } });
    const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
    if (m) {
      if (decodeURIComponent(m[1]) !== SID) return r.fulfill({ status: 404, json: { error: 'missing' } });
      return r.fulfill({ json: m[2] ? { messages: box.msgs } : { session: box.row() } });
    }
    return r.fulfill({ json: ownerRead(p) });
  });
  const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
  await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
  await page.waitForFunction(() => (window.__wux || window.__wos) && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy, null, { timeout: 30000 });
  await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
  return { context, page };
}
async function openMorning(page, phone, restored = false) {
  // After a reload the shell may bring the open thread back by itself.
  if (restored && await page.locator('.ch-thread .ch-rb[data-rb-group="Workout"] [data-rb]').filter({ visible: true }).first().waitFor({ timeout: 6000 }).then(() => true, () => false)) { await nap(1200); return; }
  await page.evaluate(phone => phone ? __wos.openSheet('inbox') : __wux.openChatsList(), phone);
  const row = page.locator(`.ch-list [data-chopen="${SID}"]`).filter({ visible: true }).first();
  for (let i = 0; i < 20 && !(await row.isVisible().catch(() => false)); i++) { const back = page.locator('.ch-back').filter({ visible: true }).first(); if (await back.isVisible().catch(() => false)) await back.click().catch(() => {}); await nap(300); }
  await row.click();
  await page.locator('.ch-thread .ch-rb[data-rb-group="Workout"] [data-rb]').filter({ visible: true }).first().waitFor({ timeout: 15000 });
  await nap(1200);
}
const until = async (fn, ms, what) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out: ' + what); await nap(150); } };
const rowOf = (page, group) => page.evaluate(group => { const n = [...document.querySelectorAll(`.ch-thread .ch-rb[data-rb-group="${group}"]`)].find(x => x.getClientRects().length); return n ? { html: n.outerHTML, text: n.innerText.replace(/\s+/g, ' ').trim() } : null; }, group);
const doneBtn = (page, group) => page.locator(`.ch-thread .ch-rb[data-rb-group="${group}"] [data-rb]`).filter({ visible: true }).first();
// The Workout row in view, for a screenshot of the feature itself.
const shot = async (page, file) => { await page.locator('.ch-thread .ch-rb[data-rb-group="Workout"]').filter({ visible: true }).first().scrollIntoViewIfNeeded().catch(() => {}); await nap(300); await page.screenshot({ path: path.join(out, file) }); };

(async () => {
  const browser = await chromium.launch();
  try {
    for (const shell of SHELLS) {
      const phone = shell === 'phone', stem = `${shell}-${SKIN}-${SWITCH}`;
      const entry = { stem, errors: [], refused: [] }; report.cases.push(entry);
      const box = makeBox(true); let ctx, ctx2;
      try {
        ctx = await boot(browser, box, shell, entry); const { page } = ctx;
        await openMorning(page, phone);
        entry.before = await rowOf(page, 'Workout');
        await shot(page, stem + '.png');
        if (SWITCH !== 'on') {
          // Off: the post with an action renders exactly as one without, and a tap is an owner message (agent turn).
          const plainBox = makeBox(false), c3 = await boot(browser, plainBox, shell, entry);
          await openMorning(c3.page, phone);
          const plain = await rowOf(c3.page, 'Workout'); await c3.context.close();
          assert.equal(entry.before.html, plain.html, 'switch off: byte-identical to a post without actions');
          await doneBtn(page, 'Workout').click();
          await until(() => box.runs.length === 1, 12000, 'the tap went to the agent as before');
          assert.match(box.runs[0].input, /^Tapped Done · Workout/);
          assert.equal(box.taps.length, 0, 'the box is never asked');
          entry.ok = true; continue;
        }
        assert.match(entry.before.html, /ch-rb-acts/);
        // 1. The action tap: only which button, the app changes, no run.
        await doneBtn(page, 'Workout').click();
        await until(async () => /Workout ticked/.test((await rowOf(page, 'Workout'))?.text || ''), 12000, 'the app line shows');
        entry.tapped = await rowOf(page, 'Workout');
        assert.deepEqual(box.taps[0], { thread: SID, message: '501', group: 'Workout', button: 'done' });
        assert.deepEqual(box.app.ticks, ['workout'], 'the app\'s own state changed');
        assert.match(entry.tapped.text, /✓ Done/); assert.match(entry.tapped.text, /Workout ticked · 1 of 4/);
        await shot(page, stem + '-tapped.png');
        await nap(4000); // past the reply-button batch window: nothing went to the agent
        assert.equal(box.runs.length, 0, 'no agent run, no model call');
        assert.doesNotMatch(await page.locator('.ch-thread').filter({ visible: true }).first().innerText(), /Not sent|Model provider/);
        // 2. Reload: the box's saved outcome.
        await page.reload(); await page.waitForFunction(() => (window.__wux || window.__wos) && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy, null, { timeout: 30000 });
        await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
        await openMorning(page, phone, true);
        await until(async () => /Workout ticked/.test((await rowOf(page, 'Workout'))?.text || ''), 12000, 'after a reload');
        // 3. A second device.
        ctx2 = await boot(browser, box, shell, entry);
        await openMorning(ctx2.page, phone);
        await until(async () => /✓ Done.*Workout ticked · 1 of 4/.test((await rowOf(ctx2.page, 'Workout'))?.text || ''), 12000, 'on a second device');
        await shot(ctx2.page, stem + '-device2.png');
        assert.deepEqual(box.app.ticks, ['workout'], 'shown, never run again');
        await ctx2.context.close(); ctx2 = null;
        // 4. A failing app: inline error with Retry; Retry once it is back.
        box.saved.clear(); box.app.down = true;
        await ctx.context.close(); ctx = await boot(browser, box, shell, entry);
        await openMorning(ctx.page, phone);
        await doneBtn(ctx.page, 'Workout').click();
        await until(async () => /didn’t go through/.test((await rowOf(ctx.page, 'Workout'))?.text || ''), 12000, 'the failure shows');
        entry.failed = await rowOf(ctx.page, 'Workout');
        assert.match(entry.failed.text, /Done didn’t go through · Checklist could not run tick: it is not reachable\. Retry/);
        await shot(ctx.page, stem + '-failed.png');
        box.app.down = false;
        await ctx.page.locator('.ch-thread .ch-rb[data-rb-group="Workout"] [data-rb-retry]').filter({ visible: true }).first().click();
        await until(async () => /Workout ticked/.test((await rowOf(ctx.page, 'Workout'))?.text || ''), 12000, 'Retry works').catch(async e => { entry.debug = { taps: box.taps, row: await rowOf(ctx.page, 'Workout') }; throw e; });
        entry.retried = await rowOf(ctx.page, 'Workout');
        assert.deepEqual(box.app.ticks, ['workout', 'workout']);
        await shot(ctx.page, stem + '-retried.png');
        // 5. A button without an action: an owner message, the agent answers (as today).
        await doneBtn(ctx.page, 'Read').click();
        await until(() => box.runs.length === 1, 12000, 'the plain button went to the agent');
        assert.match(box.runs[0].input, /^Tapped Done · Read/);
        assert.equal(box.runs[0].provider, 'anthropic', 'on the thread\'s saved route with no model list');
        assert.deepEqual(entry.errors, []);
        entry.ok = true;
      } catch (e) { entry.ok = false; entry.failure = String(e.stack || e); }
      finally { await ctx2?.context.close().catch(() => {}); await ctx?.context.close().catch(() => {}); }
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(out, `report-${SKIN}-${SWITCH}.json`), JSON.stringify(report, null, 2));
  for (const c of report.cases) console.log(`${c.ok ? 'PASS' : 'FAIL'} ${c.stem} before=${JSON.stringify(c.before?.text)} tapped=${JSON.stringify(c.tapped?.text)} failed=${JSON.stringify(c.failed?.text)} retried=${JSON.stringify(c.retried?.text)}${c.debug ? '\n  debug=' + JSON.stringify(c.debug) : ''}${c.failure ? '\n  ' + c.failure.split('\n').slice(0, 3).join('\n  ') : ''}`);
  process.exit(report.cases.every(c => c.ok) ? 0 : 1);
})();
