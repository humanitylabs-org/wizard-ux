#!/usr/bin/env node
// Worker-only browser regression: inherited panels are solid, explicit package/My skin materials win.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const out = process.env.OUT || path.join(root, 'tmp', 'skin-panel-authority');
fs.mkdirSync(out, { recursive: true });
const files = ['core/base.css', 'styles.css', 'desktop/desktop.css', 'core/skins.css'];
const css = files.map(f => fs.readFileSync(path.join(root, 'web', f), 'utf8')).join('\n');
const panels = '<div class="device"><div class="sheet">Owner setting</div><div class="wmenu">Menu</div><div class="dock">Dock</div><div class="toast">Saved</div></div>';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const rows = [];
  for (const shell of ['phone', 'desktop']) for (const skin of ['nebula', 'grove', 'obsidian', 'landscapes-dawn']) {
    const packageCss = skin.startsWith('landscapes') ? fs.readFileSync(path.join(root, 'web/skins/landscapes/skin.css'), 'utf8') : skin === 'obsidian' ? fs.readFileSync(path.join(root, 'web/skins/obsidian/skin.css'), 'utf8') : '';
    await page.setContent(`<html data-skin="${skin}" data-shell="${shell}"><style>${css}</style><style>${packageCss}</style>${panels}</html>`);
    const inherited = await page.locator('.sheet').evaluate(e => ({ bg: getComputedStyle(e).backgroundColor, image: getComputedStyle(e).backgroundImage }));
    if (['nebula', 'grove'].includes(skin) && /rgba\([^)]*,\s*(?:0|0?\.\d+)\s*\)$/.test(inherited.bg)) throw Error(`Inherited backing is not solid: ${skin}/${shell}: ${inherited.bg}`);
    // A normal explicit skin selector, no !important and no extra policy switches.
    await page.addStyleTag({ content: `html[data-skin="${skin}"] .sheet { background: rgba(33, 66, 99, .31); backdrop-filter: blur(7px); }` });
    const explicit = await page.locator('.sheet').evaluate(e => ({ bg: getComputedStyle(e).backgroundColor, image: getComputedStyle(e).backgroundImage, blur: getComputedStyle(e).backdropFilter }));
    if (explicit.bg !== 'rgba(33, 66, 99, 0.31)' || explicit.image !== 'none' || explicit.blur !== 'blur(7px)') throw Error(`Explicit skin lost: ${skin}/${shell}: ${JSON.stringify(explicit)}`);
    // My skin is last in the normal cascade and retains owner authority too.
    await page.addStyleTag({ content: `html[data-skin="${skin}"] .sheet { background: rgba(88, 22, 55, .42); backdrop-filter: blur(3px); }` });
    const owner = await page.locator('.sheet').evaluate(e => ({ bg: getComputedStyle(e).backgroundColor, blur: getComputedStyle(e).backdropFilter }));
    if (owner.bg !== 'rgba(88, 22, 55, 0.42)' || owner.blur !== 'blur(3px)') throw Error(`My skin lost: ${skin}/${shell}`);
    rows.push({ shell, skin, inherited, explicit, owner });
    await page.screenshot({ path: path.join(out, `${shell}-${skin}.png`) });
  }
  await browser.close();
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ passed: rows.length, rows }, null, 2));
  console.log(JSON.stringify({ passed: rows.length, out }));
})().catch(e => { console.error(e); process.exitCode = 1; });
