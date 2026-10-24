#!/usr/bin/env node
/* Render the existing house sigils as opaque, installable PNGs. No new icon designs. */
const { chromium } = require('./qa-playwright.cjs');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
(async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><div id="icon"></div>');
    await page.addStyleTag({path:path.join(root,'web/core/sigils.css')});
    await page.addScriptTag({path:path.join(root,'web/core/sigils.js')});
    const icons = await page.evaluate(async () => {
      const result = {};
      for (const id of Object.keys(WizSigil.house)) {
        const app = {id, name:id};
        document.getElementById('icon').innerHTML = WizSigil.box('span','',app);
        const glyph = document.querySelector('.sgi');
        const mask = getComputedStyle(glyph).getPropertyValue('--sg').trim();
        const url = mask.match(/^url\(["']?(data:image\/svg\+xml[^"')]+)["']?\)$/)?.[1];
        if (!url) continue; // Brand-only masks retain the ordinary Wizard fallback.
        const image = new Image(); image.src = url; await image.decode();
        const c = document.createElement('canvas'); c.width = c.height = 512;
        const ctx = c.getContext('2d');
        ctx.drawImage(image,85,85,342,342);
        ctx.globalCompositeOperation = 'source-in'; ctx.fillStyle = WizSigil.of(app).color; ctx.fillRect(0,0,512,512);
        ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = '#110d1b'; ctx.fillRect(0,0,512,512);
        result[id] = c.toDataURL('image/png').split(',')[1];
      }
      return result;
    });
    const dest = path.join(root,'web/install-icons'); fs.mkdirSync(dest,{recursive:true});
    for (const [id, bytes] of Object.entries(icons)) fs.writeFileSync(path.join(dest,id+'.png'),Buffer.from(bytes,'base64'));
    console.log(`Rendered ${Object.keys(icons).length} house sigils`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
