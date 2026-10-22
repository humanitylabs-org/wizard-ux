// QA (send pill): after the orb sends, only a one-line pill shows above the orb, then fades.
// Derived from qa-voice-nodim.cjs. Original header:
// QA: recording and sending never fade or cover the screen. James taps the orb, then keeps
// scrolling and tapping while the take records, transcribes and sends.
// Checks, while listening / paused / sending: the desk and windows keep full opacity and no blur;
// the middle of the screen hit-tests to the app, not the voice layer; a touch scroll moves the
// content; a tap on a thread opens it; and recording carries on through all of it.
// Usage: QA_WEB_DIR=<repo> node qa-voice-nodim.cjs [url]. Every Hermes/Wizard write is intercepted.
const { chromium } = require('./tools/qa-playwright.cjs');
const URL_ = process.argv[2] || (require('./tools/qa-paths.cjs').origin() + '/wizard-os-home/');
const W = process.env.QA_WEB_DIR || __dirname;
const SHOTS = process.env.QA_SHOTS || '';
const LONG = 'Okay so here is a long message for Archimedes about the wizard orb and the multiple threads going on here, please fix the overlay so that after I send it only shows a small confirmation and then disappears';
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };

const THREADS = Array.from({ length: 40 }, (_, i) => ({ id: `qa-${i}`, title: `QA thread ${i + 1}`, source: 'api_server', model: 'qa', message_count: 2, preview: 'Preview line for scrolling', last_active: Date.now() / 1000 - i * 600, started_at: Date.now() / 1000 - i * 600 - 60 }));

async function boot(b) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true, permissions: ['microphone'] });
  const writes = [];
  let slowSend = null;
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url());
    if (!(u.origin === require('./tools/qa-paths.cjs').origin())) return r.abort();
    const m = u.pathname.match(/^\/wizard-os-home\/(.*)$/);
    if (m && q.method() === 'GET' && !m[1].startsWith('api/')) {
      const f = m[1] || 'index.html', p = require('path').join(W, 'web', f);
      if (!require('fs').existsSync(p)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      const ct = f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : f.endsWith('.png') ? 'image/png' : f.endsWith('.webmanifest') ? 'application/manifest+json' : 'application/javascript';
      return r.fulfill({ status: 200, contentType: ct, body: require('fs').readFileSync(p) });
    }
    if (q.method() !== 'GET') writes.push(u.pathname);
    // Authoritative synthetic model and custody receipts required by the current send contract.
    if (/\/hermes\/api\/model\/options$/.test(u.pathname)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ model: 'qa-model', provider: 'qa-provider', providers: [{ slug: 'qa-provider', authenticated: true, is_current: true, models: ['qa-model'] }] }) });
    if (/\/files\/upload$/.test(u.pathname)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ file: { id: 'qa-audio', filename: 'take.webm', mime: 'audio/webm', bytes: 10 } }) });
    if (/\/hermes\/v1\/runs$/.test(u.pathname) && q.method() === 'POST') return r.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ run_id: 'qa-run' }) });
    if (/\/api\/transcribe$/.test(u.pathname)) { await new Promise(res => { slowSend = res; setTimeout(res, 600); }); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: LONG, ms: 300 }) }).catch(() => {}); }
    if (/\/api\/route$/.test(u.pathname)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ms: 5, cmd: { route: 'agent' } }) });
    if (/\/hermes\/api\/sessions$/.test(u.pathname) && q.method() === 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: THREADS, has_more: false }) });
    if (/\/wizard\/thread-seen$/.test(u.pathname)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state: { initializedAt: Date.now(), threads: {} } }) });
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => { if (/wizard-os-home\//.test(String(e.stack || '')) || !/https?:\/\//.test(String(e.stack || ''))) errs.push(String(e)); });
  await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); } catch (e) {} });
  await p.goto('about:blank');
  await p.goto(URL_, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__wos && window.__wos.live && window.__wos.live.ok, null, { timeout: 30000 });
  await p.waitForTimeout(800);
  return { ctx, p, errs, writes };
}
async function tapOrb(p, wait = 1500) { const o = await p.locator('#orbWrap').boundingBox(); await p.touchscreen.tap(o.x + o.width / 2, o.y + o.height / 2); await p.waitForTimeout(wait); }

async function tapOrb(p, wait = 1500) { const o = await p.locator('#orbWrap').boundingBox(); await p.touchscreen.tap(o.x + o.width / 2, o.y + o.height / 2); await p.waitForTimeout(wait); }
const pill = p => p.evaluate(() => { const v = document.querySelector('#voice'), t = document.querySelector('#transcript'), r = t.getBoundingClientRect(), txt = document.querySelector('#txText');
  return { voice: __wos.voice, shown: v.classList.contains('tx') && +getComputedStyle(t).opacity > 0.5, brief: t.classList.contains('brief'), label: document.querySelector('#txRouteText').textContent, h: r.height, w: r.width, textVisible: getComputedStyle(txt).display !== 'none' && txt.getBoundingClientRect().height > 0, toasts: [...document.querySelectorAll('.toast.show')].map(x => x.textContent) }; });
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const { ctx, p, errs, writes } = await boot(b);
  await p.evaluate(() => window.__wos.goDesk(1, true)); await p.waitForTimeout(900);
  await tapOrb(p, 1500);
  let s = await pill(p);
  ok(s.voice === 'listen' && !s.shown, 'recording shows no card (James, 9 Oct: no Listening/tap-to-send card)', JSON.stringify(s));
  await tapOrb(p, 400); // the pill now fades in from nothing (no card while recording)
  s = await pill(p);
  ok(s.brief && s.shown && /Sending/.test(s.label), 'send: one-line "Sending…" pill', JSON.stringify(s));
  ok(!s.textVisible && s.h < 50 && s.w < 300, 'send: no transcript text, pill is small', JSON.stringify(s));
  let seen = null, peak = 0;
  // Current custody flow says "Waiting to send"; only the outbox receipt proves acceptance.
  const AGENT = await p.evaluate(() => window.WizConfig.agent()), SENT = new RegExp('Sent to ' + AGENT);
  for (let k = 0; k < 20; k++) { await p.waitForTimeout(100); const x = await pill(p); if (x.label === 'Waiting to send' && x.shown) { seen = x; } peak = Math.max(peak, x.h); }
  const accepted = await p.evaluate(() => [...WosOutbox._items.values()].some(x => x.state === 'sent' && x.runId === 'qa-run'));
  ok(!!seen && accepted, 'one-line waiting feedback followed by proven sent receipt', JSON.stringify({ seen, accepted }));
  ok(peak < 50 && seen && !seen.textVisible, 'the sent words never cover the screen', String(peak));
  await p.waitForTimeout(1500);
  s = await pill(p);
  ok(!s.shown && s.voice === 'idle', 'pill fades on its own (~1.5 s after send)', JSON.stringify(s));
  ok(!s.toasts.some(t => SENT.test(t)), 'no second "Sent" banner at the top', JSON.stringify(s.toasts));
  // Typed/simulated utterances keep the full card (they show the words as they are typed in).
  await p.evaluate(() => window.__wos.runUtterance && window.__wos.runUtterance('next desk', 'auto', true));
  await p.waitForTimeout(300);
  s = await pill(p);
  ok(!s.brief, 'typed commands keep the normal card', JSON.stringify(s));
  ok(errs.length === 0, 'no page errors', errs.join(' | '));
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
