// QA: Wizard UX chat polish (feature/chat-polish), phone + desktop shells, against a fully faked Wizard.
//   #26 search message bodies (lazy, capped, cancellable) with highlighted snippets
//   #27 offline / reconnecting / back-online banner; fatal-error card with Reload (and Back closes it)
//   #28 deep links ?session= ?view= ?video= open in-app; Back: thread → Chats list → Home, never leaves
//   #29 desktop split view: side by side, resizable (drag/keys, persisted), keyboard through the list
//   #30 voice transcription provider card in Settings (read-only /wizard/voice/status)
//   #31 critical-issue banner on every screen (legacy attention.ts rules)
//   #32 Chats window title shows the thread's name (phone title bar, desktop title bar + document.title)
//   #33 Drafts section for unsent new chats (rotate, reopen, discard, survives reload)
// Usage: QA_WEB_DIR=<worktree> node qa-chat-polish.cjs   (self-contained: every request is routed, nothing leaves)
// Negative control: QA_WEB_DIR=<release/parity-0.7 checkout> node qa-chat-polish.cjs must FAIL.
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const ORIGIN = require('./tools/qa-paths.cjs').origin(), BASE = ORIGIN + '/wizard-os-home/';
const WEB = process.env.QA_WEB_DIR || __dirname;
const SHOTS = process.env.QA_SHOTS || require('./tools/qa-paths.cjs').workPath('wizard-audit/shots/chat-polish');
fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, typeof extra === 'string' ? extra : JSON.stringify(extra)); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- the fake Wizard ---------------- */
const NOW = Date.now(), MIN = 6e4;
const VIDEO_ID = '0123456789abcdef0123456789abcdef';
const W = {
  writes: [], foreign: [], msgFetch: [], down: false, voice: 'ok', brokenApp: false,
  threads: Array.from({ length: 45 }, (_, i) => ({ id: 'qa_t' + String(i).padStart(2, '0'), title: `Thread ${i}`, preview: `Preview line ${i}`, at: NOW - (i * 10 + 2) * MIN, status: 'completed', level: '' })),
};
W.threads[5].title = 'Quokka budget review';
W.threads[1].title = 'Disk almost full'; W.threads[1].level = 'critical';
W.threads[2].status = 'failed'; W.threads[2].level = 'critical'; // an error card already: not in the banner
const BODY = {
  qa_t03: 'Here is the zebracorn migration plan we discussed: phase one moves the archive, phase two the index.',
  qa_t40: 'Older note: the zebracorn idea came up first in this thread.',
  qa_t08: `Open the other one here: [that thread](${BASE}?session=qa_t09) and carry on.`,
};
function sessionRow(t) {
  return { id: t.id, title: t.title, status: t.status, message_count: 2, last_active: new Date(t.at).toISOString(), wizard_activity_at: new Date(t.at).toISOString(),
    wizard_last_assistant_at: new Date(t.at).toISOString(), latest_message: { role: 'assistant', content: t.preview, timestamp: t.at / 1000 }, wizard_attention_level: t.level || undefined };
}
function messages(id) {
  const t = W.threads.find(x => x.id === id); const at = (t ? t.at : NOW) / 1000;
  return [{ id: 1, role: 'user', content: `Question for ${id}`, timestamp: at - 60 }, { id: 2, role: 'assistant', content: BODY[id] || `Plain answer in ${id}.`, timestamp: at }];
}
const SHELL = { '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.js': 'application/javascript' };

async function context(b, { desktop = false } = {}) {
  const ctx = await b.newContext(desktop
    ? { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true }
    : { viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true });
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url()), m = q.method();
    if (u.origin !== ORIGIN) { W.foreign.push(u.href); return r.abort(); }
    const json = (o, s = 200) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
    const sh = u.pathname.match(/^\/wizard-os-home\/(.*)$/);
    if (sh && (m === 'GET' || m === 'HEAD')) {
      const f = sh[1] || 'index.html', p = path.join(WEB, 'web', f);
      if (W.brokenApp && f === 'app.js') return r.fulfill({ status: 200, contentType: 'application/javascript', body: "throw new Error('QA broke the shell on purpose');" });
      if (!fs.existsSync(p) || /^(data|summaries)\.js$/.test(f)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      return r.fulfill({ status: 200, contentType: SHELL[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(p) });
    }
    if (m !== 'GET' && m !== 'HEAD') {
      W.writes.push(`${m} ${u.pathname}`);
      if (u.pathname === '/wizard/thread-seen') return json({ state: JSON.parse(q.postData() || '{}').state || { initializedAt: NOW, threads: {} } });
      return json({ error: 'qa: write refused' }, 403);
    }
    if (u.pathname === '/wizard/v1/bootstrap') return json({ bootstrap: 1, api: 'wizard-agent-service/1', settings: { owner: { name: 'Robin', place: '' }, agent: { name: 'Merlin' }, clock: { timezone: 'UTC', day_starts_at: '06:00' }, voice: { language: 'en', vocabulary: [] } },
      capabilities: { voice: true, router: true, files: true, approvals: true, steer: true, markdown: true }, endpoints: { sessions: '/wizard/hermes/api/sessions', runs: '/wizard/hermes/v1/runs', transcribe: '/wizard/voice/transcribe', route: '/wizard/v1/route', upload: '/wizard/files/upload', apps: '/wizard/v1/apps' } });
    if (u.pathname === '/wizard/voice/status') return W.voice === 'ok' ? json({ ready: true, provider: 'tinfoil', name: 'Tinfoil', model: 'voxtral-small-24b', attested: true }) : json({ error: 'down' }, 503);
    if (u.pathname === '/wizard/hermes/api/sessions') {
      if (W.down) return json({ error: 'unavailable' }, 503);
      const off = +(u.searchParams.get('offset') || 0), lim = +(u.searchParams.get('limit') || 100);
      const rows = W.threads.slice(off, off + lim).map(sessionRow);
      return json({ data: rows, has_more: off + lim < W.threads.length });
    }
    const mm = u.pathname.match(/^\/wizard\/hermes\/api\/sessions\/([^/]+)\/messages$/);
    if (mm) {
      const id = decodeURIComponent(mm[1]); W.msgFetch.push({ id, order: u.searchParams.get('order'), limit: u.searchParams.get('limit') });
      await sleep(u.searchParams.get('order') === 'latest' ? 120 : 10); // body search is slow enough to cancel
      return json({ object: 'list', data: messages(id), pagination: { returned: 2 } }).catch(() => {});
    }
    const sm = u.pathname.match(/^\/wizard\/hermes\/api\/sessions\/([^/]+)$/);
    if (sm) { const t = W.threads.find(x => x.id === decodeURIComponent(sm[1])); return t ? json({ session: sessionRow(t) }) : json({ error: 'not_found' }, 404); }
    if (u.pathname === `/wizard/attachments/${VIDEO_ID}`) return r.fulfill({ status: 200, headers: { 'content-type': 'video/mp4', 'content-disposition': 'inline; filename="qa-clip.mp4"' }, body: m === 'HEAD' ? '' : Buffer.alloc(64) });
    if (u.pathname.startsWith('/wizard/attachments/')) return json({ error: 'not_found' }, 404);
    if (u.pathname === '/wizard/thread-seen') return json({ state: { initializedAt: NOW - 864e5, threads: {} } });
    if (u.pathname === '/wizard/thread-dispositions') return json({ state: {} });
    if (u.pathname === '/wizard/v1/apps') return json({ apps: [] });
    return json({});
  });
  await ctx.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); } catch (e) {} });
  return ctx;
}
async function page(ctx, url) {
  const p = await ctx.newPage(); p.errs = []; p.setDefaultTimeout(6000);
  p.on('pageerror', e => p.errs.push(String(e)));
  await p.goto(ORIGIN + '/qa-start').catch(() => {}); // a page before ours, so a wrong Back would really leave
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  return p;
}
const shot = (p, n) => p.screenshot({ path: path.join(SHOTS, n + '.png') }).catch(() => {});
const ours = p => p.url().startsWith(BASE);

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader'] });

  /* =============================== PHONE =============================== */
  const ctx = await context(b);
  let p = await page(ctx, BASE + '?session=qa_t07');
  await p.waitForFunction(() => window.__wos?.live?.ok, null, { timeout: 30000 }).catch(() => {});
  await sleep(900);
  const chatsWin = () => p.evaluate(() => Object.values(__wos.wins).find(w => w.app === 'chats') || null);
  const back = async () => { await p.keyboard.press('Escape'); await sleep(450); };

  /* ---- #28 deep link to a thread (phone) ---- */
  try {
    const w = await chatsWin();
    ok(w?.thread === 'qa_t07', '#28 ?session= opens that thread in a Chats window', w);
    ok(await p.evaluate(() => !location.search.includes('session=')), '#28 the session param is taken out of the address bar', p.url());
    ok((await p.evaluate(() => window.__deeplinkLog || [])).includes('session:qa_t07'), '#28 it went through the shared deep-link path');
    // #32 title bar shows the thread's name
    const wt = await p.evaluate(id => document.querySelector(`.win[data-win="${id}"] .wbar .wt`)?.textContent, w?.id);
    ok(wt === 'Thread 7', '#32 phone title bar shows the thread name', wt);
    await shot(p, 'phone-deeplink-thread');
    await back();
    ok((await chatsWin())?.thread === null && ours(p), '#28 Back from the deep-linked thread → Chats list, app still open');
    const wt2 = await p.evaluate(id => document.querySelector(`.win[data-win="${id}"] .wbar .wt`)?.textContent, w?.id);
    ok(wt2 === 'Chats', '#32 title bar says Chats on the list', wt2);
    await back();
    ok(await p.evaluate(() => __wos.idx === __wos.HOME) && ours(p), '#28 next Back → Home, app still open');
    await back();
    ok(ours(p) && await p.evaluate(() => !!window.__wos), '#28 Back at Home stays in the app (exit warning only)');
    const log = await p.evaluate(() => __wos.back.log.slice(-3));
    ok(JSON.stringify(log) === JSON.stringify(['thread', 'home', 'exit-warn']), '#28 Back steps were thread → home → warn', log);
    // native shell path: same handoff as the Android ACTION_THREAD intent
    await p.evaluate(() => __wos.openWizardThread('qa_t07'));
    await sleep(300);
    const nb = await p.evaluate(() => [window.__wosNativeBack(), window.__wosNativeBack(), window.__wosNativeBack()]);
    ok(JSON.stringify(nb) === JSON.stringify(['thread', 'home', 'root']), '#28 native Back: thread → home → root (never exits)', nb);
  } catch (e) { ok(false, 'section crashed (continuing)', String(e).split('\n')[0]); }

  /* ---- #28 ?view= and ?video= (phone) ---- */
  try {
    await p.goto(BASE + '?view=inbox', { waitUntil: 'domcontentloaded' }); await p.waitForFunction(() => window.__wos?.live?.ok, null, { timeout: 20000 }).catch(() => {}); await sleep(600);
    ok(await p.evaluate(() => (() => { const d = __wos.desks[__wos.idx], w = __wos.wins[d.focus]; return !__wos.sheet && w?.app === 'chats' && !w.thread; })()), '#28 ?view=inbox opens the Chats list (the notifications panel is retired)');
    await back();
    ok(await p.evaluate(() => __wos.sheet === null) && ours(p), '#28 Back closes the deep-linked Inbox, app stays');
    await p.goto(BASE + '?view=work&section=archive', { waitUntil: 'domcontentloaded' }); await p.waitForFunction(() => window.__wos?.live?.ok, null, { timeout: 20000 }).catch(() => {}); await sleep(900);
    const arch = await p.evaluate(() => { const w = Object.values(__wos.wins).find(x => x.app === 'chats'); const el = document.querySelector(`.win[data-win="${w?.id}"] [data-sec="archive"]`); return { focus: __wos.desks[__wos.idx].focus === w?.id, open: !!el?.classList.contains('open'), thread: w?.thread }; });
    ok(arch.focus && arch.open && arch.thread === null, '#28 ?view=work&section=archive opens Chats at the Archive section', arch);
    await p.goto(BASE + '?view=settings', { waitUntil: 'domcontentloaded' }); await sleep(1200);
    ok(await p.evaluate(() => __wos.sheet === 'settings'), '#28 ?view=settings opens Settings');
    /* ---- #30 voice provider card ---- */
    await p.waitForFunction(() => document.querySelector('[data-voicecard="ready"]'), null, { timeout: 8000 }).catch(() => {});
    const card = await p.evaluate(() => { const c = document.querySelector('#settingsBody [data-voicecard]'); return c ? { state: c.dataset.voicecard, text: c.textContent, badge: !!c.querySelector('[data-voiceattested]') } : null; });
    ok(card?.state === 'ready' && /Tinfoil/.test(card.text) && /voxtral-small-24b/.test(card.text) && card.badge, '#30 Settings shows the transcription provider, model and attested badge', card);
    ok(/Voice transcription/.test(card?.text || ''), '#30 the card is titled Voice transcription');
    await p.evaluate(() => document.querySelector('#settingsBody [data-voicecard]')?.scrollIntoView({ block: 'center' })); await sleep(200);
    await shot(p, 'phone-settings-voice-card');
    ok(!W.writes.some(w => /voice/.test(w)), '#30 the card is read-only (no writes to voice)');
    await back();
    W.voice = 'down';
    await p.evaluate(() => window.WizCore.voiceStatus.load()); await p.evaluate(() => __wos.openSettings()); await sleep(400);
    const down = await p.evaluate(() => { const c = document.querySelector('#settingsBody [data-voicecard]'); return c ? { state: c.dataset.voicecard, text: c.textContent } : null; });
    ok(down?.state === 'down' && /Voice unavailable/.test(down.text), '#30 a failing status endpoint shows Voice unavailable', down);
    W.voice = 'ok'; await back();
    // ?video=
    await p.goto(BASE + `?video=${VIDEO_ID}`, { waitUntil: 'domcontentloaded' }); await sleep(1500);
    const vs = await p.evaluate(() => __wos.viewer);
    ok(vs.open && vs.kind === 'video' && /qa-clip\.mp4/.test(vs.name), '#28 ?video= plays the attachment in the in-app viewer', vs);
    ok(await p.evaluate(() => !!document.querySelector('.mviewer:not([hidden]) video')), '#28 the viewer holds a <video> element');
    await shot(p, 'phone-deeplink-video');
    await back();
    ok(await p.evaluate(() => !__wos.viewer.open) && ours(p), '#28 Back closes the video, app stays');
    await p.goto(BASE + '?video=ffffffffffffffffffffffffffffffff', { waitUntil: 'domcontentloaded' }); await sleep(1200);
    ok(await p.evaluate(() => !__wos.viewer.open), '#28 an unknown/non-video id does not open the viewer');
    await p.goto(BASE + '?video=../../etc', { waitUntil: 'domcontentloaded' }); await sleep(600);
    ok(!W.msgFetch.some(f => /etc/.test(f.id)) && await p.evaluate(() => !__wos.viewer.open), '#28 a malformed ?video= is ignored');
  } catch (e) { ok(false, 'section crashed (continuing)', String(e).split('\n')[0]); }

  /* ---- #28 a link to this app inside a message opens in place ---- */
  try {
    await p.goto(BASE, { waitUntil: 'domcontentloaded' }); await p.waitForFunction(() => window.__wos?.live?.ok, null, { timeout: 20000 }).catch(() => {}); await sleep(500);
    await p.evaluate(() => __wos.openWizardThread('qa_t08'));
    await p.waitForSelector('.ch-msgs a[href*="session=qa_t09"]', { timeout: 10000 }).catch(() => {});
    const before = p.url();
    await p.click('.ch-msgs a[href*="session=qa_t09"]').catch(() => {}); await sleep(600);
    ok((await chatsWin())?.thread === 'qa_t09' && p.url() === before && (await p.context().pages()).length === 1, '#28 a message link to ?session= opens that thread in-app (no reload, no new tab)', { url: p.url(), w: await chatsWin() });
    await back(); await back();
  } catch (e) { ok(false, 'section crashed (continuing)', String(e).split('\n')[0]); }

  /* ---- #26 body search ---- */
  try {
    await p.evaluate(() => __wos.openWizardThread('qa_t00')); await sleep(300); await back(); // Chats list in front
    const wid = (await chatsWin()).id;
    const sel = `.win[data-win="${wid}"] [data-chsearch]`;
    W.msgFetch.length = 0;
    await p.fill(sel, 'quokka'); await sleep(80);
    const instant = await p.evaluate(id => [...document.querySelectorAll(`.win[data-win="${id}"] .ch-row[data-chopen]`)].map(r => r.dataset.chopen), wid);
    ok(instant.length === 1 && instant[0] === 'qa_t05' && W.msgFetch.filter(f => f.order === 'latest').length === 0, '#26 titles match instantly, before any message is read', instant);
    // cancel: start a body search, change the query mid-flight
    await p.fill(sel, 'zebrac'); await sleep(450);
    await p.fill(sel, 'zebracorn'); await sleep(60);
    const st0 = await p.evaluate(() => window.WizCore.chatSearch.stats);
    ok(st0.aborted >= 1, '#26 typing a new query cancels the in-flight message reads', st0);
    await p.waitForFunction(id => document.querySelector(`.win[data-win="${id}"] [data-chbs="done"]`), wid, { timeout: 20000 }).catch(() => {});
    const res = await p.evaluate(id => [...document.querySelectorAll(`.win[data-win="${id}"] .ch-row[data-chopen]`)].map(r => ({ id: r.dataset.chopen, snip: r.querySelector('[data-chsnip]')?.innerHTML || '' })), wid);
    const t03 = res.find(r => r.id === 'qa_t03');
    ok(!!t03, '#26 a thread whose body (not title/preview) matches is found', res.map(r => r.id));
    ok(/<mark>zebracorn<\/mark> migration plan/.test(t03?.snip || ''), '#26 the hit shows a snippet with the match highlighted', t03?.snip);
    ok(!res.some(r => r.id === 'qa_t40'), '#26 only recent threads are read at first (cap)');
    const latest = W.msgFetch.filter(f => f.order === 'latest');
    ok(latest.length > 0 && latest.length <= 30 + 4 && latest.every(f => f.limit === '200'), '#26 the first round reads at most 30 threads, newest page only', { n: latest.length });
    ok(new Set(latest.map(f => f.id)).size <= 30, '#26 no thread is read twice for the same query');
    await shot(p, 'phone-body-search');
    await p.click(`.win[data-win="${wid}"] [data-chbsmore]`).catch(() => {});
    await p.waitForFunction(id => document.querySelector(`.win[data-win="${id}"] .ch-row[data-chopen="qa_t40"]`), wid, { timeout: 20000 }).catch(() => {});
    ok(await p.evaluate(id => !!document.querySelector(`.win[data-win="${id}"] .ch-row[data-chopen="qa_t40"] mark`), wid), '#26 "Search older threads" finds a match further back');
    const n1 = W.msgFetch.length;
    await p.fill(sel, ''); await sleep(50); await p.fill(sel, 'zebracorn'); await sleep(900);
    ok(W.msgFetch.length === n1, '#26 searching again reuses what was already read (no refetch)', { before: n1, after: W.msgFetch.length });
    await p.click(`.win[data-win="${wid}"] .ch-row[data-chopen="qa_t03"]`); await sleep(500);
    ok((await chatsWin()).thread === 'qa_t03', '#26 tapping a body hit opens that thread');
    await back();
    await p.click(`.win[data-win="${wid}"] [data-chsclear]`).catch(() => {}); await sleep(200);
    ok(await p.evaluate(id => document.querySelector(`.win[data-win="${id}"] [data-chsearch]`)?.value === '' && Object.keys(window.WizCore.chatSearch.stats.runs).length === 0, wid), '#26 clearing the search stops body search');
  } catch (e) { ok(false, 'section crashed (continuing)', String(e).split('\n')[0]); }

  /* ---- #33 Drafts for unsent new chats ---- */
  try {
    const wid = (await chatsWin()).id, W$ = s => `.win[data-win="${wid}"] ${s}`;
    await p.click(W$('[data-chsearch]')); await sleep(300); await p.click(W$('[data-chnew]')); await sleep(300);
    await p.fill(W$('.ch-compose textarea'), 'Half-written idea about the garden'); await sleep(100);
    await back(); // to the list: the new-chat draft is kept
    let drafts = await p.evaluate(s => [...document.querySelectorAll(s)].map(r => r.textContent), W$('[data-sec="drafts"] .ch-row'));
    ok(drafts.length === 1 && /Half-written idea/.test(drafts[0]) && /Draft · saved on this device/.test(drafts[0]), '#33 the list shows a Drafts section with the unsent new chat', drafts);
    await p.click(W$('[data-chsearch]')); await sleep(300); await p.click(W$('[data-chnew]')); await sleep(300);
    ok((await p.inputValue(W$('.ch-compose textarea'))) === '', '#33 "+" starts an empty new chat; the old draft is kept aside');
    await p.fill(W$('.ch-compose textarea'), 'Second unsent thought'); await sleep(100);
    await back();
    drafts = await p.evaluate(s => [...document.querySelectorAll(s)].map(r => r.textContent), W$('[data-sec="drafts"] .ch-row'));
    ok(drafts.length === 2, '#33 two unsent new chats → two drafts', drafts);
    await shot(p, 'phone-drafts');
    await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForFunction(() => window.__wos?.live?.ok, null, { timeout: 20000 }).catch(() => {}); await sleep(600);
    await p.evaluate(() => __wos.goDesk(Object.values(__wos.desks).findIndex(d => d.wins.some(x => __wos.wins[x].app === 'chats')))); await sleep(400);
    drafts = await p.evaluate(s => [...document.querySelectorAll(s)].map(r => r.textContent), W$('[data-sec="drafts"] .ch-row'));
    ok(drafts.length === 2, '#33 drafts survive a reload', drafts);
    const key = await p.evaluate(s => [...document.querySelectorAll(s)].find(r => /garden/.test(r.textContent))?.dataset.chdraft, W$('[data-chdraft]'));
    await p.click(W$(`[data-chdraft="${key}"]`)); await sleep(300);
    ok((await p.inputValue(W$('.ch-compose textarea'))) === 'Half-written idea about the garden', '#33 opening a draft puts its words back in the new-chat composer');
    await back();
    drafts = await p.evaluate(s => [...document.querySelectorAll(s)].map(r => r.textContent), W$('[data-sec="drafts"] .ch-row'));
    ok(drafts.length === 2, '#33 reopening a draft does not duplicate or lose one', drafts);
    await p.fill(W$('[data-chsearch]'), 'garden'); await sleep(200);
    drafts = await p.evaluate(s => [...document.querySelectorAll(s)].map(r => r.textContent), W$('[data-sec="drafts"] .ch-row'));
    ok(drafts.length === 1 && /garden/.test(drafts[0]), '#33 search filters drafts too', drafts);
    await p.fill(W$('[data-chsearch]'), ''); await sleep(200);
    const k2 = await p.evaluate(s => [...document.querySelectorAll(s)].find(r => /Second/.test(r.textContent))?.dataset.chdraft, W$('[data-chdraft]'));
    await p.click(W$(`[data-chdraftx="${k2}"]`)); await sleep(200);
    drafts = await p.evaluate(s => [...document.querySelectorAll(s)].map(r => r.textContent), W$('[data-sec="drafts"] .ch-row'));
    ok(drafts.length === 1 && /garden/.test(drafts[0]), '#33 × discards one draft', drafts);
    ok(!W.writes.some(w => /sessions|runs/.test(w)), '#33 drafts never send anything');
  } catch (e) { ok(false, 'section crashed (continuing)', String(e).split('\n')[0]); }

  /* ---- #31 critical-issue banner ---- */
  try {
    await p.evaluate(() => { __wos.closeSheets(); __wos.goDesk(__wos.HOME); }); await sleep(1400);
    const cb = await p.evaluate(() => { const b = document.querySelector('[data-wxcritbox]'); return b ? b.textContent : null; });
    ok(/1 critical issue needs attention/.test(cb || '') && /Tap to see the critical issue/.test(cb || ''), '#31 banner: 1 critical issue (the failed one is left to Errors)', cb);
    await shot(p, 'phone-critical-banner');
    await p.evaluate(() => __wos.openWizardThread('qa_t00')); await sleep(1400);
    ok(await p.evaluate(() => !!document.querySelector('[data-wxcritbox]')), '#31 the banner stays across screens (inside another thread)');
    await p.evaluate(() => __wos.openWizardThread('qa_t01')); await sleep(1400);
    ok(await p.evaluate(() => !document.querySelector('[data-wxcritbox]')), '#31 hidden while that critical thread is in front');
    await back(); await sleep(1300);
    await p.click('[data-wxcrit]').catch(() => {}); await sleep(500);
    ok(await p.evaluate(() => (() => { const d = __wos.desks[__wos.idx], w = __wos.wins[d.focus]; return !__wos.sheet && w?.app === 'chats' && !w.thread; })()), '#31 tapping it opens the Chats list');
    await back(); await sleep(1300);
    await p.click('[data-wxcrit-x]').catch(() => {}); await sleep(300);
    ok(await p.evaluate(() => !document.querySelector('[data-wxcritbox]')), '#31 × hides it');
    W.threads[10].level = 'critical'; await p.evaluate(() => __wos.live.refresh()); await sleep(1500);
    const cb2 = await p.evaluate(() => document.querySelector('[data-wxcritbox]')?.textContent || '');
    ok(/2 critical issues need attention/.test(cb2), '#31 a new critical issue brings it back', cb2);
    W.threads[10].level = '';
  } catch (e) { ok(false, 'section crashed (continuing)', String(e).split('\n')[0]); }

  /* ---- #27 connection banner ---- */
  try {
    await ctx.setOffline(true); await sleep(400);
    let st = await p.evaluate(() => document.querySelector('[data-wxnet]')?.dataset.wxnet + '|' + document.querySelector('[data-wxnet]')?.textContent);
    ok(/^offline\|.?Offline — your drafts and anything you send are safe/.test(st), '#27 offline banner', st);
    await shot(p, 'phone-offline-banner');
    await ctx.setOffline(false); await sleep(150);
    st = await p.evaluate(() => window.__statusLog.slice(-3));
    ok(st.includes('net:reconnecting') || st.includes('net:restored'), '#27 coming back online reconnects first', st);
    await p.waitForFunction(() => document.querySelector('[data-wxnet="restored"]'), null, { timeout: 8000 }).catch(() => {});
    ok(/Back online/.test(await p.evaluate(() => document.querySelector('[data-wxnet]')?.textContent || '')), '#27 then says Back online');
    await sleep(2400);
    ok(await p.evaluate(() => !document.querySelector('[data-wxnet]')), '#27 Back online goes away after ~2 s');
    W.down = true; await p.evaluate(() => __wos.live.refresh()); await sleep(500);
    ok(await p.evaluate(() => document.querySelector('[data-wxnet]')?.dataset.wxnet) === 'reconnecting', '#27 Wizard unreachable (online) → Reconnecting…');
    await shot(p, 'phone-reconnecting-banner');
    W.down = false; await p.evaluate(() => __wos.live.refresh()); await sleep(500);
    ok(await p.evaluate(() => document.querySelector('[data-wxnet]')?.dataset.wxnet) === 'restored', '#27 Wizard reachable again → Back online');
  } catch (e) { ok(false, 'section crashed (continuing)', String(e).split('\n')[0]); }

  /* ---- #27 fatal card ---- */
  try {
    await p.evaluate(() => window.WizCore.status.fatal('Your Wizard does not support the chat features this app needs.')); await sleep(200);
    const fc = await p.evaluate(() => { const f = document.querySelector('#wxFatal:not([hidden])'); return f ? f.textContent : null; });
    ok(/Merlin needs attention/.test(fc || '') && /Reload/.test(fc || ''), '#27 fatal card: "<agent> needs attention · Reload" (agent name from settings)', fc);
    await shot(p, 'phone-fatal');
    await back();
    ok(await p.evaluate(() => !document.querySelector('#wxFatal:not([hidden])')) && ours(p), '#27 Back closes the fatal card, app stays');
    // a shell that cannot start: the card appears by itself, and Reload recovers
    W.brokenApp = true;
    const p2 = await page(ctx, BASE); await sleep(4200);
    const f2 = await p2.evaluate(() => document.querySelector('#wxFatal:not([hidden])')?.textContent || '');
    ok(/needs attention/.test(f2) && /QA broke the shell on purpose/.test(f2), '#27 a shell that fails to boot shows the fatal card with the error', f2);
    await shot(p2, 'phone-fatal-boot');
    W.brokenApp = false;
    await p2.click('[data-wxreload]'); await p2.waitForFunction(() => window.__wos, null, { timeout: 20000 }).catch(() => {}); await sleep(3200);
    ok(await p2.evaluate(() => !!window.__wos && !document.querySelector('#wxFatal:not([hidden])')), '#27 Reload recovers once the shell is fixed');
    await p2.close();
  } catch (e) { ok(false, 'section crashed (continuing)', String(e).split('\n')[0]); }
  ok(p.errs.length === 0, 'phone: no page errors', p.errs);
  await ctx.close();

  /* =============================== DESKTOP =============================== */
  const dctx = await context(b, { desktop: true });
  const d = await page(dctx, BASE + 'desktop.html?shell=desktop&session=qa_t07');
  await d.waitForFunction(() => window.__wux?.live?.ok, null, { timeout: 30000 }).catch(() => {});
  await sleep(1000);
  const dfoc = () => d.evaluate(() => { const w = __wux.wins[__wux.ws[__wux.cur].focus]; return w ? { id: w.id, app: w.app, thread: w.thread } : null; });
  try {
    const f = await dfoc();
    ok(f?.app === 'chats' && f.thread === 'qa_t07', '#28 desktop: ?session= opens the thread in a Chats window', f);
    ok(await d.evaluate(() => document.title) === 'Thread 7 · Wizard', '#32 desktop: window title (document.title) is the thread name', await d.evaluate(() => document.title));
    ok(await d.evaluate(id => document.querySelector(`.win[data-win="${id}"] .wbar .t`)?.textContent, f?.id) === 'Thread 7', '#32 desktop: Chats title bar is the thread name');
    // #29 side by side
    const g = await d.evaluate(id => { const el = document.querySelector(`.win[data-win="${id}"]`); const r = s => { const b = el.querySelector(s)?.getBoundingClientRect(); return b && { x: Math.round(b.x), w: Math.round(b.width), h: Math.round(b.height) }; }; return { list: r('.pane-list'), main: r('.pane-main'), split: r('[data-split]') }; }, f?.id);
    ok(g.list && g.main && g.list.w > 200 && g.main.w > 400 && g.main.x >= g.list.x + g.list.w - 4 && g.list.h > 300 && g.main.h > 300, '#29 list and thread side by side', g);
    ok(await d.evaluate(id => !!document.querySelector(`.win[data-win="${id}"] .pane-list .ch-row.cur[data-chopen="qa_t07"]`), f?.id), '#29 the open thread is highlighted in the list');
    await shot(d, 'desktop-split-deeplink');
    // resize by drag
    const s = g.split, w0 = g.list.w;
    await d.mouse.move(s.x + 3, 300); await d.mouse.down(); await d.mouse.move(s.x + 63, 300, { steps: 6 }); await d.mouse.move(s.x + 123, 300, { steps: 6 }); await d.mouse.up(); await sleep(200);
    const w1 = await d.evaluate(id => Math.round(document.querySelector(`.win[data-win="${id}"] .pane-list`).getBoundingClientRect().width), f?.id);
    ok(Math.abs(w1 - (w0 + 120)) <= 8, '#29 dragging the divider resizes the list', { w0, w1 });
    await d.focus(`.win[data-win="${f?.id}"] [data-split]`); await d.keyboard.press('ArrowLeft'); await sleep(100);
    const w2 = await d.evaluate(id => Math.round(document.querySelector(`.win[data-win="${id}"] .pane-list`).getBoundingClientRect().width), f?.id);
    ok(w2 === w1 - 24, '#29 arrow keys on the divider resize it too', { w1, w2 });
    await d.reload({ waitUntil: 'domcontentloaded' }); await d.waitForFunction(() => window.__wux?.live?.ok, null, { timeout: 20000 }).catch(() => {}); await sleep(600);
    const w3 = await d.evaluate(() => { const el = document.querySelector('.dchats .pane-list'); return el && Math.round(el.getBoundingClientRect().width); });
    ok(w3 === w2, '#29 the list width is kept across reloads', { w2, w3 });
    // keyboard through the list
    const f2 = await dfoc();
    await d.focus(`.win[data-win="${f2.id}"] [data-chsearch]`);
    await d.keyboard.press('ArrowDown'); await sleep(300);
    const t1 = (await dfoc()).thread;
    await d.keyboard.press('ArrowDown'); await sleep(300);
    const t2 = (await dfoc()).thread;
    await d.keyboard.press('ArrowUp'); await sleep(300);
    const t3 = (await dfoc()).thread;
    ok(t1 && t2 && t1 !== t2 && t3 === t1, '#29 ↓/↑ walk the thread list and open each chat beside it', { t1, t2, t3 });
    await d.focus(`.win[data-win="${f2.id}"] .ch-compose textarea`).catch(() => {});
    await d.keyboard.press('Alt+Shift+KeyJ'); await sleep(300);
    ok((await dfoc()).thread === t2, '#29 ⌥⇧J moves to the next chat from the composer', await dfoc());
    await d.keyboard.press('Escape'); await sleep(200);
    await d.focus(`.win[data-win="${f2.id}"]`); await d.keyboard.press('/'); await sleep(150);
    ok(await d.evaluate(() => document.activeElement?.matches('[data-chsearch]')), '#29 / focuses the list search');
    // the empty pane offers a new chat
    await d.keyboard.press('Escape'); await sleep(150);
    ok(await d.evaluate(id => /Your conversations, side by side/.test(document.querySelector(`.win[data-win="${id}"] .pane-empty`)?.textContent || '') && getComputedStyle(document.querySelector(`.win[data-win="${id}"] .pane-empty`)).display !== 'none', f2.id), '#29 empty right pane explains and offers a new chat');
    await d.click(`.win[data-win="${f2.id}"] [data-panenew]`); await sleep(300);
    ok((await dfoc()).thread === '__new__' && await d.evaluate(() => document.title) === 'New chat · Wizard', '#29/#32 Start a new chat opens one beside the list; title says New chat');
    await d.keyboard.press('Escape'); await sleep(200);
    ok(await d.evaluate(() => document.title) === 'Chats · Wizard', '#32 back on the list the title is Chats');
    // body search on the desktop list
    await d.fill(`.win[data-win="${f2.id}"] [data-chsearch]`, 'zebracorn');
    await d.waitForFunction(id => document.querySelector(`.win[data-win="${id}"] .pane-list .ch-row[data-chopen="qa_t03"] mark`), f2.id, { timeout: 20000 }).catch(() => {});
    ok(await d.evaluate(id => !!document.querySelector(`.win[data-win="${id}"] .pane-list .ch-row[data-chopen="qa_t03"] mark`), f2.id), '#26 desktop: body search with snippet in the list pane');
    await shot(d, 'desktop-body-search');
    await d.fill(`.win[data-win="${f2.id}"] [data-chsearch]`, '');
    // #31 + #30 on desktop
    await sleep(1300);
    ok(/1 critical issue needs attention/.test(await d.evaluate(() => document.querySelector('[data-wxcritbox]')?.textContent || '')), '#31 desktop: critical banner');
    await d.click('[data-wxcrit]').catch(() => {}); await sleep(300);
    ok(await d.evaluate(() => !document.querySelector('#inbox').hidden), '#31 desktop: it opens the Inbox drawer');
    await d.keyboard.press('Escape'); await sleep(200);
    await d.keyboard.press('Alt+Comma'); await sleep(900);
    const dc = await d.evaluate(() => { const c = document.querySelector('#dsettings:not([hidden]) [data-voicecard]'); return c ? { state: c.dataset.voicecard, text: c.textContent } : null; });
    ok(dc?.state === 'ready' && /Tinfoil/.test(dc.text) && /Attested/.test(dc.text), '#30 desktop: ⌥, Settings shows the voice provider card', dc);
    await shot(d, 'desktop-settings-voice-card');
    await d.keyboard.press('Escape'); await sleep(200);
    ok(await d.evaluate(() => document.querySelector('#dsettings').hidden), '#30 desktop: Esc closes Settings');
    // #28 Back on the desktop never leaves
    await d.evaluate(() => __wux.openThread('qa_t07')); await sleep(300);
    await d.goBack().catch(() => {}); await sleep(400);
    ok(ours(d) && (await dfoc())?.thread === null, '#28 desktop: browser Back from a thread → the list, page stays', { url: d.url(), f: await dfoc() });
    await d.goBack().catch(() => {}); await sleep(400);
    ok(ours(d) && await d.evaluate(() => !!window.__wux), '#28 desktop: Back at the root stays put');
    await dctx.setOffline(true); await sleep(300);
    ok(await d.evaluate(() => document.querySelector('[data-wxnet]')?.dataset.wxnet) === 'offline', '#27 desktop: offline banner');
    await shot(d, 'desktop-offline-banner');
    await dctx.setOffline(false); await sleep(200);
    // ?view= on desktop
    await d.goto(BASE + 'desktop.html?shell=desktop&view=inbox', { waitUntil: 'domcontentloaded' }); await sleep(1200);
    ok(await d.evaluate(() => !document.querySelector('#inbox').hidden), '#28 desktop: ?view=inbox opens the Inbox drawer');
  } catch (e) { ok(false, 'section crashed (continuing)', String(e).split('\n')[0]); }
  ok(d.errs.length === 0, 'desktop: no page errors', d.errs);
  await dctx.close();

  /* ---- fences ---- */
  ok(W.foreign.length === 0, 'nothing left the box (all requests intercepted)', W.foreign.slice(0, 3));
  const badWrites = W.writes.filter(w => !/^PUT \/wizard\/thread-seen$/.test(w));
  ok(badWrites.length === 0, 'the only writes were read receipts, answered by the fake', badWrites);
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); console.log(`\n${pass} passed, ${fail + 1} failed`); process.exit(1); });
