// QA: a failed thread's Retry and "Choose another model" stay usable when the failed turn has no typed request
// (a coordinator's follow-through note started it), including after the model is changed from the composer chip.
// Bug James hit 18 Oct 2026 on "Wizard OS · Daily agent runtime": he switched to Astra, Retry stayed grey, he typed "Retry".
// Every write is intercepted (same fence as qa-chat-power.cjs); nothing reaches Wizard.
// Usage: node tools/qa-origin.cjs 9475 <worktree>/web &  then  QA_WEB_DIR=<worktree> node qa-retry-note.cjs [url]
// Negative control: run it against a checkout without the fix; the note cases must FAIL.
const { chromium } = require('/home/telos/node_modules/playwright');
const fs = require('fs'), path = require('path');
const URL_ = process.argv[2] || 'http://127.0.0.1:9475/wizard-os-home/';
const WEB = process.env.QA_WEB_DIR || '';
const OUT = process.env.QA_OUT || '/home/telos/.hermes/cache/scratch/wizard-audit/shots/retry-note';
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
const NOTE = '[Wizard follow-through] Builder kickoff from the "QA coordinator" thread, on the owner\'s behalf. Build lane C.';
const FIX = {
  qa_pw_ready: { title: 'QA retry ready', status: 'completed', t: now - 50, rows: () => [row('user', 'Ready question', now - 300), row('assistant', 'Ready answer.', now - 250)] },
  // A failed thread the owner typed: Retry re-sends his words (unchanged behaviour).
  qa_pw_fail: { title: 'QA retry typed', status: 'failed', model: 'claude-opus-5-5', provider: 'anthropic', t: now - 40, rows: () => [row('user', 'Summarise the quarterly numbers', now - 120)] },
  // A failed run a coordinator's follow-through note started: no words from the owner (Daily agent runtime, 18 Oct 2026).
  qa_pw_fail_note: { title: 'QA retry note', status: 'failed', model: 'claude-opus-5-5', provider: 'anthropic', t: now - 49, rows: () => [
    row('user', NOTE, now - 260),
    row('assistant', '', now - 255, { tool_calls: [call('n1', 'Read the brief')] }),
    row('tool', '{"ok":true}', now - 250, { tool_call_id: 'n1' }),
  ] },
  // A failed note-started run that came after an earlier typed request: Retry must not resend the older words.
  qa_pw_fail_note2: { title: 'QA retry note after typed', status: 'failed', model: 'claude-opus-5-5', provider: 'anthropic', t: now - 52, rows: () => [
    row('user', 'Old typed request', now - 900), row('assistant', 'Old answer.', now - 880),
    row('user', NOTE, now - 260),
  ] },
};
function fixSession(id) {
  // Like the Agent Service (service.mjs latestVisibleSessionMessages): follow-through notes are not the owner's last message.
  const f = FIX[id], rows = f.rows(), last = rows[rows.length - 1], lastU = [...rows].reverse().find(r => r.role === 'user' && !String(r.content).startsWith('[Wizard follow-through]'));
  return { id, source: 'wizard-mobile', title: f.title, status: f.status, archived: false, hidden: false, message_count: rows.length, model: f.model || undefined, provider: f.provider || undefined,
    started_at: f.t - 600, last_active: f.t, wizard_last_user_at: lastU ? lastU.timestamp : f.t - 300, wizard_last_assistant_at: f.t, wizard_activity_at: f.t, wizard_run_id: f.run || '',
    latest_message: { role: last.role, content: String(last.content || '').slice(0, 200), timestamp: last.timestamp },
    ...(lastU ? { last_user_message: { role: 'user', content: String(lastU.content).slice(0, 200), timestamp: lastU.timestamp } } : {}) };
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
      if (/\/api\/sessions\/[^/]+\/model$/.test(u.pathname)) { await sleep(150); const data = JSON.parse(w.body); return json(200, { runtime: { model: data.model, provider: data.provider, model_lock: 'accepted' } }); }
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


(async () => {
  const b = await chromium.launch({ executablePath: fs.existsSync(EXEC) ? EXEC : undefined });
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true });
  await fence(ctx, 'phone');
  const p = await ctx.newPage(); p.setDefaultTimeout(15000);
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); } catch (e) {} });
  const win = () => p.evaluate(() => { const w = Object.values(__wos.wins).find(x => x.app === 'chats' && !x.agent); return w ? { id: w.id, thread: w.thread } : null; });
  const S = async sel => `[data-chats="${(await win()).id}"] ${sel}`;
  async function openThread(id) {
    await p.evaluate(id => __wos.openWizardThread(id), id);
    await p.waitForFunction(id => { const w = Object.values(__wos.wins).find(x => x.app === 'chats' && !x.agent); return w?.thread === id && document.querySelector(`[data-chats="${w.id}"] .ch-fail`); }, id, { timeout: 20000 }).catch(() => {});
    await sleep(400);
  }
  const panel = async () => p.evaluate(sel => { const f = document.querySelector(sel); return f && [...f.querySelectorAll('button')].map(b => `${b.textContent.trim()}:${b.disabled ? 'off' : 'on'}`).join('|'); }, await S('.ch-fail'));
  const tap = async sel => p.evaluate(sel => { const el = document.querySelector(sel); if (!el) return false; el.click(); return true; }, sel);

  await p.goto(URL_, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__wos?.live?.ok && window.__wos.live.session('qa_pw_fail_note'), null, { timeout: 90000 }).catch(() => {});
  ok(await p.evaluate(() => !!window.__wos?.live?.session('qa_pw_fail_note')), 'phone: thread list loaded with the fixtures');
  await p.waitForFunction(() => window.WosModels, null, { timeout: 15000 }).catch(() => {});
  await p.evaluate(async () => { await WosModels.load(); });

  // 1. Typed request: unchanged.
  await openThread('qa_pw_fail');
  ok(await panel() === 'Retry:on|Choose another model:on|Dismiss:on', 'typed failed thread: all three buttons enabled', await panel());
  let n0 = writes.length;
  await tap(await S('.ch-fail [data-chretry]'));
  let r = await until(() => runsTo('qa_pw_fail', n0)[0]);
  ok(r && r.input === 'Summarise the quarterly numbers', 'typed failed thread: Retry re-sends the typed words', r && r.input);

  // 2. Note-started: buttons live on open.
  await openThread('qa_pw_fail_note');
  ok(await panel() === 'Retry:on|Choose another model:on|Dismiss:on', 'note-started failed thread: Retry and Choose another model enabled', await panel());
  await p.screenshot({ path: `${OUT}/note-failed-panel.png` });

  // 3. Change the model from the composer chip (James's path), then Retry.
  await tap(await S('[data-chmodel]')); await sleep(400);
  const pick = await p.evaluate(() => { const rows = [...document.querySelectorAll('.ch-psheet [data-mpick]')]; const s = __wos.live.session('qa_pw_fail_note'); const list = WosModels.visible(s.model || '', s.provider || ''); const i = rows.findIndex(x => !x.classList.contains('on') && !x.dataset.mprivate); if (i < 0) return null; const o = list[+rows[i].dataset.mpick]; return { i, value: o.value, provider: o.provider, name: o.name }; });
  ok(!!pick, 'model picker lists another model', pick);
  n0 = writes.length;
  await tap(`.ch-psheet [data-mpick="${pick.i}"]`);
  const mw = await until(() => writes.slice(n0).find(w => w.p === '/wizard/hermes/api/sessions/qa_pw_fail_note/model'));
  await sleep(500);
  ok(!!mw, 'model change posted (intercepted)', mw && mw.body);
  ok(await panel() === 'Retry:on|Choose another model:on|Dismiss:on', 'after the model change, Retry is enabled', await panel());
  await p.screenshot({ path: `${OUT}/note-after-model-change.png` });
  await tap(await S('.ch-fail [data-chretry]'));
  r = await until(() => runsTo('qa_pw_fail_note', n0)[0]);
  ok(r && r.input === 'Retry' && r.model === pick.value, 'Retry sends "Retry" on the newly picked model', r && { input: r.input, model: r.model, want: pick.value });
  ok(r && /follow-through note/.test(r.instructions || ''), 'Retry tells the agent to carry out the last request again', r && (r.instructions || '').slice(0, 200));

  // 4. Note after an older typed request: never resend the stale words.
  await openThread('qa_pw_fail_note2');
  n0 = writes.length;
  await tap(await S('.ch-fail [data-chretry]'));
  r = await until(() => runsTo('qa_pw_fail_note2', n0)[0]);
  ok(r && r.input === 'Retry', 'note after older typed request: Retry does not resend the old words', r && r.input);

  ok(!errs.length, 'no page errors', errs.slice(0, 3));
  ok(continuedWrites.length === 0, 'fence: every write was intercepted', continuedWrites.slice(0, 3));
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed · intercepted writes: ${writes.length}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL crashed', String(e).split('\n')[0]); process.exit(1); });
