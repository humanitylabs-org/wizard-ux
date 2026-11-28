'use strict';
// wizard-ux issue 1961 in a real browser: a reply with tap-to-answer buttons was drawn twice. The thread's history
// already holds the reply (stored once); the run is still listed as working, so opening the thread subscribes to its
// stream, which replays the same reply from its first event. Before the fix the replay stayed under the reply as a
// second copy ("Replying…/Finishing…") because the transcript's plain text keeps the buttons' labels and the stream
// drops them. Main and routed threads (host profile, container, restricted agents) each. While the replay is still arriving (no terminal frame yet) it may show as before (a new run can begin
// with an old answer's words); once the run has ended it must be gone. Phone 412x915 and desktop 1440x900 (Classic), Nebula and Grove, reply buttons on for everyone.
// Synthetic transport only: EventSource is faked (the test pushes the frames), writes are refused or answered in memory.
//   QA_EXPECT=broken (QA_WEB=<main checkout>/web) records main: two copies.
// Screens in QA_OUT: <shell>-<skin>[-main].png (+ -reload).
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://reply-buttons-replay.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'reply-buttons-replay-evidence');
const EXPECT = process.env.QA_EXPECT || 'fixed', SHELLS = (process.env.QA_SHELLS || 'phone,desktop').split(','), SKINS = (process.env.QA_SKINS || 'nebula,grove').split(',');
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const KINDS = (process.env.QA_KINDS || 'main,host,container,restricted').split(',');
const sidOf = k => k === 'main' ? 'qa-badge' : 'qa-badge-' + k, runOf = k => 'run-' + sidOf(k);
const GROUP = '[WIZARD_BUTTONS_V1]{"group":"Badge styling tweaks","buttons":[{"id":"all","label":"File all three"},{"id":"two","label":"Only 1 and 2"},{"id":"leave","label":"Leave it"}]}[/WIZARD_BUTTONS_V1]';
const REPLY = "Yes. The badge is cut off because it's placed against our guess of the icon's edge.\n\nThese are the minor fixes I'd make, all inside the icon:\n\n1. A smaller badge\n2. Inset by two pixels\n3. A thin ring in the page colour\n\n" + GROUP + '\n\n[WIZARD_STATUS_V1]{"state":"done","ask":"Pick which tweaks to file"}[/WIZARD_STATUS_V1]';
const STATUS_RE = /\s*\[WIZARD_STATUS_V1\][\s\S]*$/; // the Agent Service serves the status line as wizard_ask; the stream still carries it
const AGENTS = [{ id: 'hermes', label: 'Wizard QA', harness: 'hermes', privacy: 'standard', is_default: true, status: 'running', appearance: { glyph: 'w', hue: 260 }, model: { provider: 'anthropic', model: 'claude-opus-4' } }];
for (const id of ['host', 'container', 'restricted']) AGENTS.push({ id, label: 'Agent ' + id, harness: 'hermes', privacy: 'standard', status: 'running', appearance: { glyph: id[0], hue: 120 }, model: { provider: 'anthropic', model: 'claude-opus-4' } });
// A long thread: earlier turns (some compacted-history style repeats of older user lines), then the reply with buttons.
const HISTORY = [];
for (let i = 0; i < 12; i++) HISTORY.push({ id: 4400000 + i * 2, role: 'user', content: `Earlier question ${i + 1}?`, timestamp: now / 1000 - 9000 + i * 600 },
  { id: 4400001 + i * 2, role: 'assistant', content: `Earlier answer ${i + 1}: the launch needs a date, a venue and a short list of people.`, timestamp: now / 1000 - 8990 + i * 600 });
HISTORY.push({ id: 4450700, role: 'user', content: 'Why is the Messenger badge cut off?', timestamp: now / 1000 - 90 }, { id: 4450724, role: 'assistant', content: REPLY.replace(STATUS_RE, ''), wizard_ask: 'Pick which tweaks to file', timestamp: now / 1000 - 30 });
const rowOf = k => ({ id: sidOf(k), title: 'WizardOS Messenger Badge ' + k, runtime: 'direct', status: 'running', updated_at: iso(now - 30e3), updatedAt: iso(now - 30e3), last_active: now / 1000 - 30,
  message_count: HISTORY.length, messageCount: HISTORY.length, archived: false, preview: 'Yes. The badge is cut off', wizard_run_id: runOf(k), wizard_assigned_at: iso(now - 90e3), ...(k === 'main' ? {} : { agent: k }) });
const ROWS = KINDS.map(rowOf);

async function boot(browser, shell, skin, entry) {
  const phone = shell === 'phone';
  const context = await browser.newContext({ viewport: phone ? { width: 412, height: 915 } : { width: 1440, height: 900 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', ...(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' } : {}) });
  await context.routeWebSocket('**/*', w => w.close());
  await context.addInitScript(({ shell, skin }) => {
    if (window !== top) return;
    for (const [k, v] of Object.entries({ 'wos.shell': shell, 'wux.shell': shell, 'wos.desktop-view.v1': 'classic', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
      'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix: {} }) })) localStorage.setItem(k, v);
    const open = window.__qaES = []; let seq = 0;
    window.EventSource = class { constructor(url) { this.url = url; this.on = {}; open.push(this); setTimeout(() => this.onopen?.(), 0); }
      addEventListener(n, f) { (this.on[n] ||= []).push(f); } removeEventListener() {} close() { this.closed = true; } };
    const send = (sid, o) => { const run = 'run-' + sid, data = JSON.stringify({ session_id: sid, run_id: run, seq: ++seq, ...o }); for (const s of open) if (!s.closed && s.url.includes(run)) s.onmessage?.({ data, type: 'message', lastEventId: String(seq) }); };
    window.__qaPush = (sid, delta) => send(sid, { event: 'message.delta', delta });
    window.__qaEnd = sid => send(sid, { event: 'run.completed' });
  }, { shell, skin });
  await context.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url()), p = u.pathname, method = q.method();
    if (u.origin !== origin) { entry.refused.push({ method, url: q.url() }); return r.abort(); }
    if (!['GET', 'HEAD'].includes(method)) {
      if (method === 'PUT' && p === '/wizard/thread-seen') return r.fulfill({ json: { ok: true, state: q.postDataJSON() } });
      if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
      entry.refused.push({ method, path: p }); return r.fulfill({ status: 405, json: { error: 'Synthetic fixture refuses this write' } });
    }
    // The reader has read the thread up to the earlier answers: only the reply with buttons is new.
    if (p === '/wizard/thread-seen') return r.fulfill({ json: { state: { initializedAt: now - 864e5, threads: Object.fromEntries(KINDS.map(k => [(k === 'main' ? '' : `agent/${k}/`) + 'direct:' + sidOf(k), { messageCount: HISTORY.length - 2, status: 'completed', updatedAt: iso(now - 2390e3), previewFingerprint: 'x', assistantActivityAt: iso(now - 2390e3), seenAt: now - 2000e3 }])) } } });
    if (p === prefix + 'installed-apps.json') return r.fulfill({ json: { apps: [] } });
    if (p.startsWith(prefix)) {
      const abs = path.resolve(web, decodeURIComponent(p.slice(prefix.length) || 'index.html'));
      if (!abs.startsWith(path.resolve(web) + path.sep)) return r.abort();
      return fs.existsSync(abs) && fs.statSync(abs).isFile() ? r.fulfill({ path: abs }) : r.fulfill({ status: 404, body: 'none' });
    }
    if (p === '/wizard/v1/bootstrap') return r.fulfill({ json: { bootstrap: 1, settings: { agent: { name: 'Wizard QA' } }, capabilities: {}, endpoints: {} } });
    if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
    if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
    if (p === '/wizard/v1/agents') return r.fulfill({ json: { agents: AGENTS } });
    const run = /^\/wizard\/hermes\/v1\/runs\/run-(qa-badge[-a-z]*)$/.exec(p);
    if (run) return r.fulfill({ json: { run_id: 'run-' + run[1], session_id: run[1], status: 'running' } });
    if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: ROWS.filter(x => (x.agent || '') === (u.searchParams.get('agent') || '')), has_more: false } });
    const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
    if (m) { const row = ROWS.find(x => x.id === decodeURIComponent(m[1])); if (!row) return r.fulfill({ status: 404, json: {} }); return r.fulfill({ json: m[2] ? { messages: HISTORY } : { session: row } }); }
    return r.fulfill({ json: ownerRead(p) });
  });
  const page = await context.newPage(); page.on('pageerror', e => entry.errors.push(e.message));
  await page.goto(origin + prefix + (phone ? 'index.html?phone' : 'desktop.html'));
  await page.waitForFunction(() => (window.__wux || window.__wos) && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy, null, { timeout: 30000 });
  await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
  return { context, page };
}
async function openThread(page, phone, sid) {
  await page.evaluate(phone => phone ? __wos.openSheet('inbox') : __wux.openChatsList(), phone);
  const row = page.locator(`.ch-list [data-chopen="${sid}"]`).filter({ visible: true }).first();
  for (let i = 0; i < 20 && !(await row.isVisible().catch(() => false)); i++) { const back = page.locator('.ch-back').filter({ visible: true }).first(); if (await back.isVisible().catch(() => false)) await back.click().catch(() => {}); await nap(300); }
  await row.click();
  await page.locator('.ch-thread .msg.a').filter({ visible: true }).first().waitFor({ timeout: 15000 });
  await page.waitForFunction(run => window.__qaES.some(s => !s.closed && s.url.includes(run)), 'run-' + sid, { timeout: 15000 });
  await nap(600);
}
// What the thread shows: copies of the reply's words, button groups, the streaming bubble, the jump pills.
const facts = page => page.evaluate(() => {
  const th = [...document.querySelectorAll('.ch-thread')].find(n => n.getClientRects().length);
  const vis = sel => [...th.querySelectorAll(sel)].filter(n => n.getClientRects().length);
  return { copies: vis('.msg.a .bub').filter(n => n.textContent.includes('The badge is cut off')).length,
    groups: vis('.ch-rb').length, streaming: vis('[data-streaming]').length,
    pills: [...document.querySelectorAll('[data-chjump]')].filter(n => !n.hidden && n.getClientRects().length).map(n => n.textContent.trim()) };
});

(async () => {
  const browser = await chromium.launch(), report = { web, expect: EXPECT, cases: [] };
  try {
    for (const shell of SHELLS) for (const skin of SKINS) {
      const phone = shell === 'phone', stem = `${shell}-${skin}${EXPECT === 'broken' ? '-main' : ''}`, entry = { stem, errors: [], refused: [] }; report.cases.push(entry);
      let ctx;
      try {
        ctx = await boot(browser, shell, skin, entry); const { page } = ctx;
        entry.kinds = {};
        for (const k of KINDS) {
          const sid = sidOf(k), e = entry.kinds[k] = {};
          await openThread(page, phone, sid);
          e.before = await facts(page);
          // The run replays from its first event: the whole reply in a few chunks, then the terminal frame.
          for (let i = 0; i < REPLY.length; i += 60) { await page.evaluate(([sid, d]) => window.__qaPush(sid, d), [sid, REPLY.slice(i, i + 60)]); await nap(20); }
          await nap(300); e.during = await facts(page);
          await page.evaluate(sid => window.__qaEnd(sid), sid); await nap(1500);
          e.after = await facts(page);
          await page.evaluate(() => { const b = [...document.querySelectorAll('.ch-thread .ch-rb')].find(n => n.getClientRects().length); b?.scrollIntoView({ block: 'center' }); });
          await nap(300); await page.screenshot({ path: path.join(out, `${stem}-${k}.png`) });
        }
        // Reload: each thread, still listed as working, replays again on a fresh subscriber.
        await page.reload(); await page.waitForFunction(() => (window.__wux || window.__wos) && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy, null, { timeout: 30000 });
        await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
        for (const k of KINDS) {
          const sid = sidOf(k);
          await openThread(page, phone, sid);
          await page.evaluate(([sid, r]) => { window.__qaPush(sid, r); window.__qaEnd(sid); }, [sid, REPLY]); await nap(1500);
          entry.kinds[k].reload = await facts(page);
          if (k === 'main') await page.screenshot({ path: path.join(out, stem + '-reload.png') });
        }
        if (EXPECT === 'broken') { entry.pass = Object.values(entry.kinds).every(e => e.after.copies > 1 || e.after.streaming > 0); continue; }
        for (const [kind, e] of Object.entries(entry.kinds)) for (const k of ['before', 'after', 'reload']) {
          assert.equal(e[k].copies, 1, `${stem} ${kind} ${k}: one copy of the reply: ${JSON.stringify(e[k])}`);
          assert.equal(e[k].groups, 1, `${stem} ${kind} ${k}: one set of buttons`);
          assert.equal(e[k].streaming, 0, `${stem} ${kind} ${k}: no second (streaming) copy`);
          assert.ok(!e[k].pills.some(t => /New/.test(t)), `${stem} ${kind} ${k}: the drawn reply is not counted as New: ${e[k].pills}`);
        }
        assert.equal(entry.errors.length, 0, 'browser errors: ' + entry.errors.join('; '));
        entry.pass = true;
      } catch (e) { entry.pass = false; entry.failure = e.message; }
      finally { await ctx?.context.close(); }
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(out, 'report' + (EXPECT === 'broken' ? '-main' : '') + '.json'), JSON.stringify(report, null, 2));
  for (const c of report.cases) console.log(c.pass ? 'PASS' : 'FAIL', c.stem, JSON.stringify(c.kinds), c.failure || '');
  process.exit(report.cases.every(c => c.pass) ? 0 : 1);
})();
