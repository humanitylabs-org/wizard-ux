'use strict';
// Queue-only browser regression. Reuse the closed synthetic shell; never contact an owner origin.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('./tools/qa-playwright.cjs');
const fx = require('./tools/qa-closed-shell.cjs');
const OUT = process.env.QA_OUT, RED = process.env.QA_EXPECT_RED === '1';
assert(OUT && !process.argv[2], 'QA_OUT required; external origins refused');
const receipt = { synthetic: true, source: process.env.QA_SOURCE_SHA, expectedRed: RED, cases: [], captures: [], outcome: 'not-run' };
let browser, page, active = 'boot';
const now = Date.parse('2026-11-04T12:00:00Z') / 1000;
const row = (id, title, age, extra = {}) => ({ id, title, runtime: 'direct', status: 'completed', source: 'api_server',
  created_at: now - 1000, last_user_at: now - age - 60, last_active: now - age, preview_at: now - age,
  last_assistant_at: now - age, preview: 'Synthetic answer', preview_role: 'assistant', last_role: 'assistant', message_count: 2,
  latest_message: { role: 'assistant', content: 'Synthetic answer', timestamp: now - age }, ...extra });
const rows = [row('badge-browser-first', 'Browser research notes', 120), row('badge-browser-second', 'Browser troubleshooting', 240),
  row('badge-browser-archive', 'Archived browser discussion', 90000, { archived: true }), row('badge-ordinary', 'Unrelated conversation', 360)];
const apps = [{ id: 'browser', name: 'Browser', url: '/synthetic-browser/', source: 'apps.json', type: 'view', category: 'app', desc: 'Synthetic installed Browser' },
  { id: 'app-only', name: 'Apponlycounterexample', url: '/synthetic-app-only/', source: 'apps.json', type: 'view', category: 'app' }];
const json = (r, body, status = 200) => r.fulfill({ status, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });
async function configure(c) {
  await c.addInitScript(() => {
    if (window !== window.top) return;
    let fetches = 0, start = 0;
    const fetch = window.fetch; window.fetch = function (...a) { fetches++; return fetch.apply(this, a); };
    window.__chatSearchInputs = [];
    document.addEventListener('input', e => { if (e.target.matches('.aad-q')) start = fetches; }, true);
    document.addEventListener('input', e => {
      if (!e.target.matches('.aad-q')) return;
      window.__chatSearchInputs.push({ query: e.target.value, ids: [...document.querySelectorAll('.aad-scroll .aad-rw')].map(n => n.dataset.sid),
        apps: [...document.querySelectorAll('.aad-scroll [data-app]')].map(n => n.dataset.app), fetchesInInputTask: fetches - start });
    });
  });
  await c.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url()), p = u.pathname, method = q.method();
    if (u.origin !== 'http://wizard-qa.invalid') return r.fallback(); // closed helper refuses it
    const record = () => fx.report.requests.push({ method, path: p + u.search, fixture: 'chats-search' });
    if (p === '/wizard/v1/apps' && method === 'GET') { record(); return json(r, { apps }); }
    if (p === '/wizard/hermes/api/sessions' && method === 'GET') {
      record();
      if (u.searchParams.get('mode') === 'body') return json(r, { data: [], mode: 'body', partial: false });
      return json(r, { object: 'list', data: rows, has_more: false, limit: 100, offset: 0, snapshot: 'stable-synthetic-search' });
    }
    const m = p.match(/^\/wizard\/hermes\/api\/sessions\/(badge-[a-z-]+)(\/messages)?$/);
    if (m && method === 'GET') {
      record(); const item = rows.find(x => x.id === m[1]); assert(item, 'unknown synthetic session');
      return json(r, m[2] ? { data: [{ role: 'user', content: 'Synthetic question', timestamp: item.last_user_at }, { role: 'assistant', content: item.preview, timestamp: item.last_active }], has_more: false } : { session: item });
    }
    if (p === '/wizard/thread-seen' && method === 'PUT') {
      record(); const body = q.postDataJSON(); assert(body && typeof body.threads === 'object');
      assert(Object.keys(body.threads).every(k => rows.some(x => k === 'direct:' + x.id)), 'only synthetic read receipts');
      return json(r, { state: { initializedAt: 1, threads: body.threads } });
    }
    return r.fallback();
  });
}
const check = async (name, fn) => { active = name; await fn(); receipt.cases.push(name); console.log('PASS', name); };
const ids = () => page.locator('.aad-scroll .aad-rw').evaluateAll(ns => ns.map(n => n.dataset.sid));
const sections = () => page.locator('.aad-scroll .aad-sec').evaluateAll(ns => ns.map(n => [n.dataset.sec, n.getAttribute('aria-expanded')]));
const state = () => page.evaluate(() => Object.values(__wux.wins).map(w => [w.id, w.app, w.appId || '', w.thread || '']));
const matchingIds = rows.filter(r => /browser/i.test(r.title)).map(r => r.id).sort();
async function query(text) {
  await page.locator('.aad-q').fill(text);
  const snap = await page.evaluate(() => __chatSearchInputs.at(-1));
  assert.equal(snap.query, text); assert.equal(snap.fetchesInInputTask, 0, 'typing is local, no fetch in its task');
  if (/^browser$/i.test(text)) assert.deepEqual(snap.ids.slice().sort(), matchingIds, 'all thread matches painted before input event returns');
  return snap;
}
async function screenshot(name, shell, skin) {
  await fx.settle(page); await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(1200, 850);
  const meta = await page.evaluate(() => ({ shell: document.documentElement.dataset.shell, layout: document.documentElement.dataset.layout,
    skin: WosSkin.current, base: getComputedStyle(document.documentElement).getPropertyValue('--wz-base').trim(), text: getComputedStyle(document.documentElement).getPropertyValue('--wz-text').trim(),
    panels: [...document.querySelectorAll('.aad-search, .aad-scroll')].filter(e => e.getBoundingClientRect().width).map(e => ({ class: e.className, background: getComputedStyle(e).backgroundColor, opacity: getComputedStyle(e).opacity })) }));
  assert.equal(meta.shell, shell); assert.equal(meta.skin, skin); assert(meta.base && meta.text);
  const file = path.join(OUT, name + '.png'); await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
  receipt.captures.push({ file, ...meta });
}
async function skin(id, phone = false) {
  if (phone) await page.evaluate(() => __wos.openSheet('settings'));
  else await page.locator('.aad-set').click();
  const appearance = page.locator('[data-st-page="appearance"]:visible'); if (await appearance.count()) await appearance.click();
  await page.locator('[data-skinfamily="wizard"]:visible').click();
  await page.locator(`[data-skinpick="${id}"]:visible`).click();
  await page.waitForFunction(id => WosSkin.current === id && !WosExperience.state.busy, id);
  assert.equal(await page.locator(`[data-skinpick="${id}"]:visible`).getAttribute('aria-pressed'), 'true');
  if (phone) await page.evaluate(() => __wos.closeSheets()); else await page.evaluate(() => __wux.closeSettings());
  await fx.settle(page);
}
async function desktop() {
  const { c } = await fx.boot(false, configure); page = fx.getPage(); page.setDefaultTimeout(12000);
  await page.waitForSelector('.aad-scroll .aad-rw');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.layout), 'ai-apps');
  assert(await page.evaluate(() => WizCore.apps('desktop').APPS.some(a => a.id === 'browser' && a.name === 'Browser')), 'positive installed Browser control');
  const beforeSections = await sections();
  await page.locator('.aad-find').click();
  const first = await query('browser');
  await screenshot(RED ? 'red-browser-nebula' : 'desktop-browser-nebula', 'desktop', 'nebula');
  if (RED) {
    assert.deepEqual(first.apps, ['browser'], 'baseline must fail for the reported installed Browser result, not harness boot');
    assert.equal(fx.report.errors.length, 0); assert.deepEqual(fx.report.unknown, []);
    active = 'contextual Chats contains zero app recommendations';
    assert.equal(first.apps.length, 0, active);
  }
  await check('contextual Chats contains zero app recommendations', async () => {
    assert.deepEqual(first.apps, []); assert.equal(await page.locator('.aad-scroll [data-app]').count(), 0);
    assert.deepEqual(await page.locator('.aad-scroll .aad-lab').allTextContents(), ['Chats']);
    for (const selector of ['.aad-find', '.aad-rfind', '.aad-q']) assert.equal(await page.locator(selector).getAttribute('aria-label'), 'Search chats');
    assert.equal(await page.locator('.aad-q').getAttribute('placeholder'), 'Search chats');
  });
  await check('app-only and no-match queries cannot launch apps, threads, or sends on Enter', async () => {
    const original = await state();
    for (const term of ['Apponlycounterexample', 'no-such-chat']) {
      const s = await query(term); assert.deepEqual(s.ids, []); assert.deepEqual(s.apps, []);
      assert.equal(await page.locator('.aad-empty').textContent(), 'No chats by that name.');
      await page.locator('.aad-q').press('Enter'); assert.deepEqual(await state(), original);
    }
  });
  await check('clear and Cancel restore exact section expansion and unrelated conversations', async () => {
    await query(''); assert.deepEqual(await sections(), beforeSections);
    assert((await ids()).includes('badge-ordinary'));
    await query('browser'); await page.locator('.aad-cancel').click();
    assert.deepEqual(await sections(), beforeSections); assert.equal(await page.locator('.aad-search').isVisible(), false);
  });
  await check('folded rail and Alt+K use the same thread-only search; Back restores list', async () => {
    await page.locator('.aad-tog').click(); assert.equal(await page.evaluate(() => document.documentElement.dataset.aadSide), 'rail');
    await page.locator('.aad-rfind').click(); assert.deepEqual((await query('browser')).apps, []);
    await page.keyboard.press('Escape'); assert.deepEqual(await sections(), beforeSections);
    await page.keyboard.press('Alt+k'); assert.equal(await page.locator('.aad-q').isVisible(), true);
    assert.deepEqual((await query('browser')).apps, []);
  });
  await check('live Signal skin change preserves query and thread-only result identity', async () => {
    await skin('signal');
    assert.equal(await page.locator('.aad-q').inputValue(), 'browser');
    assert.deepEqual((await ids()).sort(), matchingIds); assert.equal(await page.locator('.aad-scroll [data-app]').count(), 0);
    await screenshot('desktop-browser-signal', 'desktop', 'signal');
  });
  await check('click opens exact archived thread, Enter opens exact first matching thread', async () => {
    await page.locator('.aad-rw[data-sid="badge-browser-archive"] .aad-row').click();
    await page.waitForFunction(() => Object.values(__wux.wins).some(w => w.app === 'chats' && w.thread === 'badge-browser-archive'));
    await page.locator('.aad-find').click(); await query('browser'); const first = (await ids())[0];
    await page.locator('.aad-q').press('Enter');
    await page.waitForFunction(id => Object.values(__wux.wins).some(w => w.app === 'chats' && w.thread === id), first);
    assert.equal(await page.locator('iframe[src*="synthetic-browser"]').count(), 0);
  });
  await check('global Ctrl+K command palette still ranks installed Browser app first', async () => {
    await page.keyboard.press('Control+k'); await page.locator('#palInput').fill('browser');
    const first = page.locator('#palList [data-i]').first();
    assert.match(await first.textContent(), /Browser/); assert.match(await page.locator('#palList').textContent(), /Apps/);
    await page.keyboard.press('Escape');
  });
  await check('classic desktop Chats remains threads-only', async () => {
    await page.evaluate(() => WosExperience.chooseDesktopView('classic')); await fx.settle(page);
    await page.evaluate(() => __wux.openChatsList());
    const f = page.locator('[data-chats] [data-chsearch]:visible').first(); await f.fill('browser');
    await page.waitForSelector('[data-chats] .ch-row[data-chopen="badge-browser-first"]:visible');
    const list = f.locator('xpath=ancestor::*[@data-chats][1]');
    assert.equal(await list.locator('[data-app]').count(), 0);
    const matches = await list.locator('.ch-row[data-chopen]').evaluateAll(ns => ns.map(n => n.dataset.chopen));
    assert(matches.includes('badge-browser-first')); assert(!matches.includes('browser'));
  });
  await c.close();
}
async function phone() {
  const { c } = await fx.boot(true, configure); page = fx.getPage();
  await page.evaluate(() => __wos.openApp(WizCore.apps('mobile').APPS.find(a => a.id === 'wizard')));
  await page.waitForSelector('[data-chats] .ch-row[data-chopen="badge-browser-first"]:visible');
  await screenshot('phone-nebula-adjacent', 'phone', 'nebula');
  await skin('signal', true); await screenshot('phone-signal-adjacent', 'phone', 'signal');
  assert.equal(await page.locator('.aad-side').count(), 0, 'desktop search adapter never loads on phone');
  await c.close(); receipt.cases.push('phone adjacent Chats renders unchanged on Nebula and Signal');
}
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  try {
    browser = await chromium.launch({ ...(process.env.QA_CHROME ? { executablePath: process.env.QA_CHROME } : {}), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    fx.setBrowser(browser); await desktop(); if (!RED) await phone();
    assert.equal(fx.report.errors.length, 0, JSON.stringify(fx.report.errors)); assert.deepEqual(fx.report.unknown, []);
    // Only read-state receipts/bootstrap seeds can be accepted by the closed fixture. No owner network exists.
    assert(!fx.report.refusedWrites.some(r => /runs|messages|send|apps\//.test(r.path)), 'no send or app mutation attempted');
    receipt.outcome = 'pass';
  } catch (e) {
    receipt.failure = { stage: active, name: e.name, message: e.message, stack: e.stack };
    receipt.outcome = RED && active === 'contextual Chats contains zero app recommendations' && e.code === 'ERR_ASSERTION' ? 'expected-product-failure' : 'failure';
    if (page && !page.isClosed()) {
      await page.screenshot({ path: path.join(OUT, 'failure.png'), animations: 'disabled' }).catch(() => {});
      receipt.lastState = await page.evaluate(() => ({ shell: document.documentElement.dataset.shell, layout: document.documentElement.dataset.layout, skin: document.documentElement.dataset.skin, welcome: window.WosWelcome?.active,
        query: document.querySelector('.aad-q')?.value, sidebar: document.querySelector('.aad-scroll')?.innerText })).catch(() => null);
    }
    console.error(e.stack);
  } finally {
    await browser?.close(); receipt.fixture = fx.report;
    fs.writeFileSync(path.join(OUT, 'receipt.json'), JSON.stringify(receipt, null, 2));
  }
  console.log(JSON.stringify({ outcome: receipt.outcome, cases: receipt.cases.length, captures: receipt.captures.length }));
  process.exitCode = receipt.outcome === 'pass' ? 0 : 1;
})();
