'use strict';
// James: "link another device shows connection QR on phone layout".
// Real shell + shared WizardApp Back + locally rendered, pixel-decoded QR codes.
// Usage: node tools/fake-setup-api.cjs 9479 & node qa-setup-link-another-device.cjs http://127.0.0.1:9479/wizard-os-home/
const pw = require('./tools/qa-playwright.cjs');
const jsQR = require(process.env.QA_JSQR || 'jsqr');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const BASE = process.argv[2] || 'http://127.0.0.1:9479/wizard-os-home/';
const ORIGIN = new URL(BASE).origin;
const SHOTS = process.env.QA_SHOTS || path.join(process.env.TMPDIR || process.cwd(), 'setup-link-device-shots');
const results = [];
fs.mkdirSync(SHOTS, { recursive: true });
const fixture = async phone => {
  const r = await fetch(ORIGIN + '/__fake/state', { method: 'POST', body: JSON.stringify({ firstRun: false, phone }) });
  assert.equal(r.status, 200);
};
async function check(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log('PASS', name); }
  catch (e) { results.push({ name, ok: false, error: String(e) }); throw e; }
}
async function decode(canvas) {
  const im = await canvas.evaluate(c => ({ w: c.width, h: c.height, pixels: Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data) }));
  return jsQR(new Uint8ClampedArray(im.pixels), im.w, im.h)?.data;
}
const WIZ = 'https://wizard.tail1234.ts.net/';
const PAYLOAD = 'wizard://connect?origin=' + encodeURIComponent(new URL(WIZ).origin);
(async () => {
  const browser = await pw.chromium.launch({ headless: true });
  try {
    for (const mode of ['phone', 'desktop']) {
      await fixture({ step: 'phone_seen', wizard_url: WIZ, device_name: 'wizard.tail1234.ts.net', phones: [{ name: 'Already linked' }] });
      const ctx = await browser.newContext(mode === 'phone'
        ? { viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' }
        : { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
      try {
        const errors = [];
        const page = await ctx.newPage(); page.on('pageerror', e => errors.push(String(e)));
        await ctx.addInitScript(shell => {
          localStorage.setItem('wux.shell', shell); localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.tour.v1', 'true');
        }, mode);
        await page.goto(BASE + (mode === 'desktop' ? 'desktop.html?' : '?') + 'shell=' + mode + '&open=setup');
        await page.waitForFunction(() => [...document.querySelectorAll('iframe')].some(el => el.contentWindow?.__setup));
        const f = page.frames().find(f => /\/setup\/(index\.html)?(?:\?|$)/.test(f.url()));
        assert.ok(f, 'Setup frame exists');
        // James: "Don't see the option" — the checklist itself (done phone row) must offer it, no extra tap.
        await f.waitForFunction(() => document.querySelector('#list .row[data-state="done"]'));
        await check(`${mode}: link another device is on the Setup checklist right under the done phone row`, async () => {
          const b = f.locator('#list [data-act="list-link-device"]');
          assert.equal(await b.isVisible(), true);
          assert.equal(await f.evaluate(() => document.querySelector('#list .rows').nextElementSibling.dataset.act), 'list-link-device');
          await b.click();
          const q = f.locator('#linkDevice [data-step="3"] canvas');
          await q.waitFor({ state: 'visible' }); await q.scrollIntoViewIfNeeded();
          assert.equal(await decode(q), PAYLOAD);
          await page.screenshot({ path: path.join(SHOTS, `${mode}-from-checklist-qr.png`) });
          await page.evaluate(() => document.documentElement.dataset.shell === 'phone' ? window.__wosNativeBack() : window.__wux.escStep());
          await f.waitForFunction(() => !__setup.state.linkDevice && __setup.state.screen === 'list');
          assert.equal(await f.locator('#list [data-act="list-link-device"]').isVisible(), true);
        });
        // James: space and a subtle tint, never flush with the row above in the same colour.
        await check(`${mode}: link another device button is spaced and tinted apart from the phone row`, async () => {
          const m = await f.evaluate(() => {
            const row = document.querySelector('#list .row'), b = document.querySelector('#list [data-act="list-link-device"]');
            return { gap: b.getBoundingClientRect().top - row.getBoundingClientRect().bottom, rowBg: getComputedStyle(row).backgroundColor, bBg: getComputedStyle(b).backgroundColor };
          });
          assert.ok(m.gap >= 12, 'gap ' + m.gap); assert.notEqual(m.bBg, m.rowBg); assert.notEqual(m.bBg, 'rgba(0, 0, 0, 0)');
        });
        // James: Done after step 2 folds it to a green check; Done at the bottom closes the window.
        await check(`${mode}: step 2 Done folds to a check, bottom Done closes link another device`, async () => {
          await f.locator('#list [data-act="list-link-device"]').click();
          await f.locator('#linkDevice [data-act="link-step2-done"]').click();
          assert.equal(await f.locator('#linkDevice [data-step="2"] .gl').getAttribute('data-g'), 'done');
          assert.equal(await f.locator('#linkDevice [data-step="2"] canvas').count(), 0);
          assert.equal(await decode(f.locator('#linkDevice [data-step="3"] canvas')), PAYLOAD);
          await f.locator('#linkDevice [data-act="link-step2-again"]').click();
          assert.equal(await f.locator('#linkDevice [data-step="2"] canvas').count(), 1);
          const done = f.locator('#linkDevice .sheetdone [data-act="link-device-done"]');
          await done.scrollIntoViewIfNeeded(); assert.equal(await done.innerText(), 'Done');
          await page.screenshot({ path: path.join(SHOTS, `${mode}-bottom-done.png`) });
          await done.click();
          await f.waitForFunction(() => !__setup.state.linkDevice && __setup.state.screen === 'list');
        });
        await f.locator('[data-act="open-phone"]').click();
        await f.waitForFunction(() => __setup.state.phone.data?.step === 'phone_seen');
        await check(`${mode}: button visible after linking, below the normal steps`, async () => {
          assert.equal(await f.locator('[data-act="link-device"]').isVisible(), true);
          assert.equal(await f.evaluate(() => document.querySelector('#phone .steps').nextElementSibling.dataset.act), 'link-device');
          assert.equal(await f.evaluate(() => __setup.layout), mode);
          assert.equal(await f.locator('#phone .qr').count(), mode === 'phone' ? 0 : 2);
        });
        const open = () => f.locator('[data-act="link-device"]').click();
        await open();
        await check(`link another device shows connection QR on ${mode} layout`, async () => {
          const q = f.locator('#linkDevice [data-step="3"] canvas');
          await q.scrollIntoViewIfNeeded();
          assert.equal(await q.isVisible(), true);
          assert.equal(await decode(q), PAYLOAD);
          assert.equal(await decode(f.locator('#linkDevice [data-step="2"] canvas')), 'https://tailscale.com/download');
          assert.match(await f.locator('#linkDevice [data-step="3"]').innerText(), /Wizard app on your other phone \(Scan QR code\)/);
          assert.equal(await f.locator('#linkDevice [data-step="3"] .url').getAttribute('data-url'), WIZ);
          assert.deepEqual(await f.locator('#linkDevice .gl').evaluateAll(es => es.map(el => el.dataset.g)), ['done', 'todo', 'todo']);
          assert.equal(await f.evaluate(() => document.querySelector('#app').inert), true);
          await page.screenshot({ path: path.join(SHOTS, `${mode}-link-another-device-qr.png`) });
        });
        await check(`${mode}: nested shell Back returns to the normal steps, never exits Setup`, async () => {
          await page.evaluate(() => document.documentElement.dataset.shell === 'phone' ? window.__wosNativeBack() : window.__wux.escStep());
          await f.waitForFunction(() => !__setup.state.linkDevice);
          assert.equal(await f.evaluate(() => __setup.state.screen), 'phone');
          assert.equal(await f.locator('#phone').isVisible(), true);
          assert.equal(await f.locator('[data-act="link-device"]').isVisible(), true);
          assert.equal(await f.evaluate(() => document.querySelector('#app').inert), false);
        });
        await check(`${mode}: bar Back and outside tap each close only the new sheet`, async () => {
          await open(); await f.locator('[data-act="close-link-device"]').click();
          assert.equal(await f.locator('#linkDevice').isVisible(), false);
          await open(); await f.locator('#scrim').click({ position: { x: 5, y: 5 } });
          assert.equal(await f.locator('#linkDevice').isVisible(), false);
          assert.equal(await f.evaluate(() => __setup.state.screen), 'phone');
          // No stale Back hold after either on-screen dismissal.
          await page.evaluate(() => document.documentElement.dataset.shell === 'phone' ? window.__wosNativeBack() : window.__wux.escStep());
          await f.waitForFunction(() => __setup.state.screen === 'list');
          await f.locator('[data-act="open-phone"]').click();
        });
        await check(`${mode}: serving also offers both QRs, polling preserves open sheet`, async () => {
          await fixture({ step: 'serving' });
          await f.waitForFunction(() => __setup.state.phone.data?.step === 'serving');
          await open();
          await f.evaluate(() => { window.__linkQr = document.querySelector('#linkDevice canvas'); });
          await page.waitForTimeout(2300);
          assert.equal(await f.evaluate(() => __setup.state.linkDevice && __linkQr === document.querySelector('#linkDevice canvas')), true);
          assert.equal(await decode(f.locator('#linkDevice [data-step="3"] canvas')), PAYLOAD);
        });
        await check(`${mode}: two live skins keep the sheet, QR and document`, async () => {
          await f.evaluate(() => { window.__linkDocument = document; });
          for (const skin of ['nebula', 'signal']) {
            await page.evaluate(s => WosSkin.set(s), skin);
            await f.waitForFunction(s => document.documentElement.dataset.skin === s, skin);
            assert.equal(await f.evaluate(() => __linkDocument === document && __setup.state.linkDevice), true);
            assert.equal(await decode(f.locator('#linkDevice [data-step="3"] canvas')), PAYLOAD);
            await f.locator('#linkDevice [data-step="3"] canvas').scrollIntoViewIfNeeded();
            await page.screenshot({ path: path.join(SHOTS, `${mode}-${skin}-qr.png`) });
          }
        });
        await check(`${mode}: unavailable/invalid address hides action and dismisses stale QR`, async () => {
          for (const [step, wizard_url] of [['serving', 'http://insecure.example/'], ['phone_seen', 'https://example.test/path'], ['off', WIZ], ['phone_seen', null]]) {
            await fixture({ step, wizard_url });
            await f.waitForFunction(([s,u]) => __setup.state.phone.data?.step === s && __setup.state.phone.data?.wizard_url === u, [step, wizard_url]);
            assert.equal(await f.locator('[data-act="link-device"]').count(), 0);
            assert.equal(await f.locator('#linkDevice').isVisible(), false);
          }
          assert.deepEqual(errors, []);
          const log = await (await fetch(ORIGIN + '/__fake/log')).json();
          assert.equal(log.filter(r => r.method === 'POST' && /phone\/(start|reset)$/.test(r.path)).length, 0, 'linking another device must never reset the existing connection');
        });
      } finally { await ctx.close(); }
    }
  } finally {
    await browser.close();
    const receipt = { suite: 'setup-link-another-device', pass: results.filter(r => r.ok).length, fail: results.filter(r => !r.ok).length, results };
    console.log(JSON.stringify(receipt, null, 2));
    if (process.env.QA_RECEIPT) fs.writeFileSync(process.env.QA_RECEIPT, JSON.stringify(receipt, null, 2));
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
