// QA: the screen stays awake while the orb records, and lets go as soon as it stops.
// Covers both paths: the browser Screen Wake Lock API, and the native shell bridge (WizardOSNative.keepAwake).
// Usage: QA_WEB_DIR=<repo> node qa-awake.cjs [url]. Every Hermes/Wizard write is intercepted.
const QA_ORIGIN = (process.env.WIZARD_QA_ORIGIN || 'https://wizard.example.ts.net').replace(/\/+$/, ''); // the Wizard under test (env; see docs/qa-targets.md)
const QA_HOST = new URL(QA_ORIGIN).hostname;
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/home/telos/node_modules/playwright');
const URL_ = process.argv[2] || QA_ORIGIN + '/wizard-os-home/';

const W = process.env.QA_WEB_DIR || __dirname;
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };

async function boot(b, native) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true, permissions: ['microphone'] });
  const writes = [];
  // Self-contained: the shell comes from the working tree, the Wizard API is faked, nothing leaves the box.
  await ctx.route('**/*', r => {
    const q = r.request(), u = new URL(q.url());
    if (u.hostname !== QA_HOST) return r.abort();
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

(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  /* 1. Browser / PWA: Screen Wake Lock API */
  {
    const { ctx, p, errs } = await boot(b, false);
    let s = await st(p);
    ok(s.voice === 'idle' && s.want === false && s.wl.req === 0, 'idle: no wake lock held', JSON.stringify(s));
    await tapOrb(p); s = await st(p);
    ok(s.voice === 'listen', 'tap orb starts recording', JSON.stringify(s));
    ok(s.want === true && s.wl.req === 1 && s.wl.held, 'recording: screen wake lock requested and held', JSON.stringify(s));
    await p.click('#arcPause'); await p.waitForTimeout(400); s = await st(p);
    ok(s.voice === 'paused' && s.wl.held && s.wl.req === 1, 'paused: still held (no second request)', JSON.stringify(s));
    await p.click('#arcPause'); await p.waitForTimeout(400);
    await p.click('#arcCancel'); await p.waitForTimeout(500); s = await st(p);
    ok(s.voice === 'idle' && s.want === false && !s.wl.held && s.wl.rel === 1, 'cancel: wake lock released', JSON.stringify(s));
    await tapOrb(p); await tapOrb(p); await p.waitForTimeout(2500); s = await st(p);
    ok(s.voice === 'idle' && !s.wl.held && s.wl.req === 2 && s.wl.rel === 2, 'record → send: lock released once the take is handed off', JSON.stringify(s));
    ok(errs.length === 0, 'no page errors (browser)', errs.join(' | '));
    await ctx.close();
  }
  /* 2. Native shell: FLAG_KEEP_SCREEN_ON through WizardOSNative.keepAwake */
  {
    const { ctx, p, errs } = await boot(b, true);
    await tapOrb(p); let s = await st(p);
    ok(s.voice === 'listen' && JSON.stringify(s.nat) === '[true]', 'native: recording asks the shell to keep the screen on', JSON.stringify(s));
    ok(s.wl.req === 0, 'native: browser lock not used alongside the native flag', JSON.stringify(s.wl));
    await p.click('#arcCancel'); await p.waitForTimeout(500); s = await st(p);
    ok(JSON.stringify(s.nat) === '[true,false]', 'native: cancel clears the flag', JSON.stringify(s));
    ok(errs.length === 0, 'no page errors (native)', errs.join(' | '));
    await ctx.close();
  }
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
