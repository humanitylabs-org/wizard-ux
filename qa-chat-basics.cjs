// QA for Chats chat-app basics (feature/chat-basics): photos in James's own bubble, assistant attachments,
// in-app media viewer (+ Back), selectable/copyable text, per-thread drafts, Done/Defer/Close & file/Restore,
// approvals, Stop, load earlier, timestamps + day dividers, full Markdown, paste-to-attach.
//
// Real Wizard reads (GET) for the real-thread checks; deterministic fixture threads are merged into the
// session list for everything that writes. EVERY non-GET to /wizard/* is intercepted and answered here —
// nothing reaches Wizard/Archimedes. With the local QA origin (tools/qa-origin.cjs) a second fence refuses
// writes server-side and the suite asserts its refusal counter did not move.
//
// Usage: node tools/qa-origin.cjs 9371 &  then  node qa-chat-basics.cjs [url]
//   url defaults to http://127.0.0.1:9371/wizard-os-home/ ; QA_WEB_DIR=<dir> serves web/ from <dir>
//   (e.g. QA_WEB_DIR=/home/telos/apps/wizard-os-home for the `daily` baseline). QA_OUT=<dir> for screenshots.
const { chromium } = require('/home/telos/node_modules/playwright');
const fs = require('fs'), path = require('path');
const URL_ = process.argv[2] || 'http://127.0.0.1:9371/wizard-os-home/';
const WEB = process.env.QA_WEB_DIR || '';
const OUT = process.env.QA_OUT || '/home/telos/.hermes/cache/scratch/wizard-audit/shots/feature-chat-basics';
const EXEC = process.env.QA_CHROME || '/home/telos/.local/bin/google-chrome';
const RESOLVE = process.env.QA_RESOLVE || 'MAP private.wizard001.com 127.0.0.1:18443';
const REAL_THREAD = process.env.QA_REAL_THREAD || 'wizard_1791466716358_dd032d92f93f'; // James sent a photo (data-URL part); Archimedes replied with helm_attachments images
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === '' ? '' : typeof extra === 'string' ? extra : JSON.stringify(extra)); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- fixtures ---------------- */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAG0lEQVR42mNk+M9Qz0AEYBxVSF+FjKMKqasQAKSLEAG4h6AFAAAAAElFTkSuQmCC', 'base64');
const PNG_URL = 'data:image/png;base64,' + PNG.toString('base64');
const now = Date.now() / 1000;
// Noon yesterday in Bangkok (UTC+7, no DST): "now - 26h" fell two days back between 00:00 and 02:00 Bangkok.
const YDAY = Math.floor((now + 7 * 3600) / 86400) * 86400 - 7 * 3600 - 12 * 3600;
const hex = n => n.toString(16).padStart(32, '0');
const ATT = { img1: hex(0xa1), img2: hex(0xa2), audio: hex(0xa3), video: hex(0xa4), md: hex(0xa5), pdf: hex(0xa6) };
const helm = items => `<helm_attachments>${JSON.stringify({ items })}</helm_attachments>`;
const MD_TEXT = [
  '# Plan', '', 'Here is *italic*, _also italic_, **bold** and `inline code`.', '',
  '> A quoted line', '> continues here', '',
  '- Top item', '  - Nested item', '    1. Deep numbered', '- Second item', '',
  '| Name | Score |', '|:-----|------:|', '| Alpha | 1 |', '| Beta | 2 |', '',
  '```bash', 'echo "hello" && ls -la', '```', '',
  'See @session:default/qa_ready_thread for the other one.',
].join('\n');
let rid = 1;
const row = (role, content, ts, extra = {}) => ({ id: rid++, session_id: '', role, content, timestamp: ts, ...extra });
const FIX = {
  qa_media_thread: { title: 'QA media thread', status: 'completed', t: now - 60, rows: () => [
    row('user', 'Earlier question from yesterday', YDAY),
    row('assistant', 'Earlier answer from yesterday.', YDAY + 30),
    // Photo-only, inline image part (legacy photo / screenshot): must keep its turn.
    row('user', [{ type: 'image_url', image_url: { url: PNG_URL } }], now - 900),
    row('assistant', 'That is a purple square.', now - 880),
    // Photo via Wizard Files chip, "Please use the attached file." wording.
    row('user', 'Please use the attached file.\n\n[WIZARD_FILE_CHIPS_V1]\n[{"id":"drop_qashot1","filename":"screenshot.png","mime":"image/png","bytes":90}]\n[/WIZARD_FILE_CHIPS_V1]', now - 700),
    row('assistant', 'Got the screenshot.', now - 690),
    // Text + inline photo in one message.
    row('user', [{ type: 'text', text: 'What about this one?' }, { type: 'image_url', image_url: { url: PNG_URL } }], now - 500),
    row('tool', 'tool output', now - 495),
    row('assistant', `Here are the files.\n\n${helm([
      { id: ATT.img1, name: 'variant-a.png', mime: 'image/png', kind: 'image', bytes: 90 },
      { id: ATT.img2, name: 'variant-b.png', mime: 'image/png', kind: 'image', bytes: 90 },
      { id: ATT.audio, name: 'reply.m4a', mime: 'audio/mp4', kind: 'audio', bytes: 1200, transcript: 'hello there' },
      { id: ATT.video, name: 'clip.mp4', mime: 'video/mp4', kind: 'video', bytes: 4000 },
      { id: ATT.md, name: 'notes.md', mime: 'text/markdown', kind: 'file', bytes: 40 },
      { id: ATT.pdf, name: 'report.pdf', mime: 'application/pdf', kind: 'file', bytes: 5000 },
    ])}`, now - 480),
    row('user', 'Format it nicely', now - 200),
    row('assistant', MD_TEXT, now - 120),
  ] },
  qa_ready_thread: { title: 'QA ready thread', status: 'completed', t: now - 50, rows: () => [row('user', 'Ready question', now - 300), row('assistant', 'Ready answer.', now - 250)] },
  qa_done_thread: { title: 'QA done thread', status: 'completed', t: now - 55, rows: () => [row('user', 'Done question', now - 300), row('assistant', 'Done answer.', now - 250)] },
  qa_file_thread: { title: 'QA file thread', status: 'completed', t: now - 58, rows: () => [row('user', 'File question', now - 300), row('assistant', 'File answer.', now - 250)] },
  qa_fail_thread: { title: 'QA fail thread', status: 'completed', t: now - 59, rows: () => [row('user', 'Fail question', now - 300), row('assistant', 'Fail answer.', now - 250)] },
  qa_paste_thread: { title: 'QA paste thread', status: 'completed', t: now - 62, rows: () => [row('user', 'Paste question', now - 300), row('assistant', 'Paste answer.', now - 250)] },
  qa_appr_thread: { title: 'QA approval thread', status: 'waiting_for_approval', run: 'qa-run-appr', t: now - 40, rows: () => [row('user', 'Delete the temp files', now - 100)] },
  qa_run_thread: { title: 'QA running thread', status: 'running', run: 'qa-run-live', t: now - 30, rows: () => [row('user', 'Do a long job', now - 80)] },
  qa_long_thread: { title: 'QA long thread', status: 'completed', t: now - 70, rows: () => { const r = []; for (let k = 0; k < 150; k++) { r.push(row('user', `Question number ${k}`, now - 86400 * 3 + k * 600)); r.push(row('assistant', `Answer number ${k}`, now - 86400 * 3 + k * 600 + 60)); } return r; } },
};
const fixState = Object.fromEntries(Object.keys(FIX).map(id => [id, { archived: false, deferred: null }]));
function fixSession(id) {
  const f = FIX[id], rows = f.rows(), last = rows[rows.length - 1], lastU = [...rows].reverse().find(r => r.role === 'user');
  return { id, source: 'wizard-mobile', title: f.title, status: f.status, archived: fixState[id].archived, hidden: false, message_count: rows.length,
    started_at: f.t - 600, last_active: f.t, wizard_last_user_at: lastU.timestamp, wizard_last_assistant_at: f.t, wizard_activity_at: f.t, wizard_run_id: f.run || '',
    latest_message: { role: last.role, content: typeof last.content === 'string' ? last.content.slice(0, 200) : 'photo', timestamp: last.timestamp },
    last_user_message: { role: 'user', content: typeof lastU.content === 'string' ? lastU.content.slice(0, 200) : 'photo', timestamp: lastU.timestamp } };
}
const APPROVAL = { request_id: 'qa-req-1', command: 'rm -rf /tmp/qa-scratch', choices: ['once', 'session', 'always', 'deny'] };

(async () => {
  const b = await chromium.launch({ executablePath: fs.existsSync(EXEC) ? EXEC : undefined, args: ['--host-resolver-rules=' + RESOLVE] });
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true, acceptDownloads: true });
  const origin = new URL(URL_).origin;
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  const writes = [], leaked = [];
  let holdDisposition = 0, failNext = '';
  const routeWizard = async r => {
    const q = r.request(), u = new URL(q.url()), m = q.method();
    const wm = u.pathname.match(/\/wizard-os-home\/((?:core\/|desktop\/)?[a-z-]+\.(?:js|css)|index\.html|desktop\.html|)$/);
    if (WEB && wm && m === 'GET' && !/^(data|summaries)\.js$/.test(wm[1])) { const f = wm[1] || 'index.html', fp = path.join(WEB, 'web', f); if (fs.existsSync(fp)) return r.fulfill({ status: 200, contentType: f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : 'application/javascript', body: fs.readFileSync(fp) }); }
    if (!u.pathname.startsWith('/wizard/')) return r.continue();
    const json = (status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (m !== 'GET' && m !== 'HEAD') {
      const body = q.postDataBuffer() || Buffer.alloc(0);
      const w = { m, p: u.pathname, body: /upload/.test(u.pathname) ? `<${body.length} bytes>` : body.toString(), headers: q.headers() };
      writes.push(w);
      if (failNext && u.pathname.includes(failNext)) { failNext = ''; await sleep(400); return json(500, { error: 'qa-forced' }); }
      if (/\/wizard\/files\/upload$/.test(u.pathname)) return json(201, { file: { id: 'drop_qaup' + writes.length, filename: q.headers()['x-wizard-filename'], mime: q.headers()['x-wizard-mime'], bytes: body.length } });
      if (u.pathname === '/wizard/thread-dispositions') {
        const p = JSON.parse(w.body); if (holdDisposition) await sleep(holdDisposition);
        if (fixState[p.sessionId]) fixState[p.sessionId].deferred = { deferred: p.deferred, updatedAt: new Date().toISOString() };
        return json(200, { record: { deferred: p.deferred, updatedAt: new Date().toISOString() } });
      }
      const sm = u.pathname.match(/\/wizard\/hermes\/api\/sessions\/([^/]+)$/);
      if (sm && m === 'PATCH') { const p = JSON.parse(w.body); if (fixState[sm[1]] && 'archived' in p) fixState[sm[1]].archived = !!p.archived; await sleep(300); return json(200, { ok: true }); }
      if (u.pathname === '/wizard/filings') { const p = JSON.parse(w.body); if (fixState[p.session_id]) fixState[p.session_id].archived = true; await sleep(300); return json(200, { ok: true, source_thread_id: p.session_id, card_id: null }); }
      if (/\/api\/sessions$/.test(u.pathname)) return json(200, { session: { id: JSON.parse(w.body || '{}').id || 'qa-fake-session' } });
      if (/\/v1\/runs$/.test(u.pathname)) return json(202, { run_id: 'qa-fake-run', status: 'queued' });
      return json(200, {});
    }
    // GET: fixtures merged into real reads.
    if (u.pathname === '/wizard/hermes/api/sessions' && (u.searchParams.get('offset') || '0') === '0') {
      const res = await r.fetch(); const p = await res.json();
      p.data = Object.keys(FIX).map(fixSession).concat(p.data || []);
      return json(200, p);
    }
    if (u.pathname === '/wizard/thread-dispositions') {
      const res = await r.fetch(); const p = await res.json().catch(() => ({ state: {} }));
      for (const [id, st] of Object.entries(fixState)) if (st.deferred) (p.state = p.state || {})[`direct:${id}`] = st.deferred;
      return json(200, p);
    }
    const mm = u.pathname.match(/\/wizard\/hermes\/api\/sessions\/([^/]+)\/messages$/);
    if (mm && FIX[mm[1]]) { rid = 1; const rows = FIX[mm[1]].rows().map(x => ({ ...x, session_id: mm[1] })); const off = +u.searchParams.get('offset') || 0, lim = +u.searchParams.get('limit') || 500; const page = rows.slice(off, off + lim); return json(200, { object: 'list', data: page, pagination: { limit: lim, offset: off, returned: page.length } }); }
    const sm = u.pathname.match(/\/wizard\/hermes\/api\/sessions\/([^/]+)$/); if (sm && FIX[sm[1]]) return json(200, { session: fixSession(sm[1]) });
    if (u.pathname === '/wizard/hermes/v1/runs/qa-run-appr') return json(200, { run_id: 'qa-run-appr', status: 'waiting_for_approval', session_id: 'qa_appr_thread', approval: APPROVAL });
    if (u.pathname === '/wizard/hermes/v1/runs/qa-run-live') return json(200, { run_id: 'qa-run-live', status: 'running', session_id: 'qa_run_thread' });
    if (/\/wizard\/hermes\/v1\/runs\/qa-/.test(u.pathname)) return json(200, { run_id: 'qa-fake-run', status: 'queued' });
    if (/\/wizard\/files\/drop_qa[^/]*\/content$/.test(u.pathname)) return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    const am = u.pathname.match(/\/wizard\/attachments\/([0-9a-f]{32})$/);
    if (am && Object.values(ATT).includes(am[1])) {
      if (am[1] === ATT.md) return r.fulfill({ status: 200, contentType: 'text/markdown', body: '# Notes title\n\n- first point\n- second point\n' });
      if (am[1] === ATT.pdf) return r.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4 qa' });
      if (am[1] === ATT.audio || am[1] === ATT.video) return r.fulfill({ status: 404, body: '' });
      return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
    }
    return r.continue();
  };
  await ctx.route('**/*', routeWizard);
  ctx.on('request', q => { if (q.method() !== 'GET' && q.method() !== 'HEAD' && /\/wizard\//.test(new URL(q.url()).pathname)) leaked.push(q.url()); });
  const refusedAt = async () => { try { const r = await fetch(origin + '/__qa/refused'); return (await r.json()).refused; } catch (e) { return null; } };
  const refused0 = await refusedAt();

  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|frame-ancestors/.test(m.text())) errs.push('console: ' + m.text()); });
  await p.addInitScript(() => {
    try { localStorage.setItem('wos.coached', 'true'); } catch (e) {}
    window.__shares = [];
    navigator.share = async d => { window.__shares.push({ text: d.text || '', title: d.title || '', files: (d.files || []).map(f => ({ name: f.name, type: f.type, size: f.size })) }); };
    navigator.canShare = d => !!d;
  });
  const cdp = await ctx.newCDPSession(p);
  const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  async function swipe(x0, y0, x1, y1, steps = 8) { await touch('touchStart', [[x0, y0]]); for (let k = 1; k <= steps; k++) { await touch('touchMove', [[x0 + (x1 - x0) * k / steps, y0 + (y1 - y0) * k / steps]]); await sleep(16); } await touch('touchEnd', []); }
  async function pinch(cx, cy, d0, d1, steps = 8) { await touch('touchStart', [[cx - d0, cy], [cx + d0, cy]]); for (let k = 1; k <= steps; k++) { const d = d0 + (d1 - d0) * k / steps; await touch('touchMove', [[cx - d, cy], [cx + d, cy]]); await sleep(16); } await touch('touchEnd', []); }
  async function longPress(x, y) { await touch('touchStart', [[x, y]]); await sleep(650); await touch('touchEnd', []); }
  const center = async sel => { const bb = await p.locator(sel).first().boundingBox(); return bb && [bb.x + bb.width / 2, bb.y + bb.height / 2]; };
  const chatsWin = () => p.evaluate(() => Object.values(__wos.wins).find(w => w.app === 'chats')?.id);
  async function openThread(id) {
    await p.evaluate(id => __wos.openWizardThread(id), id);
    await p.waitForFunction(id => { const w = Object.values(__wos.wins).find(x => x.app === 'chats'); return w?.thread === id && !document.querySelector('.ch-empty') && document.querySelector('.ch-msgs'); }, id, { timeout: 30000 }).catch(() => {});
    await sleep(500);
  }
  // Scroll only the nearest scrolling list (as a finger would) — element.scrollIntoView would also shift the
  // overflow:hidden shell around the window, which a real phone never does.
  const reveal = (sel, block = 'center') => p.evaluate(([sel, block]) => {
    const el = typeof sel === 'string' ? document.querySelector(sel) : null; if (!el) return false;
    let sc = el.parentElement; while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement; if (!sc) return false;
    const r = el.getBoundingClientRect(), b = sc.getBoundingClientRect();
    sc.scrollTop += block === 'start' ? r.top - b.top - 8 : (r.top + r.height / 2) - (b.top + b.height / 2); return true;
  }, [sel, block]);
  const shellShift = () => p.evaluate(() => { const out = []; for (const el of document.querySelectorAll('body, body *')) { const cs = getComputedStyle(el); if ((el.scrollTop || el.scrollLeft) && !/(auto|scroll)/.test(cs.overflowY + cs.overflowX)) out.push((el.id || el.className || el.tagName) + ':' + el.scrollTop + ',' + el.scrollLeft); } return out; });
  const back = async () => { await p.keyboard.press('Escape'); await sleep(450); };
  const thread = async () => p.evaluate(() => Object.values(__wos.wins).find(w => w.app === 'chats')?.thread ?? null);

  await p.goto(URL_, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__wos?.live?.ok && window.__wos.live.session('qa_media_thread'), null, { timeout: 90000 }).catch(() => {});
  ok(await p.evaluate(() => !!window.__wos?.live?.session('qa_media_thread')), 'Wizard thread list loaded (real + fixture threads)');
  await p.evaluate(() => __wos.goDesk(1)); await sleep(600);

  /* ===== #2 + #3 on REAL data: James's photo in his own bubble, Archimedes's images from helm_attachments ===== */
  {
    await openThread(REAL_THREAD);
    // Photos are lazy-loaded: bring James's photo into view, then require it to actually decode.
    await reveal('.msg.u .mimg'); await sleep(300);
    await p.waitForFunction(() => [...document.querySelectorAll('.msg.u .mimg img')].some(i => i.complete && i.naturalWidth > 0), null, { timeout: 30000 }).catch(() => {});
    const r = await p.evaluate(() => {
      const u = [...document.querySelectorAll('.msg.u .mimg img')], a = [...document.querySelectorAll('.msg.a .mimg img')];
      return { u: u.length, uLoaded: u.filter(i => i.naturalWidth > 0).length, uData: u.filter(i => i.src.startsWith('data:image/')).length,
        a: a.length, aAtt: a.filter(i => /\/wizard\/attachments\/[0-9a-f]{32}$/.test(i.src)).length, raw: /helm_attachments|"items"\s*:|"sha256"/.test(document.querySelector('.ch-msgs').textContent) };
    });
    ok(r.u >= 1 && r.uLoaded >= 1 && r.uData >= 1, 'real thread: James’s own photo (inline image part) shows in his bubble', r);
    await reveal('.msg.u .mimg'); await sleep(700);
    await p.screenshot({ path: `${OUT}/01-real-user-photo.png` });
    const nA = await p.locator('.msg.a .mimg').count();
    for (let k = 0; k < nA; k++) { await p.evaluate(k => { const el = document.querySelectorAll('.msg.a .mimg')[k]; el.setAttribute('data-qa-reveal', ''); }, k); await reveal('[data-qa-reveal]'); await p.evaluate(() => document.querySelector('[data-qa-reveal]').removeAttribute('data-qa-reveal')); await sleep(150); }
    await p.waitForFunction(() => [...document.querySelectorAll('.msg.a .mimg img')].filter(i => i.complete && i.naturalWidth > 0).length >= 2, null, { timeout: 30000 }).catch(() => {});
    const a2 = await p.evaluate(() => [...document.querySelectorAll('.msg.a .mimg img')].filter(i => i.naturalWidth > 0).length);
    ok(r.a >= 2 && r.aAtt === r.a && a2 >= 2, 'real thread: Archimedes’s helm_attachments images render as photos', { ...r, loaded: a2 });
    ok(!r.raw, 'real thread: no raw attachment JSON in any bubble');
    await reveal('.msg.a .mimg'); await sleep(700);
    await p.screenshot({ path: `${OUT}/02-real-assistant-images.png` });
    await p.locator('.msg.a .mimg').first().tap();
    await p.waitForFunction(() => { const i = document.querySelector('.mviewer .mv-stage img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 15000 }).catch(() => {});
    const vr = await p.evaluate(() => { const i = document.querySelector('.mviewer .mv-stage img'); const r = i?.getBoundingClientRect(); return { ...__wos.viewer, w: i?.naturalWidth || 0, shownW: Math.round(r?.width || 0) }; });
    ok(vr.open && vr.kind === 'image' && vr.w > 0 && vr.shownW >= 380, 'real thread: tapping Archimedes’s image opens it full-screen in the viewer', vr);
    await p.screenshot({ path: `${OUT}/02b-real-image-viewer.png` });
    await back();
    ok(!(await p.evaluate(() => __wos.viewer.open)) && (await thread()) === REAL_THREAD, 'Back closes it and stays in the thread');
  }

  /* ===== #2: fixture photo cases, incl. photo-only turns keeping their turn ===== */
  await openThread('qa_media_thread');
  {
    const r = await p.evaluate(() => {
      const msgs = [...document.querySelectorAll('.ch-msgs > .msg')];
      const seq = msgs.map(m => (m.classList.contains('u') ? 'U' : 'A') + (m.querySelector('.mimg') ? '+img' : '') + ':' + (m.querySelector('.bub').innerText || '').trim().slice(0, 28));
      return { seq };
    });
    const i1 = r.seq.findIndex(s => s.startsWith('A') && /purple square/.test(s));
    ok(i1 > 0 && /^U\+img:$/.test(r.seq[i1 - 1]), 'photo-only message (inline image) keeps its turn; the reply follows it', r.seq);
    const i2 = r.seq.findIndex(s => s.startsWith('A') && /Got the screenshot/.test(s));
    ok(i2 > 0 && /^U\+img:$/.test(r.seq[i2 - 1]), 'photo via Wizard Files shows as a photo, no “Please use the attached file.” text', r.seq);
    ok(r.seq.some(s => /^U\+img:What about this one\?/.test(s)), 'text + inline photo show together in one bubble', r.seq);
  }

  /* ===== #3: assistant attachments ===== */
  {
    const r = await p.evaluate(() => {
      const a = [...document.querySelectorAll('.msg.a')].find(m => /Here are the files/.test(m.textContent));
      return a && { imgs: a.querySelectorAll('.mimg img').length, audio: !!a.querySelector('audio[src*="/wizard/attachments/"]'), transcript: /hello there/.test(a.textContent),
        cards: [...a.querySelectorAll('.mcard')].map(c => c.textContent.trim()), raw: /helm_attachments|"items"|"mime"/.test(a.textContent) };
    });
    ok(r && r.imgs === 2, 'assistant images from <helm_attachments> render as photos', r);
    ok(r && r.audio && r.transcript, 'assistant audio renders as a player with its transcript', r);
    ok(r && r.cards.some(c => /clip\.mp4/.test(c) && /Video/.test(c)) && r.cards.some(c => /notes\.md/.test(c)) && r.cards.some(c => /report\.pdf/.test(c) && /PDF/.test(c)), 'video and files render as cards', r?.cards);
    ok(r && !r.raw, 'no raw attachment JSON in the bubble');
  }

  /* ===== #16: Markdown ===== */
  {
    const r = await p.evaluate(() => {
      const a = [...document.querySelectorAll('.msg.a .bub')].find(m => /Plan/.test(m.textContent)); if (!a) return null;
      return { h1: a.querySelector('h1')?.textContent, em: a.querySelectorAll('em').length, strong: a.querySelectorAll('strong').length, quote: a.querySelector('blockquote')?.textContent.trim(),
        nested: !!a.querySelector('ul > li > ul > li > ol > li'), th: [...a.querySelectorAll('table th')].map(x => x.textContent), tdAlign: a.querySelector('table td:last-child')?.style.textAlign,
        code: a.querySelector('.code pre')?.textContent, lang: a.querySelector('.code-h span')?.textContent, codeCopy: !!a.querySelector('.code [data-codecopy]'), session: a.querySelector('a.wsl')?.dataset.session };
    });
    ok(r && r.h1 === 'Plan', 'Markdown: headings', r);
    ok(r && r.em >= 2 && r.strong >= 1, 'Markdown: italics (* and _) and bold', r);
    ok(r && /A quoted line/.test(r.quote || ''), 'Markdown: block quotes', r);
    ok(r && r.nested, 'Markdown: nested lists (ul > ul > ol)', r);
    ok(r && r.th.join('|') === 'Name|Score' && r.tdAlign === 'right', 'Markdown: real tables with alignment', r);
    ok(r && r.code === 'echo "hello" && ls -la' && r.lang === 'bash' && r.codeCopy, 'Markdown: fenced code with language + Copy', r);
    ok(r && r.session === 'qa_ready_thread', 'Markdown: @session link recognised', r);
    await p.evaluate(() => [...document.querySelectorAll('.msg.a .bub')].find(m => /Plan/.test(m.textContent)).setAttribute('data-qa-md', '')); await reveal('[data-qa-md]', 'start'); await sleep(300);
    await p.screenshot({ path: `${OUT}/03-markdown.png` });
  }

  /* ===== #5: select / copy / share ===== */
  {
    const sel = await p.evaluate(() => { const el = [...document.querySelectorAll('.msg.a .bub p')].find(x => /italic/.test(x.textContent)); return { us: getComputedStyle(el).userSelect || getComputedStyle(el).webkitUserSelect, uus: getComputedStyle(document.querySelector('.msg.u .bub')).userSelect }; });
    ok(sel.us === 'text' && sel.uus === 'text', 'message text is selectable (user-select: text)', sel);
    const picked = await p.evaluate(() => { const el = [...document.querySelectorAll('.msg.a .bub p')].find(x => /italic/.test(x.textContent)); const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return s.toString(); });
    ok(/Here is italic/.test(picked), 'a selection inside a bubble yields the text', picked);
    await p.evaluate(() => getSelection().removeAllRanges());
    await p.locator('.code [data-codecopy]').first().tap(); await sleep(300);
    ok((await p.evaluate(() => navigator.clipboard.readText())) === 'echo "hello" && ls -la', 'code block Copy puts the exact code on the clipboard');
    ok(/Copied/.test(await p.locator('.code [data-codecopy]').first().textContent()), 'code Copy confirms “Copied”');
    const mdMsg = p.locator('.msg.a', { hasText: 'Plan' }).first();
    await mdMsg.locator('[data-mcopy]').tap(); await sleep(300);
    const clip = await p.evaluate(() => navigator.clipboard.readText());
    ok(clip.startsWith('# Plan') && clip.includes('| Alpha | 1 |'), 'response Copy copies the full Markdown source', clip.slice(0, 40));
    await mdMsg.locator('[data-mshare]').tap(); await sleep(300);
    const sh = await p.evaluate(() => window.__shares.slice(-1)[0]);
    ok(sh && sh.text.startsWith('From Archimedes:\n\n# Plan'), 'Share response opens the share sheet with the attributed text', sh);
    const h0 = await p.evaluate(() => document.querySelector('.ch-head').getBoundingClientRect().height);
    ok(h0 <= 56, 'thread header stays one compact row', h0);
  }

  /* ===== #15: timestamps + day dividers (Bangkok) ===== */
  {
    const r = await p.evaluate(() => ({ days: [...document.querySelectorAll('.ch-day')].map(x => x.textContent), times: [...document.querySelectorAll('.msg time')].map(t => ({ t: t.textContent, title: t.title })) }));
    const bkk = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false });
    ok(r.days.join(',') === 'Yesterday,Today', 'day dividers: Yesterday, Today', r.days);
    ok(r.times.length >= 8 && r.times.every(x => / Bangkok$/.test(x.title)), 'every message has a time, full Bangkok date on hover', r.times.slice(0, 3));
    // Today's messages show only HH:MM; any other day carries its date too (James, 11 Oct).
    const bkkDay = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(YDAY * 1000));
    ok(r.times.slice(0, 2).every(x => x.t === `${bkkDay}, ${bkk.format(new Date(YDAY * 1000))}` || x.t === `${bkkDay}, ${bkk.format(new Date((YDAY + 30) * 1000))}`), 'yesterday\'s messages show date + time', { want: bkkDay, got: r.times.slice(0, 2) });
    ok(r.times.slice(2).every(x => /^\d\d:\d\d$/.test(x.t)), 'today\'s messages show only HH:MM', r.times.slice(2, 5));
    ok(r.times.some(x => x.t === bkk.format(new Date((now - 120) * 1000))), 'times are Bangkok local time', { want: bkk.format(new Date((now - 120) * 1000)), got: r.times.map(x => x.t) });
  }

  /* ===== #4 / #25: in-app media viewer + Back ===== */
  {
    const pages0 = ctx.pages().length, url0 = p.url();
    await p.locator('.msg.a .mimg').first().tap(); await sleep(500);
    let v = await p.evaluate(() => __wos.viewer);
    ok(v.open && v.kind === 'image' && v.n === 5, 'tapping a photo opens the in-app viewer with the thread’s photos as a gallery', v);
    ok(ctx.pages().length === pages0 && p.url() === url0, 'the app did not navigate away or open a tab');
    const shift = await shellShift();
    ok(shift.length === 0, 'the app shell itself never scrolls (viewer fills the screen)', shift);
    ok(await p.evaluate(() => { const r = document.querySelector('.mviewer').getBoundingClientRect(), d = document.getElementById('device').getBoundingClientRect(); return Math.abs(r.top - d.top) < 2 && Math.abs(r.bottom - d.bottom) < 2; }), 'viewer covers the whole screen');
    await p.screenshot({ path: `${OUT}/04-viewer-image.png` });
    const c = await center('.mv-stage');
    await pinch(c[0], c[1], 40, 140); await sleep(300);
    v = await p.evaluate(() => __wos.viewer);
    ok(v.scale > 1.8, 'pinch zooms the photo', v.scale);
    await p.screenshot({ path: `${OUT}/05-viewer-pinch.png` });
    await sleep(400); const tapT = Date.now(); await touch('touchStart', [[c[0], c[1]]]); await touch('touchEnd', []); await touch('touchStart', [[c[0], c[1]]]); await touch('touchEnd', []); const tapMs = Date.now() - tapT; await sleep(350);
    v = await p.evaluate(() => __wos.viewer);
    ok(v.scale === 1, 'double-tap resets zoom', { scale: v.scale, tapMs });
    const i0 = v.i;
    await swipe(c[0] + 120, c[1], c[0] - 120, c[1]); await sleep(350);
    v = await p.evaluate(() => __wos.viewer);
    ok(v.i === (i0 + 1) % v.n, 'swipe left goes to the next photo', { i0, i: v.i });
    await p.locator('.mviewer [data-mv="share"]').tap(); await sleep(600);
    const sh = await p.evaluate(() => window.__shares.slice(-1)[0]);
    ok(sh && sh.files.length === 1 && /^image\//.test(sh.files[0].type) && sh.files[0].size > 0, 'Share sends the photo itself as a file', sh);
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 5000 }).catch(() => null), p.locator('.mviewer [data-mv="save"]').tap()]);
    ok(!!dl && /\.png$/.test(dl.suggestedFilename()), 'Save downloads the photo', dl && dl.suggestedFilename());
    await back();
    v = await p.evaluate(() => __wos.viewer);
    ok(!v.open && (await thread()) === 'qa_media_thread', 'Back closes the viewer; the thread stays open', { v, t: await thread() });
    ok((await p.evaluate(() => __wos.back.log.slice(-1)[0])) === 'viewer', 'Back step recorded as “viewer”');
    // Video
    await p.locator('.mcard', { hasText: 'clip.mp4' }).tap(); await sleep(400);
    v = await p.evaluate(() => ({ ...__wos.viewer, video: !!document.querySelector('.mviewer video[controls]') }));
    ok(v.open && v.kind === 'video' && v.video, 'video opens in the in-app player', v);
    ok((await p.evaluate(() => __wosNativeBack())) === 'viewer' && !(await p.evaluate(() => __wos.viewer.open)), 'Android Back (native bridge) closes the player first');
    // Markdown file viewer
    await p.locator('.mcard', { hasText: 'notes.md' }).tap();
    await p.waitForSelector('.mviewer .mv-doc h1', { timeout: 5000 }).catch(() => {});
    v = await p.evaluate(() => ({ ...__wos.viewer, h1: document.querySelector('.mviewer .mv-doc h1')?.textContent, li: document.querySelectorAll('.mviewer .mv-doc li').length, copy: !document.querySelector('.mviewer [data-mv="copy"]').hidden }));
    ok(v.open && v.h1 === 'Notes title' && v.li === 2 && v.copy, 'Markdown file opens rendered in the file viewer, with Copy', v);
    await p.screenshot({ path: `${OUT}/06-viewer-markdown.png` });
    await back();
    await p.locator('.mcard', { hasText: 'report.pdf' }).tap(); await sleep(400);
    v = await p.evaluate(() => ({ ...__wos.viewer, card: document.querySelector('.mviewer .mv-file b')?.textContent }));
    ok(v.open && v.kind === 'file' && v.card === 'report.pdf', 'other files open as a file card with Share / Save', v);
    await back();
    // Own photo opens too.
    await p.locator('.msg.u .mimg').first().tap(); await sleep(300);
    ok((await p.evaluate(() => __wos.viewer)).open, 'James’s own photo opens in the viewer');
    await back(); await back();
    ok((await thread()) === null && p.url().includes('/wizard-os-home/'), 'next Back leaves the thread for the list; the app stays open');
    await openThread('qa_media_thread');
  }

  /* ===== #16: @session link opens the thread in-app ===== */
  {
    await p.locator('a.wsl').first().tap(); await sleep(800);
    ok((await thread()) === 'qa_ready_thread' && p.url().includes('/wizard-os-home/'), '@session link opens that thread inside Chats');
  }

  /* ===== #10: load earlier ===== */
  {
    await openThread('qa_long_thread');
    let r = await p.evaluate(() => ({ n: document.querySelectorAll('.msg.u').length, btn: document.querySelector('[data-chearlier]')?.textContent, first: document.querySelector('.msg.u .bub')?.textContent.trim() }));
    ok(r.n === 60 && /90 more/.test(r.btn || ''), 'long thread shows the latest 60 turns + “Load earlier”', r);
    await p.evaluate(() => { document.querySelector('.ch-msgs').scrollTop = 0; }); await sleep(200);
    const anchor = await p.evaluate(() => { const box = document.querySelector('.ch-msgs'); const el = document.querySelectorAll('.msg.u')[0]; return { txt: el.querySelector('.bub').textContent.trim(), top: el.getBoundingClientRect().top - box.getBoundingClientRect().top, st: box.scrollTop, sh: box.scrollHeight }; });
    await p.locator('[data-chearlier]').tap(); await sleep(400);
    r = await p.evaluate(a => { const el = [...document.querySelectorAll('.msg.u .bub')].find(b => b.textContent.trim() === a.txt); const box = document.querySelector('.ch-msgs'); return { n: document.querySelectorAll('.msg.u').length, top: el && el.closest('.msg').getBoundingClientRect().top - box.getBoundingClientRect().top, btn: document.querySelector('[data-chearlier]')?.textContent, st: box.scrollTop, sh: box.scrollHeight }; }, anchor);
    ok(r.n === 120 && /30 more/.test(r.btn || ''), 'Load earlier adds 60 more turns', r);
    ok(r.top != null && Math.abs(r.top - anchor.top) < 4, 'scroll position is kept (the message you were reading stays put)', { anchor, r });
    await p.locator('[data-chearlier]').tap(); await sleep(400);
    r = await p.evaluate(() => ({ n: document.querySelectorAll('.msg.u').length, btn: !!document.querySelector('[data-chearlier]'), first: document.querySelector('.msg.u .bub')?.textContent.trim() }));
    ok(r.n === 150 && !r.btn && r.first === 'Question number 0', 'all 150 turns reachable, button gone at the start', r);
  }

  /* ===== #8: approvals ===== */
  {
    await openThread('qa_appr_thread');
    await p.waitForSelector('.appr [data-approve]', { timeout: 10000 }).catch(() => {});
    const r = await p.evaluate(() => ({ labels: [...document.querySelectorAll('.appr [data-approve]')].map(b => b.textContent), action: document.querySelector('.appr pre')?.textContent }));
    ok(r.labels.join('|') === 'Allow once|Allow for this chat|Always allow|Deny' && r.action === 'rm -rf /tmp/qa-scratch', 'approval card shows the request with Wizard’s choices', r);
    await p.screenshot({ path: `${OUT}/07-approval.png` });
    const n0 = writes.length;
    await p.locator('.appr [data-approve="deny"]').tap(); await sleep(700);
    const w = writes.slice(n0).find(x => /\/approval$/.test(x.p));
    ok(w && w.p === '/wizard/hermes/v1/runs/qa-run-appr/approval' && JSON.stringify(JSON.parse(w.body)) === JSON.stringify({ choice: 'deny', request_id: 'qa-req-1' }), 'Deny posts {choice, request_id} to the run’s approval endpoint', w);
    ok(/Denied/.test(await p.locator('.appr').textContent()), 'card shows the decision (“Denied”)');
    ok(writes.slice(n0).filter(x => /\/approval$/.test(x.p)).length === 1, 'one tap sends exactly one decision');
  }

  /* ===== #9: Stop ===== */
  {
    await openThread('qa_run_thread');
    ok(await p.locator('[data-chstop]').isVisible(), 'a running reply shows a Stop button');
    await p.screenshot({ path: `${OUT}/08-stop.png` });
    const n0 = writes.length;
    await p.locator('[data-chstop]').tap(); await sleep(600);
    const w = writes.slice(n0).find(x => /\/stop$/.test(x.p));
    ok(w && w.p === '/wizard/hermes/v1/runs/qa-run-live/stop' && w.m === 'POST', 'Stop posts to /v1/runs/:id/stop', w);
    ok(/Stopping/.test(await p.locator('.ch-head .ti').getAttribute('title')), 'header status (title hint) says “Stopping…”');
  }

  /* ===== #6: drafts per thread, kept across reloads (new chat too) ===== */
  {
    const wid = await chatsWin();
    await openThread('qa_ready_thread'); await p.fill('.ch-compose textarea', 'draft for ready');
    await openThread('qa_done_thread');
    ok((await p.inputValue('.ch-compose textarea')) === '', 'a draft does not leak into another thread');
    await p.fill('.ch-compose textarea', 'draft for done');
    await p.evaluate(wid => __wos.openChat(wid, '__new__'), wid); await sleep(300);
    ok((await p.inputValue('.ch-compose textarea')) === '', 'new chat starts empty');
    await p.fill('.ch-compose textarea', 'draft for a new chat'); await sleep(100);
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__wos?.live?.ok && window.__wos.live.session('qa_ready_thread'), null, { timeout: 90000 }).catch(() => {});
    await p.evaluate(() => __wos.goDesk(1)); await sleep(500);
    await sleep(300);
    ok((await p.inputValue('.ch-compose textarea').catch(() => '')) === 'draft for a new chat', 'new-chat draft survives a reload');
    await openThread('qa_ready_thread');
    ok((await p.inputValue('.ch-compose textarea')) === 'draft for ready', 'thread draft survives a reload (thread A)');
    await openThread('qa_done_thread');
    ok((await p.inputValue('.ch-compose textarea')) === 'draft for done', 'thread draft survives a reload (thread B)');
    await p.fill('.ch-compose textarea', '');
    await openThread('qa_ready_thread'); await p.fill('.ch-compose textarea', '');
    const w2 = await chatsWin(); await p.evaluate(wid => __wos.openChat(wid, '__new__'), w2); await sleep(200); await p.fill('.ch-compose textarea', '');
  }

  /* ===== #7: Done / Defer / Close & file / Restore — thread header and list, optimistic ===== */
  const section = id => p.evaluate(id => { const g = __wos.live.workGroups(); return Object.keys(g).find(k => g[k].some(s => s.id === id)) || ''; }, id);
  const listSection = id => p.evaluate(id => document.querySelector(`.ch-list [data-chopen="${CSS.escape(id)}"]`)?.closest('[data-sec]')?.dataset.sec || '', id);
  {
    await openThread('qa_ready_thread');
    const acts = await p.evaluate(() => [...document.querySelectorAll('.ch-tacts [data-chact]')].map(b => b.dataset.chact));
    ok(acts.join(',') === 'defer,done', 'under the final reply: Defer / Done in one tap (Close & file retired)', acts);
    await p.screenshot({ path: `${OUT}/09-thread-actions.png` });
    holdDisposition = 1500;
    const n0 = writes.length;
    await p.locator('.ch-tacts [data-chact="defer"]').tap(); await sleep(250);
    const isDef = () => p.evaluate(() => !!__wos.live.session('qa_ready_thread')?.deferred);
    ok((await thread()) === null && (await section('qa_ready_thread')) === 'ready' && await isDef(), 'Defer: back to the list, deferred at the bottom of Ready at once (before the save returns)', await section('qa_ready_thread'));
    await sleep(1600); holdDisposition = 0;
    const w = writes.slice(n0).find(x => x.p === '/wizard/thread-dispositions');
    ok(w && w.m === 'PUT' && JSON.stringify(JSON.parse(w.body)) === JSON.stringify({ sessionId: 'qa_ready_thread', runtime: 'direct', deferred: true }), 'Defer saves through /wizard/thread-dispositions like Wizard', w);
    await p.evaluate(() => __wos.live.refresh()); await sleep(500);
    ok((await section('qa_ready_thread')) === 'ready' && await isDef(), 'Deferred survives a refresh from Wizard');
    // From the list (bottom of Ready): long-press → Restore.
    await reveal('.ch-list [data-chopen="qa_ready_thread"]'); await sleep(200);
    let c = await center('.ch-list [data-chopen="qa_ready_thread"]');
    await longPress(c[0], c[1]); await sleep(300);
    const sheet = await p.evaluate(() => ({ open: !!document.querySelector('.ch-sheet'), acts: [...document.querySelectorAll('.ch-sheet [data-rsact]')].map(b => b.dataset.rsact), t: (window.__wos.wins && Object.values(__wos.wins).find(w => w.app === 'chats').thread) }));
    ok(sheet.open && sheet.acts.join(',') === 'restore,done' && sheet.t === null, 'long-press a deferred thread → Restore / Done (list stays put)', sheet);
    await p.screenshot({ path: `${OUT}/10-list-longpress.png` });
    await back();
    ok(!(await p.evaluate(() => !!document.querySelector('.ch-sheet'))) && p.url().includes('/wizard-os-home/'), 'Back closes the actions sheet; the app stays open');
    await longPress(c[0], c[1]); await sleep(300);
    const n1 = writes.length;
    await p.locator('.ch-sheet [data-rsact="restore"]').tap(); await sleep(150);
    ok((await section('qa_ready_thread')) === 'ready' && !(await isDef()), 'Restore clears Deferred immediately (stays in Ready)', await section('qa_ready_thread'));
    await sleep(500);
    const w1 = writes.slice(n1).find(x => x.p === '/wizard/thread-dispositions');
    ok(w1 && JSON.parse(w1.body).deferred === false, 'Restore of a deferred thread saves deferred:false', w1?.body);
    // Swipe left → Done.
    await reveal('.ch-list [data-chopen="qa_done_thread"]'); await sleep(200);
    c = await center('.ch-list [data-chopen="qa_done_thread"]');
    await swipe(c[0] + 100, c[1], c[0] - 60, c[1], 10); await sleep(300);
    ok(await p.evaluate(() => !!document.querySelector('.ch-sheet [data-rsact="done"]')), 'swipe left on a thread → actions sheet');
    const n2 = writes.length;
    await p.locator('.ch-sheet [data-rsact="done"]').tap(); await sleep(120);
    ok((await section('qa_done_thread')) === 'archive', 'Done moves it to Archive at once', await section('qa_done_thread'));
    await sleep(600);
    const w2 = writes.slice(n2).find(x => /\/api\/sessions\/qa_done_thread$/.test(x.p));
    ok(w2 && w2.m === 'PATCH' && JSON.stringify(JSON.parse(w2.body)) === JSON.stringify({ archived: true }), 'Done saves archived:true on the session (PATCH), like Wizard', w2);
    // Done from under the final reply (Close & file is retired).
    await openThread('qa_file_thread');
    const n3 = writes.length;
    await p.locator('.ch-tacts [data-chact="done"]').tap(); await sleep(120);
    ok((await thread()) === null && (await section('qa_file_thread')) === 'archive', 'Done under the reply: back to the list, in Archive at once');
    await sleep(700);
    ok(!writes.slice(n3).some(x => x.p === '/wizard/filings'), 'nothing posts to the retired /wizard/filings route');
    // Restore an archived thread from inside it.
    await openThread('qa_file_thread');
    const ra = await p.evaluate(() => [...document.querySelectorAll('.ch-tacts [data-chact]')].map(b => b.dataset.chact));
    ok(ra.join(',') === 'restore', 'an archived thread offers Restore', ra);
    const n4 = writes.length;
    await p.locator('.ch-tacts [data-chact="restore"]').tap(); await sleep(150);
    ok((await section('qa_file_thread')) === 'ready', 'Restore brings an archived thread back to Ready at once', await section('qa_file_thread'));
    await sleep(600);
    const w4 = writes.slice(n4).find(x => /\/api\/sessions\/qa_file_thread$/.test(x.p));
    ok(w4 && JSON.stringify(JSON.parse(w4.body)) === JSON.stringify({ archived: false }), 'Restore saves archived:false', w4?.body);
    ok(await p.evaluate(() => !!JSON.parse(localStorage.getItem('wizard.mobile.restored-threads.v1') || '{}').qa_file_thread), 'restore time kept in Wizard’s own key');
    // A failed save puts the thread back.
    await openThread('qa_fail_thread');
    failNext = '/api/sessions/qa_fail_thread';
    await p.locator('.ch-tacts [data-chact="done"]').tap(); await sleep(120);
    const mid = await section('qa_fail_thread');
    await sleep(900);
    ok(mid === 'archive' && (await section('qa_fail_thread')) === 'ready', 'a failed save puts the thread back where it was', { mid, after: await section('qa_fail_thread') });
    ok(/Couldn’t mark done/.test(await p.locator('#toast').textContent()), 'and says so');
    ok(await p.evaluate(() => { const s = document.querySelector('.ch-head'); return !s || s.getBoundingClientRect().height <= 56; }), 'no extra vertical space used');
  }

  /* ===== #19: paste a photo; text + photo send as one turn ===== */
  {
    await openThread('qa_paste_thread');
    const n0 = writes.length;
    await p.evaluate(async b64 => {
      const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const dt = new DataTransfer(); dt.items.add(new File([bin], 'image.png', { type: 'image/png' }));
      const ta = document.querySelector('.ch-compose textarea'); ta.focus();
      ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, PNG.toString('base64'));
    await p.waitForFunction(() => document.querySelectorAll('.ch-tray .ch-att:not(.up) img').length === 1, null, { timeout: 5000 }).catch(() => {});
    const up = writes.slice(n0).filter(x => /\/files\/upload$/.test(x.p));
    ok(up.length === 1 && /^pasted-.*\.png$/.test(up[0].headers['x-wizard-filename']) && up[0].headers['x-wizard-mime'] === 'image/png', 'pasted image uploads to Wizard Files with a real filename', up.map(x => x.headers['x-wizard-filename']));
    ok(await p.locator('.ch-tray img').count() === 1, 'pasted photo shows in the tray');
    await p.fill('.ch-compose textarea', 'qa: what is in this photo?');
    await p.tap('.ch-compose [type=submit]'); await sleep(1500);
    const runs = writes.slice(n0).filter(x => /\/v1\/runs$/.test(x.p));
    const rb = runs[0] ? JSON.parse(runs[0].body) : {};
    ok(runs.length === 1 && rb.session_id === 'qa_paste_thread' && rb.input === 'qa: what is in this photo?' && rb.wizard_file_ids?.length === 1, 'text + photo go as ONE run (one turn)', runs.map(r => r.body));
    const pend = await p.evaluate(() => { const m = [...document.querySelectorAll('.msg.u.pending')].pop(); return m && { img: m.querySelectorAll('.mimg img').length, loaded: [...m.querySelectorAll('.mimg img')].filter(i => i.naturalWidth > 0).length, text: m.querySelector('.bub').textContent }; });
    ok(pend && pend.img === 1 && /what is in this photo/.test(pend.text), 'the sent photo shows in James’s bubble right away', pend);
    await p.screenshot({ path: `${OUT}/11-paste-sent.png` });
    ok((await p.inputValue('.ch-compose textarea')) === '' && await p.locator('.ch-tray').count() === 0, 'composer and tray clear after send');
    ok(await p.evaluate(() => !('direct:qa_paste_thread' in JSON.parse(localStorage.getItem('wos.chat.drafts.v1') || '{}'))), 'sent draft is cleared from storage');
  }

  /* ===== Back never exits ===== */
  {
    await back(); await back(); await back();
    ok(p.url().includes('/wizard-os-home/') && !p.isClosed(), 'repeated Back keeps Wizard OS open');
  }

  /* ===== Desktop shell: the same Chats features come from the shared web/core/chats.js ===== */
  {
    const dctx = await b.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true, acceptDownloads: true });
    await dctx.route('**/*', routeWizard);
    dctx.on('request', q => { if (q.method() !== 'GET' && q.method() !== 'HEAD' && /\/wizard\//.test(new URL(q.url()).pathname)) leaked.push(q.url()); });
    const d = await dctx.newPage();
    d.on('pageerror', e => errs.push('desktop: ' + e));
    d.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|frame-ancestors|Framing/.test(m.text())) errs.push('desktop console: ' + m.text()); });
    await d.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); } catch (e) {} });
    await d.goto(new URL('desktop.html', URL_).href, { waitUntil: 'domcontentloaded' });
    await d.waitForFunction(() => window.__wux?.live?.ok && window.__wux.live.session('qa_media_thread'), null, { timeout: 90000 }).catch(() => {});
    ok(await d.evaluate(() => document.documentElement.dataset.shell === 'desktop' && !!window.__wux?.live?.session('qa_media_thread')), 'desktop: desktop shell loads the same threads');
    const dThread = () => d.evaluate(() => Object.values(__wux.wins).find(w => w.app === 'chats')?.thread ?? null);
    const dOpen = async id => {
      await d.evaluate(id => __wux.openThread(id), id);
      await d.waitForFunction(id => { const w = Object.values(__wux.wins).find(x => x.app === 'chats'); return w?.thread === id && document.querySelector('.pane-main .ch-msgs .msg'); }, id, { timeout: 30000 }).catch(() => {});
      await sleep(600);
    };
    const dReveal = sel => d.evaluate(sel => { const el = document.querySelector(sel); if (!el) return false; let sc = el.parentElement; while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement; if (!sc) return false; const r = el.getBoundingClientRect(), bb = sc.getBoundingClientRect(); sc.scrollTop += (r.top + r.height / 2) - (bb.top + bb.height / 2); return true; }, sel);
    await dOpen(REAL_THREAD);
    await dReveal('.pane-main .msg.u .mimg'); await sleep(300);
    await d.waitForFunction(() => [...document.querySelectorAll('.pane-main .msg.u .mimg img')].some(i => i.complete && i.naturalWidth > 0), null, { timeout: 30000 }).catch(() => {});
    for (let k = 0; k < await d.locator('.pane-main .msg.a .mimg').count(); k++) { await d.evaluate(k => document.querySelectorAll('.pane-main .msg.a .mimg')[k].scrollIntoView({ block: 'center' }), k); await sleep(150); }
    await d.waitForFunction(() => [...document.querySelectorAll('.pane-main .msg.a .mimg img')].filter(i => i.complete && i.naturalWidth > 0).length >= 2, null, { timeout: 30000 }).catch(() => {});
    const r = await d.evaluate(() => {
      const u = [...document.querySelectorAll('.pane-main .msg.u .mimg img')], a = [...document.querySelectorAll('.pane-main .msg.a .mimg img')];
      return { u: u.filter(i => i.naturalWidth > 0 && i.src.startsWith('data:image/')).length, a: a.filter(i => i.naturalWidth > 0 && /\/wizard\/attachments\/[0-9a-f]{32}$/.test(i.src)).length,
        raw: /helm_attachments|"items"\s*:|"sha256"/.test(document.querySelector('.pane-main .ch-msgs').textContent),
        acts: [...document.querySelectorAll('.pane-main .ch-tacts [data-chact]')].map(b => b.dataset.chact) };
    });
    ok(r.u >= 1 && r.a >= 2 && !r.raw, 'desktop: real thread shows James’s photo in his bubble and Archimedes’s images, no raw JSON', r);
    ok(r.acts.length >= 1 && (r.acts.includes('done') || r.acts.includes('restore')), 'desktop: the thread carries the Defer / Done (or Restore) actions', r.acts);
    await dReveal('.pane-main .msg.u .mimg'); await sleep(500);
    await d.screenshot({ path: `${OUT}/12-desktop-real-thread.png` });
    await d.locator('.pane-main .msg.a .mimg').first().click();
    await d.waitForFunction(() => { const i = document.querySelector('.mviewer .mv-stage img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 15000 }).catch(() => {});
    const v = await d.evaluate(() => __wux.chats.KIT.viewer.state);
    ok(v.open && v.kind === 'image', 'desktop: clicking an image opens the in-app viewer', v);
    await d.screenshot({ path: `${OUT}/13-desktop-viewer.png` });
    await d.keyboard.press('Escape'); await sleep(400);
    ok(!(await d.evaluate(() => __wux.chats.KIT.viewer.state.open)) && (await dThread()) === REAL_THREAD, 'desktop: Esc closes the viewer and stays in the thread');
    await d.evaluate(() => history.back()); await sleep(500);
    ok(d.url().includes('/wizard-os-home/') && !d.isClosed(), 'desktop: browser Back keeps Wizard OS open');
    // Fixture thread: Markdown, Copy and the one-tap Defer, all through the shared client.
    await dOpen('qa_media_thread');
    const mdOk = await d.evaluate(() => { const m = document.querySelector('.pane-main .ch-msgs'); return !!(m.querySelector('table') && m.querySelector('blockquote') && m.querySelector('pre code') && m.querySelector('em')); });
    ok(mdOk, 'desktop: full Markdown (table, quote, code, italics) renders');
    await dOpen('qa_done_thread');
    const n0 = writes.length;
    const acts = await d.evaluate(() => [...document.querySelectorAll('.pane-main .ch-tacts [data-chact]')].map(b => b.dataset.chact));
    if (acts.includes('restore')) { await d.locator('.pane-main .ch-tacts [data-chact="restore"]').click(); await sleep(400); await dOpen('qa_done_thread'); }
    const acts2 = await d.evaluate(() => [...document.querySelectorAll('.pane-main .ch-tacts [data-chact]')].map(b => b.dataset.chact));
    ok(acts2.join(',') === 'defer,done', 'desktop: Defer / Done under the final reply', acts2);
    await d.screenshot({ path: `${OUT}/14-desktop-thread-actions.png` });
    await d.locator('.pane-main .ch-tacts [data-chact="defer"]').click(); await sleep(250);
    ok((await dThread()) !== 'qa_done_thread' && await d.evaluate(() => { const g = __wux.live.workGroups(); return (g.ready || []).some(s => s.id === 'qa_done_thread' && s.deferred); }), 'desktop: Defer from the header files it under Deferred at once');
    await sleep(600);
    const dw = writes.slice(n0).find(x => x.p === '/wizard/thread-dispositions');
    ok(dw && dw.m === 'PUT' && JSON.parse(dw.body).sessionId === 'qa_done_thread' && JSON.parse(dw.body).deferred === true, 'desktop: Defer saves through /wizard/thread-dispositions (intercepted)', dw?.body);
    await dctx.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
    await dctx.close();
  }

  const realRuns = writes.filter(w => /\/v1\/runs/.test(w.p) && !/qa-/.test(w.p) && !(w.p.endsWith('/v1/runs')));
  ok(realRuns.length === 0, 'no write touched a real run', realRuns);
  ok(leaked.length === writes.length, 'every Wizard write was intercepted (none reached Wizard)', `${leaked.length} seen vs ${writes.length} intercepted`);
  const refused1 = await refusedAt();
  if (refused0 != null) ok(refused1 === refused0, 'QA origin refused zero writes (nothing got past the browser fence)', { refused0, refused1 });
  ok(errs.length === 0, 'no page errors', errs.join(' | '));
  console.log(`\n${pass} passed, ${fail} failed · intercepted writes: ${writes.length}`);
  await ctx.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
