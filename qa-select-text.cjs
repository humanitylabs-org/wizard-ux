// QA for long-press text selection in Chats (feature/select-text), phone shell.
//  A working thread re-renders on every new step. Before the fix that replaced the bubble under a long-press and
//  wiped any selection within seconds. Checks:
//   1 message text is selectable (user + assistant bubbles), work steps and plan items too
//   2 a selection in a working thread survives several new steps arriving
//   3 the held steps land once the selection is cleared (nothing is lost)
//   4 a finger held on the messages also holds the re-render (the long-press target is never replaced mid-press)
//   5 idle threads still update normally (no selection → render straight away)
//   6 Back from the thread still returns to the list and the app stays open
// Fixture thread merged into real Wizard reads; EVERY non-GET request is intercepted, nothing reaches Wizard.
// Usage: node tools/qa-origin.cjs 9475 <worktree>/web &  then  QA_WEB_DIR=<worktree> node qa-select-text.cjs [url]
let chromium; try { ({ chromium } = require('playwright-core')); } catch (e) { ({ chromium } = require('/home/developer/node_modules/playwright')); }
const fs = require('fs'), path = require('path');
const URL_ = process.argv[2] || 'http://127.0.0.1:9475/wizard-os-home/';
const WEB = process.env.QA_WEB_DIR || '';
const EXEC = process.env.QA_CHROME || '/home/developer/.local/bin/google-chrome';
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, typeof extra === 'string' ? extra : JSON.stringify(extra).slice(0, 400)); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = Date.now() / 1000;
const SID = 'qa_sel_live';
let steps = 1, polls = 0;
const call = (id, label) => ({ id, type: 'function', function: { name: 'tool', arguments: '{}' }, display_label: label });
function rows() {
  const r = [{ id: 1, role: 'user', content: 'Please check the selection behaviour in this long first message so there is text to hold.', timestamp: now - 600 },
    { id: 2, role: 'assistant', content: 'Here is an earlier answer paragraph that James wants to long-press and copy out of the thread.', timestamp: now - 590 },
    { id: 3, role: 'user', content: 'Now keep working on the next part please.', timestamp: now - 300 }];
  for (let k = 0; k < steps; k++) {
    r.push({ id: 10 + k * 2, role: 'assistant', content: '', timestamp: now - 290 + k, tool_calls: [call('c' + k, 'Step number ' + k)] });
    r.push({ id: 11 + k * 2, role: 'tool', content: '{"ok":true}', timestamp: now - 289 + k, tool_call_id: 'c' + k, plan: [{ id: 'p1', content: 'Read the selection code carefully', status: 'in_progress' }, { id: 'p2', content: 'Write the fix', status: 'pending' }] });
  }
  return r.map(x => ({ ...x, session_id: SID }));
}
const session = () => ({ id: SID, source: 'wizard-mobile', title: 'QA select live', status: 'running', archived: false, hidden: false, message_count: rows().length,
  started_at: now - 600, last_active: now - 1, wizard_last_user_at: now - 300, wizard_last_assistant_at: now - 1, wizard_activity_at: now - 1, wizard_run_id: 'qa-run-sel',
  latest_message: { role: 'tool', content: '', timestamp: now - 1 }, last_user_message: { role: 'user', content: 'Now keep working on the next part please.', timestamp: now - 300 } });
const writes = [];
async function fence(ctx) {
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url()), m = q.method();
    const wm = u.pathname.match(/\/wizard-os-home\/((?:core\/|desktop\/)?[a-z-]+\.(?:js|css)|index\.html|desktop\.html|)$/);
    if (WEB && wm && m === 'GET' && !/^(data|summaries)\.js$/.test(wm[1])) { const f = wm[1] || 'index.html', fp = path.join(WEB, 'web', f); if (fs.existsSync(fp)) return r.fulfill({ status: 200, contentType: f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : 'application/javascript', body: fs.readFileSync(fp) }); }
    const json = (status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (m !== 'GET' && m !== 'HEAD') { writes.push(u.pathname); return json(200, {}); }
    if (!u.pathname.startsWith('/wizard/')) return r.continue();
    if (u.pathname === '/wizard/hermes/api/sessions' && (u.searchParams.get('offset') || '0') === '0') { const res = await r.fetch(); const p = await res.json(); p.data = [session()].concat(p.data || []); return json(200, p); }
    if (u.pathname === `/wizard/hermes/api/sessions/${SID}/messages`) { polls++; const all = rows(), off = +u.searchParams.get('offset') || 0, lim = +u.searchParams.get('limit') || 500, page = all.slice(off, off + lim); return json(200, { object: 'list', data: page, pagination: { limit: lim, offset: off, returned: page.length } }); }
    if (u.pathname === `/wizard/hermes/api/sessions/${SID}`) return json(200, { session: session() });
    if (/\/wizard\/hermes\/v1\/runs\/qa-run-sel/.test(u.pathname)) return /events$/.test(u.pathname) ? r.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }) : json(200, { run_id: 'qa-run-sel', status: 'running', session_id: SID });
    return r.continue();
  });
}
async function until(fn, ms = 8000, step = 100) { const t = Date.now() + ms; while (Date.now() < t) { const v = await fn(); if (v) return v; await sleep(step); } return await fn(); }
(async () => {
  const b = await chromium.launch({ executablePath: EXEC, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => { localStorage.setItem('wos.coached', 'true'); if (false) { const d = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML'); Object.defineProperty(Element.prototype, 'innerHTML', { set(v) { if (this.dataset && this.dataset.chats && window.__selEl) (window.__st = window.__st || []).push(new Error().stack.split('\n').slice(1, 6).join(' | ')); return d.set.call(this, v); }, get() { return d.get.call(this); } }); } });
  await fence(ctx);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL_ + '?open=chats'); await p.waitForTimeout(4500);
  const opened = await p.evaluate(sid => { const r = [...document.querySelectorAll(`.ch-list [data-chopen="${sid}"]`)].find(x => x.getBoundingClientRect().width > 0); if (!r) return false; r.click(); return true; }, SID);
  ok(opened, 'fixture working thread is in the list and opens');
  await until(() => p.evaluate(() => !!document.querySelector('.ch-msgs .msg.a .bub p')), 8000);
  const vis = () => p.evaluate(() => [...document.querySelectorAll('.ch-thread')].find(t => t.getBoundingClientRect().width > 0 && t.getBoundingClientRect().left >= 0));
  // 1 selectable surfaces
  const us = await p.evaluate(() => { const t = [...document.querySelectorAll('.ch-thread')].find(t => t.getBoundingClientRect().width > 0 && t.getBoundingClientRect().left >= 0); const g = s => { const e = t.querySelector(s); return e ? getComputedStyle(e).webkitUserSelect || getComputedStyle(e).userSelect : 'missing'; }; return { a: g('.msg.a .bub p'), u: g('.msg.u .bub p'), step: g('.wk-steps li > span'), plan: g('.wk-plan li > span') }; });
  ok(us.a === 'text' && us.u === 'text', '1 assistant and user message text is selectable', us);
  ok(us.step === 'text' || us.step === 'missing', '1 work-step text is selectable', us);
  ok(us.plan === 'text' || us.plan === 'missing', '1 plan item text is selectable', us);
  // 2 selection survives new steps
  const sel = await p.evaluate(() => { const t = [...document.querySelectorAll('.ch-thread')].find(t => t.getBoundingClientRect().width > 0 && t.getBoundingClientRect().left >= 0); const e = t.querySelector('.msg.a .bub p'); window.__selEl = e; const r = document.createRange(); r.selectNodeContents(e); getSelection().removeAllRanges(); getSelection().addRange(r); return String(getSelection()); });
  const stepsBefore = steps, pollsBefore = polls;
  for (let k = 0; k < 4; k++) { steps++; await sleep(4200); }
  const after = await p.evaluate(() => ({ sel: String(getSelection()), attached: document.contains(window.__selEl) }));
  ok(polls > pollsBefore + 1, '2 the thread kept polling while text was selected', { polls, pollsBefore });
  ok(after.attached && after.sel === sel && sel.length > 20, '2 the selection survives 4 new steps arriving in a working thread', { sel: sel.slice(0, 40), after });
  // 3 cleared selection → held steps land
  const shownBefore = await p.evaluate(() => document.querySelectorAll('.ch-msgs .wk-steps li').length);
  await p.evaluate(() => getSelection().removeAllRanges());
  const landed = await until(() => p.evaluate(() => !document.contains(window.__selEl)), 3000);
  const lastStep = await p.evaluate(() => { const t = [...document.querySelectorAll('.ch-thread')].find(t => t.getBoundingClientRect().width > 0 && t.getBoundingClientRect().left >= 0); return t ? t.querySelector('.ch-msgs').textContent : ''; });
  ok(landed && new RegExp('Step number ' + (steps - 1)).test(lastStep), '3 clearing the selection lands the held steps (latest step shown)', { landed, want: 'Step number ' + (steps - 1), shownBefore, tail: lastStep.slice(-200) });
  // 4 a finger held on the messages holds the re-render
  const pt = await p.evaluate(() => { const t = [...document.querySelectorAll('.ch-thread')].find(t => t.getBoundingClientRect().width > 0 && t.getBoundingClientRect().left >= 0); const e = t.querySelector('.msg.a .bub p'); window.__holdEl = e; const r = e.getBoundingClientRect(); return { x: r.left + 20, y: r.top + 6 }; });
  const s = await ctx.newCDPSession(p);
  await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pt.x, y: pt.y }] });
  steps++; await sleep(4500);
  const heldDuring = await p.evaluate(() => document.contains(window.__holdEl));
  await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const landed2 = await until(() => p.evaluate(() => !document.contains(window.__holdEl)), 4000);
  ok(heldDuring, '4 a finger held on a message keeps that bubble in place while a step arrives', { heldDuring });
  ok(landed2, '4 lifting the finger lands the held step', { landed2 });
  // 5 idle updates render straight away
  const before5 = await p.evaluate(() => { const t = [...document.querySelectorAll('.ch-thread')].find(t => t.getBoundingClientRect().width > 0 && t.getBoundingClientRect().left >= 0); window.__idleEl = t.querySelector('.msg.a .bub p'); return true; });
  steps++;
  const rendered = await until(() => p.evaluate(() => !document.contains(window.__idleEl)), 9000);
  ok(rendered, '5 with nothing selected, a new step renders on the next poll as before');
  // 7 a tap on the selected words keeps it; a tap on the empty shell around the bubbles clears it (Android WebView
  //   would otherwise keep it, holding updates)
  const tapAt = async (x, y) => { await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(60); await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
  const g = await p.evaluate(() => { const t = [...document.querySelectorAll('.ch-thread')].find(t => t.getBoundingClientRect().width > 0 && t.getBoundingClientRect().left >= 0); const e = t.querySelector('.msg.a .bub p'); window.__tapEl = e; const r = document.createRange(); r.selectNodeContents(e); getSelection().removeAllRanges(); getSelection().addRange(r); const b = e.getBoundingClientRect(), m = t.querySelector('.ch-msgs').getBoundingClientRect(), day = t.querySelector('.ch-day'), d = day ? day.getBoundingClientRect() : null; return { on: { x: b.left + 15, y: b.top + 6 }, off: d ? { x: m.left + 10, y: d.top + d.height / 2 } : { x: m.left + 6, y: m.top + 4 } }; });
  steps++;
  await tapAt(g.on.x, g.on.y); await sleep(4500);
  const kept = await p.evaluate(() => ({ sel: String(getSelection()).length, attached: document.contains(window.__tapEl) }));
  ok(kept.sel > 20 && kept.attached, '7 a tap on the selected words keeps the selection (and the hold)', kept);
  await tapAt(g.off.x, g.off.y);
  const cleared = await until(() => p.evaluate(() => String(getSelection()).length === 0 && !document.contains(window.__tapEl)), 4000);
  ok(cleared, '7 a tap on the shell beside the bubbles clears the selection and the held step lands', await p.evaluate(() => ({ sel: String(getSelection()).length, attached: document.contains(window.__tapEl) })));
  // 6 Back
  await p.evaluate(() => history.back()); await sleep(1200);
  const list = await p.evaluate(() => !![...document.querySelectorAll('.ch-list')].find(l => l.getBoundingClientRect().width > 0 && l.getBoundingClientRect().left >= 0));
  ok(list && p.url().includes('/wizard-os-home/'), '6 Back from the thread returns to the Chats list and the app stays open', p.url());
  ok(!errs.length, 'no page errors', errs);
  ok(!writes.filter(w => /\/v1\/runs$/.test(w)).length, 'no runs were posted (fence)', writes);
  console.log(`\n${pass} pass, ${fail} fail`);
  await b.close(); process.exit(fail ? 1 : 0);
})();
