'use strict';
// Tap-to-answer buttons inside agent replies (wizard-ux issue 1889, on for everyone; switch wizard/reply-buttons removed) in a real browser. A
// disposable synthetic box (nothing real is read or written) keeps the threads' messages in memory and answers the
// outbox's POST /wizard/hermes/v1/runs like Hermes: the owner's message lands in the history, the agent answers on cue.
// Phone 412x915 and desktop 1440x900 (Classic), Nebula.
//   A reply with two button groups shows them where their lines sit, between the text; a tap
//     marks the pick on its frame; one tap in each group goes as ONE run naming both (nothing before the batch window
//     ends); the thread shows the taps as machine lines, never as an owner bubble or marker text; a change before the
//     agent answers sends the new pick; once the agent answered the picks are locked; a reload and a second device show
//     the same picks; routed threads (host profile, container, restricted) send the same way to their own agent.
//   QA_EXPECT=broken (QA_WEB=<an older worktree>/web) records a build before the buttons (the marker as raw text).
// Every case writes plain-<shell>-<switch>.html: the thread of a reply WITHOUT buttons, to compare with an older build.
// Screens in QA_OUT: <shell>-<switch>.png (+ -tapped, -locked, -device2).
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = process.env.QA_ORIGIN || 'https://chat-reply-buttons.test', prefix = '/wizard-os-home/';
const web = process.env.QA_WEB || path.join(repo, 'web'), out = process.env.QA_OUT || path.join(repo, 'chat-reply-buttons-evidence');
const SWITCH = 'on', EXPECT = process.env.QA_EXPECT || 'fixed', SHELLS = (process.env.QA_SHELLS || 'phone,desktop').split(',');
const SKIN = process.env.QA_SKIN || 'nebula';
fs.mkdirSync(out, { recursive: true });
const now = Date.now(), iso = t => new Date(t).toISOString(), nap = ms => new Promise(r => setTimeout(r, ms));
const GROUP = (group, ...b) => `[WIZARD_BUTTONS_V1]${JSON.stringify({ group, buttons: b.map(([id, label]) => ({ id, label })) })}[/WIZARD_BUTTONS_V1]`;
const REPLY = `Two things for today.\n\n**Ship desks?** I tried both layouts on the [desk page](https://example.com/desks).\n${GROUP('Ship desks', ['go', 'Go for it'], ['drop', 'Drop this'])}\n\n**Morning checklist**\n1. Workout, 20 minutes\n${GROUP('Workout', ['done', 'Done'])}\n\nThat's all for now.`;
// Issue 1963: several asks with the same labels; each row has to say which ask it answers.
const ASKS = `Four things to decide.\n\n1. Smart inbox switch\n2. Typed messages go quiet\n\n${GROUP('Smart inbox switch', ['approve', 'Approve'], ['decline', 'Decline'])}\n${GROUP('Typed messages go quiet', ['approve', 'Approve'], ['decline', 'Decline'])}`;
const PLAIN = 'A plain reply with **bold**, a list:\n\n1. one\n2. two\n\nand a [link](https://example.com).';
const AGENTS = [{ id: 'hermes', label: 'Wizard QA', harness: 'hermes', privacy: 'standard', is_default: true, status: 'running', appearance: { glyph: 'w', hue: 260 }, model: { provider: 'anthropic', model: 'claude-opus-4' } }];
const KINDS = [['host', 'Host ops'], ['container', 'Box'], ['restricted', 'Locked']];
for (const [id, label] of KINDS) AGENTS.push({ id, label, harness: 'hermes', privacy: 'standard', status: 'running', appearance: { glyph: id[0], hue: 120 }, model: { provider: 'anthropic', model: 'claude-opus-4' } });
const report = { origin, web, switch: SWITCH, expect: EXPECT, skin: SKIN, cases: [] };

// The synthetic box: threads (main + one per routed kind), each a message list; runs append the owner's message.
function makeBox() {
  const t0 = now / 1000;
  const threads = {
    'qa-rb': { agent: '', title: 'Today', msgs: [{ id: 101, role: 'user', content: 'What is up today?', timestamp: t0 - 120 }, { id: 102, role: 'assistant', content: REPLY, timestamp: t0 - 110 }] },
    'qa-rb-asks': { agent: '', title: 'Inbox review', msgs: [{ id: 401, role: 'user', content: 'Review the inbox features', timestamp: t0 - 400 }, { id: 402, role: 'assistant', content: ASKS, timestamp: t0 - 390 }] },
    'qa-plain': { agent: '', title: 'Plain reply', msgs: [{ id: 201, role: 'user', content: 'Say something plain', timestamp: t0 - 300 }, { id: 202, role: 'assistant', content: PLAIN, timestamp: t0 - 290 }] },
  };
  for (const [id] of KINDS) threads['qa-rb-' + id] = { agent: id, title: 'Check from ' + id, msgs: [{ id: 301, role: 'user', content: 'Anything?', timestamp: t0 - 200 }, { id: 302, role: 'assistant', content: `From the ${id} agent:\n${GROUP('Approve ' + id, ['yes', 'Yes'], ['no', 'No'])}`, timestamp: t0 - 190 }] };
  const runs = []; let nextId = 1000;
  const row = sid => { const t = threads[sid], last = t.msgs[t.msgs.length - 1], at = last.timestamp * 1000;
    return { id: sid, title: t.title, runtime: 'direct', status: 'completed', updated_at: iso(at), updatedAt: iso(at), last_active: last.timestamp, message_count: t.msgs.length, messageCount: t.msgs.length, archived: false, preview: String(last.content).slice(0, 80), ...(t.agent ? { agent: t.agent } : {}) }; };
  return { threads, runs, row,
    list: agent => Object.keys(threads).filter(sid => threads[sid].agent === (agent || '')).map(row),
    run(body, url) { const sid = body.session_id, t = threads[sid]; if (!t) return null; runs.push({ url, body });
      t.msgs.push({ id: ++nextId, role: 'user', content: body.input, timestamp: Date.now() / 1000 }); (t.runs ||= []).push('run_' + nextId); return 'run_' + nextId; },
    steer(sid, body, url) { const t = threads[sid]; runs.push({ url, body: { session_id: sid, ...body }, steer: true });
      t.msgs.push({ id: ++nextId, role: 'user', display_kind: 'steer', content: body.input ?? body.text ?? '', timestamp: Date.now() / 1000 }); },
    answer(sid, text) { threads[sid].msgs.push({ id: ++nextId, role: 'assistant', content: text, timestamp: Date.now() / 1000 }); } };
}

async function boot(browser, box, shell, entry) {
  const phone = shell === 'phone';
  const context = await browser.newContext({ viewport: phone ? { width: 412, height: 915 } : { width: 1440, height: 900 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block', ...(phone ? { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Mobile Safari/537.36' } : {}) });
  await context.routeWebSocket('**/*', w => w.close());
  await context.addInitScript(({ shell, on, skin }) => {
    if (window !== top) return;
    for (const [k, v] of Object.entries({ 'wos.shell': shell, 'wux.shell': shell, 'wos.desktop-view.v1': 'classic', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin,
      'wos.skin-tweaks.v1': JSON.stringify({ version: 1, preset: 'none', off: {}, mix: {} }) })) if (localStorage.getItem(k) === null || k === 'wos.skin-tweaks.v1') localStorage.setItem(k, v);
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
      const body = q.postDataJSON() || {}, sid = Object.keys(box.threads).find(k => box.threads[k].runs?.includes(sm[1])) || 'qa-rb';
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

(async () => {
  const browser = await chromium.launch();
  try {
    for (const shell of SHELLS) {
      const phone = shell === 'phone', stem = `${shell}-${SWITCH}${EXPECT === 'broken' ? '-main' : ''}`;
      const entry = { stem, errors: [], refused: [] }; report.cases.push(entry);
      const box = makeBox();
      let ctx;
      try {
        ctx = await boot(browser, box, shell, entry);
        const { page } = ctx;
        // A reply WITHOUT buttons: its thread markup, to compare on / off / main (renders exactly as today).
        await openThread(page, phone, 'qa-plain');
        fs.writeFileSync(path.join(out, `plain-${stem}.html`), (await thread(page).locator('.ch-msgs').first().innerHTML()).replace(/ data-(at|mat|boom-at)="[^"]*"/g, '').replace(/1\d{12}(\.\d+)?/g, 'T').replace(/<time[^>]*>[^<]*<\/time>/g, '<time></time>'));
        // 0. Issue 1963: two asks with the same Approve / Decline buttons; each row names its ask on screen.
        await openThread(page, phone, 'qa-rb-asks');
        entry.asks = await page.evaluate(() => [...document.querySelectorAll('.ch-thread .ch-rb')].filter(n => n.getClientRects().length).map(n => {
          const cap = n.querySelector('.ch-rb-ask'), r = cap?.getBoundingClientRect(), b = n.querySelector('[data-rb]')?.getBoundingClientRect();
          return { group: n.dataset.rbGroup, caption: cap && r.width && r.height ? cap.textContent.trim() : null, above: !!(r && b && r.bottom <= b.top + 1), color: cap ? getComputedStyle(cap).color : null };
        }));
        entry.asksText = (await thread(page).innerText()).slice(0, 600);
        await page.locator('.ch-thread .msg.a').filter({ visible: true }).last().scrollIntoViewIfNeeded().catch(() => {});
        await page.screenshot({ path: path.join(out, stem + '-asks.png') });
        if (EXPECT !== 'broken' && SWITCH === 'on') {
          assert.deepEqual(entry.asks.map(a => [a.group, a.caption, a.above]), [['Smart inbox switch', 'Smart inbox switch', true], ['Typed messages go quiet', 'Typed messages go quiet', true]], 'each row names its ask above its buttons: ' + JSON.stringify(entry.asks));
          await groupBtn(page, 'Typed messages go quiet', 'Decline').click();
          assert.equal(await page.locator('.ch-thread .ch-rb.picked .ch-rb-ask').filter({ visible: true }).innerText(), 'Typed messages go quiet', 'picked keeps its caption');
          assert.equal((await picks(page))['Typed messages go quiet'], 'Approve|✓ Decline*');
          await until(() => box.runs.length >= 1, 8000, 'the asks tap');
          assert.match(box.runs[0].body.input, /^Tapped Decline · Typed messages go quiet\n/);
          box.runs.length = 0;
        }
        if (EXPECT !== 'broken' && SWITCH === 'off') assert.match(entry.asksText, /Smart inbox switch: \[Approve\] \[Decline\][\s\S]*Typed messages go quiet: \[Approve\] \[Decline\]/, 'off: the fallback names each ask');
        await openThread(page, phone, 'qa-rb');
        entry.threadText = (await thread(page).innerText()).slice(0, 1500);
        if (EXPECT === 'broken' || SWITCH === 'off') {
          entry.groups = await page.locator('.ch-thread .ch-rb').count();
          await page.locator('.ch-thread .msg.a').first().scrollIntoViewIfNeeded().catch(() => {});
          await page.screenshot({ path: path.join(out, stem + '.png') });
          if (EXPECT !== 'broken') {
            assert.equal(entry.groups, 0, 'off: no buttons');
            assert.match(entry.threadText, /Ship desks: \[Go for it\] \[Drop this\][\s\S]*Workout: \[Done\]/, 'off: the ask and its labels as text, in place');
            assert.doesNotMatch(entry.threadText, /WIZARD_|"group"/, 'off: no marker text');
            assert.equal(box.runs.length, 0, 'off: nothing sent');
          }
          assert.equal(entry.errors.length, 0, 'browser errors: ' + entry.errors.join('; '));
          entry.pass = true; continue;
        }
        // 1. Two groups, in place, between the text; no marker text anywhere.
        assert.doesNotMatch(entry.threadText, /WIZARD_|"group"|\[Go for it\]/, 'no marker or fallback text');
        const order = await page.evaluate(() => {
          const bub = [...document.querySelectorAll('.ch-thread .msg.a .bub')].find(n => n.getClientRects().length && n.querySelector('.ch-rb'));
          return [...bub.querySelectorAll('p, li, .ch-rb')].map(n => n.classList.contains('ch-rb') ? '[' + n.dataset.rbGroup + ']' : n.textContent.trim().slice(0, 24));
        });
        entry.order = order;
        const at = s => order.findIndex(x => x.startsWith(s));
        assert.ok(at('Ship desks?') < at('[Ship desks]') && at('[Ship desks]') < at('Morning checklist') && at('Workout, 20') < at('[Workout]') && at('[Workout]') < at("That's all"), 'groups sit where their lines are: ' + JSON.stringify(order));
        assert.deepEqual(await picks(page), { 'Ship desks': 'Go for it|Drop this', Workout: 'Done' });
        entry.look = await groupBtn(page, 'Ship desks', 'Go for it').evaluate(b => ({ w: b.getBoundingClientRect().width, h: b.getBoundingClientRect().height, bg: getComputedStyle(b).backgroundImage, color: getComputedStyle(b).color, vw: innerWidth, right: b.getBoundingClientRect().right }));
        assert.ok(entry.look.h >= 40 && entry.look.right <= entry.look.vw, 'a real tap target that fits the screen: ' + JSON.stringify(entry.look));
        await groupBtn(page, 'Ship desks', 'Go for it').scrollIntoViewIfNeeded(); await page.evaluate(() => document.fonts.ready);
        await page.screenshot({ path: path.join(out, stem + '.png') });
        // 2. A tap marks the pick on its frame; one in each group = one run naming both, after the batch window.
        await groupBtn(page, 'Ship desks', 'Go for it').click();
        const frame1 = await picks(page);
        await groupBtn(page, 'Workout', 'Done').click();
        entry.afterTaps = await picks(page);
        assert.equal(frame1['Ship desks'], '✓ Go for it*|Drop this', 'picked at once');
        assert.deepEqual(entry.afterTaps, { 'Ship desks': '✓ Go for it*|Drop this', Workout: '✓ Done*' });
        await nap(250); // past the dim transition
        assert.equal(await groupBtn(page, 'Ship desks', 'Drop this').evaluate(b => b.classList.contains('dim') && Number(getComputedStyle(b).opacity) < 1), true, 'the other button dims');
        await nap(1000); assert.equal(box.runs.length, 0, 'nothing sent inside the batch window');
        await until(() => box.runs.length >= 1, 8000, 'the batched run');
        await nap(800); assert.equal(box.runs.length, 1, 'two taps, one run');
        entry.run1 = box.runs[0];
        assert.match(entry.run1.body.input, /^Tapped Go for it · Ship desks\nTapped Done · Workout\n\[WIZARD_TAPS_V1\]/);
        const taps1 = JSON.parse(/\[WIZARD_TAPS_V1\](.*)\[\/WIZARD_TAPS_V1\]/.exec(entry.run1.body.input)[1]).taps;
        assert.deepEqual(taps1, [{ thread: 'qa-rb', message: '102', group: 'Ship desks', button: 'go', label: 'Go for it' }, { thread: 'qa-rb', message: '102', group: 'Workout', button: 'done', label: 'Done' }]);
        assert.ok(!('agent' in entry.run1.body), 'main thread: the main agent');
        // 3. The thread shows the taps as machine lines (pending copy, then the history's), never an owner bubble.
        await until(() => page.locator('.ch-thread .ch-taps').filter({ visible: true }).count(), 8000, 'tap line');
        await reopen(page, phone, 'qa-rb');
        await until(async () => /Tapped Done · Workout/.test(await thread(page).innerText()), 15000, 'tap line from history');
        entry.tapLine = await page.locator('.ch-thread .ch-taps').filter({ visible: true }).last().innerText();
        assert.match(entry.tapLine, /Tapped Go for it · Ship desks\s+Tapped Done · Workout/);
        assert.equal(await page.locator('.ch-thread .msg.u').filter({ visible: true }).filter({ hasText: 'Tapped' }).count(), 0, 'never an owner bubble');
        assert.doesNotMatch(await thread(page).innerText(), /WIZARD_|"taps"/, 'no marker text');
        assert.deepEqual(await picks(page), { 'Ship desks': '✓ Go for it*|Drop this', Workout: '✓ Done*' }, 'picks read back from history');
        await page.locator('.ch-thread .ch-taps').filter({ visible: true }).last().scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(out, stem + '-tapped.png') });
        // 4. Change before the agent acted: the new pick goes.
        await groupBtn(page, 'Ship desks', 'Drop this').click();
        assert.equal((await picks(page))['Ship desks'], 'Go for it|✓ Drop this*');
        await until(() => box.runs.length >= 2, 8000, 'the change');
        assert.deepEqual(JSON.parse(/\[WIZARD_TAPS_V1\](.*)\[\/WIZARD_TAPS_V1\]/.exec(box.runs[1].body.input)[1]).taps.map(t => t.label), ['Drop this']);
        // 5. The agent answers: the picks lock.
        box.answer('qa-rb', 'Noted: desks dropped, workout logged.');
        await reopen(page, phone, 'qa-rb');
        await until(async () => /desks dropped/.test(await thread(page).innerText()), 15000, 'the agent answer');
        await until(async () => (await picks(page))['Ship desks'] === 'Go for it#|✓ Drop this*#', 15000, 'locked picks');
        entry.locked = await picks(page);
        assert.deepEqual(entry.locked, { 'Ship desks': 'Go for it#|✓ Drop this*#', Workout: '✓ Done*#' });
        await groupBtn(page, 'Ship desks', 'Go for it').click({ force: true }).catch(() => {});
        await nap(3600); assert.equal(box.runs.length, 2, 'a locked group sends nothing');
        await page.screenshot({ path: path.join(out, stem + '-locked.png') });
        // 6. Reload: the same picks.
        await page.reload();
        await page.waitForFunction(() => (window.__wux || window.__wos) && window.WosExperience?.state.tweaks.length && !window.WosExperience.state.busy, null, { timeout: 30000 });
        await page.addStyleTag({ content: '#wosWelcome{display:none!important}' });
        await openThread(page, phone, 'qa-rb');
        await until(async () => JSON.stringify(await picks(page)) === JSON.stringify(entry.locked), 15000, 'picks after reload');
        // 7. A second device (fresh browser profile) on the same box: the same picks.
        const d2 = await boot(browser, box, shell, entry);
        try {
          await openThread(d2.page, phone, 'qa-rb');
          await until(async () => JSON.stringify(await picks(d2.page)) === JSON.stringify(entry.locked), 15000, 'picks on device 2');
          entry.device2 = await picks(d2.page);
          await d2.page.locator('.ch-thread .ch-rb').filter({ visible: true }).first().scrollIntoViewIfNeeded();
          await d2.page.screenshot({ path: path.join(out, stem + '-device2.png') });
        } finally { await d2.context.close(); }
        // 8. Agent parity: a routed thread of each kind sends its tap to its own agent.
        entry.routed = {};
        for (const [id] of KINDS) {
          const sid = 'qa-rb-' + id, before = box.runs.length;
          await openThread(page, phone, sid);
          await groupBtn(page, 'Approve ' + id, 'Yes').click();
          await until(() => box.runs.length > before, 8000, id + ' run');
          const run = box.runs[box.runs.length - 1];
          entry.routed[id] = { url: run.url, agent: run.body.agent, input: run.body.input.split('\n')[0] };
          assert.equal(run.body.session_id, sid, id);
          assert.equal(run.body.agent, id, id + ': its own agent');
          assert.equal(entry.routed[id].input, `Tapped Yes · Approve ${id}`, id);
        }
        assert.equal(entry.errors.length, 0, 'browser errors: ' + entry.errors.join('; '));
        assert.equal(entry.refused.filter(x => x.reason === 'unexpected-write').length, 0, 'no unexpected writes: ' + JSON.stringify(entry.refused));
        entry.pass = true;
      } catch (e) { entry.failure = e.stack; const pages = ctx?.context.pages() || []; if (pages[0]) await pages[0].screenshot({ path: path.join(out, stem + '-failure.png') }).catch(() => {}); }
      finally { fs.writeFileSync(path.join(out, `report-${SWITCH}-${EXPECT}.json`), JSON.stringify(report, null, 2)); await ctx?.context.close(); }
    }
  } finally { await browser.close(); }
  const failed = report.cases.filter(c => !c.pass);
  console.log(JSON.stringify({ switch: SWITCH, expect: EXPECT, cases: report.cases.length, passed: report.cases.length - failed.length, failed: failed.map(c => c.stem + ': ' + String(c.failure).split('\n').slice(0, 2).join(' | ')) }));
  if (failed.length) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
