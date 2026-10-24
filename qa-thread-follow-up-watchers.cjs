// Browser QA for durable thread-bound follow-ups against the real Agent Service and its deterministic Hermes fixture.
// Usage: QA_AGENT_SERVICE=/path/to/wizard-agent-service node qa-thread-follow-up-watchers.cjs
const { chromium } = require('./tools/qa-playwright.cjs');
const { pathToFileURL } = require('node:url');
const { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const SERVICE = process.env.QA_AGENT_SERVICE;
if (!SERVICE) throw new Error('QA_AGENT_SERVICE is required');
const WEB = path.resolve(__dirname, 'web');
const OUT = process.env.QA_OUT || path.join(require('node:os').homedir(), '.hermes/cache/screenshots/thread-follow-up-watchers');
mkdirSync(OUT, { recursive: true });
const root = mkdtempSync(path.join(tmpdir(), 'thread-follow-up-browser-'));
const ownerProof = 'fixture-owner-proof-with-at-least-32-characters';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const until = async (check, timeout = 15000, step = 80) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await check(); if (value) return value; await sleep(step); }
  throw new Error('timed out waiting for fixture state');
};
let pass = 0, fail = 0;
const ok = (condition, name, detail = '') => {
  if (condition) { pass++; console.log('PASS', name); }
  else { fail++; console.log('FAIL', name, detail === '' ? '' : JSON.stringify(detail)); }
};

(async () => {
  process.env.WIZARD_SCHEDULER = '1';
  const fixtureModule = await import(pathToFileURL(path.join(SERVICE, 'server/fixture.mjs')).href);
  const serviceModule = await import(pathToFileURL(path.join(SERVICE, 'server/service.mjs')).href);
  const fixture = fixtureModule.createHermesFixture({ expectedKey: 'local-fixture-only' });
  const fixtureAddress = await serviceModule.listen(fixture, '127.0.0.1', 0);
  const fixtureOrigin = `http://127.0.0.1:${fixtureAddress.port}`;
  const privateFixture = fixtureModule.createHermesFixture({ expectedKey: 'local-fixture-only', empty: true });
  const privateFixtureAddress = await serviceModule.listen(privateFixture, '127.0.0.1', 0);
  const privateFixtureOrigin = `http://127.0.0.1:${privateFixtureAddress.port}`;
  const app = serviceModule.createWizardServer({
    upstreamOrigin: fixtureOrigin,
    helmOrigin: fixtureOrigin,
    hermesKey: 'local-fixture-only',
    ownerProof,
    requireAccess: false,
    requireJoinedDelegationCapability: false,
    followThrough: false,
    uxDir: WEB,
    wizardOsHome: path.join(root, 'wizard-os'),
    settingsPath: path.join(root, 'settings.json'),
    schedulerStatePath: path.join(root, 'schedules.sqlite3'),
    schedulerEnabled: true,
    schedulerIntervalMs: 3_600_000,
    schedulerTimezone: 'UTC',
    runQueueStatePath: path.join(root, 'run-queue.sqlite3'),
    runQueuePollIntervalMs: 40,
    agentRuntime: { apply: async () => ({ ok: true }), start: async () => ({ ok: true }), stop: async () => ({ ok: true }) },
    agentBasePort: 47800,
  });
  const appAddress = await serviceModule.listen(app, '127.0.0.1', 0);
  const origin = `http://127.0.0.1:${appAddress.port}`;
  const base = `${origin}/wizard-os-home/`;
  const headers = { 'X-Wizard-Owner-Proof': ownerProof, 'Content-Type': 'application/json' };
  const scheduler = app.scheduler;
  const thread = 'chat-recent';
  const watch = scheduler.create({ name: 'Knowledge MVP', kind: 'watch', when: { every: 10 }, prompt: 'Check the dependency.', thread, agent: 'main' });
  const privateThread = 'private-follow-up';
  await fetch(`${privateFixtureOrigin}/api/sessions`, { method: 'POST', headers: { Authorization: 'Bearer local-fixture-only', 'Content-Type': 'application/json' }, body: JSON.stringify({ id: privateThread, title: 'Private follow-up', source: 'wizard-mobile' }) });
  await fetch(`${privateFixtureOrigin}/v1/runs`, { method: 'POST', headers: { Authorization: 'Bearer local-fixture-only', 'Content-Type': 'application/json', 'Idempotency-Key': 'private-history-seed' }, body: JSON.stringify({ session_id: privateThread, input: 'Plain reply for routed watcher QA.' }) });
  await sleep(250);
  const createAgent = await fetch(`${origin}/wizard/v1/agents`, { method: 'POST', headers: { ...headers, 'Idempotency-Key': 'watcher-private-agent' }, body: JSON.stringify({ label: 'Private', harness: 'hermes', model: { provider: 'tinfoil', model: 'glm-5-3' }, permissions: { preset: 'private', read_standard_chats: false } }) });
  const createdAgent = await createAgent.json();
  if (!createAgent.ok || !createdAgent.agent?.id) throw new Error(`private agent fixture failed: ${createAgent.status}`);
  const privateAgent = createdAgent.agent.id;
  const privateRecord = path.join(root, 'wizard-os', 'agents', privateAgent, 'agent.json');
  const privateConfig = JSON.parse(readFileSync(privateRecord, 'utf8')); privateConfig.runtime.port = privateFixtureAddress.port; writeFileSync(privateRecord, JSON.stringify(privateConfig));
  writeFileSync(path.join(root, 'wizard-os', 'agents', privateAgent, 'runtime.key'), 'local-fixture-only\n');
  const routedProbe = await fetch(`${origin}/wizard/hermes/api/sessions?agent=${encodeURIComponent(privateAgent)}`, { headers });
  const routedProbeBody = await routedProbe.json().catch(() => ({}));
  if (!routedProbe.ok || !(routedProbeBody.sessions || routedProbeBody.data || []).some(item => item.id === privateThread)) throw new Error(`private agent list fixture failed: ${routedProbe.status} ${JSON.stringify(routedProbeBody)}`);
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.QA_CHROME || undefined, args: ['--no-sandbox'] });
    const ctx = await browser.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true, extraHTTPHeaders: headers });
    const page = await ctx.newPage();
    const longPress = async locator => {
      const box = await locator.boundingBox(); if (!box) throw new Error('long-press target is not visible');
      const init = { pointerId: 77, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 };
      await locator.dispatchEvent('pointerdown', init); await sleep(650); await locator.dispatchEvent('pointerup', { ...init, buttons: 0 });
    };
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    page.on('console', message => { if (message.type() === 'error' && !/Failed to load resource|Blocked call to navigator\.vibrate/.test(message.text())) errors.push(message.text()); });
    await page.route('**/wizard-os-home/{data.js,summaries.js}', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: '// fixture placeholder\n' }));
    await page.addInitScript(() => {
      try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); } catch (_) {}
    });
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(id => window.__wos?.live?.ok && window.__wos.live.session(id)?.followUp?.active, thread, { timeout: 30000 });
    await page.evaluate(() => window.__wos.goDesk(1, true));
    const watchedRow = page.locator(`.ch-list [data-chopen="${thread}"]`).first();
    await watchedRow.evaluate(el => {
      let scroller = el.parentElement; while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
      if (scroller) { const row = el.getBoundingClientRect(), box = scroller.getBoundingClientRect(); scroller.scrollTop += (row.top + row.height / 2) - (box.top + box.height / 2); }
    });
    await sleep(100);
    await longPress(watchedRow);
    await page.waitForFunction(() => document.querySelector('.ch-sheet [data-rsact="stop_watch"]'));
    const sheet = await page.evaluate(() => [...document.querySelectorAll('.ch-sheet [data-rsact]')].map(button => ({ action: button.dataset.rsact, text: button.textContent.trim() })));
    ok(sheet.map(item => item.action).join() === 'unread,snooze,stop_watch,done', 'mobile row action sheet exposes watcher actions in order', sheet);
    ok(sheet.find(item => item.action === 'stop_watch')?.text === 'Stop watching' && sheet.find(item => item.action === 'done')?.text === 'Done for now', 'mobile row action sheet uses explicit watcher labels', sheet);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.ch-sheet'));
    await page.evaluate(id => window.__wos.openWizardThread(id), thread);
    await page.waitForFunction(() => document.querySelector('.ch-tacts [data-chact="stop_watch"]'));

    let actions = await page.evaluate(() => [...document.querySelectorAll('.ch-tacts [data-chact]')].map(button => ({ action: button.dataset.chact, text: button.textContent.trim() })));
    ok(actions.map(item => item.action).join() === 'snooze,stop_watch,done', 'active watcher exposes Snooze, Stop watching, Done in order', actions);
    ok(actions.find(item => item.action === 'done')?.text === 'Done for now', 'Done is labelled Done for now');
    ok(actions.find(item => item.action === 'stop_watch')?.text === 'Stop', 'compact thread action keeps explicit Stop watching control');
    await page.screenshot({ path: path.join(OUT, '01-active-watcher-mobile.png'), fullPage: true });

    await page.locator('.ch-tacts [data-chact="done"]').tap();
    await until(() => fixture.fixture.sessions.find(item => item.id === thread)?.archived === true);
    ok(scheduler.followUps(thread, { agent: 'main' }).some(item => item.id === watch.id), 'Done archives without cancelling the watcher');

    await page.evaluate(id => window.__wos.openWizardThread(id), thread);
    await until(() => page.evaluate(id => Boolean(window.__wos.live.session(id)), thread));
    ok(await page.evaluate(id => window.__wos.live.restore(id), thread), 'archived thread restores for the Snooze check');
    ok(await page.evaluate(id => window.__wos.live.defer(id), thread), 'Snooze/defer is saved through the real service');
    ok(scheduler.followUps(thread, { agent: 'main' }).some(item => item.id === watch.id), 'Snooze keeps the watcher active');
    await page.locator('[data-chback]').tap();
    await page.waitForFunction(() => !document.querySelector('.ch-thread'));

    // First poll is pending. Complete the fixture run silently before its normal timer adds an answer.
    scheduler.runNow(watch.id);
    await scheduler.tick(false);
    const firstRun = await until(() => [...fixture.fixture.runs.values()].at(-1));
    firstRun.status = 'completed'; firstRun.output = '[SILENT]';
    await until(async () => { await scheduler.refreshRuns(); return scheduler.project(scheduler.get(watch.id)).lastRun?.outcome === 'silent'; });
    const dispositionAfterSilent = await (await fetch(`${origin}/wizard/thread-dispositions`, { headers })).json();
    ok(scheduler.get(watch.id).enabled === true, 'pending [SILENT] check keeps the watcher enabled');
    ok(Boolean(dispositionAfterSilent.state?.[`direct:${thread}`]?.deferred), 'pending [SILENT] check preserves Snooze');
    const visibleAfterSilent = await (await fetch(`${origin}/wizard/hermes/api/sessions/${thread}/messages?view=wizard`, { headers })).json();
    ok(!(visibleAfterSilent.data || visibleAfterSilent.messages || []).some(row => /one-shot follow-up|\[SILENT\]/.test(String(row.content || ''))), 'scheduled check and silent result stay out of visible history');

    // The next manual occurrence returns a visible result. It must restore this exact thread and disable itself.
    const beforeRuns = fixture.fixture.runs.size;
    scheduler.runNow(watch.id);
    await scheduler.tick(false);
    await until(() => fixture.fixture.runs.size > beforeRuns);
    await until(() => [...fixture.fixture.runs.values()].at(-1)?.status === 'completed', 8000);
    await until(async () => { await scheduler.refreshRuns(); return scheduler.get(watch.id).enabled === false; });
    const dispositionAfterResult = await (await fetch(`${origin}/wizard/thread-dispositions`, { headers })).json();
    ok(!Boolean(dispositionAfterResult.state?.[`direct:${thread}`]?.deferred), 'terminal visible result clears Snooze', dispositionAfterResult.state?.[`direct:${thread}`]);
    ok(fixture.fixture.sessions.find(item => item.id === thread)?.archived === false, 'terminal visible result restores the originating thread');

    await page.evaluate(() => window.__wos.live.refresh());
    await page.waitForFunction(id => {
      const session = window.__wos?.live?.session(id);
      return session && !session.deferred && !session.archived && !session.followUp;
    }, thread, { timeout: 15000 });
    const surfaced = await page.evaluate(id => {
      const session = window.__wos.live.session(id);
      const row = document.querySelector(`.ch-list [data-chopen="${CSS.escape(id)}"]`);
      return { id: session?.id, ids: window.__wos.live.sessions.map(item => item.id), isNew: window.__wos.live.isNew(session), unread: row?.classList.contains('unread'), ready: window.__wos.live.workGroups().ready.some(item => item.id === id) };
    }, thread);
    ok(surfaced.id === thread && surfaced.ids.includes(thread) && !surfaced.ids.some(id => id.startsWith('wizard_schedule_')), 'the same originating thread resurfaces; no replacement thread is created', surfaced);
    ok(surfaced.isNew && surfaced.unread && surfaced.ready, 'terminal watcher result resurfaces unread in Ready', surfaced);
    await page.evaluate(id => window.__wos.openWizardThread(id), thread);
    await page.waitForFunction(() => document.querySelector('.ch-tacts [data-chact="done"]'));
    await page.screenshot({ path: path.join(OUT, '02-same-thread-resurfaced-mobile.png'), fullPage: true });

    // Re-arm once to exercise explicit cancellation through the real owner route.
    const cancelWatch = scheduler.create({ name: 'Explicit cancellation', kind: 'watch', when: { every: 10 }, prompt: 'Wait.', thread, agent: 'main' });
    await page.evaluate(() => window.__wos.live.refresh());
    await page.waitForFunction(id => window.__wos.live.session(id)?.followUp?.active, thread);
    await page.evaluate(id => window.__wos.openWizardThread(id), thread);
    await page.waitForFunction(() => document.querySelector('.ch-tacts [data-chact="stop_watch"]'));
    const zeroStop = route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, stopped: 0 }) });
    await page.route('**/wizard/follow-ups/stop', zeroStop);
    await page.locator('.ch-tacts [data-chact="stop_watch"]').tap();
    await sleep(250);
    ok(scheduler.get(cancelWatch.id).enabled === true && await page.evaluate(id => window.__wos.live.session(id)?.followUp?.active, thread), 'zero-stop response is a failure and keeps the watcher active');
    await page.unroute('**/wizard/follow-ups/stop', zeroStop);
    await page.locator('.ch-tacts [data-chact="stop_watch"]').tap();
    await until(() => scheduler.get(cancelWatch.id).enabled === false);
    ok(scheduler.followUps(thread, { agent: 'main' }).length === 0, 'only explicit Stop watching cancels the active watcher');

    // A routed row owns only its routed watcher, even when main has a watcher for the identical thread id.
    const mainGuard = scheduler.create({ name: 'Main same-ID guard', kind: 'watch', when: { every: 10 }, prompt: 'Main only.', thread: privateThread, agent: 'main' });
    const routedWatch = scheduler.create({ name: 'Private watcher', kind: 'watch', when: { every: 10 }, prompt: 'Private only.', thread: privateThread, agent: privateAgent });
    await page.evaluate(() => window.__wos.live.refresh());
    await page.waitForFunction(({ id, agent }) => window.__wos.live.agentSessions[agent]?.some(item => item.id === id && item.followUp?.active), { id: privateThread, agent: privateAgent }, { timeout: 15000 });
    await page.evaluate(id => window.__wos.openWizardThread(id), privateThread);
    await sleep(250);
    await page.evaluate(id => {
      const el = [...document.querySelectorAll('[data-chats]')].find(node => /Private follow-up/.test(node.innerText));
      if (!el) throw new Error('private Chats window did not open');
      window.__wos.openChat(el.dataset.chats, id);
    }, privateThread);
    const routedControlShown = await until(() => page.evaluate(() => !!document.querySelector('.ch-tacts [data-chact="stop_watch"]')), 8000).catch(() => false);
    const routedDebug = routedControlShown ? null : await page.evaluate(async ({ id, agent }) => {
      const read = async url => { const response = await fetch(url); return { status: response.status, body: await response.text() }; };
      return { agent: window.__wos.live.agentOf(id), session: window.__wos.live.session(id), detail: await read(`/wizard/hermes/api/sessions/${encodeURIComponent(id)}?agent=${encodeURIComponent(agent)}`), messages: await read(`/wizard/hermes/api/sessions/${encodeURIComponent(id)}/messages?agent=${encodeURIComponent(agent)}`), chats: [...document.querySelectorAll('[data-chats]')].map(el => ({ id: el.dataset.chats, text: el.innerText.slice(0, 300) })) };
    }, { id: privateThread, agent: privateAgent });
    ok(routedControlShown, 'routed thread exposes Stop watching', routedDebug);
    const routedActions = await page.evaluate(() => [...document.querySelectorAll('.ch-tacts [data-chact]')].map(button => button.dataset.chact));
    if (routedControlShown) await page.locator('.ch-tacts [data-chact="stop_watch"]').tap();
    else await page.evaluate(({ id, agent }) => window.__wos.live.stopWatching(id, agent), { id: privateThread, agent: privateAgent });
    await until(() => scheduler.get(routedWatch.id).enabled === false);
    ok(scheduler.get(mainGuard.id).enabled === true, 'routed Stop watching cannot cancel a same-ID main watcher');
    scheduler.stopFollowUps(privateThread, { agent: 'main' });
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('[data-chats]')].find(node => /Private follow-up/.test(node.innerText));
      if (el) window.__wos.closeWin(el.dataset.chats);
    });

    // A required owner decision is itself terminal: restore the same thread and expose the real approval card.
    const approvalWatch = scheduler.create({ name: 'Owner decision', kind: 'watch', when: { every: 10 }, prompt: 'Ask only if approval is required.', thread, agent: 'main' });
    ok(await page.evaluate(id => window.__wos.live.archive(id), thread), 'approval fixture starts from a Done thread');
    const runsBeforeApproval = fixture.fixture.runs.size;
    scheduler.runNow(approvalWatch.id); await scheduler.tick(false);
    const approvalRun = await until(() => fixture.fixture.runs.size > runsBeforeApproval && [...fixture.fixture.runs.values()].at(-1));
    Object.assign(approvalRun, { status: 'waiting_for_approval' });
    await until(async () => { await scheduler.refreshRuns(); return scheduler.get(approvalWatch.id).enabled === false; });
    ok(fixture.fixture.sessions.find(item => item.id === thread)?.archived === false, 'owner decision restores the same Done thread');
    await page.evaluate(() => window.__wos.live.refresh());
    await page.waitForFunction(id => {
      const session = window.__wos.live.session(id);
      return session?.status === 'waiting_for_approval' && !session.archived && !session.followUp;
    }, thread, { timeout: 15000 });
    await page.evaluate(id => {
      const el = [...document.querySelectorAll('[data-chats]')].find(node => /Plan the quiet weekend/.test(node.innerText));
      if (el) window.__wos.openChat(el.dataset.chats, id); else window.__wos.openWizardThread(id);
    }, thread);
    const approvalShown = await until(() => page.evaluate(() => !!document.querySelector('.appr [data-approve="allow_once"]')), 15000).catch(() => false);
    const approvalDebug = approvalShown ? null : await page.evaluate(async id => {
      const session = window.__wos.live.session(id); let run = null; try { run = await window.__wos.live.run(session?.runId); } catch (error) { run = { error: String(error) }; }
      return { session, run, html: document.querySelector('.ch-thread')?.innerText?.slice(-1000) };
    }, thread);
    ok(approvalShown, 'owner-decision watcher lands on actionable approval controls', approvalDebug);
    const approval = await page.evaluate(() => ({ title: document.querySelector('.appr b')?.textContent, action: document.querySelector('.appr pre')?.textContent, choices: [...document.querySelectorAll('.appr [data-approve]')].map(item => item.dataset.approve) }));
    ok(approval.title === 'Needs your approval' && /restore snapshot/.test(approval.action) && approval.choices.join() === 'allow_once,deny', 'owner-decision watcher shows the current approval choices', approval);
    await page.screenshot({ path: path.join(OUT, '03-owner-decision-mobile.png'), fullPage: true });
    ok(errors.length === 0, 'browser produced no page errors', errors);
    await ctx.close();
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    app.closeAllConnections?.();
    await new Promise(resolve => app.close(resolve));
    await app.drained;
    await fixture.closeFixture();
    await privateFixture.closeFixture();
    rmSync(root, { recursive: true, force: true });
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  console.log('screenshots', OUT);
  process.exit(fail ? 1 : 0);
})().catch(error => { console.error(error); rmSync(root, { recursive: true, force: true }); process.exit(2); });
