'use strict';
// Issue 1942 in a real browser: a reporter rewrite of a reply that carries a button group (scheduled report, then the
// hidden "[reporter] ... Rewrite it now" row, then the rewrite with the same group) shows ONE text and ONE set of
// buttons, from the rewrite. A tap made earlier on the original's message still shows as the pick; a tap on the survivor
// sends the usual "Tapped ... · <group>" line and is picked again after a reload; a turn with two different group names
// keeps both. Disposable synthetic box (nothing real read or written), switch wizard/reply-buttons on, phone 412x915 and
// desktop 1440x900, skins in QA_SKINS (default nebula,grove). QA_EXPECT=broken (QA_WEB=<main>/web) records main.
// Screens in QA_OUT: <shell>-<skin>.png.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://reply-buttons-rewrite.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'reply-buttons-rewrite-evidence');
const SWITCH = 'on', EXPECT = process.env.QA_EXPECT || 'fixed', SHELLS = (process.env.QA_SHELLS || 'phone,desktop').split(',');
const SKINS = (process.env.QA_SKINS || 'nebula,grove').split(',');
let SKIN = SKINS[0];
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const GROUP = (group, ...b) => `[WIZARD_BUTTONS_V1]${JSON.stringify({ group, buttons: b.map(([id, label]) => ({ id, label })) })}[/WIZARD_BUTTONS_V1]`;
const BAR = GROUP('Four-section phone bar', ['yes', 'Yes, on for everyone'], ['try', 'Let me try it first'], ['no', 'No, drop it']);
const ORIGINAL = `Phone bar: the four-section bar is built and behind its switch.\n${BAR}`;
const REWRITE = `**Phone navigation redesign** is ready for your call.\n\nThe four-section bar (Home, Chats, Messenger, Apps) is built and off by default.\n${BAR}`;
const REPORTER = '[reporter] Your last report does not meet the report format: no status line. Rewrite it now in the format, nothing else.\n\nreport=status';
const AGENTS = [{ id: 'hermes', label: 'Wizard QA', harness: 'hermes', privacy: 'standard', is_default: true, status: 'running', appearance: { glyph: 'w', hue: 260 }, model: { provider: 'anthropic', model: 'claude-opus-4' } }];
const report = { origin, web, expect: EXPECT, cases: [] };
const tapsMsg = (sid, message, button, label) => `Tapped ${label} · Four-section phone bar\n[WIZARD_TAPS_V1]${JSON.stringify({ taps: [{ thread: sid, message, group: 'Four-section phone bar', button, label }] })}[/WIZARD_TAPS_V1]`;

function makeBox() {
  const t0 = now / 1000;
  const rewrite = () => [{ id: 4449732, role: 'assistant', content: ORIGINAL, timestamp: t0 - 300 }, { id: 4449733, role: 'user', content: REPORTER, timestamp: t0 - 290 },
    { id: 4449734, role: 'assistant', content: REWRITE, timestamp: t0 - 200 }];
  const threads = {
    'qa-rw': { agent: '', title: 'Phone navigation redesign', msgs: rewrite() },
    'qa-rw-old-tap': { agent: '', title: 'Tapped on the original', msgs: [...rewrite(), { id: 4449740, role: 'user', content: tapsMsg('qa-rw-old-tap', '4449732', 'try', 'Let me try it first'), timestamp: t0 - 100 }] },
    'qa-two': { agent: '', title: 'Two groups', msgs: [{ id: 501, role: 'user', content: 'Plan?', timestamp: t0 - 400 }, { id: 502, role: 'assistant', content: `Desks first.\n${GROUP('Ship desks', ['go', 'Go for it'], ['drop', 'Drop this'])}`, timestamp: t0 - 395 },
      { id: 503, role: 'assistant', content: `Then the workout.\n${GROUP('Workout', ['done', 'Done'])}`, timestamp: t0 - 390 }] },
  };
  const runs = []; let nextId = 5000;
  const row = sid => { const t = threads[sid], last = t.msgs[t.msgs.length - 1], at = last.timestamp * 1000;
    return { id: sid, title: t.title, runtime: 'direct', status: 'completed', updated_at: iso(at), updatedAt: iso(at), last_active: last.timestamp, message_count: t.msgs.length, messageCount: t.msgs.length, archived: false, preview: 'x', ...(t.agent ? { agent: t.agent } : {}) }; };
  return { threads, runs, row,
    list: agent => Object.keys(threads).filter(sid => threads[sid].agent === (agent || '')).map(row),
    run(body, url) { const sid = body.session_id, t = threads[sid]; if (!t) return null; runs.push({ url, body });
      t.msgs.push({ id: ++nextId, role: 'user', content: body.input, timestamp: Date.now() / 1000 }); (t.runs ||= []).push('run_' + nextId); return 'run_' + nextId; },
    steer(sid, body, url) { const t = threads[sid]; runs.push({ url, body: { session_id: sid, ...body }, steer: true });
      t.msgs.push({ id: ++nextId, role: 'user', display_kind: 'steer', content: body.input ?? body.text ?? '', timestamp: Date.now() / 1000 }); } };
}

async function boot(browser, box, shell, entry) {
  const phone = shell === 'phone';
  const context = await browser.newContext({ viewport: phone ? { width: 412, height: 915 } : { width: 1440, height: 900 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', ...(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' } : {}) });
  await context.routeWebSocket('**/*', w => w.close());
  await context.addInitScript(({ shell, on, skin }) => {
    if (window !== top) return;
    for (const [k, v] of Object.entries({ 'wos.shell': shell, 'wux.shell': shell, 'wos.desktop-view.v1': 'classic', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
      'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix: on ? { 'wizard/reply-buttons': true } : {} }) })) if (localStorage.getItem(k) === null || k === 'wos.skin-tweaks.v1') localStorage.setItem(k, v);
  }, { shell, on: SWITCH === 'on', skin: SKIN });
  await context.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url()), method = q.method(), p = u.pathname;
    if (u.origin !== origin) { entry.refused.push({ method, url: q.url(), reason: 'external' }); return r.abort(); }
    if (method === 'POST' && p === '/wizard/hermes/v1/runs') {
      const body = q.postDataJSON() || {}, id = box.run(body, u.pathname + u.search);
      if (!id) return r.fulfill({ status: 404, json: { error: 'no such thread' } });
      return r.fulfill({ status: 202, json: { run_id: id, status: 'queued', user_message_id: null } });
    }
    const sm = /^\/wizard\/hermes\/v1\/runs\/([^/]+)\/steer$/.exec(p);
    if (sm && method === 'POST') { // a send while the last run still counts as working steers it (Hermes keeps it as a steer row)
      const body = q.postDataJSON() || {}, sid = Object.keys(box.threads).find(k => box.threads[k].runs?.includes(sm[1])) || 'qa-rw';
      box.steer(sid, body, u.pathname + u.search);
      return r.fulfill({ json: { accepted: true, run_id: sm[1] } });
    }
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
    if (p === '/wizard/v1/bootstrap') return r.fulfill({ json: { bootstrap: 1, settings: { agent: { name: 'Wizard QA' } }, capabilities: {}, endpoints: {} } });
    if (p === '/wizard/v1/pages/wizard-look/look.json') return r.fulfill({ status: 404, json: { error: 'not_here' } });
    if (p === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
    if (p === '/wizard/v1/agents') return r.fulfill({ json: { agents: AGENTS } });
    if (p === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: box.list(u.searchParams.get('agent') || ''), has_more: false } });
    const m = /^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/.exec(p);
    if (m) { const sid = decodeURIComponent(m[1]), t = box.threads[sid];
      if (!t) return r.fulfill({ status: 404, json: { error: 'missing' } });
      return r.fulfill({ json: m[2] ? { messages: t.msgs } : { session: box.row(sid) } }); }
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
  await nap(800);
}
const thread = page => page.locator('.ch-thread').filter({ visible: true }).first();
const groupBtn = (page, group, label) => page.locator(`.ch-thread .ch-rb[data-rb-group="${group}"] [data-rb]`).filter({ visible: true }).filter({ hasText: label }).first();
const picks = page => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.ch-thread .ch-rb')].filter(n => n.getClientRects().length).map(n => [n.dataset.rbGroup,
  [...n.querySelectorAll('[data-rb]')].map(b => `${b.textContent.trim()}${b.getAttribute('aria-pressed') === 'true' ? '*' : ''}${b.disabled ? '#' : ''}`).join('|')])));
const until = async (fn, ms, what) => { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out: ' + what); await nap(150); } };
// Keep a thread fresh while the shell polls: close it and open it again (what a person sees on coming back to it).
const reopen = async (page, phone, sid) => { await openThread(page, phone, sid); };

const groupsOf = page => page.evaluate(() => [...document.querySelectorAll('.ch-thread .ch-rb')].filter(n => n.getClientRects().length).map(n => n.dataset.rbGroup + '@' + n.dataset.rbMsg));
(async () => {
  const browser = await chromium.launch();
  try {
    for (const skin of SKINS) for (const shell of SHELLS) {
      SKIN = skin;
      const phone = shell === 'phone', stem = `${shell}-${skin}${EXPECT === 'broken' ? '-main' : ''}`;
      const entry = { stem, errors: [], refused: [] }; report.cases.push(entry);
      const box = makeBox();
      let ctx;
      try {
        ctx = await boot(browser, box, shell, entry);
        const { page } = ctx;
        await openThread(page, phone, 'qa-rw');
        entry.groups = await groupsOf(page);
        entry.threadText = (await thread(page).innerText()).slice(0, 1500);
        await page.locator('.ch-thread .ch-rb').filter({ visible: true }).last().scrollIntoViewIfNeeded().catch(() => {});
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: path.join(out, stem + '.png') });
        if (EXPECT === 'broken') { entry.pass = true; continue; }
        // 1. One text, one set of buttons, from the rewrite.
        assert.deepEqual(entry.groups, ['Four-section phone bar@4449734'], 'one group, the rewrite\'s');
        assert.equal(await page.locator('.ch-thread .ch-rb [data-rb]').filter({ visible: true }).count(), 3);
        assert.match(entry.threadText, /ready for your call/);
        assert.doesNotMatch(entry.threadText, /behind its switch|\[reporter\]|Rewrite it now|WIZARD_/, 'no original text, no reporter prompt, no marker');
        // 2. A tap made on the original's message still shows as the pick.
        await openThread(page, phone, 'qa-rw-old-tap');
        assert.deepEqual(await groupsOf(page), ['Four-section phone bar@4449734']);
        await until(async () => (await page.locator('.ch-thread .ch-rb [aria-pressed="true"]').filter({ visible: true }).allInnerTexts()).join() === '✓ Let me try it first', 10000, 'earlier tap picked');
        // 3. Tap on the survivor: the usual line, then picked after a reload.
        await openThread(page, phone, 'qa-rw');
        await page.locator('.ch-thread .ch-rb [data-rb="yes"]').filter({ visible: true }).first().click();
        await until(() => box.runs.length >= 1, 8000, 'tap run');
        entry.tapInput = box.runs[0].body.input;
        assert.match(entry.tapInput, /^Tapped Yes, on for everyone · Four-section phone bar\n\[WIZARD_TAPS_V1\]/);
        assert.equal(JSON.parse(/\[WIZARD_TAPS_V1\](.*)\[\/WIZARD_TAPS_V1\]/.exec(entry.tapInput)[1]).taps[0].message, '4449734');
        await page.reload();
        await page.waitForFunction(() => (window.__wux || window.__wos) && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy, null, { timeout: 30000 });
        await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
        await openThread(page, phone, 'qa-rw');
        await until(async () => (await page.locator('.ch-thread .ch-rb [aria-pressed="true"]').filter({ visible: true }).allInnerTexts()).join() === '✓ Yes, on for everyone', 15000, 'pick after reload');
        assert.deepEqual(await groupsOf(page), ['Four-section phone bar@4449734'], 'still once after the tap');
        // 4. Two different group names in one turn: both.
        await openThread(page, phone, 'qa-two');
        entry.two = await groupsOf(page);
        assert.deepEqual([...entry.two].sort(), ['Ship desks@502', 'Workout@503']);
        assert.equal(entry.errors.length, 0, 'browser errors: ' + entry.errors.join('; '));
        assert.equal(entry.refused.filter(x => x.reason === 'unexpected-write').length, 0, 'no unexpected writes: ' + JSON.stringify(entry.refused));
        entry.pass = true;
      } catch (e) { entry.failure = e.stack; const pages = ctx?.context.pages() || []; if (pages[0]) await pages[0].screenshot({ path: path.join(out, stem + '-failure.png') }).catch(() => {}); }
      finally { fs.writeFileSync(path.join(out, `report-${EXPECT}.json`), JSON.stringify(report, null, 2)); await ctx?.context.close(); }
    }
  } finally { await browser.close(); }
  const failed = report.cases.filter(c => !c.pass);
  console.log(JSON.stringify({ expect: EXPECT, cases: report.cases.length, passed: report.cases.length - failed.length, groups: report.cases.map(c => c.stem + ': ' + JSON.stringify(c.groups)), failed: failed.map(c => c.stem + ': ' + String(c.failure).split('\n').slice(0, 2).join(' | ')) }));
  if (failed.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
