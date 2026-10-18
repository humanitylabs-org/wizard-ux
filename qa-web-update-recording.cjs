// QA: "Update ready · Reload" during a Mizel.ai recording (James, 18 Oct: "every time I try to reload it says
// please finish the recording first. Is there any way to make Mizel.ai persist through reloads?").
//   A. Phone shell + the Android meeting recorder (window.wizardMizelPort, modelled on MizelProtocol): Reload goes
//      through at once (after the typed notes save), the native recorder never stops or restarts, Mizel comes back
//      on the same meeting with the right clock, live words resume, notes kept, no second meeting, no web chunk
//      uploads, contiguous native chunks, and Stop after the reload saves. Back keeps the app open.
//   B. Same, but an orb microphone loan is in progress: Reload is refused and never armed.
//   C. Browser (in-page) recorder: Reload becomes "Reload when recording ends"; a second tap cancels; after Stop
//      and save the reload happens exactly once.
// Self-contained: every request is routed; no real Wizard, Mizel, provider or microphone is touched.
// Usage: QA_WEB_DIR=<wizard-ux worktree> MIZEL_WEB=<mizel-live web dir> node qa-web-update-recording.cjs
// Negative control: QA_WEB_DIR=<daily checkout> must FAIL phase A (Reload is refused while recording).
const { chromium } = require(process.env.PW || '/home/telos/node_modules/playwright');
const fs = require('fs'), path = require('path');
const ORIGIN = 'https://wizard.tailc0f369.ts.net', BASE = ORIGIN + '/wizard-os-home/';
const WEB = path.join(process.env.QA_WEB_DIR || __dirname, 'web');
const MIZEL = process.env.MIZEL_WEB;
const OUT = process.env.QA_OUT || path.join(process.env.TMPDIR || '/tmp', 'qa-web-update-recording');
fs.mkdirSync(OUT, { recursive: true });
if (!MIZEL || !fs.existsSync(path.join(MIZEL, 'app.js'))) { console.error('MIZEL_WEB must point at the mizel-live web/ directory'); process.exit(2); }
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 15000, step = 200) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return true; } catch (_) {} await sleep(step); } return false; };
const CT = f => f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : f.endsWith('.svg') ? 'image/svg+xml' : f.endsWith('.png') ? 'image/png' : f.endsWith('.webmanifest') ? 'application/manifest+json' : f.endsWith('.json') ? 'application/json' : 'application/javascript';

/* ---------- the fake Mizel meeting service (one per phase) ---------- */
function mizelServer() {
  const S = { meetings: new Map(), creates: 0, webChunks: [], nativeChunks: [], stops: [], notesPuts: 0, n: 0 };
  S.meeting = id => S.meetings.get(id);
  S.view = m => ({ ...m, audio: { tracks: [{ source: 'me', chunks: m.chunks.length }] }, segments: m.segments.slice() });
  S.handle = (q, u) => {
    const p = u.pathname.replace(/^\/mizel-live\//, ''), method = q.method();
    const json = (o, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(o) });
    if (p === 'orb-events') return json({ events: [] });
    if (p === 'api/meetings' && method === 'GET') return json({ meetings: [...S.meetings.values()].map(S.view) });
    if (p === 'api/calendar') return json({ events: [] });
    if (p === 'api/meetings' && method === 'POST') {
      S.creates++; const id = 'qa-meet-' + (++S.n);
      S.meetings.set(id, { id, source: 'meetings', title: '', status: 'ready', started_at: new Date().toISOString(), duration_ms: 0, notes: '', notes_rev: 0, segments: [], chunks: [], jobs: {}, asks: [] });
      return json(S.view(S.meetings.get(id)), 201);
    }
    let m = p.match(/^api\/meetings\/([^/]+)(?:\/(.*))?$/);
    if (m) {
      const mt = S.meeting(decodeURIComponent(m[1])), sub = m[2] || '';
      if (!mt) return json({ error: 'not_found' }, 404);
      if (!sub && method === 'GET') return json(S.view(mt));
      if (!sub && method === 'PATCH') { Object.assign(mt, JSON.parse(q.postData() || '{}')); return json(S.view(mt)); }
      if (sub === 'notes' && method === 'PUT') {
        S.notesPuts++; const b = JSON.parse(q.postData() || '{}');
        if ((b.base_rev || 0) !== mt.notes_rev) return json({ error: 'conflict', notes: mt.notes, notes_rev: mt.notes_rev }, 409);
        mt.notes = b.notes; mt.notes_rev++; return json({ notes_rev: mt.notes_rev });
      }
      if (sub === 'segments') { const after = u.searchParams.get('after'); const i = after ? mt.segments.findIndex(s => s.id === after) + 1 : 0; return json({ segments: mt.segments.slice(i), transcribe_pending: 0 }); }
      if (sub === 'chunks' && method === 'POST') {
        S.webChunks.push({ id: mt.id, source: u.searchParams.get('source'), seq: Number(u.searchParams.get('seq')), bytes: (q.postDataBuffer() || Buffer.alloc(0)).length });
        mt.status = 'recording'; return json({ stored: true });
      }
      if (sub === 'stop' && method === 'POST') { S.stops.push({ id: mt.id, by: 'web', body: q.postData() || '' }); mt.status = 'ready'; return json(S.view(mt)); }
      return json({ asks: [], events: [], segments: [] });
    }
    return json({ meetings: [], events: [], asks: [], segments: [], pending: 0 });
  };
  return S;
}

/* ---------- the Android meeting recorder, modelled on MizelProtocol/MizelBridge (survives page reloads) ---------- */
function nativeRecorder(S) {
  const N = { recording: false, paused: false, meetingId: null, mediaMs: 0, startCmds: 0, starts: 0, stops: 0, log: [], ports: new Map(), timer: null, last: 0 };
  const state = () => ({ recording: N.recording, paused: N.paused, meetingId: N.meetingId, mediaMs: Math.round(N.mediaMs), pendingChunks: 0, pausedMs: 0, phase: N.recording ? 'recording' : 'idle', pauseTimeoutMs: 1800000, livePcm: true });
  const push = obj => { const s = JSON.stringify(obj); for (const pt of N.ports.values()) { pt.q.push(s); if (pt.q.length > 400) pt.q.splice(0, 100); } };
  const upload = (final = false) => { // native uploader: one 5 s chunk per boundary, final partial on stop
    const mt = S.meeting(N.meetingId); if (!mt) return;
    const want = final ? Math.ceil(N.mediaMs / 5000) : Math.floor(N.mediaMs / 5000);
    while (mt.chunks.length < want) {
      const seq = mt.chunks.length; mt.chunks.push(seq); S.nativeChunks.push({ id: mt.id, source: 'me', seq });
      if (seq % 2 === 1) mt.segments.push({ id: 'seg-' + seq, source: 'me', start_ms: (seq - 1) * 5000, end_ms: (seq + 1) * 5000, text: 'Locked transcript ' + seq });
      mt.duration_ms = N.mediaMs;
    }
  };
  N.tick = () => {
    const now = Date.now(), dt = N.last ? now - N.last : 0; N.last = now;
    for (const [pid, pt] of N.ports) if (now - pt.seen > 4000) N.ports.delete(pid); // its page is gone
    if (!N.recording || N.paused) return;
    const at = N.mediaMs; N.mediaMs += dt; upload();
    const pcm = Buffer.alloc(Math.min(8000, Math.max(2, Math.round(dt * 32) & ~1)));
    for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(Math.round(Math.sin((at * 16 + i / 2) / 6) * 3000), i);
    const frame = JSON.stringify({ type: 'pcm', meetingId: N.meetingId, startMs: Math.round(at), pcm: pcm.toString('base64') });
    for (const pt of N.ports.values()) if (pt.pcm === N.meetingId) pt.q.push(frame);
    push({ type: 'level', me: 0.4 });
    if (Math.floor(N.mediaMs / 1000) !== Math.floor(at / 1000)) push({ type: 'state', ...state() });
  };
  N.command = (pid, raw) => {
    const pt = N.ports.get(pid) || { q: [], pcm: null, seen: Date.now() }; pt.seen = Date.now(); N.ports.set(pid, pt);
    let c; try { c = JSON.parse(raw); } catch (_) { return [JSON.stringify({ id: null, ok: false, error: 'bad_request' })]; }
    const reply = (okay, error) => [JSON.stringify({ id: c.id, ok: okay, ...(error ? { error } : {}), status: state() })];
    N.log.push(c.cmd);
    if (c.cmd === 'status') return reply(true);
    if (c.cmd === 'start') {
      N.startCmds++;
      if (N.recording && N.meetingId !== c.meetingId) return reply(false, 'busy_other_meeting');
      if (!N.recording) { N.recording = true; N.paused = false; N.meetingId = c.meetingId; N.mediaMs = 0; N.last = Date.now(); N.starts++; const mt = S.meeting(c.meetingId); if (mt) mt.status = 'recording'; push({ type: 'state', ...state() }); }
      return reply(true);
    }
    if (c.cmd === 'pcm') { if (c.enabled && (!N.recording || N.meetingId !== c.meetingId)) return reply(false, 'wrong_meeting'); pt.pcm = c.enabled ? c.meetingId : null; return reply(true); }
    if (c.cmd === 'pause' || c.cmd === 'resume') { if (!N.recording) return reply(false, 'not_recording'); N.paused = c.cmd === 'pause'; push({ type: 'state', ...state() }); return reply(true); }
    if (c.cmd === 'stop') {
      if (!N.recording) return reply(false, 'not_recording');
      N.tick(); upload(true); N.recording = false; N.stops++;
      const mt = S.meeting(N.meetingId); if (mt) { mt.status = 'ready'; S.stops.push({ id: mt.id, by: 'native', final_seq: { me: mt.chunks.length - 1 } }); }
      for (const p2 of N.ports.values()) p2.pcm = null;
      push({ type: 'state', ...state() }); return reply(true);
    }
    return reply(false, 'unknown_cmd');
  };
  N.poll = pid => { const pt = N.ports.get(pid); if (!pt) return []; pt.seen = Date.now(); return pt.q.splice(0); };
  N.start = () => { N.timer = setInterval(N.tick, 250); };
  N.close = () => clearInterval(N.timer);
  return N;
}
// Installed in every same-origin frame, like the AndroidX web message listener (one port object per frame).
const PORT_SCRIPT = () => {
  if (!/^\/(wizard-os-home|mizel-live)\//.test(location.pathname)) return;
  const pid = Math.random().toString(36).slice(2), deliver = list => { for (const d of list || []) { try { port.onmessage?.({ data: d }); } catch (e) { console.error(e); } } };
  const port = { onmessage: null, postMessage(data) { window.__qaPort(pid, String(data)).then(deliver).catch(() => {}); } };
  Object.defineProperty(window, 'wizardMizelPort', { value: port, configurable: false });
  setInterval(() => window.__qaPortPoll(pid).then(deliver).catch(() => {}), 150);
};

async function phase(b, { native, label }) {
  const S = mizelServer(), N = native ? nativeRecorder(S) : null, V = { ver: 1 }, live = [];
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true, permissions: ['microphone'], serviceWorkers: 'block',
    userAgent: 'Mozilla/5.0 (Linux; Android 15; SM-S938B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36' });
  const foreign = [], writes = [];
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url());
    if (u.origin !== ORIGIN) { foreign.push(u.href); return r.abort(); }
    if (u.pathname.startsWith('/mizel-live/') && (u.pathname.startsWith('/mizel-live/api/') || u.pathname === '/mizel-live/orb-events')) return r.fulfill(S.handle(q, u));
    const file = (root, rel) => { const f = path.join(root, rel || 'index.html'); return f.startsWith(root) && fs.existsSync(f) && fs.statSync(f).isFile() ? f : null; };
    if (u.pathname.startsWith('/mizel-live/')) { const f = file(MIZEL, u.pathname.slice('/mizel-live/'.length)); return f ? r.fulfill({ status: 200, contentType: CT(f), body: fs.readFileSync(f) }) : r.fulfill({ status: 404, body: '' }); }
    const m = u.pathname.match(/^\/wizard-os-home\/(.*)$/);
    if (m && ['GET', 'HEAD'].includes(q.method()) && !m[1].startsWith('api/')) {
      if (m[1] === 'ux-version.txt') return r.fulfill({ status: 200, contentType: 'text/plain', body: (0xabc0000 + V.ver).toString(16) + '\n' });
      if (m[1] === 'ux-changes.json') return r.fulfill({ status: 404, body: '' });
      const f = file(WEB, m[1]); if (!f || /^(data|summaries)\.js$/.test(m[1])) return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      return r.fulfill({ status: 200, contentType: CT(f), body: fs.readFileSync(f) });
    }
    const json = (o, s = 200) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname === '/wizard/v1/bootstrap') return json({ bootstrap: 1, settings: { agent: { name: 'QA Agent' } }, capabilities: {}, endpoints: { apps: '/wizard/v1/apps', sessions: '/wizard/hermes/api/sessions', runs: '/wizard/hermes/v1/runs' } });
    if (u.pathname === '/wizard/v1/apps') return json({ schema: 1, apps: [{ id: 'mizel', name: 'Mizel.ai', desc: 'Record, transcribe, outline', url: '/mizel-live/#/', icon: '◉', colors: ['#3fe0ff', '#2f8cff'], source: 'launcher.json' }] });
    if (u.pathname === '/wizard/hermes/api/model/options') return json({ model: 'fixture-model', provider: 'fixture', providers: [{ slug: 'fixture', name: 'Synthetic fixture route', authenticated: true, is_current: true, models: ['fixture-model'] }] });
    if (u.pathname === '/wizard/hermes/api/sessions' && q.method() === 'GET') return json({ data: [], has_more: false });
    if (u.pathname === '/wizard/thread-seen') return json({ state: { initializedAt: Date.now(), threads: {} } });
    if (u.pathname === '/wizard/thread-dispositions') return json({ state: {} });
    if (q.method() !== 'GET' && q.method() !== 'HEAD') writes.push(q.method() + ' ' + u.pathname);
    return json({});
  });
  await ctx.routeWebSocket(/\/mizel-live\/live/, ws => { // live words: the realtime transcriber, faked
    const s = { meetingId: null, bytes: 0, frames: 0, at: Date.now() }; live.push(s);
    ws.onMessage(msg => {
      if (typeof msg !== 'string') { s.bytes += msg.length; if (++s.frames % 3 === 0) ws.send(JSON.stringify({ type: 'words', partial: 'QA live words ' + s.frames, startMs: 0 })); return; }
      let m; try { m = JSON.parse(msg); } catch (_) { return; }
      if (m.type === 'start') { s.meetingId = m.meetingId; s.baseMs = m.baseMs; s.follow = m.follow; ws.send(JSON.stringify({ type: 'ready', threadId: null, asks: [] })); ws.send(JSON.stringify({ type: 'status', live: true })); }
    });
  });
  if (N) {
    await ctx.exposeBinding('__qaPort', (_src, pid, data) => N.command(pid, data));
    await ctx.exposeBinding('__qaPortPoll', (_src, pid) => N.poll(pid));
    await ctx.addInitScript(PORT_SCRIPT); N.start();
  }
  await ctx.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('meetings.systemAudio', '0'); } catch (_) {} });
  const p = await ctx.newPage(), errs = [];
  let navs = 0; p.on('framenavigated', f => { if (f === p.mainFrame()) navs++; });
  p.on('pageerror', e => errs.push(String(e)));
  return { S, N, V, live, ctx, p, errs, foreign, writes, navs: () => navs, label };
}
const mizel = p => p.frames().find(f => /\/mizel-live\//.test(f.url()));
async function bootShell(P) {
  await P.p.goto(BASE + '?shell=phone', { waitUntil: 'domcontentloaded' });
  await P.p.waitForFunction(() => window.WosDevice && window.WosDevice.ready && window.__wos, null, { timeout: 30000 });
  await P.p.evaluate(() => { try { window.WosTour?.finish?.(); } catch (_) {} });
  await sleep(2000); // the first check records the loaded version
}
async function openMizel(P) {
  await until(() => P.p.evaluate(() => window.WizOpenApp?.('mizel') !== false && [...document.querySelectorAll('iframe')].some(f => /mizel-live/.test(f.src))), 20000, 500);
  const ok1 = await until(async () => { const f = mizel(P.p); return f && await f.evaluate(() => !!document.querySelector('#app') && !!window.WizardApp); }, 20000);
  return ok1 && mizel(P.p);
}
async function newMeeting(f) {
  await f.evaluate(() => { const b = [...document.querySelectorAll('#btn-new-mobile,#btn-new')].find(x => x.offsetParent); (b || document.querySelector('#btn-new')).click(); });
}
const pillState = f => f.evaluate(() => { const p = document.querySelector('#pill'); return { shown: !!p && !p.hidden, state: p?.classList.contains('is-state') || false, clock: p?.querySelector('.clock')?.textContent || '', text: (p?.textContent || '').trim().slice(0, 80) }; });
const secs = c => { const m = /(?:(\d+):)?(\d+):(\d{2})/.exec(c || ''); return m ? (Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3])) : NaN; };
const captureRows = p => p.evaluate(() => new Promise(res => { const o = indexedDB.open('wizard-app-capture-v1'); o.onsuccess = () => { try { const t = o.result.transaction('sessions').objectStore('sessions').getAll(); t.onsuccess = () => res(t.result.map(r => ({ id: r.id, appId: r.appId, status: r.status, native: r.native || null, nativeId: r.nativeId || null }))); t.onerror = () => res(null); } catch (_) { res(null); } }; o.onerror = () => res(null); }));
async function raiseUpdate(P) {
  P.V.ver++; await P.p.evaluate(() => window.WosDevice.checkWeb(true));
  return until(() => P.p.locator('#dvWeb [data-web="go"]').isVisible(), 8000);
}
const goText = p => p.locator('#dvWeb [data-web="go"]').textContent().catch(() => '');
const reloaded = P => P.p.evaluate(() => !window.__qaMark).catch(() => false);
const markPage = P => P.p.evaluate(() => { window.__qaMark = 1; });

(async () => {
  const b = await chromium.launch({ executablePath: process.env.QA_CHROME || undefined, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const summary = {};
  /* ---------- A. native meeting survives Reload ---------- */
  {
    const P = await phase(b, { native: true, label: 'native' }), { p, S, N } = P;
    await bootShell(P);
    let f = await openMizel(P); ok(!!f, 'native: Mizel opens in the phone shell');
    await newMeeting(f);
    const started = await until(async () => N.recording && (await pillState(mizel(p))).shown && !(await pillState(mizel(p))).state, 20000);
    ok(started, 'native: a new meeting records through the Android meeting recorder', JSON.stringify({ log: N.log, pill: await pillState(mizel(p)).catch(() => null) }));
    const meetingId = N.meetingId;
    await sleep(6500); // past one native 5 s chunk
    f = mizel(p);
    const notes = 'QA notes typed just before the reload';
    await f.locator('#notepad').fill(notes);
    ok(await raiseUpdate(P), 'native: an update raises the banner during the recording');
    const before = { media: N.mediaMs, clock: secs((await pillState(f)).clock), navs: P.navs(), words: live.filter(s => s.meetingId === meetingId).length };
    await markPage(P); await p.screenshot({ path: OUT + '/native-before-reload.png' });
    await p.locator('#dvWeb [data-web="go"]').click();
    const toastNow = await p.evaluate(() => document.body.innerText.includes('Finish recording or save your work first'));
    ok(!toastNow, 'native: Reload is not refused with "Finish recording" while a native meeting records');
    const went = await until(() => reloaded(P), 12000);
    ok(went, 'native: the page reloads (after the typed notes saved)', JSON.stringify({ armed: await p.evaluate(() => window.WizWebUpdate?.armed).catch(() => '?') }));
    await p.waitForFunction(() => window.WosDevice && window.WosDevice.ready && window.__wos, null, { timeout: 30000 }).catch(() => {});
    ok(S.meeting(meetingId)?.notes === notes, 'native: notes typed before the reload were saved to the meeting first', JSON.stringify(S.meeting(meetingId)?.notes));
    // Mizel comes back on the same meeting (its frame is restored, or reopened like James would).
    let back = await until(async () => { const fr = mizel(p); return fr && /#\/m\//.test(fr.url()) && (await pillState(fr)).shown && !(await pillState(fr)).state; }, 15000);
    if (!back) { await openMizel(P); back = await until(async () => { const fr = mizel(p); return fr && (await pillState(fr)).shown && !(await pillState(fr)).state; }, 15000); }
    f = mizel(p);
    ok(back && f && f.url().includes('#/m/' + meetingId), 'native: Mizel comes back on the same meeting with its recording controls', f && f.url());
    ok(N.recording && N.starts === 1 && N.stops === 0 && N.startCmds === 1, 'native: the native recorder never stopped or restarted', JSON.stringify({ rec: N.recording, starts: N.starts, stops: N.stops, startCmds: N.startCmds, log: N.log.join(',') }));
    await sleep(1500);
    const ps = await pillState(f), clock = secs(ps.clock);
    ok(clock >= before.clock && Math.abs(clock - N.mediaMs / 1000) <= 2.5, 'native: elapsed time continues from the native recorder (not from zero)', JSON.stringify({ clock: ps.clock, before: before.clock, nativeS: (N.mediaMs / 1000).toFixed(1) }));
    const liveAfter = await until(async () => { const s = live.filter(x => x.meetingId === meetingId); return s.length > before.words && s[s.length - 1].bytes > 0 && (await f.evaluate(() => document.querySelector('#segments')?.textContent || '')).includes('QA live words'); }, 12000);
    ok(liveAfter, 'native: live transcript reconnects to the same meeting and keeps streaming', JSON.stringify(live.map(s => ({ m: s.meetingId, b: s.bytes }))));
    ok(await f.evaluate(() => document.querySelector('#notepad')?.value) === notes && await f.evaluate(() => !document.querySelector('#conflict') || document.querySelector('#conflict').hidden), 'native: notes are still in the notepad, no conflict');
    await p.screenshot({ path: OUT + '/native-after-reload.png' });
    const rows = (await captureRows(p) || []).filter(r => r.appId === 'mizel');
    ok(S.creates === 1 && rows.length === 1 && rows[0].nativeId === meetingId, 'native: one meeting, one capture owner (no duplicate after reload)', JSON.stringify({ creates: S.creates, rows }));
    const seqs = S.nativeChunks.map(c => c.seq);
    ok(S.webChunks.length === 0 && seqs.every((s, i) => s === i), 'native: chunks stay native-owned and contiguous (none lost or duplicated by the page)', JSON.stringify({ web: S.webChunks.length, seqs }));
    /* B. an orb microphone loan blocks Reload outright (never armed) */
    await raiseUpdate(P);
    await p.evaluate(() => { window.WizardOSDevice = { recActive: () => 'null', recHandoffVersion: () => 1, recStartBorrowed: () => 'qa-voice', recHandoffBegin: (id, mid) => JSON.stringify({ id, meetingId: mid, status: 'paused', open: true }), recHandoffEnd: id => JSON.stringify({ id, open: false, status: 'recording', pausedByHandoff: true }) }; });
    const loan = await p.evaluate(() => window.WizAppCapture.beginVoiceBorrow('qaborrow0001').then(() => true, e => String(e && e.message)));
    await markPage(P); await p.locator('#dvWeb [data-web="go"]').click(); await sleep(400);
    const loanToast = await p.evaluate(() => document.body.innerText.includes('Finish the voice message first'));
    await sleep(2500);
    ok(loan === true && !(await reloaded(P)) && !(await p.evaluate(() => window.WizWebUpdate.armed)) && loanToast, 'loan: Reload refused and not armed while the orb borrows the meeting microphone', JSON.stringify({ loan, loanToast }));
    await p.evaluate(() => window.WizAppCapture.endVoiceBorrow('qaborrow0001', { status: 'cancelled' }));
    await p.evaluate(() => { delete window.WizardOSDevice; });
    ok(await p.evaluate(() => window.WizWebUpdate.plan().ok), 'loan: after the loan ends the meeting is reload-safe again');
    // Stop after the reload saves normally.
    f = mizel(p);
    await f.locator('#pill .stop').click();
    const stopped = await until(async () => !N.recording && !(await pillState(mizel(p))).shown && (await mizel(p).evaluate(() => document.body.innerText.includes('Saved.'))), 20000);
    ok(stopped && N.stops === 1 && S.stops.filter(s => s.id === meetingId).length === 1 && S.meeting(meetingId).status === 'ready', 'native: Stop after the reload saves the meeting once', JSON.stringify({ stops: N.stops, srv: S.stops }));
    ok(await until(async () => !((await captureRows(p)) || []).some(r => r.appId === 'mizel'), 8000), 'native: the capture owner is released after Stop');
    await p.screenshot({ path: OUT + '/native-after-stop.png' });
    // Back never exits: from the meeting, Back lands in the app, never outside Wizard OS.
    await p.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {}); await sleep(600);
    ok(p.url().startsWith(BASE) && await p.evaluate(() => !!window.__wos), 'native: Back keeps Wizard OS open', p.url());
    ok(!P.errs.length, 'native: no page errors', P.errs.join(' | '));
    ok(!P.foreign.length, 'native: nothing left the fixture', P.foreign.slice(0, 3).join(' '));
    summary.native = { meetingId, starts: N.starts, stops: N.stops, startCmds: N.startCmds, nativeSeqs: seqs.length, webChunks: S.webChunks.length, navs: P.navs() };
    N.close(); await P.ctx.close();
  }
  /* ---------- C. in-page recorder: friendly deferred reload, fires once ---------- */
  {
    const P = await phase(b, { native: false, label: 'browser' }), { p, S } = P;
    await bootShell(P);
    let f = await openMizel(P); ok(!!f, 'browser: Mizel opens in the phone shell');
    await newMeeting(f);
    const started = await until(async () => { const s = await pillState(mizel(p)); return s.shown && !s.state; }, 20000);
    ok(started, 'browser: a new meeting records in the page (no native recorder)');
    const meetingId = [...S.meetings.keys()][0];
    await sleep(6000);
    ok(await raiseUpdate(P), 'browser: an update raises the banner');
    await markPage(P); const navs0 = P.navs();
    await p.locator('#dvWeb [data-web="go"]').click(); await sleep(2500);
    ok(!(await reloaded(P)) && await p.evaluate(() => window.WizWebUpdate.armed) && /Reload when recording ends/.test(await goText(p)), 'browser: Reload waits instead of refusing: "Reload when recording ends"', await goText(p));
    await p.screenshot({ path: OUT + '/browser-armed.png' });
    const box = await p.locator('#dvWeb').boundingBox(), btn = await p.locator('#dvWeb [data-web="go"]').boundingBox();
    ok(box && btn && btn.x >= box.x && btn.x + btn.width <= box.x + box.width + 0.5 && btn.height <= 44, 'browser: the waiting button fits the banner at 412 px', JSON.stringify({ box, btn }));
    await p.locator('#dvWeb [data-web="go"]').click(); await sleep(400);
    ok(!(await p.evaluate(() => window.WizWebUpdate.armed)) && (await goText(p)) === 'Reload', 'browser: a second tap cancels the waiting reload');
    await p.locator('#dvWeb [data-web="go"]').click(); await sleep(300);
    ok(await p.evaluate(() => window.WizWebUpdate.armed), 'browser: tapping again re-arms it');
    f = mizel(p); await f.locator('#pill .stop').click();
    const went = await until(() => reloaded(P), 25000);
    ok(went, 'browser: after Stop and save, the reload happens by itself');
    ok(S.stops.filter(s => s.id === meetingId).length === 1 && S.webChunks.length > 0 && S.webChunks.every((c, i, a) => c.seq === (a.slice(0, i).filter(x => x.source === c.source).length)), 'browser: the recording was saved before the reload (all chunks, then Stop)', JSON.stringify({ stops: S.stops.length, chunks: S.webChunks.map(c => c.source + c.seq) }));
    await p.waitForFunction(() => window.WosDevice && window.WosDevice.ready, null, { timeout: 30000 }).catch(() => {});
    const n1 = P.navs(); await sleep(5000);
    ok(n1 - navs0 === 1 && P.navs() === n1, 'browser: the deferred reload fires exactly once', JSON.stringify({ navs0, n1, now: P.navs() }));
    ok(!(await p.locator('#dvWeb').isVisible().catch(() => false)), 'browser: banner gone after the reload');
    ok(!P.errs.length, 'browser: no page errors', P.errs.join(' | '));
    summary.browser = { meetingId, webChunks: S.webChunks.length, stops: S.stops.length, navs: P.navs() - navs0 };
    await P.ctx.close();
  }
  fs.writeFileSync(OUT + '/result.json', JSON.stringify({ pass, fail, summary, web: WEB, mizel: MIZEL }, null, 2));
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
