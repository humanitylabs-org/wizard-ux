// QA: app links from a thread (feature/app-link-back). A Wizard app link in a chat (…/wizard-os-home/?open=<app>)
// opens the app on its own desk beside the thread; ONE Back closes it and lands on that same thread again (not Home,
// app not left open). Opening the same app from the launcher keeps the normal behaviour (Back → Home, desk stays).
//
// James, 12 Oct 2026: "when I click a link to open an app, hitting back should close that and bring me back to the chat."
//
// Real Wizard reads; fixture threads merged into the session list; EVERY write is intercepted (zero reach Archimedes).
// Usage: node tools/qa-origin.cjs 9482 <tree>/web &  then  QA_WEB_DIR=<tree> node qa-app-link-back.cjs [url]
let pw; try { pw = require('playwright-core'); } catch (e) { pw = require('/home/developer/node_modules/playwright'); }
const { chromium } = pw;
const fs = require('fs'), path = require('path');
const URL_ = process.argv[2] || 'http://127.0.0.1:9482/wizard-os-home/';
const WEB = process.env.QA_WEB_DIR || '';
const OUT = process.env.QA_OUT || '/home/developer/.hermes/cache/scratch/wos-app-link-back-shots';
const EXEC = process.env.QA_CHROME || '/home/developer/.local/bin/google-chrome';
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === '' ? '' : JSON.stringify(extra).slice(0, 400)); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const origin = new URL(URL_).origin;

const now = Date.now() / 1000;
let rid = 1;
const row = (role, content, ts) => ({ id: rid++, session_id: '', role, content, timestamp: ts });
const FIX = {
  qa_al_t: { title: 'QA app link', t: now - 20, rows: () => [row('user', 'Build me a meditation app', now - 300), row('assistant',
    `It is live. **Open it:** [Meditate](${origin}/wizard-os-home/?open=meditation). Also [Files](/wizard-os-home/?open=files).`, now - 250)] },
  qa_tt_sum: { title: 'QA trail summary', t: now - 30, rows: () => [row('user', 'Summarise my open threads', now - 300), row('assistant',
    `Here are your threads:\n\n- [Thread A](/wizard/?session=qa_tt_a): done.\n- [Thread B](/wizard/?session=qa_tt_b): needs you.\n- [Thread C](${origin}/wizard-os-home/?session=qa_tt_c): own-page link.`, now - 250)] },
  qa_tt_a: { title: 'QA trail A', t: now - 40, rows: () => [row('user', 'Thread A ask', now - 400), row('assistant', 'Thread A answer. See also [Thread B](/wizard/?session=qa_tt_b).', now - 350)] },
  qa_tt_b: { title: 'QA trail B', t: now - 41, rows: () => [row('user', 'Thread B ask', now - 400), row('assistant', 'Thread B answer.', now - 350)] },
  qa_tt_c: { title: 'QA trail C', t: now - 42, rows: () => [row('user', 'Thread C ask', now - 400), row('assistant', 'Thread C answer.', now - 350)] },
};
const ARCH = new Set(), DEF = new Set();
function fixSession(id) {
  const f = FIX[id], rows = f.rows(), last = rows[rows.length - 1], lastU = rows[0];
  return { id, source: 'wizard-mobile', title: f.title, status: 'completed', archived: ARCH.has(id), hidden: false, message_count: rows.length,
    started_at: f.t - 600, last_active: f.t, wizard_last_user_at: lastU.timestamp, wizard_last_assistant_at: f.t, wizard_activity_at: f.t, wizard_run_id: '',
    wizard_deferred: DEF.has(id) || undefined,
    latest_message: { role: last.role, content: String(last.content).slice(0, 200), timestamp: last.timestamp },
    last_user_message: { role: 'user', content: lastU.content, timestamp: lastU.timestamp } };
}
const writes = [];
function routeFor() {
  return async r => {
    const q = r.request(), u = new URL(q.url()), m = q.method();
    const wm = u.pathname.match(/\/wizard-os-home\/((?:core\/|desktop\/)?[a-z-]+\.(?:js|css)|index\.html|desktop\.html|)$/);
    if (WEB && wm && m === 'GET' && !/^(data|summaries)\.js$/.test(wm[1])) { const f = wm[1] || 'index.html', fp = path.join(WEB, 'web', f); if (fs.existsSync(fp)) return r.fulfill({ status: 200, contentType: f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : 'application/javascript', body: fs.readFileSync(fp) }); }
    const json = (status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (m !== 'GET' && m !== 'HEAD') {
      const body = (q.postDataBuffer() || Buffer.alloc(0)).toString();
      writes.push({ m, p: u.pathname, body });
      for (const id of Object.keys(FIX)) if (u.pathname.includes(id) || body.includes(id)) { if (/archive|hide|done/i.test(u.pathname + body)) ARCH.add(id); }
      if (u.pathname === '/wizard/thread-seen') { let st; try { st = JSON.parse(body).state; } catch (e) {} return json(200, { state: st || { initializedAt: Date.now(), threads: {} } }); }
      return json(200, { ok: true });
    }
    // The apps the links open come from their real local services (read-only GETs).
    const LOCAL = { '/meditation/': 9420, '/files/': 8954 };
    if (/127\.0\.0\.1/.test(origin)) for (const [pre, port] of Object.entries(LOCAL)) if (u.pathname.startsWith(pre) || u.pathname === pre.slice(0, -1)) { const res = await r.fetch({ url: `http://127.0.0.1:${port}${u.pathname}${u.search}` }).catch(() => null); return res ? r.fulfill({ response: res }) : r.abort(); }
    if (!u.pathname.startsWith('/wizard/')) return r.continue();
    if (u.pathname === '/wizard/hermes/api/sessions' && (u.searchParams.get('offset') || '0') === '0') {
      const res = await r.fetch(); const p = await res.json();
      p.data = Object.keys(FIX).map(fixSession).concat(p.data || []);
      return json(200, p);
    }
    const mm = u.pathname.match(/\/wizard\/hermes\/api\/sessions\/([^/]+)\/messages$/);
    if (mm && FIX[mm[1]]) { rid = 1; const rows = FIX[mm[1]].rows().map(x => ({ ...x, session_id: mm[1] })); return json(200, { object: 'list', data: rows, pagination: { limit: 500, offset: 0, returned: rows.length } }); }
    const sm = u.pathname.match(/\/wizard\/hermes\/api\/sessions\/([^/]+)$/); if (sm && FIX[sm[1]]) return json(200, { session: fixSession(sm[1]) });
    return r.continue();
  };
}


(async () => {
  const b = await chromium.launch({ executablePath: fs.existsSync(EXEC) ? EXEC : undefined });
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true });
  await ctx.route('**/*', routeFor());
  const p = await ctx.newPage(); p.setDefaultTimeout(8000);
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); localStorage.setItem('wos.rvCoached', 'true'); } catch (e) {} });
  await p.goto(URL_, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__wos?.live?.ok && window.__wos.live.session('qa_al_t'), null, { timeout: 90000 }).catch(() => {});
  ok(await p.evaluate(() => !!window.__wos?.live?.session('qa_al_t')), 'thread list loaded with the fixture thread');
  await p.evaluate(() => __wos.goDesk(1)); await sleep(600);
  const st = () => p.evaluate(() => {
    const d = __wos.desks[__wos.idx], f = __wos.wins[d?.focus];
    const chat = Object.values(__wos.wins).find(w => w.app === 'chats');
    return { idx: __wos.idx, focusApp: f?.app, focusAppId: f?.appId || '', from: !!f?.from, thread: chat?.thread ?? null,
      medOpen: Object.values(__wos.wins).filter(w => w.appId === 'meditation' && !w.bound).length, medBound: Object.values(__wos.wins).filter(w => w.appId === 'meditation' && w.bound).length, desks: __wos.desks.length };
  });
  const wid = () => p.evaluate(() => Object.values(__wos.wins).find(w => w.app === 'chats')?.id);
  const alive = () => p.evaluate(() => !!window.__wos && document.visibilityState === 'visible' && !!document.querySelector('.win'));
  const back = async () => { await p.keyboard.press('Escape'); await sleep(700); };
  async function tapLink(text) {
    const loc = p.locator(`[data-chats="${await wid()}"] .ch-msgs .msg.a a`, { hasText: text }).last();
    await loc.scrollIntoViewIfNeeded().catch(() => {}); await loc.tap(); await sleep(1200);
  }
  try {
    await p.evaluate(() => __wos.openWizardThread('qa_al_t'));
    await p.waitForFunction(() => { const w = Object.values(__wos.wins).find(x => x.app === 'chats'); return w?.thread === 'qa_al_t' && document.querySelector(`[data-chats="${w.id}"] .ch-msgs .msg.a a`); }, null, { timeout: 20000 }).catch(() => {});
    const s0 = await st();
    ok(s0.thread === 'qa_al_t', '1 thread with the app link is open', s0);
    await tapLink('Meditate');
    const s1 = await st();
    ok(s1.focusAppId === 'meditation' && s1.from, '1 app link opens the app on a desk that remembers the thread', s1);
    ok(s1.idx !== s0.idx, '1 the app opens on its own desk beside the thread', s1);
    await p.screenshot({ path: path.join(OUT, '1-app-open.png') });
    await back();
    const s2 = await st();
    ok(s2.idx === s0.idx && s2.thread === 'qa_al_t', '1 ONE Back lands on the same thread (not Home)', s2);
    // Bound views (12 Oct 2026): the app this reply links stays bound beside the thread until James leaves it.
    ok(s2.medOpen === 0 && s2.medBound === 1, '1 Back leaves no extra copy; the linked app stays bound beside the thread', s2);
    ok(await alive(), '1 Wizard still open');
    await p.screenshot({ path: path.join(OUT, '1-after-back.png') });

    // 2. Same again (no stale state); then a second link kind (relative) behaves the same.
    await tapLink('Meditate'); await back();
    const s3 = await st();
    ok(s3.thread === 'qa_al_t' && s3.medOpen === 0 && s3.medBound === 1, '2 repeat: open → Back → thread again', s3);
    await tapLink('Files'); const s4 = await st();
    ok(s4.focusAppId === 'files' && s4.from, '2 relative ?open= link carries the trail too', s4);
    await back(); const s5 = await st();
    ok(s5.thread === 'qa_al_t' && s5.idx === s0.idx, '2 Back from it returns to the thread', s5);

    // 3. Launcher path unchanged: opened from Apps, the app has no trail and Back goes Home.
    await p.evaluate(() => __wos.goDesk(0)); await sleep(500);
    await p.evaluate(() => window.WizCore.deeplink.route(location.pathname + '?open=meditation')); await sleep(1000);
    const s6 = await st();
    ok(s6.focusAppId === 'meditation' && !s6.from, '3 opened without a source link: a normal desk (no trail)', s6);
    await back(); const s7 = await st();
    ok(s7.idx === 0 && s7.medOpen === 1, '3 launcher-opened app: Back goes Home and the desk stays', s7);
  } catch (e) { ok(false, 'suite crashed', String(e).split('\n')[0]); }
  ok(!writes.some(w => /\/v1\/runs$/.test(w.p)), 'zero /v1/runs writes (nothing reached Archimedes)');
  ok(errs.length === 0, 'no page errors', errs.slice(0, 3));
  await b.close();
  console.log(`\napp-link-back: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
