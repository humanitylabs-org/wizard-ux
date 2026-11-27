// Real Chromium proof for wizard-ux issue 1629 (on for everyone; the switch wizard/app-location is gone): under the
// shell's real Permissions-Policy header, an app frame built with the real core/apps.js WizCore.frameAllow gets a
// position only when the app declared location (Maps); any other app frame is denied with no prompt. The browser's own permission
// is granted up front (Playwright), so what is measured is only the shell's frame rule.
// Run: node tests/app-location.browser.cjs   (QA_WEB=<other web dir> for a baseline)
const { chromium } = require('../tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), WEB = process.env.QA_WEB || path.join(ROOT, 'web');
const header = fs.readFileSync(path.join(ROOT, 'packaging/static.conf'), 'utf8').match(/Permissions-Policy "([^"]+)"/)[1];
const APPS = { apps: [
  { id: 'maps', name: 'Maps', url: '/maps/', source: 'apps.json', type: 'service', category: 'app', permissions: ['geolocation'] },
  { id: 'wizard-notes', name: 'Notes', url: '/notes/', source: 'apps.json', type: 'view', category: 'app' },
] };
const APP_PAGE = `<!doctype html><script>
  navigator.geolocation.getCurrentPosition(p => parent.postMessage({ app: location.pathname, ok: true, lat: p.coords.latitude }, '*'),
    e => parent.postMessage({ app: location.pathname, ok: false, code: e.code }, '*'), { timeout: 4000 });
</script>`;
const shellPage = tweaks => `<!doctype html><html data-tweaks="${tweaks}"><body><script>
  window.WizCore = { norm: s => s.toLowerCase() }; window.WizConfig = { endpoint: () => '/apps' };
</script><script src="/wizard-os-home/core/apps.js"></script><script>
  window.results = [];
  addEventListener('message', e => results.push(e.data));
  WizCore.appsLoaded().then(() => {
    for (const id of ['maps', 'wizard-notes']) {
      const f = document.createElement('iframe'); f.className = 'appframe'; f.dataset.ownApp = id;
      f.setAttribute('allow', WizCore.frameAllow('microphone; clipboard-read; clipboard-write; autoplay; fullscreen', { id }));
      f.src = id === 'maps' ? '/maps/' : '/notes/';
      document.body.appendChild(f);
    }
  });
</script></body></html>`;

(async () => {
  const browser = await chromium.launch();
  const out = {};
  let failed = 0;
  // With no tweaks at all, and with a stale saved copy of the old switch: the same result either way.
  for (const tweaks of ['', 'wizard/app-location']) {
    const ctx = await browser.newContext({ geolocation: { latitude: 52.37, longitude: 4.9 }, permissions: ['geolocation'] });
    const page = await ctx.newPage();
    await page.route('https://box.test/**', route => {
      const u = new URL(route.request().url());
      const html = body => route.fulfill({ status: 200, headers: { 'content-type': 'text/html', 'permissions-policy': header }, body });
      if (u.pathname === '/wizard-os-home/') return html(shellPage(tweaks));
      if (u.pathname === '/wizard-os-home/core/apps.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(path.join(WEB, 'core/apps.js')) });
      if (u.pathname === '/apps') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(APPS) });
      if (u.pathname === '/maps/' || u.pathname === '/notes/') return route.fulfill({ status: 200, contentType: 'text/html', body: APP_PAGE });
      return route.fulfill({ status: 404, body: '' });
    });
    page.on('dialog', d => { failed++; console.log('unexpected dialog', d.message()); d.dismiss(); });
    await page.goto('https://box.test/wizard-os-home/');
    await page.waitForFunction(() => window.results.length >= 2, null, { timeout: 15000 });
    const r = Object.fromEntries((await page.evaluate(() => window.results)).map(x => [x.app, x]));
    out[tweaks || 'none'] = r;
    const want = { '/maps/': true, '/notes/': false };
    for (const [app, ok] of Object.entries(want)) {
      const got = r[app];
      const pass = got && got.ok === ok && (ok ? got.lat === 52.37 : got.code === 1);
      if (!pass) failed++;
      console.log(`${pass ? 'PASS' : 'FAIL'} tweaks "${tweaks}" ${app} -> ${got?.ok ? 'position ' + got.lat : 'denied (code ' + got?.code + ')'}`);
    }
    await ctx.close();
  }
  await browser.close();
  if (process.env.QA_OUT) fs.writeFileSync(path.join(process.env.QA_OUT, 'app-location.json'), JSON.stringify(out, null, 1));
  if (failed) { console.log(failed + ' failed'); process.exit(1); }
  console.log('all passed');
})().catch(e => { console.error(e); process.exit(1); });
