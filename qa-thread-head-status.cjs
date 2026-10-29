// QA: the open thread's header wears the same status icon as its list row (James, 25 Oct 2026: "for the memory
// steward, it should have the hand up that reminds me I need to do something here"). Fixture harness copied from
// qa-ready-status.cjs (real reads, fixture threads, every write intercepted).
// Usage: node tools/qa-origin.cjs 9481 <tree>/web &  then  QA_WEB_DIR=<tree> node qa-thread-head-status.cjs [url]
// Original harness notes: QA: Ready status lines (feature/ready-status). Each finished thread carries the agent's hidden status tag
// (wizard_attention: needs_you / check / done / fyi + one-line ask + subject). Ready shows needs-you and
// test-this rows first with the exact ask as the preview, done/FYI rows go quiet and swipe straight to Done,
// a needs-you thread from an earlier day files under its own day (Past week) with a "need you" count, and "By subject" groups Ready like the roundup.
// Ready has three orders: Newest (pure recency, labels never move rows), Priority (needs you, test this, rest)
// and By subject. James, 10 Oct 2026: "Newest, I actually want to not use the labels … the newest appears at the
// top. Then … another option … priority … and that's where it should sort how it is now."
//
// James, 10 Oct 2026: "differentiate tasks in ready by which ones are needs you / awaiting your action and which
// ones are done … I don't want the UX to get too cluttered."
//
// Real Wizard reads; fixture threads merged into the session list; EVERY write is intercepted (zero reach Archimedes).
// Usage: node tools/qa-origin.cjs 9481 <tree>/web &  then  QA_WEB_DIR=<tree> node qa-ready-status.cjs [url]
const pw = require('./tools/qa-playwright.cjs');
const { chromium } = pw;
const fs = require('fs'), path = require('path');
const URL_ = process.argv[2] || 'http://127.0.0.1:9481/wizard-os-home/';
const WEB = process.env.QA_WEB_DIR || '';
const OUT = process.env.QA_OUT || require('./tools/qa-paths.cjs').workPath('wos-thread-head-status-shots');
const EXEC = process.env.QA_CHROME || (process.env.QA_CHROME || undefined);
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === '' ? '' : JSON.stringify(extra).slice(0, 400)); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const now = Date.now() / 1000;
// Newest first by time: fyi is the newest, needs-you the oldest of today, plus one needs-you from 3 days ago.
const FIX = {
  qa_rs_working: { title: 'QA rs Working reply', t: now - 10, status: 'running', att: null },
  qa_rs_fyi: { title: 'QA rs FYI answer', t: now - 20, att: { state: 'fyi', ask: 'Good Arts Law is a 1990s copyright doctrine', subject: 'Research' } },
  qa_rs_done: { title: 'QA rs Done fix', t: now - 30, att: { state: 'done', ask: 'Sending pill is live', subject: 'Wizard OS' } },
  qa_rs_check: { title: 'QA rs Check build', t: now - 40, att: { state: 'check', ask: 'Try the new orb timing from the side button', subject: 'Wizard OS' } },
  qa_rs_needs: { title: 'QA rs Needs decision', t: now - 50, att: { state: 'needs_you', ask: 'Say "ship desks" if the preview feels right', subject: 'Wizard OS' } },
  qa_rs_old: { title: 'QA rs Old needs', t: now - 3 * 86400, att: { state: 'needs_you', ask: 'Approve the UPS and Cat6 purchase', subject: 'Home' } },
  qa_rs_plain: { title: 'QA rs Plain reply', t: now - 25, att: null },
};
const ARCH = new Set();
function fixSession(id) {
  const f = FIX[id];
  return { id, source: 'wizard-mobile', title: f.title, status: f.status || 'completed', archived: ARCH.has(id), hidden: false, message_count: 2,
    started_at: f.t - 600, last_active: f.t, wizard_last_user_at: f.t - 120, wizard_last_assistant_at: f.t, wizard_activity_at: f.t, wizard_run_id: '',
    latest_message: { role: 'assistant', content: `Long reply body for ${f.title} that should not be the preview when a status exists.`, timestamp: f.t },
    last_user_message: { role: 'user', content: `${f.title} ask`, timestamp: f.t - 120 },
    ...(f.att ? { wizard_attention: f.att } : {}) };
}
const rowsFor = id => [{ id: 1, session_id: id, role: 'user', content: `${FIX[id].title} ask`, timestamp: FIX[id].t - 120 }, { id: 2, session_id: id, role: 'assistant', content: `Answer for ${FIX[id].title}.`, timestamp: FIX[id].t }];
const writes = [];
const PREFS = { archiveAfterDays: 7, compact: false, readyOrder: 'newest', subjectOrder: [], pinnedChats: [] };
function routeFor() {
  return async r => {
    const q = r.request(), u = new URL(q.url()), m = q.method();
    const wm = u.pathname.match(/\/wizard-os-home\/((?:core\/|desktop\/)?[a-z-]+\.(?:js|css)|index\.html|desktop\.html|)$/);
    if (WEB && wm && m === 'GET' && !/^(data|summaries)\.js$/.test(wm[1])) { const f = wm[1] || 'index.html', fp = path.join(WEB, 'web', f); if (fs.existsSync(fp)) return r.fulfill({ status: 200, contentType: f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : 'application/javascript', body: fs.readFileSync(fp) }); }
    const json = (status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    // Box preferences stay in the fixture: the live box's saved order must not reset the suite's choices on reload.
    if (u.pathname === '/wizard/v1/ui-preferences') {
      if (m === 'PUT') { try { Object.assign(PREFS, JSON.parse((q.postDataBuffer() || Buffer.alloc(0)).toString())); } catch (e) {} }
      return json(200, PREFS);
    }
    if (m !== 'GET' && m !== 'HEAD') {
      const body = (q.postDataBuffer() || Buffer.alloc(0)).toString();
      writes.push({ m, p: u.pathname, body });
      // Read-state writes carry thread ids (one of them ends in "done"): they never archive anything.
      if (u.pathname !== '/wizard/thread-seen') for (const id of Object.keys(FIX)) if ((u.pathname.includes(id) || body.includes(id)) && /archive|hide|done|"archived":true/i.test(u.pathname + body)) ARCH.add(id);
      if (u.pathname === '/wizard/thread-seen') { let st; try { st = JSON.parse(body).state; } catch (e) {} return json(200, { state: st || { initializedAt: Date.now(), threads: {} } }); }
      return json(200, { ok: true });
    }
    if (!u.pathname.startsWith('/wizard/')) return r.continue();
    if (u.pathname === '/wizard/hermes/api/sessions' && (u.searchParams.get('offset') || '0') === '0') {
      const res = await r.fetch(); const p = await res.json();
      p.data = Object.keys(FIX).map(fixSession).concat(p.data || []);
      return json(200, p);
    }
    const mm = u.pathname.match(/\/wizard\/hermes\/api\/sessions\/([^/]+)\/messages$/);
    if (mm && FIX[mm[1]]) { const rows = rowsFor(mm[1]); return json(200, { object: 'list', data: rows, pagination: { limit: 500, offset: 0, returned: rows.length } }); }
    const sm = u.pathname.match(/\/wizard\/hermes\/api\/sessions\/([^/]+)$/); if (sm && FIX[sm[1]]) return json(200, { session: fixSession(sm[1]) });
    return r.continue();
  };
}

(async () => {
  const b = await chromium.launch({ executablePath: fs.existsSync(EXEC) ? EXEC : undefined });
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true });
  await ctx.route('**/*', routeFor());
  const p = await ctx.newPage(); p.setDefaultTimeout(8000);
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(`const QA_SKIN_ = ${JSON.stringify(process.env.QA_SKIN || '')};(${(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); if (QA_SKIN_) localStorage.setItem('wos.skin', QA_SKIN_); } catch (e) {} }).toString()})()`);
  await p.goto(URL_, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__wos?.live?.ok && window.__wos.live.session('qa_rs_needs'), null, { timeout: 90000 }).catch(() => {});
  ok(await p.evaluate(() => !!window.__wos?.live?.session('qa_rs_needs')), 'fixture threads loaded');
  await p.evaluate(() => __wos.goDesk(1)); await sleep(800);
  const wid = () => p.evaluate(() => Object.values(__wos.wins).find(w => w.app === 'chats')?.id);
  const head = async id => {
    const w = await wid();
    // Open through the real row tap path when the row is on screen; fall back to the row's click handler.
    await p.evaluate(({ w, id }) => { const r = document.querySelector(`[data-chats="${w}"] [data-chopen="${id}"]`); r?.scrollIntoView({ block: 'center' }); r?.click(); }, { w, id });
    await p.waitForFunction(({ w, id }) => { const h = document.querySelector(`[data-chats="${w}"] .ch-head`); return h && !document.querySelector(`[data-chats="${w}"] [data-chopen="${id}"]`); }, { w, id }, { timeout: 8000 }).catch(() => {});
    await sleep(400);
    return p.evaluate(w => { const h = document.querySelector(`[data-chats="${w}"] .ch-head`); const i = h?.querySelector('.ch-head-sti'); const t = h?.querySelector('.ti');
      const ib = i?.getBoundingClientRect(), tb = t?.getBoundingClientRect(), bk = h?.querySelector('.ch-back')?.getBoundingClientRect();
      return { title: h?.querySelector('.ti b')?.textContent || '', cls: i ? i.className : '', svg: !!i?.querySelector('svg'), color: i ? getComputedStyle(i).color : '', between: !!(i && bk && tb && ib.left >= bk.right - 1 && ib.right <= tb.left + 1), h: ib?.height || 0 }; }, w);
  };
  const back = async () => { await p.evaluate(async () => { const w = Object.values(__wos.wins).find(w => w.app === 'chats')?.id; document.querySelector(`[data-chats="${w}"] [data-chback]`)?.click(); }); await sleep(600); };
  try {
    const want = { qa_rs_needs: 'needs', qa_rs_check: 'check', qa_rs_done: 'done', qa_rs_fyi: 'fyi' };
    for (const [id, k] of Object.entries(want)) {
      const r = await head(id);
      ok(r.cls.split(' ').includes(k) && r.svg, `header of ${id} shows the ${k} icon`, r);
      ok(r.between, `${id}: icon sits between Back and the title`, r);
      if (k === 'needs') { ok((process.env.QA_SKIN ? r.color !== 'rgb(0, 0, 0)' : /rgb\(255, 184, 77\)/.test(r.color)) && r.h >= 22 && r.h <= 26, 'needs icon is the amber raised hand at title-text size (24 px)', r); await p.screenshot({ path: path.join(OUT, `needs-head${process.env.QA_SKIN ? '-' + process.env.QA_SKIN : ''}.png`) }); }
      await back();
    }
    const plain = await head('qa_rs_plain');
    ok(!plain.cls, 'a thread with no status shows no header icon (no grey dot)', plain);
    await back();
    // Same icon as the row: the row's class and the header's class agree.
    const rowK = await p.evaluate(async () => { const w = Object.values(__wos.wins).find(w => w.app === 'chats')?.id; return document.querySelector(`[data-chats="${w}"] [data-chopen="qa_rs_needs"] .emo.sti`)?.className || ''; });
    ok(/\bneeds\b/.test(rowK), 'list row still shows the needs icon', rowK);
    ok(!errs.length, 'no page errors', errs);
  } catch (e) { fail++; console.log('FAIL exception', String(e).slice(0, 400)); }
  console.log(`\n${pass} pass, ${fail} fail · shots ${OUT}`);
  await b.close(); process.exit(fail ? 1 : 0);
})();
