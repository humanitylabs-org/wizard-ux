'use strict';
// Synthetic-only full-shell browser proof: no production server, history, audio or agent is read.
const { chromium } = require('./tools/qa-playwright.cjs');
const http = require('http'), fs = require('fs'), path = require('path'), assert = require('assert/strict');
const root = path.resolve(process.env.QA_WEB_DIR || path.join(__dirname, 'web'));
const out = process.env.QA_OUT || path.join(__dirname, 'qa-reachable-out');
fs.mkdirSync(out, { recursive: true });
const sid = 'synthetic-reachable-thread';
const fixture = { session_id: sid, id: sid, title: 'Synthetic delivery check', source: 'web', state: 'done', updated_at: Date.now() / 1000, message_count: 2, agent: '' };
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/wizard-os-home\/?/, '') || 'index.html';
  const file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
// __wos.idx changes at the START of the 520ms desk slide. A mounted card and
// even an uncovered Retry centre do not prove that the whole card has arrived.
// Keep real motion enabled; require stable geometry, full opacity and every
// control's full clipping/hit-test area before retaining visual evidence.
async function settledCapture(page, deskIndex, state, file) {
  await page.mouse.move(4, 450); // don't retain a dock hover/tooltip from navigation
  const geometry = await page.evaluate(async ({ deskIndex, state }) => {
    const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
    const visible = el => {
      for (let n = el; n; n = n.parentElement) {
        const s = getComputedStyle(n);
        if (s.display === 'none' || s.visibility !== 'visible' || Number(s.opacity) < .999 || s.filter !== 'none') return false;
      }
      return true;
    };
    const exposed = el => {
      const r = el.getBoundingClientRect(), eps = .5;
      if (r.width <= 0 || r.height <= 0 || r.left < -eps || r.top < -eps || r.right > innerWidth + eps || r.bottom > innerHeight + eps || !visible(el)) return false;
      for (let n = el.parentElement; n; n = n.parentElement) {
        const s = getComputedStyle(n), a = n.getBoundingClientRect();
        if (/(hidden|clip|auto|scroll)/.test(s.overflowX) && (r.left < a.left - eps || r.right > a.right + eps)) return false;
        if (/(hidden|clip|auto|scroll)/.test(s.overflowY) && (r.top < a.top - eps || r.bottom > a.bottom + eps)) return false;
      }
      // Inset points avoid rounded-corner antialiasing, but cover both ends of
      // every control: a centre-only check missed the clipped Troubleshooter.
      const dx = Math.min(8, r.width / 4), dy = Math.min(8, r.height / 4);
      return [[r.left + dx, r.top + dy], [r.right - dx, r.top + dy], [r.left + dx, r.bottom - dy], [r.right - dx, r.bottom - dy], [r.left + r.width / 2, r.top + r.height / 2]]
        .every(([x, y]) => el.contains(document.elementFromPoint(x, y)));
    };
    const until = performance.now() + 8000;
    let previous = '', stableAt = 0, lastReason = null;
    const trail = [];
    const describe = n => n && `${n.tagName}${n.id ? '#' + n.id : ''}${n.className ? '.' + String(n.className).trim().replace(/\s+/g, '.') : ''}`;
    const blockers = el => {
      const out = [];
      for (let n = el; n; n = n.parentElement) {
        const s = getComputedStyle(n);
        if (s.display === 'none' || s.visibility !== 'visible' || Number(s.opacity) < .999 || s.filter !== 'none') out.push({ node: describe(n), display: s.display, visibility: s.visibility, opacity: s.opacity, filter: s.filter });
      }
      return out;
    };
    while (performance.now() < until) {
      const desk = document.querySelectorAll('.track > .desk')[deskIndex];
      const card = desk?.querySelector('[data-sendpill]');
      const retry = card?.querySelector('[data-obretry]'), troubleshoot = card?.querySelector('[data-chtroubleshoot]');
      const banner = document.querySelector('[data-wxnet]');
      const targets = [desk, card, card?.querySelector('.pl'), retry, troubleshoot];
      if (state === 'outage') targets.push(banner, ...Array.from(banner?.querySelectorAll('button') || []));
      const transient = ['#toast', '#deskLabel'].some(sel => {
        const el = document.querySelector(sel); return el && Number(getComputedStyle(el).opacity) > .001;
      });
      // Desk ancestors can move the whole shell. Unrelated descendants (row
      // fades, activity badges) cannot: waiting for all of them never settles.
      // Keep the card/banner and their descendants guarded, including controls.
      const animations = document.getAnimations().filter(a => {
        const t = a.effect?.target, timing = a.effect?.getComputedTiming();
        return t instanceof Element && timing?.iterations !== Infinity && (a.pending || ['running', 'pending'].includes(a.playState))
          && ((desk && t.contains(desk)) || targets.slice(1).some(n => n && (t.contains(n) || n.contains(t))));
      });
      const running = animations.length > 0;
      const d = desk && rect(desk);
      const ready = document.documentElement.dataset.shell === 'phone' && __wos.idx === deskIndex
        && d && Math.abs(d.x) <= .5 && Math.abs(d.width - innerWidth) <= .5
        && visible(desk) && !transient && !running && targets.slice(1).every(n => n && exposed(n))
        && (state === 'outage' ? banner?.dataset.wxnet === 'reconnecting' : !banner);
      const sample = ready ? JSON.stringify(targets.map(n => [n.tagName, ...Object.values(rect(n)).map(v => Math.round(v * 10) / 10)])) : '';
      if (!ready || sample !== previous) { stableAt = performance.now(); previous = sample; }
      if (ready && performance.now() - stableAt >= 600) return { state, desk: d, card: rect(card), retry: rect(retry), troubleshoot: rect(troubleshoot), banner: banner ? rect(banner) : null, stableForMs: performance.now() - stableAt, fullOpacity: true, allControlsExposed: true };
      lastReason = { state, desk: d, transient, running,
        live: { ok: window.WizLive?.ok, error: window.WizLive?.error, loading: !!window.WizLive?.loading },
        net: window.__statusLog?.slice(-6),
        animations: animations.map(a => ({ target: describe(a.effect.target), name: a.animationName || a.transitionProperty, time: a.currentTime, state: a.playState })),
        targets: targets.filter(Boolean).map(n => ({ tag: describe(n), ...rect(n), visible: visible(n), exposed: exposed(n), blockers: blockers(n) })), banner: banner?.dataset.wxnet || null };
      if (!trail.length || performance.now() - trail[trail.length - 1].at >= 500) trail.push({ at: performance.now(), ...lastReason });
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return { captureRefused: true, reason: lastReason, trail };
  }, { deskIndex, state });
  if (geometry.captureRefused) {
    fs.writeFileSync(file.replace(/\.png$/, '.failure.json'), JSON.stringify(geometry, null, 2));
    await page.screenshot({ path: file.replace(/\.png$/, '.not-accepted.png') });
    throw new Error('Shell/card did not settle: ' + JSON.stringify(geometry.reason));
  }
  await page.screenshot({ path: file });
  return geometry;
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/wizard-os-home/`;
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const results = [];
  try {
    for (const skin of ['nebula', 'signal']) {
      const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
      const page = await context.newPage(), posts = [], healthPolls = [];
      page.setDefaultTimeout(12000);
      let broken = false, unhealthy = false;
      await page.route('**/*', async route => {
        const req = route.request(), u = new URL(req.url()), p = u.pathname;
        if (p.startsWith('/wizard-os-home/')) return route.continue();
        const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (req.method() !== 'GET') {
          if (p.endsWith('/runs')) { posts.push(JSON.parse(req.postData())); return json({ error: 'Synthetic temporary admission failure' }, 503); }
          return json({ ok: true }); // all writes are intercepted; nothing leaves this local browser.
        }
        if (p === '/troubleshoot/api/ping') return json({ ok: true });
        if (p === '/troubleshoot/api/status') {
          if (u.searchParams.get('source') === 'connection-banner') healthPolls.push({ unhealthy, at: Date.now() });
          return json(unhealthy ? { checks: [{ id: 'agent-service', ok: false }], overall: 'down' } : { checks: [], overall: 'ok' });
        }
        if ((p.endsWith('/sessions') || p.endsWith('/agents')) && broken) return json({ error: 'Synthetic connection outage' }, 503);
        if (p.endsWith('/sessions') || p.includes('/sessions/search')) return json({ sessions: [fixture], has_more: false });
        if (p.endsWith('/agents')) return json({ agents: [] });
        if (p.endsWith('/models')) return json({ default_model: 'synthetic-model', default_provider: 'synthetic', models: [{ id: 'synthetic-model', provider: 'synthetic', label: 'Synthetic model' }], providers: [] });
        if (p.endsWith('/stream') || p.endsWith('/events')) return route.abort();
        if (p.endsWith('/prefs')) return json({ prefs: {} });
        if (p === '/apps/api' || p === '/apps/catalog') return json({ apps: [] });
        return json({ ok: true, sessions: [], agents: [], messages: [], providers: [], files: [], models: [] });
      });
      await page.addInitScript(skin => {
        localStorage.setItem('wux.shell', 'phone');
        localStorage.setItem('wos.coached', 'true');
        localStorage.setItem('wos.tour.v1', 'true');
        localStorage.setItem('wos.skin', skin);
      }, skin);
      await page.goto(base, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.ch-list', { timeout: 45000 });
      await page.waitForFunction(() => window.WizLive?.ok && window.WosOutbox?.recoveryComplete);
      assert.equal(await page.evaluate(() => WosSkin.current), skin, 'exercise the requested real skin, not an ignored fixture key');
      // Chats is mounted offscreen on Home. DOM presence alone never proves a tappable card.
      const chatsDesk = await page.evaluate(() => __wos.desks.findIndex(d => d.wins.some(id => __wos.wins[id]?.app === 'chats')));
      assert.ok(chatsDesk > 0, 'the initial Chats desk exists beside Home');
      await page.locator(`#dock [data-goto="${chatsDesk}"]`).click();
      await page.waitForFunction(i => __wos.idx === i, chatsDesk);
      const id = await page.evaluate(async sid => {
        const item = await WosOutbox.enqueue({ kind: 'reply', sessionId: sid, text: 'Synthetic unsent message', model: 'synthetic-model', provider: 'synthetic' });
        return item.id;
      }, sid);
      await page.waitForFunction(id => WosOutbox.get(id)?.state === 'waiting', id, { timeout: 15000 });
      await page.evaluate(() => WizReach.diagnose(0));
      await page.waitForFunction(() => document.querySelector('[data-sendpill]')?.textContent.includes('Message not sent'));
      assert.equal(await page.locator('[data-wxnet]').count(), 0, 'healthy reads + saved message must not create a connection banner');
      assert.equal(await page.locator('[data-sendpill]').count(), 1);
      const captures = [await settledCapture(page, chatsDesk, 'waiting', path.join(out, `phone-${skin}-waiting.png`))];
      const before = posts.length;
      const priorAttempts = await page.evaluate(id => WosOutbox.get(id).attempts, id);
      const retry = page.locator('[data-sendpill] [data-obretry]');
      const box = await retry.boundingBox();
      assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= 412 && box.y + box.height <= 915, 'Retry is inside the phone viewport');
      assert.equal(await retry.evaluate(el => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }), true, 'Retry is not covered by Home or another desk');
      await retry.click(); // ordinary Playwright actionability, never force or DOM dispatch
      await page.waitForFunction(({ id, priorAttempts }) => WosOutbox.get(id)?.state === 'waiting' && WosOutbox.get(id)?.attempts > priorAttempts, { id, priorAttempts });
      assert.ok(posts.length > before, 'Retry now still submits the saved envelope');
      assert.deepEqual(posts.at(-1), posts[0], 'retry preserves the sealed envelope and idempotency key');
      const custody = await page.evaluate(id => { const x = WosOutbox.get(id); return { state: x.state, durable: x.durable, text: x.text, id: x.id }; }, id);
      assert.equal(custody.state, 'waiting'); assert.equal(custody.durable, true);
      assert.equal(custody.text, 'Synthetic unsent message');
      // A failed read with healthy connection evidence is deliberately quiet.
      // Exercise that override explicitly, not as an accidental transient "outage".
      broken = true;
      await page.evaluate(async () => { await WizLive.refresh(); });
      await page.evaluate(() => WizReach.diagnose(0));
      await page.waitForFunction(() => !document.querySelector('[data-wxnet]'), null, { timeout: 10000 });
      assert.equal(await page.evaluate(() => WizLive.error), 'offline', 'fresh healthy connection evidence quiets a failed read without claiming the read succeeded');
      // A real diagnosed service outage must remain visible after the 5s health
      // poll, not vanish because our fixture kept reporting every check healthy.
      unhealthy = true;
      const outageStarted = Date.now();
      await page.evaluate(async () => { await WizReach.diagnose(0); await WizLive.refresh(); });
      await page.waitForSelector('[data-wxnet="reconnecting"]', { timeout: 10000 });
      await page.waitForTimeout(6500);
      assert.ok(healthPolls.some(p => p.unhealthy && p.at >= outageStarted), 'the connection-banner health poll actually observed the service outage');
      captures.push(await settledCapture(page, chatsDesk, 'outage', path.join(out, `phone-${skin}-outage.png`)));
      broken = unhealthy = false;
      await page.evaluate(async () => { await WizReach.diagnose(0); await WizLive.refresh(); });
      await page.waitForFunction(() => !document.querySelector('[data-wxnet]'));
      assert.equal(await page.locator('[data-sendpill]').count(), 1, 'recovery never hides the unsent-message card');
      captures.push(await settledCapture(page, chatsDesk, 'recovered', path.join(out, `phone-${skin}-recovered.png`)));
      results.push({ skin, visibleRetry: true, custodyPreserved: true, retryEnvelopePreserved: true, connectionRecovery: true, healthyProbeOverride: true, outageAfterHealthPoll: true, settledCaptures: captures, postCount: posts.length });
      await context.close();
    }
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ ok: true, results }, null, 2));
    console.log(JSON.stringify({ ok: true, results, out }));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(e => { console.error(e); process.exitCode = 1; server.close(); });
