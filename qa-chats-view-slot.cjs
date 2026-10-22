// Read-only Chats slot QA. Usage: node qa-chats-view-slot.cjs [qa-origin URL]
// QA_SHOTS selects private evidence directory. PW selects Playwright on remote workers.
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const BASE = process.argv[2] || 'http://127.0.0.1:19371/wizard-os-home/';
const OUT = process.env.QA_SHOTS || path.join(require('os').homedir(), '.hermes/cache/scratch/chats-parity/qa-chats-view-slot');
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (v, label, detail = '') => { v ? pass++ : fail++; console.log(v ? 'PASS' : 'FAIL', label, detail); };
const wait = ms => new Promise(r => setTimeout(r, ms));
async function run(browser, phone) {
  const context = await browser.newContext(phone ? { viewport: { width: 412, height: 892 }, hasTouch: true, isMobile: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36' } : { viewport: { width: 1440, height: 900 } });
  const writes = [], errors = [];
  await context.route('**/*', route => {
    if (route.request().method() === 'GET') return route.continue();
    writes.push(route.request().method() + ' ' + new URL(route.request().url()).pathname); return route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"qa refuses writes"}' });
  });
  await context.addInitScript(phone => {
    try {
      localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.tour.done', '1'); localStorage.setItem('wos.voiceTipSeen', 'true');
      if (phone) localStorage.setItem('wos.chatsview.default', 'chats-fixture');
    } catch (_) { /* sandboxed message previews have no storage origin */ }
  }, phone);
  const page = await context.newPage(); page.on('pageerror', e => errors.push(String(e)));
  const url = new URL(BASE); url.searchParams.set('chatsview', 'fixture');
  await page.goto(url.href, { waitUntil:'domcontentloaded' }); await page.waitForFunction(() => window.WizLive?.ok && (window.__wux || window.__wos) && window.WizChatsHost?.installed().length > 1);
  await wait(1000);
  if (!phone) {
    await page.evaluate(() => {
      const app = WizCore.apps('desktop');
      __wux.openApp(app.APP['wizard-chats']);
      __wux.openApp(app.APP['chats-fixture']);
    });
    await page.waitForSelector('[data-chats-fixture]');
    const data = await page.evaluate(() => {
      const wins = Object.values(__wux.wins).filter(w => w.app === 'chats' && !w.agent);
      const standard = wins.find(w => (w.chatsProvider || 'wizard-chats') === 'wizard-chats');
      const fixture = wins.find(w => w.chatsProvider === 'chats-fixture');
      const ids = [...document.querySelectorAll(`[data-chats="${standard.id}::list"] [data-chopen]`)].map(e => e.dataset.chopen);
      const other = [...document.querySelectorAll(`[data-chats="${fixture.id}::list"] [data-fixture-thread]`)].map(e => e.dataset.fixtureThread);
      const sid = ids.find(id => other.includes(id));
      if (sid) { __wux.chats.openChat(standard.id, sid); __wux.chats.openChat(fixture.id, sid); }
      return { standard: standard.id, fixture: fixture.id, sid, ids, other, sameDesk: __wux.ws[__wux.cur].wins.includes(standard.id) && __wux.ws[__wux.cur].wins.includes(fixture.id) };
    });
    ok(data.sameDesk && data.standard !== data.fixture, 'desktop: installed view opens a second tiled window');
    ok(data.ids.length > 0 && data.ids.every(id => data.other.includes(id)), 'desktop: both lists refer to the same real thread ids');
    await wait(2500);
    ok(await page.evaluate(d => __wux.wins[d.standard].thread === d.sid && __wux.wins[d.fixture].thread === d.sid && !!document.querySelector(`[data-chats="${d.standard}"] .ch-compose`) && !!document.querySelector(`[data-chats="${d.fixture}"] .ch-compose`), data), 'desktop: same thread and standard composer in both providers');
    for (const skin of ['nebula', 'obsidian-light']) {
      await page.evaluate(skin => WosSkin.set(skin), skin); await wait(900);
      await page.waitForFunction(() => !document.querySelector('.mz-intro'));
      ok(await page.locator('[data-chats-fixture]').isVisible(), `desktop: ${skin} view stays visible after skin intro`);
      const colour = await page.evaluate(() => getComputedStyle(document.querySelector('.chats-view')).getPropertyValue('--wz-text').trim());
      ok(!!colour, `desktop: ${skin} inherits live Appearance tokens`);
      await page.screenshot({ path: path.join(OUT, `desktop-side-by-side-${skin}.png`) });
    }
    await page.evaluate(id => { __wux.focusWin(id); window.__chatsDocument = document; history.back(); }, data.fixture);
    await wait(900);
    ok(await page.evaluate(id => document === window.__chatsDocument && __wux.wins[id] && !__wux.wins[id].thread, data.fixture), 'desktop: browser Back leaves fixture thread without closing the app');
    await page.evaluate(() => __wux.openApp(WizCore.apps('desktop').APP['chats-throws']));
  } else {
    const id = await page.evaluate(() => { __wos.openApp(WizCore.apps('mobile').APP.wizard); return Object.values(__wos.wins).find(w => w.chatsProvider === 'chats-fixture')?.id; });
    await page.waitForSelector('[data-chats-fixture]');
    ok(!!id, 'phone: Chats entry follows the slot default');
    const dock = await page.evaluate(id => { const desk = __wos.desks.findIndex(d => d.wins.includes(id)); __wos.goDesk(__wos.desks.findIndex(d => d.home), true); return desk; }, id);
    await wait(700); await page.locator(`#dock [data-goto="${dock}"]`).first().tap(); await wait(700);
    ok(await page.locator('[data-chats-fixture]').isVisible(), 'phone: dock reopens selected fixture provider');
    await page.locator('[data-fixture-thread]').first().tap(); await wait(1500);
    ok(await page.evaluate(id => !!__wos.wins[id]?.thread, id), 'phone: fixture opens the real thread');
    await page.evaluate(() => { window.__chatsDocument = document; history.back(); }); await wait(900);
    ok(await page.evaluate(id => document === window.__chatsDocument && __wos.wins[id] && !__wos.wins[id].thread, id), 'phone: browser Back leaves the thread, app and document stay open');
    await page.evaluate(() => __wos.openApp(WizCore.apps('mobile').APP['chats-throws']));
  }
  await wait(700);
  ok((await page.locator('body').innerText()).includes('Broken Chats (fixture) couldn’t open. Showing Chats instead.'), `${phone ? 'phone' : 'desktop'}: throwing provider names itself and falls back`);
  ok(await page.locator('.ch-list').count() > 0, `${phone ? 'phone' : 'desktop'}: fallback has standard Chats list`);
  const refused = await page.evaluate(async () => (await (await fetch('/__qa/refused')).json()).refused);
  ok(refused === 0 && writes.every(w => /^PUT \/wizard\/thread-seen$/.test(w)), `${phone ? 'phone' : 'desktop'}: zero live writes; all read receipts blocked with 403`, writes.join(','));
  ok(errors.length === 0, `${phone ? 'phone' : 'desktop'}: no page errors`, errors.join(' | '));
  await context.close();
}
async function registryOnly(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const errors = [], escaped = [];
  await context.route('**/*', async route => {
    const q = route.request(), url = new URL(q.url());
    if (q.method() !== 'GET') return route.fulfill({ status: 403, body: '{}' });
    if (url.pathname === '/wizard/v1/apps') {
      const response = await route.fetch(), snapshot = await response.json();
      // Candidate install projection only; this is NOT a live App Manager installation.
      snapshot.apps.push({ id: 'chats-fixture', name: 'Installed fixture', source: 'apps.json', url: '/wizard-os-home/core/', provides: ['chats'], chats_view: { contract: 'wizard.chats-view/1', module: 'chats-fixture-view.js' } });
      snapshot.apps.push({ id: 'uninstalled-link', name: 'Not installed', source: 'owner', url: '/uninstalled/', provides: ['chats'], chats_view: { contract: 'wizard.chats-view/1', module: 'view.js' } });
      snapshot.slots = { chats: { default: 'chats-fixture' } };
      return route.fulfill({ response, json: snapshot });
    }
    if (url.pathname.startsWith('/uninstalled/')) escaped.push(url.pathname);
    return route.continue();
  });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(String(e)));
  const url = new URL(BASE); url.searchParams.delete('chatsview');
  await page.goto(url.href, { waitUntil:'domcontentloaded' }); await page.waitForFunction(() => window.__wux && WizChatsHost.defaultId() === 'chats-fixture');
  await page.evaluate(() => __wux.openApp(WizCore.apps('desktop').APP.wizard));
  await page.waitForSelector('[data-chats-fixture]');
  ok(await page.evaluate(() => !WizChatsHost.installed().some(a => a.id === 'chats-throws' || a.id === 'uninstalled-link')), 'registry: installed descriptor works without dev opt-in; owner links and dev providers are absent');
  ok(escaped.length === 0 && errors.length === 0, 'registry: no rejected module loads or page errors', errors.join(' | '));
  await context.close();
}
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
  try { await run(browser, false); await run(browser, true); await registryOnly(browser); } catch (e) { ok(false, 'QA crashed', e.stack); }
  await browser.close(); console.log(`\n${pass} pass, ${fail} fail · shots ${OUT}`); process.exitCode = fail ? 1 : 0;
})();
