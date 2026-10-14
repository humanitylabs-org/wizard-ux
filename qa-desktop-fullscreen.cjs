// Remote-safe desktop fullscreen regression: real reads, every API write blocked.
// QA_WEB_DIR optionally overlays an isolated tree; unset it to verify served live assets.
const fs = require('fs'), path = require('path');
let pw; for (const mod of [process.env.PLAYWRIGHT_PATH, 'playwright', 'playwright-core'].filter(Boolean)) { try { pw = require(mod); break; } catch {} }
if (!pw) throw Error('Set PLAYWRIGHT_PATH to the worker Playwright package');
const BASE = process.argv[2] || 'https://wizard.tailc0f369.ts.net/wizard-os-home/';
const OUT = process.env.QA_OUT || path.join(process.cwd(), 'fullscreen-evidence');
fs.mkdirSync(OUT, { recursive: true });
const origin = new URL(BASE).origin;
let pass = 0, fail = 0;
function ok(value, name, detail) { value ? pass++ : fail++; console.log(value ? 'PASS' : 'FAIL', name, detail ? JSON.stringify(detail) : ''); }
(async () => {
  const b = await pw.chromium.launch({ ...(process.env.QA_CHROME ? { executablePath: process.env.QA_CHROME } : {}), args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone'], userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36' });
  const writes = [], errors = [];
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url());
    if (!['GET', 'HEAD'].includes(q.method())) { writes.push({ method: q.method(), path: u.pathname }); return r.fulfill({ status: 403, body: '{}' }); }
    if (u.origin === origin && u.pathname === '/qa-fullscreen-frame/') return r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>QA frame</title><input id="field" value="preserved frame draft">' });
    if (process.env.QA_WEB_DIR && u.origin === origin && u.pathname.startsWith('/wizard-os-home/')) {
      const rel = decodeURIComponent(u.pathname.slice('/wizard-os-home/'.length)) || 'index.html';
      const root = path.resolve(process.env.QA_WEB_DIR, 'web'), file = path.resolve(root, rel);
      if (file.startsWith(root + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        const ext = path.extname(file), types = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json' };
        return r.fulfill({ contentType: types[ext] || 'application/octet-stream', body: fs.readFileSync(file) });
      }
    }
    return r.continue();
  });
  const p = await ctx.newPage(); p.on('pageerror', e => errors.push(String(e)));
  await p.addInitScript(() => {
    localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.shell', 'desktop');
    // Seed once, so the same suite can verify fullscreen surviving reload.
    if (!sessionStorage.getItem('qa-fullscreen-seeded')) {
      sessionStorage.setItem('qa-fullscreen-seeded', '1');
      localStorage.setItem('wux.desk.wins', JSON.stringify({ qa: { id: 'qa', app: 'chats', thread: null } }));
      localStorage.setItem('wux.desk.ws', JSON.stringify(Array.from({ length: 9 }, (_, i) => ({ wins: i ? [] : ['qa'], focus: i ? null : 'qa', mono: false }))));
      localStorage.setItem('wux.desk.cur', '0');
    }
  });
  const wait = () => p.waitForTimeout(350);
  const state = () => p.evaluate(() => {
    const d = __wux.ws[__wux.cur], el = document.querySelector('.wsp:not([hidden]) .win.focus'), r = el?.getBoundingClientRect();
    return { mono: d.mono, cur: __wux.cur, wins: d.wins.length, visible: document.querySelectorAll('.wsp:not([hidden]) .win:not(.gone)').length,
      rect: r && [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], viewport: [innerWidth, innerHeight],
      titleHidden: el && getComputedStyle(el.querySelector('.wbar')).display === 'none', barHidden: getComputedStyle(document.querySelector('#bar')).visibility === 'hidden' };
  });
  const full = s => s.mono && s.titleHidden && s.barHidden && s.rect?.[0] === 0 && s.rect?.[1] === 0 && s.rect?.[2] === s.viewport[0] && s.rect?.[3] === s.viewport[1];
  await p.goto(BASE, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__wux?.live?.ok, null, { timeout: 45000 });
  const url = p.url();
  await p.locator('.win.focus [data-wact="mono"]').click(); await wait();
  let s = await state(); ok(full(s), 'button: single Chats fills viewport and hides chrome', s);
  await p.screenshot({ path: path.join(OUT, 'single-fullscreen.png') });
  await p.keyboard.press('Alt+KeyF'); await wait(); s = await state(); ok(!s.mono && !s.titleHidden && !s.barHidden, 'shortcut: returns single window to normal', s);
  await p.keyboard.press('Alt+Enter'); await wait();
  await p.locator('.win.focus .pane-main textarea').fill('unsent fullscreen draft');
  await p.keyboard.press('Alt+KeyF'); await wait(); s = await state(); ok(full(s), 'shortcut: enters fullscreen from composer', s);
  // Option-F produces ƒ on macOS: dispatch that key with its real physical code too.
  await p.evaluate(() => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ƒ', code: 'KeyF', altKey: true, repeat: true, bubbles: true, cancelable: true })));
  ok((await state()).mono, 'autorepeat: preserves fullscreen');
  await p.keyboard.press('Meta+k'); await wait(); await p.keyboard.press('Escape'); await wait();
  ok((await state()).mono && !(await p.isVisible('#palette')), 'Escape: closes palette before fullscreen');
  await p.keyboard.press('Escape'); await wait();
  ok(!(await state()).mono && await p.evaluate(() => document.querySelector('.win.focus .pane-main textarea')?.value) === 'unsent fullscreen draft', 'Escape: exits fullscreen and preserves composer draft');
  await p.keyboard.press('Alt+KeyF'); await wait();
  await p.reload({ waitUntil: 'load' }); await p.waitForFunction(() => window.__wux?.live?.ok); await wait();
  ok(full(await state()), 'reload: fullscreen persists');
  await p.evaluate(() => history.back()); await wait();
  ok(!(await state()).mono && p.url() === url && (await state()).wins === 1, 'Back: exits fullscreen with Wizard and app open');
  await p.keyboard.press('Alt+KeyF'); await wait(); await p.evaluate(() => __wux.newDesktop()); await wait();
  ok(!(await state()).barHidden && (await state()).wins === 0, 'workspace: empty workspace restores chrome');
  await p.evaluate(() => __wux.goWs(0)); await wait(); ok(full(await state()), 'workspace: returning restores its fullscreen');
  await p.evaluate(() => dispatchEvent(new CustomEvent('wizard:orb', { detail: { action: 'start' } }))); await p.waitForTimeout(700);
  ok(await p.isVisible('#voicePill') && await p.locator('#voiceCancel').isVisible(), 'fullscreen: live voice controls remain visible');
  await p.locator('#voiceCancel').click(); await wait();
  ok(await p.evaluate(() => __wux.voice) === 'idle' && (await state()).mono, 'fullscreen: explicit Cancel stops voice without leaving app');
  await p.keyboard.press('Alt+KeyF'); await wait();
  await p.locator('.win.focus .wbar .t').dblclick(); await wait(); ok(full(await state()), 'title double-click: single app fullscreen');
  await p.setViewportSize({ width: 1280, height: 800 }); await wait(); ok(full(await state()), 'resize: fullscreen tracks viewport');
  await p.evaluate(() => dispatchEvent(new KeyboardEvent('keydown', { key: 'ƒ', code: 'KeyF', altKey: true, bubbles: true, cancelable: true }))); await wait();
  ok(!(await state()).mono, 'Mac Option-F symbol: physical KeyF exits fullscreen');
  await p.setViewportSize({ width: 1440, height: 900 }); await wait();
  await p.evaluate(() => __wux.newWin({ app: 'frame', appId: 'link', url: '/qa-fullscreen-frame/', title: 'QA hosted app' })); await wait();
  const frame = p.frameLocator('.win.focus iframe'); await frame.locator('#field').click();
  await p.keyboard.press('Alt+KeyF'); await wait();
  ok(full(await state()) && (await state()).visible === 1, 'hosted input: shortcut fills viewport and hides neighbour');
  await p.screenshot({ path: path.join(OUT, 'hosted-fullscreen.png') });
  await p.keyboard.press('Alt+KeyF'); await wait();
  ok(!(await state()).mono && (await state()).visible === 2 && await frame.locator('#field').inputValue() === 'preserved frame draft', 'hosted input: shortcut restores two tiles without reloading app');
  await p.locator('.win.focus [data-wact="mono"]').click(); await wait(); ok(full(await state()), 'button: hosted app fullscreen');
  await p.keyboard.press('Meta+KeyW'); await wait();
  ok(!(await state()).mono && (await state()).wins === 1 && !(await state()).barHidden, 'close focused fullscreen app: remaining app restores normal layout');
  await p.keyboard.press('Meta+KeyW'); await wait(); await p.keyboard.press('Alt+KeyF'); await wait();
  ok(!(await state()).mono && (await state()).wins === 0 && !(await state()).barHidden && p.url() === url, 'empty root: fullscreen shortcut leaves Wizard open');
  ok(errors.length === 0, 'no page errors', errors);
  ok(!writes.some(q => /\/v1\/runs|\/api\/sessions$/.test(q.path)), 'zero agent sends', writes);
  await ctx.close(); await b.close(); console.log(JSON.stringify({ pass, fail, base: BASE, tree: process.env.QA_WEB_DIR || 'served-live', worker: require('os').hostname() })); process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error(e); process.exit(1); });
