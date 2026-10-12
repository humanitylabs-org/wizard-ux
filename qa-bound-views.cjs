// QA: bound views (feature/bound-views). A thread whose latest reply links the thing that was built opens that view
// on the desk beside the thread the moment the thread opens, out of view; the thread's right edge peeks into it.
// Tap or drag the edge tab → the view. On the view: amber review frame, "Open app", Back → the thread (view stays).
// Back to the list → the bound view closes. ✕ closes it for this reply; reopening the thread binds again.
//
// James, 12 Oct 2026: "as soon as I open the thread, I'm reading your response, but there's a view bound to it."
//
// Real Wizard reads; fixture threads merged into the session list; EVERY write is intercepted (zero reach Archimedes).
// Usage: node tools/qa-origin.cjs 9482 <tree>/web &  then  QA_WEB_DIR=<tree> node qa-bound-views.cjs [url]
let pw; try { pw = require('playwright-core'); } catch (e) { pw = require('/home/telos/node_modules/playwright'); }
const { chromium } = pw;
const fs = require('fs'), path = require('path');
const URL_ = process.argv[2] || 'http://127.0.0.1:9482/wizard-os-home/';
const WEB = process.env.QA_WEB_DIR || '';
const OUT = process.env.QA_OUT || '/home/telos/.hermes/cache/scratch/wos-bound-views-shots';
const EXEC = process.env.QA_CHROME || '/home/telos/.local/bin/google-chrome';
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === '' ? '' : JSON.stringify(extra).slice(0, 500)); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const origin = new URL(URL_).origin;

const now = Date.now() / 1000;
let rid = 1;
const row = (role, content, ts) => ({ id: rid++, session_id: '', role, content, timestamp: ts });
let appReply = 'Shipped. **Open it:** [Meditate](https://wizard.tailc0f369.ts.net/wizard-os-home/?open=meditation). The player now remembers where you left off. Or [open Meditate](/wizard-os-home/?open=meditation).';
const FIX = {
  qa_bv_app: { title: 'Meditate · Player', t: now - 20, rows: () => [row('user', 'Make the player remember my place', now - 300), row('assistant', appReply, now - 250)] },
  qa_bv_url: { title: 'Files · Preview', t: now - 30, rows: () => [row('user', 'Fix file previews', now - 300), row('assistant', 'Fixed. See it here: [Files](/files/). Thread ref [other](/wizard/?session=qa_bv_none).', now - 250)] },
  qa_bv_dl: { title: 'Wizard OS · Release', t: now - 35, rows: () => [row('user', 'Ship the menu', now - 300), row('assistant', 'Live. Open a thread: https://wizard.tailc0f369.ts.net/wizard-os-home/?open=chats\n\nIf it has not updated, download it here: https://wizard.tailc0f369.ts.net/reports/wizard-os/ or [the APK](/downloads/wizard-os/) or [Wizard Lock](/reports/wizard-lock/).', now - 250)] },
  qa_bv_dlview: { title: 'Files · After update', t: now - 36, rows: () => [row('user', 'Ship it', now - 300), row('assistant', 'Update first: [download](/reports/wizard-os/). Then look: [Files](/files/).', now - 250)] },
  qa_bv_none: { title: 'Research · Question', t: now - 40, rows: () => [row('user', 'What is DAPEL?', now - 300), row('assistant', 'A framework. No link here, and [GitHub](https://github.com/x/y) is outside.', now - 250)] },
  qa_bv_old: { title: 'Older link only', t: now - 50, rows: () => [row('user', 'a', now - 500), row('assistant', 'Earlier: [Files](/files/).', now - 450), row('user', 'b', now - 300), row('assistant', 'Latest reply has no link.', now - 250)] },
};
function fixSession(id) {
  const f = FIX[id], rows = f.rows(), last = rows[rows.length - 1], lastU = rows[0];
  return { id, source: 'wizard-mobile', title: f.title, status: 'completed', archived: false, hidden: false, message_count: rows.length,
    started_at: f.t - 600, last_active: f.t, wizard_last_user_at: lastU.timestamp, wizard_last_assistant_at: f.t, wizard_activity_at: f.t, wizard_run_id: '',
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
      writes.push({ m, p: u.pathname });
      if (u.pathname === '/wizard/thread-seen') { let st; try { st = JSON.parse(body).state; } catch (e) {} return json(200, { state: st || { initializedAt: Date.now(), threads: {} } }); }
      return json(200, { ok: true });
    }
    const LOCAL = { '/meditation/': 9420, '/files/': 8954 };
    for (const [pre, port] of Object.entries(LOCAL)) if (!process.env.QA_REAL_APPS && (u.pathname.startsWith(pre) || u.pathname === pre.slice(0, -1))) { const res = await r.fetch({ url: `http://127.0.0.1:${port}${u.pathname}${u.search}` }).catch(() => null); return res ? r.fulfill({ response: res }) : r.fulfill({ status: 200, contentType: 'text/html', body: `<body style="background:#123;color:#fff;font:20px sans-serif">${pre}</body>` }); }
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
  const ctx = await b.newContext({ viewport: { width: Number(process.env.QA_WIDTH) || 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true });
  await ctx.route('**/*', routeFor());
  const p = await ctx.newPage(); p.setDefaultTimeout(8000);
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); localStorage.setItem('wos.rvCoached', 'true'); } catch (e) {} });
  await p.goto(URL_, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__wos?.live?.ok && window.__wos.live.session('qa_bv_app'), null, { timeout: 90000 }).catch(() => {});
  ok(await p.evaluate(() => !!window.__wos?.live?.session('qa_bv_app')), 'thread list loaded with the fixture threads');
  const st = () => p.evaluate(() => {
    const d = __wos.desks[__wos.idx], f = __wos.wins[d?.focus];
    const chat = Object.values(__wos.wins).find(w => w.app === 'chats');
    const bound = Object.values(__wos.wins).filter(w => w.bound && __wos.desks.some(x => x.wins.includes(w.id)));
    const bd = bound[0] ? __wos.desks.findIndex(x => x.wins.includes(bound[0].id)) : -1;
    const cd = chat ? __wos.desks.findIndex(x => x.wins.includes(chat.id)) : -1;
    const edge = document.getElementById('boundEdge');
    return { idx: __wos.idx, cd, bd, nBound: bound.length, bAppId: bound[0]?.appId || '', bUrl: bound[0]?.url || '', bsid: bound[0]?.bsid || '',
      focusApp: f?.app, focusAppId: f?.appId || '', focusBound: !!f?.bound, thread: chat?.thread ?? null, desks: __wos.desks.length,
      edge: !!edge && !edge.hidden && getComputedStyle(edge).visibility !== 'hidden', peek: !!document.querySelector('.desk.bound-peek'),
      detached: Object.values(__wos.wins).filter(w => w.app === 'frame' && !w.bound && __wos.desks.some(x => x.wins.includes(w.id))).map(w => w.appId) };
  });
  const wid = () => p.evaluate(() => Object.values(__wos.wins).find(w => w.app === 'chats')?.id);
  const alive = () => p.evaluate(() => !!window.__wos && document.visibilityState === 'visible' && !!document.querySelector('.win'));
  const back = async () => { await p.keyboard.press('Escape'); await sleep(800); };
  async function openThread(id) {
    await p.evaluate(id => __wos.openWizardThread(id), id);
    await p.waitForFunction(id => { const w = Object.values(__wos.wins).find(x => x.app === 'chats'); return w?.thread === id && document.querySelector(`[data-chats="${w.id}"] .ch-msgs .msg.a`); }, id, { timeout: 20000 }).catch(() => {});
    await sleep(900);
  }
  async function tapEdge() { await p.locator('#boundEdge .be-tab').tap(); await sleep(900); }
  try {
    // 1. Open a thread whose latest reply links an app (?open=, written on the live host): bound beside, not in front.
    await openThread('qa_bv_app');
    const s1 = await st();
    ok(s1.thread === 'qa_bv_app', '1 thread is open', s1);
    ok(s1.nBound === 1 && s1.bAppId === 'meditation' && s1.bsid === 'qa_bv_app', '1 the linked app is bound to the thread', s1);
    ok(s1.bd === s1.cd + 1, '1 bound view sits on the desk right beside the thread', s1);
    ok(s1.idx === s1.cd && s1.focusApp === 'chats', '1 the thread stays in front (James reads the reply first)', s1);
    ok(s1.edge && s1.peek, '1 the edge tab and the peek of the next desk show', s1);
    await p.screenshot({ path: path.join(OUT, '1-thread-with-peek.png') });

    // 2. Tap the edge → the bound view, in review mode with Open app.
    await tapEdge();
    const s2 = await st();
    ok(s2.idx === s1.bd && s2.focusBound, '2 tapping the edge lands on the bound view', s2);
    ok(s2.edge && !s2.peek && await p.locator('#boundEdge.left').count() === 1, '2 bound view shows the matching left edge back to its thread', s2);
    ok(await p.locator('.desk.bound-chat-peek').count() === 1, '2 the chat panel peeks from the left');
    ok(await p.locator('[data-wact="menu"]').count() === 0, '2 three-dot window menu removed');
    // Exercise first-run coaching instead of pre-marking it seen.
    await p.evaluate(() => { localStorage.removeItem('wos.rvCoached'); const z = __wos.idx; __wos.goDesk(z - 1); __wos.goDesk(z); });
    await p.waitForTimeout(300);
    const coaching = await p.locator('.rv-card').innerText();
    ok(coaching.includes('Open app') && !/\bPin\b/.test(coaching) && coaching.includes('left edge'), '2 coach explains current Open app and shared edge', coaching);
    await p.locator('.rv-ok').tap(); await sleep(350);
    const bar = await p.evaluate(() => { const w = document.querySelector('.desk .win.bound'); return w ? { reviewing: w.classList.contains('reviewing'), open: !!w.querySelector('[data-wact="detach"]'), pin: !!w.querySelector('[data-wact="pin"]') } : null; });
    ok(bar && bar.reviewing && bar.open && !bar.pin, '2 view shows the amber review frame and "Open app" (no Pin)', bar);
    await sleep(800);
    await p.screenshot({ path: path.join(OUT, '2-bound-view.png') });

    // 3. Back on the view → the thread; the view stays bound beside it.
    await back();
    const s3 = await st();
    ok(s3.idx === s3.cd && s3.thread === 'qa_bv_app', '3 Back on the view returns to the thread', s3);
    ok(s3.nBound === 1 && s3.bd === s3.cd + 1 && s3.edge, '3 the view is still bound beside the thread', s3);
    ok(await alive(), '3 Wizard still open');

    // 4. Drag the edge left → lands on the view.
    const box = await p.locator('#boundEdge .be-tab').boundingBox();
    const cdp = await ctx.newCDPSession(p);
    const tp = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    let x = box.x + box.width / 2, y = box.y + box.height / 2;
    await tp('touchStart', x, y); for (let k = 0; k < 8; k++) { x -= 18; await tp('touchMove', x, y); await sleep(16); } await tp('touchEnd'); await sleep(900);
    const s4 = await st(); if (!s4.focusBound) { await p.screenshot({ path: path.join(OUT, '4-fail.png') }); console.log('msgs', await p.evaluate(() => document.querySelector('.ch-msgs')?.innerText.slice(0, 300))); }
    ok(s4.idx === s3.bd && s4.focusBound, '4 dragging the edge left lands on the view', s4, s4);
    await back();

    // Match the new left edge: tap and real finger drag both return to the thread.
    await tapEdge(); await tapEdge();
    ok((await st()).focusApp === 'chats', '4 left edge tap returns to chat');
    await tapEdge();
    const lb = await p.locator('#boundEdge.left .be-tab').boundingBox();
    x = lb.x + lb.width / 2; y = lb.y + lb.height / 2;
    await tp('touchStart', x, y); for (let k = 0; k < 8; k++) { x += 18; await tp('touchMove', x, y); await sleep(25); } await tp('touchEnd'); await sleep(900);
    ok((await st()).focusApp === 'chats', '4 dragging the left edge right returns to chat');
    await tapEdge();
    const cb = await p.locator('#boundEdge.left .be-tab').boundingBox();
    x = cb.x + cb.width / 2; y = cb.y + cb.height / 2;
    await tp('touchStart', x, y); await tp('touchMove', x + 50, y); await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }); await sleep(700);
    ok((await st()).focusBound, '4 cancelled left-edge drag preserves bound view');
    await p.evaluate(() => history.back()); await sleep(900);
    ok((await st()).focusApp === 'chats' && await alive(), '4 browser Back returns to thread and Wizard stays open');

    // 5. Tapping the link in the thread goes to the same bound view (no second copy).
    await p.locator(`[data-chats="${await wid()}"] .ch-msgs .msg.a a`, { hasText: 'open Meditate' }).last().tap(); await sleep(1000);
    const s5 = await st();
    ok(s5.focusBound && s5.nBound === 1 && !s5.detached.includes('meditation'), '5 tapping the link opens the bound view, no duplicate', s5);

    // 6. Open app → a normal copy on its own desk; the bound view stays with the thread.
    await p.locator('.win.bound [data-wact="detach"]').tap(); await sleep(1000);
    const s6 = await st();
    ok(s6.detached.includes('meditation') && s6.nBound === 1, '6 Open app keeps a normal copy and the bound view', s6);
    ok(s6.focusApp === 'frame' && !s6.focusBound, '6 the normal copy is in front', s6);
    await p.evaluate(() => __wos.goDesk(__wos.desks.findIndex(d => d.wins.some(id => __wos.wins[id].app === 'chats')))); await sleep(700);

    // 7. Back from the thread to the list → bound view closes; detached copy stays; app still open.
    await back();
    const s7 = await st();
    ok(s7.thread === null && s7.nBound === 0, '7 leaving the thread closes its bound view', s7);
    ok(s7.detached.includes('meditation'), '7 the Open-app copy stays open', s7);
    ok(!s7.edge && !s7.peek, '7 no edge on the list', s7);
    ok(await alive(), '7 Wizard still open (Back never exits)');
    await p.evaluate(() => { for (const [id, w] of Object.entries(__wos.wins)) if (w.app === 'frame') __wos.closeWin(id); }); await sleep(600);
    await p.evaluate(() => __wos.goDesk(__wos.desks.findIndex(d => d.wins.some(id => __wos.wins[id].app === 'chats')))); await sleep(500);

    // 8. A plain path link binds as a page; a thread with no in-app link, only an older one, or only external links does not.
    await openThread('qa_bv_url'); const s8 = await st();
    ok(s8.nBound === 1 && s8.bAppId === 'link' && s8.bUrl === '/files/', '8 a plain in-app path binds as a page (session refs skipped)', s8);
    await openThread('qa_bv_dl'); const sdl = await st();
    ok(sdl.nBound === 0 && !sdl.edge, '8 a release reply binds no view (Wizard OS download / update / install pages are not views)', sdl);
    await openThread('qa_bv_dlview'); const sdv = await st();
    ok(sdv.nBound === 1 && sdv.bUrl === '/files/', '8 after a download link, the real view in the same reply still binds', sdv);
    await openThread('qa_bv_none'); const s9 = await st();
    ok(s9.nBound === 0 && !s9.edge, '8 switching to a thread with no in-app link drops the old binding', s9);
    await openThread('qa_bv_old'); const s10 = await st();
    ok(s10.nBound === 0, '8 only the latest reply binds (an older link does not)', s10);

    // 9. ✕ on the bound view closes it for this reply; re-render does not rebind; leaving and reopening binds again.
    await openThread('qa_bv_app'); await tapEdge();
    await p.locator('.win.bound [data-wact="close"]').tap(); await sleep(900);
    const s11 = await st();
    ok(s11.nBound === 0 && s11.idx === s11.cd, '9 ✕ closes the view and lands on the thread', s11);
    await p.evaluate(() => { const w = Object.values(__wos.wins).find(x => x.app === 'chats'); __wos.renderChats(w); }); await sleep(800);
    ok((await st()).nBound === 0, '9 a re-render keeps it closed for this reply');
    await back(); await openThread('qa_bv_app');
    ok((await st()).nBound === 1, '9 opening the thread again binds it again');

    // 10. A new reply with a new link, while James is on the thread, swaps the bound view.
    appReply = 'Second pass. Now see [Files](/files/).';
    await p.evaluate(async () => { const w = Object.values(__wos.wins).find(x => x.app === 'chats'); __wos.chatState(w.id).loadedFor = ''; await __wos.chats.loadThread?.(w, true); __wos.renderChats(w); });
    await p.waitForFunction(() => Object.values(__wos.wins).some(w => w.bound && w.appId === 'link'), null, { timeout: 8000 }).catch(() => {});
    const s12 = await st();
    ok(s12.nBound === 1 && s12.bUrl === '/files/', '10 a new reply with a new link rebinds to it', s12);

    // 11. Reload: no orphan bound desks survive without their thread open.
    await back(); await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__wos?.live?.ok, null, { timeout: 60000 }).catch(() => {}); await sleep(1500);
    ok((await st()).nBound === 0, '11 after reload, no orphan bound views');
  } catch (e) { ok(false, 'run threw', String(e.stack || e)); }
  ok(errs.length === 0, 'no page errors', errs);
  ok(writes.every(w => /thread-seen|thread-dispositions|telemetry|log/.test(w.p)), 'no writes beyond seen/disposition state', writes.slice(0, 6));
  console.log(`\n${pass} passed, ${fail} failed · shots in ${OUT}`);
  await b.close(); process.exit(fail ? 1 : 0);
})();
