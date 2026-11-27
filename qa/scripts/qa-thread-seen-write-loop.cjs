const QA_ROOT = require('node:path').resolve(__dirname, '../..'); // repo root (this script lives in qa/scripts/)
// QA (wizard-os issue 1020): a thread open on the desktop must not write PUT /wizard/thread-seen over and over.
// Miguel's desktop tripped the shell's write guard: 21 thread-seen writes in one minute. The desktop marks the open
// thread read on every Live repaint while it still reads as unread, so a read that does not stick became a write loop:
//   A. the box's read record is a newer revision than the row on screen (another device or the thread's own detail
//      read it later), and the row has no assistant time: the older row's preview never matched, so it stayed unread;
//   B. the thread was marked unread on a device whose clock runs ahead: reading it here at an earlier clock time
//      never got past that mark.
// Fully stubbed: shell from the tree under test, Wizard API faked, nothing leaves the box. Real time, ~70 s per case.
// Usage: QA_WEB_DIR=<tree> [QA_SECONDS=60] node qa/scripts/qa-thread-seen-write-loop.cjs
const pw = require('../../tools/qa-playwright.cjs');
const { chromium } = pw;
const fs = require('fs'), path = require('path');
const W = process.env.QA_WEB_DIR || QA_ROOT;
const EXEC = process.env.QA_CHROME || undefined;
const ORIGIN = require('../../tools/qa-paths.cjs').origin();
const SECONDS = Number(process.env.QA_SECONDS || 60);
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === '' ? '' : JSON.stringify(extra).slice(0, 400)); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = Date.now() / 1000;
const A = 'qa_1020_newer_record', B = 'qa_1020_skewed_unread';
const sessions = {
  // No assistant reply yet (the owner's own message is the latest): the list row carries no assistant time.
  [A]: { id: A, source: 'wizard-mobile', title: 'QA 1020 · newer read record', status: 'completed', archived: false, hidden: false,
    started_at: now - 7200, last_active: now - 600, wizard_last_user_at: now - 600, wizard_activity_at: now - 600,
    latest_message: { role: 'user', content: 'An older question on screen', timestamp: now - 600 } },
  [B]: { id: B, source: 'wizard-mobile', title: 'QA 1020 · unread from a fast clock', status: 'completed', archived: false, hidden: false, message_count: 2,
    started_at: now - 7200, last_active: now - 900, wizard_last_user_at: now - 1000, wizard_last_assistant_at: now - 900, wizard_activity_at: now - 900,
    latest_message: { role: 'assistant', content: 'A reply', timestamp: now - 900 }, last_user_message: { role: 'user', content: 'Ask', timestamp: now - 1000 } },
};
const iso = s => new Date(s * 1000).toISOString();
// The box's read state: A was read at a newer revision (another device); B was marked unread by a phone 5 min ahead.
let seenState = { initializedAt: (now - 86400) * 1000, threads: {
  [`direct:${A}`]: { updatedAt: iso(now - 60), previewFingerprint: 'zz9', seenAt: (now - 50) * 1000 },
  [`direct:${B}`]: { messageCount: 2, status: 'completed', updatedAt: iso(now - 900), previewFingerprint: 'abc', assistantActivityAt: iso(now - 900), seenAt: (now - 800) * 1000, unreadAt: (now + 300) * 1000 },
} };
const later = (l, r) => { // the box keeps the later seen time and the later unread mark (Agent Service thread-seen.mjs)
  if (!l) return r; const pick = Date.parse(r.updatedAt) > Date.parse(l.updatedAt) ? r : l;
  const unreadAt = Math.max(l.unreadAt ?? -1, r.unreadAt ?? -1);
  return { ...pick, seenAt: Math.max(l.seenAt, r.seenAt), ...(unreadAt >= 0 ? { unreadAt } : {}) };
};
const puts = [];
const rows = id => [{ id: 1, session_id: id, role: 'user', content: 'Ask', timestamp: now - 1000 }].concat(id === B ? [{ id: 2, session_id: id, role: 'assistant', content: 'A reply', timestamp: now - 900 }] : []);
const ct = f => f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : f.endsWith('.png') ? 'image/png' : f.endsWith('.svg') ? 'image/svg+xml' : f.endsWith('.webmanifest') ? 'application/manifest+json' : f.endsWith('.txt') ? 'text/plain' : 'application/javascript';

(async () => {
  const b = await chromium.launch({ executablePath: EXEC && fs.existsSync(EXEC) ? EXEC : undefined });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true });
  await ctx.route('**/*', r => {
    const q = r.request(), u = new URL(q.url()), m = q.method();
    if (u.origin !== ORIGIN) return r.abort();
    const json = (status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const wm = u.pathname.match(/^\/wizard-os-home\/(.*)$/);
    if (wm && m === 'GET') {
      const f = wm[1] || 'index.html', p = path.join(W, 'web', f);
      if (!fs.existsSync(p) || /^(data|summaries)\.js$/.test(f)) return r.fulfill({ status: 200, contentType: ct(f), body: '' });
      return r.fulfill({ status: 200, contentType: ct(f), body: fs.readFileSync(p) });
    }
    if (u.pathname === '/wizard/thread-seen') {
      if (m === 'PUT') {
        const st = JSON.parse(q.postData() || '{}'); puts.push({ at: Date.now(), keys: Object.keys(st.threads || {}) });
        const threads = { ...seenState.threads }; for (const [k, v] of Object.entries(st.threads || {})) threads[k] = later(threads[k], v);
        seenState = { initializedAt: Math.min(seenState.initializedAt, st.initializedAt || Infinity), threads };
      }
      return json(200, { state: seenState });
    }
    if (m !== 'GET') return json(200, { ok: true });
    if (u.pathname === '/wizard/hermes/api/sessions') return json(200, { data: Object.values(sessions), has_more: false });
    const mm = u.pathname.match(/^\/wizard\/hermes\/api\/sessions\/([^/]+)(\/messages)?$/);
    if (mm && sessions[mm[1]]) { if (mm[2]) { const d = rows(mm[1]); return json(200, { object: 'list', data: d, pagination: { limit: 500, offset: 0, returned: d.length } }); } return json(200, { session: sessions[mm[1]] }); }
    return json(200, {});
  });
  const p = await ctx.newPage(); p.setDefaultTimeout(15000);
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); localStorage.setItem('wos.tour.done', '1'); } catch (e) {} });
  await p.goto(ORIGIN + '/wizard-os-home/desktop.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => { const q = window.__wos || window.__wux; return q?.live?.ok; }, null, { timeout: 60000 });
  await p.evaluate(() => { window.__qa = window.__wos || window.__wux; });
  for (const [label, id] of [['A newer read record', A], ['B unread from a clock 5 min ahead', B]]) {
    await p.evaluate(id => (__qa.openWizardThread || __qa.openThread)(id), id);
    await sleep(1500);
    const open = await p.evaluate(id => Object.values(__qa.wins).some(w => w.app === 'chats' && w.thread === id), id);
    ok(open, `${label}: the thread is open in a desktop Chats window`);
    const start = puts.length, t0 = Date.now();
    // Owner at the screen: a wheel over the thread every 10 s (real input keeps "attended" on); Live polls every 15 s.
    while (Date.now() - t0 < SECONDS * 1000) { await p.mouse.move(700, 450); await p.mouse.wheel(0, 40); await sleep(10000); }
    const n = puts.slice(start).filter(x => x.keys.includes(`direct:${id}`)).length, guard = await p.evaluate(() => window.WosWriteGuard?.reports?.() || []);
    console.log(`${label}: ${n} thread-seen writes in ${SECONDS} s`);
    ok(n <= 3, `${label}: at most 3 thread-seen writes in ${SECONDS} s (was a write per Live repaint)`, { n });
    ok(!(await p.evaluate(id => __qa.live.isNew(__qa.live.session(id)), id)), `${label}: the open thread reads as read`);
    ok(!guard.some(r => r.at >= t0 && /thread-seen/.test(JSON.stringify(r))), `${label}: the write guard did not pause thread-seen`, guard);
  }
  ok(!errs.length, 'no page errors', errs);
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
