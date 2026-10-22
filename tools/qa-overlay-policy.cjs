// Browser-only supplement to OverlayE2eTest. No native-host or Android bridge proof.
// Usage: QA_PLAYWRIGHT=/path/to/playwright node tools/qa-overlay-policy.cjs
const {chromium} = require('./qa-playwright.cjs');
const fs = require('fs'), path = require('path'), assert = require('assert');
const root = path.resolve(__dirname, '..');
const java = fs.readFileSync(path.join(root, 'android/app/src/main/java/ai/wizards/os/OverlayPolicy.java'), 'utf8');
const csp = java.match(/static final String CSP = ([\s\S]*?);\n/)[1].match(/"[^"\n]*"/g).map(s => JSON.parse(s)).join('');
(async () => {
  const browser = await chromium.launch();
  try {
    for (const mode of ['header', 'meta']) for (const name of ['surface', 'everywhere', 'screen']) {
      const page = await browser.newPage({viewport: {width: 411, height: 914}});
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.route('https://fixture.invalid/**', async route => {
        const relative = new URL(route.request().url()).pathname.replace('/wizard-os-home/', '');
        const file = path.join(root, 'web', relative);
        assert(file.startsWith(path.join(root, 'web') + path.sep));
        const bytes = fs.readFileSync(file);
        const body = mode === 'meta' && file.endsWith('.html')
          ? Buffer.concat([Buffer.from('<!doctype html><meta http-equiv="Content-Security-Policy" content="' + csp + '">'), bytes]) : bytes;
        await route.fulfill({status: 200, body, headers: {
          'content-type': file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : 'image/png',
          ...(mode === 'header' ? {'content-security-policy': csp} : {}),
        }});
      });
      await page.goto('https://fixture.invalid/wizard-os-home/assist/' + name + '.html');
      const api = name === 'surface' ? 'W' : name === 'screen' ? 'S' : 'E';
      assert(await page.evaluate(api => !!window[api], api));
      if (name === 'surface') assert(await page.evaluate(() => {
        W.setMode('corner'); W.lockState(false); W.begin(); return document.body.classList.contains('corner');
      }));
      if (name === 'everywhere') assert(await page.evaluate(() => {
        E.state({mode: 'listen'}); return document.body.classList.contains('live');
      }));
      await page.evaluate(() => {
        for (const kind of ['srcdoc', 'data', 'url']) {
          const f = document.createElement('iframe');
          if (kind === 'srcdoc') f.srcdoc = '<body>injected<script>parent.__frameAttack=1</scr' + 'ipt>';
          else f.src = kind === 'data' ? 'data:text/html,<body>injected' : 'https://fixture.invalid/wizard-os-home/assist/surface.html';
          document.body.append(f);
        }
      });
      await page.waitForTimeout(300);
      assert(await page.evaluate(() => !window.__frameAttack && Array.from(document.querySelectorAll('iframe')).filter(f => f.src).every(f => !f.contentDocument)));
      assert.deepStrictEqual(errors, []);
      assert.strictEqual(await page.evaluate(() => document.compatMode), 'CSS1Compat');
      console.log('PASS ' + name + '/' + mode + ': real page API/state under native CSP; injected srcdoc script and network/data frames blocked');
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
