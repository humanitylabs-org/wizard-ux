'use strict';
// wizard-ux issue 1706: the floating Wizard Everywhere orb lost its coloured disc on a phone; only the white icon
// showed over the wallpaper. The disc must stay behind the icon whatever the WebGL canvas does: drawn, blank after a
// surface was dropped while asleep, or a GPU context lost for good.
// Real Chromium, the real overlay pages (Android asset and web copy), transparent background like the overlay window.
//   node tests/qa-everywhere-orb-disc.cjs                       candidate (this checkout)
//   QA_ROOT=<old checkout> QA_EXPECT=broken node tests/qa-everywhere-orb-disc.cjs   baseline
//   QA_SHOTS=<dir> also saves a phone-size shot of each case.
const {chromium} = require('../tools/qa-playwright.cjs');
const path = require('node:path'), fs = require('node:fs'), {pathToFileURL} = require('node:url');
const ROOT = path.resolve(process.env.QA_ROOT || path.join(__dirname, '..'));
const SHOTS = process.env.QA_SHOTS || '';
const EXPECT = process.env.QA_EXPECT || 'fixed';
const PAGES = [['android', 'android/app/src/main/assets/assist/everywhere.html'], ['web', 'web/assist/everywhere.html']];
const LOOKS = [['nebula', 'none'], ['ember', 'hue-rotate(115.0deg) saturate(1.150) brightness(1.050)']];

// How much of a ring between the icon and the disc's edge is painted (alpha > .6), read from a real screenshot.
async function discCover(page) {
  const png = (await page.screenshot({omitBackground: true})).toString('base64');
  return page.evaluate(async png => {
    const img = new Image(); img.src = 'data:image/png;base64,' + png; await img.decode();
    const c = new OffscreenCanvas(img.width, img.height), x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, img.width, img.height).data, cx = img.width / 2, cy = img.height / 2, R = img.width / 2;
    let n = 0, on = 0;
    for (let a = 0; a < 360; a += 10) for (const f of [.36, .42, .48]) {
      const px = Math.round(cx + Math.cos(a * Math.PI / 180) * R * f), py = Math.round(cy + Math.sin(a * Math.PI / 180) * R * f);
      n++; if (d[(py * img.width + px) * 4 + 3] > 153) on++;
    }
    return on / n;
  }, png);
}

(async () => {
  const browser = await chromium.launch({args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']});
  const rows = []; let bad = 0;
  if (SHOTS) fs.mkdirSync(SHOTS, {recursive: true});
  for (const [name, rel] of PAGES) for (const [skin, filter] of LOOKS) {
    const page = await browser.newPage({viewport: {width: 76, height: 76}, deviceScaleFactor: 3});
    await page.goto(pathToFileURL(path.join(ROOT, rel)).href);
    await page.waitForFunction(() => window.E && window.Orb);
    await page.evaluate(([skin, filter]) => { E.look({skin, filter}); E.state({mode: 'idle'}); }, [skin, filter]);
    await page.waitForTimeout(1900);
    const cases = {};
    cases.drawn = await discCover(page);
    // Asleep (screen off / left behind WizardOS), and the GPU surface came back blank: no frame is drawn until wake.
    await page.evaluate(() => {
      Orb.sleep(true);
      const g = document.getElementById('orb').getContext('webgl'); g.clearColor(0, 0, 0, 0); g.clear(g.COLOR_BUFFER_BIT);
    });
    await page.waitForTimeout(300);
    cases.blankWhileAsleep = await discCover(page);
    if (SHOTS) await page.screenshot({path: path.join(SHOTS, `${name}-${skin}-blank-canvas.png`), omitBackground: true});
    await page.evaluate(() => Orb.sleep(false));
    await page.waitForTimeout(600);
    cases.afterWake = await discCover(page);
    // The canvas is laid out but this WebView will not draw it (the filtered, masked canvas lead).
    await page.evaluate(() => { document.getElementById('orb').style.visibility = 'hidden'; });
    cases.canvasNotDrawn = await discCover(page);
    await page.evaluate(() => { document.getElementById('orb').style.visibility = ''; });
    // Context lost for good (no restore). The icon must still sit on a disc.
    await page.evaluate(() => { Orb.sleep(true); document.getElementById('orb').getContext('webgl').getExtension('WEBGL_lose_context').loseContext(); Orb.sleep(false); });
    await page.waitForTimeout(600);
    cases.contextLost = await discCover(page);
    if (SHOTS) await page.screenshot({path: path.join(SHOTS, `${name}-${skin}-context-lost.png`), omitBackground: true});
    // Native sends a state on every change; the picture orb must still exist afterwards (web/assist is a subfolder).
    await page.evaluate(() => E.state({mode: 'idle'}));
    await page.waitForTimeout(300);
    const fb = await page.evaluate(() => { const f = document.getElementById('orbFallback'); return f.complete && f.naturalWidth > 0 ? 'loads' : 'missing: ' + f.src.split('/').slice(-2).join('/'); });
    const ok = Object.values(cases).every(v => v >= .9) && fb === 'loads';
    if (!ok) bad++;
    rows.push({page: name, skin, ...Object.fromEntries(Object.entries(cases).map(([k, v]) => [k, +v.toFixed(2)])), fallback: fb, ok});
    await page.close();
  }
  await browser.close();
  console.table(rows);
  if (EXPECT === 'broken') {
    if (!bad) { console.error('expected the baseline to lose the disc, but every case kept it'); process.exit(1); }
    console.log(`baseline: ${bad}/${rows.length} pages lose the disc (as reported)`);
  } else {
    if (bad) { console.error(`${bad}/${rows.length} pages lost the disc`); process.exit(1); }
    console.log(`candidate: the disc stays behind the icon in all ${rows.length} page/skin cases`);
  }
})().catch(e => { console.error(e); process.exit(1); });
