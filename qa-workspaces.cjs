// Fixture-only browser acceptance. No request is forwarded; writes are refused.
// QA_PLAYWRIGHT=<module> node qa-workspaces.cjs; QA_OUT=<evidence directory>.
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const ROOT = process.env.QA_WEB_DIR || __dirname, ORIGIN = 'http://127.0.0.1:19486';
const OUT = process.env.QA_OUT || path.join(ROOT, 'evidence/wizard-switcher');
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (value, name, detail = '') => { value ? pass++ : fail++; console.log(value ? 'PASS' : 'FAIL', name, detail); };
const items = [
  { id: 'here', name: 'Personal Wizard', kind: 'remote', url: ORIGIN, status: 'ready' },
  { id: 'mac', name: 'Laptop Wizard', kind: 'this-mac', url: 'http://laptop.test', status: 'starting' },
  { id: 'managed', name: 'Shared Wizard', kind: 'managed', org: 'Example team', role: 'technical-admin', url: 'http://shared.test', status: 'ready' },
  { id: 'unavailable', name: 'Future Wizard', kind: 'managed', status: 'unknown' }
];
const at = Math.floor(Date.now() / 1000);
const thread = { id: 'qa-thread', title: 'Synthetic switcher thread', source: 'wizard-mobile', status: 'done', archived: false, hidden: false, message_count: 1, started_at: at - 200, last_active: at - 100, preview: 'Synthetic text only', preview_role: 'user' };
const registry = { this: { wizard: 'Personal Wizard', owner: 'Example owner' }, devices: [], managed: [items[2], items[3]] };
const type = f => ({ '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' }[path.extname(f)] || 'application/octet-stream');
async function boot(browser, { width, skin = 'nebula', native = true, standalone = false }) {
  const phone = width < 600, writes = [], runs = [], errors = [];
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, isMobile: phone, hasTouch: phone, deviceScaleFactor: 1,
    userAgent: phone ? 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/141.0.0.0 Mobile Safari/537.36' : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36', serviceWorkers: 'block' });
  await ctx.route('**/*', async route => {
    const q = route.request(), u = new URL(q.url());
    if (/\/v1\/runs/.test(u.pathname)) runs.push(q.method() + ' ' + u.pathname);
    if (!['GET', 'HEAD'].includes(q.method())) { writes.push(q.method() + ' ' + u.pathname); return route.fulfill({ status: 403, json: { error: 'QA refuses writes' } }); }
    if (u.origin !== ORIGIN) return route.abort();
    if (u.pathname === '/standalone.html') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/wizard-os-home/kit/wizard-tokens.css"><link rel="stylesheet" href="/wizard-os-home/core/workspaces.css"><style>body{background:var(--wz-base);color:var(--wz-text);font:15px var(--wz-font-ui)}button#switcher{margin:16px}</style><h1>Wizard</h1><button id="switcher">Wizards</button><script src="/wizard-os-home/core/workspaces.js"></script>' });
    if (u.pathname.startsWith('/wizard-os-home/') && !u.pathname.startsWith('/wizard-os-home/api/')) {
      const rel = u.pathname.slice('/wizard-os-home/'.length) || 'index.html';
      const file = path.resolve(ROOT, 'web', rel);
      if (!file.startsWith(path.resolve(ROOT, 'web') + path.sep)) return route.abort();
      if (fs.existsSync(file) && fs.statSync(file).isFile()) return route.fulfill({ body: fs.readFileSync(file), contentType: type(file) });
      return route.fulfill({ body: '', contentType: 'application/javascript' });
    }
    if (/\/api\/system\/devices$/.test(u.pathname)) return route.fulfill({ json: registry });
    if (u.pathname === '/wizard/hermes/api/model/options') return route.fulfill({ json: { provider: 'qa-fixture', model: 'qa-model', providers: [{ slug: 'qa-fixture', authenticated: true, models: ['qa-model'] }] } });
    if (u.pathname === '/wizard/v1/setup') return route.fulfill({ json: { first_run: false } });
    if (/\/ui-preferences$/.test(u.pathname)) return route.fulfill({ json: { pinnedChats: [], spaces: [], migrations: { 'launcher.v1': true } } });
    if (u.pathname === '/wizard/v1/bootstrap') return route.fulfill({ json: { bootstrap: 1, settings: { owner: { name: 'Fixture owner' }, agent: { name: 'Fixture Wizard' }, clock: { timezone: 'UTC' }, voice: {} }, endpoints: { apps: '/wizard/v1/apps', sessions: '/wizard/hermes/api/sessions', runs: '/wizard/hermes/v1/runs' }, capabilities: { files: true } } });
    if (/\/api\/sessions$/.test(u.pathname)) return route.fulfill({ json: { data: [thread], has_more: false, total: 1 } });
    if (u.pathname === '/wizard/hermes/api/sessions/qa-thread') return route.fulfill({ json: { session: thread } });
    if (u.pathname === '/wizard/hermes/api/sessions/qa-thread/messages') return route.fulfill({ json: { data: [{ id: 1, role: 'user', content: 'Synthetic text only', timestamp: at - 100 }], pagination: { returned: 1, total: 1 }, has_more: false } });
    if (/\/v1\/apps$/.test(u.pathname)) return route.fulfill({ json: { apps: [] } });
    return route.fulfill({ json: {} });
  });
  await ctx.addInitScript(({ skin, native, items, standalone, phone }) => {
    for (const k of ['wos.coached', 'wos.tour.v1', 'wos.tour.done', 'wos.voiceTipSeen']) localStorage.setItem(k, 'true');
    localStorage.setItem('wos.welcome.v1', 'done');
    // The synthetic bridge uses the WebKit transport on both shells. Real
    // WebKit implies Mac, so explicitly select the phone fixture when intended.
    localStorage.setItem('wux.shell', phone ? 'phone' : 'desktop');
    localStorage.setItem('wos.skin.composition.v1', JSON.stringify({ version: 1, extends: skin })); localStorage.setItem('wos.skin', skin); localStorage.setItem('wos.layout', 'classic');
    localStorage.setItem('wos.workspaces.v1', JSON.stringify([{ id: 'saved', name: 'Saved computer', url: 'http://saved.test', kind: 'remote' }]));
    // Empty saved mix explicitly keeps collaborator Home off in stock screenshots.
    localStorage.setItem('wos.tweaks.mix', '[]');
    window.__workspaceCalls = [];
    if (standalone) return;
    if (native) {
      window.wizardUX = { native: { workspaces: true } };
      window.webkit = { messageHandlers: { wizardNative: { postMessage(msg) {
        window.__workspaceCalls.push(msg);
        const reply = result => window.wizardNativeReply({ id: msg.id, result });
        if (msg.method === 'workspaces.list') return queueMicrotask(() => reply({ active: 'here', items }));
        if (msg.method === 'workspaces.switch') return setTimeout(() => {
          if (window.__failSwitch) window.wizardNativeReply({ id: msg.id, error: 'Synthetic offline' }); else reply({ ok: true });
        }, 5000);
        queueMicrotask(() => reply({ ok: true }));
      } } } };
    }
  }, { skin, native, items, standalone, phone });
  const p = await ctx.newPage(); p.on('pageerror', e => errors.push(String(e)));
  await p.goto(ORIGIN + (standalone ? '/standalone.html' : '/wizard-os-home/'), { waitUntil: 'load' });
  await p.waitForFunction(() => !!window.WizWorkspaces);
  await p.evaluate(() => WizWorkspaces.list());
  if (!standalone) {
    await p.waitForFunction(() => !!window.__wux || !!window.__wos);
    await p.waitForFunction(() => window.WosWelcome?.log.some(s => s.startsWith('boot:') || s === 'deeplink'));
    ok(await p.evaluate(() => !window.WosWelcome.active && !document.querySelector('#wosWelcome')), `${width}-${skin}: configured fixture has no Welcome overlay`);
    if (phone) await p.evaluate(() => window.__wos.goDesk(0, true)); else await p.locator('#logo').click();
    await p.waitForFunction(() => { const b = document.querySelector('.wz-workspaces-control'); return b && !b.hidden; });
    await p.waitForFunction(() => !document.querySelector('.mz-intro'));
    // Settle the actual finite shell entrances; no animation disabling.
    await p.waitForTimeout(1000);
  }
  return { ctx, p, phone, writes, runs, errors, standalone };
}
async function open(b) {
  if (b.standalone) return b.p.evaluate(() => WizWorkspaces.openMenu(document.querySelector('#switcher')));
  const trigger = b.p.locator('.wz-workspaces-control');
  b.phone ? await trigger.tap() : await trigger.click();
  await b.p.locator('.wz-workspaces-panel').waitFor();
}
async function hit(p, selector) {
  return p.locator(selector).first().evaluate(el => { const r = el.getBoundingClientRect(), at = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { hits: el === at || el.contains(at), width: r.width, height: r.height, onScreen: r.x >= 0 && r.y >= 0 && r.right <= innerWidth && r.bottom <= innerHeight }; });
}
async function opaque(b, label) {
  const panel = b.p.locator('.wz-workspaces-panel');
  await b.p.evaluate(() => { const d = document.createElement('div'); d.id = 'qa-loud'; d.style.cssText = 'position:fixed;inset:0;z-index:9999;background:repeating-linear-gradient(45deg,red 0 7px,lime 7px 14px);color:blue;font:900 40px sans-serif;pointer-events:none'; d.textContent = 'LOUD BACKGROUND TEXT '.repeat(300); document.body.append(d); });
  const bounds = await panel.boundingBox();
  // Rounded corner pixels deliberately show the backdrop. Compare only the
  // painted interior, not those transparent pixels outside the panel's shape.
  const clip = { x: bounds.x + 12, y: bounds.y + 12, width: bounds.width - 24, height: bounds.height - 24 };
  const loud = await b.p.screenshot({ clip, path: path.join(OUT, label + '-opaque-loud.png') });
  await b.p.evaluate(() => document.querySelector('#qa-loud').remove());
  const empty = await b.p.screenshot({ clip, path: path.join(OUT, label + '-opaque-empty.png') });
  ok(loud.equals(empty), label + ': opaque panel identical over loud text and empty background');
}
async function checks(b, label) {
  const { p } = b;
  // Real Look controls, not direct WosSkin.set or a test-only class.
  await p.evaluate(() => WizCore.deeplink.route('/wizard-os-home/?view=skin'));
  for (const target of [label.endsWith('nebula') ? 'grove' : 'nebula', label.endsWith('nebula') ? 'nebula' : 'obsidian-light']) {
    const family = target === 'obsidian-light' ? 'mizel' : 'wizard';
    const familyButton = p.locator(`[data-skinfamily="${family}"]:visible`).first();
    if (await familyButton.count()) await familyButton.click();
    await p.locator(`[data-skinpick="${target}"]:visible`).first().click();
    await p.waitForFunction(id => document.documentElement.dataset.skin === id, target);
    await p.waitForFunction(() => !document.querySelector('.mz-intro'));
  }
  await p.evaluate(() => WizCore.deeplink.route('/wizard-os-home/?view=home'));
  await p.waitForTimeout(800);
  const hitIcon = await hit(p, '.wz-workspaces-control'); ok(hitIcon.hits && hitIcon.onScreen && hitIcon.width >= 44 && hitIcon.height >= 44, label + ': icon hit target', JSON.stringify(hitIcon));
  await open(b);
  const rows = await p.locator('.wz-workspaces-item').count();
  for (let i = 0; i < rows; i++) { const h = await hit(p, `.wz-workspaces-item:nth-of-type(${i + 1})`); ok(h.hits && h.onScreen && h.height >= 44, label + ': menu item ' + i + ' hit target', JSON.stringify(h)); }
  await p.screenshot({ path: path.join(OUT, label + '-menu.png') });
  await opaque(b, label);
  // No artificial delay between opening and tapping the backdrop.
  b.phone ? await p.touchscreen.tap(5, 800) : await p.mouse.click(5, 800);
  ok(await p.locator('.wz-workspaces-panel').count() === 0, label + ': outside tap closes');
  await open(b); await p.keyboard.press('Escape');
  ok(await p.locator('.wz-workspaces-panel').count() === 0, label + ': Escape closes menu first');
  await open(b); const url = p.url();
  await p.evaluate(() => dispatchEvent(new CustomEvent('wizard:back')));
  ok(await p.locator('.wz-workspaces-panel').count() === 0 && p.url() === url, label + ': native Back closes menu without exit');
  await open(b); await p.evaluate(() => history.back()); await p.waitForTimeout(200);
  ok(await p.locator('.wz-workspaces-panel').count() === 0 && p.url() === url, label + ': browser Back closes menu without exit');
  // Hold a real split thread beside the desktop list, and the actual Chats
  // header on phone, for the delayed-switch proof (not only plain Home).
  if (b.phone) {
    await p.evaluate(() => __wos.openWizardThread('qa-thread'));
    await p.locator('.ch-thread').first().waitFor({ state: 'visible' });
    await p.evaluate(() => __wos.onBack());
    await p.locator('.wz-workspaces-control.in-chats').waitFor({ state: 'visible' });
    await p.waitForFunction(() => { const el = document.querySelector('.wz-workspaces-control.in-chats'), r = el?.getBoundingClientRect(); return r && r.left >= 0 && r.right <= innerWidth && el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); });
    const h = await hit(p, '.wz-workspaces-control.in-chats'); ok(h.hits && h.onScreen, label + ': phone Chats header control hit-test', JSON.stringify(h));
  } else {
    await p.evaluate(() => __wux.openThread('qa-thread'));
    await p.locator('.pane-main .ch-thread').first().waitFor({ state: 'visible' });
    ok(await p.locator('.pane-list').first().isVisible(), label + ': thread remains beside visible Chats list');
  }
  await open(b); await p.screenshot({ path: path.join(OUT, label + '-chats-menu.png') });
  await p.evaluate(() => {
    const row = document.querySelector('[data-workspace-id="mac"]');
    // Registered after the product's target listener: inspect synchronously
    // in the same dispatch, not a capture microtask (which may run before it).
    let start = 0;
    row.addEventListener('click', () => { start = performance.now(); }, { capture: true, once: true });
    row.addEventListener('click', () => {
      window.__tapProof = { ms: performance.now() - start, active: WizWorkspaces.snapshot().active, pending: WizWorkspaces.snapshot().pending, busy: row.getAttribute('aria-busy'), checked: row.getAttribute('aria-checked'), closed: !document.querySelector('.wz-workspaces-panel') };
    }, { once: true });
  });
  const row = p.locator('[data-workspace-id="mac"]'); b.phone ? await row.tap() : await row.click();
  const proof = await p.evaluate(() => window.__tapProof);
  ok(proof.ms <= 100 && proof.active === 'mac' && proof.pending === 'mac' && proof.busy === 'true' && proof.checked === 'true' && proof.closed, label + ': same-task paint before 5s bridge', JSON.stringify(proof));
  await p.waitForFunction(() => !WizWorkspaces.snapshot().pending, null, { timeout: 7000 });
  await p.evaluate(() => { window.__failSwitch = true; });
  await open(b); const rollback = p.locator('[data-workspace-id="here"]'); b.phone ? await rollback.tap() : await rollback.click();
  await p.waitForFunction(() => !WizWorkspaces.snapshot().pending, null, { timeout: 7000 });
  ok(await p.evaluate(() => WizWorkspaces.snapshot().active === 'mac'), label + ': failed bridge rolls back');
  await p.screenshot({ path: path.join(OUT, label + '-rollback.png') });
  const cdp = await b.ctx.newCDPSession(p); await cdp.send('Performance.enable');
  const sample = async () => { await cdp.send('HeapProfiler.collectGarbage'); return (await cdp.send('Memory.getDOMCounters')); };
  const before = await sample();
  await p.evaluate(() => { for (let i = 0; i < 100; i++) { WizWorkspaces.openMenu(document.querySelector('.wz-workspaces-control')); WizWorkspaces.close(); } });
  const after = await sample();
  ok(after.jsEventListeners - before.jsEventListeners <= 5 && after.nodes - before.nodes <= 10, label + ': 100 menu cycles, no listener/node growth', JSON.stringify({ before, after }));
  ok(b.runs.length === 0, label + ': zero /v1/runs attempts', JSON.stringify(b.runs));
  ok(b.errors.length === 0, label + ': zero page errors', b.errors.join(' | '));
  fs.writeFileSync(path.join(OUT, label + '-report.json'), JSON.stringify({ proof, before, after, writes: b.writes, runs: b.runs, errors: b.errors }, null, 2));
}
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME ? { executablePath: process.env.QA_CHROME } : {}) });
  try {
    for (const width of [1280, 390, 412]) for (const skin of ['nebula', 'obsidian-light']) {
      const label = `${width}-${skin}`, b = await boot(browser, { width, skin });
      try { await checks(b, label); } catch (e) { ok(false, label, String(e.stack)); await b.p.screenshot({ path: path.join(OUT, label + '-failure.png') }); }
      await b.ctx.close();
    }
    const b = await boot(browser, { width: 390, native: false });
    try {
      await open(b); await b.p.getByRole('menuitem', { name: '+ Add a Wizard', exact: true }).tap();
      await b.p.locator('input[name="url"]').fill('javascript:alert(1)'); await b.p.locator('input[name="name"]').fill('Private Wizard');
      await b.p.getByRole('button', { name: 'Add a Wizard', exact: true }).tap();
      ok(await b.p.getByRole('alert').textContent().then(s => /http/.test(s)), 'web add: invalid URL explained inline');
      await b.p.locator('input[name="url"]').fill('http://private-box:8923');
      await b.p.screenshot({ path: path.join(OUT, '390-web-add.png') });
      await b.p.getByRole('button', { name: 'Add a Wizard', exact: true }).tap();
      ok(await b.p.evaluate(() => WizWorkspaces.snapshot().items.some(i => i.name === 'Private Wizard')), 'web add: private-network URL saved');
      await open(b); const target = b.p.locator('[data-workspace-id="managed"]');
      const navigated = b.p.waitForRequest(q => q.url() === 'http://shared.test/wizard-os-home/' && q.isNavigationRequest());
      await target.tap(); await navigated;
      // All foreign-origin requests are aborted, but the navigation intent is real.
      ok(true, 'web fallback: actual same-window target navigation, shell path retained');
      ok(b.runs.length === 0, 'web fallback: zero /v1/runs');
    } catch (e) { ok(false, 'web fallback', String(e.stack)); }
    await b.ctx.close();
    const standalone = await boot(browser, { width: 390, native: false, standalone: true });
    await open(standalone); await standalone.p.screenshot({ path: path.join(OUT, '390-standalone-dark.png') }); await opaque(standalone, '390-standalone-dark');
    ok(await standalone.p.evaluate(() => getComputedStyle(document.documentElement).colorScheme === 'dark'), 'standalone uses shared dark defaults');
    await standalone.ctx.close();
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify({ pass, fail }, null, 2));
  console.log(`\n${pass} passed, ${fail} failed`); process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 2; });
