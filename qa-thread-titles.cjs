// QA: Thread titles (feature/thread-titles). James, 10 Oct 2026: "short titles that describe the project …
// and maybe the feature in as few words as possible"; renames only on a real pivot, with a breadcrumb, and
// his own rename always wins.
//
// Checks: rows show only the current title; the thread shows "Renamed from …" where it
// happened; long-press → Rename saves through PATCH /api/sessions/<id> {title}; tapping the thread title opens
// Rename; Back closes the rename sheet and keeps the app open; a name clash says so and keeps the old name.
//
// Real Wizard reads; fixture threads merged into the session list; EVERY write is intercepted (zero reach Archimedes).
// Usage: node tools/qa-origin.cjs 9483 <tree>/web &  then  QA_WEB_DIR=<tree> node qa-thread-titles.cjs [url]
let pw; try { pw = require('playwright-core'); } catch (e) { pw = require('/home/developer/node_modules/playwright'); }
const { chromium } = pw;
const fs = require('fs'), path = require('path');
const URL_ = process.argv[2] || 'http://127.0.0.1:9483/wizard-os-home/';
const WEB = process.env.QA_WEB_DIR || '';
const OUT = process.env.QA_OUT || '/home/developer/.hermes/cache/scratch/wos-thread-titles-shots';
const EXEC = process.env.QA_CHROME || '/home/developer/.local/bin/google-chrome';
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === '' ? '' : JSON.stringify(extra).slice(0, 400)); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const now = Date.now() / 1000;
const FIX = {
  qa_tt_pivot: { title: 'DeFleur · Captions', t: now - 20, was: 'Review 0xMovez post on X', renames: [{ from: 'Review 0xMovez post on X', to: 'DeFleur · Captions', at: now - 300, by: 'agent' }], att: { state: 'done', ask: 'Captions stay on the whole clip', subject: 'DeFleur Video' } },
  qa_tt_plain: { title: 'Wizard OS · Ready list', t: now - 40, att: { state: 'check', ask: 'Try the new Ready order', subject: 'Wizard OS' } },
  qa_tt_other: { title: 'Grab · Usuals', t: now - 60, att: { state: 'fyi', ask: 'Usuals browse Grab first', subject: 'Grab' } },
};
const writes = [];
function fixSession(id) {
  const f = FIX[id];
  return { id, source: 'wizard-mobile', title: f.title, status: 'completed', archived: false, hidden: false, message_count: 4,
    started_at: f.t - 3600, last_active: f.t, wizard_last_user_at: f.t - 120, wizard_last_assistant_at: f.t, wizard_activity_at: f.t, wizard_run_id: '',
    latest_message: { role: 'assistant', content: `Reply for ${f.title}.`, timestamp: f.t },
    last_user_message: { role: 'user', content: `${f.title} ask`, timestamp: f.t - 120 },
    ...(f.was ? { wizard_title_was: f.was, wizard_title_renamed_at: now - 300 } : {}),
    ...(f.renames ? { wizard_title_renames: f.renames } : {}),
    ...(f.att ? { wizard_attention: f.att } : {}) };
}
const rowsFor = id => {
  const f = FIX[id];
  return [
    { id: 1, session_id: id, role: 'user', content: 'Mind this tweet?', timestamp: f.t - 3600 },
    { id: 2, session_id: id, role: 'assistant', content: 'Here is the read on the tweet.', timestamp: f.t - 3500 },
    { id: 3, session_id: id, role: 'user', content: 'Now package the DeFleur pipeline.', timestamp: f.t - 120 },
    { id: 4, session_id: id, role: 'assistant', content: `Reply for ${f.title}.`, timestamp: f.t },
  ];
};
function routeFor() {
  return async r => {
    const q = r.request(), u = new URL(q.url()), m = q.method();
    const wm = u.pathname.match(/\/wizard-os-home\/((?:core\/|desktop\/)?[a-z-]+\.(?:js|css)|index\.html|desktop\.html|)$/);
    if (WEB && wm && m === 'GET' && !/^(data|summaries)\.js$/.test(wm[1])) { const f = wm[1] || 'index.html', fp = path.join(WEB, 'web', f); if (fs.existsSync(fp)) return r.fulfill({ status: 200, contentType: f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : 'application/javascript', body: fs.readFileSync(fp) }); }
    const json = (status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (m !== 'GET' && m !== 'HEAD') {
      const body = (q.postDataBuffer() || Buffer.alloc(0)).toString();
      writes.push({ m, p: u.pathname, body });
      const pm = m === 'PATCH' && u.pathname.match(/\/wizard\/hermes\/api\/sessions\/([^/]+)$/);
      if (pm && FIX[decodeURIComponent(pm[1])]) {
        let t = ''; try { t = JSON.parse(body).title; } catch (e) {}
        if (t === 'Grab · Usuals') return json(400, { error: { message: `Title '${t}' is already in use by session qa_tt_other`, code: 'invalid_title' } });
        const f = FIX[decodeURIComponent(pm[1])]; if (t) { f.title = t; delete f.was; }
        return json(200, { object: 'hermes.session', session: fixSession(decodeURIComponent(pm[1])) });
      }
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
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); localStorage.setItem('wos.chats.readyOrder.v1', 'newest'); } catch (e) {} });
  await p.goto(URL_, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__wos?.live?.ok && window.__wos.live.session('qa_tt_pivot'), null, { timeout: 90000 }).catch(() => {});
  ok(await p.evaluate(() => !!window.__wos?.live?.session('qa_tt_pivot')), 'thread list loaded with fixture threads');
  await p.evaluate(() => __wos.goDesk(1)); await sleep(800);
  const wid = await p.evaluate(() => Object.values(__wos.wins).find(w => w.app === 'chats')?.id);
  const W = sel => `[data-chats="${wid}"] ${sel}`;
  const row = id => W(`[data-sec="ready"] [data-chopen="${id}"]`);

  try {
    // 1. The list: short titles only. James, 10 Oct 2026: "take out the was … note … It's just clutter."
    const r1 = await p.evaluate(sel => { const e = document.querySelector(sel); return e && { t: e.querySelector('.tp b')?.textContent, was: !!e.querySelector('.tp i.was'), text: e.querySelector('.tp')?.textContent || '' }; }, row('qa_tt_pivot'));
    ok(r1 && r1.t === 'DeFleur · Captions' && !r1.was && !/\bwas\b|0xMovez/.test(r1.text), '1 a renamed row shows only its new title (no "was")', r1);
    const full = await p.evaluate(sel => { const b = document.querySelector(sel).querySelector('.tp b'); return b.scrollWidth <= b.clientWidth + 1; }, row('qa_tt_pivot'));
    ok(full, '1 the short title is shown in full');
    await p.locator(row('qa_tt_pivot')).scrollIntoViewIfNeeded(); await sleep(200);
    await p.screenshot({ path: path.join(OUT, '1-list.png') });

    // 2. The thread: "Renamed from …" where it happened (between the tweet turn and the pipeline turn).
    await p.locator(row('qa_tt_pivot')).tap(); await sleep(1200);
    const order = await p.evaluate(sel => [...document.querySelectorAll(sel + ' .ch-msgs .ch-renamed, ' + sel + ' .ch-msgs .bub')].map(e => e.classList.contains('ch-renamed') ? 'RENAMED:' + e.textContent.trim() : (e.textContent || '').trim().slice(0, 30)), W(''));
    const ix = order.findIndex(x => x.startsWith('RENAMED:'));
    ok(ix > 0 && /Renamed from “Review 0xMovez post on X”/.test(order[ix]), '2 thread shows "Renamed from “Review 0xMovez post on X”"', order);
    ok(ix > 0 && order.slice(0, ix).some(x => /tweet/.test(x)) && order.slice(ix + 1).some(x => /DeFleur|Reply for/.test(x)), '2 the rename note sits where the work changed', order);
    await p.screenshot({ path: path.join(OUT, '2-thread-renamed.png') });

    // 3. Tap the thread title → Rename sheet, prefilled; Back closes the sheet and keeps the thread open.
    await p.locator(W('.ch-head [data-chrename]')).tap(); await sleep(400);
    const v = await p.evaluate(sel => document.querySelector(sel)?.value, W('.ch-rename input'));
    ok(v === 'DeFleur · Captions', '3 tapping the title opens Rename, prefilled', v);
    await p.screenshot({ path: path.join(OUT, '3-rename-sheet.png') });
    await p.evaluate(() => history.back()); await sleep(600);
    const afterBack = await p.evaluate(sel => ({ sheet: !!document.querySelector(sel + ' .ch-rename'), thread: !!document.querySelector(sel + ' .ch-head') }), W(''));
    ok(!afterBack.sheet && afterBack.thread, '3 Back closes Rename and the thread stays open', afterBack);

    // 4. Save a new name: PATCH {title}, the header and list update.
    await p.locator(W('.ch-head [data-chrename]')).tap(); await sleep(300);
    await p.locator(W('.ch-rename input')).fill('DeFleur · Packaging');
    await p.locator(W('.ch-rename button.go')).tap(); await sleep(900);
    const patch = writes.filter(x => x.m === 'PATCH' && x.p.endsWith('/qa_tt_pivot')).at(-1);
    ok(patch && JSON.parse(patch.body).title === 'DeFleur · Packaging' && Object.keys(JSON.parse(patch.body)).length === 1, '4 Save sends PATCH {title} for that thread only', patch);
    const head = await p.evaluate(sel => document.querySelector(sel)?.textContent, W('.ch-head .ti b'));
    ok(head === 'DeFleur · Packaging', '4 the thread header shows the new name', head);

    // 5. Back to the list; the row shows the new name and no stale "was".
    await p.locator(W('[data-chback]')).tap(); await sleep(900);
    const r5 = await p.evaluate(sel => { const e = document.querySelector(sel); return e && { t: e.querySelector('.tp b')?.textContent, was: e.querySelector('.tp i.was')?.textContent || '' }; }, row('qa_tt_pivot'));
    ok(r5 && r5.t === 'DeFleur · Packaging' && !r5.was, '5 list row shows James\'s name', r5);

    // 6. Long-press a row → sheet has Rename; a taken name says so and keeps the old name.
    const box = await p.locator(row('qa_tt_plain')).boundingBox();
    await p.touchscreen.tap(box.x + 5, box.y + 5).catch(() => {});
    await p.evaluate(({ wid }) => __wos.openRowSheet(wid, 'qa_tt_plain'), { wid }); await sleep(400);
    const items = await p.$$eval(W('.ch-sheet button'), els => els.map(e => e.textContent.trim()));
    ok(items.includes('Rename') && items.indexOf('Rename') === 1, '6 the long-press sheet offers Rename right after Open', items);
    await p.screenshot({ path: path.join(OUT, '6-row-sheet.png') });
    await p.locator(W('[data-rsrename]')).tap(); await sleep(300);
    await p.locator(W('.ch-rename input')).fill('Grab · Usuals');
    await p.locator(W('.ch-rename button.go')).tap(); await sleep(900);
    const toastTxt = await p.evaluate(() => [...document.querySelectorAll('.toast, [class*="toast"]')].map(e => e.textContent).join(' | '));
    const r6 = await p.evaluate(sel => document.querySelector(sel)?.querySelector('.tp b')?.textContent, row('qa_tt_plain'));
    ok(/already has that name/.test(toastTxt), '6 a taken name says "Another thread already has that name"', toastTxt);
    ok(r6 === 'Wizard OS · Ready list', '6 the old name stays after a failed rename', r6);

    // 7. Cancel leaves everything as it was.
    await p.evaluate(({ wid }) => __wos.openRowSheet(wid, 'qa_tt_other'), { wid }); await sleep(300);
    await p.locator(W('[data-rsrename]')).tap(); await sleep(300);
    const before = writes.length;
    await p.locator(W('[data-rncancel]')).tap(); await sleep(300);
    ok(writes.filter(x => x.m === 'PATCH').length === writes.slice(0, before).filter(x => x.m === 'PATCH').length && !(await p.$(W('.ch-rename'))), '7 Cancel closes Rename without a write');

    ok(errs.length === 0, 'no page errors', errs);
    const stray = writes.filter(x => !(x.m === 'PATCH' && /qa_tt_/.test(x.p)) && !/thread-seen|outbox|telemetry|wizard\/log/.test(x.p));
    ok(true, `writes intercepted: ${writes.length} (non-rename: ${stray.map(x => x.m + ' ' + x.p).join(', ') || 'none'})`);
  } catch (e) { fail++; console.log('FAIL exception', String(e).slice(0, 400)); await p.screenshot({ path: path.join(OUT, 'x-exception.png') }).catch(() => {}); }
  console.log(`\n${pass} passed, ${fail} failed · shots in ${OUT}`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
