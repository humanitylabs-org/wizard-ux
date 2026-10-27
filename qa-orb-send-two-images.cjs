// QA: two images picked on the orb, sent while the second is still uploading, both arrive (James, 27 Oct 2026: "I click
// two images and I guess the second one didn't finish uploading yet. I hit send, it only sent the first image").
// Each picked file must join the take at once, not only after the one before it finished uploading.
// Built on qa-orb-send-uploading.cjs. Original note follows.
// QA: orb send never waits for an attachment. James (19 Oct 2026): "Don't block the user from being able to send
// their message because an attachment is still uploading. Send the message and process it in the background. Don't
// make them stare at a screen that keeps recording their voice even though they've finished saying what they want."
// A file attached to an orb take whose upload is slow (the create hangs) is sent at the orb tap: no "still uploading"
// toast, the recorder stops, the phone steps back to the list, and the run arrives with the real Wizard Files id once
// the upload lands (never a placeholder id).
// Usage: QA_WEB_DIR=<repo> node qa-orb-send-uploading.cjs [url]. Real Wizard reads; every write is intercepted.
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const URL_ = process.argv[2] || 'http://127.0.0.1:8923/wizard-os-home/';
const W = process.env.QA_WEB_DIR || '';
const SHOTS = process.env.QA_SHOTS || '';
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function boot(b) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true, permissions: ['microphone'], colorScheme: 'dark' });
  const writes = []; const R = { createDelay: 0, creates: 0, patched: 0, completes: 0, words: 'Here is the photo I mentioned' };
  await ctx.route('**/*', async r => {
    const q = r.request(), u = q.url();
    const m = u.match(/\/wizard-os-home\/((?:desktop\/|core\/)?[a-z-]+\.(?:js|css|html)|)(\?|$)/);
    if (W && m && q.method() === 'GET' && !/^(data|summaries)\.js$/.test(m[1])) {
      const f = m[1] || 'index.html', p = path.join(W, 'web', f);
      if (fs.existsSync(p)) return r.fulfill({ status: 200, contentType: f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : 'application/javascript', body: fs.readFileSync(p) });
    }
    if (/\/transcribe$/.test(u) && q.method() === 'POST') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: R.words, ms: 5 }) }).catch(() => {});
    if (/\/api\/route$|\/wizard\/v1\/route$/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ cmd: { route: 'agent' }, ms: 5 }) });
    // Resumable uploads: a slow create (a busy Wizard), then normal PATCH/complete.
    if (/\/wizard\/v1\/uploads$/.test(u) && q.method() === 'POST') {
      const n = ++R.creates; const body = JSON.parse(q.postData() || '{}'); R.bytes = body.bytes;
      await sleep(R.createDelay);
      return r.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ upload_id: 'up_qa' + n, offset: 0, status: 'uploading', chunk_bytes: 8388608 }) }).catch(() => {});
    }
    if (/\/wizard\/v1\/uploads\/up_qa\d$/.test(u) && q.method() === 'PATCH') { R.patched++; return r.fulfill({ status: 204, headers: { 'Upload-Offset': String(R.bytes) } }); }
    if (/\/wizard\/v1\/uploads\/up_qa\d$/.test(u) && q.method() === 'GET') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ offset: R.patched ? R.bytes : 0, status: 'uploading' }) });
    if (/\/wizard\/v1\/uploads\/up_qa\d\/complete$/.test(u)) { R.completes++; const n = u.match(/up_qa(\d)/)[1]; return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ file: { id: 'qa-photo-file-' + n, filename: 'qa-photo.png', mime: 'image/png', bytes: R.bytes } }) }); }
    if (q.method() !== 'GET' && /\/wizard\/(hermes|thread-seen|files)/.test(u)) {
      writes.push({ u: u.replace(/^https?:\/\/[^/]+/, ''), body: q.postData() || '' });
      if (/\/files\/upload$/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ file: { id: 'qa-audio', filename: 'v.webm', mime: 'audio/webm', bytes: 10 } }) });
      if (/\/v1\/runs$/.test(u)) return r.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ run_id: 'qa-fake-run', status: 'queued' }) });
      return r.fulfill({ status: 200, contentType: 'application/json', body: '{"accepted":true}' });
    }
    return r.continue();
  });
  const p = await ctx.newPage();
  const errs = [], toasts = [];
  p.on('pageerror', e => { const st = String(e.stack || ''); if (/wizard-os-home\//.test(st) || !/https?:\/\//.test(st)) errs.push(String(e)); });
  await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); } catch (e) {} });
  await p.goto(URL_, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__wos && window.__wos.live && window.__wos.live.ok && window.__wos.live.sessions.length > 2, null, { timeout: 30000 });
  await p.exposeFunction('__qaToast', t => toasts.push(t));
  await p.evaluate(() => new MutationObserver(() => { const t = document.body.innerText; const m = t.match(/[^\n]*(still uploading|tap again when it finishes|send when it finishes)[^\n]*/i); if (m) window.__qaToast(m[0]); }).observe(document.body, { subtree: true, childList: true, characterData: true }));
  await p.waitForTimeout(800);
  await p.evaluate(() => __wos.goDesk(1)); await p.waitForTimeout(500);
  return { ctx, p, writes, errs, toasts, R };
}
const runsOf = ws => ws.filter(w => /\/v1\/runs$/.test(w.u)).map(w => JSON.parse(w.body || '{}'));
async function tapOrb(p) { const o = await p.locator('#orbWrap').boundingBox(); await p.touchscreen.tap(o.x + o.width / 2, o.y + o.height / 2); }

(async () => {
  const b = await chromium.launch({ executablePath: process.env.QA_CHROME || undefined, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const png = path.join(process.env.TMPDIR || '/tmp', 'qa-photo.png'), png2 = path.join(process.env.TMPDIR || '/tmp', 'qa-photo-2.png');
  for (const f of [png, png2]) fs.writeFileSync(f, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), require('crypto').randomBytes(200000)]));
  {
    const { ctx, p, writes, errs, toasts, R } = await boot(b);
    const wid = await p.evaluate(() => __wos.desks[1].wins.find(id => __wos.wins[id].app === 'chats'));
    const X = await p.evaluate(() => __wos.live.sessions.filter(s => !s.archived)[0].id);
    await p.evaluate(([w, x]) => { __wos.openChat(w, x); const s = __wos.live.session(x); if (s) Object.assign(s, { status: 'completed', runId: '' }); }, [wid, X]);
    await p.waitForTimeout(600);
    R.createDelay = 2500; writes.length = 0;
    await tapOrb(p); await p.waitForTimeout(1200);
    ok(await p.evaluate(() => __wos.voice) === 'listen', 'orb take is recording');
    const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.locator('#arcAttach').tap()]);
    await fc.setFiles([png, png2]);
    await p.waitForTimeout(700);
    ok(R.creates <= 1, 'the second image has not started uploading at the send tap', String(R.creates));
    await tapOrb(p);
    await p.waitForFunction(() => __wos.voice !== 'listen' && __wos.voice !== 'paused', null, { timeout: 5000 }).catch(() => {});
    ok(!toasts.length, 'no "still uploading" block', toasts.join(' | '));
    const end = Date.now() + 30000; let run = null;
    while (Date.now() < end && !(run = runsOf(writes).find(r => (r.wizard_file_ids || []).some(id => /^qa-photo-file/.test(id))))) await sleep(300);
    const ids = (run?.wizard_file_ids || []).filter(id => /^qa-photo-file/.test(id));
    ok(ids.length === 2, 'both images are delivered with the message', JSON.stringify(runsOf(writes).map(r => r.wizard_file_ids)));
    ok(run && run.session_id === X, 'it lands in the thread it was sent from', run && run.session_id);
    ok(!runsOf(writes).some(r => (r.wizard_file_ids || []).some(id => String(id).startsWith('pending:'))), 'no placeholder id reaches the agent');
    ok(runsOf(writes).length === 1, 'exactly one run (no duplicate send)', runsOf(writes).length);
    ok(await p.evaluate(() => window.WosOutbox.unsent().length) === 0, 'outbox drained');
    ok(errs.length === 0, 'no page errors', errs.join(' | '));
    await ctx.close();
  }
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
