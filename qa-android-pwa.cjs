// PWA install check on real Android Chrome (Thales emulator): manifest identity, scoped worker,
// Chrome's own installability errors, and a real beforeinstallprompt for /wizard-os-home/.
const { chromium } = require('/home/developer/node_modules/playwright');
const { execSync } = require('child_process');
const adb = c => execSync(`ssh -o ConnectTimeout=8 thales 'export PATH=$PATH:$HOME/Library/Android/sdk/platform-tools; export ANDROID_SERIAL=emulator-5554; ${c}'`, { encoding: 'utf8' });
let pass = 0, fail = 0;
const ok = (c, n, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); };
(async () => {
  adb('adb shell am force-stop com.android.chrome; adb shell am start -a android.intent.action.VIEW -d "https://wizard.tailc0f369.ts.net/wizard-os-home/" com.android.chrome >/dev/null; sleep 8; adb forward tcp:9333 localabstract:chrome_devtools_remote >/dev/null');
  const b = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const pages = b.contexts()[0].pages().filter(x => /\/wizard-os-home\/(\?|#|$)/.test(x.url()));
  let p = null;
  for (const x of pages) if (!p && await x.evaluate(() => document.visibilityState === 'visible').catch(() => false)) p = x;
  p = p || pages.at(-1);
  await p.evaluate(() => { window.__bip = 0; addEventListener('beforeinstallprompt', () => window.__bip++); });
  await p.reload(); await p.waitForTimeout(500);
  await p.evaluate(() => { window.__bip = 0; addEventListener('beforeinstallprompt', () => window.__bip++); });
  const cdp = await p.context().newCDPSession(p);
  const m = await cdp.send('Page.getAppManifest');
  const man = JSON.parse(m.data || '{}');
  ok(man.id === '/wizard-os-home/' && man.scope === '/wizard-os-home/' && man.start_url === '/wizard-os-home/', 'manifest has its own id, scope and start_url', JSON.stringify({ id: man.id, scope: man.scope, start: man.start_url }));
  ok(!(m.errors || []).length, 'manifest parses without errors', JSON.stringify(m.errors));
  await p.waitForTimeout(4000);
  const sw = await p.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return r ? r.scope : null; });
  ok(sw === 'https://wizard.tailc0f369.ts.net/wizard-os-home/', 'service worker scoped to /wizard-os-home/ only', String(sw));
  const ie = await cdp.send('Page.getInstallabilityErrors').catch(e => ({ err: String(e) }));
  ok(Array.isArray(ie.installabilityErrors) && ie.installabilityErrors.length === 0, 'Chrome reports zero installability errors', JSON.stringify(ie));
  // Chrome fires the prompt after its engagement check; a tap counts as engagement.
  const bb = await p.locator('#dock').boundingBox();
  for (let i = 0; i < 20 && !(await p.evaluate(() => window.__bip)); i++) await p.waitForTimeout(1000);
  ok(await p.evaluate(() => window.__bip) > 0 || await p.isVisible('#wizard-pwa-install'), 'Chrome offers a real install prompt for Wizard OS', 'bip=' + await p.evaluate(() => window.__bip));
  console.log(`${pass}/${pass + fail} passed`);
  await b.close().catch(() => {}); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
