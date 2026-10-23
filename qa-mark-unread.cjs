// QA: a read Ready row can be marked unread and the marker survives reload.
// Usage: QA_WEB_DIR=<tree> node qa-mark-unread.cjs
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const ORIGIN = require('./tools/qa-paths.cjs').origin(), URL_ = ORIGIN + '/wizard-os-home/';
const WEB = process.env.QA_WEB_DIR || __dirname;
const NOW = Date.now();
const SID = 'qa-ready-unread';
const LAST = NOW - 60_000;
const THREAD = {
  id: SID,
  source: 'api_server',
  title: 'QA ready unread',
  status: 'completed',
  model: 'qa',
  message_count: 2,
  started_at: LAST / 1000 - 60,
  last_active: LAST / 1000,
  wizard_last_user_at: LAST / 1000 - 30,
  wizard_last_assistant_at: LAST / 1000,
  wizard_activity_at: LAST / 1000,
  latest_message: { role: 'assistant', content: 'Ready answer', timestamp: LAST / 1000 },
  last_user_message: { role: 'user', content: 'Ready question', timestamp: LAST / 1000 - 30 },
};
let seenState = {
  initializedAt: NOW - 3600_000,
  threads: {
    [`direct:${SID}`]: {
      messageCount: 2,
      status: 'completed',
      updatedAt: new Date(LAST).toISOString(),
      previewFingerprint: 'qa',
      assistantActivityAt: new Date(LAST).toISOString(),
      seenAt: NOW,
    },
  },
};
const writes = [];
const CT = { '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.js': 'application/javascript' };
let pass = 0, fail = 0;
const ok = (condition, name, extra = '') => {
  if (condition) { pass++; console.log('PASS', name); }
  else { fail++; console.log('FAIL', name, typeof extra === 'string' ? extra : JSON.stringify(extra)); }
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const browser = await chromium.launch(process.env.QA_CHROME ? { executablePath: process.env.QA_CHROME } : {});
  const context = await browser.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true });
  const json = (route, value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    const shell = url.pathname.match(/^\/wizard-os-home\/(.*)$/);
    if (shell && (method === 'GET' || method === 'HEAD')) {
      const name = shell[1] || 'index.html', file = path.join(WEB, 'web', name);
      if (!fs.existsSync(file) || /^(data|summaries)\.js$/.test(name)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      return route.fulfill({ status: 200, contentType: CT[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
    }
    if (method !== 'GET' && method !== 'HEAD') {
      writes.push({ method, path: url.pathname, body: request.postData() || '' });
      if (url.pathname === '/wizard/thread-seen') {
        seenState = JSON.parse(request.postData() || '{}');
        return json(route, { state: seenState });
      }
      return json(route, { error: 'qa: write refused' }, 403);
    }
    if (url.pathname === '/wizard/v1/bootstrap') return json(route, {
      bootstrap: 1,
      api: 'wizard-agent-service/1',
      settings: { owner: { name: 'Robert', place: '' }, agent: { name: 'Nebula' }, clock: { timezone: 'UTC', day_starts_at: '06:00' }, voice: { language: 'en', vocabulary: [] } },
      capabilities: { voice: true, router: true, files: true, approvals: true, steer: true, markdown: true },
      endpoints: { sessions: '/wizard/hermes/api/sessions', runs: '/wizard/hermes/v1/runs', transcribe: '/wizard/voice/transcribe', route: '/wizard/v1/route', upload: '/wizard/files/upload', apps: '/wizard/v1/apps' },
    });
    if (url.pathname === '/wizard/hermes/api/sessions') return json(route, { object: 'list', data: [THREAD], has_more: false });
    if (url.pathname === `/wizard/hermes/api/sessions/${SID}`) return json(route, { session: THREAD });
    if (url.pathname === `/wizard/hermes/api/sessions/${SID}/messages`) return json(route, { object: 'list', data: [
      { id: 1, session_id: SID, role: 'user', content: 'Ready question', timestamp: LAST / 1000 - 30 },
      { id: 2, session_id: SID, role: 'assistant', content: 'Ready answer', timestamp: LAST / 1000 },
    ], pagination: { limit: 500, offset: 0, returned: 2 } });
    if (url.pathname === '/wizard/thread-seen') return json(route, { state: seenState });
    if (url.pathname === '/wizard/thread-dispositions') return json(route, { state: {} });
    if (url.pathname === '/wizard/v1/agents') return json(route, { agents: [] });
    if (url.pathname === '/wizard/v1/apps') return json(route, { apps: [] });
    return json(route, {});
  });
  await context.addInitScript(() => {
    try {
      localStorage.setItem('wos.coached', 'true');
      localStorage.setItem('wos.voiceTipSeen', 'true');
      localStorage.setItem('wos.chats.layout.v1', 'status');
    } catch {}
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(URL_, { waitUntil: 'load' });
  await page.waitForFunction(id => window.__wos?.live?.ok && window.__wos.live.session(id), SID, { timeout: 30000 });
  await page.evaluate(() => window.__wos.goDesk(1));
  await page.waitForSelector(`.ch-list [data-chopen="${SID}"]`, { timeout: 15000 });
  ok(!await page.locator(`.ch-list [data-chopen="${SID}"]`).evaluate(row => row.classList.contains('unread')), 'fixture starts read');

  const box = await page.locator(`.ch-list [data-chopen="${SID}"]`).boundingBox();
  await page.locator(`.ch-list [data-chopen="${SID}"]`).dispatchEvent('pointerdown', { pointerType: 'touch', button: 0, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 });
  await sleep(650);
  await page.locator(`.ch-list [data-chopen="${SID}"]`).dispatchEvent('pointerup', { pointerType: 'touch', button: 0, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 });
  await page.waitForSelector('.ch-sheet');
  const actions = await page.locator('.ch-sheet [data-rsact]').evaluateAll(buttons => buttons.map(button => button.dataset.rsact));
  ok(actions[0] === 'unread', 'read Ready item offers Mark unread first', actions);

  await page.locator('.ch-sheet [data-rsact="unread"]').tap();
  await page.waitForFunction(id => document.querySelector(`.ch-list [data-chopen="${id}"]`)?.classList.contains('unread'), SID, { timeout: 5000 });
  const stored = Object.values(seenState.threads)[0];
  ok(stored.unreadAt > stored.seenAt, 'Mark unread persists an unreadAt marker newer than seenAt', stored);
  ok(await page.evaluate(id => window.__wos.live.workGroups().ready.some(thread => thread.id === id), SID), 'item stays in Ready');

  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(id => document.querySelector(`.ch-list [data-chopen="${id}"]`)?.classList.contains('unread'), SID, { timeout: 15000 });
  ok(true, 'unread marker survives reload');
  ok(writes.filter(write => write.path === '/wizard/thread-seen').length >= 1, 'thread-seen write was made');
  ok(errors.length === 0, 'no page errors', errors);

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(error => { console.error(error); process.exit(2); });
