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
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/wizard-os-home/`;
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const results = [];
  try {
    for (const skin of ['nebula', 'signal']) {
      const context = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
      const page = await context.newPage(), posts = [];
      let broken = false;
      await page.route('**/*', async route => {
        const req = route.request(), u = new URL(req.url()), p = u.pathname;
        if (p.startsWith('/wizard-os-home/')) return route.continue();
        const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
        if (req.method() !== 'GET') {
          if (p.endsWith('/runs')) { posts.push(JSON.parse(req.postData())); return json({ error: 'Synthetic temporary admission failure' }, 503); }
          return json({ ok: true }); // all writes are intercepted; nothing leaves this local browser.
        }
        if (p === '/troubleshoot/api/ping') return json({ ok: true });
        if (p === '/troubleshoot/api/status') return json({ checks: [], overall: 'ok' });
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
        localStorage.setItem('wos.shell.v1', 'phone');
        localStorage.setItem('wos.tour.v1', 'true');
        localStorage.setItem('wos.skins.v1', JSON.stringify({ id: skin, vars: {}, nativeOn: false }));
        localStorage.setItem('wos.state.v2', JSON.stringify({ v: 2, active: 'Chats', wins: [{ id: 'Chats', type: 'chats', name: 'Chats', thread: null, focus: 'all', rail: false, m: false, z: 2, sz: [400, 800] }] }));
      }, skin);
      await page.goto(base, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.ch-list', { timeout: 45000 });
      await page.waitForFunction(() => window.WizLive?.ok && window.WosOutbox?.recoveryComplete);
      const id = await page.evaluate(async sid => {
        const item = await WosOutbox.enqueue({ kind: 'reply', sessionId: sid, text: 'Synthetic unsent message', model: 'synthetic-model', provider: 'synthetic' });
        return item.id;
      }, sid);
      await page.waitForFunction(id => WosOutbox.get(id)?.state === 'waiting', id, { timeout: 15000 });
      await page.evaluate(() => WizReach.diagnose(0));
      await page.waitForFunction(() => document.querySelector('[data-sendpill]')?.textContent.includes('Message not sent'));
      assert.equal(await page.locator('[data-wxnet]').count(), 0, 'healthy reads + saved message must not create a connection banner');
      assert.equal(await page.locator('[data-sendpill]').count(), 1);
      await page.screenshot({ path: path.join(out, `phone-${skin}-waiting.png`), fullPage: true });
      const before = posts.length;
      await page.locator('[data-sendpill] [data-obretry]').click();
      await page.waitForFunction(id => WosOutbox.get(id)?.state === 'waiting' && WosOutbox.get(id)?.attempts >= 2, id);
      assert.ok(posts.length > before, 'Retry now still submits the saved envelope');
      assert.deepEqual(posts.at(-1), posts[0], 'retry preserves the sealed envelope and idempotency key');
      const custody = await page.evaluate(id => { const x = WosOutbox.get(id); return { state: x.state, durable: x.durable, text: x.text, id: x.id }; }, id);
      assert.equal(custody.state, 'waiting'); assert.equal(custody.durable, true);
      assert.equal(custody.text, 'Synthetic unsent message');
      broken = true;
      await page.evaluate(async () => { await WizLive.refresh(); });
      await page.waitForSelector('[data-wxnet="reconnecting"]');
      await page.screenshot({ path: path.join(out, `phone-${skin}-outage.png`), fullPage: true });
      broken = false;
      await page.evaluate(async () => { await WizLive.refresh(); });
      await page.waitForFunction(() => !document.querySelector('[data-wxnet]'));
      assert.equal(await page.locator('[data-sendpill]').count(), 1, 'recovery never hides the unsent-message card');
      results.push({ skin, custodyPreserved: true, retryEnvelopePreserved: true, connectionRecovery: true, postCount: posts.length });
      await context.close();
    }
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ ok: true, results }, null, 2));
    console.log(JSON.stringify({ ok: true, results, out }));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(e => { console.error(e); process.exitCode = 1; server.close(); });
