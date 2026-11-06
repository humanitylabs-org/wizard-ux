// Opening a thread never shows an outdated reply first (James, 24 Oct 2026: "opening a thread is showing me an old
// response, then 1-2 seconds later updating"). Fixture-only: every API read is fulfilled locally, writes are fenced,
// and the message read is held 1.6 s so the first paint can be sampled before it lands.
// Run: QA_CHROME=<chrome> node qa-thread-open-current.cjs [origin/wizard-os-home/]   (QA_WEB_DIR=<tree> for A/B)
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const URL_ = process.argv[2] || (require('./tools/qa-paths.cjs').origin() + '/wizard-os-home/');
const WEB = process.env.QA_WEB_DIR || __dirname;
const EXEC = process.env.QA_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const errors = [];
function ok(v, name, evidence) { console.log(v ? 'PASS' : 'FAIL', name, JSON.stringify(evidence)); v ? pass++ : fail++; }
const T0 = Date.now() / 1000 - 3600, SID = 'qa_open_1';
// The thread's server truth. version N holds N question/answer pairs; the newest answer reads "Answer vN".
let version = 1;
const rowsOf = n => Array.from({ length: n }, (_, i) => [
  { id: 2 * i + 1, session_id: SID, role: 'user', content: `Question v${i + 1}`, timestamp: T0 + 100 * i },
  { id: 2 * i + 2, session_id: SID, role: 'assistant', content: `Answer v${i + 1}`, timestamp: T0 + 100 * i + 50 }]).flat();
function session(id, n) {
  const last = T0 + 100 * (n - 1);
  return { id, source: 'wizard-mobile', title: id === SID ? 'QA open current' : 'QA other ' + id, status: 'completed', archived: false, hidden: false,
    message_count: 2 * n, started_at: T0, last_active: last + 50, wizard_last_user_at: last, wizard_last_assistant_at: last + 50, wizard_activity_at: last + 50,
    latest_message: { role: 'assistant', content: `Answer v${n}`, timestamp: last + 50 }, last_user_message: { role: 'user', content: `Question v${n}`, timestamp: last } };
}
(async () => {
  let b;
  try {
    b = await chromium.launch({ executablePath: EXEC });
    const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, serviceWorkers: 'block',
      userAgent: 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36' });
    await ctx.route('**/*', async r => {
      const q = r.request(), u = new URL(q.url()), m = q.method();
      const json = body => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      if (m !== 'GET' && m !== 'HEAD') return json({ ok: true, state: { initializedAt: Date.now(), threads: {} } });
      if (u.pathname.startsWith('/wizard-os-home/')) {
        const f = u.pathname.slice('/wizard-os-home/'.length) || 'index.html', fp = path.join(WEB, 'web', f);
        if (!f.includes('..') && fs.existsSync(fp) && fs.statSync(fp).isFile()) return r.fulfill({ status: 200, contentType: f.endsWith('.js') ? 'application/javascript' : f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : undefined, body: fs.readFileSync(fp) });
      }
      if (u.pathname === '/wizard/hermes/api/sessions') {
        if (u.searchParams.get('agent')) return json({ object: 'list', data: [], has_more: false }); // other agents own nothing here
        const all = [session(SID, version), session('qa_open_2', 1), session('qa_open_3', 1)];
        return json({ object: 'list', data: all, pagination: { returned: all.length, offset: 0, limit: 100, has_more: false }, has_more: false });
      }
      const mm = u.pathname.match(/\/api\/sessions\/(qa_open_\d+)\/messages$/);
      if (mm) { const n = mm[1] === SID ? version : 1; await sleep(1600); return json({ object: 'list', data: rowsOf(n).map(x => ({ ...x, session_id: mm[1] })), pagination: { returned: 2 * n, offset: 0, limit: 500 } }); }
      const sm = u.pathname.match(/\/api\/sessions\/(qa_open_\d+)$/); if (sm) return json({ session: session(sm[1], sm[1] === SID ? version : 1) });
      if (/\/wizard\/(thread-seen|thread-dispositions)$/.test(u.pathname)) return json({ state: { initializedAt: Date.now(), threads: {} } });
      if (u.pathname.startsWith('/wizard/hermes/api/')) return json({ object: 'list', data: [] });
      return r.continue();
    });
    await ctx.addInitScript(() => { try { if (!sessionStorage.getItem('qa.init')) { localStorage.clear(); sessionStorage.setItem('qa.init', '1'); } localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); } catch (e) {} });
    const p = await ctx.newPage(); p.on('pageerror', e => errors.push(e.message));
    // What the open thread shows: 'skeleton', or the newest answer on screen.
    const shown = () => p.evaluate(() => {
      const box = [...document.querySelectorAll('[data-chats]')].find(e => e.offsetParent) || document;
      if (box.querySelector('.ch-skel.thread')) return 'skeleton';
      const a = [...box.querySelectorAll('.ch-msgs .msg.a')].map(e => e.textContent.trim()).filter(Boolean);
      const v = a.length && a.at(-1).match(/Answer v(\d)/); return a.length ? (v ? 'Answer v' + v[1] : a.at(-1).slice(0, 40)) : 'none';
    });
    const open = async () => { await p.locator(`[data-chopen="${SID}"]`).first().tap(); await sleep(150); return shown(); };
    const back = async () => { await p.locator('[data-chback]').first().tap(); await p.waitForSelector(`[data-chopen="${SID}"]`); await sleep(300); };
    const refreshList = () => p.evaluate(() => window.WizLive.refresh());
    const settle = async want => { for (let i = 0; i < 40; i++) { if (await shown() === want) return want; await sleep(100); } return shown(); };

    await p.goto(URL_ + '?open=chats'); await p.waitForSelector(`[data-chopen="${SID}"]`); await sleep(1500);
    ok((await open()) !== 'Answer v0', 'first open renders', {});
    ok(await settle('Answer v1') === 'Answer v1', 'first open lands v1', {});
    await back();

    // 1. Same thread, nothing new: the kept copy still paints at once (speed kept).
    ok(await open() === 'Answer v1', 'unchanged reopen paints its kept copy at once', {});
    await back();

    // 2. A reply lands while away; the live list knows. Reopening must not show the previous answer first.
    version = 2; await refreshList(); await sleep(100);
    const a = await open();
    ok(a === 'skeleton' || a === 'Answer v2', 'reopen after a new reply never paints the old answer (in-memory copy)', { first: a });
    ok(await settle('Answer v2') === 'Answer v2', 'reopen lands the new answer', {});
    await back();

    // 3. Reload: the on-device copy (IndexedDB) of an unchanged thread paints at once once the list is live.
    await p.reload(); await p.waitForSelector(`[data-chopen="${SID}"]`); await sleep(2500);
    const c = await open();
    ok(c === 'Answer v2', 'unchanged thread after reload paints the stored copy at once', { first: c });
    await settle('Answer v2'); await back();

    // 4. Reload, then a reply lands; the stored copy is older than the list. It must not paint.
    await p.reload(); await p.waitForSelector(`[data-chopen="${SID}"]`); await sleep(2500);
    version = 3; await refreshList(); await sleep(100);
    const d = await open();
    ok(d === 'skeleton' || d === 'Answer v3', 'outdated stored copy never paints on open', { first: d });
    ok(await settle('Answer v3') === 'Answer v3', 'open after reload lands the new answer', {});
    // 5. Within one open, a poll never blanks the thread on screen.
    version = 4; await refreshList();
    const polls = []; for (let i = 0; i < 12; i++) { polls.push(await shown()); await sleep(200); }
    ok(!polls.includes('skeleton') && !polls.includes('none'), 'a new reply in the open thread never blanks it', { polls });

    ok(errors.length === 0, 'zero page errors', errors);
    console.log(`${pass} pass, ${fail} fail`);
  } catch (e) { console.error(e); fail++; } finally { if (b) await b.close(); }
  process.exitCode = fail ? 1 : 0;
})();
