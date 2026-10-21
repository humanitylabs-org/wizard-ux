// Thread read retry (James, 21 Oct 2026: "Tokyo trip · Flights" opened on a bare "Couldn't load this thread"
// after one dropped read; the server answered the same read fine moments later and nothing retried it).
// Self-contained fake Wizard. Asserts: one failed read keeps the loading skeleton and recovers by itself with no tap;
// repeated failures name the problem with "Retrying automatically" and a Retry now button, then recover on their own;
// Retry now reads at once; leaving the thread stops the retries; a 403 still says sign-in and does not loop.
// Usage: QA_TREE=<repo> node qa-thread-read-retry.cjs
const fs = require('fs'), path = require('path');
const { chromium } = require('./tools/qa-playwright.cjs');
const TREE = process.env.QA_TREE || __dirname;
const FALLBACK = process.env.QA_FALLBACK_WEB || require('node:path').join(require('./tools/qa-paths.cjs').repoRoot, 'web');
let pass = 0, fail = 0;
const ok = (c, n, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${d !== '' ? ' ' + JSON.stringify(d) : ''}`); };
const now = Date.now() / 1000, sleep = ms => new Promise(r => setTimeout(r, ms));
const S = ['t_once', 't_many', 't_tap', 't_leave', 't_403'].map((id, i) => ({ id, title: 'QA ' + id, source: 'wizard-mobile', message_count: 2, last_active: now - 600 - i * 60, started_at: now - 3600, archived: false, hidden: false, status: null, preview: 'answer ' + id }));
const rows = id => [
  { id: 1, role: 'user', content: 'question ' + id, timestamp: now - 900 },
  { id: 2, role: 'assistant', content: 'Answer for ' + id + '.', timestamp: now - 880 },
];
// failuresLeft[id] = how many message reads fail before one succeeds (Infinity = keep failing until changed)
const failuresLeft = { t_once: 1, t_many: 3, t_tap: Infinity, t_leave: Infinity, t_403: Infinity };
const reads = {};

(async () => {
  const b = await chromium.launch({ executablePath: process.env.QA_CHROME || undefined });
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url());
    if (u.hostname !== 'wizard.test') return r.abort();
    const json = (status, body) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (!['GET', 'HEAD'].includes(q.method())) return json(200, {});
    if (u.pathname === '/wizard/hermes/api/sessions') return json(200, { object: 'list', data: S, limit: 100, offset: 0, has_more: false, snapshot: 'snap' });
    const mm = u.pathname.match(/^\/wizard\/hermes\/api\/sessions\/([^/]+)\/messages$/);
    if (mm) {
      const id = mm[1]; (reads[id] = reads[id] || []).push(Date.now());
      if (failuresLeft[id] > 0) {
        failuresLeft[id]--;
        if (id === 't_403') return json(403, { error: { message: 'sign in' } });
        if (id === 't_many') return json(502, { error: { message: 'bad gateway' } });
        return r.abort('connectionreset'); // a dropped read, like a phone network blip
      }
      const data = rows(id); return json(200, { object: 'list', data, pagination: { limit: 500, offset: 0, returned: data.length } });
    }
    const sm = u.pathname.match(/^\/wizard\/hermes\/api\/sessions\/([^/]+)$/);
    if (sm) { const s = S.find(x => x.id === sm[1]); return s ? json(200, { session: s }) : json(404, {}); }
    if (u.pathname === '/troubleshoot/api/ping') return r.fulfill({ status: 200, body: 'ok' });
    if (u.pathname === '/troubleshoot/api/status') return json(200, { overall: 'ok', checks: [] });
    if (u.pathname === '/wizard/v1/agents') return json(200, { agents: [{ id: 'hermes', is_default: true, label: 'Hermes', harness: 'hermes', privacy: 'standard', status: 'running' }] });
    if (u.pathname === '/wizard/thread-seen') return json(200, { state: { initializedAt: 1, threads: {} } });
    if (u.pathname.startsWith('/wizard/')) return json(200, {});
    const m = u.pathname.match(/^\/wizard-os-home\/(.*)$/);
    if (m) {
      const rel = m[1] || 'index.html'; let f = path.join(TREE, 'web', rel);
      if (!fs.existsSync(f)) f = path.join(FALLBACK, rel);
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      const ct = rel.endsWith('.css') ? 'text/css' : rel.endsWith('.html') ? 'text/html' : rel.endsWith('.png') ? 'image/png' : rel.endsWith('.json') ? 'application/json' : 'application/javascript';
      return r.fulfill({ status: 200, contentType: ct, body: fs.readFileSync(f) });
    }
    return r.fulfill({ status: 404, body: '' });
  });
  await ctx.addInitScript(() => { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.tour.v1', 'true'); localStorage.setItem('wos.tour.done', '1'); localStorage.setItem('wos.voiceTipSeen', 'true'); });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto('https://wizard.test/wizard-os-home/', { waitUntil: 'load' });
  await p.waitForFunction(() => window.__wos && window.WizCore?.apps, null, { timeout: 15000 });
  await p.evaluate(() => __wos.openApp(window.WizCore.apps('mobile').APPS.find(a => a.id === 'wizard')));
  const wid = await p.waitForFunction(() => Object.values(__wos.wins).find(w => w.app === 'chats' && !w.agent)?.id || '', null, { timeout: 10000 }).then(h => h.jsonValue());
  const pane = `[data-chats="${wid}"]`;
  await p.waitForSelector(`${pane} .ch-row[data-chopen]`, { timeout: 20000 });
  const state = () => p.evaluate(s => {
    const el = document.querySelector(s);
    return { answer: /Answer for/.test(el?.querySelector('.ch-msgs')?.innerText || ''), err: el?.querySelector('.ch-empty')?.innerText || '', retry: !!el?.querySelector('[data-chretry]'), skel: !!el?.querySelector('.ch-skel.thread') };
  }, pane);
  const open = id => p.evaluate(id => __wos.openWizardThread(id), id);
  const back = async () => { await p.locator(`${pane} [data-chback]`).first().tap(); await p.waitForSelector(`${pane} .ch-list`, { timeout: 5000 }).catch(() => {}); await sleep(300); };
  const until = async (fn, ms) => { const t = Date.now(); while (Date.now() - t < ms) { const s = await state(); if (fn(s)) return { s, ms: Date.now() - t }; await sleep(100); } return { s: await state(), ms: null }; };

  // 1. One dropped read: no error box, recovers by itself.
  await open('t_once');
  const once = await until(s => s.answer || s.err, 6000);
  ok(once.s.answer && !once.s.err, 'one dropped read never shows an error and the thread loads by itself', once);
  ok(reads.t_once?.length === 2, 'it took exactly one automatic retry', reads.t_once?.length);
  await back();

  // 2. Repeated 502s: explained with a Retry now, then recovers on its own without a tap.
  await open('t_many');
  const shown = await until(s => !!s.err, 6000);
  ok(/Couldn’t load this thread/.test(shown.s.err) && /Retrying automatically/.test(shown.s.err) && /HTTP 502/.test(shown.s.err) && shown.s.retry, 'repeated failures name the error, say it is retrying and offer Retry now', shown.s);
  await p.screenshot({ path: path.join(process.env.QA_OUT || require('./tools/qa-paths.cjs').workPath(''), 'thread-read-retry-error.png') });
  const healed = await until(s => s.answer, 12000);
  ok(healed.s.answer && !healed.s.err, 'it recovers on its own once Wizard answers', { ms: healed.ms, reads: reads.t_many?.length });
  await back();

  // 3. Retry now reads at once.
  await open('t_tap');
  await until(s => s.retry, 8000);
  failuresLeft.t_tap = 0; const before = reads.t_tap.length, t0 = Date.now();
  await p.locator(`${pane} [data-chretry]`).first().tap({ timeout: 8000 }).catch(() => {});
  const tapped = await until(s => s.answer, 3000);
  ok(tapped.s.answer && reads.t_tap.length >= before + 1 && reads.t_tap[before] - t0 < 1000, 'Retry now reads immediately and shows the thread', { reads: reads.t_tap.length - before, ms: tapped.ms });
  await back();

  // 4. Leaving a failing thread stops its retries.
  await open('t_leave');
  await until(s => s.retry, 8000);
  await back();
  const n0 = reads.t_leave.length; await sleep(9000);
  ok(reads.t_leave.length === n0, 'leaving the thread stops the retries', { before: n0, after: reads.t_leave.length });

  // 5. 403 keeps the sign-in message and does not loop.
  await open('t_403');
  const s403 = await until(s => !!s.err, 5000);
  ok(/sign-in/.test(s403.s.err), '403 still says Wizard sign-in needed', s403.s.err);
  ok(!/connection/.test(s403.s.err) && !s403.s.retry, 'another thread’s read error never shows on this one', s403.s);

  ok(errs.length === 0, 'no page errors', errs);
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
