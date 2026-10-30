// Deterministic mobile QA for persistent per-thread device markers.
// Usage: QA_WEB_DIR=<tree> QA_SHOTS=<dir> node qa-thread-device.cjs
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const ORIGIN = require('./tools/qa-paths.cjs').origin();
const WEB = process.env.QA_WEB_DIR || __dirname, SHOTS = process.env.QA_SHOTS || '';
const WIDTH = Number(process.env.QA_WIDTH || 390), HEIGHT = Number(process.env.QA_HEIGHT || 844), MOBILE = WIDTH < 720;
const URL_ = ORIGIN + `/wizard-os-home/${MOBILE ? '' : 'desktop.html'}`;
const NOW = Date.now(), THREADS = [
  { id: 'qa-device-a', title: 'Prepare phone handoff', source: 'api_server', status: 'completed', message_count: 2, preview: 'Ready when the right device is available.', last_active: NOW / 1000 - 60, started_at: NOW / 1000 - 360 },
  { id: 'qa-device-b', title: 'Review desktop layout', source: 'api_server', status: 'completed', message_count: 2, preview: 'Needs a quick visual check.', last_active: NOW / 1000 - 120, started_at: NOW / 1000 - 420 },
];
const records = { 'direct:qa-device-b': { deferred: false, device: 'Abby', updatedAt: new Date(NOW - 1000).toISOString(), agent_id: 'hermes', session_id: 'qa-device-b' } };
const writes = [], CT = { '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.js': 'application/javascript' };
let pass = 0, fail = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = (c, name, detail = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, detail && JSON.stringify(detail)); } };

let browser;
(async () => {
  browser = await chromium.launch(process.env.QA_CHROME ? { executablePath: process.env.QA_CHROME, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: MOBILE ? 2 : 1, hasTouch: MOBILE, isMobile: MOBILE, ignoreHTTPSErrors: true });
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await ctx.route('**/*', async route => {
    const req = route.request(), u = new URL(req.url()), method = req.method();
    if (u.hostname !== new URL(ORIGIN).hostname) return method === 'GET' ? route.continue() : route.abort();
    const shell = u.pathname.match(/^\/wizard-os-home\/(.*)$/);
    if (shell && (method === 'GET' || method === 'HEAD')) {
      const file = shell[1] || 'index.html', source = path.join(WEB, 'web', file);
      if (!fs.existsSync(source) || /^(data|summaries)\.js$/.test(file)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      return route.fulfill({ status: 200, contentType: CT[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(source) });
    }
    if (u.pathname === '/wizard/v1/bootstrap') return json(route, { bootstrap: 1, api: 'wizard-agent-service/1', settings: { owner: { name: 'Robin', place: '' }, agent: { name: 'Merlin' }, clock: { timezone: 'UTC', day_starts_at: '06:00' }, voice: { language: 'en', vocabulary: [] } }, capabilities: { voice: false, router: false, files: true, approvals: true, steer: true, markdown: true }, endpoints: { sessions: '/wizard/hermes/api/sessions', runs: '/wizard/hermes/v1/runs', apps: '/wizard/v1/apps' } });
    if (u.pathname === '/wizard/v1/apps') return json(route, { apps: [] });
    if (u.pathname === '/wizard/hermes/api/model/options') return json(route, { provider: 'openai-codex', providers: [{ slug: 'openai-codex', authenticated: true }] });
    if (u.pathname === '/wizard/v1/setup') return json(route, { first_run: false });
    if (u.pathname === '/wizard/hermes/api/sessions') return json(route, { data: THREADS, has_more: false });
    const messages = u.pathname.match(/^\/wizard\/hermes\/api\/sessions\/([^/]+)\/messages$/);
    if (messages) return json(route, { object: 'list', data: [{ id: 1, role: 'user', content: 'Synthetic request', timestamp: NOW / 1000 - 200 }, { id: 2, role: 'assistant', content: 'Synthetic answer', timestamp: NOW / 1000 - 180 }], pagination: { returned: 2, offset: 0, limit: 500 } });
    const detail = u.pathname.match(/^\/wizard\/hermes\/api\/sessions\/([^/]+)$/);
    if (detail && method === 'GET') { const row = THREADS.find(t => t.id === decodeURIComponent(detail[1])); return row ? json(route, { session: row }) : json(route, { error: 'not_found' }, 404); }
    if (u.pathname === '/wizard/thread-seen') return method === 'GET' ? json(route, { state: { initializedAt: NOW - 864e5, threads: {} } }) : json(route, { state: JSON.parse(req.postData() || '{}') });
    if (u.pathname === '/wizard/thread-dispositions') {
      if (method === 'GET') return json(route, { state: records });
      if (method === 'PUT') {
        const body = JSON.parse(req.postData() || '{}'), key = `direct:${body.sessionId}`, prev = records[key] || { deferred: false, agent_id: 'hermes', session_id: body.sessionId };
        const record = { ...prev, ...(typeof body.deferred === 'boolean' ? { deferred: body.deferred } : {}), updatedAt: new Date().toISOString() };
        if (Object.hasOwn(body, 'device')) { if (body.device) record.device = body.device; else delete record.device; }
        records[key] = record; writes.push(body); return json(route, { record });
      }
    }
    if (method !== 'GET' && method !== 'HEAD') return json(route, { error: 'qa: write refused' }, 403);
    return json(route, {});
  });
  await ctx.addInitScript(() => { localStorage.clear(); localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); localStorage.setItem('wos.welcome.v1', 'done'); });
  const page = await ctx.newPage(), errors = [];
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(String(error)));
  const longPress = async locator => {
    const box = await locator.boundingBox(); if (!box) throw new Error('long-press target is not visible');
    const init = { pointerId: 77, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 };
    await locator.dispatchEvent('pointerdown', init); await sleep(650); await locator.dispatchEvent('pointerup', { ...init, buttons: 0 });
  };

  await page.goto(URL_, { waitUntil: 'load' });
  if (MOBILE) await page.waitForFunction(() => window.__wos?.live?.ok, null, { timeout: 30000 });
  else await page.waitForSelector('[data-chopen="qa-device-b"]', { timeout: 30000 });
  if (MOBILE) await page.evaluate(() => window.__wos.goDesk(1, true));
  await page.waitForSelector('[data-chopen="qa-device-b"] .ch-device-tag'); await sleep(500);
  ok((await page.locator('[data-chopen="qa-device-b"] .ch-device-tag').textContent()).trim() === 'Abby', 'saved device appears on its thread row');

  const first = page.locator('[data-chopen="qa-device-a"]').first(); await longPress(first);
  await page.locator('[data-rsdevice]').click();
  await page.locator('[data-dvform] input').fill('Quinn');
  await page.locator('[data-dvform] button[type="submit"]').click();
  await page.waitForFunction(() => document.querySelector('[data-chopen="qa-device-a"] .ch-device-tag')?.textContent.trim() === 'Quinn');
  ok(writes.at(-1)?.device === 'Quinn', 'assigning Quinn writes the exact device value', writes.at(-1));

  await page.evaluate(({ id, mobile }) => mobile ? window.__wos.openWizardThread(id) : window.__wux.openThread(id), { id: 'qa-device-a', mobile: MOBILE }); await page.waitForSelector('.ch-thread .ch-device-tag.header');
  ok((await page.locator('.ch-thread .ch-device-tag.header').textContent()).trim() === 'Quinn', 'open thread header carries the device marker');
  await page.locator('.ch-thread .ch-device-tag.header').click();
  ok(await page.locator('[data-dvform] input').inputValue() === 'Quinn', 'header marker reopens the device editor');
  await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('[data-dvform]'));
  if (MOBILE) await page.locator('[data-chback]').click();

  await longPress(page.locator('[data-chopen="qa-device-a"]').first()); await page.locator('[data-rsdevice]').click(); await page.locator('[data-dvclear]').click();
  await page.waitForFunction(() => !document.querySelector('[data-chopen="qa-device-a"] .ch-device-tag'));
  ok(writes.at(-1)?.device === '', 'clear sends an explicit empty device', writes.at(-1));

  await longPress(page.locator('[data-chopen="qa-device-a"]').first()); await page.locator('[data-rsdevice]').click(); await page.locator('[data-dvform] input').fill('Quinn'); await page.locator('[data-dvform] button[type="submit"]').click();
  await page.waitForFunction(() => document.querySelector('[data-chopen="qa-device-a"] .ch-device-tag')?.textContent.trim() === 'Quinn');
  await page.locator('[data-chfbtn]').click(); await page.locator('[data-chfopt="device:Quinn"]').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-chopen]').length === 1 && document.querySelector('[data-chopen]')?.dataset.chopen === 'qa-device-a');
  ok((await page.locator('.ch-chip.device').textContent()).includes('Quinn'), 'device filter shows a Quinn chip and only Quinn threads');
  await sleep(1800); // let the assignment receipt clear before appearance capture
  if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `thread-device-filter-${MOBILE ? 'mobile' : 'desktop'}.png`), fullPage: true }); }

  await page.reload({ waitUntil: 'load' });
  if (MOBILE) await page.waitForFunction(() => window.__wos?.live?.ok, null, { timeout: 30000 });
  else await page.waitForSelector('[data-chopen="qa-device-a"]', { timeout: 30000 });
  if (MOBILE) await page.evaluate(() => window.__wos.goDesk(1, true));
  await page.waitForFunction(() => document.querySelector('[data-chopen="qa-device-a"] .ch-device-tag')?.textContent.trim() === 'Quinn');
  ok(records['direct:qa-device-a']?.device === 'Quinn', 'device survives a full reload from the shared disposition store');
  await page.locator('[data-chsearch]').fill('Quinn'); await sleep(350);
  ok(await page.locator('[data-chopen="qa-device-a"]').count() === 1 && await page.locator('[data-chopen="qa-device-b"]').count() === 0, 'search matches the device name');
  ok(errors.length === 0, 'browser emitted no page errors', errors);

  await browser.close(); browser = null;
  console.log(`RESULT ${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
})().catch(async error => { console.error(error); try { await browser?.close(); } catch (_) {} process.exitCode = 1; });
