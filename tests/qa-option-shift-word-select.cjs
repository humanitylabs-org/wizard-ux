'use strict';
// Issue 1279: ⌥⇧← / → in an app's text field (Messenger's composer) must reach the field, in the AI apps view and in
// Classic. Real desktop shell, synthetic app and reads only; no owner content or outgoing writes.
// Linux Chromium has no ⌥ word selection, so the synthetic app does the Mac's part itself: when the key reaches the
// field unclaimed (not defaultPrevented after the shell's capture listener), it extends the selection one word.
// QA_WEB=<another web/ dir> runs the same check against a baseline (e.g. a main worktree).
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const origin = 'https://wordselect.test', prefix = '/wizard-os-home/';
const web = path.resolve(process.env.QA_WEB || path.resolve(__dirname, '../web'));
const out = process.env.QA_OUT || 'option-shift-word-select-evidence';
const expectFixed = process.env.QA_EXPECT !== 'broken';
fs.mkdirSync(out, { recursive: true });
const APP = `<!doctype html><meta charset="utf-8"><style>
body{background:#171722;color:#eee;font:16px system-ui;padding:32px} textarea{width:90%;height:70px;font:20px system-ui}
#log{margin-top:16px;font-size:18px} .ok{color:#7ddc8a} .bad{color:#ff8a80}</style>
<h1>Synthetic Messenger composer</h1><textarea id="draft">hello there wizard friend</textarea><div id="log">Press ⌥⇧← in the box</div>
<script>
const t = document.getElementById('draft'); window.keyLog = [];
document.addEventListener('keydown', e => {
  if (!e.altKey || !e.shiftKey || !/^Arrow(Left|Right)$/.test(e.code)) return;
  window.keyLog.push({ code: e.code, prevented: e.defaultPrevented });
  const log = document.getElementById('log');
  if (e.defaultPrevented) { log.className = 'bad'; log.textContent = 'Blocked: the Wizard took ' + (e.code === 'ArrowLeft' ? '⌥⇧←' : '⌥⇧→') + ', nothing selected'; return; }
  e.preventDefault(); // what a Mac does natively: extend the selection one word
  const v = t.value, end = t.selectionStart;
  if (e.code === 'ArrowLeft') { let i = end; while (i > 0 && v[i - 1] === ' ') i--; while (i > 0 && v[i - 1] !== ' ') i--; t.setSelectionRange(i, t.selectionEnd, 'backward'); }
  else { let i = t.selectionEnd; while (i < v.length && v[i] === ' ') i++; while (i < v.length && v[i] !== ' ') i++; t.setSelectionRange(t.selectionStart, i); }
  log.className = 'ok'; log.textContent = 'Selected: “' + v.slice(t.selectionStart, t.selectionEnd) + '”';
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
        await p.keyboard.press('Alt+Shift+ArrowLeft'); await p.keyboard.press('Alt+Shift+ArrowLeft');
        await p.waitForTimeout(150);
        const r = await box.evaluate(t => ({ sel: t.value.slice(t.selectionStart, t.selectionEnd), log: window.keyLog, focus: document.activeElement === t }));
        await p.screenshot({ path: path.join(out, `${view}.png`) });
        console.log(view, JSON.stringify(r));
        if (expectFixed) {
          assert.ok(r.log.length === 2 && r.log.every(x => !x.prevented), view + ': both ⌥⇧← reached the field unclaimed');
          assert.equal(r.sel, 'wizard friend', view + ': two words selected');
          assert.ok(r.focus, view + ': focus stays in the field');
        }
        assert.deepEqual(errors, []);
        console.log('PASS', view);
      } catch (e) { failed++; console.error('FAIL', view, e.message, errors); }
      finally { await context.close(); }
    }
  } finally { await browser.close(); }
  if (failed) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
