// QA: Mark unread is Ready-only, durable, race-safe and rollback-safe.
// Usage: QA_WEB_DIR=<tree> node qa-mark-unread.cjs
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const ORIGIN = require('./tools/qa-paths.cjs').origin(), URL_ = ORIGIN + '/wizard-os-home/';
const WEB = process.env.QA_WEB_DIR || __dirname;
const NOW = Date.now();
const SID = 'qa-ready-unread';
const IDS = { ready: SID, working: 'qa-working', yesterday: 'qa-yesterday', past: 'qa-past-week', archive: 'qa-archive' };
const session = (id, status, ageMs, archived = false) => {
  const at = NOW - ageMs;
  return {
    id,
    source: 'api_server',
    title: id.replace(/^qa-/, 'QA ').replaceAll('-', ' '),
    status,
    archived,
    model: 'qa',
    message_count: 2,
    started_at: at / 1000 - 60,
    last_active: at / 1000,
    wizard_last_user_at: at / 1000 - 30,
    wizard_last_assistant_at: at / 1000,
    wizard_activity_at: at / 1000,
    latest_message: { role: 'assistant', content: 'Ready answer', timestamp: at / 1000 },
    last_user_message: { role: 'user', content: 'Ready question', timestamp: at / 1000 - 30 },
  };
};
const THREADS = [
  session(IDS.ready, 'completed', 60_000),
  session(IDS.working, 'running', 30_000),
  session(IDS.yesterday, 'completed', 36 * 3600_000),
  session(IDS.past, 'completed', 4 * 86400_000),
  session(IDS.archive, 'completed', 10 * 86400_000, true),
];
const seenRecord = thread => ({
  messageCount: 2,
  status: thread.status,
  updatedAt: new Date(thread.last_active * 1000).toISOString(),
  previewFingerprint: 'qa',
  assistantActivityAt: new Date(thread.last_active * 1000).toISOString(),
  seenAt: NOW,
});
let seenState = {
  initializedAt: NOW - 3600_000,
  threads: Object.fromEntries(THREADS.map(thread => [`direct:${thread.id}`, seenRecord(thread)])),
};
// Read state and run state are independent. Even if a working thread has unread activity,
// Working stays visually quiet until the run moves to Ready.
seenState.threads[`direct:${IDS.working}`].unreadAt = NOW + 1;
let writeMode = 'ok';
const writes = [];
const CT = { '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.js': 'application/javascript' };
let pass = 0, fail = 0;
const ok = (condition, name, extra = '') => {
  if (condition) { pass++; console.log('PASS', name); }
  else { fail++; console.log('FAIL', name, typeof extra === 'string' ? extra : JSON.stringify(extra)); }
};
  const screenshot = async (page, shell) => {
    if (!process.env.QA_OUT) return;
    fs.mkdirSync(process.env.QA_OUT, { recursive: true });
    await page.screenshot({ path: path.join(process.env.QA_OUT, `mark-unread-${process.env.QA_SKIN || 'nebula'}-${shell}.png`) });
  };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const browser = await chromium.launch(process.env.QA_CHROME ? { executablePath: process.env.QA_CHROME } : {});
  const context = await browser.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true });
  const json = (route, value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
  const serve = async route => {
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
        const incoming = JSON.parse(request.postData() || '{}');
        const mode = writeMode; writeMode = 'ok';
        if (mode === 'http-fail') return json(route, { error: 'qa-forced' }, 500);
        if (mode === 'strip') {
          seenState = structuredClone(incoming);
          for (const record of Object.values(seenState.threads)) delete record.unreadAt;
          return json(route, { state: seenState });
        }
        if (mode === 'newer-seen') {
          seenState = structuredClone(incoming);
          for (const record of Object.values(seenState.threads)) if (record.unreadAt) record.seenAt = record.unreadAt + 1;
          return json(route, { state: seenState });
        }
        seenState = incoming;
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
    if (url.pathname === '/wizard/hermes/api/sessions') return json(route, { object: 'list', data: THREADS, has_more: false });
    const messages = url.pathname.match(/^\/wizard\/hermes\/api\/sessions\/([^/]+)\/messages$/);
    if (messages) return json(route, { object: 'list', data: [
      { id: 1, session_id: messages[1], role: 'user', content: 'Ready question', timestamp: NOW / 1000 - 90 },
      { id: 2, session_id: messages[1], role: 'assistant', content: 'Ready answer', timestamp: NOW / 1000 - 60 },
    ], pagination: { limit: 500, offset: 0, returned: 2 } });
    const detail = url.pathname.match(/^\/wizard\/hermes\/api\/sessions\/([^/]+)$/);
    if (detail) return json(route, { session: THREADS.find(thread => thread.id === detail[1]) });
    if (url.pathname === '/wizard/thread-seen') return json(route, { state: seenState });
    if (url.pathname === '/wizard/thread-dispositions') return json(route, { state: {} });
    if (url.pathname === '/wizard/v1/agents') return json(route, { agents: [] });
    if (url.pathname === '/wizard/v1/apps') return json(route, { apps: [] });
    return json(route, {});
  };
  const initPrefs = skin => {
    try {
      localStorage.setItem('wos.coached', 'true');
      localStorage.setItem('wos.voiceTipSeen', 'true');
      localStorage.setItem('wos.tour.done', 'true');
      if (skin) localStorage.setItem('wos.skin', skin);
      localStorage.setItem('wos.chats.layout.v1', 'day');
    } catch {}
  };
  await context.route('**/*', serve);
  await context.addInitScript(initPrefs, process.env.QA_SKIN || 'nebula');
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  const selector = id => `.ch-list [data-chopen="${id}"]`;
  const openSheet = async id => {
    const row = page.locator(selector(id));
    if (!await row.count()) {
      const section = await page.evaluate(threadId => {
        const groups = window.__wos.live.workGroups();
        return Object.keys(groups).find(key => groups[key].some(thread => thread.id === threadId)) || '';
      }, id);
      const toggle = page.locator(`[data-sectoggle="${section}"]`);
      if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.evaluate(button => button.click());
    }
    await row.waitFor({ state: 'attached' });
    await row.dispatchEvent('contextmenu', { button: 2 });
    await page.waitForSelector('.ch-sheet');
    return page.locator('.ch-sheet [data-rsact]').evaluateAll(buttons => buttons.map(button => button.dataset.rsact));
  };
  const closeSheet = async () => { await page.keyboard.press('Escape'); await page.waitForSelector('.ch-sheet', { state: 'detached' }); };
  const unread = () => page.locator(selector(SID)).evaluate(row => row.classList.contains('unread'));
  const markUnread = async mode => {
    writeMode = mode;
    await openSheet(SID);
    await page.locator('.ch-sheet [data-rsact="unread"]').evaluate(button => button.click());
    await page.waitForFunction(() => !document.querySelector('.ch-sheet'));
    await sleep(100);
  };

  await page.goto(URL_, { waitUntil: 'load' });
  await page.waitForFunction(id => window.__wos?.live?.ok && window.__wos.live.session(id), SID, { timeout: 30000 });
  await page.evaluate(() => window.__wos.goDesk(1));
  await page.waitForSelector(selector(SID), { timeout: 15000 });
  ok(!await unread(), 'fixture starts read');
  const workingVisual = await page.locator(selector(IDS.working)).evaluate((row, id) => {
    const session = window.__wos.live.session(id);
    return {
      inWorking: window.__wos.live.workGroups().working.some(thread => thread.id === id),
      unreadState: window.__wos.live.isNew(session),
      unreadClass: row.classList.contains('unread'),
      titleWeight: Number(getComputedStyle(row.querySelector('.tp b')).fontWeight),
    };
  }, IDS.working);
  ok(workingVisual.inWorking && workingVisual.unreadState && !workingVisual.unreadClass && workingVisual.titleWeight <= 600,
    'Working stays unbolded even when its read state is unread', workingVisual);

  const readyRow = page.locator(selector(SID));
  ok(await readyRow.getAttribute('aria-haspopup') === 'dialog' && await readyRow.getAttribute('aria-keyshortcuts') === 'Shift+F10', 'row announces its keyboard-accessible actions menu');
  await readyRow.focus();
  await page.keyboard.press('Shift+F10');
  await page.waitForSelector('.ch-sheet');
  ok(await page.evaluate(() => document.activeElement?.closest('.ch-sheet') !== null), 'keyboard actions move focus into the dialog');
  let actions = await page.locator('.ch-sheet [data-rsact]').evaluateAll(buttons => buttons.map(button => button.dataset.rsact));
  ok(actions[0] === 'unread', 'keyboard context menu exposes Mark unread on a read Ready item', actions);
  await screenshot(page, 'phone');
  await closeSheet();
  ok(await readyRow.evaluate(row => document.activeElement === row), 'closing the dialog returns focus to its Ready row');

  for (const [id, label] of [[IDS.working, 'Working'], [IDS.yesterday, 'Yesterday'], [IDS.past, 'Past week'], [IDS.archive, 'Archive']]) {
    actions = await openSheet(id);
    ok(!actions.includes('unread'), `${label} item does not offer Mark unread`, actions);
    await closeSheet();
  }

  await markUnread('http-fail');
  ok(!await unread(), 'HTTP failure rolls the optimistic unread row back');
  let local = await page.evaluate(() => JSON.parse(localStorage.getItem('wizard.thread-seen.v1:wizard-account-local') || 'null'));
  ok(!(local.threads[`direct:${SID}`].unreadAt > local.threads[`direct:${SID}`].seenAt), 'HTTP failure rolls localStorage back');

  await markUnread('strip');
  ok(!await unread(), 'server response without unreadAt rolls the row back');
  local = await page.evaluate(() => JSON.parse(localStorage.getItem('wizard.thread-seen.v1:wizard-account-local') || 'null'));
  ok(!(local.threads[`direct:${SID}`].unreadAt > local.threads[`direct:${SID}`].seenAt), 'server response without unreadAt rolls localStorage back');

  await markUnread('newer-seen');
  ok(!await unread(), 'a concurrent newer seenAt wins during the unread write');
  local = await page.evaluate(() => JSON.parse(localStorage.getItem('wizard.thread-seen.v1:wizard-account-local') || 'null'));
  ok(local.threads[`direct:${SID}`].seenAt > local.threads[`direct:${SID}`].unreadAt, 'concurrent read state is retained locally');

  const box = await readyRow.boundingBox();
  await readyRow.dispatchEvent('pointerdown', { pointerType: 'touch', button: 0, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 });
  await sleep(650);
  await readyRow.dispatchEvent('pointerup', { pointerType: 'touch', button: 0, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 });
  await page.waitForSelector('.ch-sheet');
  actions = await page.locator('.ch-sheet [data-rsact]').evaluateAll(buttons => buttons.map(button => button.dataset.rsact));
  ok(actions[0] === 'unread', 'mobile long-press offers Mark unread first', actions);
  await page.locator('.ch-sheet [data-rsact="unread"]').evaluate(button => button.click());
  await page.waitForFunction(id => document.querySelector(`.ch-list [data-chopen="${id}"]`)?.classList.contains('unread'), SID, { timeout: 5000 });
  const stored = seenState.threads[`direct:${SID}`];
  ok(stored.unreadAt > stored.seenAt, 'Mark unread persists an unreadAt marker newer than seenAt', stored);
  ok(await page.evaluate(id => window.__wos.live.workGroups().ready.some(thread => thread.id === id), SID), 'item stays in Ready');
  actions = await openSheet(SID);
  ok(!actions.includes('unread'), 'already-unread Ready item does not offer Mark unread again', actions);
  await closeSheet();

  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(id => document.querySelector(`.ch-list [data-chopen="${id}"]`)?.classList.contains('unread'), SID, { timeout: 15000 });
  ok(true, 'unread marker survives reload');

  seenState.threads[`direct:${SID}`].seenAt = seenState.threads[`direct:${SID}`].unreadAt + 1;
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(id => {
    const row = document.querySelector(`.ch-list [data-chopen="${id}"]`);
    return row && !row.classList.contains('unread');
  }, SID, { timeout: 15000 });
  ok(true, 'a newer seenAt from another client clears the unread row after the write');
  ok(writes.filter(write => write.path === '/wizard/thread-seen').length >= 4, 'all thread-seen write paths were exercised');
  ok(errors.length === 0, 'no page errors', errors);

  const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true });
  await desktop.route('**/*', serve);
  await desktop.addInitScript(initPrefs, process.env.QA_SKIN || 'nebula');
  const desktopPage = await desktop.newPage();
  const desktopErrors = [];
  desktopPage.on('pageerror', error => desktopErrors.push(String(error)));
  await desktopPage.goto(URL_, { waitUntil: 'load' });
  const desktopRow = desktopPage.locator(selector(SID));
  await desktopRow.waitFor({ state: 'attached' });
  await desktopRow.focus();
  await desktopPage.keyboard.press('Shift+F10');
  await desktopPage.waitForSelector('.ch-sheet');
  const desktopActions = await desktopPage.locator('.ch-sheet [data-rsact]').evaluateAll(buttons => buttons.map(button => button.dataset.rsact));
  ok(desktopActions.includes('unread'), 'desktop keyboard context menu offers Mark unread on a read Ready item', desktopActions);
  await screenshot(desktopPage, 'desktop');
  ok(desktopErrors.length === 0, 'desktop has no page errors', desktopErrors);
  await desktop.close();

  const formerlyWorking = THREADS.find(thread => thread.id === IDS.working);
  formerlyWorking.status = 'completed';
  const workingRecord = seenState.threads[`direct:${IDS.working}`];
  workingRecord.unreadAt = workingRecord.seenAt + 1;
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(id => document.querySelector(`.ch-list [data-chopen="${id}"]`), IDS.working, { timeout: 15000 });
  const readyVisual = await page.locator(selector(IDS.working)).evaluate((row, id) => {
    const session = window.__wos.live.session(id);
    return {
      inReady: window.__wos.live.workGroups().ready.some(thread => thread.id === id),
      unreadState: window.__wos.live.isNew(session),
      unreadClass: row.classList.contains('unread'),
      titleWeight: Number(getComputedStyle(row.querySelector('.tp b')).fontWeight),
    };
  }, IDS.working);
  ok(readyVisual.inReady && readyVisual.unreadState && readyVisual.unreadClass && readyVisual.titleWeight >= 700,
    'The same unread thread becomes bold when it moves to Ready', readyVisual);

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(error => { console.error(error); process.exit(2); });
