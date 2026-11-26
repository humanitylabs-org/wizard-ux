const QA_ROOT = require('node:path').resolve(__dirname, '..'); // repo root (this script lives in qa/scripts/)
// QA (wizard-ux issue 1619, switch wizard/phone-chat-replies): an orb take sent from the phone shell, with a faked
// Android bridge. Switch off: the accepted run goes to the native reply watcher (watchRun), as today. Switch on and the
// phone's per-app reader on (appNotifyOn): it goes to the box (POST /wizard/v1/phone/reply-notes) and watchRun is not
// called; a box that refuses (404, an older Service) keeps watchRun. Derived from qa/scripts/qa-device.cjs.
// Usage: QA_PLAYWRIGHT=<playwright> node tests/qa-phone-chat-replies.cjs   (QA_SHOTS=<dir> for screenshots)
//   #14 orb records through the native foreground-service recorder (WizardOSDevice.recStart/recStop), a take that
//       outlives the page is picked back up, a notification Send / an interrupted take reaches the durable outbox once.
//   #20 a shared item opens the Share sheet, uploads to Wizard Files and starts a new chat with the attachment;
//       Back closes the sheet and the app stays open.
//   #21 every send the outbox delivers is handed to the native reply watcher (watchRun).
//   #22 the native update banner shows/acts; the web hot-reload swaps in new code and keeps chat drafts.
// Usage: QA_WEB_DIR=<worktree> node qa-device.cjs  (self-contained: every request is routed; nothing leaves the box)
// Negative control: set QA_WEB_DIR to the pre-fix daily tree; the new updater assertions must FAIL.
const { chromium } = require('../tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const URL_ = (require('../tools/qa-paths.cjs').origin() + '/wizard-os-home/');
const WEB = process.env.QA_WEB_DIR || QA_ROOT;
const SHOTS = process.env.QA_SHOTS || process.env.QA_OUT || path.join(process.env.TMPDIR || require('os').tmpdir(), 'qa-device');
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// The fake Wizard: records every write; nothing reaches the real one.
const W = { notes: [], notesStatus: 202, uploads: [], sessions: new Set(), runs: [], keys: new Map(), transcribes: 0, assetVer: 1, foreign: [] };
async function boot(b, { native = true, on = false, reader = true } = {}) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true, permissions: ['microphone'] });
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url());
    if (u.hostname !== new URL(require('../tools/qa-paths.cjs').origin()).hostname) { W.foreign.push(u.href); return r.abort(); }
    const m = u.pathname.match(/^\/wizard-os-home\/(.*)$/);
    if (m && (q.method() === 'GET' || q.method() === 'HEAD') && !m[1].startsWith('api/')) {
      const f = m[1] || 'index.html', p = path.join(WEB, 'web', f);
      // Each "deploy" moves the web/ tree id the commit hooks write to ux-version.txt; W.noVersion = an origin without it.
      if (f === 'ux-changes.json') return W.changes ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(W.changes) }) : r.fulfill({ status: 404, body: '' });
      if (f === 'ux-version.txt') return W.noVersion ? r.fulfill({ status: 404, body: '' }) : r.fulfill({ status: 200, contentType: 'text/plain', body: (0xabc0000 + W.assetVer).toString(16) + '\n' });
      if (!fs.existsSync(p) || /^(data|summaries)\.js$/.test(f)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      const ct = f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : f.endsWith('.png') ? 'image/png' : f.endsWith('.webmanifest') ? 'application/manifest+json' : 'application/javascript';
      // Each "deploy" bumps the ETag of app.js, the way the static server's Last-Modified changes.
      // Headers only change through W.lenBump (the Agent Service sends no ETag, only Content-Length).
      const body = fs.readFileSync(p);
      return r.fulfill({ status: 200, contentType: ct, headers: { 'content-length': String(body.length + (f === 'core/chat-kit.js' ? W.lenBump || 0 : 0)) }, body: f === 'core/chat-kit.js' && W.lenBump ? Buffer.concat([body, Buffer.from(' '.repeat(W.lenBump))]) : body });
    }
    const json = (o, s = 200) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname === '/wizard/hermes/api/model/options') return json({model:'fixture-model',provider:'fixture',providers:[{slug:'fixture',name:'Synthetic fixture route',authenticated:true,is_current:true,models:['fixture-model']}]});
    if (u.pathname === '/wizard/v1/phone/reply-notes') { W.notes.push({ method: q.method(), body: JSON.parse(q.postData() || '{}') }); return json(W.notesStatus === 202 ? { ok: true, watching: 1 } : { error: 'not_found' }, W.notesStatus); }
    if (u.pathname.endsWith('/api/transcribe')) { W.transcribes++; return json({ text: 'Native recorder QA take', ms: 4 }); }
    if (u.pathname.endsWith('/api/route')) return json({ cmd: { route: 'agent' }, ms: 2 });
    if (u.pathname === '/wizard/hermes/api/sessions' && q.method() === 'GET') return json({ data: [{ id: 'qa_old_thread', title: 'Existing QA thread', status: 'completed', updated_at: new Date().toISOString() }], has_more: false });
    if (/^\/wizard\/hermes\/api\/sessions\/[^/]+\/messages/.test(u.pathname)) return json({ data: [] });
    if (u.pathname === '/wizard/thread-seen') return json({ state: { initializedAt: Date.now(), threads: {} } });
    if (u.pathname === '/wizard/thread-dispositions') return json({ state: {} });
    if (q.method() === 'GET') return json({});
    if (u.pathname === '/wizard/files/upload') {
      const h = q.headers(), body = q.postDataBuffer() || Buffer.alloc(0);
      const f = { id: 'drop_qa' + (W.uploads.length + 1), filename: h['x-wizard-filename'], mime: h['x-wizard-mime'], bytes: body.length };
      W.uploads.push(f); return json({ file: f }, 201);
    }
    if (u.pathname === '/wizard/hermes/api/sessions') { const id = JSON.parse(q.postData() || '{}').id; if (W.sessions.has(id)) return json({ error: 'exists' }, 409); W.sessions.add(id); return json({ session: { id } }, 201); }
    if (u.pathname === '/wizard/hermes/v1/runs') {
      const key = q.headers()['idempotency-key'], prev = W.keys.get(key);
      if (prev) return json({ run_id: prev.id, status: 'queued' }, 202);
      const run = { id: 'run_qa' + (W.runs.length + 1), key, body: JSON.parse(q.postData() || '{}') }; W.keys.set(key, run); W.runs.push(run);
      return json({ run_id: run.id, status: 'queued' }, 202);
    }
    return json({});
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(({ native, on, reader }) => {
    try { localStorage.setItem('wos.coached', 'true'); } catch (e) {}
    try { localStorage.setItem('wos.skin-tweaks.v1', JSON.stringify({ version: 1, preset: 'none', off: {}, mix: on ? { 'wizard/phone-chat-replies': true, 'wizard/phone-app-notifications': true } : {} })); } catch (e) {}
    if (!native || location.protocol === 'about:') return;
    // A faithful stand-in for the Android WizardOSDevice bridge (same method names and JSON shapes).
    const S = window.__dev = JSON.parse(sessionStorage.getItem('qa.dev') || 'null') || { calls: [], takes: {}, active: null, shares: {}, watch: [], upd: { state: 'idle', installed: '0.5.1' }, notif: { allowed: true, watching: 0 } };
    const persist = () => sessionStorage.setItem('qa.dev', JSON.stringify(S));
    const bytes = n => Array.from({ length: n }, (_, i) => (i * 7) & 255);
    const b64 = a => btoa(String.fromCharCode(...a));
    const call = (...a) => { S.calls.push(a.join(':')); persist(); };
    const chunk = (arr, off) => { if (!arr) return 'null'; const end = Math.min(off + 3000, arr.length); return JSON.stringify({ b64: b64(arr.slice(off, end)), next: end >= arr.length ? -1 : end, size: arr.length }); };
    window.WizardOSNative = { platform: () => 'android:qa', sideButton: () => '{"mic":true,"assistant":true,"used":true,"samsung":false,"step":"done"}', unsent: () => '[]', everywhere: () => '{}', appUnsent() {}, haptic() {}, keepAwake() {} };
    window.WizardOSDevice = {
      version: () => 1,
      recStart(kind) { call('recStart', kind); if (S.active) return S.active; const id = 'rec-qa-' + Date.now(); S.takes[id] = { id, kind, state: 'recording', startedAt: Date.now(), data: bytes(9000) }; S.active = id; persist(); return id; },
      recPause(on) { call('recPause', on); },
      recLevel: () => 35,
      recActive() { return S.active ? JSON.stringify({ id: S.active, ms: Date.now() - S.takes[S.active].startedAt, paused: false, source: 'qa' }) : 'null'; },
      recStop(id) { call('recStop', id); const t = S.takes[id]; if (!t) return 'null'; if (S.active === id) { t.state = 'stopped'; t.ms = Math.max(1500, Date.now() - t.startedAt); S.active = null; } t.claimed = true; persist(); return JSON.stringify({ id, state: t.state, ms: t.ms, kind: t.kind, bytes: t.data.length, mime: 'audio/aac' }); },
      recCancel(id) { call('recCancel', id); delete S.takes[id]; if (S.active === id) S.active = null; persist(); },
      recClaim(id) { call('recClaim', id); const t = S.takes[id]; if (!t) return 'null'; t.claimed = true; persist(); return JSON.stringify({ id, state: t.state, ms: t.ms, kind: t.kind, bytes: t.data.length, mime: 'audio/aac', send: !!t.send }); },
      recRead(id, off) { return chunk(S.takes[id]?.data, off); },
      recDone(id) { call('recDone', id); delete S.takes[id]; persist(); },
      recPending() { return JSON.stringify(Object.values(S.takes).filter(t => t.id !== S.active && !t.claimed).map(t => ({ id: t.id, kind: t.kind, state: t.state === 'recording' ? 'interrupted' : t.state, ms: t.ms || 4000, bytes: t.data.length, send: !!t.send }))); },
      shareMeta(id) { return S.shares[id] ? JSON.stringify(S.shares[id].meta) : 'null'; },
      shareRead(id, n, off) { return chunk(S.shares[id]?.files[n], off); },
      shareDone(id) { call('shareDone', id); delete S.shares[id]; persist(); },
      watchRun(s, r, t) { call('watchRun', s, r); S.watch.push({ s, r, t }); persist(); },
      appNotifyOn() { return reader; },
      replyNotes() { return JSON.stringify(S.notes || []); },
      clearThread(s) { call('clearThread', s); const n0 = (S.notes || []).length; S.notes = (S.notes || []).filter(x => x.s !== s); persist(); return n0 - S.notes.length; },
      notifications() { return JSON.stringify(S.notif); },
      updateCheck() { call('updateCheck'); }, updateInstall() { call('updateInstall'); },
      updateState() { return JSON.stringify(S.upd); },
    };
  }, { native, on, reader }).catch(() => {});
  return { ctx, p, errs };
}
// addInitScript can't take a function argument inside the arg object; seeds are injected as source instead.
async function bootSeeded(b, seedSrc) {
  const r = await boot(b, { native: true });
  await r.p.addInitScript(src => { if (location.protocol === 'about:') return; if (!sessionStorage.getItem('qa.seeded')) { const S = window.__dev; Object.assign(S, (0, eval)(src)(S)); sessionStorage.setItem('qa.dev', JSON.stringify(S)); sessionStorage.setItem('qa.seeded', '1'); } }, seedSrc);
  return r;
}
async function open(p) {
  await p.goto('about:blank');
  await p.goto(URL_, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__wos && window.__wos.live && window.__wos.live.ok && window.WosDevice && window.WosDevice.ready, null, { timeout: 30000 });
  await sleep(600);
}
const dev = p => p.evaluate(() => window.__dev);
const shot = async (p, n) => { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, 'web-' + n + '.png') }); };
async function tapOrb(p) { const o = await p.locator('#orbWrap').boundingBox(); await p.touchscreen.tap(o.x + o.width / 2, o.y + o.height / 2); await sleep(900); }

(async () => {
  const b = await chromium.launch({ executablePath: process.env.QA_CHROME || undefined, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  async function sendTake(opts, name) {
    const { ctx, p, errs } = await boot(b, opts);
    await open(p);
    await p.waitForFunction(() => (document.documentElement.dataset.tweaks || '') !== undefined, null, { timeout: 5000 });
    if (opts.on) await p.waitForFunction(() => (document.documentElement.dataset.tweaks || '').split(' ').includes('wizard/phone-chat-replies'), null, { timeout: 15000 });
    await p.evaluate(() => window.__wos.goDesk(window.__wos.HOME, true)); await sleep(300);
    const runs0 = W.runs.length, notes0 = W.notes.length;
    await tapOrb(p); await sleep(1600); await tapOrb(p); await sleep(3000);
    const d = await dev(p), run = W.runs[W.runs.length - 1];
    ok(W.runs.length === runs0 + 1, name + ': exactly one run created', W.runs.length - runs0);
    await shot(p, name);
    await ctx.close();
    return { d, run, notes: W.notes.slice(notes0), errs };
  }
  {
    const r = await sendTake({ on: false }, 'switch-off');
    ok(r.d.watch.some(w => w.r === r.run?.id), 'switch off: the run is handed to the native reply watcher', JSON.stringify(r.d.watch));
    ok(r.notes.length === 0, 'switch off: nothing is sent to the box', JSON.stringify(r.notes));
    ok(r.errs.length === 0, 'switch off: no page errors', r.errs.join(' | '));
  }
  {
    W.notesStatus = 202;
    const r = await sendTake({ on: true }, 'switch-on');
    ok(r.notes.length === 1 && r.notes[0].method === 'POST' && r.notes[0].body.run === r.run?.id && !!r.notes[0].body.session, 'switch on: the run is handed to the box', JSON.stringify(r.notes));
    ok(!r.d.watch.some(w => w.r === r.run?.id), 'switch on: the native reply watcher is not asked to poll it', JSON.stringify(r.d.watch));
    ok(r.errs.length === 0, 'switch on: no page errors', r.errs.join(' | '));
  }
  {
    W.notesStatus = 404;
    const r = await sendTake({ on: true }, 'switch-on-old-service');
    ok(r.notes.length === 1, 'older Service: the box is asked once', JSON.stringify(r.notes));
    ok(r.d.watch.some(w => w.r === r.run?.id), 'older Service (404): the native reply watcher keeps the run', JSON.stringify(r.d.watch));
  }
  {
    W.notesStatus = 202;
    const r = await sendTake({ on: true, reader: false }, 'switch-on-no-reader');
    ok(r.notes.length === 0 && r.d.watch.some(w => w.r === r.run?.id), 'per-app reader off on the phone: today\'s watcher, nothing to the box', JSON.stringify(r.notes));
  }
  await b.close();
  console.log(`RESULT ${pass} pass / ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
