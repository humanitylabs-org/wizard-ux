// QA (James, 20 Oct 2026): pause the orb, then tap the orb -> it RESUMES recording and sends nothing.
// The next tap (while recording) sends. Also: Pause button still toggles, the paused pill says 'tap orb to resume'.
// Usage: QA_WEB_DIR=<repo> node qa-orb-tap-resume.cjs [url]. Every Hermes/Wizard write is intercepted.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/home/telos/node_modules/playwright');
const URL_ = process.argv[2] || 'https://wizard.tailc0f369.ts.net/wizard-os-home/';

const W = process.env.QA_WEB_DIR || __dirname;
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };

async function boot(b, native) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true, permissions: ['microphone'] });
  const writes = [];
  // Self-contained: the shell comes from the working tree, the Wizard API is faked, nothing leaves the box.
  await ctx.route('**/*', r => {
    const q = r.request(), u = new URL(q.url());
    if (!/wizard\.tailc0f369\.ts\.net$/.test(u.hostname)) return r.abort();
    const m = u.pathname.match(/^\/wizard-os-home\/(.*)$/);
    if (m && q.method() === 'GET' && !m[1].startsWith('api/')) {
      const f = m[1] || 'index.html', p = require('path').join(W, 'web', f);
      if (!require('fs').existsSync(p)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: /^(data|summaries)\.js$/.test(f) ? '' : '' });
      const ct = f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : f.endsWith('.png') ? 'image/png' : f.endsWith('.webmanifest') ? 'application/manifest+json' : 'application/javascript';
      return r.fulfill({ status: 200, contentType: ct, body: require('fs').readFileSync(p) });
    }
    if (q.method() !== 'GET') writes.push(u.pathname);
    if (/\/api\/transcribe$/.test(u.pathname)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: 'zoom in' }) });
    if (/\/api\/route$/.test(u.pathname)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ kind: 'command', action: 'noop' }) });
    if (/\/hermes\/api\/sessions$/.test(u.pathname) && q.method() === 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], has_more: false }) });
    if (/\/wizard\/thread-seen$/.test(u.pathname)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state: { initializedAt: Date.now(), threads: {} } }) });
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => { if (/wizard-os-home\//.test(String(e.stack || '')) || !/https?:\/\//.test(String(e.stack || ''))) errs.push(String(e)); });
  await p.addInitScript(native => {
    try { localStorage.setItem('wos.coached', 'true'); } catch (e) {}
    // Count wake-lock requests/releases the page makes through the browser API.
    window.__qaWL = { req: 0, rel: 0, held: false };
    if (navigator.wakeLock) {
      const orig = navigator.wakeLock.request.bind(navigator.wakeLock);
      navigator.wakeLock.request = async t => { const l = await orig(t).catch(() => { const et = new EventTarget(); et.release = async () => {}; return et; });
        __qaWL.req++; __qaWL.held = true; const r = l.release.bind(l); l.release = async () => { __qaWL.rel++; __qaWL.held = false; return r(); }; return l; };
    }
    if (native) {
      window.__qaNative = [];
      window.WizardOSNative = { platform: () => 'android:qa', sideButton: () => '{"mic":true,"assistant":true,"used":true,"samsung":false,"step":"done"}', unsent: () => '[]', everywhere: () => '{}', appUnsent() {}, haptic() {}, keepAwake: on => window.__qaNative.push(!!on) };
    }
  }, native);
  await p.goto('about:blank');
  await p.goto(URL_, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__wos && window.__wos.live && window.__wos.live.ok, null, { timeout: 30000 });
  await p.waitForTimeout(800);
  await p.evaluate(() => window.__wos.goDesk(2, true)); await p.waitForTimeout(600);
  return { ctx, p, errs, writes };
}
async function tapOrb(p) { const o = await p.locator('#orbWrap').boundingBox(); await p.touchscreen.tap(o.x + o.width / 2, o.y + o.height / 2); await p.waitForTimeout(1500); }
const st = p => p.evaluate(() => ({ voice: __wos.voice, want: window.__wosAwake && window.__wosAwake(), wl: window.__qaWL, nat: window.__qaNative || null }));


const sends = w => w.filter(u => /transcribe|\/route$|\/runs|\/sessions|\/uploads?\b|\/drops|outbox/.test(u));
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  for (const native of [false]) {
    const { ctx, p, errs, writes } = await boot(b, native);
    await tapOrb(p); let s = await st(p);
    ok(s.voice === 'listen', 'tap orb starts recording', JSON.stringify(s));
    await p.click('#arcPause'); await p.waitForTimeout(400); s = await st(p);
    ok(s.voice === 'paused', 'Pause pauses the take', JSON.stringify(s));
    const pill = await p.evaluate(() => (document.querySelector('#txRouteText')?.textContent || '') + ' ' + document.body.innerText.slice(0, 0));
    const before = sends(writes).length;
    await tapOrb(p); s = await st(p);
    ok(s.voice === 'listen', 'tap orb while paused RESUMES recording', JSON.stringify(s));
    ok(sends(writes).length === before, 'tap orb while paused sends nothing', JSON.stringify(sends(writes)));
    // pause again via Pause, resume via Pause: the button path still works
    await p.click('#arcPause'); await p.waitForTimeout(300); s = await st(p);
    ok(s.voice === 'paused', 'Pause again', JSON.stringify(s));
    await p.click('#arcPause'); await p.waitForTimeout(300); s = await st(p);
    ok(s.voice === 'listen', 'Pause button still resumes', JSON.stringify(s));
    // second pause + orb tap twice: resume, then send
    await p.click('#arcPause'); await p.waitForTimeout(300);
    await tapOrb(p); s = await st(p);
    ok(s.voice === 'listen' && sends(writes).length === before, 'second pause → orb tap resumes again, still nothing sent', JSON.stringify(s));
    // Give the general take a model route (the faked API has no catalogue), as qa-orb-send-instant does per thread.
    await p.evaluate(() => { const o = WosModels.snapshot.bind(WosModels); WosModels.snapshot = (...a) => { const r = o(...a); return (r && r.model && r.provider) ? r : { ...(r || {}), model: 'qa-model', provider: 'qa-provider', version: 0 }; }; });
    await tapOrb(p); await p.waitForTimeout(2500); s = await st(p);
    ok(s.voice !== 'listen' && s.voice !== 'paused', 'tap orb while recording sends the take', JSON.stringify(s));
    ok(sends(writes).length > before, 'the send reached the transcribe/route path', JSON.stringify(writes.slice(-6)));
    // aria/pill copy no longer promises a send on a paused take
    const copy = await p.evaluate(() => /tap orb to send/.test(document.documentElement.outerHTML));
    ok(!copy, "no 'tap orb to send' copy left on a paused take");
    ok(errs.length === 0, 'no page errors', errs.join(' | '));
    await ctx.close();
  }
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
