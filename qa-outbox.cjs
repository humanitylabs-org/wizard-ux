// QA for the durable outbox + Settings (feature/everywhere-outbox).
// Runs the worktree's web/ against the live origin with real Wizard reads. Every write is intercepted
// by a fake Wizard that can be "down" (connection refused / 502), so we can prove:
//   1. a message sent while Wizard is down is saved, shown as waiting, and delivered once Wizard is back;
//   2. the retry reuses the same Idempotency-Key, session id and body bytes (no duplicate runs);
//   3. a message survives a full page reload (app killed) and is delivered after it;
//   4. after the automatic tries it shows "Not sent · Retry", and Retry delivers it;
//   5. Settings opens from the gear on Home and on an empty desk, not over an open app, and lists unsent items;
//   6. a voice recording whose transcription fails is kept and sent (transcribed) later;
//   7. zero writes reach the real Wizard.
// QA_WEB_DIR=<worktree> (default: this dir).
const { chromium } = require('/home/telos/node_modules/playwright');
const fs = require('fs'), path = require('path');
const URL_ = process.argv[2] || 'https://private.wizard001.com/wizard-os-home/';
const RESOLVE = process.env.QA_RESOLVE || 'MAP private.wizard001.com 127.0.0.1:18443';
const WEB = process.env.QA_WEB_DIR || __dirname;
const OUT = process.env.QA_OUT || path.join(__dirname, 'qa-live');
const EXEC = process.env.QA_CHROME || '/home/telos/.local/bin/google-chrome';
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ executablePath: fs.existsSync(EXEC) ? EXEC : undefined, args: ['--host-resolver-rules=' + RESOLVE] });
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true });
  // Fake Wizard for writes. down: 'refuse' (network error) | '502' | false.
  const W = { down: false, runs: [], sessions: new Set(), keys: new Map(), transcribes: 0, uploads: 0, sttDown: false };
  const leaked = [];
  await ctx.route('**/*', async r => {
    const q = r.request(), u = q.url();
    const m = u.match(/\/wizard-os-home\/((?:desktop\/|core\/)?[a-z-]+\.(?:js|css|html)|)(\?|$)/);
    if (m && q.method() === 'GET') {
      const f = m[1] || 'index.html', p = path.join(WEB, 'web', f);
      if (fs.existsSync(p) && f !== 'data.js' && f !== 'summaries.js') return r.fulfill({ status: 200, contentType: f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : 'application/javascript', body: fs.readFileSync(p) });
    }
    if (/\/wizard-os-home\/api\/transcribe$|\/wizard\/voice\/transcribe$/.test(u)) { // sidecar or bootstrap endpoint
      W.transcribes++;
      if (W.down === 'refuse' || W.sttDown) return r.abort('connectionrefused');
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: 'QA recording transcribed later', ms: 5 }) });
    }
    if (/\/wizard-os-home\/api\/route$|\/wizard\/v1\/route$/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ cmd: { route: 'agent' }, ms: 3 }) });
    if (q.method() !== 'GET' && q.method() !== 'HEAD' && /\/wizard\//.test(u)) {
      if (W.down === 'refuse') return r.abort('connectionrefused');
      if (W.down === '502') return r.fulfill({ status: 502, contentType: 'text/html', body: 'Bad gateway' });
      const body = q.postData() || '';
      if (/\/wizard\/files\/upload$/.test(u)) { W.uploads++; return r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ file: { id: 'drop_qa' + W.uploads, filename: q.headers()['x-wizard-filename'], mime: q.headers()['x-wizard-mime'], bytes: 10 } }) }); }
      if (/\/api\/sessions$/.test(u)) {
        const id = JSON.parse(body).id;
        if (W.sessions.has(id)) return r.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'session_exists' }) });
        W.sessions.add(id); return r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ session: { id } }) });
      }
      if (/\/v1\/runs$/.test(u)) {
        const key = q.headers()['idempotency-key'];
        const prev = W.keys.get(key);
        if (prev) { prev.replays++; if (prev.body !== body) return r.fulfill({ status: 409, contentType: 'application/json', body: '{"error":"idempotency key conflict"}' }); return r.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ run_id: prev.runId, status: 'queued' }) }); }
        const rec = { key, body, runId: 'qa-run-' + (W.runs.length + 1), replays: 0 };
        W.keys.set(key, rec); W.runs.push(rec);
        return r.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ run_id: rec.runId, status: 'queued' }) });
      }
      return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
    return r.continue();
  });
  // Leak check is done against the real Wizard at the end (every session id we made must not exist there).
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_CONNECTION_REFUSED/.test(m.text())) errs.push('console: ' + m.text()); });
  await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); } catch (e) {} });
  await p.goto(URL_, { waitUntil: 'load' });
  await p.evaluate(() => new Promise(res => { const r = indexedDB.deleteDatabase('wos-outbox'); r.onsuccess = r.onerror = r.onblocked = () => res(); }));
  await p.reload({ waitUntil: 'load' });
  await p.waitForFunction(() => window.__wos && window.__wos.live && window.__wos.live.ok, null, { timeout: 30000 });
  ok(await p.evaluate(() => !!window.WosOutbox), 'outbox loaded');

  /* 5a. Gear on Home */
  ok(await p.isVisible('.desk[data-desk="1"] .gear') || await p.evaluate(() => !!document.querySelectorAll('.desk')[window.__wos.HOME].querySelector('.gear')), 'gear on Home');

  /* 1. Send while Wizard is down → saved + waiting → delivered once back */
  W.down = 'refuse';
  await p.evaluate(() => { const w = window.__wos.openWin({ app: 'chats', thread: '__new__' }); window.__qaWid = w.id; });
  await sleep(300);
  await p.fill(`[data-chats] textarea`, 'QA outbox message one');
  await p.click(`[data-chats] .ch-compose button[type=submit]`);
  await p.waitForFunction(() => window.WosOutbox.unsent().some(x => x.text === 'QA outbox message one' && x.state === 'waiting'), null, { timeout: 8000 });
  const it1 = await p.evaluate(() => window.WosOutbox.unsent().find(x => x.text === 'QA outbox message one'));
  ok(it1 && it1.attempts >= 1, 'down: message kept and waiting', JSON.stringify(it1 && { s: it1.state, a: it1.attempts }));
  // New threads start in the background (0.6.x): the window is back on its list, where the unsent chat waits
  // under "Sending" with "retrying" (it must never vanish from Chats while Wizard is down).
  ok(await p.isVisible('[data-sec="sending"] .msg.u.pending.waiting') && /retrying/.test(await p.textContent('[data-sec="sending"] .msg.u.pending.waiting .pst') || ''), 'down: Chats shows the message under Sending with “retrying”');
  await p.screenshot({ path: path.join(OUT, 'outbox-waiting.png') });
  const inIdb = await p.evaluate(() => new Promise(res => { const r = indexedDB.open('wos-outbox'); r.onsuccess = () => { const t = r.result.transaction('items').objectStore('items').getAll(); t.onsuccess = () => res(t.result.map(x => x.text)); }; }));
  ok(inIdb.includes('QA outbox message one'), 'down: message is on disk (IndexedDB)');
  ok(W.runs.length === 0, 'down: nothing admitted yet');
  W.down = false;
  await p.evaluate(() => window.WosOutbox.retry(window.WosOutbox.unsent().find(x => x.text === 'QA outbox message one').id));
  await p.waitForFunction(() => !window.WosOutbox.unsent().some(x => x.text === 'QA outbox message one'), null, { timeout: 10000 });
  ok(W.runs.filter(r => r.body.includes('QA outbox message one')).length === 1, 'up: delivered exactly once', String(W.runs.length));
  await sleep(300);
  ok(!(await p.isVisible('[data-sec="sending"]')), 'up: the Sending row leaves Chats once Wizard has it');
  const run1 = W.runs.find(r => r.body.includes('QA outbox message one'));
  ok(run1 && run1.key === it1.id && JSON.parse(run1.body).session_id === it1.sessionId, 'up: idempotency key + session id fixed at enqueue');

  /* 2. Gateway answers 502 on the run after the session was made → replay is byte-identical, one run */
  W.down = false; let flip = 0;
  await p.route('**/wizard/hermes/v1/runs', async r => { if (flip++ === 0) { // first admission: accepted upstream, but the reply is lost
      const q = r.request(); const key = q.headers()['idempotency-key']; const rec = { key, body: q.postData(), runId: 'qa-run-lost', replays: 0 }; W.keys.set(key, rec); W.runs.push(rec); return r.abort('connectionreset'); }
    return r.fallback(); });
  await p.evaluate(() => window.__wos.toAgent ? 0 : 0);
  await p.evaluate(() => window.__wos.runUtterance ? null : null);
  await p.evaluate(async () => { await window.WosOutbox.enqueue({ kind: 'new', text: 'QA lost reply', source: 'orb' }); });
  await p.waitForFunction(() => !window.WosOutbox.unsent().some(x => x.text === 'QA lost reply'), null, { timeout: 15000 });
  const lost = W.runs.filter(r => r.body.includes('QA lost reply'));
  ok(lost.length === 1 && lost[0].replays === 1, 'lost reply: retried with same key → replayed, still one run', JSON.stringify(lost.map(x => x.replays)));
  await p.unroute('**/wizard/hermes/v1/runs');

  /* 3. App killed while down: survives a reload, delivered after */
  W.down = 'refuse';
  await p.evaluate(async () => { await window.WosOutbox.enqueue({ kind: 'new', text: 'QA survives a restart', source: 'orb' }); });
  await sleep(600);
  await p.reload({ waitUntil: 'load' });
  await p.waitForFunction(() => window.WosOutbox && window.__wos && window.__wos.live, null, { timeout: 30000 });
  await sleep(800);
  const after = await p.evaluate(() => window.WosOutbox.unsent().map(x => x.text));
  ok(after.includes('QA survives a restart'), 'restart: message still there after reload');
  /* 5b. unsent card + gear badge on Home */
  await p.evaluate(() => { const H = window.__wos.HOME; [...window.__wos.desks[H].wins].forEach(id => window.__wos.closeWin(id)); window.__wos.goDesk(H); });
  await sleep(400);
  ok(await p.evaluate(() => !!document.querySelector('.unsent-card') && !!document.querySelector('.gear .gear-n')), 'Home shows the unsent card and a badge on the gear');
  await p.evaluate(() => window.__wos.openSheet('inbox')); await sleep(400);
  ok(await p.isVisible('#inbox .ub-row'), 'Inbox shade lists it under Unsent (reachable over any app)');
  await p.screenshot({ path: path.join(OUT, 'outbox-inbox.png') });
  await p.evaluate(() => window.__wos.closeSheets());
  W.down = false;
  await p.evaluate(() => window.dispatchEvent(new Event('online')));
  await p.waitForFunction(() => !window.WosOutbox.unsent().some(x => x.text === 'QA survives a restart'), null, { timeout: 12000 });
  ok(W.runs.filter(r => r.body.includes('QA survives a restart')).length === 1, 'restart: delivered once after coming back online');

  /* 4. Exhaust automatic tries → Not sent · Retry */
  W.down = '502';
  await p.evaluate(async () => { window.WosOutbox.AUTO_TRIES; const it = await window.WosOutbox.enqueue({ kind: 'new', text: 'QA gives up then retry', source: 'orb' }); window.__qaGive = it.id; });
  // fast-forward the backoff
  for (let k = 0; k < 16; k++) { await p.evaluate(() => { for (const it of window.WosOutbox._items.values()) if (it.state === 'waiting') it.nextAt = 0; window.WosOutbox.pump(); }); await sleep(250); }
  await p.waitForFunction(() => window.WosOutbox.get(window.__qaGive)?.state === 'failed', null, { timeout: 8000 });
  const g = await p.evaluate(() => window.WosOutbox.get(window.__qaGive));
  ok(g.state === 'failed' && /unavailable \(502\)/.test(g.error), 'after automatic tries: Not sent with the reason', g.error);
  await p.evaluate(() => window.__wos.openSettings(true));
  await sleep(500);
  ok(await p.isVisible('#settings.open') && await p.isVisible('.ub-row.failed'), 'Settings lists the unsent message');
  await p.screenshot({ path: path.join(OUT, 'outbox-settings.png') });
  W.down = false;
  await p.click('.ub-row.failed [data-ub="retry"]');
  await p.waitForFunction(() => !window.WosOutbox.get(window.__qaGive) || window.WosOutbox.get(window.__qaGive).state === 'sent', null, { timeout: 8000 });
  ok(W.runs.filter(r => r.body.includes('QA gives up then retry')).length === 1, 'Retry in Settings delivers it once');
  await sleep(400);
  ok(await p.evaluate(() => /reached Wizard/.test(document.querySelector('#settingsBody').textContent)), 'Settings says everything reached Wizard');
  await p.evaluate(() => window.__wos.closeSheets());

  /* 6. Voice: transcription down → recording kept; later transcribed + attached + sent */
  W.sttDown = true; W.down = false;
  await p.evaluate(async () => { const blob = new Blob([new Uint8Array(4000).fill(7)], { type: 'audio/webm' }); const it = await window.WosOutbox.enqueue({ kind: 'new', text: '', audio: blob, source: 'orb' }); window.__qaVoice = it.id; });
  await sleep(1200);
  const v1 = await p.evaluate(() => { const it = window.WosOutbox.get(window.__qaVoice); return it && { s: it.state, hasAudio: !!it.audio, text: it.text }; });
  ok(v1 && v1.s === 'waiting' && v1.hasAudio && !v1.text, 'voice: STT down → recording kept, waiting', JSON.stringify(v1));
  W.sttDown = false;
  await p.evaluate(() => window.WosOutbox.retry(window.__qaVoice));
  await p.waitForFunction(() => window.WosOutbox.get(window.__qaVoice)?.state === 'sent' || !window.WosOutbox.get(window.__qaVoice), null, { timeout: 10000 });
  const vr = W.runs.find(r => r.body.includes('QA recording transcribed later'));
  ok(vr && JSON.parse(vr.body).wizard_file_ids?.length === 1, 'voice: transcribed later, voice note attached, sent once');

  /* 5c. No gear over an open app; gear on an empty desk */
  await p.evaluate(() => window.__wos.goDesk(window.__wos.HOME));
  await sleep(200);
  const covered = await p.evaluate(() => { const d = document.querySelectorAll('.desk')[window.__wos.idx]; const g = d.querySelector('.gear'); const wins = d.classList.contains('has-wins'); if (!g) return { wins, visible: false }; const r = g.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { wins, visible: !!top && top.closest('.gear') === g }; });
  ok(covered.wins ? !covered.visible : covered.visible, 'gear only where no app is in front', JSON.stringify(covered));
  const emptyIdx = await p.evaluate(() => window.__wos.desks.findIndex((d, i) => !d.wins.length && i !== window.__wos.HOME));
  if (emptyIdx >= 0) {
    await p.evaluate(i => window.__wos.goDesk(i), emptyIdx); await sleep(500);
    const gv = await p.evaluate(i => { const g = document.querySelectorAll('.desk')[i].querySelector('.gear'); if (!g) return false; const r = g.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('.gear') === g; }, emptyIdx);
    ok(gv, 'gear on an empty desk');
    await p.click(`.desk[data-desk="${emptyIdx}"] .gear`); await sleep(500);
    ok(await p.isVisible('#settings.open'), 'tapping the gear opens Settings');
    await p.screenshot({ path: path.join(OUT, 'settings-empty-desk.png') });
    const back = await p.evaluate(() => window.__wosNativeBack());
    ok(back === 'sheet' && !(await p.isVisible('#settings.open')), 'Back closes Settings and stays in the app', back);
  }

  const ids = [...W.sessions];
  const real = await p.evaluate(async ids => { const out = []; for (const id of ids) { const r = await fetch('/wizard/hermes/api/sessions/' + encodeURIComponent(id), { credentials: 'same-origin' }); out.push(r.status); } return out; }, ids);
  ok(ids.length >= 4 && real.every(s => s === 404), 'zero writes reached the real Wizard (' + ids.length + ' QA sessions all absent upstream)', JSON.stringify(real));
  ok(errs.length === 0, 'no page errors', errs.slice(0, 3).join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
