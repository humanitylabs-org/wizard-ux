// Browser hit-test for the side-button corner orb: Screen/Cancel/Pause must be the top element under their own centre while talking (0.8.4 bug: the invisible heard-bubble covered them).
// usage: node tools/qa_side_chip_hit.cjs $PWD/android/app/src/main/assets/assist/surface.html

const { chromium } = require('/home/telos/node_modules/playwright');
(async () => {
  const file = process.argv[2];
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 380, height: 132 }, deviceScaleFactor: 2.625 });
  await p.addInitScript(() => { window.WizardAssist = window.WizardNative = { log(){}, corner(){}, close(){ window.__closed = 1 }, shot(){ window.__shot = 1 }, cancel(){ window.__cancel = 1 }, pause(){ window.__pause = 1 }, send(){}, listen(){} }; });
  await p.goto('file://' + file + '#corner'); await p.waitForTimeout(400);
  const r = await p.evaluate(() => {
    if (typeof N !== 'undefined') { N.shot = N.shot || (() => { window.__shot = 1 }); }
    W.setMode('corner'); W.begin();
    const out = {};
    for (const id of ['shotC', 'cancelC', 'pauseC']) { const e = document.getElementById(id), bb = e.getBoundingClientRect();
      const top = document.elementFromPoint(bb.left + bb.width / 2, bb.top + bb.height / 2); out[id] = top && (top.closest('button') || top).id; }
    return out; });
  const c = await p.evaluate(() => document.getElementById('shotC').getBoundingClientRect());
  await p.mouse.click(c.left + c.width / 2, c.top + c.height / 2); await p.waitForTimeout(100);
  console.log(JSON.stringify({ hitTop: r, afterTap: await p.evaluate(() => ({ shot: !!window.__shot, closed: !!window.__closed })) }));
  await b.close();
})();
