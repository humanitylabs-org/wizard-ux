// Hostile-app check on a real box (wizard-os#133): the browser owner boundary, end to end.
// A real Wizard box in Docker (tools/boundary-box.sh: the shell image built from this repo, the real Agent Service
// image, a stand-in for Tailscale Serve that puts shell and app on one origin with the owner's login on every
// request). Real Chromium opens the real shell the way a home-screen icon does (?app-session=hostile), so the shell
// itself makes the app window. The app page (tests/fixtures/boundary-box/hostile) then tries everything a script in an
// app page could try against the owner. With the boundary on:
//  - the app is opaque: no shell page, storage, cookies, Wizard objects or native bridge; no popup, no top navigation;
//    the shell page loaded inside the app's own frame is out of reach too and gets no token from the box;
//  - every owner action it sends (read chats, new chat, start a run, change settings, remove an app, a forged token,
//    a no-cors run) is refused BY THE BOX (its own log, not a browser CORS error) and nothing reaches the agent;
//  - the shell's own owner calls carry the token and work, and Back, appearance and dictation into the app's field
//    still work.
//   tools/boundary-box.sh up on <shell image> <service image> 18133
//   QA_PLAYWRIGHT=<path to playwright> BOX=http://127.0.0.1:18133 node tests/qa-browser-boundary-box.cjs
//   With the box `up off`, QA_EXPECT=broken: the check must find the hole (proves it can fail).
//   QA_SHOT=<file.png>: the app window at phone size.
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path');
const { chromium } = require('../tools/qa-playwright.cjs');
const BOX = process.env.BOX || 'http://127.0.0.1:18133';
const EXPECT_BROKEN = process.env.QA_EXPECT === 'broken';
const SCRIPT = path.join(__dirname, '..', 'tools', 'boundary-box.sh');
const boxLog = () => execFileSync('sh', [SCRIPT, 'log'], { encoding: 'utf8' }).split('\n').filter(Boolean).map(l => JSON.parse(l));
const hermesLog = () => execFileSync('sh', [SCRIPT, 'hermes'], { encoding: 'utf8' }).split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l));
// What the box hands a page load of the shell, by how the browser says it loads it.
// (node:http, because fetch drops Sec-Fetch-* headers.)
const metaFor = dest => new Promise((resolve, reject) => {
  require('http').get(BOX + '/wizard-os-home/index.html', { headers: { 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': dest, 'Sec-Fetch-Site': 'same-origin' } }, res => {
    let body = ''; res.setEncoding('utf8'); res.on('data', c => { body += c; });
    res.on('end', () => { const m = /<meta name="wizard-shell-token" content="([^"]*)">/.exec(body); resolve(m ? m[1] : 'no-meta'); });
  }).on('error', reject);
});
// The app's own path and the shell's static files are not owner actions.
const ownerPath = u => !u.startsWith('/hostile/') && !/^\/wizard-os-home\/(?!api\/|store-install\/|install\/)[^?]*\.(js|css|svg|png|webp|woff2?|json|html)(\?|$)/.test(u);

(async () => {
  const navTop = await metaFor('document'), navFrame = await metaFor('iframe');
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 412, height: 860 } });
  // A stand-in for the phone app's native bridge, in the top-level shell page only (what the Android gate gives).
  await context.addInitScript(() => {
    if (window.top !== window) return;
    window.WizardOSNative = { browserBoundary() {}, shellToken() {}, secret: () => 'native-only' };
    try { localStorage.setItem('wos.qa-shell-secret', 'owner-private'); } catch (_) {}
    document.cookie = 'wos_qa=owner; path=/';
  });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(BOX + '/wizard-os-home/?app-session=hostile', { waitUntil: 'commit' });
  const appFrame = async () => {
    // A box that just started can be slow to answer the shell's first reads: give it one reload.
    for (let i = 0; i < 200; i++) {
      const f = page.frames().find(fr => fr.url().endsWith('/hostile/'));
      if (f) { try { if (await f.evaluate(() => typeof window.probe === 'function')) return f; } catch (_) {} }
      if (i === 100) await page.reload({ waitUntil: 'commit' });
      await page.waitForTimeout(200);
    }
    throw new Error('the shell never opened the app window');
  };
  const app = await appFrame();
  const sandbox = await page.evaluate(() => document.querySelector('iframe.appframe')?.getAttribute('sandbox'));
  // Appearance arrives on its own once the app window connects.
  await app.waitForFunction(() => window.themes.length > 0, null, { timeout: 8000 }).catch(() => {});
  const hermesBefore = hermesLog().length;
  const logBefore = boxLog().length;
  const pagesBefore = context.pages().length;
  const probe = await app.evaluate(() => window.probe());
  await page.waitForTimeout(1500);
  const shellUrl = page.url();
  // After a successful attack (boundary off) the shell may have been navigated away and the app window is gone.
  const safe = async (f, d) => { try { return await f(); } catch (e) { return d !== undefined ? d : 'error: ' + String(e.message).split('\n')[0]; } };
  const popups = context.pages().length - pagesBefore;
  const themes = await safe(() => app.evaluate(() => window.themes), []);
  // Back: the shell asks the app to go back one step, then (at its root) takes the step itself.
  const back = await safe(() => page.evaluate(async () => {
    const f = document.querySelector('iframe.appframe'), B = window.WizBrowserBoundary;
    if (!B || !f) return { missing: true };
    const root = []; const r1 = B.back(f, () => root.push('shell-step'));
    await new Promise(r => setTimeout(r, 400));
    const r2 = B.back(f, () => root.push('shell-step'));
    await new Promise(r => setTimeout(r, 400));
    return { r1, r2, root };
  }), {});
  const steps = await safe(() => app.evaluate(() => window.steps), []);
  // Dictation: the orb's path into the app's focused field (the real core/focused-field.js the shell uses).
  await safe(async () => { await app.click('#f', { timeout: 3000 }); await app.evaluate(() => document.getElementById('f').setSelectionRange(5, 5)); });
  const dictation = await safe(() => page.evaluate(async () => {
    const f = document.querySelector('iframe.appframe');
    const FIELDS = window.WizCore?.focusedField?.create({ frames: () => [f], controls: () => false, onChange: () => {} });
    if (!FIELDS) return 'no-focused-field';
    for (let i = 0; i < 20; i++) {
      const seal = FIELDS.capture();
      if (seal) { const p = FIELDS.insert(seal, ' world'); seal.release(); return (await p) ? 'inserted' : 'refused'; }
      await new Promise(r => setTimeout(r, 100));
    }
    return 'no-field';
  }));
  const fieldValue = await safe(() => app.evaluate(() => document.getElementById('f').value));
  if (process.env.QA_SHOT) await safe(() => page.screenshot({ path: process.env.QA_SHOT }));
  const log = boxLog();
  const fromApp = log.slice(logBefore).filter(e => e.o === 'null' && ownerPath(e.u));
  const shellToken = (log.find(e => e.t && !e.u.startsWith('/hostile/')) || {}).t || '';
  const shellOwnerOk = log.filter(e => e.t && e.t === shellToken && e.u.startsWith('/wizard/') && e.s >= 200 && e.s < 300);
  const hermesNew = hermesLog().slice(hermesBefore).filter(e => e.m !== 'GET');
  const want = { 'GET /wizard/v1/bootstrap': 0, 'GET /wizard/hermes/api/sessions': 0, 'POST /wizard/hermes/api/sessions': 0,
    'POST /wizard/hermes/v1/runs': 0, 'PUT /wizard/v1/settings': 0, 'POST /wizard-os-home/store-install/_remove/wizard-notes': 0 };
  // A JSON call the box refuses at its preflight (OPTIONS) is never sent at all: that counts as seen and refused too.
  for (const e of fromApp) for (const k of Object.keys(want)) if (k.split(' ')[1] === e.u.split('?')[0] && (e.m === 'OPTIONS' || e.m === k.split(' ')[0])) want[k]++;
  const result = { box: BOX, sandbox, navTop: navTop ? (navTop === 'off' ? 'off' : 'token') : '', navFrame, probe, fromApp, want,
    shellOwnerOk: shellOwnerOk.length, hermesNew, shellUrl, popups, themes, back, steps, dictation, fieldValue, errors };
  console.log(JSON.stringify(result, null, 1));

  const fails = [];
  // Real holes: the app read the shell, the box let an app owner call through, or it reached the agent.
  // The boundary-off run must find one of these, not just an expected side effect such as "no token".
  const exploits = [];
  const blocked = v => String(v).startsWith('blocked:');
  if (!sandbox || !/allow-scripts/.test(sandbox) || /allow-same-origin|allow-popups|allow-top-navigation/.test(sandbox)) fails.push('the app window is not an opaque sandbox: ' + sandbox);
  if (probe.origin !== 'null') fails.push('the app page is not opaque');
  for (const k of ['parentDoc', 'topDoc', 'parentStorage', 'parentBoundary', 'parentNative', 'parentCore']) if (!blocked(probe[k])) fails.push(`the app reached the shell's ${k}`);
  for (const k of ['parentDoc', 'topDoc', 'parentStorage']) if (!blocked(probe[k]) && probe[k] !== 'undefined' && probe[k] !== 'null') exploits.push(`the app reached the shell's ${k}`);
  if (probe.ownNative !== 'undefined') fails.push('the app page has the native bridge');
  if (Array.isArray(probe.storageKeys) && probe.storageKeys.some(k => k.startsWith('wos'))) fails.push('the app read shell storage');
  if (!blocked(probe.cookie) && /wos_qa=/.test(probe.cookie)) fails.push("the app read the owner's cookies");
  if (navTop.length !== 64) fails.push('the box gives the shell page no token (is the boundary on?)');
  if (navFrame !== '') fails.push('the box gives the token to a framed load of the shell page');
  if (probe.nested.doc !== 'null' && !blocked(probe.nested.doc)) fails.push('the app read the shell page loaded in its own frame');
  if (!blocked(probe.nested.boundary) && probe.nested.boundary !== 'undefined') fails.push("the app reached the framed shell page's Wizard objects");
  for (const [k, n] of Object.entries(want)) if (!n) fails.push(`the box never saw the app's ${k} (the check did not run)`);
  for (const e of fromApp) {
    if (e.t) fails.push(`the app sent the shell token: ${e.m} ${e.u}`);
    if (e.m !== 'OPTIONS' && !(e.s === 401 || e.s === 403)) fails.push(`the box did not refuse the app's ${e.m} ${e.u} (${e.s})`);
    if (e.m !== 'OPTIONS' && e.s >= 200 && e.s < 300) exploits.push(`the box let the app's ${e.m} ${e.u} through (${e.s})`);
  }
  if (hermesNew.length) { fails.push('an app call reached the agent: ' + JSON.stringify(hermesNew)); exploits.push('an app call reached the agent'); }
  if (popups > 0 || probe.popup !== 'null') fails.push('the app opened a window');
  if (/hostile=1/.test(shellUrl)) fails.push('the app navigated the shell');
  if (!shellOwnerOk.length) fails.push("the shell's own owner calls did not get through with the token");
  if (!themes.length) fails.push('appearance never reached the app');
  if (back.r1 !== 'pending' || back.r2 !== 'pending' || !steps.includes('app-back') || (back.root || []).join() !== 'shell-step') fails.push('Back');
  if (dictation !== 'inserted' || fieldValue !== 'hello world') fails.push('dictation into the app field');
  if (errors.length) fails.push('page errors');
  await browser.close();
  if (EXPECT_BROKEN) {
    if (!exploits.length) { console.error('FAIL: expected a real hole (boundary off), but the app could not act as the owner:', fails); process.exit(1); }
    console.log('PASS (expected broken): with the boundary off the check finds the hole:', exploits.slice(0, 6));
    return;
  }
  if (fails.length) { console.error('FAIL', fails); process.exit(1); }
  console.log('PASS: on a real box with the boundary on, a hostile app page cannot act as the owner; Back, appearance and dictation work');
})().catch(e => { console.error(e); process.exit(1); });
