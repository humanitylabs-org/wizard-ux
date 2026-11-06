#!/usr/bin/env node
/* Render the existing house sigils as opaque, installable PNGs (512, 192 and 180 for apple-touch-icon).
 * No new icon designs. Optional: `--registry <apps.json>` (a saved /wizard/v1/apps response) also renders
 * registered apps without a house entry with the launcher's own fallback mark (the initial cut out of a disc),
 * so every registered app gets its own icon instead of the generic Wizard mark. */
const { chromium } = require('./qa-playwright.cjs');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const SIZES = [512, 192, 180];
const arg = process.argv.indexOf('--registry');
const extra = arg > 0 ? (JSON.parse(fs.readFileSync(process.argv[arg + 1], 'utf8')).apps || [])
  .filter(a => a && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(a.id || ''))
  .map(a => ({ id: a.id, name: String(a.name || a.id).slice(0, 80) })) : [];
(async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><div id="icon"></div>');
    await page.addStyleTag({path:path.join(root,'web/core/sigils.css')});
    await page.addScriptTag({path:path.join(root,'web/core/sigils.js')});
    const icons = await page.evaluate(async ({ sizes, extra }) => {
      const result = {};
      const apps = Object.keys(WizSigil.house).map(id => ({ id, name: id }));
      for (const a of extra) if (!WizSigil.house[a.id]) apps.push(a);
      for (const app of apps) {
        document.getElementById('icon').innerHTML = WizSigil.box('span','',app);
        const glyph = document.querySelector('.sgi');
        const mask = getComputedStyle(glyph).getPropertyValue('--sg').trim();
        // House masks are url(data:…); the letter fallback is url('data:…') whose body may hold ( ) '.
        const url = mask.match(/^url\((["']?)(data:image\/svg\+xml,.+)\1\)$/)?.[2];
        if (!url) continue; // Brand-only masks retain the ordinary Wizard fallback.
        const image = new Image(); image.src = url; await image.decode();
        result[app.id] = {};
        for (const size of sizes) {
          const c = document.createElement('canvas'); c.width = c.height = size;
          const ctx = c.getContext('2d'), inset = size * 85 / 512, box = size * 342 / 512;
          ctx.drawImage(image, inset, inset, box, box);
          ctx.globalCompositeOperation = 'source-in'; ctx.fillStyle = WizSigil.of(app).color; ctx.fillRect(0,0,size,size);
          ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = '#110d1b'; ctx.fillRect(0,0,size,size);
          result[app.id][size] = c.toDataURL('image/png').split(',')[1];
        }
      }
      return result;
    }, { sizes: SIZES, extra });
    const dest = path.join(root,'web/install-icons'); fs.mkdirSync(dest,{recursive:true});
    for (const [id, bySize] of Object.entries(icons)) for (const [size, bytes] of Object.entries(bySize))
      fs.writeFileSync(path.join(dest, id + (Number(size) === 512 ? '' : '-' + size) + '.png'), Buffer.from(bytes,'base64'));
    console.log(`Rendered ${Object.keys(icons).length} app icons at ${SIZES.join('/')}px`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
