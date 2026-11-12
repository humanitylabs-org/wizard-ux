// Browser QA for the app kit's live skin layer in a sandboxed app (wizard-os#133).
// Real Chromium: a shell page with the boundary on, the real core/browser-boundary.js and core/appearance-host.js, the
// real core/skins.css, a skin package sheet and My skin; an app page in a sandboxed frame that loads the real
// core/app-client.js and a vendored kit. The app cannot read the shell, yet it gets the shell's live kit, the skin
// sheets and My skin, follows a skin change and a My skin edit live, and gets them again after a reload.
//   QA_PLAYWRIGHT=<path to playwright> node tests/qa-browser-boundary-skin-layer.cjs
//   QA_WEB=<another checkout>/web QA_EXPECT=broken ...   (baseline: main fails these checks)
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('../tools/qa-playwright.cjs');
const WEB = process.env.QA_WEB || path.join(__dirname, '..', 'web');
const SHOTS = process.env.QA_SHOTS || '';
const APP = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/notes/vendor/wizard-ui.css">
<style>body{margin:0;padding:24px;font:16px system-ui;background:#fff;color:#111}</style>
<script src="/wizard-os-home/core/app-client.js"></script></head>
<body><h1>Notes</h1><button class="wz-btn" id="b">Save note</button>
<script>
  window.probe = () => {
    const out = { origin: self.origin };
    try { out.parentDoc = !!parent.document; } catch (e) { out.parentDoc = 'blocked:' + e.name; }
    const h = document.head;
    out.layer = [...h.querySelectorAll('link[data-wz-skin-layer]')].map(l => new URL(l.href).pathname);
    out.kit = !!h.querySelector('link[data-wz-shared="kit"]');
    out.vendoredOff = !!h.querySelector('link[href="/notes/vendor/wizard-ui.css"]')?.disabled;
    out.mine = h.querySelector('style[data-wz-my-skin]')?.textContent || '';
    const cs = getComputedStyle(document.getElementById('b'));
    out.btn = { outline: cs.outlineColor, radius: cs.borderTopLeftRadius, pkg: cs.getPropertyValue('--qa-pkg').trim() };
    return out;
  };
</script></body></html>`;
const VENDORED = '.wz-btn{border-radius:3px;padding:8px 14px;border:1px solid #888;background:#eee}';
const PKG = { grove: 'html .wz-btn{--qa-pkg:grove;background:#2f6b3a;color:#fff}', tide: 'html .wz-btn{--qa-pkg:tide;background:#1f4f8a;color:#fff}' };
const SHELL = `<!doctype html><html data-skin="nebula"><head><meta charset="utf-8">
<link rel="stylesheet" href="/wizard-os-home/core/skins.css">
<link rel="stylesheet" href="/wizard-os-home/skins/grove/skin.css" data-skin-pkg="grove">
<style id="wosMySkin" data-my-skin>.wz-btn{outline:3px solid rgb(255, 0, 128);border-radius:18px}</style>
<script>window.WizShellBoundary = Object.freeze({ on: true, header: 'X-Wizard-Shell-Token' });</script>
<script src="/wizard-os-home/core/browser-boundary.js"></script>
<script>window.WizCore = { apps: () => ({ APPS: [{ id: 'notes', url: '/notes/' }] }) };</script>
<script src="/wizard-os-home/core/appearance-host.js"></script></head>
<body style="margin:0;background:#120c22"><div class="win" data-win="w1" style="width:560px;height:320px;margin:20px">
<iframe class="appframe" style="width:100%;height:100%;border:0" sandbox="allow-scripts allow-forms allow-downloads" src="/notes/"></iframe></div>
<script>const f = document.querySelector('iframe'); WizBrowserBoundary.attach(f);
  window.skin = name => { const l = document.querySelector('link[data-skin-pkg]'); const n = document.createElement('link');
    n.rel = 'stylesheet'; n.href = '/wizard-os-home/skins/' + name + '/skin.css'; n.dataset.skinPkg = name; l.replaceWith(n); document.documentElement.dataset.skin = name; };
  window.mySkin = css => { document.getElementById('wosMySkin').textContent = css; };
  window.reloadApp = () => { f.src = '/notes/?r=' + Date.now(); };
</script></body></html>`;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const css = body => { res.setHeader('content-type', 'text/css'); res.end(body); };
  if (u.pathname === '/') { res.setHeader('content-type', 'text/html'); return res.end(SHELL); }
  if (u.pathname === '/notes/') { res.setHeader('content-type', 'text/html'); return res.end(APP); }
  if (u.pathname === '/notes/vendor/wizard-ui.css') return css(VENDORED);
  const pkg = u.pathname.match(/^\/wizard-os-home\/skins\/(\w+)\/skin\.css$/);
  if (pkg && PKG[pkg[1]]) return css(PKG[pkg[1]]);
  if (u.pathname.startsWith('/wizard-os-home/')) {
    const file = path.join(WEB, u.pathname.slice('/wizard-os-home/'.length));
    if (file.startsWith(WEB) && fs.existsSync(file)) { res.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : 'text/css'); return res.end(fs.readFileSync(file)); }
  }
  res.statusCode = 404; res.end('');
});
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 600, height: 360 } });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(base + '/');
  const app = () => page.frames().find(fr => new URL(fr.url()).pathname === '/notes/');
  await page.waitForFunction(() => document.querySelector('.win').classList.contains('wz-themed'), null, { timeout: 8000 });
  const settle = () => page.waitForTimeout(400);
  await settle();
  const first = await app().evaluate(() => window.probe());
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'skin-layer.png') });
  await page.evaluate(() => window.skin('tide')); await settle();
  const skinned = await app().evaluate(() => window.probe());
  await page.evaluate(() => window.mySkin('.wz-btn{outline:3px solid rgb(0, 200, 0);border-radius:2px}')); await settle();
  const edited = await app().evaluate(() => window.probe());
  await page.evaluate(() => window.reloadApp());
  await page.waitForFunction(() => document.querySelector('.win').classList.contains('wz-themed'), null, { timeout: 8000 }).catch(() => {});
  await settle();
  const reloaded = await app().evaluate(() => window.probe());
  const result = { first, skinned, edited, reloaded, errors };
  console.log(JSON.stringify(result, null, 1));
  const fails = [];
  if (first.origin !== 'null' || !String(first.parentDoc).startsWith('blocked')) fails.push('app is not sandboxed away from the shell');
  const wantLayer = name => ['/wizard-os-home/core/skins.css', `/wizard-os-home/skins/${name}/skin.css`];
  if (JSON.stringify(first.layer) !== JSON.stringify(wantLayer('grove'))) fails.push('skin sheets not mirrored into the sandboxed app');
  if (!first.kit || !first.vendoredOff) fails.push('the vendored kit was not swapped for the live kit');
  if (first.btn.outline !== 'rgb(255, 0, 128)' || first.btn.pkg !== 'grove') fails.push('My skin / skin package do not style the app');
  if (JSON.stringify(skinned.layer) !== JSON.stringify(wantLayer('tide')) || skinned.btn.pkg !== 'tide') fails.push('a skin change did not follow live');
  if (edited.btn.outline !== 'rgb(0, 200, 0)' || edited.btn.radius !== '2px') fails.push('a My skin edit did not follow live');
  if (JSON.stringify(reloaded.layer) !== JSON.stringify(wantLayer('tide')) || reloaded.btn.outline !== 'rgb(0, 200, 0)') fails.push('a reloaded app lost the layer');
  if (errors.length) fails.push('page errors');
  await browser.close(); server.close();
  if (process.env.QA_EXPECT === 'broken') {
    if (!fails.length) { console.error('FAIL: expected the baseline to miss the skin layer'); process.exit(1); }
    console.log('BASELINE BROKEN as expected:', fails.join('; ')); return;
  }
  if (fails.length) { console.error('FAIL', fails); process.exit(1); }
  console.log('PASS: a sandboxed app gets the live kit, skin sheets and My skin, follows changes live and after a reload');
})().catch(e => { console.error(e); process.exit(1); });
