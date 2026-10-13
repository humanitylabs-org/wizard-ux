// Memory soak: leave Wizard UX running and prove memory stays flat.
// Two shells (phone, desktop), each: load → warm up → baseline → N rounds of
// (idle polling under time compression + user churn: open/close windows, threads, desks, palette)
// → forced GC + sample JS heap, DOM nodes, listeners, documents, frames after every round.
// Fails if the post-warmup trend grows past budget. Real Wizard READS; every write is intercepted.
// Usage: node qa-soak.cjs [baseUrl] [rounds=12] [roundSeconds=45] [timeScale=6]
const { chromium } = require('/home/developer/node_modules/playwright');
const fs = require('fs');
const BASE = process.argv[2] || 'http://127.0.0.1:9371/wizard-os-home/';
const ROUNDS = +(process.argv[3] || 12), ROUND_S = +(process.argv[4] || 45), SCALE = +(process.argv[5] || 6);
const ONLY = process.env.SOAK_SHELL || '';
const OUT = process.env.QA_OUT || '/home/developer/.hermes/cache/scratch/wux-soak';
const EXEC = process.env.QA_CHROME || '/home/developer/.local/bin/google-chrome';
// Budgets: growth from the first post-warmup sample to the median of the last three.
const BUDGET = { heapMB: 6, nodes: 1500, listeners: 300, documents: 2 };
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fail = 0;

async function ctxFor(b, kind) {
  const opts = kind === 'phone'
    ? { viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, userAgent: 'Mozilla/5.0 (Linux; Android 15; SM-S938B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36' }
    : { viewport: { width: 1512, height: 920 }, deviceScaleFactor: 1, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36' };
  const ctx = await b.newContext({ ...opts, ignoreHTTPSErrors: true, permissions: ['microphone'] });
  let writes = 0;
  await ctx.route('**/*', async r => {
    const q = r.request(), u = q.url();
    if (q.method() !== 'GET' && q.method() !== 'HEAD' && /\/(wizard\/|wizard-os-home\/api\/|api\/)/.test(u)) { writes++; return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); }
    if (q.resourceType() === 'document' && q.frame() !== q.frame().page().mainFrame()) {
      const path = new URL(u).pathname;
      if (!path.startsWith('/wizard-os-home/') && !path.startsWith('/wizard/')) return r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>stub app</title><body style="background:#111;color:#eee">stub app ' + path + '</body>' });
    }
    return r.continue();
  });
  // Time compression: every app timer runs SCALE× faster, so one soak minute ≈ SCALE minutes left open.
  await ctx.addInitScript(s => {
    try { localStorage.setItem('wos.coached', 'true'); } catch (e) {}
    const si = window.setInterval, st = window.setTimeout;
    window.setInterval = (f, ms, ...a) => si(f, Math.max(4, (ms || 0) / s), ...a);
    window.setTimeout = (f, ms, ...a) => st(f, (ms || 0) > 50 ? ms / s : ms, ...a);
  }, SCALE);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  return { ctx, p, errs, writes: () => writes };
}

async function sample(p, cdp) {
  await cdp.send('HeapProfiler.collectGarbage'); await sleep(300); await cdp.send('HeapProfiler.collectGarbage');
  const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value]));
  const app = await p.evaluate(() => {
    const W = window.__wos?.wins || window.__wux?.wins || {};
    return { wins: Object.keys(W).length, sessions: window.WizLive?.sessions?.length || 0, iframes: document.querySelectorAll('iframe').length,
      appsTried: window.__soakApps || 0, frameLog: (window.__frameLog || []).length, lmLog: (window.LiveMode?.log || []).length };
  }).catch(() => ({}));
  return { heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(2), nodes: m.Nodes, listeners: m.JSEventListeners, documents: m.Documents, frames: m.Frames, ...app };
}

// User churn: the things a person does over a day, repeated each round.
// Framed apps load a tiny stub page (route below) so the soak measures the shell's own window/frame lifecycle.
async function churnPhone(p) {
  await p.evaluate(async () => {
    const wos = window.__wos, sleep = ms => new Promise(r => setTimeout(r, ms * 6)); // timers are compressed
    const ids = (window.WizLive?.sessions || []).slice(0, 6).map(s => s.id);
    const apps = window.WizCore.apps('mobile').APPS.filter(a => a.url).slice(0, 3);
    for (let k = 0; k < 2; k++) {
      for (let d = 0; d < wos.desks.length; d++) { wos.goDesk(d); await sleep(40); }
      wos.goDesk(wos.HOME);
      const chat = Object.values(wos.wins).find(w => w.app === 'chats');
      if (chat) for (const id of ids) { wos.openChat(chat.id, id); await sleep(300); wos.onBack(); await sleep(40); }
      const opened = [];
      window.__soakApps = apps.length; for (const a of apps) { const before = new Set(Object.keys(wos.wins)); wos.openApp(a, {}, { desk: 0 }); await sleep(250); for (const id of Object.keys(wos.wins)) if (!before.has(id)) opened.push(id); }
      for (const id of opened) wos.closeWin(id);
      wos.goDesk(wos.HOME);
      try { wos.openSheet('inbox'); await sleep(120); wos.closeSheets(); } catch (e) {}
    }
  });
}
async function churnDesktop(p) {
  await p.evaluate(async () => {
    const x = window.__wux, sleep = ms => new Promise(r => setTimeout(r, ms * 6));
    const ids = (window.WizLive?.sessions || []).slice(0, 6).map(s => s.id);
    const apps = window.WizCore.apps('desktop').APPS.filter(a => a.url).slice(0, 3);
    for (let k = 0; k < 2; k++) {
      x.openPalette(); await sleep(80); x.closePalette();
      for (const id of ids) { x.openThread(id); await sleep(300); }
      const before = new Set(Object.keys(x.wins));
      for (const id of ids.slice(0, 3)) { x.openThread(id, { fresh: true }); await sleep(200); }
      window.__soakApps = apps.length; for (const a of apps) { x.openApp(a, { fresh: true }); await sleep(250); }
      for (const id of Object.keys(x.wins)) if (!before.has(id)) x.closeWin(id);
      for (const n of [1, 2, 0]) { x.goWs(n); await sleep(60); }
      try { x.openInbox(); await sleep(120); x.escStep(); } catch (e) {}
    }
  });
}

async function soak(b, kind) {
  const { ctx, p, errs, writes } = await ctxFor(b, kind);
  const cdp = await ctx.newCDPSession(p); await cdp.send('Performance.enable');
  await p.goto(BASE + (kind === 'desktop' ? '?shell=desktop' : '?shell=phone'), { waitUntil: 'load' });
  await p.waitForFunction(() => (window.__wos || window.__wux) && window.WizLive && window.WizLive.ok, null, { timeout: 45000 }).catch(() => {});
  const rows = [];
  const t0 = Date.now();
  for (let r = 0; r <= ROUNDS; r++) {
    if (r > 0) {
      try { kind === 'phone' ? await churnPhone(p) : await churnDesktop(p); } catch (e) { errs.push('churn: ' + e.message); }
      await sleep(ROUND_S * 1000);
    } else await sleep(15000);
    const s = { round: r, simMin: +(((Date.now() - t0) / 60000) * SCALE).toFixed(1), ...(await sample(p, cdp)) };
    rows.push(s); console.log(kind, JSON.stringify(s));
  }
  const first = rows[1] || rows[0];
  const tail = rows.slice(-3), med = k => tail.map(x => x[k]).sort((a, b) => a - b)[1];
  const growth = Object.fromEntries(Object.keys(BUDGET).map(k => [k, +(med(k) - first[k]).toFixed(2)]));
  const over = Object.keys(BUDGET).filter(k => growth[k] > BUDGET[k]);
  // Debug rings must stay capped no matter how long the shell runs.
  const last = rows[rows.length - 1]; if (last.frameLog > 40) over.push('frameLog'); if (last.lmLog > 60) over.push('lmLog');
  const res = { kind, rounds: ROUNDS, scale: SCALE, simulatedMinutes: rows[rows.length - 1].simMin, growth, budget: BUDGET, over, writesIntercepted: writes(), pageErrors: errs.slice(0, 5), rows };
  fs.writeFileSync(`${OUT}/soak-${kind}.json`, JSON.stringify(res, null, 1));
  console.log(over.length ? 'FAIL' : 'PASS', kind, 'growth', JSON.stringify(growth), over.length ? 'over: ' + over.join(',') : '');
  if (over.length) fail++;
  await ctx.close();
}

(async () => {
  const b = await chromium.launch({ executablePath: fs.existsSync(EXEC) ? EXEC : undefined, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--js-flags=--expose-gc'] });
  const kinds = ONLY ? [ONLY] : ['phone', 'desktop'];
  await Promise.all(kinds.map(k => soak(b, k)));
  await b.close();
  console.log(fail ? `SOAK FAIL (${fail})` : 'SOAK PASS');
  process.exit(fail ? 1 : 0);
})();
