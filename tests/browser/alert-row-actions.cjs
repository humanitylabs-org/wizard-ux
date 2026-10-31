// Run only on the forum browser worker, against the isolated QA_SAMPLE_ALERTS preview.
// QA_PLAYWRIGHT=<Playwright module> ALERT_PREVIEW_URL=http://127.0.0.1:<tunnel>/wizard-os-home/?open=chats&shell=phone
// ALERT_PREVIEW_HOST=<canonical host:preview port> ALERT_BASELINE_JS=<origin/main chats.js> node tests/browser/alert-row-actions.cjs
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const target = process.env.ALERT_PREVIEW_URL;
if (!target) throw Error('ALERT_PREVIEW_URL must point at the isolated sample-alert preview');
const { chromium } = require('../../tools/qa-playwright.cjs');
const out = path.resolve(process.env.ALERT_QA_OUT || 'artifacts/alert-row-actions'); fs.mkdirSync(out, { recursive: true });
const report = { target, host: process.env.ALERT_PREVIEW_HOST || '', checks: [], screenshots: [] };
const check = (name, ok, detail) => { report.checks.push({ name, ok: !!ok, detail }); assert.ok(ok, name + ': ' + JSON.stringify(detail)); };
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const context = await browser.newContext({ viewport: { width: 400, height: 860 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    const page = await context.newPage(), errors = [], marks = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (r.method() === 'POST' && new URL(r.url()).pathname === '/notifications/api/mark') marks.push(r.postDataJSON()); });
    const fence = await context.request.get(new URL('/__qa/alerts', target).href); const fixture = await fence.json();
    check('synthetic-only fixture, no live marks', fixture.sample && fixture.liveWrites === false && fixture.items.every(i => i.id.startsWith('preview-alert-')), fixture);
    const load = async () => {
      await page.goto(target, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => !!window.__wos && !!window.WosSkin && !!window.WosBell && window.WosSkinHost?.inboxList);
      await page.waitForSelector('.ch-list .ch-notif-row[data-chnotif="preview-alert-archive"]', { state: 'visible' });
    };
    await load();
    const cdp = await context.newCDPSession(page);
    const hold = async (id = 'preview-alert-archive', ms = 650) => {
      const row = page.locator(`.ch-list .ch-notif-row[data-chnotif="${id}"]`); await row.scrollIntoViewIfNeeded(); const r = await row.boundingBox();
      assert.ok(r && r.height > 0); const p = { x: r.x + Math.min(80, r.width / 2), y: r.y + r.height / 2, id: 1 };
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] });
      await page.waitForTimeout(ms);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForSelector('.ch-sheet[aria-label="Alert actions"]');
      check('hold opens only one shared sheet', await page.locator('.ch-sheet').count() === 1 && !await page.locator('.ch-notif-thread').count());
    };
    const panel = '.ch-sheet[aria-label="Alert actions"] .ch-sheet-b';
    for (const skin of ['obsidian', 'obsidian-light']) {
      await page.evaluate(id => window.WosSkin.set(id), skin);
      await page.waitForFunction(id => document.documentElement.dataset.skin === id, skin);
      await hold('preview-alert-archive', skin === 'obsidian' ? 1700 : 650);
      const data = await page.locator(panel).evaluate(el => ({ bg: getComputedStyle(el).backgroundColor, text: getComputedStyle(el).color,
        buttons: [...el.querySelectorAll('button')].map(b => b.textContent.trim()), rect: { x: el.getBoundingClientRect().x, y: el.getBoundingClientRect().y, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height } }));
      check(skin + ': Done and Archive, no thread-only actions', data.buttons.includes('Done') && data.buttons.includes('Archive') && !data.buttons.some(x => /Rename|Pin|Space|Flag/.test(x)), data);
      check(skin + ': floating panel opaque', /^rgb\(/.test(data.bg) || /,\s*1\)$/.test(data.bg), data.bg);
      const filename = path.join(out, `alert-actions-${skin}.png`); await page.screenshot({ path: filename }); report.screenshots.push(filename);
      // A real new touch on the shared backdrop closes it; the originating lift did not.
      const r = await page.locator('.ch-sheet').boundingBox(); await page.touchscreen.tap(r.x + 8, r.y + 8);
      await page.waitForSelector('.ch-sheet', { state: 'detached' }); check(skin + ': outside touch closes the sheet', true);
    }
    await hold(); const beforeArchive = marks.length;
    await page.locator('[data-rsact="archive"]').tap();
    await page.waitForSelector('.ch-list .ch-notif-row[data-chnotif="preview-alert-archive"]', { state: 'detached' });
    check('Archive posts archived:true and read:true through Notifications mark', marks.length === beforeArchive + 1 && marks.at(-1).archived === true && marks.at(-1).read === true && marks.at(-1).ids[0] === 'preview-alert-archive', marks.at(-1));
    const readback = await (await context.request.get(new URL('/notifications/api/items', target).href)).json();
    check('archive state read back from exact preview API', readback.items.find(i => i.id === 'preview-alert-archive')?.archived === true);
    await hold('preview-alert-done'); await page.locator('[data-rsact="done"]').tap();
    await page.waitForSelector('.ch-list .ch-notif-row[data-chnotif="preview-alert-done"]', { state: 'detached' });
    check('Done removes its alert and marks read+archived', marks.at(-1).ids[0] === 'preview-alert-done' && marks.at(-1).read && marks.at(-1).archived);
    await hold('preview-alert-unread'); await page.locator('[data-rsact="unread"]').tap();
    check('Mark unread uses supported read:false', marks.at(-1).read === false && !('flagged' in marks.at(-1)), marks.at(-1));
    await load(); await hold(); await page.evaluate(() => history.back());
    await page.waitForSelector('.ch-sheet', { state: 'detached' }); check('browser Back closes the sheet without exiting', page.url().startsWith(new URL(target).origin), page.url());
    await page.waitForTimeout(750); await page.locator('.ch-notif-row[data-chnotif="preview-alert-archive"]').tap();
    await page.waitForSelector('.ch-notif-thread', { state: 'visible' }); check('ordinary tap opens the alert', true);
    await load(); await page.locator('.ch-notif-row[data-chnotif="preview-alert-archive"]').click({ button: 'right' });
    await page.waitForSelector('.ch-sheet[aria-label="Alert actions"]'); check('mouse right-click opens the shared sheet', true);
    check('no browser page errors', errors.length === 0, errors);
    await context.close();
    if (process.env.ALERT_BASELINE_JS) {
      const before = await browser.newContext({ viewport: { width: 400, height: 860 }, isMobile: true, hasTouch: true });
      await before.route('**/core/chats.js*', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(process.env.ALERT_BASELINE_JS, 'utf8') }));
      const p = await before.newPage(); await p.goto(target); await p.waitForSelector('.ch-notif-row[data-chnotif="preview-alert-archive"]');
      const d = await before.newCDPSession(p), r = await p.locator('.ch-notif-row[data-chnotif="preview-alert-archive"]').boundingBox();
      await d.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.x + 60, y: r.y + r.height / 2, id: 1 }] }); await p.waitForTimeout(650);
      await d.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await p.waitForTimeout(200);
      check('negative control: old main does not open alert actions on hold', await p.locator('.ch-sheet[aria-label="Alert actions"]').count() === 0);
      await before.close();
    }
    // Leave samples restored for James, with no test-specific local storage on his separate origin/device.
    await (await browser.newContext()).request.get(target);
  } finally { await browser.close(); fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); }
  console.log(JSON.stringify(report, null, 2));
})().catch(e => { console.error(e); process.exitCode = 1; });
