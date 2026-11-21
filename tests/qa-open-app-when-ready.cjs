// ux#1651: the Store asks the shell to open an app it just installed, but the box's app list has no page for it yet
// (it is still starting, longer during a WizardOS update). Main refreshed once and silently did nothing; the fix says
// "starting" and opens the app as soon as the list has its page. Synthetic shell, phone and desktop, never a live API.
//   node tests/qa-open-app-when-ready.cjs                                      candidate (toast, then the app opens)
//   QA_WEB=<main worktree>/web QA_EXPECT=broken node tests/qa-open-app-when-ready.cjs   main: nothing happens
// QA_OUT=<dir> saves screenshots.
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead, seedOwner } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const web = path.resolve(process.env.QA_WEB || path.join(__dirname, '..', 'web')), out = process.env.QA_OUT || '';
const broken = process.env.QA_EXPECT === 'broken';
const ORIGIN = 'http://open-when-ready.test';
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const READY_AFTER = 4;   // the app list gains the Tracker's page on the 4th read after the Store asks
async function transport(ctx, st) {
  await ctx.route('**/*', r => {
    const req = r.request(), u = new URL(req.url());
    if (u.origin !== ORIGIN) return r.abort();
    const json = body => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (u.pathname === '/wizardos-tracker/') return r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>WizardOS Tracker</title><body style="font:20px sans-serif;padding:40px">WizardOS Tracker is open</body>' });
    if (req.method() !== 'GET') return json({});
    if (u.pathname === '/wizard/v1/bootstrap') return json({ bootstrap: 1, settings: { agent: { name: 'Wizard QA' } }, capabilities: {}, endpoints: { apps: '/wizard/v1/apps' } });
    if (u.pathname === '/wizard/v1/apps') {
      if (st.asked) st.reads++;
      const apps = [{ id: 'app-store', name: 'App Store', kind: 'wizard', url: '/wizard-os-home/store/index.html' }];
      if (st.asked && st.reads >= READY_AFTER) apps.push({ id: 'wizardos-tracker', name: 'WizardOS Tracker', kind: 'wizard', url: '/wizardos-tracker/', status: 'running' });
      return json({ apps });
    }
    if (/\/v1\/setup$/.test(u.pathname)) return json({ first_run: false });
    if (u.pathname.includes('/store-data/')) return json({ results: [], installed: [], wam: [], shell: [], complete: true });
    const rel = decodeURIComponent(u.pathname.replace(/^\/wizard-os-home\//, '')) || 'index.html', f = path.resolve(web, rel);
    if (f.startsWith(web + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile()) return r.fulfill({ status: 200, contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
    return json(ownerRead(u.pathname));
  });
}
const shot = async (p, name) => { if (out) await p.screenshot({ path: path.join(out, name + '.png') }); };
const trackerOpen = p => p.evaluate(() => [...document.querySelectorAll('iframe')].some(f => f.offsetParent !== null && f.src.includes('/wizardos-tracker/')));
const toastText = p => p.evaluate(() => { const t = document.getElementById('toast'); return t && (t.classList.contains('on') || t.classList.contains('show')) ? t.textContent.trim() : ''; });
(async () => {
  if (out) fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ headless: true }), seen = [];
  try {
    for (const shell of ['phone', 'desktop']) {
      const st = { asked: false, reads: 0 };
      const ctx = await b.newContext(shell === 'phone' ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' } : { viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
      await transport(ctx, st); await ctx.addInitScript(seedOwner, { phone: true });
      await ctx.addInitScript(shell => { if (window !== top) return; localStorage.setItem('wux.shell', shell); localStorage.setItem('wos.shell', shell); localStorage.setItem('wos.skin', 'nebula'); }, shell);
      const p = await ctx.newPage();
      await p.goto(`${ORIGIN}/wizard-os-home/${shell === 'desktop' ? 'desktop.html' : 'index.html?phone'}`);
      await p.waitForFunction(sh => document.documentElement.dataset.shell === sh && window.WosAppKinds && window.WizOpenApp, shell, { timeout: 20000 });
      await p.addStyleTag({ content: '#wosWelcome{display:none!important}' });
      await p.waitForTimeout(800);
      // Open the App Store in a shell window, the way its tile does.
      assert.ok(await p.evaluate(() => window.WizOpenApp('app-store')), 'App Store opens');
      await p.waitForFunction(() => [...document.querySelectorAll('iframe')].some(f => f.src.includes('/store/index.html') && f.contentWindow), null, { timeout: 8000 });
      await p.waitForTimeout(600);
      // The Store's Open, right after the install: the shell's app list has no page for the Tracker yet.
      st.asked = true;
      await p.evaluate(() => { const f = [...document.querySelectorAll('iframe')].find(x => x.src.includes('/store/index.html')); f.contentWindow.eval("parent.postMessage({ type: 'wizard:open-app', id: 'wizardos-tracker' }, location.origin)"); });
      await p.waitForTimeout(1200);
      const early = await toastText(p);
      await shot(p, `${broken ? 'before' : 'after'}-${shell}-tap`);
      await p.waitForTimeout(9000);
      const opened = await trackerOpen(p);
      await shot(p, `${broken ? 'before' : 'after'}-${shell}-later`);
      seen.push({ shell, early, opened, reads: st.reads });
      if (broken) { assert.equal(opened, false, `${shell}: main never opens it`); assert.doesNotMatch(early, /starting/); }
      else {
        assert.match(early, /starting…/, `${shell}: Starting… toast at once`);
        assert.equal(opened, true, `${shell}: the Tracker opens once the list has its page`);
        assert.ok(st.reads >= READY_AFTER && st.reads <= READY_AFTER + 2, `${shell}: stops re-checking once ready (${st.reads})`);
      }
      await ctx.close();
    }
    console.log(JSON.stringify(seen));
    console.log(broken ? 'QA_EXPECT=broken: the tap did nothing, as on main' : 'ok: Starting… then the app opens');
  } finally { await b.close(); }
})().catch(e => { console.error(e); process.exit(1); });
