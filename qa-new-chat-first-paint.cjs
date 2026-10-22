// Regression: an untouched new-chat composer must fit before the first input event.
// Run on a peer against the live origin; QA_WEB overlays an exact candidate for A/B.
// All non-read requests are intercepted. No chat is sent or marked read on the server.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { chromium } = require('./tools/qa-playwright.cjs');
const BASE = process.argv[2];
if (!BASE) throw new Error('Pass the Wizard /wizard-os-home/ URL');
const OUT = process.env.QA_OUT || path.join(process.cwd(), 'qa-first-paint');
const WEB = process.env.QA_WEB;
fs.mkdirSync(OUT, { recursive: true });
const checks = [], errors = [], writes = [], hashes = {};
function check(pass, name, detail) { checks.push({ pass: !!pass, name, detail }); console.log(pass ? 'PASS' : 'FAIL', name, detail ? JSON.stringify(detail) : ''); }
function geometry() {
  const ta = document.querySelector('.win.focus .pane-main textarea') || [...document.querySelectorAll('.ch-compose textarea')].find(e => { const b = e.getBoundingClientRect(); return b.width > 0 && b.x >= 0 && b.right <= innerWidth; });
  if (!ta) return { missing: true };
  const rect = e => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, height: b.height, width: b.width, bottom: b.bottom, right: b.right }; };
  const form = ta.closest('form'), box = ta.closest('.wbody') || ta.closest('.win');
  return { field: rect(ta), form: rect(form), box: rect(box), viewport: { width: innerWidth, height: innerHeight }, value: ta.value, fieldStyle: ta.style.height };
}
function contained(g) { return !g.missing && g.field.height >= 40 && g.field.bottom <= g.viewport.height + 1 && g.form.bottom <= g.box.bottom + 1 && g.field.right <= g.viewport.width + 1 && g.form.y >= g.box.y; }
(async () => {
 const browser = await chromium.launch({ executablePath: process.env.QA_CHROME, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
 try {
  for (const mode of ['desktop', 'native-like', 'phone']) {
   const mobile = mode === 'phone';
   const ctx = await browser.newContext({ viewport: mobile ? {width:412,height:892} : { width: 1512, height: 920 }, hasTouch:mobile, isMobile:mobile, serviceWorkers: 'block', ignoreHTTPSErrors: true });
   await ctx.route('**/*', async route => {
    const q = route.request(), u = new URL(q.url());
    if (!['GET', 'HEAD'].includes(q.method())) { writes.push({ method: q.method(), path: u.pathname }); return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); }
    // Other apps mounted on background phone desks are outside this shell-layout contract.
    if (q.isNavigationRequest() && q.frame().parentFrame()) return route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Unrelated app omitted in layout QA</title>'});
    if (WEB && u.pathname.startsWith('/wizard-os-home/')) {
     const rel = u.pathname.slice('/wizard-os-home/'.length) || 'index.html', f = path.resolve(WEB, rel);
     if (f.startsWith(path.resolve(WEB) + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile()) {
      return route.fulfill({ path: f, contentType: f.endsWith('.js') ? 'application/javascript' : f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : undefined });
     }
    }
    return route.continue();
   });
   await ctx.addInitScript(native => { localStorage.setItem('wos.coached', 'true'); if (native) window.webkit = { messageHandlers: { wizardNative: { postMessage() {} } } }; }, mode === 'native-like');
   const p = await ctx.newPage(); p.on('pageerror', e => errors.push({ mode, error: String(e) }));
   await p.goto(BASE + (mobile ? '?open=chats' : '')); await p.waitForFunction(() => window.__wux?.live?.ok || window.__wos?.live?.ok, null, { timeout: 45000 });
   if (mobile) {
    await p.waitForTimeout(350);
    const fab = p.locator('[data-chfab]:visible').first(); await fab.click();
    await p.waitForTimeout(350);
    check(contained(await p.evaluate(geometry)), 'phone blank composer is usable');
    const ta = p.locator('.ch-compose textarea:visible').first();
    await ta.fill('Phone draft\nSecond line');
    check(contained(await p.evaluate(geometry)), 'phone multiline composer is usable');
    await ta.fill('');
    check((await p.evaluate(geometry)).field.height >= 40, 'phone emptied composer retains its minimum');
    await p.screenshot({path:path.join(OUT,'phone-composer.png')});
    await p.goBack(); await p.waitForTimeout(350);
    check(await p.locator('[data-chfab]:visible').count() > 0 && await p.evaluate(() => !!window.__wos), 'phone Back returns to the list and keeps Wizard open');
    await ctx.close(); continue;
   }
   hashes[mode] = await p.evaluate(async () => Object.fromEntries(await Promise.all(['core/chats.js', 'core/chats.css', 'desktop/desktop.js', 'desktop/desktop.css'].map(async f => { const bytes = await (await fetch(new URL(f, location.href))).arrayBuffer(); const h = await crypto.subtle.digest('SHA-256', bytes); return [f, Array.from(new Uint8Array(h), x => x.toString(16).padStart(2, '0')).join('')]; }))));
   for (const [width, height] of [[1512,920],[1100,780],[720,1100],[600,600]]) {
    await p.setViewportSize({ width, height });
    await p.evaluate(() => { Object.values(__wux.wins).forEach(w => __wux.closeWin(w.id)); __wux.newWin({ app: 'chats', thread: null }); });
    await p.waitForTimeout(100);
    // Use the actual DOM action, and inspect synchronously before an animation frame can hide a bad first layout.
    const g = await p.evaluate(`(() => { document.querySelector('.win.focus [data-panenew]').click(); return (${geometry.toString()})(); })()`);
    check(contained(g) && g.value === '', `${mode} blank composer ${width}x${height}`, g);
    await p.waitForTimeout(150);
    check(contained(await p.evaluate(geometry)), `${mode} settled composer ${width}x${height}`);
    await p.screenshot({ path: path.join(OUT, `${mode}-${width}x${height}.png`) });
    const before = await p.evaluate(geometry);
    await p.locator('.win.focus .pane-main textarea').fill('x');
    const after = await p.evaluate(geometry);
    check(contained(after) && Math.abs(before.field.height - after.field.height) <= 2 && Math.abs(before.form.y - after.form.y) <= 2, `${mode} first keystroke does not repair layout ${width}x${height}`, { before, after });
    await p.locator('.win.focus .pane-main textarea').fill('');
   }
   await p.setViewportSize({width:1100,height:780});
   await p.locator('.win.focus .pane-main textarea').fill('A draft with several lines\nSecond line\nThird line');
   const draft = await p.locator('.win.focus .pane-main textarea').inputValue();
   await p.locator('.win.focus [data-wact="mono"]').click();
   check(contained(await p.evaluate(geometry)), `${mode} fullscreen composer stays inside window`);
   await p.keyboard.press('Escape');
   await p.setViewportSize({width:720,height:650});
   // Window resize deliberately animates for 180ms; first-paint checks above remain synchronous.
   await p.waitForTimeout(250);
   const resized = await p.evaluate(geometry);
   check(contained(resized) && resized.value === draft, `${mode} resize preserves multiline draft`, resized);
   await p.reload(); await p.waitForFunction(() => window.__wux?.live?.ok, null, {timeout:45000});
   await p.waitForTimeout(300);
   check(contained(await p.evaluate(geometry)) && await p.locator('.win.focus .pane-main textarea').inputValue() === draft, `${mode} reload preserves visible draft`);
   await p.locator('.win.focus .pane-main textarea').fill('');
   await p.evaluate(() => __wux.newChat({fresh:true}));
   check(contained(await p.evaluate(geometry)), `${mode} fresh-window New chat is visible`);
   await ctx.close();
  }
 } finally { await browser.close(); }
 check(errors.length === 0, 'no browser page errors', errors);
 check(!writes.some(x => /\/v1\/runs$/.test(x.path)), 'no chat-send requests', writes);
 const result = { host: os.hostname(), base: BASE, web: WEB || 'served assets', sourceHashes: hashes, checks, errors, blockedWrites: writes, passed: checks.filter(c => c.pass).length, failed: checks.filter(c => !c.pass).length };
 fs.writeFileSync(path.join(OUT, 'receipt.json'), JSON.stringify(result, null, 2));
 console.log(JSON.stringify({passed:result.passed, failed:result.failed}));
 if(result.failed) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
