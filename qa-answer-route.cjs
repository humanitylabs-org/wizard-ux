// Synthetic full-shell route proof. Run on forum; no live Wizard/API/model is contacted.
// QA_OUT=<dir> QA_PLAYWRIGHT=<module> [QA_CHROME=<chromium>] [QA_BASE_WEB=<origin/main web>] node qa-answer-route.cjs
const { chromium } = require('./tools/qa-playwright.cjs');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
(async () => {
  const { createAnswerRoutePreview, SID } = await import('./tools/answer-route-preview.mjs');
  const server = createAnswerRoutePreview();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`, out = path.resolve(process.env.QA_OUT || 'qa-out/answer-route');
  fs.mkdirSync(out, { recursive: true });
  const proof = { synthetic: true, checks: [], screenshots: [], writes: [] };
  const ok = name => { proof.checks.push(name); console.log('PASS', name); };
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.QA_CHROME || undefined, args: ['--no-sandbox'] });
    for (const phone of [true, false]) {
      const shell = phone ? 'phone' : 'desktop', viewport = phone ? { width: 412, height: 892 } : { width: 1440, height: 1000 };
      const context = await browser.newContext({ viewport, isMobile: phone, hasTouch: phone, serviceWorkers: 'block' });
      const routes = new Map(), errors = [], gets = []; let mode = '';
      await context.addInitScript(() => { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.tour.done', '1'); localStorage.setItem('wos.rvCoached', 'true'); });
      await context.route('**/wizard/**', async r => {
        const req = r.request(), u = new URL(req.url()), method = req.method();
        const match = u.pathname.match(/^\/wizard\/v1\/threads\/([^/]+)\/route$/);
        if (match) {
          const id = match[1];
          if (method === 'GET') gets.push(id);
          if (mode === '409') return r.fulfill({ status: 409, json: { error: { code: 'thread_route.private_agent', message: 'This is a private agent thread.' } } });
          if (method === 'PUT') {
            const body = req.postDataJSON(); proof.writes.push({ shell, id, method, body });
            if (mode === 'error') return r.fulfill({ status: 503, json: { error: { code: 'signed_out', message: 'Claude is signed out.', fix_url: '/wizard-claude/' } } });
            routes.set(id, body.route);
          }
          return r.fulfill({ json: { session_id: id, route: routes.get(id) || 'hermes', available: true } });
        }
        // Fence every non-route write too. No write ever reaches the origin/backend.
        if (!['GET', 'HEAD'].includes(method)) return r.fulfill({ json: { ok: true } });
        return r.continue();
      });
      const page = await context.newPage(); page.setDefaultTimeout(15000);
      page.on('pageerror', e => errors.push(e.message));
      const href = base + '/wizard-os-home/' + (phone ? '' : 'desktop.html');
      await page.goto(href + '?session=' + SID);
      await page.waitForSelector('[data-chanswer]');
      await page.waitForSelector('[data-answer-kind="opus-direct"]');
      const current = () => page.evaluate(() => Object.values((window.__wos || window.__wux).wins).find(w => w.app === 'chats')?.thread);
      const open = async id => {
        await page.evaluate(id => WizCore.deeplink.route('/wizard-os-home/?session=' + id), id);
        await page.waitForFunction(id => Object.values((window.__wos || window.__wux).wins).some(w => w.thread === id) && document.querySelector('.ch-msgs .msg.a'), id);
      };
      for (const skin of ['nebula', 'grove']) {
        await page.evaluate(skin => WosSkin.set(skin), skin);
        await page.locator('[data-chanswer]').click();
        await page.locator('[data-chanswerpick="opus-direct"]:not([disabled])').click();
        await page.waitForSelector('[data-chanswer].on');
        assert.equal(routes.get(SID), 'opus-direct');
        assert.ok(proof.writes.some(w => w.shell === shell && w.id === SID && w.body.route === 'opus-direct'));
        assert.ok(gets.filter(id => id === SID).length >= 2, 'PUT is followed by GET read-back');
        ok(`${shell}/${skin}: switch sends PUT and read-back; persistent direct indicator`);
        await page.waitForTimeout(800);
        const sheet = `${shell}-${skin}-sheet.png`; await page.screenshot({ path: path.join(out, sheet) }); proof.screenshots.push(sheet);
        // Shared Back must consume the sheet, not the thread or app.
        await page.keyboard.press('Escape');
        await page.waitForSelector('.ch-sheet', { state: 'detached' });
        assert.equal(await current(), SID); ok(`${shell}/${skin}: Back closes sheet and retains thread`);
        assert.ok(await page.locator('[data-answer-kind="opus-direct"]').count());
        assert.ok(await page.locator('[data-answer-kind="hermes"]').count());
        ok(`${shell}/${skin}: mixed history labels both actual answer routes`);
        await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(800);
        const shot = `${shell}-${skin}-direct.png`; await page.screenshot({ path: path.join(out, shot) }); proof.screenshots.push(shot);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.evaluate(skin => WosSkin.set(skin === 'nebula' ? 'grove' : 'nebula'), skin);
        await page.waitForSelector('[data-chanswer].on');
        assert.equal(await current(), SID); ok(`${shell}/${skin}: live skin switch retains route and thread`);
        await page.evaluate(skin => WosSkin.set(skin), skin);
        await page.locator('[data-chanswer]').click();
        await page.locator('[data-chanswerpick="hermes"]:not([disabled])').click();
        await page.waitForSelector('[data-chanswer]:not(.on)');
        assert.equal(routes.get(SID), 'hermes');
        await page.keyboard.press('Escape');
        assert.ok(await page.locator('[data-answer-kind="opus-direct"]').count());
        ok(`${shell}/${skin}: switch back removes indicator, preserves historical direct chip`);
      }
      await open('answer_untouched_sample');
      await page.waitForSelector('[data-chanswer]:not(.on)');
      assert.equal(await page.locator('[data-answer-kind]').count(), 0);
      const newHtml = await page.locator('.ch-msgs .msg.a').first().innerHTML();
      ok(`${shell}: untouched history has no route chips`);
      if (process.env.QA_BASE_WEB) {
        const oldContext = await browser.newContext({ viewport, serviceWorkers: 'block' });
        await oldContext.addInitScript(() => { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.tour.done', '1'); });
        for (const file of ['chats.js', 'chat-kit.js', 'chat-power.js']) await oldContext.route('**/core/' + file, r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(process.env.QA_BASE_WEB, 'core', file)) }));
        const oldPage = await oldContext.newPage(); await oldPage.goto(href + '?session=answer_untouched_sample'); await oldPage.waitForSelector('.ch-msgs .msg.a');
        assert.equal(newHtml, await oldPage.locator('.ch-msgs .msg.a').first().innerHTML());
        ok(`${shell}: untouched assistant markup byte-identical to origin/main`);
        await oldContext.close();
      }
      mode = 'error';
      await page.locator('[data-chanswer]').click();
      await page.locator('[data-chanswerpick="opus-direct"]:not([disabled])').click();
      await page.waitForSelector('.ch-answer-error a[href="/wizard-claude/"]');
      assert.match(await page.locator('.ch-answer-error').first().innerText(), /Claude is signed out/);
      assert.equal(await page.locator('[data-chanswer].on').count(), 0);
      ok(`${shell}: API failure and fix_url visible, no silent fallback/optimistic indicator`);
      await page.keyboard.press('Escape'); mode = '';
      const before = gets.length; await open('answer_private_sample');
      await page.waitForTimeout(400);
      assert.equal(await page.locator('[data-chanswer]').count(), 0); assert.equal(gets.length, before);
      ok(`${shell}: private agent never offers control or requests public route`);
      mode = '409'; await open('answer_untouched_sample');
      await page.waitForFunction(() => !document.querySelector('[data-chanswer]') && document.querySelector('.ch-answer-error'));
      ok(`${shell}: authoritative 409 hides control and exposes explanation`);
      assert.deepEqual(errors, []); ok(`${shell}: no browser exceptions`);
      await context.close();
    }
    const receipt = await (await fetch(base + '/__preview/receipt')).json(); assert.equal(receipt.synthetic, true);
    for (const method of ['POST', 'PUT', 'DELETE']) assert.equal((await fetch(base + '/wizard/v1/threads/' + SID + '/route', { method, body: '{}' })).status, 403);
    ok('review origin refuses every write; only synthetic browser route interception can toggle');
  } finally {
    fs.writeFileSync(path.join(out, 'proof.json'), JSON.stringify(proof, null, 2));
    await browser?.close(); server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve));
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
