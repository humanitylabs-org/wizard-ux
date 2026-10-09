// QA: Wizard OS device features (feature/native-parity) in the web shell, with a faked native bridge.
//   #14 orb records through the native foreground-service recorder (WizardOSDevice.recStart/recStop), a take that
//       outlives the page is picked back up, a notification Send / an interrupted take reaches the durable outbox once.
//   #20 a shared item opens the Share sheet, uploads to Wizard Files and starts a new chat with the attachment;
//       Back closes the sheet and the app stays open.
//   #21 every send the outbox delivers is handed to the native reply watcher (watchRun).
//   #22 the native update banner shows/acts; the web hot-reload swaps in new code and keeps chat drafts.
// Usage: QA_WEB_DIR=<worktree> node qa-device.cjs  (self-contained: every request is routed; nothing leaves the box)
// Negative control: QA_WEB_DIR=/home/telos/apps/wizard-os-home node qa-device.cjs must FAIL.
const { chromium } = require('/home/telos/node_modules/playwright');
const fs = require('fs'), path = require('path');
const URL_ = 'https://private.wizard001.com/wizard-os-home/';
const WEB = process.env.QA_WEB_DIR || __dirname;
const SHOTS = process.env.QA_SHOTS || '/home/telos/.hermes/cache/scratch/wizard-audit/shots/native-parity';
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// The fake Wizard: records every write; nothing reaches the real one.
const W = { uploads: [], sessions: new Set(), runs: [], keys: new Map(), transcribes: 0, assetVer: 1, foreign: [] };
async function boot(b, { native = true } = {}) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true, permissions: ['microphone'] });
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url());
    if (u.hostname !== 'private.wizard001.com') { W.foreign.push(u.href); return r.abort(); }
    const m = u.pathname.match(/^\/wizard-os-home\/(.*)$/);
    if (m && (q.method() === 'GET' || q.method() === 'HEAD') && !m[1].startsWith('api/')) {
      const f = m[1] || 'index.html', p = path.join(WEB, 'web', f);
      if (!fs.existsSync(p) || /^(data|summaries)\.js$/.test(f)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      const ct = f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : f.endsWith('.png') ? 'image/png' : f.endsWith('.webmanifest') ? 'application/manifest+json' : 'application/javascript';
      // Each "deploy" bumps the ETag of app.js, the way the static server's Last-Modified changes.
      return r.fulfill({ status: 200, contentType: ct, headers: { etag: `"${f}-${f === 'app.js' ? W.assetVer : 1}"` }, body: fs.readFileSync(p) });
    }
    const json = (o, s = 200) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
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
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });

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
    ok(/Share to Wizard/.test(txt) && /beach\.png/.test(txt) && /notes\.pdf/.test(txt) && /Existing QA thread/.test(txt), 'share sheet lists the items and recent chats', txt.replace(/\s+/g, ' ').slice(0, 200));
    ok(await p.locator('.dv-text').inputValue() === 'Look at this', 'shared text prefilled as the message');
    await shot(p, '20-share-sheet');
    // Back closes it (and drops the share), app stays.
    const did = await p.evaluate(() => window.__wosNativeBack());
    ok(did === 'device-share' && !p.isClosed() && (await dev(p)).calls.includes('shareDone:sh-qa-1'), 'Back closes the share sheet and the app stays open', did);
    ok(W.uploads.length === up0 && W.runs.length === r0, 'cancelled share sends nothing');
    // Again, then send to a new chat.
    await p.evaluate(() => { const S = window.__dev; S.shares['sh-qa-2'] = { meta: { id: 'sh-qa-2', text: 'Look at this', items: [{ n: 0, name: 'beach.png', mime: 'image/png', bytes: 6000 }, { n: 1, name: 'notes.pdf', mime: 'application/pdf', bytes: 4000 }] }, files: [Array.from({ length: 6000 }, (_, i) => i & 255), Array.from({ length: 4000 }, (_, i) => (i * 3) & 255)] }; window.WosDevice.handle({ action: 'share', id: 'sh-qa-2' }); });
    await sleep(500);
    await p.locator('[data-shareto="__new__"]').click(); await sleep(2500);
    const ups = W.uploads.slice(up0);
    ok(ups.length === 2 && ups[0].filename === 'beach.png' && ups[0].mime === 'image/png' && ups[0].bytes === 6000 && ups[1].bytes === 4000, 'both items uploaded to Wizard Files with names, types and exact bytes', JSON.stringify(ups));
    const run = W.runs[W.runs.length - 1];
    ok(W.runs.length === r0 + 1 && run.body.input === 'Look at this' && JSON.stringify(run.body.wizard_file_ids) === JSON.stringify(ups.map(f => f.id)), 'one new-chat run with the message and both attachments', JSON.stringify(run?.body));
    ok(W.sessions.has(run.body.session_id), 'a new Wizard thread was created for it');
    const thread = await p.evaluate(() => Object.values(window.__wos.wins).find(w => w.app === 'chats')?.thread);
    ok(thread === run.body.session_id, 'the new chat is open on screen', thread);
    ok((await dev(p)).calls.includes('shareDone:sh-qa-2'), 'native copy released after send');
    await shot(p, '20-share-sent');
    // Share into an existing thread.
    await p.evaluate(() => { const S = window.__dev; S.shares['sh-qa-3'] = { meta: { id: 'sh-qa-3', text: 'https://example.com/a', items: [] }, files: [] }; window.WosDevice.handle({ action: 'share', id: 'sh-qa-3' }); });
    await sleep(500);
    await p.locator('[data-shareto="qa_old_thread"]').click(); await sleep(2000);
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
