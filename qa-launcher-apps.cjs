// QA: the launcher shows the current Wizard apps (not retired prototypes), and each tile opens the right URL.
// Usage: QA_WEB_DIR=$PWD node qa-launcher-apps.cjs [origin]. Every Hermes/Wizard write is intercepted.
const { chromium } = require('/home/developer/node_modules/playwright');
const fs = require('fs'), path = require('path');
const URL_ = process.argv[2] || 'https://wizard.tailc0f369.ts.net/wizard-os-home/';
const RESOLVE = process.env.QA_RESOLVE || 'MAP wizard.tailc0f369.ts.net 127.0.0.1:18443';
const W = process.env.QA_WEB_DIR;
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, x); } };
// Android Apps (10 Oct): ONE Wizard app tile for the phone's Android apps; the apps themselves never become tiles.
const WANT = { 'android-apps': '/android-apps/', 'wizard-signal': '/wizard-signal/', wisdom: '/wisdom/', shopping: '/wizard-shopping/', mizel: '/mizel-live/#/', trackhunt: '/trackhunt/', 'legacy-wizard': '/wizard/' };
const RETIRED = ['/shopping-assistant/', '/reader/', '/signal-feed/', '/recall/', '/capture/', '/idea-queue/', '/storyboard-review/', '/golden-frog-review/'];

(async () => {
  const b = await chromium.launch({ args: ['--host-resolver-rules=' + RESOLVE] });
  for (const shell of ['mobile', 'desktop']) {
    const mobile = shell === 'mobile';
    const ctx = await b.newContext(mobile ? { viewport: { width: 412, height: 892 }, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36' }
      : { viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
    const writes = [];
    await ctx.route('**/*', r => {
      const q = r.request(), u = q.url();
      const m = u.match(/\/wizard-os-home\/((?:desktop\/|core\/)?[a-z-]+\.(?:js|css|html)|)(\?|$)/);
      if (W && m && q.method() === 'GET' && !/^(data|summaries)\.js$/.test(m[1])) {
        const f = m[1] || (mobile ? 'index.html' : ''), p = f && path.join(W, 'web', f);
        if (p && fs.existsSync(p)) return r.fulfill({ status: 200, contentType: f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : 'application/javascript', body: fs.readFileSync(p) });
      }
      if (q.method() !== 'GET' && /\/wizard\/(hermes|thread-seen)/.test(u)) { writes.push(u); return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); }
      return r.continue();
    });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => { if (/wizard-os-home\//.test(String(e.stack))) errs.push(String(e)); });
    await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.removeItem('wos.recent'); } catch (e) {} });
    await p.goto(URL_, { waitUntil: 'load' });
    await p.waitForTimeout(4000);
    const apps = await p.evaluate(() => { const r = window.WizCore.apps(document.documentElement.dataset.shell || 'mobile'); return r.APPS.map(a => ({ id: a.id, url: a.url || '', name: a.name })); });
    const by = Object.fromEntries(apps.map(a => [a.id, a]));
    for (const [id, url] of Object.entries(WANT)) ok(by[id] && by[id].url === url, `${shell}: ${id} → ${url}`, JSON.stringify(by[id]));
    const stale = apps.filter(a => RETIRED.includes(a.url));
    ok(!stale.length, `${shell}: no retired prototypes in the launcher`, JSON.stringify(stale));
    const find = await p.evaluate(() => { const r = window.WizCore.apps(document.documentElement.dataset.shell || 'mobile'); return ['reader', 'shopping', 'jobs', 'signal'].map(q => (r.findApp(q) || {}).id); });
    ok(JSON.stringify(find) === JSON.stringify(['wisdom', 'shopping', 'wisdom', 'wizard-signal']), `${shell}: "open reader/shopping/jobs/signal" resolve to the current apps`, JSON.stringify(find));
    // Every current tile's URL actually loads.
    for (const a of apps.filter(a => a.url && a.url.startsWith('/'))) {
      const st = await p.evaluate(u => fetch(u, { redirect: 'manual', cache: 'no-store' }).then(r => r.type === 'opaqueredirect' ? 302 : r.status).catch(() => 0), new URL(a.url, URL_).href);
      ok([200, 302].includes(st), `${shell}: ${a.name} (${a.url}) loads`, String(st));
    }
    if (mobile) {
      await p.evaluate(() => __wos.openSheet('launcher')); await p.waitForTimeout(600);
      const txt = await p.evaluate(() => document.body.innerText);
      ok(/Wisdom/.test(txt) && /Wizard Shopping/.test(txt), 'mobile: launcher sheet shows Wisdom and Wizard Shopping');
      await p.evaluate(() => { __wos.closeSheets && __wos.closeSheets(); }); await p.waitForTimeout(200);
      await p.evaluate(() => { const t = document.querySelector('#launcherBody [data-app="files"]'); t && t.click(); }); await p.waitForTimeout(900);
      await p.evaluate(() => __wos.openSheet('launcher')); await p.waitForTimeout(600);
      const stray = await p.evaluate(() => { const b = document.querySelector('#launcherBody'); return { bar: !!b.querySelector('.deskbar'), txt: /Full\s*←|\d+ windows?/.test(b.innerText) }; });
      ok(!stray.bar && !stray.txt, 'mobile: no stray window-list text at the bottom of the launcher', JSON.stringify(stray));
      const natives = await p.evaluate(() => [...document.querySelectorAll('#launcherBody [data-app]')].map(e => e.dataset.app).filter(id => ['maps', 'camera', 'phone', 'messages', 'spotify', 'telegram', 'line', 'grab', 'chrome', 'settings'].includes(id)));
      ok(!natives.length && !/\bANDROID\b|Android(?! Apps)/.test(await p.evaluate(() => document.querySelector('#launcherBody').innerText)), 'mobile: no Android apps or Android group in the launcher', JSON.stringify(natives));
      await p.fill('#search', 'maps').catch(() => {}); await p.waitForTimeout(300);
      const hit = await p.evaluate(() => [...document.querySelectorAll('#launcherBody [data-app]')].map(e => e.dataset.app));
      ok(!hit.includes('maps'), 'mobile: searching "maps" in the launcher shows no Android tile', JSON.stringify(hit));
      ok(await p.evaluate(() => (window.WizCore.apps('mobile').findApp('maps') || {}).id === 'maps'), 'mobile: voice "open maps" still resolves to Maps');
      await p.screenshot({ path: (process.env.QA_SHOTS || '/home/developer/.hermes/cache/scratch') + '/launcher-apps-mobile.png' });
    }
    ok(!errs.length, `${shell}: no shell page errors`, errs.join(' | '));
    ok(!writes.length, `${shell}: zero writes to Archimedes`, writes.join(' '));
    await ctx.close();
  }
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
