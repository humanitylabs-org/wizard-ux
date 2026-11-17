const { chromium } = require(process.env.HOME + '/work/pw/node_modules/playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const root = process.argv[2], out = process.argv[3], mode = process.argv[4] || 'on';
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0].split('#')[0])); fs.readFile(f, (e, b) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader('content-type', f.endsWith('.html') ? 'text/html' : f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'application/octet-stream'); r.end(b); }); }).listen(0, async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: +(process.env.W || 380), height: 132 }, deviceScaleFactor: 2 });
  const calls = [];
  await p.exposeFunction('nativeCall', n => calls.push(n));
  await p.addInitScript(on => { window.WizardNative = { send(){}, cancel(){}, pause(){}, listen(){}, unlock(){}, items(){return '[]'}, openWizard(){}, close(){}, log(){}, locked(){return false}, full(){}, corner(){}, shot(){ nativeCall('shot'); }, shots(){return 0},
    ...(on === 'on' ? { attachOn(){ return true; }, camera(){ nativeCall('camera'); }, pick(){ nativeCall('pick'); } } : {}) }; }, mode);
  await p.goto(`http://127.0.0.1:${srv.address().port}/surface.html#corner`);
  await p.waitForTimeout(600);
  await p.evaluate(() => { W.setMode('corner'); W.lockState(false); W.begin(); });
  await p.waitForTimeout(500);
  const vis = await p.evaluate(() => ['pauseC','cancelC','shotC','camC','pickC'].map(id => { const e = document.getElementById(id), r = e.getBoundingClientRect(); return [id, getComputedStyle(e).display, Math.round(r.left), Math.round(r.width)]; }));
  console.log(JSON.stringify(vis));
  if (mode === 'on') {
    await p.click('#camC'); await p.click('#pickC');
    await p.evaluate(() => W.onAttach({ shots: 1, pictures: 2, files: 3, added: 3, skipped: 0, tooBig: 0, max: 8 }));
    await p.waitForTimeout(400);
    console.log('calls', JSON.stringify(calls), await p.evaluate(() => [document.getElementById('camN').textContent, document.getElementById('pickN').textContent, document.getElementById('shotN').textContent, document.getElementById('camC').getAttribute('aria-label')]));
  }
  await p.screenshot({ path: out, omitBackground: false });
  await b.close(); srv.close();
});
