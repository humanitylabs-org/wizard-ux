// QA: a thread James stopped before any answer still offers Done (fix/done-on-stopped-thread).
// James, 20 Oct 2026: an accidental voice send, stopped mid-run, left a thread with no Done and no way to file it.
// Stopped/failed/interrupted threads with no answer show Done (no Defer); a running thread still shows nothing.
//
// Fixture threads merged into the real session list; EVERY write is intercepted (zero reach Archimedes).
// Usage: node tools/qa-origin.cjs 9484 <tree>/web &  then  node qa-orb-done.cjs [url]
let pw; try { pw = require('playwright-core'); } catch (e) { pw = require('/home/telos/node_modules/playwright'); }
const { chromium } = pw;
const fs = require('fs'), path = require('path');
const URL_ = process.argv[2] || 'http://127.0.0.1:9484/wizard-os-home/';
const OUT = process.env.QA_OUT || '/home/telos/.hermes/cache/scratch/wos-done-stopped-shots';
const EXEC = process.env.QA_CHROME || '/home/telos/.local/bin/google-chrome';
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra === '' ? '' : JSON.stringify(extra).slice(0, 500)); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const VW = 412, VH = 892;
const now = Date.now() / 1000;
let rid = 1;
const row = (role, content, ts) => ({ id: rid++, session_id: '', role, content, timestamp: ts });
const LONG = Array.from({ length: 14 }, (_, i) => `Paragraph ${i + 1}. ` + 'This is a long reply line that wraps across the phone width so the thread scrolls. '.repeat(3)).join('\n\n');
const FIX = {
  qa_ds_stopped: { title: 'QA stopped no answer', st: 'cancelled', t: now - 30, rows: () => [row('user', 'Accidental voice note text', now - 60)] },
  qa_ds_failed: { title: 'QA failed no answer', st: 'failed', t: now - 40, rows: () => [row('user', 'Another prompt', now - 70)] },
  qa_ds_answered: { title: 'QA answered', st: 'completed', t: now - 50, rows: () => [row('user', 'Question', now - 300), row('assistant', 'Answer', now - 250)] },
};
function fixSession(id) {
  const f = FIX[id], rows = f.rows(), last = rows[rows.length - 1], lastU = rows[0];
  return { id, source: 'wizard-mobile', title: f.title, status: f.st, wizard_last_run_status: f.st, archived: false, hidden: false, message_count: rows.length,
    started_at: f.t - 600, last_active: f.t, wizard_last_user_at: lastU.timestamp, wizard_last_assistant_at: f.t, wizard_activity_at: f.t, wizard_run_id: '',
    latest_message: { role: last.role, content: String(last.content).slice(0, 200), timestamp: last.timestamp },
    last_user_message: { role: 'user', content: lastU.content, timestamp: lastU.timestamp } };
}
const writes = [];
const route = async r => {
  const q = r.request(), u = new URL(q.url()), m = q.method();
  const json = (status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (m !== 'GET' && m !== 'HEAD') {
    const body = (q.postDataBuffer() || Buffer.alloc(0)).toString();
    writes.push({ m, p: u.pathname });
    if (u.pathname === '/wizard/thread-seen') { let st; try { st = JSON.parse(body).state; } catch (e) {} return json(200, { state: st || { initializedAt: Date.now(), threads: {} } }); }
    return json(200, { ok: true });
  }
  if (!u.pathname.startsWith('/wizard/')) return r.continue();
  if (u.pathname === '/wizard/hermes/api/sessions' && (u.searchParams.get('offset') || '0') === '0') {
    let res; try { res = await r.fetch(); } catch (e) { return; } const p = await res.json().catch(() => ({ data: [] }));
    p.data = Object.keys(FIX).map(fixSession).concat(p.data || []);
    return json(200, p);
  }
  const mm = u.pathname.match(/\/wizard\/hermes\/api\/sessions\/([^/]+)\/messages$/);
  if (mm && FIX[mm[1]]) { rid = 1; const rows = FIX[mm[1]].rows().map(x => ({ ...x, session_id: mm[1] })); return json(200, { object: 'list', data: rows, pagination: { limit: 500, offset: 0, returned: rows.length } }); }
  const sm = u.pathname.match(/\/wizard\/hermes\/api\/sessions\/([^/]+)$/); if (sm && FIX[sm[1]]) return json(200, { session: fixSession(sm[1]) });
  return r.continue();
};
const box = el => { if (!el) return null; const b = el.getBoundingClientRect(); return b.width ? { x: b.x, y: b.y, r: b.right, b: b.bottom, w: b.width, h: b.height } : null; };
const overlap = (a, b) => !!a && !!b && a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b;

(async () => {
  const b = await chromium.launch({ executablePath: fs.existsSync(EXEC) ? EXEC : undefined });
  const ctx = await b.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true });
  await ctx.route('**/*', route);
  const p = await ctx.newPage(); p.setDefaultTimeout(8000);
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); } catch (e) {} });
  await p.goto(URL_, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__wos?.live?.ok && window.__wos.live.session('qa_ds_stopped'), null, { timeout: 90000 }).catch(() => {});
  ok(await p.evaluate(() => !!window.__wos?.live?.session('qa_ds_stopped')), 'thread list loaded with the fixture threads');
  const acts = async id => {
    await p.evaluate(i => __wos.openWizardThread(i), id);
    await p.waitForFunction(() => document.querySelector('.win .ch-msgs .msg.u, .win .ch-msgs .msg'), null, { timeout: 20000 }).catch(() => {});
    await sleep(1500);
    return p.evaluate(() => [...document.querySelectorAll('.win [data-chact]')].map(e => e.dataset.chact));
  };
  try {
    const st = await p.evaluate(() => __wos.live.session('qa_ds_stopped').status);
    ok(st === 'cancelled', 'fixture thread reads as cancelled', st);
    let a = await acts('qa_ds_stopped');
    ok(a.join() === 'done', 'stopped thread with no answer shows Done only', a);
    await p.screenshot({ path: path.join(OUT, '1-stopped-done.png') });
    const before = writes.length;
    await p.locator('.win [data-chact="done"]').first().tap(); await sleep(1200);
    const w = writes.slice(before);
    ok(w.some(x => x.m === 'PATCH' && x.p.endsWith('/sessions/qa_ds_stopped')), 'Done archives the thread (PATCH)', w);
    ok(await p.evaluate(() => !!__wos.live.session('qa_ds_stopped')?.archived), 'thread is marked archived', null);
    a = await acts('qa_ds_failed');
    ok(a.join() === 'done', 'failed thread with no answer shows Done only', a);
    a = await acts('qa_ds_answered');
    ok(a.join() === 'defer,done', 'answered thread keeps Defer and Done', a);
  } catch (e) { ok(false, 'run completed', String(e)); }
  ok(errs.length === 0, 'no page errors', errs);
  ok(writes.every(w => w.p === '/wizard/thread-seen' || /\/sessions\/qa_ds_/.test(w.p)), 'only fixture writes (all intercepted)', writes);
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`); console.log('shots', OUT);
  process.exit(fail ? 1 : 0);
})();
