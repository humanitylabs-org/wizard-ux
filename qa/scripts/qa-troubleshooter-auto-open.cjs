const QA_ROOT = require('node:path').resolve(__dirname, '../..'); // repo root (this script lives in qa/scripts/)
/* The Troubleshooter opens by itself only for a real outage (wizard-ux#1828).
 * James, 25 Nov 2026: it popped open on his phone during a routine ~25-50 s Agent Service deploy and said
 * "All working" by the time he looked. Runs the real phone shell (index.html, 412 px) against fixture reads, then
 * cuts every Agent Service read (as a restart does) while /troubleshoot/api/status answers per scenario:
 *   restart-25s     reads fail 25 s, status down        → pill shows, Troubleshooter never opens by itself
 *   restart-51s     reads fail 51 s, status down        → never opens by itself (the 25 Nov 14:01 deploy)
 *   status-ok       reads fail 75 s, status ok          → never opens by itself
 *   hidden          one failed read, page hidden 70 s, back for 6 s, then healed → hidden time is not counted
 *   outage          reads fail 80 s, status down        → opens by itself once, after about 60 s
 * Every write is dropped; nothing reaches a service.
 * QA_WEB_DIR=<repo> QA_OUT=<evidence> QA_PLAYWRIGHT=<module> node qa/scripts/qa-troubleshooter-auto-open.cjs */
const fs = require('node:fs'), path = require('node:path');
const { chromium } = require('../../tools/qa-playwright.cjs');
const root = process.env.QA_WEB_DIR || QA_ROOT, out = process.env.QA_OUT || 'qa-live/troubleshooter-auto-open';
const origin = 'http://localhost:9481/wizard-os-home/';
const only = (process.env.QA_ONLY || '').split(',').filter(Boolean);
const sessions = Array.from({ length: 6 }, (_, i) => ({ id: 'ao-' + i, title: 'Sample conversation ' + i, source: 'wizard-mobile', model: 'qa', provider: 'qa', message_count: 2, last_active: Date.now() / 1000 - i * 600, preview: 'A sample preview line ' + i }));
const results = [];
const ok = (v, name, detail) => { results.push({ pass: !!v, name, detail }); console.log(v ? 'PASS' : 'FAIL', name, v ? '' : JSON.stringify(detail)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(out, { recursive: true });

async function shell(browser, status) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 892 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36' });
  const S = { down: false, status, errors: [] };
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url()), p = u.pathname;
    if (u.hostname !== 'localhost') return r.abort();
    const json = o => r.fulfill({ contentType: 'application/json', body: JSON.stringify(o) });
    if (q.method() === 'GET' && p.startsWith('/wizard-os-home/')) {
      const f = path.join(root, 'web', p.slice('/wizard-os-home/'.length) || 'index.html');
      if (fs.existsSync(f) && fs.statSync(f).isFile()) return r.fulfill({ body: fs.readFileSync(f), contentType: f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : f.endsWith('.js') ? 'application/javascript' : f.endsWith('.png') ? 'image/png' : f.endsWith('.json') ? 'application/json' : 'image/svg+xml' });
      return r.fulfill({ status: 404, body: '' });
    }
    if (p === '/troubleshoot/' || p === '/troubleshoot/index.html') return r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Troubleshooter</title><h1>Troubleshooter</h1>' });
    if (p === '/troubleshoot/api/ping') return r.fulfill({ status: 200, body: 'ok' });
    if (p === '/troubleshoot/api/status') return json(S.down && S.status === 'down'
      ? { overall: 'down', summary: 'Agent Service: not answering', checks: [{ id: 'agent-service', label: 'Agent Service', ok: false, detail: 'not answering' }] }
      : { overall: 'ok', summary: 'Everything is working.', checks: [] });
    if (p.startsWith('/troubleshoot/')) return json({});
    if (q.method() !== 'GET') return r.abort('connectionreset');
    // An Agent Service restart: nothing behind the shell answers.
    if (S.down) return r.abort('connectionrefused');
    // No AI answer: the Welcome / Reconnect your AI sheet stays away, so the shot shows the shell itself.
    if (p.endsWith('/api/model/options')) return r.fulfill({ status: 404, body: '' });
    if (p.endsWith('/bootstrap')) return json({ bootstrap: 1, display: { agent_name: 'Wizard', owner_name: 'Tester' }, capabilities: { voice: true, router: true, files: true } });
    if (p.endsWith('/api/sessions')) return json({ sessions });
    if (p.endsWith('/v1/runs')) return json({ runs: [] });
    if (p.endsWith('/api/jobs')) return json({ jobs: [] });
    if (p.endsWith('/agents')) return json({ agents: [{ id: 'hermes', label: 'Wizard', is_default: true, status: 'running' }] });
    return json({});
  });
  // A controllable page visibility, as a phone switching apps.
  await ctx.addInitScript(() => {
    for (const k of ['wos.coached', 'wos.voiceTipSeen', 'wos.tour.v1']) localStorage.setItem(k, 'true'); localStorage.setItem('wos.tour.done', '1'); localStorage.setItem('wos.welcome.v1', 'done');
    window.__qaHidden = false;
    Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => window.__qaHidden });
    Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: () => (window.__qaHidden ? 'hidden' : 'visible') });
  });
  const p = await ctx.newPage(); p.on('pageerror', e => S.errors.push(String(e)));
  await p.goto(new URL('index.html', origin).href);
  await p.waitForFunction(() => (window.__wos || window.__wux)?.chats && window.WizLive?.ok, null, { timeout: 30000 });
  await sleep(1500);
  const look = () => p.evaluate(() => {
    const A = window.__wos || window.__wux;
    return {
      auto: (window.__statusLog || []).filter(s => s === 'net:troubleshooter').length,
      win: Object.values(A?.wins || {}).some(w => w.appId === 'troubleshooter' || w.app === 'troubleshooter'),
      pill: !!document.querySelector('#wxBanners [data-wxtroubleshoot]'),
      net: window.WizCore?.status?.state?.net,
    };
  });
  const setHidden = h => p.evaluate(h => { window.__qaHidden = h; document.dispatchEvent(new Event('visibilitychange', { bubbles: true })); }, h);
  return { ctx, p, S, look, setHidden };
}

// Fail reads for downMs, sampling what the owner sees once a second.
async function outage(h, downMs, extraMs = 12000, shotAt = 0, shot = '') {
  h.S.down = true; await h.p.evaluate(() => window.WizLive.refresh()).catch(() => {});
  const t0 = Date.now(), seen = [];
  while (Date.now() - t0 < downMs + extraMs) {
    if (shot && Date.now() - t0 >= shotAt) { await h.p.screenshot({ path: path.join(out, shot) }); shot = ''; }
    if (h.S.down && Date.now() - t0 >= downMs) { h.S.down = false; h.p.evaluate(() => window.WizLive.refresh()).catch(() => {}); }
    seen.push({ t: Math.round((Date.now() - t0) / 1000), ...(await h.look()) });
    await sleep(1000);
  }
  h.S.down = false;
  return seen;
}

const SCENARIOS = {
  async 'restart-25s'(browser) {
    const h = await shell(browser, 'down');
    const seen = await outage(h, 25000, 12000, 14000, 'restart-25s-during.png');
    ok(seen.some(s => s.pill), 'restart-25s: the pill with Troubleshoot shows during the restart', seen.filter(s => s.pill).length);
    ok(seen.every(s => !s.auto && !s.win), 'restart-25s: the Troubleshooter never opens by itself', seen.find(s => s.auto || s.win));
    ok(seen.at(-1).net === 'online' || seen.at(-1).net === 'restored', 'restart-25s: back online after the restart', seen.at(-1));
    await h.p.screenshot({ path: path.join(out, 'restart-25s.png') });
    ok(!h.S.errors.length, 'restart-25s: no browser errors', h.S.errors); await h.ctx.close();
  },
  async 'restart-51s'(browser) {
    const h = await shell(browser, 'down');
    const seen = await outage(h, 51000);
    ok(seen.every(s => !s.auto && !s.win), 'restart-51s: the Troubleshooter never opens by itself', seen.find(s => s.auto || s.win));
    ok(!h.S.errors.length, 'restart-51s: no browser errors', h.S.errors); await h.ctx.close();
  },
  async 'status-ok'(browser) {
    const h = await shell(browser, 'ok');
    const seen = await outage(h, 75000);
    ok(seen.every(s => !s.auto && !s.win), 'status-ok: while /troubleshoot/api/status says ok nothing opens by itself', seen.find(s => s.auto || s.win));
    ok(!h.S.errors.length, 'status-ok: no browser errors', h.S.errors); await h.ctx.close();
  },
  async hidden(browser) {
    const h = await shell(browser, 'down');
    h.S.down = true; await h.p.evaluate(() => window.WizLive.refresh()).catch(() => {});
    await sleep(1500); await h.setHidden(true); await sleep(70000);
    await h.setHidden(false);
    const seen = [];
    for (let i = 0; i < 6; i++) { await sleep(1000); seen.push(await h.look()); }
    h.S.down = false; await h.p.evaluate(() => window.WizLive.refresh()).catch(() => {});
    for (let i = 0; i < 8; i++) { await sleep(1000); seen.push(await h.look()); }
    ok(!seen.slice(0, 2).some(s => s.pill), 'hidden: coming back after 70 s hidden shows no pill at once (hidden time is not counted)', seen.slice(0, 2));
    ok(seen.every(s => !s.auto && !s.win), 'hidden: the Troubleshooter does not pop open on return', seen.find(s => s.auto || s.win));
    ok(!h.S.errors.length, 'hidden: no browser errors', h.S.errors); await h.ctx.close();
  },
  async outage(browser) {
    const h = await shell(browser, 'down');
    const seen = await outage(h, 80000, 3000);
    const first = seen.find(s => s.auto);
    ok(!!first && first.t >= 55 && first.t <= 75, 'outage: a real outage still opens the Troubleshooter by itself, after about 60 s', first || seen.at(-1));
    ok(seen.at(-1).auto === 1, 'outage: once per outage', seen.at(-1));
    await h.p.screenshot({ path: path.join(out, 'outage.png') });
    ok(!h.S.errors.length, 'outage: no browser errors', h.S.errors); await h.ctx.close();
  },
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.QA_CHROME || undefined });
  await Promise.all(Object.entries(SCENARIOS).filter(([k]) => !only.length || only.includes(k)).map(([, fn]) => fn(browser)));
  await browser.close();
  fs.writeFileSync(path.join(out, 'receipt.json'), JSON.stringify({ source: root, results }, null, 2));
  console.log(`${results.filter(x => x.pass).length} passed, ${results.filter(x => !x.pass).length} failed`);
  if (results.some(x => !x.pass)) process.exitCode = 1;
})().catch(e => { console.error(e); process.exit(2); });
