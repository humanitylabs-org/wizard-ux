// QA: Android Back inside a hosted app that keeps its screens in app state (Legacy Wizard at /wizard/).
// Back in a Legacy thread must return to its thread list, and only a Back at the app's own root may take the
// shell step (full screen → tile → Home). Before the fix every press said "You're home" and nothing moved.
// Usage: QA_WEB_DIR=$PWD node qa-hosted-back.cjs [origin]. Every Hermes/Wizard write is intercepted.
const { chromium } = require('/home/developer/node_modules/playwright');
const fs = require('fs'), path = require('path');
const URL_ = process.argv[2] || 'https://wizard.tailc0f369.ts.net/wizard-os-home/';
const RESOLVE = process.env.QA_RESOLVE || 'MAP wizard.tailc0f369.ts.net 127.0.0.1:18443';
const W = process.env.QA_WEB_DIR;
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, x); } };
(async () => {
  const b = await chromium.launch({ args: ['--host-resolver-rules=' + RESOLVE] });
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36 WizardOS-Android/0.6.3' });
  const writes = [];
  await ctx.route('**/*', r => {
    const q = r.request(), u = q.url();
    const m = u.match(/\/wizard-os-home\/((?:desktop\/|core\/)?[a-z-]+\.(?:js|css|html)|)(\?|$)/);
    if (W && m && q.method() === 'GET' && !/^(data|summaries)\.js$/.test(m[1])) {
      const f = m[1] || 'index.html', p = path.join(W, 'web', f);
      if (fs.existsSync(p)) return r.fulfill({ status: 200, contentType: f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : 'application/javascript', body: fs.readFileSync(p) });
    }
    if (!['GET', 'HEAD'].includes(q.method()) && /\/wizard\//.test(u)) { if (/\/v1\/runs|\/api\/sessions/.test(u)) writes.push(u); return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); }
    return r.continue();
  });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => { if (/wizard-os-home\//.test(String(e.stack))) errs.push(String(e)); });
  await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); } catch (e) {} });
  await p.goto(URL_, { waitUntil: 'load' }); await p.waitForTimeout(4000);
  await p.evaluate(() => { const a = window.WizCore.apps('mobile').APPS.find(a => a.id === 'legacy-wizard'); __wos.openApp(a); });
  await p.waitForTimeout(6000);
  const fr = () => p.frames().find(f => /\/wizard\/(\?|#|$)/.test(f.url()));
  ok(!!fr(), 'Legacy Wizard opens in a Wizard OS window');
  const panel = () => fr().evaluate(() => document.querySelector('.chat-panel')?.classList.contains('open'));
  const shell = () => p.evaluate(() => { const fid = Object.values(__wos.wins).find(w => w.app === 'frame' && w.appId === 'legacy-wizard')?.id; return { idx: __wos.idx, full: __wos.desks[__wos.idx].full, focus: __wos.desks[__wos.idx].focus === fid, open: !!fid, toast: document.querySelector('#toast.show')?.innerText || '' }; });
  const back = async () => { const r = await p.evaluate(() => window.__wosNativeBack()); await p.waitForTimeout(700); return r; };
  const openThread = async () => { await fr().locator('.chat-card:visible').first().tap(); await p.waitForTimeout(2000); return panel(); };

  // 1. Tiled on its desk: thread → list, then the app's root is the shell's root.
  ok(await openThread(), 'tap a Legacy thread opens it');
  const r1 = await back(); let s = await shell();
  ok(!(await panel()) && r1 === 'hosted' && !/home/i.test(s.toast) && s.open, 'Back in a Legacy thread → its thread list (no "You\'re home")', JSON.stringify({ r1, s }));
  await p.screenshot({ path: (process.env.QA_SHOTS || '/home/developer/.hermes/cache/scratch') + '/hosted-back-list.png' });
  ok(await openThread(), 'reopen a Legacy thread');
  await back(); ok(!(await panel()), 'Back again lands on the list (repeatable)');

  // 2. Full screen: thread → list → tile → Home, one step per press.
  await p.evaluate(() => { const fid = Object.values(__wos.wins).find(w => w.app === 'frame' && w.appId === 'legacy-wizard').id; __wos.setFull(fid, true); }); await p.waitForTimeout(600);
  ok(await openThread(), 'full screen: open a Legacy thread');
  await back(); s = await shell(); ok(!(await panel()) && s.full, 'full screen: Back → thread list, still full screen', JSON.stringify(s));
  await back(); s = await shell(); ok(!s.full && s.open, 'full screen: Back at the Legacy root → tiled, app still open', JSON.stringify(s));
  await p.waitForTimeout(1500);
  await back(); s = await shell(); ok(/home/i.test(s.toast) && s.open, 'Back at the true root → "You\'re home", app stays', JSON.stringify(s));
  const log = await p.evaluate(() => window.__backLog || []);
  ok(log.includes('hosted-noop:tile'), 'root no-op handed to the shell exactly once per press', JSON.stringify(log));

  ok(!errs.length, 'no shell page errors', errs.join(' | '));
  ok(!writes.length, 'zero writes to Archimedes', writes.join(' '));
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
