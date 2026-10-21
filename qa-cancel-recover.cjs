// QA: cancelled-recording recovery (James, 11 Oct 2026: "I accidentally hit the X… I need some option to recover
// what I said… copy it to clipboard"). A take cancelled after ≥15 s is kept; Settings → Cancelled recordings
// lists it; Transcribe & copy puts the words on the clipboard. A short cancel is gone. Back closes Settings and the
// app stays open.
// Usage: QA_WEB_DIR=<worktree> node qa-cancel-recover.cjs   (self-contained: every request is routed)
// Negative control: QA_WEB_DIR=$QA_WEB_DIR node qa-cancel-recover.cjs must FAIL.
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const URL_ = (require('./tools/qa-paths.cjs').origin() + '/wizard-os-home/');
const WEB = process.env.QA_WEB_DIR || __dirname;
const SHOTS = process.env.QA_SHOTS || require('./tools/qa-paths.cjs').workPath('wizard-audit/shots/cancel-recover');
fs.mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const W = { transcribes: 0, sizes: [], runs: 0 };
const SPOKEN = 'This is the long message I almost lost by tapping the X';

async function boot(b, { native = false } = {}) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true, permissions: ['microphone', 'clipboard-read', 'clipboard-write'] });
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url());
    if (u.hostname !== new URL(require('./tools/qa-paths.cjs').origin()).hostname) return r.abort();
    const m = u.pathname.match(/^\/wizard-os-home\/(.*)$/);
    if (m && (q.method() === 'GET' || q.method() === 'HEAD') && !m[1].startsWith('api/')) {
      const f = m[1] || 'index.html', p = path.join(WEB, 'web', f);
      if (f === 'ux-version.txt') return r.fulfill({ status: 200, contentType: 'text/plain', body: 'abc\n' });
      if (!fs.existsSync(p) || /^(data|summaries)\.js$/.test(f)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      const ct = f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : f.endsWith('.png') ? 'image/png' : f.endsWith('.webmanifest') ? 'application/manifest+json' : 'application/javascript';
      return r.fulfill({ status: 200, contentType: ct, body: fs.readFileSync(p) });
    }
    const json = (o, s = 200) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname.endsWith('/api/transcribe')) { W.transcribes++; W.sizes.push((q.postDataBuffer() || Buffer.alloc(0)).length); await sleep(400); return json({ text: SPOKEN, ms: 4 }); }
    if (u.pathname.endsWith('/api/route')) return json({ cmd: { route: 'agent' }, ms: 2 });
    if (u.pathname === '/wizard/hermes/api/sessions' && q.method() === 'GET') return json({ data: [], has_more: false });
    if (/^\/wizard\/hermes\/api\/sessions\/[^/]+\/messages/.test(u.pathname)) return json({ data: [] });
    if (u.pathname === '/wizard/thread-seen') return json({ state: { initializedAt: Date.now(), threads: {} } });
    if (u.pathname === '/wizard/thread-dispositions') return json({ state: {} });
    if (u.pathname === '/wizard/hermes/v1/runs') { W.runs++; return json({ run_id: 'run_x', status: 'queued' }, 202); }
    if (q.method() === 'GET') return json({});
    return json({});
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(({ native }) => {
    try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.tour.v1', 'true'); } catch (e) {}
    if (!native || location.protocol === 'about:') return;
    // Stand-in for the Android bridges (same method names / JSON shapes as DeviceBridge.java).
    const S = window.__dev = JSON.parse(sessionStorage.getItem('qa.dev') || 'null') || { calls: [], takes: {}, active: null, cancelled: [], clip: null };
    const persist = () => sessionStorage.setItem('qa.dev', JSON.stringify(S));
    const bytes = n => Array.from({ length: n }, (_, i) => (i * 7) & 255);
    const b64 = a => btoa(String.fromCharCode(...a));
    const call = (...a) => { S.calls.push(a.join(':')); persist(); };
    const chunk = (arr, off) => { if (!arr) return 'null'; const end = Math.min(off + 3000, arr.length); return JSON.stringify({ b64: b64(arr.slice(off, end)), next: end >= arr.length ? -1 : end, size: arr.length }); };
    window.WizardOSNative = { platform: () => 'android:qa', sideButton: () => '{"mic":true,"assistant":true,"used":true,"samsung":false,"step":"done"}', unsent: () => '[]', everywhere: () => '{}', appUnsent() {}, haptic() {}, keepAwake() {}, appVoice() {} };
    window.WizardOSDevice = {
      version: () => 1,
      recStart(kind) { call('recStart', kind); const id = 'rec-qa-' + Date.now(); S.takes[id] = { id, kind, startedAt: Date.now() - (S.fakeMs || 0) }; S.active = id; persist(); return id; },
      recPause(on) { call('recPause', on); }, recLevel: () => 35,
      recActive() { return S.active ? JSON.stringify({ id: S.active, ms: Date.now() - S.takes[S.active].startedAt, paused: false, source: 'qa' }) : 'null'; },
      // The real RecorderService keeps a cancelled take ≥15 s in files/cancelled (CancelledTakes.keep).
      recCancel(id) { call('recCancel', id); const t = S.takes[id]; if (t) { const ms = Date.now() - t.startedAt; if (ms >= 15000) S.cancelled.unshift({ id: 'c' + Date.now() + '-app', at: Date.now(), ms, source: 'app', mime: 'audio/aac', bytes: 9000 }); } delete S.takes[id]; if (S.active === id) S.active = null; persist(); },
      recStop() { return 'null'; }, recClaim() { return 'null'; }, recRead() { return 'null'; }, recDone() {}, recPending: () => '[]',
      cancelledList() { return JSON.stringify(S.cancelled); },
      cancelledRead(id, off) { return S.cancelled.some(t => t.id === id) ? chunk(bytes(9000), off) : 'null'; },
      cancelledDelete(id) { call('cancelledDelete', id); S.cancelled = S.cancelled.filter(t => t.id !== id); persist(); },
      clip(text) { call('clip'); S.clip = String(text); persist(); return true; },
      shareMeta: () => 'null', watchRun() {}, replyNotes: () => '[]', clearThread: () => 0,
      notifications: () => '{"allowed":true}', updateCheck() {}, updateInstall() {}, updateState: () => '{"state":"idle","installed":"0.9.5"}',
    };
  }, { native }).catch(() => {});
  return { ctx, p, errs };
}
async function open(p) {
  await p.goto(URL_, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__wos && window.__wos.live, null, { timeout: 30000 });
  await sleep(900);
  await p.evaluate(() => { try { window.WosTour?.active && window.WosTour.finish('qa'); } catch (e) {} });
}
const toastText = p => p.evaluate(() => document.querySelector('#toast')?.textContent || '');
const group = p => p.evaluate(() => { const g = document.querySelector('#settingsBody [data-cancelled]'); return g ? { rows: g.querySelectorAll('.cx-row').length, text: g.textContent } : null; });

(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  try {
    /* ---------- 1. browser / PWA: the page records itself ---------- */
    const { ctx, p, errs } = await boot(b);
    await open(p);
    await p.evaluate(() => __wos.openSettings()); await sleep(400);
    let g = await group(p);
    ok(g && g.rows === 0 && /Cancelled recordings/.test(g.text), 'Settings has a Cancelled recordings group (empty to start)', JSON.stringify(g));
    await p.evaluate(() => __wos.closeSheets(true)); await sleep(300);

    // Short take (about 2 s) cancelled → gone.
    await p.evaluate(() => __wos.startVoice('auto')); await sleep(2000);
    await p.evaluate(() => __wos.cancelVoice()); await sleep(800);
    ok(/Discarded/.test(await toastText(p)), 'A short cancel says Discarded', await toastText(p));
    await p.evaluate(() => __wos.openSettings()); await sleep(400);
    g = await group(p);
    ok(g && g.rows === 0, 'A short cancel keeps nothing', JSON.stringify(g));
    await p.evaluate(() => __wos.closeSheets(true)); await sleep(300);

    // Long take: really record ~2.5 s of fake mic, credit 16 s of talking (the timer the user sees), then tap the X.
    await p.evaluate(() => __wos.startVoice('auto')); await sleep(2500);
    await p.evaluate(() => { __wos.V.acc += 16000; });
    await p.click('#arcCancel').catch(async () => p.evaluate(() => __wos.cancelVoice()));
    await sleep(1200);
    const t1 = await toastText(p);
    ok(/kept in Settings/.test(t1), 'A long cancel tells you it was kept', t1);
    ok(await p.evaluate(() => __wos.voice === 'idle'), 'The orb is idle after the cancel (nothing sent)');
    ok(W.runs === 0 && W.transcribes === 0, 'Cancel sent nothing to Wizard', JSON.stringify(W));
    await p.evaluate(() => __wos.openSettings()); await sleep(500);
    g = await group(p);
    ok(g && g.rows === 1 && /0:1[6-9]/.test(g.text) && /Transcribe/.test(g.text), 'Settings lists the cancelled take with its length and Transcribe & copy', JSON.stringify(g));
    await p.screenshot({ path: path.join(SHOTS, '1-settings-kept.png') });

    // Survives a reload (IndexedDB).
    await open(p);
    await p.evaluate(() => __wos.openSettings()); await sleep(500);
    g = await group(p);
    ok(g && g.rows === 1, 'The kept take survives closing and reopening the app', JSON.stringify(g));

    // Transcribe & copy → clipboard has the words, they show (selectable).
    await p.click('#settingsBody [data-cancelled] [data-cx="copy"]');
    await sleep(150);
    ok(/Transcribing/.test((await group(p)).text), 'The button shows Transcribing… while it works');
    await p.waitForFunction(() => /Copy again/.test(document.querySelector('#settingsBody [data-cancelled]')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
    const clip = await p.evaluate(() => navigator.clipboard.readText()).catch(e => 'ERR ' + e);
    ok(clip === SPOKEN, 'Transcribe & copy puts the words on the clipboard', clip);
    ok(W.transcribes === 1 && W.sizes[0] > 2000, 'The real recorded audio went to Wizard Voice', JSON.stringify(W));
    g = await group(p);
    ok(g.text.includes(SPOKEN), 'The words are shown under the take', g.text.slice(0, 200));
    await p.screenshot({ path: path.join(SHOTS, '2-transcribed.png') });
    await p.evaluate(() => navigator.clipboard.writeText('other'));
    await p.click('#settingsBody [data-cancelled] [data-cx="copy"]'); await sleep(500);
    ok(W.transcribes === 1 && (await p.evaluate(() => navigator.clipboard.readText())) === SPOKEN, 'Copy again is instant (no second transcription)');

    // Back closes Settings; the app is still open.
    await p.evaluate(() => history.back()); await sleep(700);
    ok(await p.evaluate(() => !!window.__wos && __wos.sheet !== 'settings'), 'Back closes Settings and Wizard OS stays open', await p.evaluate(() => String(__wos.sheet)));

    // Delete.
    await p.evaluate(() => __wos.openSettings()); await sleep(400);
    await p.click('#settingsBody [data-cancelled] [data-cx="delete"]'); await sleep(500);
    ok((await group(p)).rows === 0, 'Delete removes it');
    ok(errs.length === 0, 'No page errors (browser)', errs.join(' | '));
    await ctx.close();

    /* ---------- 2. Android app: the native recorder keeps it ---------- */
    const n = await boot(b, { native: true });
    await open(n.p);
    await n.p.evaluate(() => { __dev.fakeMs = 0; });
    await n.p.evaluate(() => __wos.startVoice('auto')); await sleep(1500);
    await n.p.evaluate(() => __wos.cancelVoice()); await sleep(600);
    let dev = await n.p.evaluate(() => __dev);
    ok(dev.calls.some(c => c.startsWith('recCancel')) && dev.cancelled.length === 0 && /Discarded/.test(await toastText(n.p)), 'Android: a short cancel is discarded', JSON.stringify(dev.calls));
    // A take that has been going 20 s.
    await n.p.evaluate(() => { __dev.fakeMs = 20000; });
    await n.p.evaluate(() => __wos.startVoice('auto')); await sleep(600);
    await n.p.evaluate(() => { __wos.V.acc = 20000; });
    await n.p.evaluate(() => __wos.cancelVoice()); await sleep(600);
    dev = await n.p.evaluate(() => __dev);
    ok(dev.cancelled.length === 1 && /kept in Settings/.test(await toastText(n.p)), 'Android: a long cancel is kept by the app and the toast says where', JSON.stringify(dev.cancelled) + ' ' + await toastText(n.p));
    // Floating-orb / side-button takes land in the same native list.
    await n.p.evaluate(() => { __dev.cancelled.push({ id: 'c1-everywhere', at: Date.now() - 3600e3, ms: 95000, source: 'everywhere', mime: 'audio/mp4', bytes: 9000 }); sessionStorage.setItem('qa.dev', JSON.stringify(__dev)); });
    await n.p.evaluate(() => __wos.openSettings()); await sleep(400);
    g = await group(n.p);
    ok(g && g.rows === 2 && /Floating orb/.test(g.text) && /1:35/.test(g.text), 'Android: floating-orb and in-app cancels are listed together, newest first', JSON.stringify(g));
    await n.p.click('#settingsBody [data-cancelled] .cx-row:nth-of-type(1) [data-cx="copy"]');
    await n.p.waitForFunction(() => /Copy again/.test(document.querySelector('#settingsBody [data-cancelled]')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
    dev = await n.p.evaluate(() => __dev);
    ok(dev.clip === SPOKEN && dev.calls.includes('clip'), 'Android: the words go to the clipboard through the native bridge', String(dev.clip));
    await n.p.screenshot({ path: path.join(SHOTS, '3-android.png') });
    await n.p.click('#settingsBody [data-cancelled] .cx-row:nth-of-type(1) [data-cx="delete"]'); await sleep(400);
    dev = await n.p.evaluate(() => __dev);
    ok(dev.cancelled.length === 1 && dev.calls.some(c => c.startsWith('cancelledDelete')), 'Android: Delete removes the native file');
    ok(n.errs.length === 0, 'No page errors (Android)', n.errs.join(' | '));
    await n.ctx.close();
  } catch (e) { fail++; console.log('FAIL exception', e.stack || e); }
  await b.close();
  console.log(`${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})();
