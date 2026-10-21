// QA: Delete always works on Settings → Recovered & cancelled recordings (James, 21 Oct 2026: ten "0:00 · Orb · 2 d ago"
// rows, every Delete answered "Deletion not saved · keep Wizard open"). Those rows are cancelled/interrupted takes the
// outbox recovered from its localStorage fallback while device storage (IndexedDB) was unavailable at startup, so they
// sat in quarantine, and remove() refused every quarantined id.
//   1. storage down for the whole session → Delete still removes a cancelled take (tombstone in the fallback store),
//      and after a reload with storage back the take stays gone.
//   2. storage down at startup, back by the time of Delete → Delete re-runs recovery and succeeds.
//   3. a quarantined MESSAGE (delivery intent) is still never touched by recordings Delete paths.
// Usage: QA_WEB_DIR=<worktree> node qa-recording-delete.cjs
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const URL_ = (require('./tools/qa-paths.cjs').origin() + '/wizard-os-home/');
const WEB = process.env.QA_WEB_DIR || __dirname;
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function boot(b) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url());
    if (u.hostname !== new URL(require('./tools/qa-paths.cjs').origin()).hostname) return r.abort();
    const m = u.pathname.match(/^\/wizard-os-home\/(.*)$/);
    if (m && (q.method() === 'GET' || q.method() === 'HEAD') && !m[1].startsWith('api/')) {
      const f = m[1] || 'index.html', p = path.join(WEB, 'web', f);
      if (f === 'ux-version.txt') return r.fulfill({ status: 200, contentType: 'text/plain', body: 'abc\n' });
      if (!fs.existsSync(p) || /^(data|summaries)\.js$/.test(f)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      const ct = f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : f.endsWith('.png') ? 'image/png' : f.endsWith('.webmanifest') ? 'application/manifest+json' : 'application/javascript';
      return r.fulfill({ status: 200, contentType: ct, body: fs.readFileSync(p) });
    }
    const json = (o, s = 200) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname === '/wizard/hermes/api/sessions' && q.method() === 'GET') return json({ data: [], has_more: false });
    if (/^\/wizard\/hermes\/api\/sessions\/[^/]+\/messages/.test(u.pathname)) return json({ data: [] });
    if (u.pathname === '/wizard/thread-seen') return json({ state: { initializedAt: Date.now(), threads: {} } });
    if (u.pathname === '/wizard/thread-dispositions') return json({ state: {} });
    if (u.pathname === '/wizard/hermes/v1/runs') { ctx.__runs = (ctx.__runs || 0) + 1; return json({ run_id: 'run_x', status: 'queued' }, 202); }
    return json({});
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(() => {
    try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.tour.v1', 'true'); } catch (e) {}
    // qa.idb = 'down' (every open of the outbox store fails) | 'once' (only the first open fails) | unset (works).
    const mode = sessionStorage.getItem('qa.idb');
    if (mode === 'nowrite') {
      // Device storage reads fine but refuses every write (full disk / quota): puts fail, deletes still work.
      const realPut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...a) { if (this.name === 'items') throw new DOMException('QA: quota exceeded', 'QuotaExceededError'); return realPut.apply(this, a); };
      const realSet = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) { if (String(k).startsWith('wos.outbox.')) throw new DOMException('QA: quota exceeded', 'QuotaExceededError'); return realSet.call(this, k, v); };
      return;
    }
    if (!mode) return;
    const real = indexedDB.open.bind(indexedDB);
    let failed = 0;
    indexedDB.open = function (name, v) {
      if (name === 'wos-outbox' && (mode === 'down' || (mode === 'once' && failed++ === 0))) {
        const r = {}; setTimeout(() => { r.error = new DOMException('QA: storage unavailable', 'UnknownError'); r.onerror?.({ target: r }); }, 20); return r;
      }
      return real(name, v);
    };
  });
  return { ctx, p, errs };
}
async function open(p) {
  await p.goto(URL_, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__wos && window.__wos.live, null, { timeout: 30000 });
  await sleep(900);
}
const toastText = p => p.evaluate(() => document.querySelector('#toast')?.textContent || '');
const group = p => p.evaluate(() => { const g = document.querySelector('#settingsBody [data-cancelled]'); return g ? { rows: g.querySelectorAll('.cx-row').length, text: g.textContent } : null; });
// Seed what the phone had: fallback rows of cancelled orb takes written while IndexedDB failed.
const seed = (p, mode, extra = []) => p.evaluate(({ mode, extra }) => {
  const audio64 = btoa(String.fromCharCode(...Array.from({ length: 3000 }, (_, i) => (i * 13) & 255)));
  const at = Date.now() - 2 * 864e5;
  for (let i = 0; i < 3; i++) {
    const id = 'wos-qa-take-' + i;
    localStorage.setItem('wos.outbox.fallback.v2.' + id, JSON.stringify({ id, kind: 'capture', state: 'held', intent: 'message', createdAt: at + i, updatedAt: at + i, audioType: 'audio/webm', audio64, error: 'Cancelled recording · original kept', files: [], nativeIds: [], deliveryRequested: false }));
  }
  for (const x of extra) localStorage.setItem('wos.outbox.fallback.v2.' + x.id, JSON.stringify(x));
  if (mode) sessionStorage.setItem('qa.idb', mode); else sessionStorage.removeItem('qa.idb');
}, { mode, extra });

(async () => {
  const b = await chromium.launch();
  try {
    /* 1. Storage down all session. */
    const { ctx, p, errs } = await boot(b);
    await p.goto(URL_, { waitUntil: 'load' });
    const msg = { id: 'wos-qa-msg', kind: 'new', state: 'failed', intent: 'message', deliveryRequested: true, sessionId: 's1', createdAt: Date.now() - 3600e3, updatedAt: Date.now() - 3600e3, text: 'a real message', files: [], nativeIds: [], body: '{"x":1}' };
    await seed(p, 'down', [msg]);
    await open(p);
    ok(await p.evaluate(() => WosOutbox.quarantined('wos-qa-take-0')), 'Repro: takes recovered from the fallback store are quarantined while storage is down');
    await p.evaluate(() => __wos.openSettings('cancelled')); await sleep(600);
    let g = await group(p);
    ok(g && g.rows === 3 && /0:00/.test(g.text), 'Settings lists the three recovered takes', JSON.stringify(g));
    await p.click('#settingsBody [data-cancelled] .cx-row:nth-of-type(1) [data-cx="delete"]'); await sleep(900);
    const t = await toastText(p);
    ok(!/Deletion not saved/.test(t), 'Delete is not refused while storage is down', t);
    g = await group(p);
    ok(g && g.rows === 2, 'Delete removes the take from the list', JSON.stringify(g));
    for (let i = 0; i < 2; i++) { await p.click('#settingsBody [data-cancelled] .cx-row:nth-of-type(1) [data-cx="delete"]'); await sleep(700); }
    g = await group(p);
    ok(g && g.rows === 0, 'All three takes delete', JSON.stringify(g));
    ok(await p.evaluate(() => WosOutbox.quarantined('wos-qa-msg') && WosOutbox.get('wos-qa-msg')?.state !== 'sent'), 'A quarantined message with delivery intent is left untouched');
    ok((ctx.__runs || 0) === 0, 'Nothing was sent to an agent');
    // Reload with storage back: the deleted takes stay gone.
    await p.evaluate(() => sessionStorage.removeItem('qa.idb'));
    await open(p);
    await p.evaluate(() => __wos.openSettings('cancelled')); await sleep(600);
    g = await group(p);
    ok(g && g.rows === 0, 'After a reload with storage back, deleted takes do not come back', JSON.stringify(g));
    ok(errs.length === 0, 'No page errors (storage down)', errs.join(' | '));
    await ctx.close();

    /* 2. Storage down at startup only. */
    const n = await boot(b);
    await n.p.goto(URL_, { waitUntil: 'load' });
    await seed(n.p, 'once');
    await open(n.p);
    await n.p.evaluate(() => __wos.openSettings('cancelled')); await sleep(600);
    g = await group(n.p);
    ok(g && g.rows === 3, 'Transient: three recovered takes listed', JSON.stringify(g));
    await n.p.click('#settingsBody [data-cancelled] .cx-row:nth-of-type(1) [data-cx="delete"]'); await sleep(900);
    ok(!/Deletion not saved/.test(await toastText(n.p)) && (await group(n.p)).rows === 2, 'Transient: Delete succeeds once storage answers again', await toastText(n.p));
    ok(await n.p.evaluate(() => WosOutbox.recoveryComplete), 'Transient: Delete re-ran recovery (storage verified)');
    await n.p.evaluate(() => sessionStorage.removeItem('qa.idb'));
    await open(n.p);
    await n.p.evaluate(() => __wos.openSettings('cancelled')); await sleep(600);
    ok((await group(n.p)).rows === 2, 'Transient: the deleted take stays gone after reload; the other two remain');
    ok(n.errs.length === 0, 'No page errors (transient)', n.errs.join(' | '));
    await n.ctx.close();

    /* 3. Storage that reads but refuses writes (full device): Delete erases instead; a stuck 'processing' take
          from an interrupted transcription deletes too; Delete all clears the list in two taps. */
    const w = await boot(b);
    await w.p.goto(URL_, { waitUntil: 'load' });
    await seed(w.p, '');
    await open(w.p);  // storage works: takes migrate into IndexedDB
    await w.p.evaluate(async () => { const it = WosOutbox.get('wos-qa-take-2'); it.kind = 'dictation'; it.state = 'processing'; });
    await w.p.evaluate(() => sessionStorage.setItem('qa.idb', 'nowrite'));
    await open(w.p);
    await w.p.evaluate(async () => { const it = WosOutbox.get('wos-qa-take-2'); it.kind = 'dictation'; it.state = 'processing'; });
    await w.p.evaluate(() => __wos.openSettings('cancelled')); await sleep(600);
    g = await group(w.p);
    ok(g && g.rows === 3 && /Delete all/.test(g.text), 'Full storage: three takes and a Delete all button', JSON.stringify(g));
    if (process.env.QA_SHOT) { await w.p.evaluate(() => document.querySelector('#settingsBody [data-cx-all]')?.scrollIntoView({ block: 'center' })); await sleep(300); await w.p.screenshot({ path: process.env.QA_SHOT }); }
    await w.p.click('#settingsBody [data-cancelled] .cx-row:nth-of-type(1) [data-cx="delete"]'); await sleep(900);
    let tt = await toastText(w.p);
    ok(!/Couldn|not saved/.test(tt) && (await group(w.p)).rows === 2, 'Full storage: Delete still removes the take', tt);
    await w.p.click('#settingsBody [data-cancelled] [data-cx-all="delete"]'); await sleep(300);
    ok((await group(w.p)).rows === 2 && /again/.test(await toastText(w.p)), 'Delete all asks for a second tap first', await toastText(w.p));
    await w.p.click('#settingsBody [data-cancelled] [data-cx-all="delete"]'); await sleep(1500);
    g = await group(w.p); tt = await toastText(w.p);
    ok(g && g.rows === 0 && /Deleted 2/.test(tt), 'Delete all removes the rest, including the stuck processing take', tt + ' ' + JSON.stringify(g));
    await w.p.evaluate(() => sessionStorage.removeItem('qa.idb'));
    await open(w.p);
    await w.p.evaluate(() => __wos.openSettings('cancelled')); await sleep(600);
    ok((await group(w.p)).rows === 0, 'Full storage: nothing comes back after a reload');
    ok(w.errs.length === 0, 'No page errors (full storage)', w.errs.join(' | '));
    await w.ctx.close();
  } catch (e) { fail++; console.log('FAIL exception', e.stack || e); }
  await b.close();
  console.log(`${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
