// Sibling-app install check on real Android Chrome: each private app gets its OWN install prompt + banner,
// even after another app on wizard.tailc0f369.ts.net (Wizard OS) has been installed.
const { chromium } = require('/home/telos/node_modules/playwright');
const { execSync } = require('child_process');
const adb = c => execSync(`ssh -o ConnectTimeout=8 thales 'export PATH=$PATH:$HOME/Library/Android/sdk/platform-tools; export ANDROID_SERIAL=emulator-5554; ${c}'`, { encoding: 'utf8' });
const apps = (process.argv[2] || 'idea-queue,cinequeue').split(',');
let pass = 0, fail = 0;
const ok = (c, n, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); };
(async () => {
  for (const app of apps) {
    const url = `https://wizard.tailc0f369.ts.net/${app}/`;
    adb(`adb shell am start -a android.intent.action.VIEW -d "${url}" com.android.chrome >/dev/null; sleep 9; adb forward tcp:9333 localabstract:chrome_devtools_remote >/dev/null`);
    const b = await chromium.connectOverCDP('http://127.0.0.1:9333');
    const pages = b.contexts()[0].pages().filter(x => x.url().startsWith(url));
    let p = null;
    for (const x of pages) if (!p && await x.evaluate(() => document.visibilityState === 'visible').catch(() => false)) p = x;
    p = p || pages.at(-1);
    if (!p) { ok(false, `${app}: tab found`); await b.close().catch(() => {}); continue; }
    await p.evaluate(k => localStorage.removeItem(k), 'wz-pwa-dismissed:/' + app + '/').catch(() => {});
    const cdp = await p.context().newCDPSession(p);
    const man = JSON.parse((await cdp.send('Page.getAppManifest')).data || '{}');
    ok(man.id === `/${app}/` && man.scope === `/${app}/`, `${app}: own manifest id + scope`, `${man.id} ${man.scope}`);
    let banner = false;
    for (let i = 0; i < 25 && !banner; i++) { banner = await p.isVisible('#wz-pwa-install, #wizard-pwa-install, #cineq-pwa-install, [id$="pwa-install"]').catch(() => false); if (!banner) await p.waitForTimeout(1000); }
    const ie = await cdp.send('Page.getInstallabilityErrors').catch(() => ({}));
    ok(banner, `${app}: Chrome offers its own install prompt (banner visible)`, JSON.stringify(ie.installabilityErrors || []));
    if (banner) { const shot = `/tmp/pwa-${app}.png`; adb(`adb exec-out screencap -p > ${shot}`); }
    await b.close().catch(() => {});
  }
  console.log(`${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
