// QA: a finished reply never shows twice (James, 27 Oct 2026: "some of these threads ... it's duplicating the
// response"). A thread can still be marked Working after its answer is saved (a service check holds it open). Opening
// it then subscribes to the finished run, whose stream replays the narration and the answer. The stream bubble must
// retire because the transcript already has that answer, instead of sitting under it as a second copy forever.
// Usage: QA_WEB_DIR=<repo> node qa-stream-replay-no-duplicate.cjs. Self-contained: one synthetic thread, its messages,
// its run status and the run stream are fixtures; every request is answered in the browser, nothing reaches a Wizard.
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const ORIGIN = require('./tools/qa-paths.cjs').origin();
const URL_ = ORIGIN + '/wizard-os-home/';
const W = process.env.QA_WEB_DIR || __dirname;
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };

const NARRATION = 'Now the other two items, without asking.';
const ANSWER = "**I've reported this to the Supervisor, and the two open items are now scheduled.**\n\n**What I did:** The Supervisor has your words and a proposed lasting fix.\n\n- Getting the fix into every new install.\n- Finishing and testing the login apps.";

(async () => {
  const b = await chromium.launch({ executablePath: process.env.QA_CHROME || undefined });
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true, colorScheme: 'dark' });
  const SID = 'qa_stream_replay';
  const now = Date.now() / 1000;
  const session = () => ({ id: SID, source: 'wizard-mobile', title: 'Stream replay QA', status: 'running', archived: false, hidden: false, message_count: 4,
    started_at: now - 600, last_active: now - 90, latest_message: { role: 'assistant', content: ANSWER, timestamp: now - 90 }, last_user_message: { role: 'user', content: 'Report this to the supervisor.', timestamp: now - 120 } });
  const rows = () => [
    { id: 9001, session_id: SID, role: 'user', timestamp: now - 120, content: 'Report this to the supervisor.' },
    { id: 9002, session_id: SID, role: 'assistant', timestamp: now - 100, content: NARRATION, tool_calls: [{ id: 'c1', function: { name: 'supervisor_report' } }] },
    { id: 9003, session_id: SID, role: 'tool', timestamp: now - 99, tool_call_id: 'c1', content: '{"ok":true}' },
    { id: 9004, session_id: SID, role: 'assistant', timestamp: now - 90, content: ANSWER + '\n\n[WIZARD_STATUS_V1]{"state":"done","ask":"x"}[/WIZARD_STATUS_V1]' },
  ];
  await ctx.route('**/*', async r => {
    const q = r.request(), u = q.url();
    const m = u.match(/\/wizard-os-home\/((?:desktop\/|core\/)?[a-z-]+\.(?:js|css|html)|)(\?|$)/);
    if (new URL(u).origin !== ORIGIN) return r.abort();
    const json = o => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (m && q.method() === 'GET') {
      const f = m[1] || 'index.html', p = path.join(W, 'web', f);
      if (/^(data|summaries)\.js$/.test(f) || !fs.existsSync(p)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      return r.fulfill({ status: 200, contentType: f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : 'application/javascript', body: fs.readFileSync(p) });
    }
    const path_ = new URL(u).pathname;
    if (path_ === '/wizard/hermes/api/sessions' && q.method() === 'GET') return json({ object: 'list', data: new URL(u).searchParams.get('agent') ? [] : [session()], has_more: false });
    if (path_ === `/wizard/hermes/api/sessions/${SID}`) return json({ session: session() });
    if (SID && q.method() === 'GET' && u.includes(`/api/sessions/${SID}/messages`)) {
      const latest = /order=latest/.test(u), data = latest ? rows().reverse() : rows();
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ object: 'list', session_id: SID, data, has_more: false, total: data.length }) });
    }
    if (/\/v1\/runs\/qa-replay-run(\?|$)/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ run_id: 'qa-replay-run', session_id: SID, status: 'completed' }) });
    if (q.method() !== 'GET' && /\/wizard\//.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: '{"accepted":true}' });
    if (path_ === '/wizard/hermes/api/model/options') return json({ model: 'fixture-model', provider: 'fixture', providers: [{ slug: 'fixture', name: 'Synthetic fixture route', authenticated: true, is_current: true, models: ['fixture-model'] }] });
    if (path_ === '/wizard/thread-seen' || path_ === '/wizard/thread-dispositions') return json({ state: { initializedAt: Date.now(), threads: {} } });
    return json({});
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  // The finished run's stream: replays narration + answer, then completes (what Hermes sends for a done run).
  await p.addInitScript(([narr, ans]) => {
    try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); localStorage.setItem('wos.tour.v1', 'true'); } catch (e) {}
    const Native = window.EventSource;
    window.EventSource = function (url, opts) {
      if (!/qa-replay-run/.test(url)) return new Native(url, opts);
      const es = { url, readyState: 1, close() { this.readyState = 2; }, addEventListener() {}, onmessage: null, onopen: null, onerror: null };
      const send = d => es.onmessage && es.onmessage({ data: JSON.stringify(d), type: 'message' });
      setTimeout(() => { es.onopen && es.onopen(); send({ event: 'message.delta', delta: narr }); send({ event: 'message.delta', delta: '\n\n' + ans + '\n\n[WIZARD_STATUS_V1]{"state":"done"}[/WIZARD_STATUS_V1]' }); send({ event: 'run.completed' }); }, 150);
      return es;
    };
  }, [NARRATION, ANSWER]);
  await p.goto(URL_, { waitUntil: 'load' });
  await p.waitForFunction(sid => window.__wos?.live?.ok && window.__wos.live.session(sid), SID, { timeout: 30000 });
  await p.evaluate(() => __wos.goDesk(1)); await p.waitForTimeout(500);
  const wid = await p.evaluate(() => __wos.desks[1].wins.find(id => __wos.wins[id].app === 'chats'));
  // The service still lists the thread as Working on that finished run.
  const hold = () => p.evaluate(x => { const s = __wos.live.session(x); if (s) Object.assign(s, { status: 'running', runId: 'qa-replay-run' }); }, SID);
  await hold();
  await p.evaluate(([w, x]) => __wos.openChat(w, x), [wid, SID]);
  const count = () => p.evaluate(w => {
    const root = document.querySelector(`[data-chats="${w}"]`);
    const bubbles = [...root.querySelectorAll('.msg.a .bub')].map(b => b.innerText);
    return { copies: bubbles.filter(t => t.includes('reported this to the Supervisor')).length, streaming: root.querySelectorAll('[data-streaming]').length };
  }, wid);
  let seen = { copies: 0, streaming: 0 }, maxCopies = 0;
  for (let i = 0; i < 30; i++) { await hold(); await p.waitForTimeout(200); seen = await count(); maxCopies = Math.max(maxCopies, seen.copies); }
  ok(seen.copies === 1, 'the finished answer shows once', JSON.stringify(seen));
  ok(seen.streaming === 0, 'no leftover streaming bubble under the saved answer', JSON.stringify(seen));
  ok(maxCopies <= 1, 'it never showed twice while the thread opened', String(maxCopies));
  ok(errs.length === 0, 'no page errors', errs.join(' | '));
  await ctx.close(); await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
