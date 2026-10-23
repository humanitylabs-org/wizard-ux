// QA: a tap on the orb that starts a reply never opens the Attach file picker.
// James (23 Oct 2026): "A lot of times when I tap the orb to reply to a chat, it's automatically popping up the
// insert attachment screen and I have to hit the back button to cancel."
// Cause: the recording controls fan out from the orb's own centre and take taps the moment recording starts. The
// browser's click for the orb tap arrives after the take has started; on a busy phone it comes later than the old
// 450 ms window, lands on Attach (last in the fan, so on top) and opens the picker. A control now only accepts a
// click whose press also started on it.
// Usage: node qa-orb-tap-no-attach.cjs <qa-origin url>   (QA_PLAYWRIGHT optional). Every write is intercepted.
const { chromium } = require('./tools/qa-playwright.cjs');
const URL_ = process.argv[2] || 'http://127.0.0.1:9381/wizard-os-home/';
const CPU = Number(process.env.QA_CPU || 8);
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function boot(b, layout) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true, permissions: ['microphone'], colorScheme: 'dark', serviceWorkers: 'block' });
  await ctx.route('**/*', r => {
    const q = r.request(), u = q.url();
    if (/\/transcribe$/.test(u) && q.method() === 'POST') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: 'qa reply', ms: 5 }) });
    if (/\/api\/route$|\/wizard\/v1\/route$/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ cmd: { route: 'agent' }, ms: 5 }) });
    if (!['GET', 'HEAD'].includes(q.method())) return r.fulfill({ status: 200, contentType: 'application/json', body: '{"accepted":true}' });
    return r.continue();
  });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => { const st = String(e.stack || ''); if (/wizard-os-home\//.test(st) || !/https?:\/\//.test(st)) errs.push(String(e)); });
  await p.addInitScript(l => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); localStorage.setItem('wos.tour.done', 'true'); if (l) localStorage.setItem('wos.layout', l); } catch (e) {} }, layout || '');
  await p.addInitScript(() => { window.__qaBusy = 0; document.addEventListener('pointerup', () => { if (!window.__qaBusy) return; const t = performance.now(); while (performance.now() - t < window.__qaBusy); }); });
  // Count every file-picker open (the picker is a hidden <input type=file> clicked by the shell).
  await p.addInitScript(() => { window.__qaPick = 0; const c = HTMLInputElement.prototype.click; HTMLInputElement.prototype.click = function () { if (this.type === 'file') { window.__qaPick++; return; } return c.call(this); }; });
  await p.goto(URL_ + (layout ? `?layout=${layout}` : ''), { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__wos && window.__wos.live && window.__wos.live.ok && window.__wos.live.sessions.length > 2, null, { timeout: 60000 });
  await p.waitForTimeout(800);
  return { ctx, p, errs };
}
const voice = p => p.evaluate(() => __wos.voice);

async function cancelTake(p) {
  await p.evaluate(() => document.getElementById('arcCancel').click());
  await p.waitForFunction(() => __wos.voice === 'idle', null, { timeout: 8000 }).catch(() => {});
}

// A busy phone: the work the orb tap starts (recorder, paint, native bridge) holds the main thread past the old
// 450 ms window before the tap's own click is dispatched. Reproduced with a 600 ms busy pointerup listener that
// runs right after the shell's own handler, so the click arrives before the fan has had a frame to move.
async function slowPhoneTap(p, sel, busyMs) {
  const o = await p.locator(sel).boundingBox(); const x = o.x + o.width / 2, y = o.y + o.height / 2;
  await p.evaluate(ms => { window.__qaBusy = ms; }, busyMs);
  const hits = [];
  await p.exposeFunction('__qaHit', h => hits.push(h)).catch(() => {});
  await p.evaluate(() => { if (window.__qaHitHook) return; window.__qaHitHook = 1; document.addEventListener('click', e => window.__qaHit((e.target.closest && e.target.closest('button')?.id) || e.target.id || String(e.target.className)), true); });
  await p.touchscreen.tap(x, y);
  await p.evaluate(() => { window.__qaBusy = 0; });
  await p.waitForFunction(() => __wos.voice === 'listen' || __wos.voice === 'paused', null, { timeout: 8000 }).catch(() => {});
  await sleep(800);
  return hits.join(',');
}

async function scenario(b, name, layout, setup) {
  const { ctx, p, errs } = await boot(b, layout);
  const cdp = await ctx.newCDPSession(p);
  await setup(p);
  // Real touch tap on the orb with a throttled CPU (a mid-range phone). No picker may open.
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  const sel = layout === 'two-orb' ? '#agentOrb' : '#orbWrap';
  for (let i = 0; i < 3; i++) {
    const o = await p.locator(sel).boundingBox();
    await p.touchscreen.tap(o.x + o.width / 2, o.y + o.height / 2);
    await p.waitForFunction(() => __wos.voice === 'listen' || __wos.voice === 'paused', null, { timeout: 10000 }).catch(() => {});
    await sleep(900);
    ok(await voice(p) === 'listen', `${name}: real tap ${i + 1} starts a recording`, await voice(p));
    ok(await p.evaluate(() => window.__qaPick) === 0, `${name}: real tap ${i + 1} opens no file picker`, await p.evaluate(() => window.__qaPick));
    await cancelTake(p);
    await p.evaluate(() => { window.__qaPick = 0; });
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  // The tap's own click arriving late (a busy phone): it lands on a control that fanned out from the orb.
  const hit = await slowPhoneTap(p, sel, 600);
  ok(await p.evaluate(() => window.__qaPick) === 0, `${name}: on a busy phone the orb tap opens no file picker (its click landed on ${hit})`, await p.evaluate(() => window.__qaPick));
  ok(await voice(p) === 'listen', `${name}: on a busy phone the tap still starts the take, never pauses or cancels it`, await voice(p));
  await p.evaluate(() => { window.__qaPick = 0; });
  // A deliberate tap on Attach still opens the picker, and the voice controls still work.
  await sleep(700);
  await p.locator('#arcAttach').tap();
  await sleep(500);
  ok(await p.evaluate(() => window.__qaPick) === 1, `${name}: a real tap on Attach still opens the picker`, await p.evaluate(() => window.__qaPick));
  await p.evaluate(() => { const i = document.querySelector('input[data-voice-files]'); i && i.dispatchEvent(new Event('cancel')); });
  await sleep(400);
  ok(await voice(p) === 'listen', `${name}: closing the picker resumes the take`, await voice(p));
  await p.locator('#arcPause').tap(); await sleep(400);
  ok(await voice(p) === 'paused', `${name}: a real tap on Pause still pauses`, await voice(p));
  await p.locator('#arcCancel').tap(); await sleep(600);
  ok(await voice(p) === 'idle', `${name}: a real tap on Cancel still cancels`, await voice(p));
  ok(errs.length === 0, `${name}: no page errors`, errs.join(' | '));
  await ctx.close();
}

async function openThread(p, full) {
  await p.evaluate(() => __wos.goDesk(1)); await p.waitForTimeout(500);
  const wid = await p.evaluate(() => __wos.desks[1].wins.find(id => __wos.wins[id].app === 'chats'));
  const X = await p.evaluate(() => __wos.live.sessions.filter(s => !s.archived)[0].id);
  await p.evaluate(([w, x]) => { __wos.openChat(w, x); const s = __wos.live.session(x); if (s) Object.assign(s, { status: 'completed', runId: '' }); }, [wid, X]);
  await p.waitForTimeout(600);
  if (full) { await p.evaluate(id => __wos.setFull(id, true), wid); await p.waitForTimeout(900); }
  await p.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  return wid;
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.QA_CHROME || undefined, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  await scenario(b, 'full-screen thread (corner orb)', '', async p => {
    await openThread(p, true);
    ok(await p.evaluate(() => document.querySelector('#device').classList.contains('orb-corner')), 'full-screen thread puts the orb in the corner');
  });
  await scenario(b, 'thread on a desk (dock orb)', '', p => openThread(p, false));
  await scenario(b, 'two-orb layout (agent orb)', 'two-orb', async p => { await openThread(p, false); await p.waitForSelector('#agentOrb:not([hidden])', { timeout: 10000 }).catch(() => {}); });
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
