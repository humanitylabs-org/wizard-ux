// Two-Wizard browser acceptance for the web (non-native) fallback used by the installed Android app and browsers.
// Two synthetic origins both serve this checkout's shell; each has its own registry (/api/system/devices) listing the other.
// Fixture-only: every write is refused, zero /v1/runs asserted.  QA_PLAYWRIGHT=<module> QA_OUT=<dir> node qa-workspaces-pair.cjs
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const ROOT = process.env.QA_WEB_DIR || __dirname, OUT = process.env.QA_OUT || path.join(ROOT, 'evidence/wizard-switcher-pair');
const A = 'http://127.0.0.1:19486', B = 'http://wizard-james.test:8796';
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (v, name, d = '') => { v ? pass++ : fail++; console.log(v ? 'PASS' : 'FAIL', name, d); };
const type = f => ({ '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' }[path.extname(f)] || 'application/octet-stream');
const at = Math.floor(Date.now() / 1000);
const thread = { id: 'qa-thread', title: 'Synthetic switcher thread', source: 'wizard-mobile', status: 'done', archived: false, hidden: false, message_count: 1, started_at: at - 200, last_active: at - 100, preview: 'Synthetic text only', preview_role: 'assistant' };
const registries = {
  [A]: { this: { wizard: 'WizardOS 1' }, devices: [], managed: [{ id: 'wizard-james', name: 'WizardOS 2', kind: 'remote', role: 'owner', url: B + '/wizard-os-home/' }] },
  // B has no reciprocal entry (like a Wizard that only just got the switcher): the way back is carried through the switch.
  [B]: { this: {}, devices: [] }
};
async function boot(browser, { phone, skin = 'nebula', registry = null, local = [] }) {
  const writes = [], runs = [], errors = [];
  const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 }, isMobile: phone, hasTouch: phone,
    userAgent: phone ? 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 Chrome/141.0.0.0 Mobile Safari/537.36' : 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36', serviceWorkers: 'block' });
  await ctx.route('**/*', async route => {
    const q = route.request(), u = new URL(q.url());
    if (/\/v1\/runs/.test(u.pathname)) runs.push(q.method() + ' ' + u.pathname);
    if (!['GET', 'HEAD'].includes(q.method())) { writes.push(q.method() + ' ' + u.pathname); return route.fulfill({ status: 403, json: { error: 'QA refuses writes' } }); }
    if (![A, B].includes(u.origin)) return route.abort();
    if (u.pathname.startsWith('/wizard-os-home/') && !u.pathname.startsWith('/wizard-os-home/api/')) {
      const rel = u.pathname.slice('/wizard-os-home/'.length) || 'index.html', file = path.resolve(ROOT, 'web', rel);
      if (!file.startsWith(path.resolve(ROOT, 'web') + path.sep)) return route.abort();
      if (fs.existsSync(file) && fs.statSync(file).isFile()) return route.fulfill({ body: fs.readFileSync(file), contentType: type(file) });
      return route.fulfill({ body: '', contentType: 'application/javascript' });
    }
    if (/\/api\/system\/devices$/.test(u.pathname)) return route.fulfill({ json: registry || registries[u.origin] });
    if (u.pathname === '/wizard/hermes/api/model/options') return route.fulfill({ json: { provider: 'qa-fixture', model: 'qa-model', providers: [{ slug: 'qa-fixture', authenticated: true, models: ['qa-model'] }] } });
    if (u.pathname === '/wizard/v1/setup') return route.fulfill({ json: { first_run: false } });
    if (/\/ui-preferences$/.test(u.pathname)) return route.fulfill({ json: { pinnedChats: [], spaces: [], migrations: { 'launcher.v1': true } } });
    if (u.pathname === '/wizard/v1/bootstrap') return route.fulfill({ json: { bootstrap: 1, settings: { owner: { name: 'Fixture owner' }, agent: { name: 'Fixture Wizard' }, clock: { timezone: 'UTC' }, voice: {} }, endpoints: { apps: '/wizard/v1/apps' } } });
    if (/\/api\/sessions$/.test(u.pathname)) return route.fulfill({ json: { data: [thread], has_more: false, total: 1 } });
    if (/\/v1\/apps$/.test(u.pathname)) return route.fulfill({ json: { apps: [] } });
    return route.fulfill({ json: {} });
  });
  await ctx.addInitScript(({ skin, phone, local }) => {
    if (!localStorage.getItem('wos.seeded')) {
      localStorage.setItem('wos.seeded', '1');
      for (const k of ['wos.coached', 'wos.tour.v1', 'wos.tour.done', 'wos.voiceTipSeen']) localStorage.setItem(k, 'true');
      localStorage.setItem('wos.welcome.v1', 'done'); localStorage.setItem('wux.shell', phone ? 'phone' : 'desktop');
      localStorage.setItem('wos.skin.composition.v1', JSON.stringify({ version: 1, extends: skin })); localStorage.setItem('wos.skin', skin); localStorage.setItem('wos.layout', 'classic');
      localStorage.setItem('wos.tweaks.mix', '[]');
      if (local.length) localStorage.setItem('wos.workspaces.v1', JSON.stringify(local));
    }
  }, { skin, phone, local });
  const p = await ctx.newPage(); p.on('pageerror', e => errors.push(String(e)));
  return { ctx, p, phone, writes, runs, errors };
}
async function home(b, origin) {
  const { p, phone } = b;
  await p.goto(origin + '/wizard-os-home/', { waitUntil: 'load' });
  await p.waitForFunction(() => !!window.WizWorkspaces);
  await p.waitForFunction(() => window.WosWelcome?.log.some(s => s.startsWith('boot:') || s === 'deeplink'));
  await p.evaluate(() => WizWorkspaces.list());
  if (phone) await p.evaluate(() => window.__wos.goDesk(0, true)); else await p.locator('#logo').click();
  await p.waitForFunction(() => !document.querySelector('.mz-intro'));
  await p.waitForTimeout(900);
}
const control = b => b.p.locator('.wz-workspaces-control');
async function shown(b) { return b.p.evaluate(() => { const c = document.querySelector('.wz-workspaces-control'); if (!c || c.hidden) return false; const r = c.getBoundingClientRect(), cs = getComputedStyle(c); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0 && r.right <= innerWidth && r.bottom <= innerHeight; }); }
async function openMenu(b) { b.phone ? await control(b).tap() : await control(b).click(); await b.p.locator('.wz-workspaces-panel').waitFor(); }
async function pickSkin(p, target) {
  await p.evaluate(() => WizCore.deeplink.route('/wizard-os-home/?view=skin'));
  const fam = target === 'obsidian-light' ? 'mizel' : 'wizard', f = p.locator(`[data-skinfamily="${fam}"]:visible`).first();
  if (await f.count()) await f.click();
  await p.locator(`[data-skinpick="${target}"]:visible`).first().click();
  await p.waitForFunction(id => document.documentElement.dataset.skin === id, target);
  await p.waitForFunction(() => !document.querySelector('.mz-intro'));
  await p.evaluate(() => WizCore.deeplink.route('/wizard-os-home/?view=home')); await p.waitForTimeout(900);
}
async function opaque(b, label) {
  const panel = b.p.locator('.wz-workspaces-panel');
  await b.p.evaluate(() => { const d = document.createElement('div'); d.id = 'qa-loud'; d.style.cssText = 'position:fixed;inset:0;z-index:9999;background:repeating-linear-gradient(45deg,red 0 7px,lime 7px 14px);color:blue;font:900 40px sans-serif;pointer-events:none'; d.textContent = 'LOUD BACKGROUND TEXT '.repeat(300); document.body.appendChild(d); });
  const bb = await panel.boundingBox(), clip = { x: bb.x + 12, y: bb.y + 12, width: bb.width - 24, height: bb.height - 24 };
  const loud = await b.p.screenshot({ clip });
  await b.p.evaluate(() => document.querySelector('#qa-loud').remove());
  const empty = await b.p.screenshot({ clip });
  ok(loud.equals(empty), label + ': menu pixels identical over loud text and empty background');
}
async function run(browser, { phone, skins }) {
  const dev = phone ? 'phone' : 'desktop', b = await boot(browser, { phone });
  const { p } = b;
  await home(b, A);
  for (const [i, skin] of skins.entries()) {
    const label = `${dev}-${skin}`;
    if (i) await pickSkin(p, skin); else ok(await p.evaluate(() => document.documentElement.dataset.skin) === skin, `${label}: skin worn`);
    ok(await p.evaluate(() => document.documentElement.dataset.skin) === skin, `${label}: data-skin is ${skin}`);
    ok(await shown(b), `${label}: switcher visible with two registered Wizards`);
    const hit = await control(b).evaluate(el => { const r = el.getBoundingClientRect(), t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { hits: el === t || el.contains(t), w: r.width, h: r.height, label: el.getAttribute('aria-label') || el.title }; });
    ok(hit.hits && hit.w >= 40 && hit.h >= 40, `${label}: control hit target`, JSON.stringify(hit));
    await p.screenshot({ path: path.join(OUT, `${label}-1-home-control.png`) });
    await openMenu(b);
    const rows = await p.locator('.wz-workspaces-item').evaluateAll(a => a.map(e => ({ id: e.dataset.workspaceId, text: e.textContent.trim().replace(/\s+/g, ' '), checked: e.getAttribute('aria-checked') })));
    ok(rows.length === 2 && rows[0].id === 'this' && rows[1].id === 'wizard-james' && rows[1].text.includes('WizardOS 2') && rows[0].checked === 'true', `${label}: menu lists this Wizard (active) + WizardOS 2`, JSON.stringify(rows));
    await p.screenshot({ path: path.join(OUT, `${label}-2-menu.png`) });
    await opaque(b, label);
    phone ? await p.touchscreen.tap(5, 700) : await p.mouse.click(5, 700);
    ok(await p.locator('.wz-workspaces-panel').count() === 0, `${label}: outside tap closes menu`);
    const url0 = p.url(), hl0 = await p.evaluate(() => history.length);
    await openMenu(b); await p.evaluate(() => dispatchEvent(new CustomEvent('wizard:back')));
    ok(await p.locator('.wz-workspaces-panel').count() === 0 && p.url() === url0, `${label}: shell Back closes menu, stays in the app`);
    await openMenu(b); await p.evaluate(() => history.back()); await p.waitForTimeout(300);
    ok(await p.locator('.wz-workspaces-panel').count() === 0 && p.url() === url0 && await p.evaluate(() => !!window.WizWorkspaces), `${label}: browser Back closes menu, page not exited`);
  }
  // Switch to wizard-james, then back
  await openMenu(b);
  const nav = p.waitForURL(u => u.origin === B, { timeout: 8000 });
  const row = p.locator('[data-workspace-id="wizard-james"]'); phone ? await row.tap() : await row.click(); await nav;
  ok(p.url().startsWith(B + '/wizard-os-home/'), `${dev}: selecting WizardOS 2 navigates to its link`, p.url());
  await p.waitForFunction(() => !!window.WizWorkspaces && window.WosWelcome?.log.some(s => s.startsWith('boot:') || s === 'deeplink'));
  if (phone) await p.evaluate(() => window.__wos.goDesk(0, true)); else await p.locator('#logo').click();
  await p.waitForTimeout(1200);
  ok(await shown(b), `${dev}: the other Wizard's shell shows the switcher`);
  ok(!p.url().includes('wzfrom'), `${dev}: carried hash stripped from the address bar`, p.url());
  await openMenu(b);
  const rowsB = await p.locator('.wz-workspaces-item').evaluateAll(a => a.map(e => ({ id: e.dataset.workspaceId, text: e.textContent.trim().replace(/\s+/g, ' '), checked: e.getAttribute('aria-checked') })));
  ok(rowsB.length === 2 && rowsB[1].id.startsWith('from-') && rowsB[1].text.includes('WizardOS 1') && rowsB[0].checked === 'true', `${dev}: second Wizard lists the first to switch back`, JSON.stringify(rowsB));
  await p.screenshot({ path: path.join(OUT, `${dev}-3-on-wizardos2-menu.png`) });
  const back = p.waitForURL(u => u.origin === A, { timeout: 8000 });
  const row2 = p.locator('[data-workspace-id^="from-"]'); phone ? await row2.tap() : await row2.click(); await back;
  ok(p.url().startsWith(A + '/wizard-os-home/'), `${dev}: selecting the first Wizard returns to it`, p.url());
  ok(b.runs.length === 0, `${dev}: zero /v1/runs`, JSON.stringify(b.runs)); ok(b.errors.length === 0, `${dev}: zero page errors`, b.errors.join(' | '));
  await b.ctx.close();
  // one Wizard => no control
  const one = await boot(browser, { phone, registry: { this: {}, devices: [] } });
  await home(one, A);
  ok(!(await shown(one)), `${dev}: one Wizard shows no switcher`);
  await one.p.screenshot({ path: path.join(OUT, `${dev}-4-one-wizard-no-control.png`) });
  await one.ctx.close();
}
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME ? { executablePath: process.env.QA_CHROME } : {}) });
  try {
    await run(browser, { phone: true, skins: ['nebula', 'grove'] });
    await run(browser, { phone: false, skins: ['nebula', 'grove'] });
  } catch (e) { ok(false, 'run', String(e.stack)); } finally { await browser.close(); }
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify({ pass, fail }, null, 2));
  console.log(`\n${pass} passed, ${fail} failed`); process.exitCode = fail ? 1 : 0;
})();
