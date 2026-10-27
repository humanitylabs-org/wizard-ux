// QA: Wizard OS device features (feature/native-parity) in the web shell, with a faked native bridge.
//   #14 orb records through the native foreground-service recorder (WizardOSDevice.recStart/recStop), a take that
//       outlives the page is picked back up, a notification Send / an interrupted take reaches the durable outbox once.
//   #20 a shared item opens the Share sheet, uploads to Wizard Files and starts a new chat with the attachment;
//       Back closes the sheet and the app stays open.
//   #21 every send the outbox delivers is handed to the native reply watcher (watchRun).
//   #22 the native update banner shows/acts; the web hot-reload swaps in new code and keeps chat drafts.
// Usage: QA_WEB_DIR=<worktree> node qa-device.cjs  (self-contained: every request is routed; nothing leaves the box)
// Negative control: set QA_WEB_DIR to the pre-fix daily tree; the new updater assertions must FAIL.
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const URL_ = (require('./tools/qa-paths.cjs').origin() + '/wizard-os-home/');
const WEB = process.env.QA_WEB_DIR || __dirname;
const SHOTS = process.env.QA_SHOTS || process.env.QA_OUT || path.join(process.env.TMPDIR || require('os').tmpdir(), 'qa-device');
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// The fake Wizard: records every write; nothing reaches the real one.
const W = { uploads: [], sessions: new Set(), runs: [], keys: new Map(), transcribes: 0, assetVer: 1, foreign: [] };
async function boot(b, { native = true } = {}) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true, permissions: ['microphone'] });
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url());
    if (u.hostname !== new URL(require('./tools/qa-paths.cjs').origin()).hostname) { W.foreign.push(u.href); return r.abort(); }
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
  await p.addInitScript(({ native }) => {
    try { localStorage.setItem('wos.coached', 'true'); } catch (e) {}
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
      replyNotes() { return JSON.stringify(S.notes || []); },
      clearThread(s) { call('clearThread', s); const n0 = (S.notes || []).length; S.notes = (S.notes || []).filter(x => x.s !== s); persist(); return n0 - S.notes.length; },
      notifications() { return JSON.stringify(S.notif); },
      updateCheck() { call('updateCheck'); }, updateInstall() { call('updateInstall'); },
      updateState() { return JSON.stringify(S.upd); },
    };
  }, { native }).catch(() => {});
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

  /* ---- #22 deferred update: all routes intercepted, zero agent writes ---- */
  {
    const { ctx, p, errs } = await boot(b);
    await open(p);
    const writes0 = [W.runs.length, W.uploads.length, W.sessions.size, W.transcribes];
    const apkRequests = [], apkNavigations = [], feeds = [];
    // Observe every URL, not just our fixture APK path; only synthetic bytes can be downloaded.
    ctx.on('request', r => {
      if (/\.apk$/i.test(new URL(r.url()).pathname)) {
        apkRequests.push(r.url());
        if (r.isNavigationRequest()) apkNavigations.push(r.url());
      }
    });
    await ctx.route('**/reports/wizard-os/latest.json', r => {
      feeds.push(r.request().url());
      return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({versionCode:99,url:'wizard-os-fixture.apk'})});
    });
    await ctx.route(/\.apk(?:[?#]|$)/i, r => r.fulfill({status:200,contentType:'application/vnd.android.package-archive',headers:{'content-disposition':'attachment; filename="fixture.apk"'},body:'QA fixture only'}));
    const state = reason => p.evaluate(reason => {
      window.__dev.upd = {state:'deferred',version:'0.9.99',versionCode:99,...(reason === null ? {} : {reason})};
      window.WosDevice.event('update', window.__dev.upd);
    }, reason);
    const count = async () => (await dev(p)).calls.filter(c => c === 'updateInstall').length;
    const click = () => p.evaluate(() => document.querySelector('#dvUpdate [data-upd="go"]')?.click());
    await state('music');
    ok(/installs when music stops/.test(await p.locator('#dvUpdate').innerText()) && /Install now/.test(await p.locator('#dvUpdate').innerText()), 'deferred music explains hold and offers Install now');
    let n = await count(); await click();
    ok(await count() === n + 1, 'deferred music Install now calls native updateInstall');
    await sleep(3200); ok(apkRequests.length === 0 && feeds.length === 0, 'reason-aware APK never fetches the feed or opens an APK');
    await state('mic');
    ok(/microphone in use/.test(await p.locator('#dvUpdate').innerText()), 'bare mic is not labelled a recording');
    await p.evaluate(() => window.__wos.openSettings()); await sleep(300);
    n = await count(); await p.evaluate(() => document.querySelector('[data-dvupd]')?.click());
    ok(await count() === n + 1, 'deferred Settings row installs rather than checks');
    await p.evaluate(() => window.__wos.closeSheets());
    await state('take');
    ok(/installs after this recording/.test(await p.locator('#dvUpdate').innerText()), 'take hold text preserved');
    n = await count(); await click();
    ok(await count() === n && /Tap again to stop the recording and update/.test(await p.locator('#dvUpdate').innerText()), 'take first tap arms confirmation without installing');
    await click(); ok(await count() === n + 1, 'take second tap asks native installer (native keeps live-take fence)');
    await click(); await sleep(4200); n = await count(); await click();
    ok(await count() === n, 'take confirmation expires after four seconds');
    await state(null);
    // Old APK: native music is playing but no Wizard take is live. Model its media state without real audio.
    await p.evaluate(() => {
      const music = document.createElement('audio'); music.id = 'qa-playing-music';
      Object.defineProperties(music, { paused: { value: false }, ended: { value: false } });
      document.body.appendChild(music);
    });
    ok(await p.evaluate(() => !document.querySelector('#qa-playing-music').paused && !__dev.active && __wos.voice === 'idle' && !('reason' in __dev.upd)), 'legacy fixture has playing music, no reason and no live take');
    n = await count(); await click();
    ok(await count() === n + 1, 'legacy deferred Install now calls native updateInstall');
    ok(/Installs by itself once music or recording stops/.test(await p.locator('#dvUpdate').innerText()), 'legacy deferred tap explains automatic install after music or recording');
    await shot(p, '22-legacy-deferred');
    await sleep(5500); // Longer than the removed three-second fallback, and the five-second acceptance window.
    ok(apkRequests.length === 0 && apkNavigations.length === 0, 'legacy deferred: zero APK requests or navigations after 5.5 seconds', JSON.stringify({apkRequests, apkNavigations}));
    ok(feeds.length === 0, 'legacy deferred: zero latest.json fetches after 5.5 seconds', JSON.stringify(feeds));
    fs.writeFileSync(path.join(SHOTS, 'update-network.json'), JSON.stringify({web: WEB, waitMs:5500, apkRequests, apkNavigations, feeds}, null, 2));
    // A legacy APK cannot honor the reason-aware stop-and-install confirmation either.
    await p.evaluate(() => {
      __dev.active = 'qa-legacy-take';
      __dev.takes[__dev.active] = {id:__dev.active, state:'recording', startedAt:Date.now(), data:[]};
    });
    n = await count(); await click();
    ok(await count() === n + 1, 'legacy live-take tap still calls native updateInstall');
    ok(await p.evaluate(() => __dev.active === 'qa-legacy-take') && /Installs by itself once music or recording stops/.test(await p.locator('#dvUpdate').innerText()), 'legacy live take stays intact with truthful automatic-install text');
    await p.evaluate(() => {
      __dev.active = null; delete __dev.takes['qa-legacy-take'];
      document.querySelector('#qa-playing-music').remove();
      __dev.upd = {state:'ready',version:'0.9.99',versionCode:99};
      WosDevice.event('update', __dev.upd);
    });
    n = await count(); await p.locator('#dvUpdate .dv-um').click();
    ok(await count() === n + 1, 'ready-state banner tap calls native updateInstall');
    ok(JSON.stringify(writes0) === JSON.stringify([W.runs.length,W.uploads.length,W.sessions.size,W.transcribes]), 'update scenarios produce zero agent writes');
    ok(errs.length === 0, 'no page errors (deferred updater)', errs.join(' | '));
    await shot(p, '22-deferred');
    await ctx.close();
  }
  if (process.env.QA_DEVICE_UPDATES_ONLY) {
    await b.close(); console.log(`RESULT ${pass} pass / ${fail} fail`); process.exit(fail ? 1 : 0);
  }

  /* ---- #14 native recorder: tap → native take → tap → stop, transcribe, one run with the voice note path ---- */
  {
    const { ctx, p, errs } = await boot(b);
    await open(p);
    ok(await p.evaluate(() => typeof window.WosDevice?.handle === 'function'), 'device.js loaded (WosDevice)');
    await p.evaluate(() => window.__wos.goDesk(window.__wos.HOME, true)); await sleep(300);
    const runs0 = W.runs.length, tr0 = W.transcribes;
    await tapOrb(p);
    let d = await dev(p);
    ok(d.calls.some(c => c.startsWith('recStart')) && !!d.active, 'orb tap starts the NATIVE recorder (not getUserMedia)', JSON.stringify(d.calls));
    ok(await p.evaluate(() => window.__wos.voice === 'listen' && !!window.__wos.V.native), 'orb shows listening on a native take');
    await shot(p, '14-native-recording');
    await sleep(1600);
    await tapOrb(p); await sleep(2500);
    d = await dev(p);
    ok(d.calls.some(c => c.startsWith('recStop')), 'second tap stops the native take', JSON.stringify(d.calls));
    ok(W.transcribes === tr0 + 1, 'native audio is transcribed once', W.transcribes - tr0);
    ok(d.calls.some(c => c.startsWith('recDone')) && !Object.keys(d.takes).length, 'take deleted on the phone once it is handled', JSON.stringify(d.takes));
    ok(W.runs.length === runs0 + 1, 'exactly one run created', W.runs.length - runs0);
    ok(d.watch.some(w => w.r === W.runs[W.runs.length - 1]?.id), '#21 the accepted run is handed to the native reply watcher', JSON.stringify(d.watch));
    // Cancel path releases the native take
    await tapOrb(p); await sleep(400); await p.click('#arcCancel'); await sleep(400);
    d = await dev(p);
    ok(d.calls.some(c => c.startsWith('recCancel')) && !d.active, 'Cancel discards the native take');
    // Page reload while a native take keeps running → orb picks it back up; tap sends it.
    await tapOrb(p); await sleep(500);
    const live = (await dev(p)).active;
    await p.reload({ waitUntil: 'load' });
    await p.waitForFunction(() => window.WosDevice && window.WosDevice.ready, null, { timeout: 20000 }); await sleep(900);
    ok(await p.evaluate(id => window.__wos.voice === 'listen' && window.__wos.V.native === id, live), 'a take that outlived the page is resumed after reload', await p.evaluate(() => window.__wos.voice));
    const r1 = W.runs.length;
    await tapOrb(p); await sleep(2500);
    ok(W.runs.length === r1 + 1, 'resumed take sends once', W.runs.length - r1);
    // 0.6.1 rule (daily): Back navigates while recording and never discards; only Cancel does. The native take
    // must survive Back exactly like the in-page one, and the app stays open.
    await tapOrb(p); await sleep(300);
    const liveId = await p.evaluate(() => window.__wos.V.native);
    const did = await p.evaluate(() => window.__wosNativeBack());
    d = await dev(p);
    ok(did !== 'voice' && d.active === liveId && await p.evaluate(() => window.__wos.voice === 'listen') && !p.isClosed(), 'Back while recording navigates, the native take keeps recording, app stays open', `${did} active=${d.active}`);
    await p.evaluate(() => window.__wos.cancelVoice(true)); await sleep(200);
    d = await dev(p);
    ok(!d.active && await p.evaluate(() => window.__wos.voice === 'idle'), 'Cancel (not Back) discards the native take', d.active);
    ok(errs.length === 0, 'no page errors (recorder)', errs.join(' | '));
    await ctx.close();
  }

  /* ---- #14 notification Send while away, and an interrupted take after an app kill ---- */
  {
    const seed = `S => ({ takes: {
      'rec-sent-1': { id: 'rec-sent-1', kind: 'auto', state: 'stopped', send: true, ms: 6000, data: Array.from({ length: 7000 }, (_, i) => i & 255) },
      'rec-kill-1': { id: 'rec-kill-1', kind: 'auto', state: 'recording', ms: 9000, data: Array.from({ length: 8000 }, (_, i) => i & 255) } } })`;
    const { ctx, p, errs } = await bootSeeded(b, seed);
    const r0 = W.runs.length, up0 = W.uploads.length;
    await open(p);
    await sleep(2500);
    let d = await dev(p);
    ok(W.runs.length === r0 + 1, 'notification Send → one run through the outbox, no prompt', W.runs.length - r0);
    ok(W.uploads.slice(up0).some(f => /wizard-voice-.*\.aac$/.test(f.filename) && f.mime === 'audio/aac'), 'the recording rides along as an .aac voice note', JSON.stringify(W.uploads.slice(up0)));
    ok(!d.takes['rec-sent-1'], 'sent take deleted on the phone');
    ok(await p.evaluate(() => window.WosDevice.sheet === 'recording'), 'interrupted take is offered (Recording saved)');
    ok(/Wizard OS closed while you were recording/.test(await p.locator('.dv-sheet').innerText()), 'card explains it was interrupted');
    await shot(p, '14-recovered');
    await p.locator('[data-take="rec-kill-1"] [data-takeact="send"]').click(); await sleep(2500);
    d = await dev(p);
    ok(W.runs.length === r0 + 2 && !d.takes['rec-kill-1'], 'recovered take sends once and is deleted', W.runs.length - r0);
    const body = W.runs[W.runs.length - 1].body;
    ok(/interrupted and recovered/.test(body.instructions || '') && (body.wizard_file_ids || []).length === 1, 'run says it was recovered and carries the voice note', JSON.stringify(body));
    // A reload does not resend anything.
    await p.reload({ waitUntil: 'load' }); await p.waitForFunction(() => window.WosDevice && window.WosDevice.ready); await sleep(2000);
    ok(W.runs.length === r0 + 2, 'no duplicate sends after reload', W.runs.length - r0);
    ok(errs.length === 0, 'no page errors (recovery)', errs.join(' | '));
    await ctx.close();
  }
  /* ---- interrupted take: Delete, and Back closes the card without leaving ---- */
  {
    const seed = `S => ({ takes: { 'rec-kill-2': { id: 'rec-kill-2', kind: 'auto', state: 'recording', ms: 3000, data: Array.from({ length: 5000 }, (_, i) => i & 255) } } })`;
    const { ctx, p } = await bootSeeded(b, seed);
    const r0 = W.runs.length;
    await open(p); await sleep(800);
    ok(await p.evaluate(() => window.WosDevice.sheet === 'recording'), 'card shown for the second interrupted take');
    const did = await p.evaluate(() => window.__wosNativeBack());
    ok(did === 'device-recording' && await p.evaluate(() => window.WosDevice.sheet === null) && !p.isClosed(), 'Back closes the card, app stays open', did);
    await p.reload({ waitUntil: 'load' }); await p.waitForFunction(() => window.WosDevice && window.WosDevice.ready); await sleep(800);
    ok(await p.evaluate(() => window.WosDevice.sheet === 'recording'), 'a dismissed take is still kept and offered again (never lost)');
    await p.locator('[data-takeact="delete"]').click(); await sleep(400);
    ok(!(await dev(p)).takes['rec-kill-2'] && W.runs.length === r0, 'Delete removes it, nothing sent');
    await ctx.close();
  }

  /* ---- #20 share to Wizard ---- */
  {
    const seed = `S => ({ shares: { 'sh-qa-1': { meta: { id: 'sh-qa-1', text: 'Look at this', subject: '', skipped: 0, items: [
        { n: 0, name: 'beach.png', mime: 'image/png', bytes: 6000 }, { n: 1, name: 'notes.pdf', mime: 'application/pdf', bytes: 4000 } ] },
      files: [ Array.from({ length: 6000 }, (_, i) => i & 255), Array.from({ length: 4000 }, (_, i) => (i * 3) & 255) ] } } })`;
    const { ctx, p, errs } = await bootSeeded(b, seed);
    await open(p);
    const r0 = W.runs.length, up0 = W.uploads.length;
    ok(await p.evaluate(() => window.WosDevice.handle({ action: 'share', id: 'sh-qa-1' })), 'share handoff accepted');
    await sleep(600);
    const txt = await p.locator('.dv-sheet').innerText();
    ok(/Share to Wizard/.test(txt) && await p.locator('.dv-items img[alt="beach.png"]').count() === 1 && /notes\.pdf/.test(txt) && /Existing QA thread/.test(txt), 'share sheet lists the items and recent chats', txt.replace(/\s+/g, ' ').slice(0, 200));
    ok(await p.locator('.dv-quote').innerText() === 'Look at this' && await p.locator('.dv-text').inputValue() === '', 'shared text shown as a read-only quote, comment box empty');
    await shot(p, '20-share-sheet');
    // Back closes it (and drops the share), app stays.
    const did = await p.evaluate(() => window.__wosNativeBack());
    ok(did === 'device-share' && !p.isClosed() && (await dev(p)).calls.includes('shareDone:sh-qa-1'), 'Back closes the share sheet and the app stays open', did);
    ok(W.uploads.length === up0 && W.runs.length === r0, 'cancelled share sends nothing');
    // Again, then send to a new chat.
    await p.evaluate(() => { const S = window.__dev; S.shares['sh-qa-2'] = { meta: { id: 'sh-qa-2', text: 'Look at this', items: [{ n: 0, name: 'beach.png', mime: 'image/png', bytes: 6000 }, { n: 1, name: 'notes.pdf', mime: 'application/pdf', bytes: 4000 }] }, files: [Array.from({ length: 6000 }, (_, i) => i & 255), Array.from({ length: 4000 }, (_, i) => (i * 3) & 255)] }; window.WosDevice.handle({ action: 'share', id: 'sh-qa-2' }); });
    await sleep(500);
    await p.locator('[data-sharesend]').click(); await sleep(2500);
    const ups = W.uploads.slice(up0);
    ok(ups.length === 2 && ups[0].filename === 'beach.png' && ups[0].mime === 'image/png' && ups[0].bytes === 6000 && ups[1].bytes === 4000, 'both items uploaded to Wizard Files with names, types and exact bytes', JSON.stringify(ups));
    const run = W.runs[W.runs.length - 1];
    ok(W.runs.length === r0 + 1 && run.body.input === 'Look at this' && JSON.stringify(run.body.wizard_file_ids) === JSON.stringify(ups.map(f => f.id)), 'one new-chat run with the message and both attachments', JSON.stringify(run?.body));
    ok(W.sessions.has(run.body.session_id), 'a new Wizard thread was created for it');
    // Background new threads (daily 0.6.x rule): a new thread never takes focus; the Chats window steps
    // back to its list and the new thread is listed there (Working), ready to open.
    const st = await p.evaluate(sid => { const w = Object.values(window.__wos.wins).find(w => w.app === 'chats'); const el = w && document.querySelector(`.win[data-win="${w.id}"]`); return { thread: w ? w.thread : 'no-window', listed: !!(el && el.querySelector(`[data-chopen="${sid}"]`)), live: !!window.__wos.live.session(sid) }; }, run.body.session_id);
    ok(st.thread == null && st.live && st.listed, 'the new chat starts in the background: Chats shows its list with the new thread in it', st);
    ok((await dev(p)).calls.includes('shareDone:sh-qa-2'), 'native copy released after send');
    await shot(p, '20-share-sent');
    // Share into an existing thread.
    await p.evaluate(() => { const S = window.__dev; S.shares['sh-qa-3'] = { meta: { id: 'sh-qa-3', text: 'https://example.com/a', items: [] }, files: [] }; window.WosDevice.handle({ action: 'share', id: 'sh-qa-3' }); });
    await sleep(500);
    await p.locator('.dv-chat').selectOption('qa_old_thread'); await p.locator('[data-sharesend]').click(); await sleep(2000);
    const run2 = W.runs[W.runs.length - 1];
    ok(run2.body.session_id === 'qa_old_thread' && run2.body.input === 'https://example.com/a', 'text share added to an existing thread', JSON.stringify(run2.body));
    ok(errs.length === 0, 'no page errors (share)', errs.join(' | '));
    await ctx.close();
  }

  /* ---- #22 native update banner ---- */
  {
    const { ctx, p, errs } = await boot(b);
    await open(p);
    ok((await dev(p)).calls.includes('updateCheck') || await p.waitForFunction(() => window.__dev.calls.includes('updateCheck'), null, { timeout: 5000 }).then(() => true, () => false), 'checks for a newer APK on start');
    await p.evaluate(() => window.WosDevice.event('update', { state: 'available', version: '0.9.0', versionCode: 99, installed: '0.5.1' }));
    await sleep(300);
    ok(/Wizard OS 0\.9\.0 is available/.test(await p.locator('#dvUpdate').innerText()), 'banner: newer version available');
    await shot(p, '22-update-banner');
    await p.locator('#dvUpdate [data-upd="go"]').click();
    ok((await dev(p)).calls.includes('updateInstall'), 'Update → native download/verify/install');
    await p.evaluate(() => window.WosDevice.event('update', { state: 'downloading', version: '0.9.0', versionCode: 99, progress: 42 }));
    ok(/42%/.test(await p.locator('#dvUpdate').innerText()), 'download progress shown');
    await p.evaluate(() => window.WosDevice.event('update', { state: 'error', version: '0.9.0', versionCode: 99, message: 'The download isn’t signed by Wizard OS' }));
    ok(/isn’t signed/.test(await p.locator('#dvUpdate').innerText()) && await p.locator('#dvUpdate [data-upd="go"]').innerText() === 'Retry', 'a rejected download says why and offers Retry');
    await p.evaluate(() => window.WosDevice.event('update', { state: 'available', version: '0.9.0', versionCode: 99 }));
    await p.locator('#dvUpdate [data-upd="later"]').click();
    ok(await p.locator('#dvUpdate').isHidden(), '× hides the banner for this version');
    await p.evaluate(() => window.__wos.openSettings()); await sleep(400);
    ok(/Wizard OS 0\.5\.1/.test(await p.locator('#settingsBody').innerText()) && /0\.9\.0 is available/.test(await p.locator('#settingsBody').innerText()), 'Settings shows the version row with the update');
    ok(/Reply notifications/.test(await p.locator('#settingsBody').innerText()), 'Settings shows the reply-notification state');
    await shot(p, '22-settings');
    ok(errs.length === 0, 'no page errors (update)', errs.join(' | '));
    await ctx.close();
  }

  /* ---- #21b reading a thread clears its reply notification, however James got there ---- */
  {
    const { ctx, p, errs } = await boot(b);
    await open(p);
    const now = Date.now();
    // A reply that landed AFTER the app's last look at the thread must survive until it is read;
    // a notification for a thread nobody has opened stays put.
    await p.evaluate(at => { window.__dev.notes = [{ s: 'qa_old_thread', at }, { s: 'qa_unread_thread', at: 1 }]; }, now + 3600e3);
    await p.evaluate(() => window.__wos.openWizardThread('qa_old_thread')); await sleep(900);
    let d = await dev(p);
    ok(!d.calls.includes('clearThread:qa_old_thread'), '#21b a reply newer than the last read is not cleared early', JSON.stringify(d.calls.filter(c => c.startsWith('clear'))));
    await p.evaluate(() => window.__wos.chatsBack?.(Object.values(window.__wos.W || {}).find(w => w.app === 'chats')));
    await p.evaluate(() => window.__wos.goDesk(window.__wos.HOME, true)); await sleep(300);
    // Now the notification is older than the reply; James opens the thread from the list (not the notification).
    await p.evaluate(at => { window.__dev.notes = [{ s: 'qa_old_thread', at }, { s: 'qa_unread_thread', at: 1 }]; }, now - 60e3);
    await p.evaluate(() => window.__wos.openWizardThread('qa_old_thread')); await sleep(900);
    d = await dev(p);
    ok(d.calls.includes('clearThread:qa_old_thread'), '#21b opening the thread in Wizard clears its notification', JSON.stringify(d.calls.filter(c => c.startsWith('clear'))));
    ok(!d.calls.includes('clearThread:qa_unread_thread') && (d.notes || []).some(x => x.s === 'qa_unread_thread'), '#21b other threads keep their notifications', JSON.stringify(d.notes));
    // Read elsewhere (another Wizard surface) then coming back to the app: the resume sweep catches it.
    await p.evaluate(at => { window.__dev.notes = [{ s: 'qa_old_thread', at }]; }, now - 30e3);
    const c0 = (await dev(p)).calls.length;
    await p.evaluate(() => window.dispatchEvent(new Event('wos-native-resume'))); await sleep(400);
    d = await dev(p);
    ok(d.calls.slice(c0).includes('clearThread:qa_old_thread'), '#21b returning to the app sweeps notifications for threads already read', JSON.stringify(d.calls.slice(c0)));
    ok(await p.evaluate(() => window.__wos.voice) === 'idle' && await p.evaluate(() => !document.hidden), 'app still open after the sweeps');
    ok(errs.length === 0, 'no page errors (notification clear)', errs.join(' | '));
    await ctx.close();
  }

  /* ---- #22 web hot-reload keeps drafts ---- */
  {
    const { ctx, p, errs } = await boot(b, { native: false });
    await open(p);
    await p.evaluate(() => window.__wos.openWizardThread('qa_old_thread')); await sleep(800);
    const ta = p.locator('.ch-compose textarea').first();
    await ta.fill('Half-written draft that must survive');
    await sleep(200);
    W.assetVer++;
    await p.evaluate(() => window.WosDevice.checkWeb(true)); await sleep(800);
    ok(await p.locator('#dvWeb').isVisible(), 'new web code detected → "Wizard OS was updated · Reload"');
    await shot(p, '22-web-reload');
    await p.locator('#dvWeb [data-web="go"]').click();
    await p.waitForFunction(() => window.WosDevice && window.WosDevice.ready, null, { timeout: 20000 }); await sleep(1200);
    const after = await p.evaluate(() => document.querySelector('.ch-compose textarea')?.value);
    ok(after === 'Half-written draft that must survive', 'draft is back in the same thread after the reload', after);
    // While recording, no reload happens.
    W.assetVer++;
    await p.evaluate(() => window.WosDevice.checkWeb(true)); await sleep(600);
    await p.evaluate(() => window.__wos.startVoice('auto')); await sleep(400);
    await p.locator('#dvWeb [data-web="go"]').click().catch(() => {}); await sleep(600);
    ok(await p.evaluate(() => window.__wos.voice !== 'idle' && !window.__wosReloading), 'Reload waits while the orb is recording');
    await p.evaluate(() => window.__wos.cancelVoice(true));
    ok(errs.length === 0, 'no page errors (hot reload)', errs.join(' | '));
    await ctx.close();
  }

  /* Shared app native takes are never adopted or sent/deleted by the legacy Wizard voice importer. */
  {
    const { ctx, p, errs } = await boot(b);
    await open(p); const before = W.runs.length;
    await p.evaluate(() => {
      const id = 'rec-app-owned';
      __dev.takes[id] = { id, kind: 'audio', state: 'recording', startedAt: Date.now(), data: Array.from({ length: 5000 }, (_, i) => i & 255) }; __dev.active = id;
      window.WizAppCapture = { getState: () => ({ active: false, recording: false, nativeOwnershipReady: true, nativeDeviceTakeIds: [id] }) };
      dispatchEvent(new Event('wos-native-resume'));
    }); await sleep(300);
    ok(await p.evaluate(() => __wos.voice === 'idle' && !__wos.V.native && __dev.active === 'rec-app-owned'), 'app-owned recovered native take never becomes Wizard voice');
    await p.evaluate(() => __wos.startVoice('auto')); await sleep(100);
    ok(await p.evaluate(() => __wos.voice === 'idle' && __dev.active === 'rec-app-owned'), 'orb cannot reuse another app native recorder');
    await p.evaluate(() => { __dev.active = null; __dev.takes['rec-app-owned'].state = 'stopped'; __dev.takes['rec-app-owned'].send = true; WosDevice.event('rec', { type: 'send', id: 'rec-app-owned' }); }); await sleep(500);
    const owned = await dev(p);
    ok(W.runs.length === before && !!owned.takes['rec-app-owned'] && !owned.calls.some(c => ['recClaim','recDone'].includes(c[0]) && c[1] === 'rec-app-owned'), 'app native notification never posts to Chats or claims/deletes its take');
    await p.evaluate(() => { const id = 'rec-legacy-owner'; __dev.takes[id] = { id, kind: 'auto', state: 'recording', startedAt: Date.now(), data: [1,2,3] }; __dev.active = id; dispatchEvent(new Event('wos-native-resume')); }); await sleep(200);
    ok(await p.evaluate(() => __wos.voice === 'listen' && __wos.V.native === 'rec-legacy-owner'), 'legacy native voice resumes once ownership snapshot is ready');
    await p.evaluate(() => __wos.cancelVoice(true));
    ok(!errs.length, 'no page errors (native ownership broker)', errs.join(' | '));
    await ctx.close();
  }
  /* ---- #22b the prompt follows every deploy, not a hand-kept file list (James, 11 Oct) ---- */
  {
    const { ctx, p, errs } = await boot(b, { native: false });
    await open(p); await sleep(2200); // first check (1.5 s after boot) records the version
    await p.evaluate(() => window.WosDevice.checkWeb(true)); await sleep(500);
    ok(!(await p.locator('#dvWeb').isVisible().catch(() => false)), 'no prompt while nothing changed');
    W.assetVer++; // a deploy that only touched core/chat-kit.js (missing from the old list)
    await p.evaluate(() => window.WosDevice.checkWeb(true)); await sleep(600);
    ok(await p.locator('#dvWeb').isVisible(), 'a deploy that changes any web file raises "Wizard OS was updated · Reload"');
    await p.locator('#dvWeb [data-web="go"]').click();
    await p.waitForFunction(() => window.WosDevice && window.WosDevice.ready, null, { timeout: 20000 }); await sleep(2200);
    ok(await p.evaluate(() => window.__wosReloading === undefined && !document.querySelector('#dvWeb')), 'one tap reloads into the new version, prompt gone');
    // An origin without ux-version.txt still sees a change in a file the page loaded.
    W.noVersion = true;
    await p.reload(); await p.waitForFunction(() => window.WosDevice && window.WosDevice.ready, null, { timeout: 20000 }); await sleep(2200);
    W.lenBump = 3;
    await p.evaluate(() => window.WosDevice.checkWeb(true)); await sleep(800);
    ok(await p.locator('#dvWeb').isVisible(), 'fallback: a change to core/chat-kit.js alone raises the prompt');
    W.noVersion = false; W.lenBump = 0;
    ok(errs.length === 0, 'no page errors (deploy prompt)', errs.join(' | '));
    await ctx.close();
  }

  /* ---- #22c the update banner names the thread it came from and links there (James, 12 Oct) ---- */
  {
    const V = n => (0xabc0000 + n).toString(16);
    const { ctx, p, errs } = await boot(b, { native: false });
    await open(p); await sleep(2200);
    const base = W.assetVer;
    W.changes = { v: 1, head: V(base + 1), updates: [
      { before: V(base), after: V(base + 1), at: Date.now() / 1000, changes: [{ sha: 'aaa1111', what: 'Drop the edge tabs', thread: 'qa_bound_views', title: 'Wizard OS · Bound views' }] },
      { before: V(base - 1), after: V(base), at: Date.now() / 1000 - 3600, changes: [{ sha: 'old0000', what: 'Older change', thread: 'qa_old', title: 'Wizard OS · Old thing' }] },
    ] };
    W.assetVer++;
    await p.evaluate(() => window.WosDevice.checkWeb(true)); await sleep(700);
    const msg = await p.locator('#dvWeb .dv-um').evaluate(e => [...e.children].map(x => x.textContent).join(' / ')).catch(() => '');
    ok(msg === 'Update ready / Bound views', 'banner names the thread the update came from', msg);
    ok(await p.locator('#dvWeb [data-web-thread="qa_bound_views"]').isVisible(), 'a small Thread button sits beside Reload');
    ok(await p.locator('#dvWeb .dv-wtop button').evaluateAll(bs => bs.map(x => x.textContent).join('|')) === 'Thread|Reload', 'order: Thread then Reload');
    const box = await p.locator('#dvWeb').boundingBox();
    ok(box && box.height < 64, 'one thread: banner stays compact', JSON.stringify(box));
    await p.locator('#dvWeb [data-web-thread]').click(); await sleep(600);
    ok(await p.evaluate(() => Object.values(window.__wos.wins).some(w => w.app === 'chats' && w.thread === 'qa_bound_views')), 'Thread opens that thread in Chats');
    ok(await p.locator('#dvWeb').isVisible(), 'the Reload banner stays up after opening the thread');
    await p.screenshot({ path: path.join(SHOTS, 'update-thread-one.png') });
    // A second deploy while the banner is up adds its thread; an older one this page already had is left out.
    W.changes.updates.unshift({ before: V(base + 1), after: V(base + 2), at: Date.now() / 1000, changes: [
      { sha: 'bbb2222', what: 'Selection menu drags out of the way', thread: 'qa_selmenu', title: 'Wizard OS · Selection menu drag' },
      { sha: 'ccc3333', what: 'Tidy whitespace', thread: null, title: null }] });
    W.assetVer++;
    await p.evaluate(() => window.WosDevice.checkWeb(true)); await sleep(700);
    const msg2 = await p.locator('#dvWeb .dv-um').evaluate(e => [...e.children].map(x => x.textContent).join(' / ')).catch(() => '');
    ok(msg2 === 'Update ready / Selection menu drag', 'a second deploy joins the banner (newest first)', msg2);
    ok((await p.locator('#dvWeb [data-web="list"]').textContent()).startsWith('Threads'), 'several threads: a "Threads" button');
    await p.locator('#dvWeb [data-web="list"]').click(); await sleep(300);
    const rows = await p.locator('#dvWeb .dv-wr b').allTextContents();
    ok(rows.join('|') === 'Selection menu drag|Tidy whitespace|Bound views', 'list shows each thread once, older update left out', rows.join('|'));
    ok(await p.locator('#dvWeb .dv-wr.static').count() === 1, 'a change with no thread is listed but not a link');
    await p.screenshot({ path: path.join(SHOTS, 'update-thread-list.png') });
    // Back closes the list and the app stays open (Back never exits).
    const r = await p.evaluate(() => window.WosDevice.back());
    ok(r === 'device-weblist' && await p.locator('#dvWeb .dv-wl').count() === 0 && await p.locator('#dvWeb').isVisible(), 'Back closes the thread list, banner and app stay', String(r));
    await p.locator('#dvWeb [data-web="list"]').click(); await sleep(300);
    await p.locator('#dvWeb [data-web-thread="qa_selmenu"]').click(); await sleep(600);
    ok(await p.evaluate(() => Object.values(window.__wos.wins).some(w => w.app === 'chats' && w.thread === 'qa_selmenu')), 'a row opens its thread');
    ok(await p.locator('#dvWeb .dv-wl').count() === 0, 'list folds away after opening a thread');
    // 360 px: still one tidy row.
    await p.setViewportSize({ width: 360, height: 780 }); await sleep(300);
    const fits = await p.evaluate(() => { const el = document.querySelector('#dvWeb'), r = el.getBoundingClientRect(); return r.right <= innerWidth && [...el.querySelectorAll('.dv-wtop button')].every(b => b.getBoundingClientRect().right <= r.right + 0.5); });
    ok(fits, '360 px: banner and both buttons fit');
    ok(await p.evaluate(() => { const b = document.querySelector('#dvWeb .dv-um b'); return b.scrollWidth <= b.clientWidth + 1 && b.scrollHeight <= b.clientHeight + 1; }), '360 px: the thread name is shown whole (wraps, not cut off)');
    await p.screenshot({ path: path.join(SHOTS, 'update-thread-360.png') });
    await p.locator('#dvWeb [data-web="go"]').click();
    await p.waitForFunction(() => window.WosDevice && window.WosDevice.ready, null, { timeout: 20000 }); await sleep(2200);
    ok(await p.evaluate(() => !document.querySelector('#dvWeb')), 'Reload still reloads');
    W.changes = null;
    ok(errs.length === 0, 'no page errors (update thread link)', errs.join(' | '));
    await ctx.close();
  }

  /* ---- browser/PWA: no native bridge → in-page recorder, nothing breaks ---- */
  {
    const { ctx, p, errs } = await boot(b, { native: false });
    await open(p);
    await p.evaluate(() => window.__wos.goDesk(window.__wos.HOME, true));
    await tapOrb(p);
    ok(await p.evaluate(() => window.__wos.voice === 'listen' && !window.__wos.V.native), 'browser: orb still records in-page (MediaRecorder)');
    await p.click('#arcCancel');
    ok(await p.locator('#dvUpdate').count() === 0, 'browser: no APK banner');
    ok(errs.length === 0, 'no page errors (browser)', errs.join(' | '));
    await ctx.close();
  }

  ok(W.foreign.length === 0, 'no request left the fake origin', W.foreign.slice(0, 3).join(' '));
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); console.log(`\n${pass} passed, ${fail + 1} failed`); process.exit(2); });
