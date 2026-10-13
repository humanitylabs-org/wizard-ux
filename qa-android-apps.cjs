// QA (Android Apps, James 10 Oct): the Android Apps view inside the Wizard OS phone shell, with a FAKE native port.
// Checks: list renders with badges, system apps hidden, search, launch goes through relay→port, row menu actions,
// Back closes the menu then stays in Wizard OS (never exits), queue "Ready to install" + Install call carries the pinned
// sha256/package/signer, Play hand-off, relay refuses other frames / other paths / unknown methods / top-window calls,
// and an older Wizard OS (no port) shows "Update Wizard OS to use Android Apps".
// Usage: QA_WEB_DIR=<wizard-ux worktree> QA_APP_DIR=<android-apps repo> [QA_SHOTS=dir] node qa-android-apps.cjs
const { chromium } = require('/home/developer/node_modules/playwright');
const fs = require('fs'), path = require('path');
const URL_ = 'https://legacy.wizard.example/wizard-os-home/?open=android-apps';
const W = process.env.QA_WEB_DIR || __dirname;
const A = process.env.QA_APP_DIR || '/home/developer/apps/android-apps';
const SHOTS = process.env.QA_SHOTS || '';
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };
const APPS = [
  { package: 'org.telegram.messenger.web', label: 'Telegram', versionName: '12.9.0', versionCode: 71000, installer: 'dev.imranr.obtainium', owner: '', system: false, launchable: true, badge: 'Obtainium' },
  { package: 'com.Slack', label: 'Slack', versionName: '25.10', versionCode: 2510, installer: 'com.android.vending', owner: 'com.android.vending', system: false, launchable: true, badge: 'Play' },
  { package: 'com.beemdevelopment.aegis', label: 'Aegis', versionName: '3.4.2', versionCode: 81, installer: 'ai.wizards.os', owner: 'ai.wizards.os', system: false, launchable: true, badge: 'Wizard' },
  { package: 'com.android.settings', label: 'Settings', versionName: '15', versionCode: 35, installer: '', owner: '', system: true, launchable: true, badge: 'System' },
];
const QUEUE = [
  { id: 'aaaaaaaaaaaa', name: 'Signal', package: 'org.thoughtcrime.securesms', route: 'open', source: 'developer', versionName: '8.30.3', versionCode: 176301, sha256: 'ab'.repeat(32), signer: 'cd'.repeat(32), bytes: 99e6 },
  { id: 'bbbbbbbbbbbb', name: 'Slack', package: 'com.Slack', route: 'play', source: 'play', play_url: 'https://play.google.com/store/apps/details?id=com.Slack' },
];
const UPDATES = [{ package: 'com.beemdevelopment.aegis', name: 'Aegis', installed: '3.4.2', versionName: '3.4.3', versionCode: 82, sha256: 'ef'.repeat(32), signer: 'c6'.repeat(32) }];

// The fake native port: records every message it receives; answers like AppsBridge does.
const FAKE_PORT = (apps) => {
  const calls = []; window.__portCalls = calls;
  const port = { onmessage: null, postMessage(s) {
    const m = JSON.parse(s); calls.push(m);
    const r = { status: { bridge: 1, app: 'ai.wizards.os', version: '0.8.9', versionCode: 23, sdk: 35, canInstall: true, installs: {} },
      list: { apps, self: 'ai.wizards.os', sdk: 35 }, icon: { package: m.params.package, data: null }, launch: true, openPlay: true, appInfo: true, uninstall: true,
      install: { started: true } }[m.method];
    setTimeout(() => port.onmessage && port.onmessage({ data: JSON.stringify(r === undefined ? { id: m.id, ok: false, error: 'unknown method' } : { id: m.id, ok: true, result: r }) }), 5);
  } };
  window.wizardAppsPort = port;
};

async function boot(b, { bridge = true } = {}) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const writes = [];
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url());
    if (!/private\.wizard\.example$/.test(u.hostname)) return r.abort();
    let m = u.pathname.match(/^\/wizard-os-home\/(.*)$/);
    if (m && q.method() === 'GET') {
      const f = m[1] || 'index.html';
      let p = path.join(W, 'web', f); if (!fs.existsSync(p) && /^(data|summaries)\.js$/.test(f)) p = path.join('/home/developer/apps/wizard-os-home/web', f);
      if (!fs.existsSync(p)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      const ct = f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : f.endsWith('.png') ? 'image/png' : 'application/javascript';
      return r.fulfill({ status: 200, contentType: ct, body: fs.readFileSync(p) });
    }
    if (u.pathname === '/wizard/v1/bootstrap') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ bootstrap: 1, settings: { owner: { name: 'James' }, agent: { name: 'Archimedes' }, clock: { timezone: 'Asia/Bangkok', day_starts_at: '06:00' } },
      capabilities: { voice: true, router: true, files: true }, endpoints: { apps: '/wizard/v1/apps', sessions: '/wizard/hermes/api/sessions', transcribe: '/wizard/voice/transcribe', route: '/wizard/v1/route' } }) });
    if (u.pathname === '/wizard/v1/apps') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ schema: 1, apps: [
      { id: 'android-apps', name: 'Android Apps', url: '/android-apps/', icon: '🤖', colors: ['#3ddc97', '#8f63ff'], desc: 'Your Android apps', status: 'running', source: 'launcher' }] }) });
    m = u.pathname.match(/^\/android-apps\/(api\/.*)$/);
    if (m) {
      if (q.method() !== 'GET') writes.push(m[1] + ' ' + (q.postData() || ''));
      if (m[1] === 'api/queue') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: QUEUE }) });
      if (m[1] === 'api/updates') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: UPDATES }) });
      if (m[1] === 'api/inventory') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(q.method() === 'GET' ? { at: 1791600000, apps: APPS } : { ok: true }) });
      return r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    }
    m = u.pathname.match(/^\/android-apps\/(.*)$/);
    if (m && q.method() === 'GET') {
      const f = m[1] || 'index.html', p = path.join(A, 'app', 'static', f);
      if (!fs.existsSync(p)) return r.fulfill({ status: 404, body: '' });
      return r.fulfill({ status: 200, contentType: f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : 'application/javascript', body: fs.readFileSync(p) });
    }
    if (u.pathname === '/other-app/') return r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><h1>other</h1>' });
    if (/\/hermes\/api\/sessions$/.test(u.pathname)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], has_more: false }) });
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); } catch (e) {} });
  if (bridge) await p.addInitScript(`(${FAKE_PORT})(${JSON.stringify(APPS)})`);
  await p.goto(URL_, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__wos && window.__wos.live && window.__wos.live.ok, null, { timeout: 30000 });
  await p.waitForTimeout(1500);
  return { ctx, p, errs, writes };
}
const frame = p => p.frames().find(f => /\/android-apps\//.test(f.url()));
const shot = async (p, n) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, n + '.png') }); };
const calls = p => p.evaluate(() => (window.__portCalls || []).map(c => ({ method: c.method, params: c.params })));
const back = async p => { await p.evaluate(() => history.back()); await p.waitForTimeout(700); };
const shellState = p => p.evaluate(() => ({ app: (__wos.wins[__wos.desks[__wos.idx].focus] || {}).appId, log: (window.__backLog || []).slice(-3) }));

(async () => {
  const b = await chromium.launch();
  /* ---------- with the native port ---------- */
  {
    const { ctx, p, errs, writes } = await boot(b);
    const f = frame(p);
    ok(!!f, '?open=android-apps opens Android Apps in the shell', p.frames().map(x => x.url()).join(' '));
    await f.waitForSelector('#installed .row', { timeout: 8000 }).catch(() => {});
    const rows = await f.$$eval('#installed .row', r => r.map(e => e.innerText.replace(/\s+/g, ' ')));
    ok(rows.length === 3, 'installed list renders (system app hidden by default)', JSON.stringify(rows));
    ok(rows.some(t => /Telegram.*Obtainium/.test(t)) && rows.some(t => /Slack.*Play/.test(t)) && rows.some(t => /Aegis.*Wizard/.test(t)), 'source badges: Obtainium / Play / Wizard', JSON.stringify(rows));
    ok(!rows.some(t => /Settings/.test(t)), 'System apps hidden by default');
    await f.check('#sys'); await p.waitForTimeout(150);
    ok((await f.$$('#installed .row')).length === 4, 'System toggle shows system apps');
    await f.uncheck('#sys');
    await f.fill('#q', 'tele'); await p.waitForTimeout(150);
    const hit = await f.$$eval('#installed .row', r => r.map(e => e.dataset.pkg));
    ok(hit.length === 1 && hit[0] === 'org.telegram.messenger.web', 'search filters the list', JSON.stringify(hit));
    await f.fill('#q', ''); await p.waitForTimeout(150);
    const ready = await f.$$eval('#ready .row', r => r.map(e => e.innerText.replace(/\s+/g, ' ')));
    ok(ready.length === 2 && /Signal/.test(ready[0]) && /Install/.test(ready[0]) && /Open in Play/.test(ready[1]), 'Ready to install: Signal (Install) and Slack (Open in Play)', JSON.stringify(ready));
    const ups = await f.$$eval('#updates .row', r => r.map(e => e.innerText.replace(/\s+/g, ' ')));
    ok(ups.length === 1 && /3\.4\.2 → 3\.4\.3/.test(ups[0]), 'Updates shows Aegis 3.4.2 → 3.4.3', JSON.stringify(ups));
    await shot(p, 'aa-list');
    const bannerHidden = await f.$eval('#banner', e => e.hidden);
    ok(bannerHidden, 'no "update Wizard OS" banner when the bridge is there');
    // Launch
    await f.click('[data-launch="org.telegram.messenger.web"]'); await p.waitForTimeout(250);
    let c = await calls(p);
    ok(c.some(x => x.method === 'launch' && x.params.package === 'org.telegram.messenger.web'), 'tap row → launch through relay → native port', JSON.stringify(c.map(x => x.method)));
    ok(c.some(x => x.method === 'list') && c.some(x => x.method === 'status'), 'view asked status + list');
    // Install from the queue carries the pinned values, never a URL.
    await f.click('[data-install="aaaaaaaaaaaa"]'); await p.waitForTimeout(250);
    c = await calls(p); const ins = c.find(x => x.method === 'install');
    ok(ins && ins.params.sha256 === 'ab'.repeat(32) && ins.params.package === 'org.thoughtcrime.securesms' && ins.params.signer === 'cd'.repeat(32) && !('url' in ins.params), 'Install sends pinned sha256 + package + signer (no URL)', JSON.stringify(ins));
    await f.click('[data-play="com.Slack"]'); await p.waitForTimeout(200);
    c = await calls(p);
    ok(c.some(x => x.method === 'openPlay' && x.params.package === 'com.Slack'), 'Open in Play → openPlay(com.Slack)');
    await f.click('[data-update="com.beemdevelopment.aegis"]'); await p.waitForTimeout(200);
    c = await calls(p);
    ok(c.some(x => x.method === 'install' && x.params.package === 'com.beemdevelopment.aegis' && x.params.sha256 === 'ef'.repeat(32)), 'Update → install with the pinned update');
    ok(writes.some(w => /^api\/inventory/.test(w)), 'view posts the inventory to the server', JSON.stringify(writes));
    // Row menu + Back
    await f.click('[data-menu="com.Slack"]'); await p.waitForTimeout(250);
    const menu = await f.$eval('#menu', e => ({ hidden: e.hidden, txt: e.innerText }));
    ok(!menu.hidden && /Open in Play/.test(menu.txt) && /App info/.test(menu.txt) && /Uninstall/.test(menu.txt), 'row menu: Open in Play / App info / Uninstall', JSON.stringify(menu));
    await shot(p, 'aa-menu');
    await back(p);
    await p.waitForTimeout(300);
    const afterMenu = await f.$eval('#menu', e => e.hidden);
    let st = await shellState(p);
    ok(afterMenu && st.app === 'android-apps' && JSON.stringify(st.log) === '["hosted"]', 'Back closes the menu only (one step), Android Apps stays open', JSON.stringify(st));
    await f.click('[data-menu="com.Slack"]'); await p.waitForTimeout(200);
    await f.click('#menu [data-act="appInfo"]'); await p.waitForTimeout(200);
    c = await calls(p);
    ok(c.some(x => x.method === 'appInfo' && x.params.package === 'com.Slack'), 'menu → App info');
    await f.click('[data-menu="com.Slack"]'); await p.waitForTimeout(200);
    await f.click('#menu [data-act="uninstall"]'); await p.waitForTimeout(200);
    c = await calls(p);
    ok(c.some(x => x.method === 'uninstall' && x.params.package === 'com.Slack'), 'menu → Uninstall');
    // Back at the app's root: the shell takes a step, Wizard OS never exits.
    await back(p);
    st = await shellState(p);
    ok(p.url().includes('/wizard-os-home/') && st.log.length > 0, 'Back at Android Apps root: Wizard OS stays open (shell step or "press back again")', JSON.stringify(st));
    await p.waitForTimeout(2300);
    await back(p);
    st = await shellState(p);
    ok(p.url().includes('/wizard-os-home/'), 'second Back (spaced): still in Wizard OS (at most the "press back again" warning)', JSON.stringify(st));
    await p.waitForTimeout(2300);
    // Relay security
    const before = (await calls(p)).length;
    await p.evaluate(() => window.postMessage({ type: 'wizard-os:android', id: 'x', method: 'launch', params: { package: 'com.Slack' } }, location.origin));
    await p.waitForTimeout(150);
    ok((await calls(p)).length === before, 'relay refuses messages from the top window itself');
    const rel = await p.evaluate(async () => {
      // A same-origin frame at another path (another hosted app).
      const fr = document.createElement('iframe'); fr.className = 'appframe'; fr.src = '/other-app/'; document.body.appendChild(fr);
      await new Promise(r => fr.onload = r);
      const got = [];
      fr.contentWindow.addEventListener('message', e => got.push(e.data));
      fr.contentWindow.parent.postMessage({ type: 'wizard-os:android', id: 'o1', method: 'launch', params: { package: 'com.Slack' } }, location.origin);
      await new Promise(r => setTimeout(r, 200));
      fr.remove();
      return { got, log: (window.__androidRelayLog || []).slice(-3) };
    });
    ok((await calls(p)).length === before && rel.log.includes('refused:frame'), 'relay refuses another app frame (other path)', JSON.stringify(rel));
    const um = await f.evaluate(() => new Promise(res => {
      const h = e => { if (e.data && e.data.id === 'u1') { removeEventListener('message', h); res(e.data); } };
      addEventListener('message', h);
      parent.postMessage({ type: 'wizard-os:android', id: 'u1', method: 'exec', params: {} }, location.origin);
      setTimeout(() => res(null), 1500);
    }));
    ok(um && um.ok === false && /unknown/.test(um.error) && (await calls(p)).length === before, 'relay refuses unknown methods before native', JSON.stringify(um));
    const detached = await p.evaluate(() => {
      // A window that isn't one of the shell's iframes (e.g. an opened popup) is refused even on this origin.
      return window.WizAndroidRelay.frameOk(window, location.origin) === false && window.WizAndroidRelay.frameOk(null, location.origin) === false;
    });
    ok(detached, 'relay frameOk: only shell iframes qualify');
    ok(!errs.length, 'no page errors (bridge)', errs.join(' | '));
    await ctx.close();
  }
  /* ---------- older Wizard OS: no port ---------- */
  {
    const { ctx, p, errs } = await boot(b, { bridge: false });
    const f = frame(p);
    await f.waitForFunction(() => !document.querySelector('#banner').hidden, null, { timeout: 25000 }).catch(() => {});
    const t = await f.$eval('#banner', e => ({ hidden: e.hidden, txt: e.innerText }));
    ok(!t.hidden && /Update Wizard OS to use Android Apps/.test(t.txt), 'older Wizard OS: "Update Wizard OS to use Android Apps"', JSON.stringify(t));
    const rows = await f.$$eval('#installed .row', r => r.length);
    ok(rows === 3, 'older Wizard OS: shows the list the phone last sent', String(rows));
    const dis = await f.$eval('[data-install="aaaaaaaaaaaa"]', e => e.disabled).catch(() => null);
    ok(dis === true, 'older Wizard OS: Install disabled');
    await shot(p, 'aa-old-apk');
    ok(!errs.length, 'no page errors (no bridge)', errs.join(' | '));
    await ctx.close();
  }
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
