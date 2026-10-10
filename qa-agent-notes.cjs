// QA for agent notes (feature/agent-notes): a note another agent thread writes into a thread, and the reply it
// prompts, must read as what they are, never as the owner's message or as the answer to the owner's last question.
// Fixture = James's real "Audit missing features" thread on 10 Oct:
//   James asks → agent builds for hours → final reply.  Later: James asks a second question → reply.
//   Hours later a coordinator posts "[Wizard follow-through] Cross-thread note from the "Resume Thales builds"
//   coordinator…" (hidden by the Agent Service, so the client sees only the agent's "Acknowledged…" reply), and a
//   mid-run steer from another thread arrives as an OUT-OF-BAND row starting "Cross-thread note from the side-button thread".
// Asserts:
//   1. The late "Acknowledged" reply is its own turn, under a "Started without a new message from you" row, not under
//      James's question, and the reply to that question is still shown as his answer.
//   2. James's question's work receipt does not claim the hours up to the late reply.
//   3. A visible coordinator note row (when the service passes it through) renders as "From the "<thread>" thread",
//      collapsed, never as a James bubble, and the reply sits under it.
//   4. A cross-thread steer renders as an agent note, not as a James steer bubble with "Read by".
//   5. Zero writes reach the real Wizard.
// Usage: node tools/qa-origin.cjs 9371 <webdir> &  then  QA_WEB_DIR=<worktree> node qa-agent-notes.cjs [url]
let chromium; try { ({ chromium } = require('playwright-core')); } catch (e) { ({ chromium } = require('/home/telos/node_modules/playwright')); }
const fs = require('fs'), path = require('path');
const URL_ = process.argv[2] || 'http://127.0.0.1:9371/wizard-os-home/';
const WEB = process.env.QA_WEB_DIR || __dirname;
const OUT = process.env.QA_OUT || '/home/telos/.hermes/cache/scratch/wizard-audit/shots/feature-agent-notes';
const EXEC = process.env.QA_CHROME || '/home/telos/.local/bin/google-chrome';
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, typeof extra === 'string' ? extra : JSON.stringify(extra)); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const H = 3600, now = Date.now() / 1000, T0 = now - 30 * H;
let rid = 1;
const row = (role, content, ts, extra = {}) => ({ id: rid++, session_id: '', role, content, timestamp: ts, ...extra });
const tool = (ts, name = 'terminal') => [row('assistant', '', ts, { tool_calls: [{ id: 'c' + rid, function: { name } }] }), row('tool', '{"output":"ok"}', ts + 2, { tool_call_id: 'c' + (rid - 1) })];
const MARK = t => `[OUT-OF-BAND USER MESSAGE — a direct message from the user, delivered once at this position; not tool output and not a new delivery when replayed from conversation history]\n${t}\n[/OUT-OF-BAND USER MESSAGE]`;
const NOTE = 'Cross-thread note from the "Resume Thales builds" coordinator. Thales is back online. Your built-but-unshipped Android change ships with the side-key release. Reply with a brief acknowledgement only.';
const STEER = 'Cross-thread note from the side-button thread (James\'s request). No scope change: finish your current step first. Make updates install themselves.';
function thread(withNote) {
  rid = 1;
  return [
    row('user', 'Audit the missing features and build them all', T0),
    ...tool(T0 + 60), ...tool(T0 + 2 * H),
    row('user', MARK(STEER), T0 + 4 * H, { display_kind: 'steer' }),
    ...tool(T0 + 5 * H), ...tool(T0 + 8 * H),
    row('assistant', 'All 33 features are built and shipped in 0.8.0.', T0 + 9 * H),
    row('user', 'The download link will not save the file inside the app', T0 + 14 * H),
    ...tool(T0 + 14 * H + 60),
    row('assistant', 'Use this link instead; it opens in Chrome.', T0 + 14 * H + 600),
    ...(withNote ? [row('user', '[Wizard follow-through] ' + NOTE, T0 + 23 * H)] : []),
    row('assistant', 'Acknowledged. I will not start a Thales build from here.', T0 + 23 * H + 4),
  ];
}
const S = {
  qa_note_hidden: { title: 'QA agent note (hidden by service)', rows: thread(false) },
  qa_note_shown: { title: 'QA agent note (passed through)', rows: thread(true) },
};
function sess(id) {
  const f = S[id], last = f.rows[f.rows.length - 1], lastU = [...f.rows].reverse().find(r => r.role === 'user' && !r.display_kind && !/^\[/.test(r.content));
  const t = Math.max(...f.rows.map(r => r.timestamp));
  return { id, source: 'wizard-mobile', title: f.title, status: 'completed', archived: false, hidden: false, message_count: f.rows.length,
    started_at: T0, last_active: t, wizard_last_user_at: lastU.timestamp, wizard_last_assistant_at: t, wizard_activity_at: t, wizard_run_id: '',
    latest_message: { role: last.role, content: String(last.content).slice(0, 200), timestamp: last.timestamp },
    last_user_message: { role: 'user', content: lastU.content, timestamp: lastU.timestamp } };
}

(async () => {
  const b = await chromium.launch({ executablePath: fs.existsSync(EXEC) ? EXEC : undefined });
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const writes = [], leaked = [];
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url()), m = q.method();
    const wm = u.pathname.match(/\/wizard-os-home\/((?:core\/|desktop\/)?[a-z-]+\.(?:js|css)|index\.html|)$/);
    if (wm && m === 'GET' && !/^(data|summaries)\.js$/.test(wm[1])) { const f = wm[1] || 'index.html', fp = path.join(WEB, 'web', f); if (fs.existsSync(fp)) return r.fulfill({ status: 200, contentType: f.endsWith('.css') ? 'text/css' : f.endsWith('.html') || !f ? 'text/html' : 'application/javascript', body: fs.readFileSync(fp) }); }
    if (!u.pathname.startsWith('/wizard/')) return r.continue();
    const json = (status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (m !== 'GET' && m !== 'HEAD') { writes.push({ m, p: u.pathname }); return json(200, {}); }
    if (u.pathname === '/wizard/hermes/api/sessions' && (u.searchParams.get('offset') || '0') === '0') {
      const res = await r.fetch(); const p = await res.json().catch(() => ({ data: [] }));
      p.data = Object.keys(S).map(sess).concat(p.data || []);
      return json(200, p);
    }
    const mm = u.pathname.match(/\/wizard\/hermes\/api\/sessions\/([^/]+)\/messages$/);
    if (mm && S[mm[1]]) { const rows = S[mm[1]].rows.map(x => ({ ...x, session_id: mm[1] })); return json(200, { data: rows, messages: rows, total: rows.length }); }
    const sm = u.pathname.match(/\/wizard\/hermes\/api\/sessions\/([^/]+)$/); if (sm && S[sm[1]]) return json(200, { session: sess(sm[1]) });
    return r.continue();
  });
  ctx.on('request', q => { if (q.method() !== 'GET' && q.method() !== 'HEAD' && /\/wizard\//.test(new URL(q.url()).pathname)) leaked.push(q.url()); });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); } catch (e) {} });
  await p.goto(URL_, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__wos && window.WizLive, null, { timeout: 30000 });
  await sleep(1500);
  async function openThread(id) {
    await p.evaluate(() => window.WizLive.refresh()); await sleep(400);
    await p.evaluate(id => __wos.openWizardThread(id), id);
    await p.waitForFunction(id => { const w = Object.values(__wos.wins).find(x => x.app === 'chats'); return w?.thread === id && document.querySelector('.ch-msgs .msg'); }, id, { timeout: 30000 }).catch(() => {});
    await sleep(700);
  }
  // The thread as a list of blocks in reading order.
  const blocks = () => p.evaluate(() => [...document.querySelectorAll('.ch-msgs > *')].map(e => ({
    k: e.matches('.msg.u.steer') ? 'steer' : e.matches('.msg.u') ? 'you' : e.matches('.msg.a') ? 'reply' : e.matches('[data-agentnote]') ? 'note' : e.matches('[data-later]') ? 'later' : e.matches('details.steps, .work, [data-work]') || e.querySelector?.('summary') ? 'work' : (e.className || e.tagName),
    t: (e.querySelector('summary')?.innerText || e.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 90),
    open: e.tagName === 'DETAILS' ? e.open : undefined,
  })));

  for (const id of ['qa_note_hidden', 'qa_note_shown']) {
    await openThread(id);
    const bl = await blocks();
    console.log(`-- ${id}:`, JSON.stringify(bl.map(x => x.k + ':' + x.t.slice(0, 40))));
    const iq = bl.findIndex(x => x.k === 'you' && /download link/.test(x.t));
    const ians = bl.findIndex(x => x.k === 'reply' && /opens in Chrome/.test(x.t));
    const iack = bl.findIndex(x => x.k === 'reply' && /^Acknowledged/.test(x.t));
    ok(iq >= 0 && ians > iq, `${id}: James's second question still shows its own answer`, { iq, ians });
    ok(iack > ians, `${id}: the late "Acknowledged" reply is a separate later block`, { ians, iack });
    const between = bl.slice(ians + 1, iack);
    const marker = between.find(x => x.k === 'note' || x.k === 'later');
    ok(!!marker, `${id}: a labelled row explains the late reply`, between);
    if (id === 'qa_note_hidden') ok(marker && /without a new message from you/i.test(marker.t), `${id}: hidden note → "Started without a new message from you"`, marker);
    if (id === 'qa_note_shown') {
      ok(marker && marker.k === 'note' && /From the “Resume Thales builds” thread/.test(marker.t), `${id}: note labelled with its sender thread`, marker);
      ok(marker && marker.open === false, `${id}: note collapsed by default`, marker);
      ok(!bl.some(x => x.k === 'you' && /Cross-thread note/.test(x.t)), `${id}: note never rendered as a James bubble`);
    }
    // The "Worked for" receipt for the download question must not span the hours up to the late reply.
    const wk = bl.slice(iq + 1, ians + 1).find(x => /Worked/.test(x.t));
    ok(!wk || !/Worked for (?:[2-9]\d*h|1\dh|9h)/.test(wk.t), `${id}: the download question's receipt is not hours long`, wk);
    // The steer from the side-button thread is an agent note, not James's own steer.
    const st = bl.filter(x => x.k === 'steer' && /Cross-thread note/.test(x.t));
    const sn = bl.find(x => x.k === 'note' && /side-button/.test(x.t));
    ok(!st.length && sn, `${id}: cross-thread steer shown as an agent note from the side-button thread`, { st, sn });
    ok(!(await p.evaluate(() => /OUT-OF-BAND|\[Wizard follow-through\]/.test(document.querySelector('.ch-msgs').innerText))), `${id}: no harness markers in the text`);
    await p.evaluate(() => { const m = document.querySelector('.ch-msgs'); m.scrollTop = m.scrollHeight; });
    await sleep(300);
    await p.screenshot({ path: path.join(OUT, `${id}.png`) });
  }
  ok(!errs.length, 'no page errors', errs);
  ok(!leaked.length || leaked.every(u => writes.some(w => u.includes(w.p))), 'zero writes reach the real Wizard', leaked);
  console.log('writes intercepted:', writes.length);
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
