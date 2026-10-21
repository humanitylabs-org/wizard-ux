// Per-app "updated · Reload" QA (core/app-versions.js). Run on Thales: local fixture server, real shell scripts from
// QA_WEB_DIR/web, fixture apps using the real app client. No production requests, no writes.
// Usage: QA_WEB_DIR=<worktree> PW=<playwright> QA_OUT=<dir> node qa-app-versions.cjs
const fs = require('fs'), path = require('path'), http = require('http'), os = require('os'), assert = require('assert/strict');
const { chromium } = require('./tools/qa-playwright.cjs');
const ROOT = process.env.QA_WEB_DIR || __dirname, OUT = process.env.QA_OUT || path.join(ROOT, 'evidence/app-versions');
fs.mkdirSync(OUT, { recursive: true });
const apps = [{ id: 'wisdom', url: '/wisdom/', name: 'Wisdom', colors: ['#777777', '#888888'] }, { id: 'meditation', url: '/meditation/', name: 'Meditate', colors: ['#777777', '#888888'] }];
const revs = { wisdom: 'aaaa', meditation: 'mmmm' };
let feedHits = 0, feedStatus = 200;
const writes = [];
function appHTML(id) {
  return `<!doctype html><html data-app="${id}"><meta name="viewport" content="width=device-width"><title>${id} fixture</title><body style="margin:0;background:#222;color:#eee">
<h1 style="margin:60px 16px 0">${id}</h1><input id="draft" value="unsaved fixture"><output id="loads"></output>
<script src="/wizard-os-home/core/app-client.js"></script><script>
const k='qa-loads-${id}';sessionStorage.setItem(k,String(+(sessionStorage.getItem(k)||0)+1));document.querySelector('#loads').textContent=sessionStorage.getItem(k);
</script></body></html>`;
}
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const send = (body, ct = 'text/html', status = 200) => { res.writeHead(status, { 'Content-Type': ct, 'Cache-Control': 'no-store' }); res.end(body); };
  if (!['GET', 'HEAD'].includes(req.method)) { writes.push({ method: req.method, url: req.url }); return send('{}', 'application/json', 405); }
  if (u.pathname === '/wizard-os-home/store-data/wizard/v1/installed-apps') {
    feedHits++;
    if (feedStatus !== 200) return send('{"error":"x"}', 'application/json', feedStatus);
    return send(JSON.stringify({ wam: Object.entries(revs).map(([id, commit]) => ({ id, repo: 'x/' + id, commit, version: '1', status: 'running' })), shell: [], complete: true, unavailable: [] }), 'application/json');
  }
  if (u.pathname.endsWith('/ux-version.txt')) return send('tree0001', 'text/plain');
  if (u.pathname.endsWith('/ux-changes.json')) return send('[]', 'application/json');
  if (u.pathname === '/wizard/v1/apps') return send(JSON.stringify({ apps }), 'application/json');
  if (u.pathname === '/wizard/v1/bootstrap') return send(JSON.stringify({ bootstrap: 1, endpoints: { apps: '/wizard/v1/apps' }, settings: { agent: { name: 'Fixture Wizard' } }, capabilities: {} }), 'application/json');
  if (u.pathname === '/wizard/hermes/api/sessions') return send(JSON.stringify({ data: [], has_more: false }), 'application/json');
  if (u.pathname.endsWith('/thread-seen')) return send(JSON.stringify({ state: { initializedAt: Date.now(), threads: {} } }), 'application/json');
  if (u.pathname.endsWith('/thread-dispositions')) return send(JSON.stringify({ state: {} }), 'application/json');
  if (u.pathname.startsWith('/wizard/')) return send('{}', 'application/json');
  if (u.pathname.endsWith('/sw.js')) return send("self.addEventListener('install',()=>self.skipWaiting());", 'application/javascript');
  const app = apps.find(a => u.pathname.startsWith(a.url)); if (app) return send(appHTML(app.id));
  if (u.pathname.startsWith('/wizard-os-home/')) {
    const file = u.pathname.slice('/wizard-os-home/'.length) || 'index.html';
    const p = path.resolve(ROOT, 'web', file); if (!p.startsWith(path.resolve(ROOT, 'web') + path.sep)) return send('', 'text/plain', 403);
    if (file === 'data.js' || file === 'summaries.js') return send('', 'application/javascript');
    if (!fs.existsSync(p) || !fs.statSync(p).isFile()) return send('', 'text/plain', 404);
    return send(fs.readFileSync(p), file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'application/javascript' : file.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream');
  }
  send('', 'text/plain', 404);
});
const receipt = { hostname: os.hostname(), source: process.env.QA_SHA, tests: [], blockedExternal: [] };
function ok(name, cond, detail) { receipt.tests.push({ name, pass: !!cond, ...(detail === undefined ? {} : { detail }) }); console.log(cond ? 'PASS' : 'FAIL', name, detail === undefined ? '' : JSON.stringify(detail)); assert.ok(cond, name); }
let origin;
async function waitFrame(p, url) { await p.waitForFunction(u => [...document.querySelectorAll('iframe')].some(f => f.src === u), url); for (let i = 0; i < 100; i++) { const fr = p.frames().find(f => f.url().split('#')[0] === url); if (fr) return fr; await p.waitForTimeout(50); } throw new Error('Missing frame ' + url); }
const loads = fr => fr.evaluate(() => +document.querySelector('#loads').textContent);
const strip = (p, id) => p.evaluate(id => { const s = [...document.querySelectorAll('.app-upd')].find(e => e.dataset.app === id); if (!s) return null; const b = s.getBoundingClientRect(), f = s.parentElement.querySelector('iframe')?.getBoundingClientRect(); const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); const desc = e => e ? (e.tagName + '.' + [...e.classList].join('.') + '#' + e.id) : null; const chain = []; for (let e = s.parentElement; e && chain.length < 6; e = e.parentElement) chain.push(desc(e) + ' pos=' + getComputedStyle(e).position + ' z=' + getComputedStyle(e).zIndex + ' ov=' + getComputedStyle(e).overflow); const fr = s.parentElement.querySelector('iframe'); window.__qaStripDbg = { top: desc(top), chain, frame: fr && (getComputedStyle(fr).position + ' z=' + getComputedStyle(fr).zIndex), box: [b.left, b.top, b.width, b.height] }; return { dbg: window.__qaStripDbg, onTop: !!top && s.contains(top), text: s.innerText.replace(/\s+/g, ' ').trim(), inWin: !!s.closest('[data-win]'), shown: b.width > 0 && getComputedStyle(s).display !== 'none', nearTop: f ? b.top >= f.top - 1 && b.top < f.top + 80 : false, insideX: f ? b.left >= f.left - 1 && b.right <= f.right + 1 : false }; }, id);
const check = p => p.evaluate(() => WizAppVersions.check());
async function waitFor(fn, ms = 6000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise(r => setTimeout(r, 150)); } return false; }
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r)); origin = 'http://127.0.0.1:' + server.address().port;
  const b = await chromium.launch({ headless: true });
  try {
    for (const mobile of [true, false]) {
      const S = mobile ? 'phone' : 'desktop', shell = mobile ? '__wos' : '__wux';
      revs.wisdom = 'aaaa'; revs.meditation = 'mmmm';
      const ctx = await b.newContext({ viewport: mobile ? { width: 390, height: 860 } : { width: 1440, height: 1000 }, hasTouch: mobile, isMobile: mobile, serviceWorkers: 'block' });
      await ctx.route('**/*', r => { const u = new URL(r.request().url()); if (u.origin !== origin) { receipt.blockedExternal.push(u.href); return r.abort(); } return r.continue(); });
      await ctx.addInitScript(() => { if (window !== parent) return; localStorage.setItem('wos.coached', 'true'); try { window.WosTour = undefined; } catch (_) {} });
      const p = await ctx.newPage(), errs = []; p.on('pageerror', e => errs.push(String(e)));
      await p.goto(origin + '/wizard-os-home/' + (mobile ? '?shell=phone' : 'desktop.html?shell=desktop'));
      await p.waitForFunction(s => !!window[s] && !!window.WizAppVersions, shell);
      await p.evaluate(() => WizCore.appsLoaded());
      const open = id => p.evaluate(({ id, mobile, shell }) => { const a = WizCore.apps(mobile ? 'mobile' : 'desktop').APP[id]; window[shell].openApp(a); }, { id, mobile, shell });
      await open('wisdom');
      const wis = await waitFrame(p, origin + '/wisdom/'); await wis.waitForFunction(() => window.WizardApp?.hosted && document.querySelector('#loads').textContent);
      await wis.evaluate(() => { history.replaceState(null, '', '#/c/tao/ch3/p5'); });
      await check(p);
      const l0 = await loads(wis);
      ok(S + ': same version → no strip, no reload', !(await strip(p, 'wisdom')) && l0 === 1, { l0, state: await p.evaluate(() => WizAppVersions.state()) });

      revs.wisdom = 'bbbb'; await check(p);
      await p.waitForTimeout(1200);
      let s = await strip(p, 'wisdom');
      ok(S + ': new Wisdom release while on screen → strip at the top of the Wisdom window', s && s.shown && s.onTop && s.inWin && s.nearTop && s.insideX && /Wisdom updated/.test(s.text) && /Reload/.test(s.text), s);
      ok(S + ': on-screen app is never reloaded behind the owner', (await loads(wis)) === 1);
      await p.waitForTimeout(900); await p.screenshot({ path: path.join(OUT, S + '-strip.png') });

      // Unsaved work: Reload waits for the app's hold, then fires once it is released.
      await wis.evaluate(() => { window.qaHold = WizardApp.update.hold('Unsaved note'); });
      await p.waitForTimeout(400);
      await p.locator('.app-upd[data-app="wisdom"] [data-go]').click();
      s = await strip(p, 'wisdom');
      ok(S + ': Reload with unsaved work waits ("Reloads after …") and keeps the page', /Reloads after unsaved note/i.test(s?.text || '') && (await loads(wis)) === 1, s);
      await wis.evaluate(() => window.qaHold.release());
      ok(S + ': hold released → app reloads by itself', await waitFor(async () => { try { return (await loads(wis)) === 2; } catch (_) { return false; } }), await p.evaluate(() => WizAppVersions.state().log.slice(-4)));
      await wis.waitForFunction(() => window.WizardApp?.hosted);
      ok(S + ': reload keeps the app route (chapter/page in the URL)', (await wis.evaluate(() => location.hash)) === '#/c/tao/ch3/p5');
      await check(p);
      ok(S + ': after reload the new version is current → strip gone', !(await strip(p, 'wisdom')));

      // Plain tap.
      revs.wisdom = 'cccc'; await check(p);
      await p.locator('.app-upd[data-app="wisdom"] [data-go]').click();
      ok(S + ': tap Reload → only Wisdom reloads, same place', await waitFor(async () => { try { return (await loads(wis)) === 3; } catch (_) { return false; } }) && (await wis.evaluate(() => location.hash)) === '#/c/tao/ch3/p5');
      await wis.waitForFunction(() => window.WizardApp?.hosted); await check(p);
      ok(S + ': no strip after tap reload', !(await strip(p, 'wisdom')));

      // Later (×): hidden for this release, back for the next one.
      revs.wisdom = 'dddd'; await check(p);
      await p.locator('.app-upd[data-app="wisdom"] [data-x]').click(); await check(p);
      ok(S + ': × hides the strip for this release', !(await strip(p, 'wisdom')) && (await loads(wis)) === 3);
      revs.wisdom = 'eeee'; await check(p);
      ok(S + ': next release shows it again', !!(await strip(p, 'wisdom')));
      await p.locator('.app-upd[data-app="wisdom"] [data-go]').click();
      await waitFor(async () => { try { return (await loads(wis)) === 4; } catch (_) { return false; } }); await wis.waitForFunction(() => window.WizardApp?.hosted);

      // Off screen: open another app so Wisdom is behind it.
      await open('meditation');
      const med = await waitFrame(p, origin + '/meditation/'); await med.waitForFunction(() => window.WizardApp?.hosted && document.querySelector('#loads').textContent);
      await p.waitForTimeout(300);
      const vis = await p.evaluate(() => Object.fromEntries(WizAppServices.update.frames().map(f => [f.appId, f.visible])));
      if (vis.wisdom) {
        // Desktop side-by-side: Wisdom still on screen. Hide it the way the owner would: go to Home.
        await p.evaluate(s => { if (s === '__wux') window.__wux.goHome?.(); }, shell); await p.waitForTimeout(300);
      }
      const vis2 = await p.evaluate(() => Object.fromEntries(WizAppServices.update.frames().map(f => [f.appId, f.visible])));
      receipt.visibility = { [S]: { afterOpen: vis, after: vis2 } };
      if (!vis2.wisdom) {
        revs.wisdom = 'ffff'; await check(p);
        ok(S + ': app behind another one updates quietly (no strip, reloaded, same place)', await waitFor(async () => { try { return (await loads(wis)) === 5; } catch (_) { return false; } }) && !(await strip(p, 'wisdom')) && (await wis.evaluate(() => location.hash)) === '#/c/tao/ch3/p5', { vis2, loads: await loads(wis).catch(e => String(e)), state: await p.evaluate(() => WizAppVersions.state()), frames: await p.evaluate(() => WizAppServices.update.frames().map(f => ({ a: f.appId, v: f.visible, h: f.holds, s: f.suspect }))) });
        // Typed text in a background app: never reloaded quietly.
        await med.evaluate(() => { document.querySelector('#draft').value = 'half a sentence'; });
        await open('wisdom'); await p.waitForTimeout(300);
        const vis3 = await p.evaluate(() => Object.fromEntries(WizAppServices.update.frames().map(f => [f.appId, f.visible])));
        if (!vis3.meditation) {
          revs.meditation = 'm2m2'; await check(p);
          await p.waitForTimeout(3500);
          ok(S + ': background app with typed text is never reloaded quietly (text kept)', (await loads(med)) === 1 && (await med.evaluate(() => document.querySelector('#draft').value)) === 'half a sentence', vis3);
          await open('meditation'); await p.waitForTimeout(300); await check(p);
          const ms = await strip(p, 'meditation');
          ok(S + ': switching back to it shows "Meditate updated · Reload" instead', !!ms && /Meditate updated/.test(ms.text) && ms.nearTop && (await loads(med)) === 1, ms);
          await p.waitForTimeout(900); await p.screenshot({ path: path.join(OUT, S + '-strip-meditate.png') });
        } else ok(S + ': (meditation stayed on screen; typed-text case covered on the other shell)', true, vis3);
      } else ok(S + ': (Wisdom stays on screen beside the other app; quiet case covered on the other shell)', true, vis2);

      // Cost: idle for 8 s → no extra feed requests beyond the explicit checks.
      const before = feedHits; await p.waitForTimeout(8000);
      ok(S + ': idle polling stays cheap (≤1 feed request in 8 s)', feedHits - before <= 1, { extra: feedHits - before });
      // Feed failure is silent.
      feedStatus = 500; await check(p); feedStatus = 200;
      ok(S + ': feed failure is silent (no page errors)', errs.length === 0, errs);
      await ctx.close();
    }
    ok('zero writes', writes.length === 0, writes);
    ok('no external requests', receipt.blockedExternal.length === 0, receipt.blockedExternal);
  } finally { await b.close(); await new Promise(r => server.close(r)); fs.writeFileSync(path.join(OUT, 'receipt.json'), JSON.stringify(receipt, null, 2)); }
  console.log('RECEIPT', path.join(OUT, 'receipt.json'), receipt.tests.length + ' passed');
})().catch(e => { receipt.error = String(e.stack); fs.writeFileSync(path.join(OUT, 'receipt.json'), JSON.stringify(receipt, null, 2)); console.error(e); server.close(); process.exitCode = 1; });
