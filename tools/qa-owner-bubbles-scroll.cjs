/* Owner bubbles + no scroll-yank browser QA (James, 8 Nov 2026). Forum only, synthetic service (qa-thread-tracker rig).
 *   node tools/qa-owner-bubbles-scroll.cjs <outdir> [skins=nebula,obsidian-light]
 * Phone + desktop per skin: owner bubble opaque and distinct from agent replies; a reply growing below the reader
 * does not move the thread and shows ↓ Latest. Screenshots land in <outdir>. */
'use strict';
const { chromium } = require('./qa-playwright.cjs');
const { mount, service } = require('./qa-thread-tracker.cjs');
const fs = require('node:fs'), path = require('node:path');
const OUT = path.resolve(process.argv[2] || '/tmp/qa-owner-bubbles'); fs.mkdirSync(OUT, { recursive: true });
const SKINS = (process.argv[3] || 'nebula,obsidian-light').split(',');
let pass = 0, fail = 0;
const check = (n, ok, d) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (d !== undefined ? ' — ' + JSON.stringify(d).slice(0, 400) : '')); };
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME ? { executablePath: process.env.QA_CHROME } : {}) });
  try {
    for (const shell of ['phone', 'desktop']) for (const skin of SKINS) {
      const tag = shell + '/' + skin, svc = service();
      const { ctx, page } = await mount(browser, svc, { shell, skin, tweaks: [] });
      try {
        await page.evaluate(sid => (window.__wux ? window.__wux.openThread(sid) : window.__wos.openWizardThread(sid)), 'tt-main');
        await page.waitForSelector('.ch-thread .msg.u .bub', { timeout: 20000 });
        await page.waitForTimeout(3600); // past the opening settle (opening still lands at the bottom, by design)
        const col = await page.evaluate(() => {
          const vis = s => [...document.querySelectorAll(s)].filter(n => n.getClientRects().length).pop();
          const u = vis('.ch-thread .msg.u .bub'), a = vis('.ch-thread .msg.a .bub'), cs = n => getComputedStyle(n);
          return { skin: document.documentElement.dataset.skin, u: cs(u).backgroundColor, uInk: cs(u).color, a: cs(a).backgroundColor, aInk: cs(a).color, token: cs(document.documentElement).getPropertyValue('--wz-owner-message').trim() };
        });
        check(`${tag}: skin applied`, col.skin === skin, col);
        const rgba = s => (s.match(/[\d.]+/g) || []).map(Number);
        const ub = rgba(col.u);
        check(`${tag}: owner bubble is opaque and differs from the reply`, ub.length === 3 || (ub.length === 4 && ub[3] === 1), col);
        check(`${tag}: reply surface is not the owner surface`, col.u !== col.a, col);
        await page.screenshot({ path: path.join(OUT, `${shell}-${skin}-thread.png`) });
        // Reader at the bottom; the last reply grows (streaming) — the view must stay put and offer ↓ Latest.
        const before = await page.evaluate(() => {
          const nb = [...document.querySelectorAll('.ch-msgs')].find(n => n.getClientRects().length);
          const doc = !!nb.closest('.wos-doc-thread'), sc = doc ? document.scrollingElement : nb;
          // A reader's own gesture (wheel/touch) ends the opening settle; a programmatic scroll alone is not a reader.
          nb.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 4000 }));
          sc.scrollTop = sc.scrollHeight; return sc.scrollTop;
        });
        await page.waitForTimeout(600);
        const res = await page.evaluate(async () => {
          const nb = [...document.querySelectorAll('.ch-msgs')].find(n => n.getClientRects().length);
          const doc = !!nb.closest('.wos-doc-thread'), sc = doc ? document.scrollingElement : nb;
          const top0 = sc.scrollTop, last = [...nb.querySelectorAll('.msg.a .bub')].pop();
          const steps = [];
          for (let i = 0; i < 5; i++) { const p = document.createElement('p'); p.textContent = 'Streaming more words into the reply. '.repeat(8); last.appendChild(p); await new Promise(r => setTimeout(r, 250)); steps.push(sc.scrollTop); }
          window.__qaSteps = steps;
          await new Promise(r => setTimeout(r, 400));
          const latest = [...document.querySelectorAll('[data-chlatest]')].some(b => !b.hidden && b.getClientRects().length > 0);
          return { top0, top1: sc.scrollTop, max: sc.scrollHeight - sc.clientHeight, latest, steps };
        });
        check(`${tag}: streaming growth does not yank the thread`, Math.abs(res.top1 - res.top0) <= 2 && res.max - res.top1 > 100, { before, ...res });
        check(`${tag}: ↓ Latest appears for new content below`, res.latest, res);
        await page.screenshot({ path: path.join(OUT, `${shell}-${skin}-streaming.png`) });
        check(`${tag}: no page errors`, !ctx.errors.length, ctx.errors);
      } catch (e) { check(`${tag}: run`, false, String(e).slice(0, 300)); await page.screenshot({ path: path.join(OUT, `${shell}-${skin}-error.png`) }).catch(() => {}); }
      await ctx.close();
    }
  } finally { await browser.close(); }
  console.log(`DONE pass=${pass} fail=${fail}`); process.exit(fail ? 1 : 0);
})();
