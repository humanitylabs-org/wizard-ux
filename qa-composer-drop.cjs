// Regression: a local screenshot dragged onto the Chats composer uploads like the paperclip.
// Usage: QA_WEB_DIR=<repo> [QA_CHROME=<chrome>] node qa-composer-drop.cjs [origin]. Every write is intercepted.
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const ORIGIN = process.argv[2] || (require('./tools/qa-paths.cjs').origin() + '/wizard-os-home/');
const WEB = process.env.QA_WEB_DIR || __dirname;
let pass = 0, fail = 0;
const writes = [];
const ok = (v, name, detail = {}) => { console.log(v ? 'PASS' : 'FAIL', name, JSON.stringify(detail)); v ? pass++ : fail++; };
(async () => {
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.QA_CHROME });
    const ctx = await browser.newContext({ viewport: { width: 1512, height: 920 }, serviceWorkers: 'block' });
    await ctx.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url()), method = req.method();
      const json = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      if (method === 'POST' && url.pathname === '/wizard/files/upload') {
        writes.push({ method, path: url.pathname, filename: req.headers()['x-wizard-filename'] });
        return json({ file: { id: 'qa-drop-1', filename: req.headers()['x-wizard-filename'] || 'upload', mime: 'image/png', bytes: 68 } });
      }
      if (!['GET', 'HEAD'].includes(method)) { writes.push({ method, path: url.pathname }); return json({ ok: true, state: { initializedAt: Date.now(), threads: {} } }); }
      if (url.pathname.startsWith('/wizard-os-home/')) {
        const rel = decodeURIComponent(url.pathname.slice('/wizard-os-home/'.length)) || 'index.html';
        if (!rel.includes('..')) {
          const file = path.join(WEB, 'web', rel);
          if (fs.existsSync(file) && fs.statSync(file).isFile()) return route.fulfill({
            status: 200,
            contentType: file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'application/javascript' : undefined,
            body: fs.readFileSync(file),
          });
        }
        if (/^(data|summaries)\.js$/.test(rel)) return route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      }
      if (url.pathname === '/wizard/hermes/api/sessions') return json({ object: 'list', data: [], has_more: false, pagination: { limit: 100, offset: 0, returned: 0, has_more: false } });
      if (/\/wizard\/(thread-seen|thread-dispositions)/.test(url.pathname)) return json({ state: { initializedAt: Date.now(), threads: {} } });
      if (url.origin !== new URL(ORIGIN).origin) return route.abort();
      return json({});
    });
    await ctx.addInitScript(() => localStorage.setItem('wos.coached', 'true'));
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(ORIGIN, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__wux?.live, null, { timeout: 45000 });
    await page.waitForSelector('.pane-main [data-panenew]', { timeout: 30000 });
    await page.click('.pane-main [data-panenew]');
    const selector = '.pane-main .ch-compose textarea';
    await page.waitForSelector(selector);
    await page.fill(selector, 'Keep this draft');
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const result = await page.evaluate(({ selector, png }) => {
      const target = document.querySelector(selector), compose = target.closest('.ch-compose'), dt = new DataTransfer();
      dt.items.add(new File([Uint8Array.from(atob(png), c => c.charCodeAt(0))], 'desktop-screenshot.png', { type: 'image/png' }));
      const over = new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true });
      target.dispatchEvent(over);
      const hover = compose.classList.contains('is-file-drag') && getComputedStyle(target).boxShadow !== 'none';
      const drop = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true });
      target.dispatchEvent(drop);
      return { overPrevented: over.defaultPrevented, dropPrevented: drop.defaultPrevented, hover, cleared: !compose.classList.contains('is-file-drag') };
    }, { selector, png });
    await page.waitForTimeout(600);
    const after = await page.evaluate(selector => ({ value: document.querySelector(selector).value, tray: document.querySelectorAll('.pane-main .ch-tray > *').length }), selector);
    ok(result.overPrevented && result.dropPrevented && result.hover && result.cleared, 'file drag is accepted with visible hover feedback', result);
    ok(after.tray === 1 && after.value === 'Keep this draft', 'dropped screenshot reaches the tray without changing the draft', after);
    ok(writes.filter(w => w.path === '/wizard/files/upload').length === 1 && writes.find(w => w.path === '/wizard/files/upload')?.filename === 'desktop-screenshot.png', 'existing upload path receives the dropped screenshot', writes);
    // macOS's fresh Screenshot thumbnail is a file promise: dragover may expose only a URI,
    // then the real File appears at drop. The composer must claim that dragover or Chrome opens the image.
    const promised = await page.evaluate(({ selector, png }) => {
      const target = document.querySelector(selector), compose = target.closest('.ch-compose');
      const overTransfer = new DataTransfer();
      overTransfer.setData('text/uri-list', 'file:///var/folders/qa/T/screencaptureui/promised-screenshot.png');
      const over = new DragEvent('dragover', { dataTransfer: overTransfer, bubbles: true, cancelable: true });
      target.dispatchEvent(over);
      const hover = compose.classList.contains('is-file-drag');
      const dropTransfer = new DataTransfer();
      dropTransfer.items.add(new File([Uint8Array.from(atob(png), c => c.charCodeAt(0))], 'promised-screenshot.png', { type: 'image/png' }));
      const drop = new DragEvent('drop', { dataTransfer: dropTransfer, bubbles: true, cancelable: true });
      target.dispatchEvent(drop);
      return { overPrevented: over.defaultPrevented, dropPrevented: drop.defaultPrevented, hover, cleared: !compose.classList.contains('is-file-drag') };
    }, { selector, png });
    await page.waitForTimeout(600);
    const promisedAfter = await page.evaluate(selector => ({ value: document.querySelector(selector).value, tray: document.querySelectorAll('.pane-main .ch-tray > *').length }), selector);
    ok(promised.overPrevented && promised.dropPrevented && promised.hover && promised.cleared, 'macOS screenshot file promise is accepted before the File is exposed', promised);
    ok(promisedAfter.tray === 2 && promisedAfter.value === 'Keep this draft', 'promised screenshot reaches the tray without changing the draft', promisedAfter);
    ok(writes.filter(w => w.path === '/wizard/files/upload').length === 2 && writes.some(w => w.path === '/wizard/files/upload' && w.filename === 'promised-screenshot.png'), 'existing upload path receives the promised screenshot', writes);
    const text = await page.evaluate(selector => {
      const target = document.querySelector(selector), dt = new DataTransfer(); dt.setData('text/plain', 'dragged words');
      const over = new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true });
      const drop = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true });
      target.dispatchEvent(over); target.dispatchEvent(drop);
      return { overPrevented: over.defaultPrevented, dropPrevented: drop.defaultPrevented };
    }, selector);
    ok(!text.overPrevented && !text.dropPrevented, 'text drags keep browser default behaviour', text);
    ok(errors.length === 0, 'zero page errors', errors);
    ok(!writes.some(w => /\/v1\/(runs|chat|responses)/.test(w.path)), 'no message was sent', writes);
    console.log(`${pass} pass, ${fail} fail`);
  } catch (e) { console.error(e); fail++; console.log(`${pass} pass, ${fail} fail`); }
  finally { if (browser) await browser.close(); }
  process.exitCode = fail ? 1 : 0;
})();
