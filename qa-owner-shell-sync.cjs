'use strict';
// Delivered HTTPS only. Read-only data; no source/asset replacement, fake messages or live writes.
const { chromium } = require('./tools/qa-playwright.cjs');
const { shellPath, inViewport } = require('./tools/qa-shell-state.cjs');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const BASE = process.env.QA_BASE, OUT = process.env.QA_OUT, SHA = process.env.QA_SHA;
if (!BASE || !OUT || !SHA) throw Error('Set QA_BASE, QA_OUT, QA_SHA');
fs.mkdirSync(OUT, { recursive: true });
const report = { base: BASE, expectedSha: SHA, cases: [], limitations: ['Browser viewports, not a physical handset', 'Read-only upstream; no audio/send/install action is exercised', 'Workspace sync disabled in disposable QA storage; no synthetic server data'] };
const assert = (c, m) => { if (!c) throw Error(m); };
const visible = p => p.evaluate(geometry => {
 const intersects = new Function('return (' + geometry + ')')();
 const shown = el => !!el && intersects(el.getBoundingClientRect(), innerWidth, innerHeight) && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';
 const st = [...document.querySelectorAll('.st-root')].find(shown);
 const thread = [...document.querySelectorAll('[data-part="thread"]')].find(shown);
 return { path: location.pathname, shell: document.documentElement.dataset.shell, skin: document.documentElement.dataset.skin, settings: !!st, settingsPage: st?.dataset.settingsPage || '', thread: !!thread,
  phone: window.__wos ? { desk: __wos.idx, focus: __wos.desks[__wos.idx]?.focus, thread: __wos.wins[__wos.desks[__wos.idx]?.focus]?.thread || null, back: __wos.back } : null,
  desktop: window.__wux ? { desk: __wux.cur, wins: Object.values(__wux.wins).map(w => ({ id: w.id, app: w.app, thread: w.thread || null })) } : null };
}, inViewport.toString());
(async () => {
 const b = await chromium.launch({ headless: true });
 try {
  for (const desktop of [false, true]) for (const skin of ['nebula', 'obsidian']) {
   const label = `${desktop ? 'desktop' : 'phone'}-${skin}`;
   const r = { label, viewport: desktop ? { width: 1440, height: 1000 } : { width: 412, height: 892 }, errors: [], failedRequests: [], checks: [], screenshots: [], blockedWrites: [] };
   report.cases.push(r);
   const ctx = await b.newContext({ viewport: r.viewport, isMobile: !desktop, hasTouch: !desktop, deviceScaleFactor: 1, colorScheme: 'dark', serviceWorkers: 'block' });
   await ctx.addInitScript(s => {
    if (window !== top) return;
    localStorage.setItem('wos.wsync.off', 'true'); // Disposable QA desks; do not import live workspace focus.
    localStorage.setItem('wos.skin', s); localStorage.setItem('wos.tour.v1', 'true'); localStorage.setItem('wos.tour.done', '1');
    localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.rvCoached', 'true'); localStorage.setItem('wos.obsidian.live', 'true');
   }, skin);
   await ctx.route('**/*', route => {
    const q = route.request(), u = new URL(q.url());
    if (!['GET', 'HEAD'].includes(q.method())) { r.blockedWrites.push({ method: q.method(), path: u.pathname }); return route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"Read-only acceptance run"}' }); }
    if (u.origin !== new URL(BASE).origin) { r.failedRequests.push({ externalBlocked: u.origin + u.pathname }); return route.abort(); }
    return route.continue();
   });
   const p = await ctx.newPage(); p.setDefaultTimeout(15000); p.setDefaultNavigationTimeout(45000);
   p.on('pageerror', e => r.errors.push(String(e)));
   p.on('requestfailed', q => r.failedRequests.push({ url: q.url(), error: q.failure()?.errorText }));
   const check = async (name, fn) => { try { await fn(); r.checks.push({ name, pass: true }); console.log('PASS', label, name); } catch (e) { r.checks.push({ name, pass: false, error: String(e) }); console.log('FAIL', label, name, String(e)); } };
   const shot = async name => { const file = path.join(OUT, `${label}-${name}.png`); await p.screenshot({ path: file, fullPage: false }); r.screenshots.push({ file, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') }); };
   try {
    await check('exact delivered preview source', async () => {
     const q = await ctx.request.get(BASE + '/__preview/receipt'), j = await q.json();
     assert(q.ok() && j.readOnly && j.sha === SHA, JSON.stringify(j)); r.receipt = j; r.assets = [];
     for (const rel of ['app.js', 'desktop/desktop.js', 'core/app-services.js', 'core/settings.js', 'core/skins.css']) {
      const response = await ctx.request.get(BASE + '/wizard-os-home/' + rel);
      const actual = crypto.createHash('sha256').update(await response.body()).digest('hex');
      const expected = crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, 'web', rel))).digest('hex');
      r.assets.push({ path: rel, status: response.status(), sha256: actual, expected });
      assert(response.ok() && actual === expected, 'Delivered asset differs: ' + rel);
     }
    });
    await p.goto(BASE + '/wizard-os-home/?myskin=off', { waitUntil: 'load' });
    await p.waitForFunction(d => !!window.WizCore && (d ? !!window.__wux : !!window.__wos), desktop, { timeout: 30000 });
    await p.evaluate(() => WizCore.appsLoaded()); await p.waitForTimeout(1800);
    await check('correct real shell and requested skin', async () => { const s = await visible(p); r.boot = s; assert(s.shell === (desktop ? 'desktop' : 'phone'), JSON.stringify(s)); assert(s.skin === skin, JSON.stringify(s)); });
    await shot('home');
    // A trusted gesture arms the browser guard, without changing settings or sending anything.
    await p.locator('body').click({ position: { x: 25, y: 110 } });
    await check('actual Chats list and nested thread Back', async () => {
     if (desktop) await p.evaluate(() => __wux.openChatsList()); else await p.evaluate(() => __wos.openSheet('inbox'));
     // Live lists arrive asynchronously; a fixed 1200 ms delay can observe the
     // honest loading state and falsely report missing nested coverage.
     await p.waitForFunction(() => [...document.querySelectorAll('[data-chopen]')].some(el => {
      const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.left >= 0 && r.left < innerWidth;
     }), null, { timeout: 30000 });
     let sid = await p.evaluate(() => [...document.querySelectorAll('[data-chopen]')].find(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.left >= 0 && r.left < innerWidth; })?.dataset.chopen || null);
     assert(sid, 'No actual read-only thread row was available; cannot claim nested coverage');
     await shot('chats');
     if (desktop) await p.evaluate(id => __wux.openThread(id), sid); else await p.evaluate(id => __wos.openWizardThread(id), sid);
     await p.waitForTimeout(1400); const before = await visible(p); r.threadBefore = before;
     assert(before.thread, 'Thread was not visibly open: ' + JSON.stringify(before)); await shot('thread');
     await p.evaluate(() => history.back()); await p.waitForTimeout(1000); const after = await visible(p); r.threadAfterHistoryBack = after;
     assert(shellPath(after.path) && !p.isClosed(), 'History Back left Wizard');
     const had = desktop ? before.desktop.wins.filter(w => w.thread).length : !!before.phone.thread;
     const now = desktop ? after.desktop.wins.filter(w => w.thread).length : !!after.phone.thread;
     assert(had && !now, 'History Back did not consume just the thread: ' + JSON.stringify(after));
     if (!desktop) assert(before.phone.desk === after.phone.desk && before.phone.focus === after.phone.focus, 'Back changed phone desk/focus');
    });
    await check('nested Settings page Back keeps Settings open', async () => {
     if (desktop) await p.evaluate(() => __wux.openSettings()); else await p.evaluate(() => __wos.openSettings());
     await p.waitForTimeout(700); const st = p.locator('.st-root:visible').last(); await st.locator('[data-st-page="about"]').click();
     await p.waitForTimeout(500); const before = await visible(p); assert(before.settings && before.settingsPage === 'about', JSON.stringify(before)); await shot('settings-nested');
     await p.evaluate(() => history.back()); await p.waitForTimeout(1000); const after = await visible(p); r.settingsAfterBack = after;
     assert(shellPath(after.path) && after.settings && after.settingsPage === '', 'Nested Back must consume category only: ' + JSON.stringify(after));
     await shot('settings-back');
     await p.evaluate(() => history.back());
     await p.waitForTimeout(800); assert(!(await visible(p)).settings, 'Second Back did not close Settings');
    });
    await check('three repeated root Back presses never leave Wizard', async () => {
     if (desktop) await p.evaluate(() => __wux.goHome()); else await p.evaluate(() => __wos.goDesk(__wos.HOME));
     await p.waitForTimeout(700);
     for (let n = 0; n < 3; n++) { await p.evaluate(() => history.back()); await p.waitForTimeout(500); assert(!p.isClosed() && shellPath(new URL(p.url()).pathname), 'Repeated Back left Wizard'); }
     r.rootAfterBack = await visible(p); assert(!!(r.rootAfterBack.phone || r.rootAfterBack.desktop), 'Shell lost after Back');
    });
    await check('no page errors', async () => assert(r.errors.length === 0, r.errors.join('\n')));
   } catch (e) { r.fatal = String(e); r.checks.push({ name: 'boot/matrix completion', pass: false, error: String(e) }); console.log('FAIL', label, String(e)); await shot('failure').catch(() => {}); }
   finally { await ctx.close(); fs.writeFileSync(path.join(OUT, 'matrix.json'), JSON.stringify(report, null, 2)); }
  }
 } finally { await b.close(); }
 report.counts = { cases: report.cases.length, passed: report.cases.flatMap(c => c.checks).filter(c => c.pass).length, failed: report.cases.flatMap(c => c.checks).filter(c => !c.pass).length, screenshots: report.cases.reduce((n,c) => n+c.screenshots.length, 0) };
 fs.writeFileSync(path.join(OUT, 'matrix.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report.counts)); process.exitCode = report.counts.failed ? 1 : 0;
})().catch(e => { console.error(e); fs.writeFileSync(path.join(OUT, 'fatal.json'), JSON.stringify({ error: String(e), report }, null, 2)); process.exitCode = 2; });
