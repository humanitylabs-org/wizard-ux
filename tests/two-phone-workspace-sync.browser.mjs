// Two phones share open apps: real index.html + real createWorkspaceStore, isolated origin only.
// node tests/two-phone-workspace-sync.browser.mjs
// Env: WORKSPACE_STORE_MODULE, optional QA_WEB_DIR, QA_SYNC_SOURCE, CHROMIUM_PATH, QA_REPORT, QA_ALLOW_FAILURES.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { workspaceOrigin } from '../tools/qa-workspaces-origin.mjs';
import playwright from '../tools/qa-playwright.cjs';
const { chromium } = playwright;
const web = path.resolve(process.env.QA_WEB_DIR || new URL('../web/', import.meta.url).pathname);
const origin = await workspaceOrigin({ web, module: process.env.WORKSPACE_STORE_MODULE, syncSource: process.env.QA_SYNC_SOURCE });
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox', '--disable-background-timer-throttling'] });
const contexts = [], results = [], errors = [];
const ua = model => `Mozilla/5.0 (Linux; Android 16; ${model} Build/BP2A.250605.031.A2; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.7339.208 Mobile Safari/537.36 WizardOS-Android/0.10.18 WizardOS-DocScroll`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, timeout = 30000) {
  const start = Date.now(); while (Date.now() - start < timeout) { if (await fn()) return Date.now() - start; await sleep(50); }
  throw Error(`condition not met within ${timeout}ms`);
}
async function scenario(name, fn) { const start = Date.now(); try { const detail = await fn(); results.push({ scenario: name, pass: true, ms: Date.now() - start, detail }); } catch (e) { results.push({ scenario: name, pass: false, ms: Date.now() - start, error: e.message }); } console.log(JSON.stringify(results.at(-1))); }
const checkpoint = page => page.evaluate(() => JSON.parse(localStorage.getItem('wos.wsync.v2.phone') || 'null'));
const local = page => page.evaluate(() => { const W = JSON.parse(localStorage.getItem('wos.wins4') || '{}'); return (JSON.parse(localStorage.getItem('wos.strip') || '[]')).filter(d => !d.home).map(d => ({ id: d.id, wins: d.wins.map(id => W[id]).filter(Boolean) })); });
const has = async (page, app) => (await local(page)).some(d => d.wins.some(w => w.appId === app));
async function phone(model, seed = {}) {
  const context = await browser.newContext({ userAgent: ua(model), viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' }); contexts.push(context);
  await context.addInitScript(values => { if (localStorage.getItem('qa.seeded')) return; localStorage.setItem('qa.seeded', '1'); for (const [k, v] of Object.entries({ 'wos.coached': true, 'wos.stripSeeded': true, ...values })) localStorage.setItem(k, JSON.stringify(v)); }, seed);
  const page = await context.newPage(); page.on('pageerror', e => errors.push({ model, message: e.message }));
  await page.goto(origin.url, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.WosWorkspaceSync?.current && !!window.WizOpenApp, null, { timeout: 10000 });
  await until(async () => (await checkpoint(page))?.base);
  return page;
}
async function open(page, id) { assert.equal(await page.evaluate(id => window.WizOpenApp(id), id), true); await until(() => has(page, id)); }
function seeded(desks, cp) {
  return { 'wos.wins4': Object.fromEntries(desks.flatMap(d => d.wins).map(w => [w.id, w])), 'wos.strip': [{ id: 'home', home: true, wins: [] }, ...desks.map(d => ({ id: d.id, wins: d.wins.map(w => w.id), focus: d.wins.at(-1).id }))], ...(cp ? { 'wos.wsync.v2.phone': cp } : {}) };
}
try {
  const a = await phone('Pixel 10 Pro XL'), b = await phone('SM-S938B');
  await scenario('two phones share open apps (foreground)', async () => {
    await open(a, 'notes'); const latency = await until(() => has(b, 'notes'));
    assert.ok(await b.locator('.win iframe[title="Notes"]').count(), 'Notes must be rendered, not just cached');
    return { latency, names: await Promise.all([a, b].map(p => p.evaluate(() => WosWorkspaceSync.current.name))) };
  });
  await scenario('background freeze then resume catches up promptly', async () => {
    // Let the existing foreground long-poll return while hidden, entering the mobile idle wait.
    await b.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
    await open(a, 'calendar'); await until(() => has(b, 'calendar'));
    const cdp = await b.context().newCDPSession(b);
    await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
    await open(a, 'files'); await until(() => origin.snapshot().state.desks.some(d => d.wins.some(w => w.appId === 'files')));
    await cdp.send('Page.setWebLifecycleState', { state: 'active' });
    await b.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); document.dispatchEvent(new Event('resume')); });
    const latency = await until(() => has(b, 'files'), 3000); return { latency };
  });
  // If the old loop slept through resume, let it settle before independent close/join cases.
  await until(() => has(b, 'files'));
  await scenario('close a desk on B closes it on A', async () => {
    const notes = (await local(b)).find(d => d.wins.some(w => w.appId === 'notes'));
    assert.ok(notes); await b.locator(`[data-win="${notes.wins[0].id}"] [data-wact="close"]`).dispatchEvent('click');
    await until(async () => !(await has(a, 'notes'))); assert.equal(await has(b, 'notes'), false);
    return { closed: origin.snapshot().closed.map(c => c.desk.id) };
  });
  await scenario('first join adopts box desks plus unique local desks', async () => {
    const c = await phone('Pixel 10 Pro XL', seeded([{ id: 'local-chats', wins: [{ id: 'local-chat', app: 'chats' }] }, { id: 'local-wisdom', wins: [{ id: 'local-wisdom-win', app: 'frame', appId: 'wisdom' }] }]));
    await until(() => has(c, 'files')); await until(() => has(a, 'wisdom'));
    const desks = await local(c); assert.equal(desks.filter(d => d.wins.some(w => w.app === 'chats')).length, 1);
    await c.context().close(); return { desks: desks.map(d => d.id) };
  });
  await scenario('stale older checkpoint adopts newer box revision', async () => {
    const old = { desks: [{ id: 'stale', wins: [{ id: 'stale-win', app: 'frame', appId: 'notes', url: '/qa-app/notes/' }] }] };
    const c = await phone('SM-S938B', seeded(old.desks, { rev: 0, base: old, last: old }));
    await until(() => has(c, 'files')); assert.equal(await has(c, 'notes'), false); await c.context().close();
  });
  await a.context().close(); await b.context().close();
  await scenario('server reset with reused checkpoint revision adopts box desks', async () => {
    const box = { ...origin.snapshot(), rev: 0 }, stale = { desks: [{ id: 'stale', wins: [{ id: 'stale-win', app: 'frame', appId: 'notes', url: '/qa-app/notes/' }] }] };
    origin.reset(box); // a real fresh store instance and reset revision, not a mocked fetch response
    const c = await phone('Pixel 10 Pro XL', seeded(stale.desks, { rev: box.rev, base: stale, last: stale }));
    const latency = await until(() => has(c, 'files'), 3000); assert.equal(await has(c, 'notes'), false);
    await c.context().close(); return { latency, reusedRev: box.rev };
  });
  await scenario('server revision lower than checkpoint adopts box desks', async () => {
    const box = origin.snapshot(), stale = { desks: [{ id: 'stale', wins: [{ id: 'stale-win', app: 'frame', appId: 'notes', url: '/qa-app/notes/' }] }] };
    const c = await phone('SM-S938B', seeded(stale.desks, { rev: box.rev + 100, base: stale, last: stale }));
    const latency = await until(() => has(c, 'files'), 3000); await c.context().close(); return { latency };
  });
} finally {
  const report = { web, syncSource: process.env.QA_SYNC_SOURCE || null, results, errors, requests: origin.requests, stubbed: [...origin.stubs], snapshot: origin.snapshot() };
  if (process.env.QA_REPORT) fs.writeFileSync(process.env.QA_REPORT, JSON.stringify(report, null, 2));
  console.log(`two phones share open apps: ${results.filter(r => r.pass).length}/${results.length} scenarios passed; ${errors.length} page errors`);
  if (errors.length) console.log(JSON.stringify(errors));
  await browser.close(); await origin.close();
}
if ((results.some(r => !r.pass) || errors.length) && !process.env.QA_ALLOW_FAILURES) process.exitCode = 1;
