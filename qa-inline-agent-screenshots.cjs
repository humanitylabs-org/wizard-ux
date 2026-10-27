// Browser regression: agent screenshots appear inline where the reply mentions them.
// Run against tools/inline-images-preview.mjs, never the owner's live Wizard.
// PREVIEW_URL=https://<private-preview>/ OUT=<evidence-dir> PLAYWRIGHT_MODULE=<module> node qa-inline-agent-screenshots.cjs
// Optional LEGACY_WEB=<base checkout web> verifies an actual old renderer too.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:9532';
const out = path.resolve(process.env.OUT || 'qa-out/inline-agent-screenshots');
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const evidence = { checks: [], screenshots: [] };
  const ok = (value, label) => { assert.ok(value, label); evidence.checks.push(label); };
  try {
    const probe = await browser.newContext();
    evidence.receipt = await (await probe.request.get(base + '/__preview/receipt')).json();
    assert.equal(evidence.receipt.synthetic, true); assert.equal(evidence.receipt.readOnly, true);
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const res = await probe.request.fetch(base + '/wizard/hermes/api/sessions', { method, data: '{}' });
      assert.equal(res.status(), 403); evidence.checks.push(method + ' rejected');
    }
    await probe.close();
    for (const skin of ['nebula', 'obsidian-light']) {
      const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
      await ctx.addInitScript(s => localStorage.setItem('wos.skin', s), skin);
      const page = await ctx.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.goto(base + '/?session=inline_screenshots_preview', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.querySelectorAll('.msg.a .mimg').length === 2);
      await page.waitForFunction(() => [...document.querySelectorAll('.msg.a .mimg img')].every(i => i.complete && i.naturalWidth > 0));
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(700); // let skin-package layout and view-entry transitions settle
      const positions = await page.evaluate(() => {
        const bub = document.querySelector('.msg.a .bub'), imgs = [...bub.querySelectorAll('.mimg')];
        const paragraphs = [...bub.querySelectorAll(':scope > p')];
        return { ys: [paragraphs[0], imgs[0], paragraphs[1], imgs[1], paragraphs[2]].map(e => e.getBoundingClientRect().top),
          ids: imgs.map(e => e.getAttribute('data-med')), count: imgs.length,
          raw: /helm_attachments|MEDIA:|!\[Image\]/.test(bub.textContent), overflow: document.documentElement.scrollWidth > innerWidth || bub.getBoundingClientRect().right > innerWidth + 1,
          skin: WosSkin.current };
      });
      ok(positions.ys.every((y, i, a) => !i || y > a[i - 1]), skin + ': text/image/text/image/text order');
      ok(positions.count === 2 && !positions.raw && !positions.overflow && positions.skin === skin, skin + ': two thumbnails, no metadata or horizontal overflow');
      const snap = `${skin}-inline-phone.png`; await page.screenshot({ path: path.join(out, snap) }); evidence.screenshots.push(snap);
      await page.evaluate(() => {
        WosChat.copyRich = async text => { window.__copiedReply = text; return true; };
        WosChat.shareAssistantText = async text => { window.__sharedReply = text; return 'shared'; };
      });
      await page.locator('.msg.a [data-mcopy]').tap(); await page.locator('.msg.a [data-mshare]').tap();
      const copied = await page.evaluate(() => ({ copy: window.__copiedReply, share: window.__sharedReply }));
      ok(copied.copy === copied.share && copied.copy.includes('First screenshot') && copied.copy.includes('Second screenshot') && !/attachments\/|!\[Image\]|helm_attachments/.test(copied.copy), skin + ': copy/share preserve explanation without private image URLs');
      for (let i = 0; i < 2; i++) {
        await page.locator('.msg.a .mimg').nth(i).tap();
        await page.waitForFunction(() => {
          const viewer = document.querySelector('.mviewer.open'), image = viewer?.querySelector('.mv-stage img');
          return WosChat.viewer.state.open && image?.naturalWidth > 0 && getComputedStyle(viewer).opacity === '1';
        });
        const state = await page.evaluate(() => WosChat.viewer.state);
        ok(state.i === i && state.n === 2 && state.kind === 'image', skin + ': thumbnail ' + (i + 1) + ' opens full gallery viewer');
        if (i === 0) { const name = `${skin}-viewer-phone.png`; await page.screenshot({ path: path.join(out, name) }); evidence.screenshots.push(name); }
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !WosChat.viewer.state.open);
        ok(await page.evaluate(() => Object.values(__wos.wins).some(w => w.thread === 'inline_screenshots_preview')), skin + ': Back closes viewer, not thread');
      }
      ok(errors.length === 0, skin + ': no browser exceptions');
      await ctx.close();
    }
    // Legacy messages still carry unpositioned metadata. They stay bottom-only in the new client.
    const legacy = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
    await legacy.route('**/wizard/hermes/api/sessions/*/messages*', async route => {
      const response = await route.fetch(), payload = await response.json();
      for (const row of payload.data || []) if (typeof row.content === 'string') row.content = row.content.replace(/<helm_attachments>(.*?)<\/helm_attachments>/gs, (_, raw) => { const h = JSON.parse(raw); delete h.inline; return `<helm_attachments>${JSON.stringify(h)}</helm_attachments>`; });
      await route.fulfill({ response, json: payload });
    });
    const lp = await legacy.newPage(); await lp.goto(base + '/');
    await lp.waitForFunction(() => document.querySelectorAll('.msg.a .mimg').length === 2);
    ok(await lp.evaluate(() => { const b = document.querySelector('.msg.a .bub'); return b.querySelector('.mimg').getBoundingClientRect().top > [...b.querySelectorAll(':scope > p')].at(-1).getBoundingClientRect().top; }), 'old messages: bottom attachments, no duplicates');
    await legacy.close();
    if (process.env.LEGACY_WEB) {
      const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
      for (const f of ['chat-kit.js', 'chats.js']) await ctx.route('**/core/' + f + '*', route => route.fulfill({ body: fs.readFileSync(path.join(process.env.LEGACY_WEB, 'core', f)), contentType: 'application/javascript' }));
      const page = await ctx.newPage(); await page.goto(base + '/');
      await page.waitForFunction(() => document.querySelectorAll('.msg.a .mimg').length === 2);
      ok(await page.evaluate(() => { const b = document.querySelector('.msg.a .bub'); return b.querySelector('.mimg').getBoundingClientRect().top > [...b.querySelectorAll(':scope > p')].at(-1).getBoundingClientRect().top; }), 'old client: new envelopes become bottom attachments, no duplicates');
      const name = 'legacy-client-before-phone.png'; await page.screenshot({ path: path.join(out, name) }); evidence.screenshots.push(name); await ctx.close();
    }
  } finally { await browser.close(); fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(evidence, null, 2)); }
  console.log(JSON.stringify(evidence, null, 2));
})().catch(e => { console.error(e); process.exitCode = 1; });
