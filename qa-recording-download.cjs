// Focused synthetic browser QA for desktop retained-recording identification and download.
// QA_PLAYWRIGHT=/path/to/playwright-core QA_CHROME=/path/to/chrome node qa-recording-download.cjs [webDir] [outDir]
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { chromium } = require('./tools/qa-playwright.cjs');
const ROOT = path.resolve(process.argv[2] || 'web');
const OUT = path.resolve(process.argv[3] || 'recording-download-evidence');
const PAYLOAD = Buffer.from('wizard retained recording bytes\n');
const results = [], writes = [], errors = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(ok ? 'PASS' : 'FAIL', name, detail);
};
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
fs.mkdirSync(OUT, { recursive: true });

let browser;
(async () => {
  browser = await chromium.launch({ executablePath: process.env.QA_CHROME || undefined });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  await context.route('**/*', async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname;
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (u.origin !== 'http://127.0.0.1:9498') return route.abort();
    if (!['GET', 'HEAD'].includes(req.method())) writes.push(`${req.method()} ${p}`);
    if (p === '/wizard/v1/bootstrap') return json({ bootstrap: 1, settings: { agent: { name: 'QA Wizard' } }, capabilities: {} });
    if (p === '/wizard/thread-seen') return json({});
    if (p.startsWith('/wizard-os-home/')) {
      const file = path.resolve(ROOT, p.slice('/wizard-os-home/'.length) || 'index.html');
      if (file.startsWith(ROOT + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        return route.fulfill({ path: file, contentType: /\.js$/.test(file) ? 'text/javascript' : /\.css$/.test(file) ? 'text/css' : /\.html$/.test(file) ? 'text/html' : undefined });
      }
      return route.fulfill({ status: 404, body: '' });
    }
    if (p.includes('/apps')) return json({ apps: [] });
    if (p.includes('/sessions')) return json({ data: [] });
    return json({});
  });

  const page = await context.newPage();
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('http://127.0.0.1:9498/wizard-os-home/desktop.html?shell=desktop');
  await page.waitForFunction(() => window.WosOutbox && window.WizLive && window.__wux);
  const id = await page.evaluate(async bytes => {
    WizLive.sessions = [{ id: 'qa-source-thread', title: 'QA source chat', status: 'completed', updated_at: Date.now() }];
    const audio = new Blob([new Uint8Array(bytes)], { type: 'audio/webm' });
    const item = await WosOutbox.stage({ audio, kind: 'reply', sessionId: 'qa-source-thread', model: 'qa-model', provider: 'qa-provider' });
    await WosOutbox.transition(item.id, 'held', 'Synthetic retained recording');
    return item.id;
  }, [...PAYLOAD]);

  const panel = page.locator('#recordingRecovery');
  await panel.waitFor({ state: 'visible' });
  const text = await panel.innerText();
  check('recovery identifies the source chat', text.includes('QA source chat'), text);
  check('recovery identifies the recorded time and size', /\bKB\b/.test(text) && /\d/.test(text), text);
  await page.waitForTimeout(100);
  writes.length = 0; // Ignore shell bootstrap/read-state bookkeeping; fence only the download action.

  await page.evaluate(() => {
    window.__recoveryAnchorConnected = [];
    const nativeClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      window.__recoveryAnchorConnected.push(this.isConnected);
      if (!this.isConnected) return;
      return nativeClick.call(this);
    };
  });
  const downloadEvent = page.waitForEvent('download', { timeout: 2000 });
  await page.locator(`[data-record-download="${id}"]`).click();
  const download = await downloadEvent;
  const saved = path.join(OUT, 'wizard-recording.webm');
  await download.saveAs(saved);
  check('download uses a connected link', await page.evaluate(() => window.__recoveryAnchorConnected[0] === true));
  check('download preserves exact audio bytes', hash(fs.readFileSync(saved)) === hash(PAYLOAD));
  check('download gives visible feedback', /download/i.test(await page.locator('#toast').innerText()));
  check('download performs no server write', writes.length === 0, writes.join(', '));
  check('no uncaught browser errors', errors.length === 0, errors.join('\n'));

  await page.screenshot({ path: path.join(OUT, 'recording-recovery.png') });
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ results, writes, errors }, null, 2));
  process.exitCode = results.some(x => !x.ok) ? 1 : 0;
})().catch(e => {
  console.error(e);
  fs.writeFileSync(path.join(OUT, 'fatal.txt'), String(e.stack || e));
  process.exitCode = 2;
}).finally(() => browser?.close());
