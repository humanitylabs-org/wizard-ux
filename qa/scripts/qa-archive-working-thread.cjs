// QA: Archive and Snooze while a thread is still working (wizard-ux issue 1997). Inside a thread whose run is still
// going (spinner in the header, Stop in the composer), and one whose helper is still finishing it, the action row
// offers Snooze and Archive. Archive moves the thread to Archive, never cancels the run, and the toast says it comes
// back when it's done. An approval wait keeps its approval UI and offers no Archive.
//
// Offline: the shell comes from QA_WEB_DIR/web (default: this checkout) and every /wizard/* read is answered here, so
// it needs no box. Every write is recorded, none reaches a Wizard.
// Usage: QA_PLAYWRIGHT=<dir>/node_modules/playwright-core node qa/scripts/qa-archive-working-thread.cjs
//   QA_EXPECT=broken checks the old behaviour (no Archive / Snooze while working) for a baseline tree.
//   QA_SHELL=desktop runs the desktop shell (default phone, 412 px wide).
const { chromium } = require('../../tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const URL_ = process.argv[2] || 'http://127.0.0.1:9497/wizard-os-home/';
const WEB = process.env.QA_WEB_DIR || path.join(__dirname, '..', '..');
const OUT = process.env.QA_OUT || require('../../tools/qa-paths.cjs').workPath('wos-archive-working-1997');
const BROKEN = process.env.QA_EXPECT === 'broken';
const DESKTOP = process.env.QA_SHELL === 'desktop';
const { ownerRead } = require('../../tools/qa-desktop-frame-fixture.cjs');
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === '' ? '' : JSON.stringify(extra).slice(0, 400)); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const now = Date.now() / 1000;
const FIX = {
  qa_1997_run: { title: 'QA working thread', status: 'running', run: 'qa_1997_run_1' },
  qa_1997_helper: { title: 'QA helper finishing', status: 'completed', run: '', helper: { phase: 'running', pending: 1 } },
  qa_1997_appr: { title: 'QA approval wait', status: 'waiting_for_approval', run: 'qa_1997_run_3' },
};
const ARCH = new Set();
function fixSession(id) {
  const f = FIX[id];
  return { id, agent: 'hermes', runtime: 'hermes', source: 'wizard-mobile', title: f.title, status: f.status, archived: ARCH.has(id), hidden: false, message_count: 2,
    model: 'synthetic-hotkeys', provider: 'openai-codex',
    started_at: now - 600, last_active: now - 20, wizard_last_user_at: now - 120, wizard_last_assistant_at: now - 60, wizard_activity_at: now - 20,
    wizard_run_id: f.run, wizard_last_run_status: f.run ? f.status : 'completed', ...(f.helper ? { wizard_helper_status: f.helper, wizard_background: 'helper' } : {}),
    latest_message: { role: 'assistant', content: 'Working on it: first part done.', timestamp: now - 60 },
    last_user_message: { role: 'user', content: 'Plan the launch week', timestamp: now - 120 } };
}
const rows = id => [{ id: 1, session_id: id, role: 'user', content: 'Plan the launch week', timestamp: now - 120 },
  { id: 2, session_id: id, role: 'assistant', content: 'Working on it: first part done.', timestamp: now - 60 }];
const writes = [];
const TYPES = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.md': 'text/markdown' };
async function route(r) {
  const q = r.request(), u = new URL(q.url()), m = q.method();
  const json = (status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (m === 'GET' && u.pathname.startsWith('/wizard-os-home/')) {
    const root = path.resolve(WEB, 'web'), rel = decodeURIComponent(u.pathname.slice('/wizard-os-home/'.length)) || 'index.html', f = path.resolve(root, rel);
    if (f.startsWith(root + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile()) return r.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
    return r.fulfill({ status: 404, body: '' });
  }
  if (m !== 'GET' && m !== 'HEAD') {
    const body = (q.postDataBuffer() || Buffer.alloc(0)).toString();
    writes.push({ m, p: u.pathname, body });
    const sm = u.pathname.match(/\/wizard\/hermes\/api\/sessions\/([^/]+)$/);
    if (m === 'PATCH' && sm && FIX[sm[1]]) { const b = JSON.parse(body || '{}'); if (b.archived === true) ARCH.add(sm[1]); if (b.archived === false) ARCH.delete(sm[1]); return json(200, { session: fixSession(sm[1]) }); }
    if (u.pathname.endsWith('/v1/runs')) { let b = {}; try { b = JSON.parse(body); } catch (e) {} return json(202, { run_id: 'qa_1997_new_run', session_id: b.session_id, status: 'queued' }); }
    if (u.pathname === '/wizard/thread-seen') { let st; try { st = JSON.parse(body).state; } catch (e) {} return json(200, { state: st || { initializedAt: Date.now(), threads: {} } }); }
    return json(200, { ok: true });
  }
  if (!u.pathname.startsWith('/wizard/')) return r.fulfill({ status: 404, body: '' });
  if (u.pathname === '/wizard/hermes/api/sessions') {
    const p = ownerRead(u.pathname);
    p.data = Object.keys(FIX).map(fixSession); // live and archived rows alike, as the archive-50 window does
    return json(200, p);
  }
  const mm = u.pathname.match(/\/wizard\/hermes\/api\/sessions\/([^/]+)\/messages$/);
  if (mm && FIX[mm[1]]) { const d = rows(mm[1]); return json(200, { object: 'list', data: d, pagination: { limit: 500, offset: 0, returned: d.length } }); }
  const sm = u.pathname.match(/\/wizard\/hermes\/api\/sessions\/([^/]+)$/);
  if (sm && FIX[sm[1]]) return json(200, { session: fixSession(sm[1]) });
  const rm = u.pathname.match(/\/wizard\/hermes\/v1\/runs\/([^/]+)$/);
  if (rm) { const id = Object.keys(FIX).find(k => FIX[k].run === rm[1]); return json(200, { run_id: rm[1], session_id: id, status: id ? FIX[id].status : 'completed', ...(id === 'qa_1997_appr' ? { approval: { id: 'qa_appr', command: 'rm -rf build', description: 'Delete the build folder', timestamp: now - 30 } } : {}) }); }
  if (/\/events$/.test(u.pathname)) return r.fulfill({ status: 204, body: '' });
  if (u.pathname === '/wizard/v1/bootstrap') return json(200, { bootstrap: 1, settings: {}, capabilities: { archive_returns_with_reply: true }, endpoints: {} });
  return json(200, ownerRead(u.pathname));
}

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext(DESKTOP ? { viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' }
    : { viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  await ctx.route('**/*', route);
  const p = await ctx.newPage(); p.setDefaultTimeout(8000);
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(() => { try { for (const [k, v] of Object.entries({ 'wos.coached': 'true', 'wos.voiceTipSeen': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done' })) localStorage.setItem(k, v); } catch (e) {} });
  await p.goto(URL_ + (DESKTOP ? 'desktop.html' : ''), { waitUntil: 'domcontentloaded' });
  // The phone shell is window.__wos, the desktop shell window.__wux; both carry live, wins and a thread opener.
  await p.waitForFunction(() => window.__wos || window.__wux, null, { timeout: 90000 }).catch(() => {});
  await p.evaluate(() => { window.__qa = window.__wos || window.__wux; window.__qa.goDesk?.(1); });
  await p.waitForFunction(() => window.__qa?.live?.session?.('qa_1997_run'), null, { timeout: 90000 }).catch(() => {});
  ok(await p.evaluate(() => !!window.__qa?.live?.session('qa_1997_run')), 'fixture threads loaded');
  const wid = () => p.evaluate(() => Object.values(__qa.wins).find(w => w.app === 'chats' && w.thread)?.id);
  const acts = async () => { const w = await wid(); return p.evaluate(w => [...document.querySelectorAll(`[data-chats="${w}"] .ch-tacts [data-chact], [data-chats="${w}"] [data-chact]`)].map(e => e.dataset.chact).filter((v, i, a) => a.indexOf(v) === i), w); };
  async function open(id) {
    await p.evaluate(id => (__qa.openWizardThread || __qa.openThread)(id), id);
    await p.waitForFunction(id => { const w = Object.values(__qa.wins).find(x => x.app === 'chats' && x.thread === id); return w?.thread === id && document.querySelector(`[data-chats="${w.id}"] .ch-msgs .msg.a`); }, id, { timeout: 20000 }).catch(() => {});
    await sleep(900);
  }
  const tag = DESKTOP ? 'desktop' : 'phone';
  try {
    // 1. A thread whose run is still going.
    await open('qa_1997_run');
    const working = await p.evaluate(() => { const s = __qa.live.session('qa_1997_run'); return s && s.status; });
    ok(working === 'running', `${tag} 1 thread reads as working`, working);
    const a1 = await acts();
    await p.screenshot({ path: path.join(OUT, `${tag}-1-working-thread.png`) });
    if (BROKEN) ok(!a1.includes('done') && !a1.includes('snooze'), `${tag} 1 baseline: no Archive or Snooze while working`, a1);
    else {
      ok(a1.includes('done') && a1.includes('snooze'), `${tag} 1 Archive and Snooze show while working`, a1);
      const w = await wid();
      const toast = p.waitForFunction(() => /comes back when it.s done/i.test(document.body.innerText), null, { timeout: 4000 }).then(() => true).catch(() => false);
      await p.locator(`[data-chats="${w}"] [data-chact="done"]`).first().click();
      ok(await toast, `${tag} 1 toast says it comes back when it's done`);
      await sleep(900);
      await p.screenshot({ path: path.join(OUT, `${tag}-1b-after-archive.png`) });
      ok(writes.some(x => x.m === 'PATCH' && x.p.endsWith('/qa_1997_run') && JSON.parse(x.body).archived === true), `${tag} 1 archive written`, writes.map(x => x.m + ' ' + x.p));
      ok(!writes.some(x => /\/(stop|cancel)\b/.test(x.p) || /\/runs\/[^/]+\/(stop|cancel)/.test(x.p)), `${tag} 1 the run is not stopped or cancelled`, writes.map(x => x.m + ' ' + x.p));
      const g = await p.evaluate(() => { const G = __qa.live.workGroups(); return { archive: G.archive.map(s => s.id), working: G.working.map(s => s.id) }; });
      ok(g.archive.includes('qa_1997_run') && !g.working.includes('qa_1997_run'), `${tag} 1 thread is in Archive, not Working`, g);
    }
    // 2. A thread whose helper is still finishing it.
    await open('qa_1997_helper');
    const a2 = await acts();
    await p.screenshot({ path: path.join(OUT, `${tag}-2-helper-thread.png`) });
    if (BROKEN) console.log(`${tag} 2 baseline actions while a helper finishes it:`, JSON.stringify(a2));
    else ok(a2.includes('done') && a2.includes('snooze'), `${tag} 2 Archive and Snooze show while a helper finishes it`, a2);
    // 3. Approval wait keeps its approval UI, no Archive.
    await open('qa_1997_appr');
    const a3 = await acts();
    await p.screenshot({ path: path.join(OUT, `${tag}-3-approval.png`) });
    ok(!a3.includes('done'), `${tag} 3 approval wait offers no Archive (approval kept)`, a3);
    // 4. A brand-new chat archived seconds after sending, while the box does not list it yet (only this device's
    // stand-in row): it stays in Archive through the next list reads instead of popping back into Working.
    if (!BROKEN) {
      const sid = 'qa_1997_new_' + Date.now();
      await p.waitForFunction(() => window.WosOutbox?.stage, null, { timeout: 15000 }).catch(() => {});
      await p.evaluate(async sid => { const it = await WosOutbox.stage({ kind: 'new', sessionId: sid, model: 'synthetic-hotkeys', provider: 'openai-codex', text: 'QA brand new long task' }); return it.id; }, sid);
      await p.waitForFunction(sid => !!__qa.live.session(sid), sid, { timeout: 8000 }).catch(() => {});
      const before = await p.evaluate(sid => { const G = __qa.live.workGroups(); return G.working.some(s => s.id === sid); }, sid);
      ok(before, `${tag} 4 a just-sent new chat lists as Working`);
      await p.evaluate(sid => __qa.live.archive(sid), sid);
      for (let i = 0; i < 2; i++) { await p.evaluate(() => __qa.live.refresh()); await sleep(400); }
      const g4 = await p.evaluate(sid => { const G = __qa.live.workGroups(); return { archive: G.archive.some(s => s.id === sid), working: G.working.some(s => s.id === sid) }; }, sid);
      ok(g4.archive && !g4.working, `${tag} 4 archived seconds after sending, it stays in Archive through list reads`, g4);
    }
  } catch (e) { ok(false, 'run', String(e)); }
  ok(!errs.length, `${tag} no page errors`, errs);
  console.log(`\n${pass} pass, ${fail} fail · shots in ${OUT}`);
  await b.close();
  process.exit(fail ? 1 : 0);
})();
