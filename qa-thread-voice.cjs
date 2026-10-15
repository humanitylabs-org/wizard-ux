// QA: talking with a thread open goes INTO that thread (steering its live run), never a new thread.
// Repro (9 Oct 2026): James had a working thread open, spoke a follow-up, the router answered "agent",
// and the shell opened a brand-new thread instead of steering. Router answers are stubbed per case.
// Usage: QA_WEB_DIR=<repo> node qa-thread-voice.cjs [url]. Real Wizard reads; every write is intercepted.
const { chromium } = require('/home/telos/node_modules/playwright');
const URL_ = process.argv[2] || 'https://wizard.tailc0f369.ts.net/wizard-os-home/';
const RESOLVE = process.env.QA_RESOLVE || 'MAP wizard.tailc0f369.ts.net 127.0.0.1:18443';
const W = process.env.QA_WEB_DIR || '';
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };

async function boot(b) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true });
  const writes = []; const R = { answer: { cmd: { route: 'agent' }, ms: 5 }, status: 200 };
  await ctx.route('**/*', r => {
    const q = r.request(), u = q.url();
    const m = u.match(/\/wizard-os-home\/((?:desktop\/|core\/)?[a-z-]+\.(?:js|css|html)|)(\?|$)/);
    if (W && m && q.method() === 'GET' && !/^(data|summaries)\.js$/.test(m[1])) {
      const f = m[1] || 'index.html', p = require('path').join(W, 'web', f);
      if (require('fs').existsSync(p)) return r.fulfill({ status: 200, contentType: f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : 'application/javascript', body: require('fs').readFileSync(p) });
    }
    if (/\/api\/route$|\/wizard\/v1\/route$/.test(u)) { writes.push({ u: '/route', body: q.postData() || '' }); return r.fulfill({ status: R.status, contentType: 'application/json', body: JSON.stringify(R.answer) }); }
    if (q.method() !== 'GET' && /\/wizard\/(hermes|thread-seen|files)/.test(u)) {
      writes.push({ u: u.replace(/^https:\/\/[^/]+/, ''), body: q.postData() || '' });
      if (/\/api\/sessions$/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ session: { id: 'qa-fake-session' } }) });
      if (/\/v1\/runs$/.test(u)) return r.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ run_id: 'qa-fake-run', status: 'queued' }) });
      return r.fulfill({ status: 200, contentType: 'application/json', body: '{"accepted":true}' });
    }
    return r.continue();
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => { const st = String(e.stack || ''); if (/wizard-os-home\//.test(st) || !/https?:\/\//.test(st)) errs.push(String(e)); });
  await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); } catch (e) {} });
  await p.goto(URL_, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__wos && window.__wos.live && window.__wos.live.ok, null, { timeout: 30000 });
  await p.waitForTimeout(800);
  return { ctx, p, writes, errs, R };
}
// Open the first thread on the Chats desk and mark it as working on a known run, like a live Archimedes turn.
async function openWorkingThread(p) {
  await p.evaluate(() => __wos.goDesk(1)); await p.waitForTimeout(500);
  await p.locator('.ch-row').first().tap(); await p.waitForTimeout(1200);
  return p.evaluate(() => {
    const tid = __wos.wins[__wos.desks[1].focus].thread;
    const s = __wos.live.session(tid); if (s) Object.assign(s, { status: 'running', runId: 'run_qa_live' });
    return { tid, has: !!s };
  });
}
const say = async (p, text, kind = 'auto', target = null) => { await p.evaluate(([t, k, g]) => __wos.handleText(t, k, false, 0, g), [text, kind, target]); await p.waitForTimeout(3500); };
const created = ws => ws.filter(w => /\/api\/sessions$/.test(w.u));
const steers = ws => ws.filter(w => /\/v1\/runs\/run_qa_live\/steer$/.test(w.u));
const runs = ws => ws.filter(w => /\/v1\/runs$/.test(w.u));

(async () => {
  const b = await chromium.launch({ args: ['--host-resolver-rules=' + RESOLVE] });

  // 1. The repro: a thread is open and working, the router says "agent" (a new-sounding request).
  {
    const { ctx, p, writes, errs, R } = await boot(b);
    const { tid, has } = await openWorkingThread(p);
    ok(has && !!tid, 'a real thread is open and marked working', tid);
    writes.length = 0; R.answer = { cmd: { route: 'agent', summary: 'x' }, ms: 5 };
    await say(p, "Legacy Wizard is on the desktop app, but it's not on the mobile one. Make sure that's added to my apps here.");
    ok(created(writes).length === 0, 'router says agent: no new thread is created', JSON.stringify(writes.map(w => w.u)));
    ok(steers(writes).length === 1, 'router says agent: the words steer the open thread’s live run', JSON.stringify(writes.map(w => w.u)));
    const st = steers(writes)[0]; const body = st ? JSON.parse(st.body || '{}') : {};
    ok(/Legacy Wizard is on the desktop app/.test(body.input || ''), 'the steer carries exactly what was said', JSON.stringify(body).slice(0, 160));
    const still = await p.evaluate(() => __wos.wins[__wos.desks[1].focus].thread);
    // No jump to a new thread; send and go (10 Oct 2026) may pop back to the list.
    ok(still === tid || still === null, 'no jump to another thread (same thread, or back on the list)', `${still} vs ${tid}`);
    ok(errs.length === 0, 'no page errors (repro)', errs.join(' | '));
    await ctx.close();
  }
  // 2. Router down (500) with a thread open: still into the thread.
  {
    const { ctx, p, writes, errs, R } = await boot(b);
    await openWorkingThread(p);
    writes.length = 0; R.status = 500; R.answer = { error: 'router' };
    await say(p, 'Also check the desktop list while you are at it');
    ok(created(writes).length === 0 && steers(writes).length === 1, 'router offline: steers the open thread, no new thread', JSON.stringify(writes.map(w => w.u)));
    ok(errs.length === 0, 'no page errors (router offline)', errs.join(' | '));
    await ctx.close();
  }
  // 3. Idle thread (no live run): the words become a new run IN that thread, not a new thread.
  {
    const { ctx, p, writes, errs, R } = await boot(b);
    const { tid } = await openWorkingThread(p);
    await p.evaluate(tid => { const s = __wos.live.session(tid); Object.assign(s, { status: 'completed', runId: '' }); }, tid);
    writes.length = 0; R.answer = { cmd: { route: 'agent' }, ms: 5 };
    await say(p, 'Now do the same for the desktop shell');
    const run = runs(writes)[0]; const body = run ? JSON.parse(run.body || '{}') : {};
    ok(created(writes).length === 0 && body.session_id === tid, 'idle thread: a new run in the same thread', JSON.stringify({ u: writes.map(w => w.u), sid: body.session_id, tid }));
    ok(errs.length === 0, 'no page errors (idle thread)', errs.join(' | '));
    await ctx.close();
  }
  // 4. Commands still work from inside a thread, and never post a turn.
  {
    const { ctx, p, writes, errs, R } = await boot(b);
    await openWorkingThread(p);
    writes.length = 0; R.answer = { cmd: { route: 'command', action: 'open_view', view: 'week' }, ms: 5 };
    await say(p, 'show me the week in review');
    const s = await p.evaluate(() => __wos.desks[__wos.idx].wins.map(id => __wos.wins[id].app));
    ok(s.includes('review'), 'a phone command from inside a thread still runs', JSON.stringify(s));
    ok(created(writes).length === 0 && steers(writes).length === 0 && runs(writes).length === 0, 'the command posts nothing to Archimedes', JSON.stringify(writes.map(w => w.u)));
    ok(errs.length === 0, 'no page errors (command)', errs.join(' | '));
    await ctx.close();
  }
  // 5. From the thread LIST (no thread open), a request still starts a new thread.
  {
    const { ctx, p, writes, errs, R } = await boot(b);
    await p.evaluate(() => __wos.goDesk(1)); await p.waitForTimeout(700);
    writes.length = 0; R.answer = { cmd: { route: 'agent' }, ms: 5 };
    await say(p, 'Research the best e-ink tablets for reading PDFs');
    ok(created(writes).length === 1 && steers(writes).length === 0, 'from the list: a new thread, as before', JSON.stringify(writes.map(w => w.u)));
    ok(errs.length === 0, 'no page errors (list)', errs.join(' | '));
    await ctx.close();
  }
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
