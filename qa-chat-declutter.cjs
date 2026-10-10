// QA for the chat declutter (feature/chat-declutter), phone + desktop:
//  1 Chats list: no Files icon (search + New chat only)
//  2 Defer · Done sit bottom-right under the final response; Close & file is gone
//  3 Thread header: no emoji badge, no subtext, title centred, model selector at the far right (thread + new chat)
//  4 Composer: no Files icon, paperclip kept
//  5 Mic until there is something to send: typing or an attachment swaps it for Send; recording turns the mic into Send
// Fixture threads merged into real Wizard reads; EVERY non-GET request is intercepted, nothing reaches Wizard.
// Usage: node tools/qa-origin.cjs 9475 <worktree>/web &  then  QA_WEB_DIR=<worktree> node qa-chat-declutter.cjs [url]
let chromium; try { ({ chromium } = require('playwright-core')); } catch (e) { ({ chromium } = require('/home/telos/node_modules/playwright')); }
const fs = require('fs'), path = require('path');
const URL_ = process.argv[2] || 'http://127.0.0.1:9475/wizard-os-home/';
const WEB = process.env.QA_WEB_DIR || '';
const OUT = process.env.QA_OUT || '/home/telos/.hermes/cache/scratch/wizard-audit/shots/chat-declutter';
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
      const w = { tag, m, p: u.pathname, body: /upload|transcribe/.test(u.pathname) ? `<${buf.length} bytes>` : buf.toString(), at: Date.now(), idem: q.headers()['idempotency-key'] || '', fname: q.headers()['x-wizard-filename'] || '' };
      writes.push(w);
      if (/\/(transcribe)$/.test(u.pathname)) return json(200, { text: 'QA voice reply words', ms: 5 });
      if (/\/route$/.test(u.pathname)) { routeCalls++; return json(200, { ms: 5, cmd: { route: 'agent', thread: 'qa_pw_other' } }); }
      if (/\/wizard\/files\/upload$/.test(u.pathname)) { if (failUpload) return json(403, { error: 'qa: upload refused' }); return json(201, { file: { id: 'drop_qavoice' + writes.length, filename: q.headers()['x-wizard-filename'] || 'voice.webm', mime: q.headers()['x-wizard-mime'] || 'audio/webm', bytes: buf.length } }); }
      if (/\/api\/sessions\/[^/]+\/model$/.test(u.pathname)) { await sleep(150); return json(200, { ok: true }); }
      if (/\/wizard\/attention\/[^/]+\/(retry|dismiss)$/.test(u.pathname)) { const id = decodeURIComponent(u.pathname.split('/')[3]); attention = attention.filter(a => a.id !== id); await sleep(150); return json(200, { ok: true }); }
      if (/\/wizard\/session-failure\/[^/]+\/dismiss$/.test(u.pathname)) { await sleep(150); return json(200, { ok: true }); }
      if (/\/api\/sessions$/.test(u.pathname)) return json(200, { session: { id: JSON.parse(w.body || '{}').id || 'qa-fake-session' } });
      if (/\/v1\/runs$/.test(u.pathname)) return json(202, { run_id: 'qa-fake-run-' + writes.length, status: 'queued' });
      if (u.pathname === '/wizard/thread-dispositions') { const b = JSON.parse(w.body || '{}'); return json(200, { record: { sessionId: b.sessionId, runtime: b.runtime, deferred: b.deferred, updatedAt: new Date().toISOString() } }); }
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
  const wid = () => p.evaluate(() => Object.values(__wos.wins).find(w => w.app === 'chats')?.id);
  const thread = () => p.evaluate(() => Object.values(__wos.wins).find(w => w.app === 'chats')?.thread ?? null);
  async function openThread(id) {
    await p.evaluate(id => __wos.openWizardThread(id), id);
    await p.waitForFunction(id => { const w = Object.values(__wos.wins).find(x => x.app === 'chats'); return w?.thread === id && document.querySelector(`[data-chats="${w.id}"] .ch-msgs .msg`); }, id, { timeout: 30000 }).catch(() => {});
    await sleep(500);
  }
  const S = async sel => `[data-chats="${await wid()}"] ${sel}`;
  const vis = sel => p.evaluate(sel => { const e = document.querySelector(sel); if (!e) return false; const r = e.getBoundingClientRect(); return getComputedStyle(e).display !== 'none' && r.width > 0 && r.height > 0; }, sel);
  const section = id => p.evaluate(id => { const g = __wos.live.workGroups(); return Object.keys(g).find(k => g[k].some(s => s.id === id)) || ''; }, id);

  await p.goto(URL_, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__wos?.live?.ok && window.__wos.live.session('qa_pw_ready'), null, { timeout: 90000 }).catch(() => {});
  ok(await p.evaluate(() => !!window.__wos?.live?.session('qa_pw_ready')), 'phone: thread list loaded (real + fixture threads)');
  await p.evaluate(() => __wos.goDesk(1)); await sleep(600);
  await p.waitForFunction(() => window.WosModels?.ready, null, { timeout: 15000 }).catch(() => {});

  /* 1. chat list: search + New chat only */
  try {
    const top = await p.evaluate(sel => { const t = document.querySelector(sel); return t && { files: !!t.querySelector('[data-chfiles]'), btns: [...t.querySelectorAll('button')].filter(x => !x.matches('.ch-sclear')).map(x => x.getAttribute('aria-label')) }; }, await S('.ch-top'));
    ok(top && !top.files && top.btns.join('|') === 'New chat', '1 list: the Files icon is gone, search + New chat remain', top);
    await p.screenshot({ path: `${OUT}/01-list.png` });
  } catch (e) { ok(false, 'list section crashed', String(e).split('\n')[0]); }

  /* 3. thread header: back · title (one line, centred) · model chip far right */
  try {
    await openThread('qa_pw_ready');
    const h = await p.evaluate(sel => {
      const hd = document.querySelector(sel), r = x => x.getBoundingClientRect();
      const t = hd.querySelector('.ti b'), m = hd.querySelector('[data-chmodel]'), kids = [...hd.children];
      return { emo: !!hd.querySelector('.emo'), small: !!hd.querySelector('small'), title: t?.textContent, tMid: Math.round((r(t).top + r(t).bottom) / 2), hMid: Math.round((r(hd).top + r(hd).bottom) / 2),
        chipLast: kids[kids.length - 1] === m, chipRight: Math.round(r(hd).right - r(m).right), chipMid: Math.round((r(m).top + r(m).bottom) / 2), chip: m?.textContent.trim(), acts: !!hd.querySelector('[data-chact]'), hH: Math.round(r(hd).height) };
    }, await S('.ch-head'));
    ok(!h.emo, '3 header: the star/emoji badge is gone', h);
    ok(!h.small && !/Updated/.test(await p.evaluate(sel => document.querySelector(sel).textContent, await S('.ch-head'))), '3 header: no subtext under the title (no "Updated…")', h);
    ok(Math.abs(h.tMid - h.hMid) <= 2 && Math.abs(h.chipMid - h.hMid) <= 2, '3 header: title and model chip are vertically centred', h);
    ok(h.chipLast && h.chipRight <= 16 && /^Opus/.test(h.chip || ''), '3 header: model selector sits at the far right', h);
    ok(!h.acts && h.hH <= 56, '3 header: no Done/Defer/File in the header; header stays slim', h);
    await p.click(await S('.ch-head [data-chmodel]')); await sleep(350);
    ok(await p.evaluate(() => document.querySelectorAll('.ch-psheet [data-mpick]').length >= 2), '3 header: the chip still opens the model picker');
    await p.keyboard.press('Escape'); await sleep(400);
    ok((await thread()) === 'qa_pw_ready' && !(await p.evaluate(() => !!document.querySelector('.ch-psheet'))), '3 header: Back closes the picker and stays in the thread');
    // new chat shares the same header shape
    await p.click(await S('[data-chback]')); await sleep(400);
    await p.click(await S('[data-chnew]')); await sleep(500);
    const nh = await p.evaluate(sel => { const hd = document.querySelector(sel); const kids = [...hd.children]; return { chipLast: kids[kids.length - 1]?.matches('[data-chmodel]'), small: !!hd.querySelector('small'), emo: !!hd.querySelector('.emo') }; }, await S('.ch-head'));
    ok(nh.chipLast && !nh.small && !nh.emo, '3 new chat: same minimal header with the model at the far right', nh);
    await p.screenshot({ path: `${OUT}/02-new-chat.png` });
    await p.click(await S('[data-chback]')); await sleep(400);
  } catch (e) { ok(false, 'header section crashed', String(e).split('\n')[0]); }

  /* 2. Defer · Done below the final response, bottom-right; File gone */
  try {
    await openThread('qa_pw_ready');
    await p.evaluate(sel => { const nb = document.querySelector(sel); nb.scrollTop = nb.scrollHeight; }, await S('.ch-msgs')); await sleep(200);
    const a = await p.evaluate(sel => {
      const nb = document.querySelector(sel), ta = nb.querySelector('.ch-tacts'); if (!ta) return null;
      const last = [...nb.querySelectorAll('.msg.a')].pop(), r = x => x.getBoundingClientRect();
      const btn = [...ta.querySelectorAll('[data-chact]')];
      return { order: btn.map(x => x.dataset.chact).join(','), below: r(ta).top >= r(last).bottom - 1, afterLast: last.compareDocumentPosition(ta) & Node.DOCUMENT_POSITION_FOLLOWING ? true : false,
        rightGap: Math.round(r(nb).right - r(btn[btn.length - 1]).right), doneRightOfDefer: r(btn[1]).left > r(btn[0]).right, labels: btn.map(x => x.textContent.trim()).join('|') };
    }, await S('.ch-msgs'));
    ok(a && a.order === 'defer,done' && a.labels === 'Defer|Done', '2 thread: Defer then Done, and no File action', a);
    ok(a && a.below && a.afterLast, '2 thread: the actions sit below the final response', a);
    ok(a && a.doneRightOfDefer && a.rightGap <= 24, '2 thread: Done is bottom-right, Defer to its left', a);
    await p.screenshot({ path: `${OUT}/03-thread-actions.png` });
    const n0 = writes.length;
    await p.locator(await S('.ch-tacts [data-chact="done"]')).tap(); await sleep(200);
    ok((await thread()) === null && (await section('qa_pw_ready')) === 'archive', '2 Done: back to the list, thread in Archive at once', await section('qa_pw_ready'));
    await sleep(600);
    const w = writes.slice(n0).find(x => /\/api\/sessions\/qa_pw_ready$/.test(x.p));
    ok(w && w.m === 'PATCH' && JSON.parse(w.body).archived === true, '2 Done: saves archived:true (intercepted)', w);
    await openThread('qa_pw_other');
    const n1 = writes.length;
    await p.locator(await S('.ch-tacts [data-chact="defer"]')).tap(); await sleep(200);
    ok((await thread()) === null && (await section('qa_pw_other')) === 'deferred', '2 Defer: back to the list, thread in Deferred');
    await sleep(500);
    ok(writes.slice(n1).some(x => x.p === '/wizard/thread-dispositions'), '2 Defer: saved through /wizard/thread-dispositions (intercepted)');
    // a deferred/archived thread offers Restore (+ Done) in the same place
    await openThread('qa_pw_other');
    const ra = await p.evaluate(sel => [...document.querySelectorAll(sel)].map(b => b.dataset.chact).join(','), await S('.ch-tacts [data-chact]'));
    ok(ra === 'restore,done', '2 deferred thread: Restore / Done under the reply', ra);
    await p.locator(await S('.ch-tacts [data-chact="restore"]')).tap(); await sleep(500);
    // a thread still working shows no actions
    await openThread('qa_pw_live');
    ok(!(await p.evaluate(sel => !!document.querySelector(sel), await S('.ch-tacts'))), '2 working thread: no Done/Defer while the agent is on it');
    await p.click(await S('[data-chback]')); await sleep(400);
  } catch (e) { ok(false, 'actions section crashed', String(e).split('\n')[0]); }

  /* 4 + 5. composer: paperclip, no Files; mic until there is something to send */
  try {
    await openThread('qa_pw_work');
    const C = await S('.ch-compose');
    ok(!(await p.evaluate(sel => !!document.querySelector(sel), `${C} [data-chfiles]`)) && await vis(`${C} [data-chattach]`), '4 composer: Files icon gone, paperclip kept');
    ok(await vis(`${C} [data-chmic]`) && !(await vis(`${C} .ch-send`)), '5 empty field: mic shows, no Send button');
    await p.screenshot({ path: `${OUT}/04-composer-empty.png` });
    await p.locator(`${C} textarea`).tap(); await p.keyboard.type('hello');
    await sleep(100);
    ok(await vis(`${C} .ch-send`) && !(await vis(`${C} [data-chmic]`)), '5 typing: the mic becomes Send');
    const sr = await p.evaluate(sel => { const s = document.querySelector(sel + ' .ch-send').getBoundingClientRect(), f = document.querySelector(sel).getBoundingClientRect(); return Math.round(f.right - s.right); }, C);
    ok(sr <= 16, '5 typing: Send takes the mic’s spot at the right', sr);
    await p.screenshot({ path: `${OUT}/05-composer-typing.png` });
    for (let k = 0; k < 5; k++) await p.keyboard.press('Backspace');
    await sleep(100);
    ok(await vis(`${C} [data-chmic]`) && !(await vis(`${C} .ch-send`)), '5 cleared: back to the mic');
    await p.keyboard.type('   '); await sleep(80);
    ok(!(await vis(`${C} .ch-send`)), '5 whitespace only: still the mic');
    await p.fill(`${C} textarea`, '');
    // an attachment alone is something to send
    const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.locator(`${C} [data-chattach]`).tap()]);
    await fc.setFiles([{ name: 'qa.txt', mimeType: 'text/plain', buffer: Buffer.from('qa') }]);
    await p.waitForFunction(sel => document.querySelectorAll(sel + ' .ch-tray .ch-att:not(.up)').length === 1, C, { timeout: 5000 }).catch(() => {});
    ok(await vis(`${C} [data-chmic]`) && !(await vis(`${C} .ch-send`)), '5 attachment only: the mic stays (a voice reply carries it)');
    await p.locator(`${C} [data-attrm]`).tap(); await sleep(200);
    ok(await vis(`${C} [data-chmic]`) && !(await vis(`${C} .ch-send`)), '5 attachment removed: back to the mic');
    // typed send works and resets to the mic
    const n0 = writes.length;
    await p.locator(`${C} textarea`).tap(); await p.keyboard.type('QA declutter typed send');
    await p.locator(`${C} .ch-send`).tap();
    const tr = await until(() => runsTo('qa_pw_work', n0).find(r => r.input === 'QA declutter typed send'), 10000);
    ok(!!tr, '5 Send delivers the typed message (intercepted)', tr);
    await sleep(400);
    // Send and go: the phone pops back to the list; reopening the thread shows the plain mic.
    ok(await p.evaluate(() => !Object.values(__wos.wins).find(x => x.app === 'chats')?.thread), '5 after sending: back on the chat list');
    await openThread('qa_pw_work');
    ok(await vis(`${await S('.ch-compose')} [data-chmic]`) && !(await vis(`${await S('.ch-compose')} .ch-send`)), '5 after sending: back to the mic');
    // recording: the mic itself turns into Send
    await openThread('qa_pw_work');
    const n1 = writes.length;
    await p.locator(await S('.ch-compose [data-chmic]')).tap();
    await until(() => p.evaluate(() => __wos.voice === 'listen'), 4000); await sleep(500);
    const rec = await p.evaluate(sel => { const m = document.querySelector(sel + ' [data-chmic]'), s = document.querySelector(sel + ' .ch-send'); const dv = e => !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0; return { on: m.classList.contains('on'), arrow: dv(m.querySelector('.snd')), micIc: dv(m.querySelector('.mc')), send: dv(s), label: m.getAttribute('aria-label') }; }, await S('.ch-compose'));
    ok(rec.on && rec.arrow && !rec.micIc && !rec.send && /Send/.test(rec.label), '5 recording: the mic button turns into Send (one button)', rec);
    await p.screenshot({ path: `${OUT}/06-composer-recording.png` });
    await sleep(900);
    await p.locator(await S('.ch-compose [data-chmic]')).tap();
    const vr = await until(() => runsTo('', n1).find(r => r.input === 'QA voice reply words'), 15000);
    ok(vr && vr.session_id === 'qa_pw_work', '5 tapping it sends the voice reply to this thread (intercepted)', vr);
    await until(() => p.evaluate(() => __wos.voice === 'idle'), 4000); await sleep(300);
    await openThread('qa_pw_work');
    ok(await vis(`${await S('.ch-compose')} [data-chmic]`) && !(await p.evaluate(sel => document.querySelector(sel)?.classList.contains('on'), await S('.ch-compose [data-chmic]'))), '5 after the voice send: plain mic again');
  } catch (e) { ok(false, 'composer section crashed', String(e).split('\n')[0]); }

  /* 6. multi-pick screenshots: one pick stages 3, they render as big thumbnails with no filename, and go in ONE message */
  try {
    await openThread('qa_pw_work');
    const C = await S('.ch-compose');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const names = [1, 2, 3].map(k => `Screenshot_20261010_06395${k}_Wizard OS.jpg`);
    const nPick = writes.length;
    const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.locator(`${C} [data-chattach]`).tap()]);
    ok(fc.isMultiple(), '6 the picker allows several files in one pick');
    await fc.setFiles(names.map(n => ({ name: n, mimeType: 'image/png', buffer: png })));
    await p.waitForFunction(sel => document.querySelectorAll(sel + ' .ch-tray .ch-att:not(.up)').length === 3, C, { timeout: 6000 }).catch(() => {});
    const tray = await p.evaluate(sel => { const t = document.querySelector(sel + ' .ch-tray'); const atts = [...(t?.querySelectorAll('.ch-att') || [])]; return { n: atts.length, imgs: atts.filter(a => a.classList.contains('ch-attimg') && a.querySelector('img')).length, text: (t?.innerText || '').replace(/×/g, '').trim(), w: Math.round(atts[0]?.getBoundingClientRect().width || 0), h: Math.round(atts[0]?.getBoundingClientRect().height || 0) }; }, C);
    ok(tray.n === 3 && tray.imgs === 3, '6 one pick of 3 screenshots stages all 3', tray);
    ok(!/Screenshot|\.jpg|KB/i.test(tray.text), '6 staged screenshots show no filename or size text', tray.text);
    ok(tray.w >= 80 && tray.h >= 80, '6 staged screenshots are big thumbnails (≥80px)', tray);
    await p.screenshot({ path: `${OUT}/07-multi-staged.png` });
    ok(await vis(`${C} [data-chmic]`) && !(await vis(`${C} .ch-send`)), '6 with only screenshots staged the mic stays');
    const n0 = writes.length;
    await p.locator(`${C} textarea`).tap(); await p.keyboard.type('QA three screenshots');
    await p.locator(`${C} .ch-send`).tap();
    // a new run, or a steer when the thread is still busy with the earlier fake run: either way ONE message
    const sends = () => writes.slice(n0).filter(w => w.m === 'POST' && (/\/v1\/runs$/.test(w.p) || /\/v1\/runs\/[^/]+\/steer$/.test(w.p))).map(w => { try { return JSON.parse(w.body); } catch (e) { return {}; } }).filter(r => (r.input || '').includes('QA three screenshots'));
    const run = await until(() => sends()[0], 10000);
    const ups = writes.slice(nPick).filter(w => /\/wizard\/files\/upload$/.test(w.p) && /Screenshot_2026101/.test(w.fname));
    const ids = run && (run.wizard_file_ids || run.file_ids || []);
    ok(!!run && Array.isArray(ids) && ids.length === 3, '6 all 3 go in one message (one run, 3 file ids)', { ids, keys: run && Object.keys(run) });
    ok(sends().length === 1, '6 exactly one message was sent', sends().length);
    ok(ups.length === 3, '6 each screenshot uploaded once', ups.length);
    await sleep(500);
    await openThread('qa_pw_work'); // send and go returned to the list
    const bub = await p.evaluate(() => { const b = [...document.querySelectorAll('[data-chats] .msg.u .bub')].filter(x => x.innerText.includes('QA three screenshots')).pop(); return b && { imgs: b.querySelectorAll('.mimg img').length, text: b.innerText }; });
    ok(bub && bub.imgs === 3, '6 the sent bubble shows the 3 screenshots as images', bub);
    ok(bub && !/Screenshot_|\.jpg/i.test(bub.text), '6 the sent bubble shows no filename text', bub && bub.text);
    await p.screenshot({ path: `${OUT}/08-multi-sent.png` });
  } catch (e) { ok(false, 'multi-pick section crashed', String(e).split('\n')[0]); }

  /* Back never exits */
  try {
    await openThread('qa_pw_work');
    const b1 = await p.evaluate(() => window.__wosNativeBack()); await sleep(400);
    ok(b1 === 'thread' && (await thread()) === null, 'Back: thread → list', b1);
    for (let k = 0; k < 4; k++) { await p.evaluate(() => window.__wosNativeBack()); await sleep(250); }
    ok(await p.evaluate(() => !!window.__wos) && !p.isClosed(), 'Back at Home never leaves the app');
  } catch (e) { ok(false, 'back section crashed', String(e).split('\n')[0]); }

  /* =============================== DESKTOP =============================== */
  try {
    const dctx = await b.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
    await fence(dctx, 'desktop');
    const d = await dctx.newPage(); d.setDefaultTimeout(8000);
    d.on('pageerror', e => errs.push('desktop: ' + e));
    await d.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); } catch (e) {} });
    await d.goto(new URL('desktop.html', URL_).href, { waitUntil: 'domcontentloaded' });
    await d.waitForFunction(() => window.__wux?.live?.ok && window.__wux.live.session('qa_pw_work'), null, { timeout: 90000 }).catch(() => {});
    await d.evaluate(() => __wux.openThread('qa_pw_work'));
    await d.waitForFunction(() => document.querySelector('.pane-main .ch-msgs .msg'), null, { timeout: 30000 }).catch(() => {}); await sleep(700);
    const dd = await d.evaluate(() => { const hd = document.querySelector('.pane-main .ch-head'), kids = [...hd.children]; return { chipLast: kids[kids.length - 1]?.matches('[data-chmodel]'), emo: !!hd.querySelector('.emo'), small: !!hd.querySelector('small'),
      acts: [...document.querySelectorAll('.pane-main .ch-tacts [data-chact]')].map(b => b.dataset.chact).join(','), files: !!document.querySelector('.pane-main [data-chfiles], .pane-list [data-chfiles]') }; });
    ok(dd.chipLast && !dd.emo && !dd.small && dd.acts === 'defer,done' && !dd.files, 'desktop: same header, Defer/Done under the reply, no Files buttons', dd);
    await d.screenshot({ path: `${OUT}/07-desktop.png` });
    await dctx.close();
  } catch (e) { ok(false, 'desktop section crashed', String(e).split('\n')[0]); }

  const real = writes.filter(w => /\/v1\/runs\/(?!qa-run-|qa-fake-run-)/.test(w.p));
  ok(real.length === 0, 'no write touched a real run', real);
  ok(continuedWrites.length === 0, 'every Wizard write was intercepted (none continued to Wizard)', continuedWrites);
  const refused1 = await refusedAt();
  if (refused0 != null) ok(refused1 === refused0, 'QA origin refused zero writes', { refused0, refused1 });
  ok(errs.length === 0, 'no page errors', errs.join(' | '));
  console.log(`\n${pass} passed, ${fail} failed · intercepted writes: ${writes.length}`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
