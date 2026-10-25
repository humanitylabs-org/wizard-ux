/* Web-only contract/geometry proof. The port is a test double, NOT native lifecycle/device proof.
   PLAYWRIGHT_MODULE=/path/to/playwright CHROMIUM=/path/to/chrome OUT=/scratch/evidence node tools/qa-shell-orb-controls.cjs */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const {chromium} = require('./qa-playwright.cjs');
const root = path.resolve(__dirname, '..');
const out = process.env.OUT || path.join(root, 'shell-orb-qa');
fs.mkdirSync(out, {recursive: true});
const origin = 'https://wizard-overlay.invalid';
const pageUrl = origin + '/wizard-os-home/assist/everywhere.html';
const checks = [];
const check = (name, condition) => { assert(condition, name); checks.push(name); };
(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROMIUM, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
  try {
    // The unchanged signed APK is audited separately; this PR ships web bytes only.
    for (const bundled of [false]) {
      const context = await browser.newContext({viewport: {width: 240, height: 64}, deviceScaleFactor: 2});
      const base = path.join(root, bundled ? 'android/shell/src/main/assets/wizard-os-home' : 'web');
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin || !url.pathname.startsWith('/wizard-os-home/')) return route.abort();
        const file = path.resolve(base, url.pathname.slice('/wizard-os-home/'.length));
        if (!file.startsWith(base + '/') || !fs.existsSync(file)) return route.fulfill({status: 404, body: ''});
        const mime = file.endsWith('.html') ? 'text/html' : file.endsWith('.js') ? 'application/javascript' : 'image/png';
        return route.fulfill({status: 200, contentType: mime, body: fs.readFileSync(file)});
      });
      await context.addInitScript(() => {
        window.qaCalls = [];
        window.wizardOrbPort = {postMessage(text) { window.qaCalls.push(JSON.parse(text)); }};
      });
      const page = await context.newPage();
      const errors = [], consoleErrors = [], requests = [];
      page.on('pageerror', e => errors.push(e.stack || e.message));
      page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
      page.on('response', response => requests.push({url: response.url(), status: response.status()}));
      page.on('requestfailed', request => requests.push({url: request.url(), failure: request.failure()}));
      await page.goto(pageUrl, {waitUntil: 'networkidle'});
      const readiness = await page.evaluate(() => ({orb: !!window.Orb, e: !!window.E,
        controls: window.WosShellOrb?.v === 1, port: typeof window.wizardOrbPort?.postMessage,
        readyState: document.readyState, scripts: [...document.scripts].map(script => script.src)}));
      if (!readiness.orb || !readiness.e || !readiness.controls) {
        const crypto = require('node:crypto');
        const assets = ['assist/everywhere.html', 'assist/everywhere.js', 'assist/orb-size.js', 'orb.js'].map(rel => {
          const file = path.join(base, rel);
          return {file, sha256: fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null};
        });
        const diagnostic = {root, base, bundled, readiness, errors, consoleErrors, requests, assets};
        fs.writeFileSync(path.join(out, 'readiness-failure.json'), JSON.stringify(diagnostic, null, 2));
        console.error(JSON.stringify(diagnostic, null, 2));
        await page.screenshot({path: path.join(out, 'readiness-failure.png')});
      }
      check(`${bundled}: functional API with controls`, readiness.orb && readiness.e && readiness.controls);
      check(`${bundled}: idle controls hidden`, !await page.locator('#shellControls').isVisible());
      await page.evaluate(() => WosShellOrb.status({id: 'take-A', state: 'recording', ms: 8000}));
      for (const id of ['shellCancel', 'shellPause']) {
        const b = await page.locator('#' + id).boundingBox();
        check(`${bundled}: ${id} reachable 48px target`, b && b.height >= 48 && b.width >= 48 && b.x >= 0 && b.x + b.width <= 176 && b.y >= 0 && b.y + b.height <= 64);
      }
      check(`${bundled}: accurate carried timer`, await page.locator('#timer').innerText() === '0:08');
      await page.screenshot({path: path.join(out, bundled ? 'bundled-recording.png' : 'web-recording.png')});
      await page.getByRole('button', {name: 'Pause recording'}).click();
      let calls = await page.evaluate(() => qaCalls);
      check(`${bundled}: pause is take-bound v1`, calls.length === 1 && calls[0].v === 1 && calls[0].id && calls[0].method === 'device.recording.pause' && calls[0].params.id === 'take-A' && calls[0].params.on === true);
      check(`${bundled}: duplicate clicks disabled until reply`, await page.locator('#shellPause').isDisabled());
      await page.evaluate(() => wizardOrbPort.onmessage({data: JSON.stringify({v: 1, id: 'stale-request', ok: true, result: {id: null, state: 'idle'}})}));
      check(`${bundled}: stale replies cannot clear pending action`, await page.locator('#shellPause').isDisabled());
      await page.evaluate(() => {
        const result = {id: 'take-A', state: 'paused', ms: 8000};
        WosShellOrb.status(result);
        wizardOrbPort.onmessage({data: JSON.stringify({v: 1, id: qaCalls.at(-1).id, ok: true, result})});
      });
      check(`${bundled}: paused text is Resume`, await page.locator('#shellPause').innerText() === 'Resume');
      const timer = await page.locator('#timer').innerText();
      await page.waitForTimeout(500);
      check(`${bundled}: paused timer frozen`, await page.locator('#timer').innerText() === timer);
      await page.screenshot({path: path.join(out, bundled ? 'bundled-paused.png' : 'web-paused.png')});
      await page.getByRole('button', {name: 'Resume recording'}).click();
      check(`${bundled}: resume action`, await page.evaluate(() => qaCalls.at(-1).method === 'device.recording.pause' && qaCalls.at(-1).params.on === false));
      await page.evaluate(() => wizardOrbPort.onmessage({data: JSON.stringify({v: 1, id: qaCalls.at(-1).id, ok: true, result: {id: 'take-A', state: 'recording', ms: 8000}})}));
      await page.getByRole('button', {name: 'Cancel', exact: true}).click();
      calls = await page.evaluate(() => qaCalls);
      check(`${bundled}: cancel never sends`, calls.length === 3 && calls[2].method === 'device.recording.cancel' && calls.every(x => !x.method.includes('send') && !x.method.includes('start')));
      await page.evaluate(() => {
        E.state({mode: 'idle'});
        wizardOrbPort.onmessage({data: JSON.stringify({v: 1, id: qaCalls.at(-1).id, ok: true, result: {id: null, state: 'idle'}})});
      });
      check(`${bundled}: cancelled controls hidden`, !await page.locator('#shellControls').isVisible());
      // CSP checks on the actual document, including the APK copy. Inline srcdoc script must not execute.
      await page.evaluate(() => {
        const iframe = document.createElement('iframe');
        iframe.srcdoc = '<script>parent.qaInjected = true<\/script>';
        document.body.appendChild(iframe);
      });
      await page.waitForTimeout(300);
      check(`${bundled}: inline srcdoc script blocked`, !await page.evaluate(() => window.qaInjected));
      check(`${bundled}: no page exceptions`, errors.length === 0);
      await context.close();
    }
    // Negative control: old shipped web page has no usable recording controls/API under the same stub host.
    for (const fixture of ['old-web', 'mixed-old-html', 'no-port']) {
      const context = await browser.newContext({viewport: {width: 64, height: 64}});
      await context.route('**/*', route => {
        const u = new URL(route.request().url());
        if (u.origin !== origin) return route.abort();
        const rel = 'web/' + u.pathname.slice('/wizard-os-home/'.length);
        const useBase = fixture === 'old-web' || (fixture === 'mixed-old-html' && rel.endsWith('.html'));
        let body;
        try { body = useBase ? cp.execFileSync('git', ['show', '745d20cc:' + rel], {cwd: root}) : fs.readFileSync(path.join(root, rel)); }
        catch (_) { return route.fulfill({status: 404, body: ''}); }
        return route.fulfill({status: 200, contentType: rel.endsWith('.html') ? 'text/html' : rel.endsWith('.js') ? 'application/javascript' : 'image/png', body});
      });
      if (fixture !== 'no-port') await context.addInitScript(() => { window.wizardOrbPort = {postMessage() {}}; });
      const page = await context.newPage();
      await page.goto(pageUrl, {waitUntil: 'networkidle'});
      check(`${fixture}: legacy orb API works as positive control`, await page.evaluate(() => !!(window.E && window.Orb)));
      check(`${fixture}: rejected by native functional readiness guard`, !await page.evaluate(() => window.WosShellOrb?.v === 1));
      if (fixture === 'no-port') {
        await page.evaluate(() => E.state({mode: 'listen'}));
        check('old full-app host: web buttons stay hidden', !await page.locator('#shellControls').isVisible());
        check('old full-app host: orb remains 64px', (await page.locator('#orbBox').boundingBox()).width === 64);
      }
      await context.close();
    }
    fs.writeFileSync(path.join(out, 'web-results.json'), JSON.stringify({pass: true, scope: 'Chromium web UI + stub message port, not Android lifecycle', checks}, null, 2));
    console.log(JSON.stringify({pass: true, checks: checks.length, out}));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
