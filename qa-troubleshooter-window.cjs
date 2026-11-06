/* Troubleshooter opens as an ordinary app window, and the waiting send pill keeps its buttons tidy.
 * James, 21 Oct 2026: "Troubleshooter needs to open as a normal app, not this weird full screen mode. Also these
 * buttons at the bottom are poorly aligned." The pill's two buttons hung below a fixed 34px pill over the list rows.
 * Asserts, on phone and desktop shells: the waiting pill contains both buttons on one row (or evenly stacked in a narrow column), left-aligned with the label,
 * each with a 44px hit area; tapping Open Troubleshooter keeps the shell loaded and opens a Troubleshooter window
 * whose page hides its own "back to Wizard" link. Fixture reads only; every write is dropped as a network error, so the real outbox parks the send as waiting.
 * QA_WEB_DIR=<repo> QA_TS_PAGE=<troubleshooter index.html> QA_OUT=<evidence> PLAYWRIGHT_MODULE=<module> node qa-troubleshooter-window.cjs */
const fs = require('node:fs'), path = require('node:path');
const { chromium } = require('./tools/qa-playwright.cjs');
const root = process.env.QA_WEB_DIR || __dirname, out = process.env.QA_OUT || 'qa-live/troubleshooter-window';
const fallback = process.env.QA_FALLBACK_WEB || require('node:path').join(require('./tools/qa-paths.cjs').repoRoot, 'web');
const tsPage = process.env.QA_TS_PAGE || require('node:path').resolve(require('./tools/qa-paths.cjs').repoRoot, '..', 'wizard-troubleshooter/web/index.html');
const origin = 'http://localhost:9481/wizard-os-home/';
const sid = 'ts-fixture';
const sessions = Array.from({ length: 24 }, (_, i) => ({ id: i ? 'ts-' + i : sid, title: i ? 'Sample conversation ' + i : 'Design review', source: 'wizard-mobile', model: 'qa', provider: 'qa', message_count: 2, last_active: Date.now() / 1000 - i * 600, preview: 'A sample preview line ' + i }));
const results = [];
const ok = (v, name, detail) => { results.push({ pass: !!v, name, detail }); console.log(v ? 'PASS' : 'FAIL', name, v ? '' : JSON.stringify(detail)); };
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.QA_CHROME || undefined });
  for (const desktop of [false, true]) {
    const label = desktop ? 'desktop' : 'phone';
    const ctx = await browser.newContext({ viewport: desktop ? { width: 1440, height: 1200 } : { width: 412, height: 892 }, isMobile: !desktop, hasTouch: !desktop, userAgent: desktop ? undefined : 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36' });
    const errors = []; let writes = 0;
    await ctx.route('**/*', async r => {
      const q = r.request(), u = new URL(q.url()), p = u.pathname;
      if (u.hostname !== 'localhost') return r.abort();
      const json = o => r.fulfill({ contentType: 'application/json', body: JSON.stringify(o) });
      if (q.method() === 'GET' && p.startsWith('/wizard-os-home/')) {
        const rel = p.slice('/wizard-os-home/'.length) || 'index.html';
        let f = path.join(root, 'web', rel); if (!fs.existsSync(f)) f = path.join(fallback, rel);
        if (fs.existsSync(f) && fs.statSync(f).isFile()) return r.fulfill({ body: fs.readFileSync(f), contentType: f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : f.endsWith('.js') ? 'application/javascript' : f.endsWith('.png') ? 'image/png' : 'image/svg+xml' });
        return r.fulfill({ status: 404, body: '' });
      }
      if (q.method() === 'GET' && (p === '/troubleshoot/' || p === '/troubleshoot/index.html')) return r.fulfill({ contentType: 'text/html', body: fs.readFileSync(tsPage) });
      if (p === '/troubleshoot/api/ping') return r.fulfill({ status: 200, body: 'ok' });
      if (p === '/troubleshoot/api/status') return json({ overall: 'degraded', checks: [{ id: 'agent', label: 'Agent Service', ok: false, detail: 'QA fixture' }] });
      if (p.startsWith('/troubleshoot/api/')) return json({});
      // Every write is dropped like a network blip: the outbox keeps the message waiting, nothing reaches a service.
      if (q.method() !== 'GET') { writes++; return r.abort('connectionreset'); }
      if (p.endsWith('/bootstrap')) return json({ bootstrap: 1, display: { agent_name: 'Wizard', owner_name: 'Tester' }, capabilities: { voice: true, router: true, files: true } });
      if (p.endsWith('/api/sessions')) return json({ sessions });
      if (p.endsWith('/v1/runs')) return json({ runs: [] });
      if (p.endsWith('/api/jobs')) return json({ jobs: [] });
      if (p.endsWith('/agents')) return json({ agents: [{ id: 'hermes', label: 'Wizard', is_default: true, status: 'running' }] });
      return json({});
    });
    await ctx.addInitScript(() => { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); localStorage.setItem('wos.tour.v1', 'true'); localStorage.setItem('wos.tour.done', '1'); });
    const p = await ctx.newPage(); p.on('pageerror', e => errors.push(String(e)));
    await p.goto(new URL(desktop ? 'desktop.html' : 'index.html', origin).href);
    await p.waitForFunction(() => (window.__wos || window.__wux)?.chats && window.WosOutbox?.recoveryComplete && WizLive.ok, null, { timeout: 20000 });
    const { wid } = await p.evaluate(async ({ sid }) => {
      const A = window.__wos || window.__wux, w = A.openWin ? A.openWin({ app: 'chats' }) : null;
      const wid = w?.id || Object.keys(A.wins).find(k => A.wins[k].app === 'chats');
      A.chats.openChat(wid, null); A.focusWin?.(wid);
      const it = await WosOutbox.stage({ kind: 'reply', sessionId: sid, model: 'qa', provider: 'qa', text: 'Waiting fixture' });
      // Not sent → Retry: the real retry hits a dropped network write and the outbox parks it as waiting.
      await WosOutbox.transition(it.id, 'failed', 'Not sent'); WosOutbox.retry(it.id);
      return { wid };
    }, { sid });
    const scope = `[data-chats="${wid}${desktop ? '::list' : ''}"]`;
    await p.locator(scope + ' .ch-pill [data-chtroubleshoot]').waitFor({ timeout: 15000 }).catch(async e => {
      console.log('DEBUG', JSON.stringify(await p.evaluate(s => ({ pill: document.querySelector(s + ' .ch-pill')?.outerHTML || null, items: WosOutbox.unsent?.().map(x => [x.state, x.error, x.kind]) }), scope)));
      throw e;
    });
    await p.waitForTimeout(400);
    const m = await p.locator(scope + ' .ch-pill').evaluate(el => {
      const pr = el.getBoundingClientRect(), txt = el.querySelector('.pl > span:last-child'), tr = document.createRange(); tr.selectNodeContents(txt);
      const t = tr.getBoundingClientRect(), dots = el.querySelector('.pl').getBoundingClientRect();
      const bs = [...el.querySelectorAll('.pbtn')].map(b => { const r = b.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2; return { r: r.toJSON(), text: b.textContent, centre: document.elementFromPoint(x, y) === b, up: document.elementFromPoint(x, y - 21) === b, down: document.elementFromPoint(x, y + 21) === b }; });
      const fab = el.parentElement.querySelector('.ch-fab')?.getBoundingClientRect();
      return { pill: pr.toJSON(), label: t.toJSON(), line: dots.toJSON(), bs, fab: fab?.toJSON() || null };
    });
    const [b1, b2] = m.bs;
    const inside = b => b.r.left >= m.pill.left - .5 && b.r.right <= m.pill.right + .5 && b.r.top >= m.pill.top - .5 && b.r.bottom <= m.pill.bottom + .5;
    ok(m.bs.length === 2 && /Retry now/.test(b1.text) && /Open Troubleshooter/.test(b2.text), `${label}: waiting pill offers Retry now and Open Troubleshooter`, m.bs.map(b => b.text));
    ok(m.bs.length === 2 && inside(b1) && inside(b2), `${label}: both buttons sit inside the pill`, m);
    // One row when it fits; on a narrow list column they stack with one shared left edge and width.
    const row = m.bs.length === 2 && Math.abs(b1.r.top - b2.r.top) < 1, stack = m.bs.length === 2 && Math.abs(b1.r.left - b2.r.left) < 1 && Math.abs(b1.r.width - b2.r.width) < 1 && b2.r.top >= b1.r.bottom + 12;
    ok((row || stack) && Math.abs(b1.r.height - b2.r.height) < 1, `${label}: buttons share one row, or stack evenly (${row ? 'row' : stack ? 'stack' : 'ragged'})`, m.bs.map(b => b.r));
    ok(b1 && b1.r.top >= m.line.bottom + 4, `${label}: buttons sit below the label line, never over it`, { line: m.line, b1: b1?.r });
    ok(b1 && Math.abs(b1.r.left - m.line.left) <= 4, `${label}: first button lines up with the label's left edge`, { line: m.line.left, b1: b1?.r.left });
    // Hit-test what the viewport shows (the desktop fixture window can extend below it); stacked rows keep >=14px apart.
    const vh = await p.evaluate(() => innerHeight), seen = m.bs.filter(b => b.r.bottom + 22 <= vh);
    ok(seen.every(b => b.centre && b.up && b.down) && (row || b2.r.top - b1.r.bottom >= 14), `${label}: each button has its own 44px-tall hit area`, { vh, bs: m.bs });
    ok(!m.fab || m.pill.right <= m.fab.left - 4, `${label}: pill clears the new-chat button`, { pill: m.pill, fab: m.fab });
    await p.screenshot({ path: path.join(out, `${label}-pill.png`) });

    const before = await p.evaluate(() => location.pathname);
    const tsBtn = p.locator(scope + ' .ch-pill [data-chtroubleshoot]');
    if (await tsBtn.evaluate(el => el.getBoundingClientRect().bottom <= innerHeight)) await tsBtn.click(); else await tsBtn.dispatchEvent('click');
    const win = await p.waitForFunction(() => { const A = window.__wos || window.__wux; return Object.values(A.wins).find(w => w.appId === 'troubleshooter')?.id || ''; }, null, { timeout: 8000 }).then(h => h.jsonValue()).catch(() => '');
    ok(await p.evaluate(b => location.pathname === b, before), `${label}: the shell stays loaded (no full-page jump)`, await p.evaluate(() => location.href));
    ok(!!win, `${label}: Troubleshooter opens as an app window`, win);
    const frame = win ? p.frames().find(f => /\/troubleshoot\/$/.test(f.url())) : null;
    ok(!!frame, `${label}: the window hosts /troubleshoot/`, p.frames().map(f => f.url()));
    if (frame) {
      await frame.waitForSelector('header h1', { timeout: 8000 });
      const f = await frame.evaluate(() => ({ hosted: document.body.classList.contains('hosted'), back: getComputedStyle(document.getElementById('back')).display, title: document.querySelector('header h1').textContent }));
      ok(f.hosted && f.back === 'none', `${label}: hosted page hides its own back-to-Wizard link`, f);
    }
    await p.waitForTimeout(600);
    await p.screenshot({ path: path.join(out, `${label}-window.png`) });
    ok(errors.length === 0, `${label}: no browser errors`, errors);
    console.log(`${label}: ${writes} intercepted writes; nothing reached a service`);
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(out, 'receipt.json'), JSON.stringify({ source: root, results }, null, 2));
  console.log(`${results.filter(x => x.pass).length} passed, ${results.filter(x => !x.pass).length} failed`);
  if (results.some(x => !x.pass)) process.exitCode = 1;
})().catch(e => { console.error(e); process.exit(2); });
