// QA for steer receipts (feature/steer-receipt): a message sent while Archimedes is working is visibly
// acknowledged at each stage.
//   1. While it is in flight the bubble says "Steering…", then "Delivered · Archimedes reads it after the
//      current step" once Wizard accepts the steer.
//   2. When Hermes takes it in (a display_kind:'steer' row lands in the transcript) the pending bubble is
//      replaced by a steer bubble inside the turn with a "Read by Archimedes" receipt — the marker text never shows.
//   3. A steer to a still-queued run says "Added to the queued request".
//   4. A steer the run finished before reading is replayed as an ordinary message (never silently dropped).
//   5. Zero writes reach the real Wizard.
// Usage: node tools/qa-origin.cjs 9371 &  then  QA_WEB_DIR=<worktree> node qa-steer-receipt.cjs [url]
const { chromium } = require('/home/telos/node_modules/playwright');
const fs = require('fs'), path = require('path');
const URL_ = process.argv[2] || 'http://127.0.0.1:9371/wizard-os-home/';
const WEB = process.env.QA_WEB_DIR || __dirname;
const OUT = process.env.QA_OUT || '/home/telos/.hermes/cache/scratch/wizard-audit/shots/feature-steer-receipt';
const EXEC = process.env.QA_CHROME || '/home/telos/.local/bin/google-chrome';
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, typeof extra === 'string' ? extra : JSON.stringify(extra)); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const now = Date.now() / 1000;
let rid = 1;
const row = (role, content, ts, extra = {}) => ({ id: rid++, session_id: '', role, content, timestamp: ts, ...extra });
const MARK = t => `[OUT-OF-BAND USER MESSAGE — a direct message from the user, delivered once at this position; not tool output and not a new delivery when replayed from conversation history]\n${t}\n[/OUT-OF-BAND USER MESSAGE]`;
// Mutable fixtures: the test flips state as Hermes would.
const S = {
  qa_steer_live: { title: 'QA steer live', status: 'running', run: 'qa-run-steer', rows: [row('user', 'Fix the reader top bar', now - 120), row('assistant', '', now - 110, { tool_calls: [{ id: 'c1', function: { name: 'terminal' } }] }), row('tool', 'ok', now - 100, { tool_call_id: 'c1' })] },
  qa_steer_queued: { title: 'QA steer queued', status: 'queued', run: 'qa-run-queued', rows: [row('user', 'Queued job please', now - 60)] },
  qa_steer_late: { title: 'QA steer late', status: 'running', run: 'qa-run-late', rows: [row('user', 'Quick job', now - 90)] },
};
function sess(id) {
  const f = S[id], last = f.rows[f.rows.length - 1], lastU = [...f.rows].reverse().find(r => r.role === 'user' && !r.display_kind);
  const t = Math.max(...f.rows.map(r => r.timestamp));
  return { id, source: 'wizard-mobile', title: f.title, status: f.status, archived: false, hidden: false, message_count: f.rows.length,
    started_at: now - 600, last_active: t, wizard_last_user_at: lastU.timestamp, wizard_last_assistant_at: t, wizard_activity_at: t,
    wizard_run_id: ['running', 'queued'].includes(f.status) ? f.run : '',
    latest_message: { role: last.role, content: String(typeof last.content === 'string' ? last.content : '').slice(0, 200), timestamp: last.timestamp },
    last_user_message: { role: 'user', content: lastU.content, timestamp: lastU.timestamp } };
}

(async () => {
  const b = await chromium.launch({ executablePath: fs.existsSync(EXEC) ? EXEC : undefined });
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const writes = [], leaked = [];
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url()), m = q.method();
    const wm = u.pathname.match(/\/wizard-os-home\/((?:core\/|desktop\/)?[a-z-]+\.(?:js|css)|index\.html|)$/);
    if (wm && m === 'GET' && !/^(data|summaries)\.js$/.test(wm[1])) { const f = wm[1] || 'index.html', fp = path.join(WEB, 'web', f); if (fs.existsSync(fp)) return r.fulfill({ status: 200, contentType: f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : 'application/javascript', body: fs.readFileSync(fp) }); }
    if (!u.pathname.startsWith('/wizard/')) return r.continue();
    const json = (status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (m !== 'GET' && m !== 'HEAD') {
      const body = q.postData() || '';
      writes.push({ m, p: u.pathname, body });
      const st = u.pathname.match(/\/wizard\/hermes\/v1\/runs\/([^/]+)\/steer$/);
      if (st) {
        await sleep(700); // long enough to see "Steering…"
        if (st[1] === 'qa-run-queued') return json(202, { accepted: true, run_id: st[1], status: 'queued', queue_position: 1 });
        return json(200, { object: 'hermes.run.steer', run_id: st[1], accepted: true });
      }
      if (/\/v1\/runs$/.test(u.pathname)) return json(202, { run_id: 'qa-fake-run', status: 'queued' });
      return json(200, {});
    }
    if (u.pathname === '/wizard/hermes/api/sessions' && (u.searchParams.get('offset') || '0') === '0') {
      const res = await r.fetch(); const p = await res.json().catch(() => ({ data: [] }));
      p.data = Object.keys(S).map(sess).concat(p.data || []);
      return json(200, p);
    }
    const mm = u.pathname.match(/\/wizard\/hermes\/api\/sessions\/([^/]+)\/messages$/);
    if (mm && S[mm[1]]) { const rows = S[mm[1]].rows.map(x => ({ ...x, session_id: mm[1] })); return json(200, { data: rows, messages: rows, total: rows.length }); }
    const sm = u.pathname.match(/\/wizard\/hermes\/api\/sessions\/([^/]+)$/); if (sm && S[sm[1]]) return json(200, { session: sess(sm[1]) });
    const rm = u.pathname.match(/\/wizard\/hermes\/v1\/runs\/(qa-[^/]+)$/);
    if (rm) { const id = Object.keys(S).find(k => S[k].run === rm[1]); return json(200, { run_id: rm[1], status: id ? S[id].status : 'completed', session_id: id || '' }); }
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
  const refresh = () => p.evaluate(() => window.WizLive.refresh());
  async function openThread(id) {
    await refresh(); await sleep(400);
    await p.evaluate(id => __wos.openWizardThread(id), id);
    await p.waitForFunction(id => { const w = Object.values(__wos.wins).find(x => x.app === 'chats'); return w?.thread === id && document.querySelector('.ch-msgs .msg'); }, id, { timeout: 30000 }).catch(() => {});
    await sleep(500);
  }
  async function send(text) {
    await p.fill('.ch-compose textarea', text);
    await p.click('.ch-compose button[type=submit]');
  }
  const pendText = () => p.evaluate(() => [...document.querySelectorAll('.msg.u.pending .pst')].map(e => e.textContent.trim()).join(' | '));
  const waitFor = async (fn, ms = 25000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(300); } return false; };

  /* 1–2: live run */
  await openThread('qa_steer_live');
  ok(await p.evaluate(() => document.querySelector('.ch-compose textarea')?.placeholder.startsWith('Steer')), 'a working thread composes a steer');
  await send('Actually add a Kindle-style highlight');
  ok(await waitFor(async () => /Steering…/.test(await pendText()), 3000), 'in flight: "Steering…"', await pendText());
  ok(await waitFor(async () => /Delivered · .+ sees it next step/.test(await pendText()), 8000), 'accepted: "Delivered · … sees it next step"', await pendText());
  const sw = writes.find(w => /qa-run-steer\/steer$/.test(w.p));
  ok(sw && JSON.parse(sw.body).input === 'Actually add a Kindle-style highlight', 'posted to /v1/runs/:id/steer with the text', sw);
  await p.screenshot({ path: path.join(OUT, '1-delivered.png') });
  // Hermes drains the steer after the tool batch → a display_kind:'steer' row.
  S.qa_steer_live.rows.push(row('user', MARK('Actually add a Kindle-style highlight'), now + 5, { display_kind: 'steer' }));
  S.qa_steer_live.rows.push(row('assistant', 'On it — adding highlights too.', now + 8));
  await refresh();
  ok(await waitFor(() => p.evaluate(() => !!document.querySelector('.msg.u.steer[data-steer]') && !document.querySelector('.msg.u.pending'))), 'taken in: pending bubble replaced by the steer in the turn');
  const rcpt = await p.evaluate(() => document.querySelector('.msg.u.steer[data-steer] .srcpt')?.textContent.trim() || '');
  ok(/^Read by /.test(rcpt), 'receipt reads "Read by …"', rcpt);
  const body = await p.evaluate(() => document.querySelector('.ch-msgs').innerText);
  ok(!/OUT-OF-BAND/.test(body), 'marker text never shows');
  ok((body.match(/Kindle-style highlight/g) || []).length === 1, 'steer shown exactly once', body.match(/Kindle-style highlight/g));
  const order = await p.evaluate(() => { const els = [...document.querySelectorAll('.ch-msgs .msg')]; const i = els.findIndex(e => e.matches('[data-steer]')), j = els.findIndex(e => /On it/.test(e.textContent)); return [i, j]; });
  ok(order[0] >= 0 && order[0] < order[1], 'steer sits before the reply that followed it', order);
  await p.evaluate(() => document.querySelector('[data-steer]')?.scrollIntoView({ block: 'center' }));
  await p.screenshot({ path: path.join(OUT, '2-read-by.png') });

  /* 3: queued run */
  await openThread('qa_steer_queued');
  await send('Also check the tablet layout');
  ok(await waitFor(async () => /Added to the queued request/.test(await pendText()), 8000), 'queued run: "Added to the queued request"', await pendText());
  await p.screenshot({ path: path.join(OUT, '3-queued.png') });

  /* 4: run finishes before reading */
  await openThread('qa_steer_late');
  await send('Use the dark theme');
  ok(await waitFor(async () => /Delivered/.test(await pendText()), 8000), 'late steer delivered first', await pendText());
  const before = writes.filter(w => /\/v1\/runs$/.test(w.p)).length;
  S.qa_steer_late.status = 'completed';
  S.qa_steer_late.rows.push(row('assistant', 'Done with the quick job.', now + 10));
  await p.evaluate(() => { const o = window.WosOutbox; for (const it of o.forThread('qa_steer_late')) if (it.state === 'sent') it.sentAt -= 10000; });
  for (let k = 0; k < 4; k++) { await refresh(); await sleep(1200); }
  const replay = await waitFor(() => writes.filter(w => /\/v1\/runs$/.test(w.p)).length > before, 25000);
  const rw = writes.filter(w => /\/v1\/runs$/.test(w.p)).slice(-1)[0];
  ok(replay && JSON.parse(rw.body).input === 'Use the dark theme' && JSON.parse(rw.body).session_id === 'qa_steer_late', 'unread steer replayed as a new message on the same thread', rw);
  ok(writes.filter(w => /\/v1\/runs$/.test(w.p) && /dark theme/.test(w.body)).length === 1, 'replayed exactly once');
  await p.screenshot({ path: path.join(OUT, '4-replayed.png') });

  ok(!errs.length, 'no page errors', errs);
  console.log('writes intercepted:', writes.length, 'leaked:', leaked.length);
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
