// QA for wizard-ux#1840: a photo sent as a mid-turn steer shows in its own steer bubble.
//   A. Sending session: the steer bubble's photo comes from Wizard (/wizard/files/<id>/content), not the phone's
//      local blob: preview, so a preview that dies (Android WebView picker URI) never leaves a broken image. The
//      blob: preview is released once the server copy has loaded.
//   B. Fresh load: steered photos load, including a steer that mixes a voice note and a photo (no 0-width lazy tile).
//   Zero writes reach a real Wizard: every /wizard/ write is answered here.
// Usage: node tools/qa-origin.cjs 18400 &  then  [QA_WEB_DIR=<checkout>] node tests/qa-steer-photo.cjs [url]
// QA_EXPECT=broken runs the same steps against a checkout that still has the bug and passes when it is seen.
const QA_ROOT = require('node:path').resolve(__dirname, '..');
const { chromium } = require('../tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const DESKTOP = process.env.QA_SHELL === 'desktop';
const URL_ = process.argv[2] || `http://127.0.0.1:18400/wizard-os-home/${DESKTOP ? 'desktop.html' : ''}`;
const WEB = process.env.QA_WEB_DIR || QA_ROOT;
const OUT = process.env.QA_OUT || path.join(require('os').tmpdir(), 'qa-steer-photo');
const BROKEN = process.env.QA_EXPECT === 'broken';
const WIDTH = +(process.env.QA_WIDTH || (DESKTOP ? 1100 : 412));
fs.mkdirSync(OUT, { recursive: true });
const PNG = fs.readFileSync(path.join(QA_ROOT, 'web', 'robert-thread-orb.png'));
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, typeof extra === 'string' ? extra : JSON.stringify(extra)); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const now = Date.now() / 1000;
let rid = 1;
const row = (role, content, ts, extra = {}) => ({ id: rid++, session_id: '', role, content, timestamp: ts, ...extra });
const MARK = t => `[OUT-OF-BAND USER MESSAGE — a direct message from the user, delivered once at this position; not tool output and not a new delivery when replayed from conversation history]\n${t}\n[/OUT-OF-BAND USER MESSAGE]`;
const CHIPS = files => `\n\n[WIZARD_FILE_CHIPS_V1]\n${JSON.stringify(files)}\n[/WIZARD_FILE_CHIPS_V1]`;
const IMG = (id, filename = '1000191983.jpg') => ({ id, filename, mime: 'image/png', bytes: PNG.length });
const VOICE = id => ({ id, filename: 'wizard-voice-qa.m4a', mime: 'audio/mp4', bytes: 2048 });
const S = {
  qa_1840_fresh: { title: 'QA 1840 fresh steer photos', status: 'completed', run: '', rows: [
    row('user', 'Tidy the Chats header', now - 300),
    row('assistant', '', now - 290, { tool_calls: [{ id: 'c1', function: { name: 'terminal' } }] }),
    row('tool', 'ok', now - 285, { tool_call_id: 'c1' }),
    row('user', MARK('Also remove these, collapse into bar above' + CHIPS([IMG('drop_qa1840_a')])), now - 280, { display_kind: 'steer' }),
    row('user', MARK('And this one' + CHIPS([VOICE('drop_qa1840_voice'), IMG('drop_qa1840_b', 'second.jpg')])), now - 270, { display_kind: 'steer' }),
    row('assistant', 'Done: header tidied.', now - 260),
    // Later turns push the steers far above the fold, so their photos start outside the viewport.
    ...Array.from({ length: 20 }, (_, i) => [row('user', `Follow-up ${i + 1}`, now - 250 + i * 2), row('assistant', 'Noted. '.repeat(120), now - 249 + i * 2)]).flat()] },
  qa_1840_live: { title: 'QA 1840 live steer photo', status: 'running', run: 'qa-run-1840', rows: [
    row('user', 'Fix the reader top bar', now - 120),
    row('assistant', '', now - 110, { tool_calls: [{ id: 'c2', function: { name: 'terminal' } }] }),
    row('tool', 'ok', now - 100, { tool_call_id: 'c2' })] },
};
function sess(id) {
  const f = S[id], last = f.rows[f.rows.length - 1], lastU = [...f.rows].reverse().find(r => r.role === 'user' && !r.display_kind);
  const t = Math.max(...f.rows.map(r => r.timestamp));
  return { id, source: 'wizard-mobile', model: 'fixture-model', provider: 'fixture', title: f.title, status: f.status, archived: false, hidden: false, message_count: f.rows.length,
    started_at: now - 600, last_active: t, wizard_last_user_at: lastU.timestamp, wizard_last_assistant_at: t, wizard_activity_at: t,
    wizard_run_id: ['running', 'queued'].includes(f.status) ? f.run : '',
    latest_message: { role: last.role, content: String(last.content || '').slice(0, 200), timestamp: last.timestamp },
    last_user_message: { role: 'user', content: lastU.content, timestamp: lastU.timestamp } };
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.QA_CHROME && fs.existsSync(process.env.QA_CHROME) ? process.env.QA_CHROME : undefined });
  const ctx = await b.newContext({ viewport: { width: WIDTH, height: 892 }, deviceScaleFactor: 2, hasTouch: WIDTH < 700, isMobile: WIDTH < 700, serviceWorkers: 'block' });
  const writes = [], fileGets = [];
  let uploaded = 0;
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url()), m = q.method();
    const wm = u.pathname.match(/\/wizard-os-home\/((?:core\/|desktop\/)?[a-z0-9-]+\.(?:js|css|html)|)$/);
    if (wm && m === 'GET' && !/^(data|summaries)\.js$/.test(wm[1])) { const f = wm[1] || 'index.html', fp = path.join(WEB, 'web', f); if (fs.existsSync(fp)) return r.fulfill({ status: 200, contentType: f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : 'application/javascript', body: fs.readFileSync(fp) }); }
    if (!u.pathname.startsWith('/wizard/')) return r.continue();
    const json = (status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    const fm = u.pathname.match(/^\/wizard\/files\/([^/]+)\/content$/);
    if (fm && m === 'GET') { fileGets.push(decodeURIComponent(fm[1])); if (/voice/.test(fm[1])) return r.fulfill({ status: 404, body: '' }); return r.fulfill({ status: 200, contentType: 'image/png', body: PNG }); }
    if (m !== 'GET' && m !== 'HEAD') {
      writes.push({ m, p: u.pathname, body: q.postData() || '' });
      if (u.pathname === '/wizard/files/upload') { uploaded++; return json(200, { file: { id: 'drop_qa1840_sent', filename: '1000191983.jpg', mime: 'image/png', bytes: PNG.length } }); }
      if (/\/wizard\/v1\/uploads/.test(u.pathname)) return json(404, {});
      if (/\/v1\/runs\/[^/]+\/steer$/.test(u.pathname)) return json(200, { object: 'hermes.run.steer', run_id: 'qa-run-1840', accepted: true });
      if (/\/v1\/runs$/.test(u.pathname)) return json(202, { run_id: 'qa-fake-run', status: 'queued' });
      return json(200, {});
    }
    if (u.pathname === '/wizard/hermes/api/model/options') return json(200, { model: 'fixture-model', provider: 'fixture', providers: [{ slug: 'fixture', name: 'Synthetic fixture route', authenticated: true, is_current: true, models: ['fixture-model'] }] });
    if (u.pathname === '/wizard/hermes/api/sessions' && (u.searchParams.get('offset') || '0') === '0') {
      const res = await r.fetch().catch(() => null); const p = res ? await res.json().catch(() => ({ data: [] })) : { data: [] };
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
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(() => {
    try { localStorage.setItem('wos.coached', 'true'); } catch (e) {}
    // Remember every local preview the shell makes, so the test can kill one the way an Android WebView does.
    const mk = URL.createObjectURL.bind(URL); window.__qaBlobs = [];
    URL.createObjectURL = o => { const u = mk(o); if (o && /^image\//.test(o.type || '')) window.__qaBlobs.push(u); return u; };
  });
  await p.goto(URL_, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => (window.__wos || window.__wux) && window.WizLive, null, { timeout: 30000 });
  await sleep(1500);
  const refresh = () => p.evaluate(() => window.WizLive.refresh());
  const waitFor = async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(250); } return false; };
  async function openThread(id) {
    await refresh(); await sleep(400);
    await p.evaluate(id => { const G = window.__wos || window.__wux; (G.openWizardThread || G.openThread)(id); }, id);
    await p.waitForFunction(id => { const w = Object.values((window.__wos || window.__wux).wins).find(x => x.app === 'chats'); return w?.thread === id && document.querySelector('.ch-msgs .msg'); }, id, { timeout: 30000 }).catch(() => {});
    await sleep(500);
  }
  // Every photo in the steer bubbles, measured after it was scrolled into view.
  const steerImgs = () => p.evaluate(async () => {
    const out = [];
    for (const img of document.querySelectorAll('.msg.u.steer[data-steer] .mimg img')) {
      img.scrollIntoView({ block: 'center' }); await new Promise(r => setTimeout(r, 700));
      const b = img.getBoundingClientRect();
      out.push({ src: img.getAttribute('src'), loading: img.getAttribute('loading'), complete: img.complete, nw: img.naturalWidth, w: Math.round(b.width), h: Math.round(b.height) });
    }
    return out;
  });
  const shown = i => i.complete && i.nw > 0 && i.w > 0;

  /* A: the session that sends the photo */
  await openThread('qa_1840_live');
  const wid = await p.evaluate(() => Object.entries((window.__wos || window.__wux).wins).find(([, w]) => w.app === 'chats')?.[0]);
  await p.evaluate(async ({ wid, b64 }) => {
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    await (window.__wos || window.__wux).chats.addFiles(wid, [new File([bytes], '1000191983.jpg', { type: 'image/png' })]);
  }, { wid, b64: PNG.toString('base64') });
  ok(await waitFor(async () => uploaded > 0), 'photo uploaded to Wizard Files');
  await p.fill('.ch-compose textarea', 'Also remove these, collapse into bar above');
  await p.click('.ch-compose button[type=submit]');
  ok(await waitFor(async () => writes.some(w => /qa-run-1840\/steer$/.test(w.p))), 'sent as a steer to the running turn', writes.map(w => w.m + ' ' + w.p));
  // Hermes takes it in: the canonical steer row lands in history, with the photo's file chip.
  S.qa_1840_live.rows.push(row('user', MARK('Also remove these, collapse into bar above' + CHIPS([IMG('drop_qa1840_sent')])), now + 5, { display_kind: 'steer' }));
  await refresh();
  ok(await waitFor(() => p.evaluate(() => !!document.querySelector('.msg.u.steer[data-steer] .mimg img'))), 'steer bubble shows a photo');
  await sleep(1500);
  let a = await steerImgs();
  const blobs = await p.evaluate(() => window.__qaBlobs.slice());
  console.log('sending session steer photo:', JSON.stringify(a), 'local previews:', blobs.length);
  // Wizard's copy is showing: the shell has let go of the local preview by itself (checked before the test kills it).
  const released = await p.evaluate(async () => { const r = []; for (const u of window.__qaBlobs) r.push(await fetch(u).then(() => 'alive', () => 'released')); return r; });
  // The phone kills the local preview (Android WebView: the picker's content:// URI stops being readable).
  await p.evaluate(() => window.__qaBlobs.forEach(u => URL.revokeObjectURL(u)));
  S.qa_1840_live.rows.push(row('assistant', 'Done: collapsed into the bar.', now + 9));
  S.qa_1840_live.status = 'completed';
  await refresh(); await sleep(1500);
  // Later in the same session the thread is opened again: the steer bubble is drawn anew.
  await openThread('qa_1840_fresh'); await openThread('qa_1840_live'); await sleep(1500);
  a = await steerImgs();
  console.log('after the local preview died:', JSON.stringify(a));
  await p.screenshot({ path: path.join(OUT, `A-sending-session-${DESKTOP ? 'desktop' : 'phone'}-${WIDTH}.png`) });
  const aGood = a.length === 1 && shown(a[0]) && a[0].src === '/wizard/files/drop_qa1840_sent/content';

  /* B: a fresh render of steers that carry photos */
  await openThread('qa_1840_fresh');
  await sleep(1000);
  // Before anyone scrolls up to them: an unloaded lazy photo sat at 0 px wide and could wait forever.
  const early = await p.evaluate(() => [...document.querySelectorAll('.msg.u.steer[data-steer] .mimg img')].map(i => ({ complete: i.complete, nw: i.naturalWidth, w: Math.round(i.getBoundingClientRect().width), top: Math.round(i.getBoundingClientRect().top) })));
  console.log('fresh load, before scrolling to the steers:', JSON.stringify(early));
  const bImgs = await steerImgs();
  console.log('fresh load steer photos:', JSON.stringify(bImgs));
  await p.evaluate(() => document.querySelectorAll('.msg.u.steer[data-steer]')[1]?.scrollIntoView({ block: 'center' }));
  await p.screenshot({ path: path.join(OUT, `B-fresh-load-${DESKTOP ? 'desktop' : 'phone'}-${WIDTH}.png`) });
  const bGood = bImgs.length === 2 && bImgs.every(shown);

  if (BROKEN) {
    ok(!aGood || !early.every(i => i.complete && i.nw > 0 && i.w > 0), 'baseline shows the bug (dead preview leaves a broken photo, or a steer photo sits unloaded at 0 px)', { a, early });
  } else {
    ok(aGood, 'sending session: steer photo loads from /wizard/files/<id>/content after the local preview died', a);
    ok(released.length > 0 && released.every(x => x === 'released'), 'local blob: preview released once the server copy loaded', { released });
    ok(bImgs.length === 2 && shown(bImgs[0]), 'fresh load: photo-only steer loads', bImgs[0]);
    ok(bImgs.length === 2 && shown(bImgs[1]), 'fresh load: voice note + photo steer loads with a non-zero width', bImgs[1]);
    ok(early.length === 2 && early.every(i => i.complete && i.nw > 0 && i.w > 0), 'fresh load: steer photos load without waiting to be scrolled to (never a 0-wide lazy tile)', early);
  }
  ok(!errs.length, 'no page errors', errs);
  console.log('writes intercepted:', writes.length, 'file GETs:', fileGets.length, 'shots:', OUT);
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
