// QA for Batch 2 "chat power" parity (feature/chat-power), phone + desktop shells:
//  #11 model chip + picker (thread: POST /api/sessions/:id/model; new chat: rides with the first send),
//      failed thread → Retry / Choose another model / Dismiss (Retry goes through the durable outbox)
//  #12 Errors section: failed threads + /wizard/attention items + failed voice notes, each with Retry / Dismiss
//  #13 composer mic: a voice reply pinned to THIS thread (fake media device), even if you switch threads
//      mid-take or the orb router would send it elsewhere
//  #17 work receipt: 'X of N', named steps, 'Worked for', a waiting question
//  #18 reading position restored within an hour (not after), ↓ Latest appears and jumps
//  #23 Files sheet lists real /wizard/files; attaching puts the id in the composer and in wizard_file_ids
//  #24 AI usage in Settings renders bars from real /wizard/ai-usage
//  Back closes each new sheet before leaving the thread (phone Back stack + desktop Esc).
//
// Real Wizard reads (GET) for model options, files and AI usage; fixture threads are merged into the session
// list for everything that writes. EVERY non-GET request is intercepted here — nothing reaches Wizard/Archimedes.
// With the local QA origin (tools/qa-origin.cjs) a second fence refuses writes and the suite asserts its
// refusal counter did not move.
//
// Usage: node tools/qa-origin.cjs 9475 <worktree>/web &  then  QA_WEB_DIR=<worktree> node qa-chat-power.cjs [url]
//   url defaults to http://127.0.0.1:9475/wizard-os-home/ . QA_OUT=<dir> for screenshots.
// Negative control: QA_WEB_DIR=<release/parity-0.7 checkout> node qa-chat-power.cjs must FAIL.
const { chromium } = require('/home/telos/node_modules/playwright');
const fs = require('fs'), path = require('path');
const URL_ = process.argv[2] || 'http://127.0.0.1:9475/wizard-os-home/';
const WEB = process.env.QA_WEB_DIR || '';
const OUT = process.env.QA_OUT || '/home/telos/.hermes/cache/scratch/wizard-audit/shots/chat-power';
const EXEC = process.env.QA_CHROME || '/home/telos/.local/bin/google-chrome';
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === '' ? '' : typeof extra === 'string' ? extra : JSON.stringify(extra).slice(0, 600)); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const origin = new URL(URL_).origin;

/* ---------------- fixtures ---------------- */
const now = Date.now() / 1000;
let rid = 1;
const row = (role, content, ts, extra = {}) => ({ id: rid++, session_id: '', role, content, timestamp: ts, ...extra });
const call = (id, label, extra = {}) => ({ id, type: 'function', function: { name: 'tool', arguments: '{}' }, display_label: label, ...extra });
const PLAN3 = st => [{ id: 'p1', content: 'Read the calendar', status: st[0] }, { id: 'p2', content: 'Draft the summary', status: st[1] }, { id: 'p3', content: 'Send it to the team', status: st[2] }];
const FIX = {
  qa_pw_ready: { title: 'QA power ready', status: 'completed', model: 'claude-opus-5-5', provider: 'anthropic', t: now - 50, rows: () => [row('user', 'Ready question', now - 300), row('assistant', 'Ready answer.', now - 250)] },
  qa_pw_other: { title: 'QA power other', status: 'completed', t: now - 52, rows: () => [row('user', 'Other question', now - 300), row('assistant', 'Other answer.', now - 250)] },
  qa_pw_fail: { title: 'QA power failed', status: 'failed', model: 'claude-opus-5-5', provider: 'anthropic', t: now - 40, rows: () => [row('user', 'Summarise the quarterly numbers', now - 120)] },
  qa_pw_intr: { title: 'QA power interrupted', status: 'interrupted', t: now - 45, rows: () => [row('user', 'Tidy the downloads folder', now - 200)] },
  qa_pw_fail2: { title: 'QA power failed two', status: 'failed', t: now - 46, rows: () => [row('user', 'Check the invoices', now - 220)] },
  qa_pw_fail3: { title: 'QA power failed three', status: 'failed', t: now - 47, rows: () => [row('user', 'Rename the photos', now - 230)] },
  qa_pw_fail4: { title: 'QA power failed four', status: 'failed', t: now - 48, rows: () => [row('user', 'Water the plants reminder', now - 240)] },
  qa_pw_work: { title: 'QA power work done', status: 'completed', t: now - 60, rows: () => [
    row('user', 'Plan the week', now - 600),
    row('assistant', '', now - 590, { tool_calls: [call('c1', 'Read the calendar')] }),
    row('tool', '{"ok":true}', now - 560, { tool_call_id: 'c1', plan: PLAN3(['completed', 'in_progress', 'pending']) }),
    row('assistant', '', now - 550, { tool_calls: [call('c2', 'Draft the summary')] }),
    row('tool', '{"ok":true}', now - 480, { tool_call_id: 'c2', plan: PLAN3(['completed', 'completed', 'pending']) }),
    row('assistant', '', now - 470, { tool_calls: [call('c3', 'Ask which week', { question: { text: 'Which week should I plan?', choices: ['This week', 'Next week'], state: 'answered', answer: 'Next week' } })] }),
    row('tool', '{"answer":"Next week"}', now - 440, { tool_call_id: 'c3' }),
    row('assistant', 'Here is the plan for next week.', now - 420),
  ] },
  qa_pw_live: { title: 'QA power work live', status: 'running', run: 'qa-run-pwlive', t: now - 20, rows: () => [
    row('user', 'Book the trip', now - 200),
    row('assistant', '', now - 190, { tool_calls: [call('l1', 'Search flights')] }),
    row('tool', '{"ok":true}', now - 150, { tool_call_id: 'l1', plan: PLAN3(['completed', 'in_progress', 'pending']) }),
    row('assistant', '', now - 140, { tool_calls: [call('l2', 'Ask a question', { question: { text: 'Window or aisle seat?', choices: ['Window', 'Aisle'], state: 'waiting' } })] }),
  ] },
  qa_pw_long: { title: 'QA power long', status: 'completed', t: now - 70, rows: () => { const r = []; for (let k = 0; k < 120; k++) { r.push(row('user', `Question number ${k}`, now - 86400 * 2 + k * 600)); r.push(row('assistant', k === 119 ? Array.from({ length: 30 }, (_, j) => `Final answer paragraph ${j} with enough words to wrap onto a second line on a phone.`).join('\n\n') : `Answer number ${k}\n\nwith a second paragraph so the thread is tall enough to scroll.`, now - 86400 * 2 + k * 600 + 60)); } return r; } },
};
function fixSession(id) {
  const f = FIX[id], rows = f.rows(), last = rows[rows.length - 1], lastU = [...rows].reverse().find(r => r.role === 'user');
  return { id, source: 'wizard-mobile', title: f.title, status: f.status, archived: false, hidden: false, message_count: rows.length, model: f.model || undefined, provider: f.provider || undefined,
    started_at: f.t - 600, last_active: f.t, wizard_last_user_at: lastU.timestamp, wizard_last_assistant_at: f.t, wizard_activity_at: f.t, wizard_run_id: f.run || '',
    latest_message: { role: last.role, content: String(last.content || '').slice(0, 200), timestamp: last.timestamp },
    last_user_message: { role: 'user', content: String(lastU.content).slice(0, 200), timestamp: lastU.timestamp } };
}
const ATTENTION = [
  { id: 'qa_att_retry', kind: 'failed_activity', title: 'QA nightly digest failed', detail: 'The digest job stopped with an error.', failed_at: now - 900, can_retry: true },
  { id: 'qa_att_dismiss', kind: 'failed_activity', title: 'QA backup check failed', detail: 'Could not reach the backup host.', failed_at: now - 1800, can_retry: false },
];

/* ---------------- the browser fence ---------------- */
const writes = [], continuedWrites = [];
let attention = ATTENTION.slice(), modelOptionsFail = false, routeCalls = 0, failUpload = false;
function routeFor(tag) {
  return async r => {
    const q = r.request(), u = new URL(q.url()), m = q.method();
    const wm = u.pathname.match(/\/wizard-os-home\/((?:core\/|desktop\/)?[a-z-]+\.(?:js|css)|index\.html|desktop\.html|)$/);
    if (WEB && wm && m === 'GET' && !/^(data|summaries)\.js$/.test(wm[1])) { const f = wm[1] || 'index.html', fp = path.join(WEB, 'web', f); if (fs.existsSync(fp)) return r.fulfill({ status: 200, contentType: f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : 'application/javascript', body: fs.readFileSync(fp) }); }
    const json = (status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (m !== 'GET' && m !== 'HEAD') {
      const buf = q.postDataBuffer() || Buffer.alloc(0);
      const w = { tag, m, p: u.pathname, body: /upload|transcribe/.test(u.pathname) ? `<${buf.length} bytes>` : buf.toString(), at: Date.now(), idem: q.headers()['idempotency-key'] || '' };
      writes.push(w);
      if (/\/(transcribe)$/.test(u.pathname)) return json(200, { text: 'QA voice reply words', ms: 5 });
      if (/\/route$/.test(u.pathname)) { routeCalls++; return json(200, { ms: 5, cmd: { route: 'agent', thread: 'qa_pw_other' } }); }
      if (/\/wizard\/files\/upload$/.test(u.pathname)) { if (failUpload) return json(403, { error: 'qa: upload refused' }); return json(201, { file: { id: 'drop_qavoice' + writes.length, filename: q.headers()['x-wizard-filename'] || 'voice.webm', mime: q.headers()['x-wizard-mime'] || 'audio/webm', bytes: buf.length } }); }
      if (/\/api\/sessions\/[^/]+\/model$/.test(u.pathname)) { await sleep(150); return json(200, { ok: true }); }
      if (/\/wizard\/attention\/[^/]+\/(retry|dismiss)$/.test(u.pathname)) { const id = decodeURIComponent(u.pathname.split('/')[3]); attention = attention.filter(a => a.id !== id); await sleep(150); return json(200, { ok: true }); }
      if (/\/wizard\/session-failure\/[^/]+\/dismiss$/.test(u.pathname)) { await sleep(150); return json(200, { ok: true }); }
      if (/\/api\/sessions$/.test(u.pathname)) return json(200, { session: { id: JSON.parse(w.body || '{}').id || 'qa-fake-session' } });
      if (/\/v1\/runs$/.test(u.pathname)) return json(202, { run_id: 'qa-fake-run-' + writes.length, status: 'queued' });
      if (u.pathname === '/wizard/thread-seen') return json(200, { state: JSON.parse(w.body || '{}').state || { initializedAt: Date.now(), threads: {} } });
      return json(200, {});
    }
    if (!u.pathname.startsWith('/wizard/')) return r.continue();
    if (u.pathname === '/wizard/hermes/api/sessions' && (u.searchParams.get('offset') || '0') === '0') {
      const res = await r.fetch(); const p = await res.json();
      p.data = Object.keys(FIX).map(fixSession).concat(p.data || []);
      return json(200, p);
    }
    if (u.pathname === '/wizard/attention') return json(200, { attention });
    if (u.pathname === '/wizard/hermes/api/model/options' && modelOptionsFail) return json(503, { error: 'qa: models down' });
    const mm = u.pathname.match(/\/wizard\/hermes\/api\/sessions\/([^/]+)\/messages$/);
    if (mm && FIX[mm[1]]) { rid = 1; const rows = FIX[mm[1]].rows().map(x => ({ ...x, session_id: mm[1] })); const off = +u.searchParams.get('offset') || 0, lim = +u.searchParams.get('limit') || 500; const page = rows.slice(off, off + lim); return json(200, { object: 'list', data: page, pagination: { limit: lim, offset: off, returned: page.length } }); }
    const sm = u.pathname.match(/\/wizard\/hermes\/api\/sessions\/([^/]+)$/); if (sm && FIX[sm[1]]) return json(200, { session: fixSession(sm[1]) });
    if (u.pathname === '/wizard/hermes/v1/runs/qa-run-pwlive') return json(200, { run_id: 'qa-run-pwlive', status: 'running', session_id: 'qa_pw_live' });
    if (/\/wizard\/hermes\/v1\/runs\/qa-/.test(u.pathname)) return /events$/.test(u.pathname) ? r.fulfill({ status: 200, contentType: 'text/event-stream', body: '' }) : json(200, { run_id: 'qa-fake-run', status: 'queued' });
    return r.continue();
  };
}
async function fence(ctx, tag) {
  await ctx.route('**/*', routeFor(tag));
  // A write that the route did not fulfil would show up here with no matching intercept.
  ctx.on('requestfinished', q => { if (q.method() !== 'GET' && q.method() !== 'HEAD' && !writes.some(w => w.p === new URL(q.url()).pathname)) continuedWrites.push(q.url()); });
}
const refusedAt = async () => { try { const r = await fetch(origin + '/__qa/refused'); return (await r.json()).refused; } catch (e) { return null; } };
const runsTo = (sid, since = 0) => writes.slice(since).filter(w => w.m === 'POST' && /\/wizard\/hermes\/v1\/runs$/.test(w.p)).map(w => { try { return JSON.parse(w.body); } catch (e) { return {}; } }).filter(b => !sid || b.session_id === sid);
async function until(fn, ms = 8000, step = 100) { const t = Date.now() + ms; while (Date.now() < t) { const v = await fn(); if (v) return v; await sleep(step); } return await fn(); }

/* =============================== PHONE =============================== */
(async () => {
  const b = await chromium.launch({ executablePath: fs.existsSync(EXEC) ? EXEC : undefined, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true });
  await ctx.grantPermissions(['microphone'], { origin });
  await fence(ctx, 'phone');
  const refused0 = await refusedAt();
  const p = await ctx.newPage(); p.setDefaultTimeout(8000);
  const errs = [];
  p.on('pageerror', e => errs.push('phone: ' + String(e)));
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|frame-ancestors|Framing/.test(m.text())) errs.push('phone console: ' + m.text()); });
  await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); } catch (e) {} });
  const back = async () => { await p.keyboard.press('Escape'); await sleep(450); };
  const wid = () => p.evaluate(() => Object.values(__wos.wins).find(w => w.app === 'chats')?.id);
  const thread = () => p.evaluate(() => Object.values(__wos.wins).find(w => w.app === 'chats')?.thread ?? null);
  const backLog = () => p.evaluate(() => (__wos.back.log || []).slice(-1)[0] || '');
  async function openThread(id) {
    await p.evaluate(id => __wos.openWizardThread(id), id);
    await p.waitForFunction(id => { const w = Object.values(__wos.wins).find(x => x.app === 'chats'); return w?.thread === id && document.querySelector(`[data-chats="${w.id}"] .ch-msgs .msg`); }, id, { timeout: 30000 }).catch(() => {});
    await sleep(500);
  }
  const S = async sel => `[data-chats="${await wid()}"] ${sel}`;
  const sheetOpen = () => p.evaluate(() => !!document.querySelector('.ch-psheet'));
  // Scroll only the nearest scroller (scrollIntoView would also shift the phone shell itself).
  const reveal = (sel, where = 'center') => p.evaluate(([sel, where]) => { const el = document.querySelector(sel); if (!el) return false; let sc = el.parentElement; while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement; if (!sc) return false; const r = el.getBoundingClientRect(), bb = sc.getBoundingClientRect(); sc.scrollTop += where === 'start' ? r.top - bb.top - 40 : (r.top + r.height / 2) - (bb.top + bb.height / 2); return true; }, [sel, where]);

  await p.goto(URL_, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__wos?.live?.ok && window.__wos.live.session('qa_pw_ready'), null, { timeout: 90000 }).catch(() => {});
  ok(await p.evaluate(() => !!window.__wos?.live?.session('qa_pw_ready')), 'phone: Wizard thread list loaded (real + fixture threads)');
  await p.evaluate(() => __wos.goDesk(1)); await sleep(600);
  const realModels = await (await fetch(origin + '/wizard/hermes/api/model/options')).json().catch(() => ({}));

  /* ===== #11 model chip + picker on a thread ===== */
  try {
    await openThread('qa_pw_ready');
    await p.waitForFunction(() => window.WosModels?.ready, null, { timeout: 15000 }).catch(() => {});
    await sleep(300);
    const chip = await p.evaluate(sel => document.querySelector(sel)?.textContent.trim() || null, await S('.ch-head [data-chmodel]'));
    ok(chip && /^Opus/.test(chip), '#11 phone: thread header shows the thread’s model chip (Opus)', chip);
    const nOpts = await p.evaluate(() => window.WosModels?.options.length || 0);
    ok(nOpts >= 5 && await p.evaluate(d => window.WosModels.defaultOption()?.value === d, realModels.model), '#11 model options come from real /api/model/options, default = Hermes default', { nOpts, def: realModels.model });
    await p.click(await S('[data-chmodel]')); await sleep(400);
    const sh = await p.evaluate(() => { const s = document.querySelector('.ch-psheet.ch-msheet'); return s && { rows: s.querySelectorAll('[data-mpick]').length, on: [...s.querySelectorAll('[data-mpick]')].findIndex(x => x.classList.contains('on')), title: s.querySelector('.ch-sheet-t')?.textContent, more: !!s.querySelector('[data-mall]') }; });
    ok(sh && sh.rows >= 2 && sh.on >= 0 && /Model for this thread/.test(sh.title), '#11 phone: tapping the chip opens the picker with the current model ticked', sh);
    await sleep(350);
    await p.screenshot({ path: `${OUT}/phone-01-model-picker.png` });
    await back();
    ok(!(await sheetOpen()) && (await thread()) === 'qa_pw_ready' && (await backLog()) === 'chat-sheet', '#11 phone: Back closes the model picker and stays in the thread', await backLog());
    await p.click(await S('[data-chmodel]')); await sleep(300);
    const pick = await p.evaluate(() => { const rows = [...document.querySelectorAll('.ch-psheet [data-mpick]')]; const i = rows.findIndex(x => !x.classList.contains('on')); const o = window.WosModels.visible('claude-opus-5-5', 'anthropic')[+rows[i].dataset.mpick]; return { i, value: o.value, provider: o.provider, short: window.WosModels.short(o.value, o.provider) }; });
    const n0 = writes.length;
    await p.click(`.ch-psheet [data-mpick="${pick.i}"]`);
    const mw = await until(() => writes.slice(n0).find(w => w.p === '/wizard/hermes/api/sessions/qa_pw_ready/model'));
    const mb = mw ? JSON.parse(mw.body) : {};
    ok(mw && mw.m === 'POST' && mb.model === pick.value && mb.provider === pick.provider, '#11 phone: picking sends POST /api/sessions/:id/model with the chosen id (intercepted)', { pick, body: mw?.body });
    await sleep(500);
    const chip2 = await p.evaluate(sel => document.querySelector(sel)?.textContent.trim() || null, await S('[data-chmodel]'));
    ok(!(await sheetOpen()) && chip2 && chip2.startsWith(pick.short), '#11 phone: the picker closes and the chip shows the new model', { chip2, want: pick.short });
    ok(runsTo('', n0).length === 0, '#11 changing the model sends no message');
  } catch (e) { ok(false, '#11 thread picker section crashed', String(e).split('\n')[0]); }

  /* ===== #11 new chat: the picker's choice rides with the first send ===== */
  try {
    await p.evaluate(() => { const w = Object.values(__wos.wins).find(x => x.app === 'chats'); __wos.openChat(w.id, '__new__'); });
    await sleep(600);
    const chip = await p.evaluate(sel => document.querySelector(sel)?.textContent.trim() || null, await S('[data-chmodel]'));
    ok(chip && /^Opus/.test(chip), '#11 phone: a new chat starts on the Hermes default model', chip);
    await p.click(await S('[data-chmodel]')); await sleep(300);
    const t = await p.evaluate(() => document.querySelector('.ch-psheet .ch-sheet-t')?.textContent);
    ok(/Model for this new chat/.test(t || ''), '#11 phone: the new-chat picker says it is for this new chat', t);
    const pick = await p.evaluate(() => { const rows = [...document.querySelectorAll('.ch-psheet [data-mpick]')]; const d = window.WosModels.defaultOption(); const list = window.WosModels.visible(d.value, d.provider); const i = rows.findIndex(x => !x.classList.contains('on')); const o = list[+rows[i].dataset.mpick]; return { i, value: o.value, provider: o.provider }; });
    const n0 = writes.length;
    await p.click(`.ch-psheet [data-mpick="${pick.i}"]`); await sleep(400);
    ok(!writes.slice(n0).some(w => /\/model$/.test(w.p)), '#11 phone: a new chat’s pick is kept locally until the first send');
    await p.fill(await S('.ch-compose textarea'), 'QA new chat on a picked model');
    await p.click(await S('.ch-compose button[type="submit"]'));
    const sw = await until(() => writes.slice(n0).find(w => w.p === '/wizard/hermes/api/sessions' && w.m === 'POST'));
    const rw = await until(() => runsTo('', n0).find(r => r.input === 'QA new chat on a picked model'));
    const sb = sw ? JSON.parse(sw.body) : {};
    ok(sb.model === pick.value && rw && rw.model === pick.value && rw.session_id === sb.id, '#11 phone: the new chat is created and its first run admitted on the picked model (intercepted)', { pick, session: sw?.body, run: rw });
  } catch (e) { ok(false, '#11 new chat section crashed', String(e).split('\n')[0]); }

  /* ===== #11 the picker when model options fail ===== */
  try {
    modelOptionsFail = true;
    await p.evaluate(async () => { WosModels.ready = false; WosModels.options = []; await WosModels.load(true); });
    await openThread('qa_pw_other');
    await p.click(await S('[data-chmodel]')); await sleep(300);
    const txt = await p.evaluate(() => document.querySelector('.ch-psheet')?.textContent || '');
    ok(/Models unavailable \(503\)/.test(txt) && !(await p.evaluate(() => document.querySelector('.ch-psheet [data-mpick]'))), '#11 phone: a failing options endpoint says so in the picker (no stale list)', txt.slice(0, 160));
    await back();
    modelOptionsFail = false;
    await p.evaluate(async () => { await WosModels.load(true); });
    ok(await p.evaluate(() => WosModels.ready && WosModels.options.length > 3), '#11 the picker recovers when options load again');
  } catch (e) { ok(false, '#11 options-failure section crashed', String(e).split('\n')[0]); modelOptionsFail = false; }

  /* ===== #11 failed thread: Retry · Choose another model · Dismiss ===== */
  try {
    await openThread('qa_pw_fail');
    const fp = await p.evaluate(sel => { const f = document.querySelector(sel); return f && { text: f.textContent, btns: [...f.querySelectorAll('button')].map(b => b.textContent.trim()), dis: [...f.querySelectorAll('button')].map(b => b.disabled) }; }, await S('.ch-fail'));
    ok(fp && fp.btns.join('|') === 'Retry|Choose another model|Dismiss' && !fp.dis.some(Boolean) && /Opus/.test(fp.text), '#11 phone: a failed thread shows Retry / Choose another model / Dismiss and its model', fp);
    await reveal(await S('.ch-fail')); await sleep(200);
    await p.screenshot({ path: `${OUT}/phone-02-failed-thread.png` });
    const n0 = writes.length;
    await p.click(await S('[data-chretry]'));
    const rr = await until(() => runsTo('qa_pw_fail', n0)[0]);
    const rw = writes.slice(n0).find(w => /\/v1\/runs$/.test(w.p));
    ok(rr && rr.input === 'Summarise the quarterly numbers' && rr.model === 'claude-opus-5-5' && !!rw?.idem, '#11 phone: Retry re-sends the last request on the same model through the outbox (Idempotency-Key, intercepted)', { rr, idem: rw?.idem });
    ok(await p.evaluate(() => __wos.outbox.unsent().length === 0 || __wos.outbox.unsent().every(it => it.state !== 'failed')), '#11 the retried message is delivered by the outbox');
    await sleep(400);
    ok(!(await p.evaluate(sel => document.querySelector(sel), await S('.ch-fail'))), '#11 phone: after Retry the Needs-retry panel clears');

    await openThread('qa_pw_intr');
    ok(/Interrupted/.test(await p.evaluate(sel => document.querySelector(sel)?.textContent || '', await S('.ch-fail'))), '#11 phone: an interrupted thread says Interrupted');
    await p.click(await S('[data-chretrymodel]')); await sleep(400);
    const t = await p.evaluate(() => document.querySelector('.ch-psheet .ch-sheet-t')?.textContent || '');
    ok(/Retry with another model/.test(t), '#11 phone: Choose another model opens the picker in retry mode', t);
    await p.screenshot({ path: `${OUT}/phone-03-retry-with-model.png` });
    const pick = await p.evaluate(() => { const rows = [...document.querySelectorAll('.ch-psheet [data-mpick]')]; const s = __wos.live.session('qa_pw_intr'); const list = WosModels.visible(s.model || '', s.provider || ''); const i = rows.findIndex(x => /Sonnet|Sol|Haiku|Luna|Terra/.test(x.textContent)); const k = i < 0 ? 1 : i; const o = list[+rows[k].dataset.mpick]; return { k, value: o.value, provider: o.provider }; });
    const n1 = writes.length;
    await p.click(`.ch-psheet [data-mpick="${pick.k}"]`);
    const r2 = await until(() => runsTo('qa_pw_intr', n1)[0]);
    const mw = writes.slice(n1).find(w => w.p === '/wizard/hermes/api/sessions/qa_pw_intr/model');
    ok(mw && JSON.parse(mw.body).model === pick.value && r2 && r2.model === pick.value && r2.input === 'Tidy the downloads folder', '#11 phone: picking a model sets it on the thread, then re-sends the request on it (intercepted)', { pick, model: mw?.body, run: r2 });

    await openThread('qa_pw_fail2');
    const n2 = writes.length;
    await p.click(await S('[data-chdismiss]'));
    const dw = await until(() => writes.slice(n2).find(w => w.p === '/wizard/session-failure/qa_pw_fail2/dismiss'));
    await sleep(400);
    ok(dw && dw.m === 'POST' && runsTo('qa_pw_fail2', n2).length === 0, '#11 phone: Dismiss posts /wizard/session-failure/:id/dismiss and sends nothing (intercepted)', dw);
    ok(!(await p.evaluate(sel => document.querySelector(sel), await S('.ch-fail'))) && (await thread()) === 'qa_pw_fail2', '#11 phone: after Dismiss the panel clears and the thread stays');
  } catch (e) { ok(false, '#11 failed-thread section crashed', String(e).split('\n')[0]); }

  /* ===== #12 Errors section ===== */
  try {
    await back(); // to the list
    await p.evaluate(() => WosErrors.load(true)); await sleep(500);
    const L = await S('[data-sec="errors"]');
    const es = await p.evaluate(sel => { const s = document.querySelector(sel); if (!s) return null; return { n: s.querySelector('.ch-sec-h small')?.textContent, rows: [...s.querySelectorAll('[data-errsid]')].map(x => x.dataset.errsid), att: [...s.querySelectorAll('[data-errattn]')].map(x => x.dataset.errattn), retryAtt: !!s.querySelector('[data-attretry="qa_att_retry"]'), retryNo: !!s.querySelector('[data-attretry="qa_att_dismiss"]') }; }, L);
    ok(es && es.rows.includes('qa_pw_fail3') && es.rows.includes('qa_pw_fail4') && !es.rows.includes('qa_pw_fail2'), '#12 phone: Errors lists failed threads (a dismissed one stays out)', es);
    ok(es && es.att.join(',') === 'qa_att_retry,qa_att_dismiss' && es.retryAtt && !es.retryNo, '#12 phone: Errors lists failed background work; Retry only where Wizard allows it', es);
    await reveal(L, 'start'); await sleep(200);
    await p.screenshot({ path: `${OUT}/phone-04-errors-section.png` });
    let n0 = writes.length;
    await p.click(`${L} [data-errretry="qa_pw_fail3"]`);
    const r3 = await until(() => runsTo('qa_pw_fail3', n0)[0]);
    ok(r3 && r3.input === 'Rename the photos', '#12 phone: Retry on a failed thread row re-sends its request via the outbox (intercepted)', r3);
    n0 = writes.length;
    await p.click(`${L} [data-errdismiss="qa_pw_fail4"]`);
    const d4 = await until(() => writes.slice(n0).find(w => w.p === '/wizard/session-failure/qa_pw_fail4/dismiss'));
    ok(d4 && d4.m === 'POST', '#12 phone: Dismiss on a failed thread row posts /wizard/session-failure/:id/dismiss', d4);
    n0 = writes.length;
    await p.click(`${L} [data-attretry="qa_att_retry"]`);
    const ar = await until(() => writes.slice(n0).find(w => w.p === '/wizard/attention/qa_att_retry/retry'));
    await sleep(400);
    ok(ar && ar.m === 'POST' && !(await p.evaluate(sel => document.querySelector(sel), `${L} [data-errattn="qa_att_retry"]`)), '#12 phone: Retry on failed work posts /wizard/attention/:id/retry and the row goes', ar);
    n0 = writes.length;
    await p.click(`${L} [data-attdismiss="qa_att_dismiss"]`);
    const ad = await until(() => writes.slice(n0).find(w => w.p === '/wizard/attention/qa_att_dismiss/dismiss'));
    await sleep(400);
    ok(ad && ad.m === 'POST' && !(await p.evaluate(sel => document.querySelector(sel), `${L} [data-errattn="qa_att_dismiss"]`)), '#12 phone: Dismiss on failed work posts /wizard/attention/:id/dismiss and the row goes', ad);
    ok(!writes.slice(n0).some(w => /\/v1\/runs/.test(w.p)), '#12 Dismiss sends no message');
  } catch (e) { ok(false, '#12 Errors section crashed', String(e).split('\n')[0]); }

  /* ===== #13 composer mic: a voice reply pinned to THIS thread ===== */
  try {
    await openThread('qa_pw_ready');
    const mic = await S('.ch-compose [data-chmic]');
    ok(await p.evaluate(sel => !!document.querySelector(sel), mic), '#13 phone: the composer has a mic button');
    const n0 = writes.length, route0 = routeCalls;
    await p.click(mic);
    await until(() => p.evaluate(() => __wos.voice === 'listen'), 4000);
    await sleep(400);
    const on = await p.evaluate(sel => ({ voice: __wos.voice, on: document.querySelector(sel)?.classList.contains('on'), pin: __wos.V.replyTo?.sid }), mic);
    ok(on.voice === 'listen' && on.on && on.pin === 'qa_pw_ready', '#13 phone: tapping the mic records (fake mic) and pins the take to this thread', on);
    await p.screenshot({ path: `${OUT}/phone-05-composer-mic-recording.png` });
    // Wander off mid-take: another thread is now the one on screen (and the orb's router would say qa_pw_other).
    await openThread('qa_pw_other');
    ok(await p.evaluate(() => !document.querySelector('[data-chats] .ch-compose [data-chmic].on')), '#13 phone: the other thread’s mic is not lit');
    await sleep(800);
    const o = await p.locator('#orbWrap').boundingBox();
    await p.touchscreen.tap(o.x + o.width / 2, o.y + o.height / 2);
    const vr = await until(() => runsTo('', n0).find(r => r.input === 'QA voice reply words'), 15000);
    ok(vr && vr.session_id === 'qa_pw_ready', '#13 phone: the voice reply lands in the thread it was started in, not the one on screen', vr);
    ok(vr && Array.isArray(vr.wizard_file_ids) && vr.wizard_file_ids.some(id => /^drop_qavoice/.test(id)), '#13 phone: the recording rides along as a voice note (wizard_file_ids)', vr?.wizard_file_ids);
    ok(routeCalls === route0 && writes.slice(n0).some(w => /\/transcribe$/.test(w.p)), '#13 phone: no router call; transcribed by the outbox (intercepted)', { routeCalls, route0 });
    ok(!runsTo('qa_pw_other', n0).length, '#13 phone: nothing went to the thread on screen');
    // Second take: attach screenshots in the composer first (James's case), then tap the mic again to send.
    await until(() => p.evaluate(() => __wos.voice === 'idle'), 4000);
    const n1 = writes.length;
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click(await S('.ch-compose [data-chattach]'))]);
    await fc.setFiles([{ name: 'Screenshot_qa_1.png', mimeType: 'image/png', buffer: png }, { name: 'Screenshot_qa_2.png', mimeType: 'image/png', buffer: png }]);
    const shotIds = await until(() => p.evaluate(() => { const d = JSON.parse(localStorage.getItem('wos.chat.drafts.v1') || '{}')['direct:qa_pw_other']; return d && d.files.length === 2 ? d.files.map(f => f.id) : null; }), 8000);
    ok(shotIds && shotIds.length === 2, '#13b phone: two screenshots attached in the composer (saved with the draft)', shotIds);
    await p.click(await S('.ch-compose [data-chmic]'));
    await until(() => p.evaluate(() => __wos.voice === 'listen'), 4000); await sleep(1500);
    await p.click(await S('.ch-compose [data-chmic]'));
    const vr2 = await until(() => runsTo('', n1).find(r => r.input === 'QA voice reply words'), 15000);
    ok(vr2 && vr2.session_id === 'qa_pw_other', '#13 phone: tapping the mic again sends the reply to this thread', vr2);
    ok(vr2 && (shotIds || []).every(id => (vr2.wizard_file_ids || []).includes(id)), '#13b phone: the composer’s attachments ride along with the voice reply', { sent: vr2?.wizard_file_ids, shotIds });
    await sleep(400);
    const left = await p.evaluate(async sel => ({ tray: document.querySelectorAll(`${sel} .ch-att`).length, draft: JSON.parse(localStorage.getItem('wos.chat.drafts.v1') || '{}')['direct:qa_pw_other'] || null }), await S('.ch-compose'));
    ok(left.tray === 0 && !left.draft, '#13b phone: after the voice reply sends, the composer tray is empty and no draft is left behind', left);
    await back(); await sleep(300);
    const draftRows = await p.evaluate(() => document.querySelectorAll('.ch-draft').length);
    await openThread('qa_pw_other');
    const reopen = await p.evaluate(async sel => document.querySelectorAll(`${sel} .ch-att`).length, await S('.ch-compose'));
    ok(reopen === 0, '#13b phone: reopening the thread shows no stale attachments', { reopen, draftRows });
    // A voice note that can't be delivered shows in Errors with Retry / Dismiss.
    await until(() => p.evaluate(() => __wos.voice === 'idle'), 4000);
    failUpload = true;
    const n2 = writes.length;
    await p.click(await S('.ch-compose [data-chmic]'));
    await until(() => p.evaluate(() => __wos.voice === 'listen'), 4000); await sleep(1500);
    await p.click(await S('.ch-compose [data-chmic]'));
    const failed = await until(() => p.evaluate(() => __wos.outbox.unsent().find(it => it.state === 'failed' && it.audio)?.id || ''), 15000);
    ok(!!failed, '#12/#13 phone: a voice reply Wizard refuses stays in the outbox as failed', failed);
    await back(); await sleep(300);
    const L = await S('[data-sec="errors"]');
    const vrow = await p.evaluate(([sel, id]) => { const r = document.querySelector(`${sel} [data-errob="${id}"]`); return r && r.textContent; }, [L, failed]);
    ok(vrow && /Voice note/.test(vrow) && /Not sent/.test(vrow), '#12 phone: the failed voice note shows in Errors', vrow);
    failUpload = false;
    // The list's first rows: scroll every scroller back to the top so no sticky header sits over the button.
    await p.evaluate(sel => { let el = document.querySelector(sel); while (el) { if (el.scrollTop) el.scrollTop = 0; el = el.parentElement; } document.scrollingElement.scrollTop = 0; }, `${L} [data-errob="${failed}"]`); await sleep(250);
    const hit = await p.evaluate(sel => { const b = document.querySelector(sel), r = b.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === b; }, `${L} [data-errob="${failed}"] [data-obretry]`);
    ok(hit, '#12 phone: the voice note row sits in the Errors list, its Retry not covered (no clash with the orb’s .voice layer)');
    await p.click(`${L} [data-errob="${failed}"] [data-obretry]`);
    const vr3 = await until(() => runsTo('qa_pw_other', n2)[0], 15000);
    ok(vr3 && vr3.input === 'QA voice reply words', '#12 phone: Retry on a failed voice note delivers it to its thread', vr3);
  } catch (e) { await p.screenshot({ path: `${OUT}/fail-13.png` }).catch(() => {}); ok(false, '#13 composer mic section crashed', String(e).split('\n').slice(0, 6).join(' / ')); failUpload = false; }

  /* ===== #17 work receipt ===== */
  try {
    await openThread('qa_pw_work');
    const wk = await p.evaluate(sel => { const d = document.querySelector(sel); return d && { sum: d.querySelector('summary').textContent.trim() }; }, await S('details.wk'));
    ok(wk && /^◇ Worked for \d/.test(wk.sum) && /2 of 3 done/.test(wk.sum) && /3 steps/.test(wk.sum), '#17 phone: a finished turn reads “Worked for … · 2 of 3 done · 3 steps”', wk);
    await p.click(await S('details.wk summary')); await sleep(300);
    const body = await p.evaluate(sel => { const d = document.querySelector(sel); return d && { open: d.open, steps: [...d.querySelectorAll('.wk-steps li span')].map(x => x.textContent), times: [...d.querySelectorAll('.wk-steps li time')].map(x => x.textContent), plan: [...d.querySelectorAll('.wk-plan li')].map(x => x.className + ':' + x.textContent), q: d.querySelector('.wk-q')?.textContent || '' }; }, await S('details.wk'));
    ok(body && body.steps.join('|') === 'Read the calendar|Draft the summary|Ask which week' && body.times.every(t => /^\d+(s|m)/.test(t)), '#17 phone: opening it lists the named steps with durations', body);
    ok(body && body.plan.length === 3 && /^completed:.*Read the calendar/.test(body.plan[0]) && /^pending:.*Send it to the team/.test(body.plan[2]), '#17 phone: the plan checklist shows each item’s state', body?.plan);
    ok(body && /You answered/.test(body.q) && /Which week should I plan\?/.test(body.q) && /Next week/.test(body.q), '#17 phone: an answered question shows the question and the answer', body?.q);
    await reveal(await S('details.wk'), 'start'); await sleep(200);
    await p.screenshot({ path: `${OUT}/phone-06-work-receipt.png` });
    await openThread('qa_pw_live');
    await p.waitForFunction(() => document.querySelector('[data-chats] details.wk.live'), null, { timeout: 8000 }).catch(() => {});
    const lv = await p.evaluate(() => { const d = document.querySelector('[data-chats] details.wk.live'); if (!d) return null; d.open = true; return { sum: d.querySelector('summary').textContent.trim(), asks: d.classList.contains('asks'), q: d.querySelector('.wk-q')?.textContent || '', run: !!d.querySelector('.wk-steps li.run') }; });
    ok(lv && /1 of 3/.test(lv.sum) && /Waiting on you/.test(lv.sum) && lv.asks, '#17 phone: a live turn reads “1 of 3 · Waiting on you · …”', lv);
    ok(lv && /Waiting on you/.test(lv.q) && /Window or aisle seat\?/.test(lv.q) && /Reply in this thread/.test(lv.q), '#17 phone: the waiting question is shown with how to answer', lv?.q);
    await sleep(200);
    await p.screenshot({ path: `${OUT}/phone-07-work-live-question.png` });
  } catch (e) { ok(false, '#17 work receipt section crashed', String(e).split('\n')[0]); }

  /* ===== #18 reading position + ↓ Latest ===== */
  try {
    const RP = 'wizard.mobile.reading-positions.v1';
    await p.evaluate(k => localStorage.removeItem(k), RP);
    await openThread('qa_pw_long');
    const first = await p.evaluate(sel => { const nb = document.querySelector(sel); const a = [...nb.querySelectorAll('.msg.a')].pop(); return { top: Math.round(a.getBoundingClientRect().top - nb.getBoundingClientRect().top), gap: nb.scrollHeight - nb.scrollTop - nb.clientHeight }; }, await S('.ch-msgs'));
    ok(first.top >= 0 && first.top < 40, '#18 phone: a thread opens at the first line of the latest reply', first);
    const mid = await p.evaluate(sel => { const nb = document.querySelector(sel); nb.scrollTop = Math.round(nb.scrollHeight * 0.4); nb.dispatchEvent(new Event('scroll')); return nb.scrollTop; }, await S('.ch-msgs'));
    await sleep(600);
    const lat = await p.evaluate(sel => { const b = document.querySelector(sel); return b && !b.hidden && b.offsetParent !== null; }, await S('[data-chlatest]'));
    ok(lat, '#18 phone: scrolled up, “↓ Latest” appears');
    await p.screenshot({ path: `${OUT}/phone-08-latest-button.png` });
    const saved = await p.evaluate(k => JSON.parse(localStorage.getItem(k) || '{}').qa_pw_long || null, RP);
    ok(saved && Math.abs(saved.scrollTop - mid) < 4 && saved.messageId, '#18 phone: the reading place is saved (legacy key, per thread)', { saved, mid });
    await back();
    await openThread('qa_pw_long');
    const back1 = await p.evaluate(sel => document.querySelector(sel).scrollTop, await S('.ch-msgs'));
    ok(Math.abs(back1 - mid) < 30, '#18 phone: reopening within the hour returns to the same place', { back1, mid });
    await p.click(await S('[data-chlatest]'));
    await until(async () => p.evaluate(sel => { const nb = document.querySelector(sel); return nb.scrollHeight - nb.scrollTop - nb.clientHeight < 10; }, await S('.ch-msgs')), 4000);
    await sleep(300);
    const end = await p.evaluate(sel => { const nb = document.querySelector(sel); return { gap: nb.scrollHeight - nb.scrollTop - nb.clientHeight, hidden: document.querySelector(sel.replace('.ch-msgs', '[data-chlatest]')).hidden }; }, await S('.ch-msgs'));
    ok(end.gap < 10 && end.hidden, '#18 phone: “↓ Latest” jumps to the bottom and hides', end);
    // Older than an hour: forgotten.
    await p.evaluate(sel => { const nb = document.querySelector(sel); nb.scrollTop = Math.round(nb.scrollHeight * 0.3); nb.dispatchEvent(new Event('scroll')); }, await S('.ch-msgs'));
    await sleep(600);
    await back();
    await p.evaluate(k => { const all = JSON.parse(localStorage.getItem(k) || '{}'); if (all.qa_pw_long) all.qa_pw_long.savedAt = Date.now() - 61 * 60e3; localStorage.setItem(k, JSON.stringify(all)); }, RP);
    await openThread('qa_pw_long');
    const old = await p.evaluate(sel => { const nb = document.querySelector(sel); const a = [...nb.querySelectorAll('.msg.a')].pop(); return Math.round(a.getBoundingClientRect().top - nb.getBoundingClientRect().top); }, await S('.ch-msgs'));
    ok(old >= 0 && old < 40, '#18 phone: a place older than an hour is forgotten (opens at the latest reply)', old);
  } catch (e) { ok(false, '#18 reading position section crashed', String(e).split('\n')[0]); }

  /* ===== #23 Files ===== */
  let realFiles = [];
  try {
    realFiles = ((await (await fetch(origin + '/wizard/files')).json()).files || []).filter(f => !f.status || f.status === 'ready');
    await openThread('qa_pw_ready');
    await p.click(await S('.ch-compose [data-chfiles]'));
    await p.waitForFunction(() => document.querySelectorAll('.ch-psheet [data-fiattach]').length > 0, null, { timeout: 15000 }).catch(() => {});
    const fl = await p.evaluate(() => ({ rows: [...document.querySelectorAll('.ch-psheet [data-fiid]')].map(x => x.dataset.fiid), head: document.querySelector('.ch-psheet .fi-top small')?.textContent }));
    ok(realFiles.length > 0 && fl.rows.length === Math.min(200, realFiles.length) && fl.rows[0] === realFiles[0].id, '#23 phone: Files lists the real /wizard/files, newest first', { got: fl.rows.length, want: realFiles.length, head: fl.head });
    const lay = await p.evaluate(() => { const t = document.querySelector('.ch-psheet .fi-kinds button'), x = document.querySelector('.ch-psheet .fi-x'), b = document.querySelector('.ch-psheet .fi-b'); const tr = t.getBoundingClientRect(), xr = x.getBoundingClientRect(), br = b.getBoundingClientRect(); return { tabH: Math.round(tr.height), xRight: Math.round(br.right - xr.right) }; });
    ok(lay.tabH >= 28 && lay.xRight < 30, '#23 phone: filter tabs keep their height and Close sits at the right edge', lay);
    await sleep(350);
    await p.screenshot({ path: `${OUT}/phone-09-files-sheet.png` });
    await p.click('.ch-psheet [data-fikind="voice"]'); await sleep(200);
    const voiceN = await p.evaluate(() => document.querySelectorAll('.ch-psheet [data-fiid]').length);
    const wantVoice = realFiles.filter(f => /^audio\//.test(f.mime) && /^wizard-(voice|everywhere)-/.test(f.filename)).length;
    ok(voiceN === Math.min(200, wantVoice), '#23 phone: the Voice filter narrows the list', { voiceN, wantVoice });
    await p.click('.ch-psheet [data-fikind="all"]'); await sleep(200);
    const fid = realFiles[0].id;
    await p.click(`.ch-psheet [data-fiattach="${fid}"]`); await sleep(400);
    const att = await p.evaluate(([fid, w]) => ({ files: (__wos.chatState(w).files || []).map(f => f.id), tray: document.querySelectorAll(`[data-chats="${w}"] .ch-tray [data-attkey]`).length, pressed: document.querySelector(`.ch-psheet [data-fiattach="${fid}"]`)?.getAttribute('aria-pressed') }), [fid, await wid()]);
    ok(att.files.join(',') === fid && att.tray === 1 && att.pressed === 'true', '#23 phone: Attach adds the file to this composer (no upload)', att);
    ok(!writes.some(w => /files\/upload/.test(w.p) && w.tag === 'phone-attach'), '#23 attaching an existing file uploads nothing');
    await p.screenshot({ path: `${OUT}/phone-10-files-attached.png` });
    await back();
    ok(!(await sheetOpen()) && (await thread()) === 'qa_pw_ready' && (await backLog()) === 'chat-sheet', '#23 phone: Back closes Files and stays in the thread', await backLog());
    const n0 = writes.length;
    await p.fill(await S('.ch-compose textarea'), 'QA please look at this file');
    await p.click(await S('.ch-compose button[type="submit"]'));
    const fr = await until(() => runsTo('qa_pw_ready', n0).find(r => r.input === 'QA please look at this file'));
    ok(fr && Array.isArray(fr.wizard_file_ids) && fr.wizard_file_ids.includes(fid), '#23 phone: the sent run carries the file in wizard_file_ids (intercepted)', fr);
    ok(!writes.slice(n0).some(w => /files\/upload/.test(w.p)), '#23 phone: no upload for an existing Wizard file');
    // Files from Settings
    await back();
    await p.evaluate(() => __wos.openSettings()); await sleep(400);
    await p.click('#settingsBody [data-st="files"]');
    await p.waitForFunction(() => document.querySelectorAll('.ch-psheet [data-fiid]').length > 0, null, { timeout: 10000 }).catch(() => {});
    ok(await p.evaluate(() => __wos.sheet === null && document.querySelectorAll('.ch-psheet [data-fiid]').length > 0), '#23 phone: Settings › Files opens the Files screen');
    await back();
    ok(!(await sheetOpen()) && await p.evaluate(() => !!window.__wos) && p.url().startsWith(URL_.replace(/\/$/, '')), '#23 phone: Back closes it; app still open');
  } catch (e) { ok(false, '#23 Files section crashed', String(e).split('\n')[0]); }

  /* ===== #24 AI usage ===== */
  try {
    const real = await (await fetch(origin + '/wizard/ai-usage')).json();
    const want = (real.providers || []).filter(x => x.status !== 'unavailable').flatMap(x => (x.limits || []).map(l => ({ id: x.id + ':' + l.id, rem: Math.round(l.remainingPercent ?? (100 - l.usedPercent)) })));
    await p.evaluate(() => __wos.openSettings());
    await p.waitForFunction(() => document.querySelectorAll('#settingsBody [data-usage] .us-row').length > 0, null, { timeout: 15000 }).catch(() => {});
    const got = await p.evaluate(() => [...document.querySelectorAll('#settingsBody [data-usage] .us-row')].map(r => ({ id: r.dataset.usageRow, rem: +r.querySelector('[role="meter"]').getAttribute('aria-valuenow'), w: r.querySelector('.us-bar i').style.width, label: r.querySelector('b').textContent, reset: r.querySelector('.us-r').textContent })));
    ok(want.length > 0 && got.length === want.length && got.every((g, i) => g.id === want[i].id && g.rem === want[i].rem && g.w === want[i].rem + '%'), '#24 phone: Settings shows one bar per real quota window, filled to what’s left', { got: got.map(g => g.id + '=' + g.rem), want: want.map(w => w.id + '=' + w.rem) });
    ok(got.some(g => /Resets in|Awaiting reset/.test(g.reset)), '#24 phone: each row says when it resets', got.map(g => g.reset));
    const tz = await p.evaluate(() => document.querySelector('#settingsBody [data-usage]').textContent);
    ok(tz.includes(await p.evaluate(() => WizConfig.timeZone())), '#24 phone: reset times use the owner’s time zone from WizConfig');
    await reveal('#settingsBody [data-usage]', 'start'); await sleep(250);
    await p.screenshot({ path: `${OUT}/phone-11-ai-usage.png` });
    await back();
    ok(await p.evaluate(() => __wos.sheet === null), '#24 phone: Back closes Settings');
  } catch (e) { ok(false, '#24 AI usage section crashed', String(e).split('\n')[0]); }

  /* ===== Back never exits, after all the new sheets ===== */
  try {
    const nb = () => p.evaluate(() => window.__wosNativeBack());
    await openThread('qa_pw_other');
    await p.click(await S('[data-chmodel]')); await sleep(300);
    const b1 = await nb(); await sleep(300);
    ok(b1 === 'chat-sheet' && (await thread()) === 'qa_pw_other' && !(await sheetOpen()), 'Back (Android) 1: closes the model picker, thread stays', b1);
    await p.click(await S('.ch-compose [data-chfiles]')); await sleep(400);
    const b2 = await nb(); await sleep(300);
    ok(b2 === 'chat-sheet' && (await thread()) === 'qa_pw_other' && !(await sheetOpen()), 'Back (Android) 2: closes Files, thread stays', b2);
    const b3 = await nb(); await sleep(400);
    ok(b3 === 'thread' && (await thread()) === null, 'Back (Android) 3: thread → list', b3);
    for (let k = 0; k < 4; k++) { await nb(); await sleep(250); }
    ok(await p.evaluate(() => !!window.__wos) && !p.isClosed(), 'Back (Android) at Home never leaves the app');
    // Browser Back too: a picker open → history Back closes it, page stays.
    await openThread('qa_pw_other');
    await p.click(await S('[data-chmodel]')); await sleep(300);
    const u0 = p.url();
    await p.goBack({ timeout: 2500 }).catch(() => {}); await sleep(600);
    ok(p.url() === u0 && await p.evaluate(() => !!window.__wos) && !(await sheetOpen()) && (await thread()) === 'qa_pw_other', 'Browser Back closes the picker and stays in the app', { u0, now: p.url() });
  } catch (e) { await p.screenshot({ path: `${OUT}/fail-back.png` }).catch(() => {}); ok(false, 'Back section crashed', String(e).split('\n').slice(0, 6).join(' / ')); }

  /* =============================== DESKTOP =============================== */
  try {
    const dctx = await b.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
    await dctx.grantPermissions(['microphone'], { origin });
    await fence(dctx, 'desktop');
    const d = await dctx.newPage(); d.setDefaultTimeout(8000);
    d.on('pageerror', e => errs.push('desktop: ' + e));
    d.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|frame-ancestors|Framing/.test(m.text())) errs.push('desktop console: ' + m.text()); });
    await d.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); } catch (e) {} });
    await d.goto(new URL('desktop.html', URL_).href, { waitUntil: 'domcontentloaded' });
    await d.waitForFunction(() => window.__wux?.live?.ok && window.__wux.live.session('qa_pw_ready'), null, { timeout: 90000 }).catch(() => {});
    ok(await d.evaluate(() => document.documentElement.dataset.shell === 'desktop' && !!window.__wux?.live?.session('qa_pw_ready')), 'desktop: the desktop shell loads the same threads');
    const dThread = () => d.evaluate(() => Object.values(__wux.wins).find(w => w.app === 'chats')?.thread ?? null);
    const dOpen = async id => {
      await d.evaluate(id => __wux.openThread(id), id);
      await d.waitForFunction(id => { const w = Object.values(__wux.wins).find(x => x.app === 'chats'); return w?.thread === id && document.querySelector('.pane-main .ch-msgs .msg'); }, id, { timeout: 30000 }).catch(() => {});
      await sleep(600);
    };
    const esc = async () => { await d.keyboard.press('Escape'); await sleep(400); };
    const lastEsc = () => d.evaluate(() => (window.__wuxLog || []).slice(-1)[0] || '');
    await d.waitForFunction(() => window.WosModels?.ready, null, { timeout: 15000 }).catch(() => {});
    await dOpen('qa_pw_ready');
    const chip = await d.evaluate(() => document.querySelector('.pane-main [data-chmodel]')?.textContent.trim() || null);
    ok(chip && /^Opus/.test(chip), '#11 desktop: the thread header shows the model chip', chip);
    await d.click('.pane-main [data-chmodel]'); await sleep(400);
    ok(await d.evaluate(() => document.querySelectorAll('.ch-psheet [data-mpick]').length >= 2), '#11 desktop: the chip opens the model picker');
    await sleep(350);
    await d.screenshot({ path: `${OUT}/desktop-01-model-picker.png` });
    const pick = await d.evaluate(() => { const rows = [...document.querySelectorAll('.ch-psheet [data-mpick]')]; const i = rows.findIndex(x => !x.classList.contains('on')); const o = WosModels.visible('claude-opus-5-5', 'anthropic')[+rows[i].dataset.mpick]; return { i, value: o.value }; });
    let n0 = writes.length;
    await d.click(`.ch-psheet [data-mpick="${pick.i}"]`);
    const mw = await until(() => writes.slice(n0).find(w => w.p === '/wizard/hermes/api/sessions/qa_pw_ready/model'));
    ok(mw && JSON.parse(mw.body).model === pick.value, '#11 desktop: picking sends POST /api/sessions/:id/model with the chosen id (intercepted)', { pick, body: mw?.body });
    await d.click('.pane-main [data-chmodel]'); await sleep(300);
    await esc();
    ok(!(await d.evaluate(() => !!document.querySelector('.ch-psheet'))) && (await dThread()) === 'qa_pw_ready', '#11 desktop: Esc closes the picker and keeps the thread', await lastEsc());

    await dOpen('qa_pw_work');
    await d.click('.pane-main details.wk summary'); await sleep(300);
    const dw = await d.evaluate(() => { const x = document.querySelector('.pane-main details.wk'); return x && { sum: x.querySelector('summary').textContent, steps: x.querySelectorAll('.wk-steps li').length, plan: x.querySelectorAll('.wk-plan li').length }; });
    ok(dw && /2 of 3 done/.test(dw.sum) && dw.steps === 3 && dw.plan === 3, '#17 desktop: the same work receipt (2 of 3 done, 3 steps, plan)', dw);
    await d.screenshot({ path: `${OUT}/desktop-02-work-receipt.png` });

    // Composer mic on desktop: pinned to the thread it was started in.
    await dOpen('qa_pw_ready');
    n0 = writes.length;
    await d.click('.pane-main .ch-compose [data-chmic]');
    await sleep(1600);
    ok(await d.evaluate(() => !!document.querySelector('.pane-main .ch-compose [data-chmic].on')), '#13 desktop: the composer mic records (fake mic)');
    await d.screenshot({ path: `${OUT}/desktop-03-composer-mic.png` });
    await dOpen('qa_pw_other');
    await d.evaluate(() => __wux.talk('send'));
    const dvr = await until(() => runsTo('', n0).find(r => r.input === 'QA voice reply words'), 15000);
    ok(dvr && dvr.session_id === 'qa_pw_ready', '#13 desktop: the voice reply lands in the thread it was started in', dvr);

    // Files on desktop
    await dOpen('qa_pw_ready');
    await d.evaluate(() => __wux.openFiles());
    await d.waitForFunction(() => document.querySelectorAll('.ch-psheet [data-fiattach]').length > 0, null, { timeout: 15000 }).catch(() => {});
    ok(await d.evaluate(() => document.querySelectorAll('.ch-psheet [data-fiid]').length > 0), '#23 desktop: Files opens with the real Wizard Files');
    await sleep(350);
    await d.screenshot({ path: `${OUT}/desktop-04-files.png` });
    await esc();
    ok(!(await d.evaluate(() => !!document.querySelector('.ch-psheet'))) && (await dThread()) === 'qa_pw_ready', '#23 desktop: Esc closes Files and keeps the thread');

    // AI usage on desktop
    await d.evaluate(() => __wux.openUsage());
    await d.waitForFunction(() => document.querySelectorAll('.usage-ov [data-usage] .us-row').length > 0, null, { timeout: 15000 }).catch(() => {});
    const un = await d.evaluate(() => document.querySelectorAll('.usage-ov [data-usage] .us-row').length);
    ok(un > 0, '#24 desktop: the AI usage card shows the quota bars', un);
    await d.screenshot({ path: `${OUT}/desktop-05-ai-usage.png` });
    await esc();
    ok(await d.evaluate(() => document.querySelector('.usage-ov').hidden) && (await lastEsc()) === 'esc:usage', '#24 desktop: Esc closes the AI usage card first');

    // Reading position on desktop
    await dOpen('qa_pw_long');
    await d.evaluate(() => { const nb = document.querySelector('.pane-main .ch-msgs'); nb.scrollTop = Math.round(nb.scrollHeight * 0.4); nb.dispatchEvent(new Event('scroll')); });
    await sleep(600);
    ok(await d.evaluate(() => { const b = document.querySelector('.pane-main [data-chlatest]'); return !!b && !b.hidden; }), '#18 desktop: “↓ Latest” appears when scrolled up');
    await d.screenshot({ path: `${OUT}/desktop-06-latest.png` });
    // Failed thread on desktop
    await dOpen('qa_pw_fail3');
    await d.evaluate(() => { const f = document.querySelector('.pane-main .ch-fail'), nb = document.querySelector('.pane-main .ch-msgs'); if (f && nb) nb.scrollTop = nb.scrollHeight; });
    const df = await d.evaluate(() => [...(document.querySelector('.pane-main .ch-fail')?.querySelectorAll('button') || [])].map(b => b.textContent.trim()).join('|'));
    ok(df === 'Retry|Choose another model|Dismiss', '#11 desktop: a failed thread shows Retry / Choose another model / Dismiss', df);
    await d.screenshot({ path: `${OUT}/desktop-07-failed-thread.png` });
    n0 = writes.length;
    await d.click('.pane-main [data-chretry]');
    const dr = await until(() => runsTo('qa_pw_fail3', n0)[0]);
    ok(dr && dr.input === 'Rename the photos', '#11 desktop: Retry re-sends through the outbox (intercepted)', dr);
    await dctx.close();
  } catch (e) { ok(false, 'desktop section crashed', String(e).split('\n')[0]); }

  /* =============================== the fence held =============================== */
  const real = writes.filter(w => /\/v1\/runs\/(?!qa-run-)/.test(w.p));
  ok(real.length === 0, 'no write touched a real run (steer/stop/approval)', real);
  ok(continuedWrites.length === 0, 'every Wizard write was intercepted (none continued to Wizard)', continuedWrites);
  const runsN = writes.filter(w => /\/v1\/runs$/.test(w.p)).length;
  ok(runsN > 0, `the fence saw the sends it intercepted (${runsN} POST /v1/runs, all fulfilled locally)`);
  const refused1 = await refusedAt();
  if (refused0 != null) ok(refused1 === refused0, 'QA origin refused zero writes (nothing got past the browser fence)', { refused0, refused1 });
  ok(errs.length === 0, 'no page errors', errs.join(' | '));
  console.log(`\n${pass} passed, ${fail} failed · intercepted writes: ${writes.length}`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
