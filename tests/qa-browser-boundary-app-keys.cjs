// Browser QA for app keys (data-wz-key) in a sandboxed app (wizard-os#133 slice 24, browser owner boundary).
// Real Chromium: a shell page with the boundary on, the real core/browser-boundary.js, and an app page in a sandboxed
// frame that loads the real core/app-client.js and marks two controls with data-wz-key. The shell side plays the AI
// apps view (layouts/ai-apps/desktop.js): it calls pressAppKeys() while it runs, presses a key with
// appKeys(frame).find(...).el.click(), and places a keycap from the stand-in's box plus the frame's offset.
// Real key presses: ⌥J typed inside the app and ⌥/ typed in the shell press the app's own controls; an unmarked ⌥K
// stays the app's; a dialog in the app limits its keys to the dialog; with the view gone the app keeps ⌥J itself.
//   QA_PLAYWRIGHT=<path to playwright> node tests/qa-browser-boundary-app-keys.cjs
//   QA_WEB=<another web/ dir, e.g. main's> QA_EXPECT=broken: the checks must fail there.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('../tools/qa-playwright.cjs');
const WEB = process.env.QA_WEB ? path.resolve(process.env.QA_WEB) : path.join(__dirname, '..', 'web');
const SHOT = process.env.QA_SHOT || '';
const APP = `<!doctype html><html><head><meta charset="utf-8"><script src="/wizard-os-home/core/app-client.js"></script>
<style>body{margin:0;padding:30px 0 0 40px;font:14px sans-serif}button,input{margin:4px}</style></head>
<body><button id="next" data-wz-key="j" aria-label="Next note">Next</button><input id="q" data-wz-key="/" aria-label="Search notes" placeholder="Search">
<div id="dlg" role="dialog" hidden><button id="ok" data-wz-key="j" aria-label="Confirm">OK</button></div>
<script>
  window.log = []; window.typed = [];
  document.getElementById('next').addEventListener('click', () => log.push('next'));
  document.getElementById('ok').addEventListener('click', () => log.push('ok'));
  document.getElementById('q').addEventListener('focus', () => log.push('search-focus'));
  addEventListener('keydown', e => { if (e.altKey) typed.push(e.code + ':mine'); });
  WizardApp.ready?.();
</script></body></html>`;
const SHELL = `<!doctype html><html><head><meta charset="utf-8">
<script>window.WizShellBoundary = Object.freeze({ on: true, header: 'X-Wizard-Shell-Token' });</script>
<script src="/wizard-os-home/core/browser-boundary.js"></script>
<style>body{margin:0}#bar{height:40px;background:#223}iframe{position:absolute;left:60px;top:70px;width:420px;height:200px;border:0}</style></head>
<body><div id="bar"><button id="shellBtn">shell</button></div><iframe class="appframe" sandbox="allow-scripts allow-forms allow-downloads" src="/notes/"></iframe>
<script>
  const f = document.querySelector('iframe'), B = WizBrowserBoundary; window.shellGot = [];
  B.attach(f);
  // The AI apps view stand-in: presses the app in front's keys (appKeyOf: KeyJ -> j, Slash -> /).
  const keyOf = code => { const m = /^Key([A-Z])$/.exec(code); return m ? m[1].toLowerCase() : ({ Slash: '/' })[code] || ''; };
  const pressKey = (code, from) => { const t = B.appKeys(f).find(t => t.key === keyOf(code)); shellGot.push(from + ':' + code + (t ? ':pressed' : ':none')); if (t) t.el.click(); return !!t; };
  window.view = { off: B.pressAppKeys(() => f) };
  B.onInput((fr, ev) => { if (ev.kind === 'key' && ev.type === 'keydown' && ev.altKey) pressKey(ev.code, 'frame'); });
  addEventListener('keydown', e => { if (e.altKey && /^Key|Slash/.test(e.code) && pressKey(e.code, 'shell')) e.preventDefault(); });
  // A keycap where the guide would draw it: the stand-in's box moved by the frame's offset (desktop.js chip()).
  window.caps = () => { const fr = f.getBoundingClientRect(); return B.appKeys(f).map(t => { const r = t.el.getBoundingClientRect(); return { key: t.key, label: t.label, x: Math.round(r.left + fr.left), y: Math.round(r.top + fr.top), w: Math.round(r.width) }; }); };
</script></body></html>`;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const html = body => { res.setHeader('content-type', 'text/html'); res.end(body); };
  if (u.pathname === '/') return html(SHELL);
  if (u.pathname === '/notes/') return html(APP);
  if (u.pathname.startsWith('/wizard-os-home/')) {
    const file = path.join(WEB, u.pathname.slice('/wizard-os-home/'.length));
    if (file.startsWith(WEB) && fs.existsSync(file)) { res.setHeader('content-type', 'text/javascript'); return res.end(fs.readFileSync(file)); }
  }
  res.statusCode = 404; res.end('');
});
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 560, height: 320 } });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  const fails = [], ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails.push(msg); };
  await page.goto(base + '/');
  const app = () => page.frames().find(fr => fr.url().includes('/notes/'));
  await page.waitForFunction(() => window.caps?.().length === 2, null, { timeout: 6000 }).catch(() => {});
  ok((await app().evaluate(() => self.origin)) === 'null', 'the app page is opaque');
  const caps = await page.evaluate(() => caps()).catch(() => []);
  const real = await page.evaluate(() => { const fr = document.querySelector('iframe').getBoundingClientRect(); return { fr: { x: fr.left, y: fr.top } }; });
  const inApp = await app().evaluate(() => ['next', 'q'].map(id => { const r = document.getElementById(id).getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width) }; }));
  const want = inApp.map(r => ({ x: r.x + real.fr.x, y: r.y + real.fr.y, w: r.w }));
  ok(caps.length === 2 && caps.every((c, i) => c.x === want[i].x && c.y === want[i].y && c.w === want[i].w),
    'the shell knows where the app\'s two keys sit, for the keycaps: ' + JSON.stringify({ caps, want }));
  ok(JSON.stringify(caps.map(c => [c.key, c.label])) === '[["j","Next note"],["/","Search notes"]]', 'keys and labels as the app marked them');
  if (SHOT) {
    await page.evaluate(() => { for (const c of caps()) { const b = document.createElement('b'); b.textContent = c.key.toUpperCase(); b.style.cssText = `position:fixed;left:${c.x - 8}px;top:${c.y - 8}px;background:#fc3;color:#000;font:bold 12px sans-serif;padding:1px 5px;border-radius:4px;z-index:9`; document.body.appendChild(b); } });
    await page.screenshot({ path: SHOT });
    await page.evaluate(() => document.querySelectorAll('body > b').forEach(b => b.remove()));
  }
  // ⌥J typed inside the app (a real click gives the frame focus first).
  await page.mouse.click(360, 220);
  await page.keyboard.press('Alt+KeyJ'); await page.waitForTimeout(250);
  let log = await app().evaluate(() => log.slice()), typed = await app().evaluate(() => typed.slice());
  ok(JSON.stringify(log) === '["next"]', '⌥J typed in the app presses its Next button once: ' + JSON.stringify(log));
  ok(!typed.some(t => t.startsWith('KeyJ')), 'the page never sees ⌥J itself (no stray character, no double action): ' + JSON.stringify(typed));
  // An unmarked ⌥K stays the app's alone.
  await page.keyboard.press('Alt+KeyK'); await page.waitForTimeout(200);
  typed = await app().evaluate(() => typed.slice());
  const got = await page.evaluate(() => shellGot.slice());
  ok(typed.includes('KeyK:mine') && !got.some(g => g.includes('KeyK')), 'an unmarked ⌥K stays the app\'s: ' + JSON.stringify({ typed, got }));
  // ⌥/ typed while the shell has focus: the app's search field takes focus (a field as the target).
  await page.click('#shellBtn');
  await page.keyboard.press('Alt+Slash'); await page.waitForTimeout(250);
  log = await app().evaluate(() => log.slice());
  const active = await app().evaluate(() => document.activeElement?.id);
  ok(log.includes('search-focus') && active === 'q', '⌥/ typed in the shell focuses the app\'s search field: ' + JSON.stringify({ log, active }));
  // A dialog in the app: only its keys count (⌥J is its OK now).
  await app().evaluate(() => { document.getElementById('dlg').hidden = false; });
  await page.waitForFunction(() => window.caps?.().length === 1, null, { timeout: 3000 }).catch(() => {});
  await page.mouse.click(360, 250);
  await page.keyboard.press('Alt+KeyJ'); await page.waitForTimeout(250);
  log = await app().evaluate(() => log.slice());
  ok(log.filter(x => x === 'ok').length === 1 && log.filter(x => x === 'next').length === 1, 'with a dialog open ⌥J presses the dialog\'s OK, not Next: ' + JSON.stringify(log));
  // A reload: the new document reports its keys again on its new channel.
  await page.evaluate(() => { document.querySelector('iframe').src = '/notes/?r=1'; });
  await page.waitForTimeout(400);
  await page.waitForFunction(() => window.caps?.().length === 2, null, { timeout: 4000 }).catch(() => {});
  ok((await page.evaluate(() => window.caps?.().length)) === 2, 'a reloaded app reports its keys again');
  // The view goes (Classic desktop has no app keys): the app keeps ⌥J itself and the shell presses nothing.
  await page.evaluate(() => window.view?.off());
  await page.waitForTimeout(200);
  await page.mouse.click(360, 220);
  await page.keyboard.press('Alt+KeyJ'); await page.waitForTimeout(250);
  log = await app().evaluate(() => log.slice()); typed = await app().evaluate(() => typed.slice());
  ok(log.length === 0 && typed.includes('KeyJ:mine') && (await page.evaluate(() => window.caps?.().length ?? 0)) === 0, 'with no view pressing app keys, ⌥J stays the app\'s: ' + JSON.stringify({ log, typed }));
  ok(!errors.length, 'no page errors ' + (errors.length ? JSON.stringify(errors) : ''));
  await browser.close(); server.close();
  if (process.env.QA_EXPECT === 'broken') {
    console.log(fails.length ? `EXPECTED: ${fails.length} checks fail on this build` : 'UNEXPECTED: every check passed');
    process.exit(fails.length ? 0 : 1);
  }
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
