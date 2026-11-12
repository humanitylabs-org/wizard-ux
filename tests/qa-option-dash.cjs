'use strict';
// Issue 1278: on a Mac ⌥- and ⌥⇧- (en / em dash) in an app's text field (Notes, Messenger) must reach the field, in the
// AI apps view and in Classic. Real desktop shell (told it runs on a Mac), synthetic app and reads only.
// Linux Chromium types nothing for ⌥-, so the synthetic app does the Mac's part itself: when the key reaches the
// field unclaimed (not defaultPrevented after the shell's capture listener), it types – or —.
// QA_WEB=<another web/ dir> runs the same check against a baseline (e.g. a main worktree).
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const origin = 'https://dash.test', prefix = '/wizard-os-home/';
const web = path.resolve(process.env.QA_WEB || path.resolve(__dirname, '../web'));
const out = process.env.QA_OUT || 'option-dash-evidence';
const expectFixed = process.env.QA_EXPECT !== 'broken';
fs.mkdirSync(out, { recursive: true });
const APP = `<!doctype html><meta charset="utf-8"><style>
body{background:#171722;color:#eee;font:16px system-ui;padding:32px} textarea{width:90%;height:70px;font:20px system-ui}
#log{margin-top:16px;font-size:18px} .ok{color:#7ddc8a} .bad{color:#ff8a80}</style>
<h1>Synthetic Notes editor</h1><textarea id="draft">pages 3</textarea><div id="log">Press ⌥- and ⌥⇧- in the box</div>
<script>
const t = document.getElementById('draft'); window.keyLog = [];
document.addEventListener('keydown', e => {
  if (!e.altKey || e.code !== 'Minus') return;
  window.keyLog.push({ code: e.code, shift: e.shiftKey, prevented: e.defaultPrevented });
  const log = document.getElementById('log'), ch = e.shiftKey ? '—' : '–';
  if (e.defaultPrevented) { log.className = 'bad'; log.textContent = 'Blocked: the Wizard took ' + (e.shiftKey ? '⌥⇧-' : '⌥-') + ', no ' + ch + ' typed'; return; }
  e.preventDefault(); // what a Mac does natively: type the dash
  t.setRangeText(ch, t.selectionStart, t.selectionEnd, 'end');
  log.className = 'ok'; log.textContent = 'Typed: ' + t.value;
});
</script>`;
(async () => {
  const browser = await chromium.launch();
  let failed = 0;
  try {
    for (const view of ['ai-apps', 'classic']) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
      await context.routeWebSocket('**/*', ws => ws.close());
      await context.addInitScript(view => {
        Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'MacIntel' });
        if (window !== top) return;
        localStorage.setItem('wos.shell', 'desktop'); localStorage.setItem('wos.desktop-view.v1', view);
        for (const [k, v] of Object.entries({ 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': 'nebula' })) localStorage.setItem(k, v);
      }, view);
      const errors = [];
      await context.route('**/*', async r => {
        const q = r.request(), u = new URL(q.url());
        if (u.origin !== origin) return r.abort();
        if (!['GET', 'HEAD'].includes(q.method())) return r.fulfill({ status: 403, json: {} });
        if (u.pathname === prefix + 'store/index.html') return r.fulfill({ contentType: 'text/html', body: APP });
        if (u.pathname.startsWith('/wizard/')) return r.fulfill({ json: ownerRead(u.pathname) });
        if (u.pathname.startsWith(prefix)) {
          const file = path.resolve(web, u.pathname.slice(prefix.length) || 'index.html');
          if (file.startsWith(web + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) return r.fulfill({ path: file });
        }
        return r.fulfill({ json: { apps: [], agents: [], sessions: [], connected: false } });
      });
      const p = await context.newPage(); p.on('pageerror', e => errors.push(e.message));
      try {
        await p.goto(origin + prefix + 'desktop.html');
        await p.waitForFunction(() => window.__wux && !WosWelcome.active && !WosExperience.state.busy);
        if (view === 'ai-apps') await p.waitForFunction(() => document.documentElement.dataset.aiApps === 'desktop');
        await p.evaluate(() => __wux.openApp(WizCore.apps('desktop').APP['app-store']));
        const frame = p.frameLocator('iframe[src*="/store/index.html"]'), box = frame.locator('#draft');
        await box.waitFor(); await p.waitForTimeout(600);
        await box.click(); await box.evaluate(t => t.setSelectionRange(t.value.length, t.value.length));
        await p.keyboard.press('Alt+Minus'); await p.keyboard.type('5 '); await p.keyboard.press('Alt+Shift+Minus');
        await p.waitForTimeout(150);
        const r = await box.evaluate(t => ({ value: t.value, log: window.keyLog, focus: document.activeElement === t }));
        await p.screenshot({ path: path.join(out, `${view}.png`) });
        console.log(view, JSON.stringify(r));
        if (expectFixed) {
          assert.ok(r.log.length === 2 && r.log.every(x => !x.prevented), view + ': ⌥- and ⌥⇧- reached the field unclaimed');
          assert.equal(r.value, 'pages 3–5 —', view + ': both dashes typed');
          assert.ok(r.focus, view + ': focus stays in the field');
        } else { // the bug: the shell takes both keys (they never reach the field, or arrive already claimed)
          assert.ok(r.log.every(x => x.prevented), view + ': baseline: no key reached the field unclaimed');
          assert.equal(r.value, 'pages 35 ', view + ': baseline: no dash typed');
        }
        assert.deepEqual(errors, []);
        console.log('PASS', view);
      } catch (e) { failed++; console.error('FAIL', view, e.message, errors); }
      finally { await context.close(); }
    }
  } finally { await browser.close(); }
  if (failed) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
