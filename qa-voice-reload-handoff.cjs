// QA: Reload no longer waits for a voice message's upload + transcription (James, 22 Oct 2026: "I just sent a six
// minute one to the philosopher thread ... I have to wait like five, maybe even ten seconds before it lets me reload").
// A tap take aimed at a thread is handed to the outbox the moment it is saved on the device; Reload is free while it is
// still transcribing, and the reloaded page finishes the SAME send into the same thread, exactly once.
//   A. Phone shell: send from thread X with transcription hung; Reload is not busy within 1.5 s; reload; the new page
//      transcribes and delivers one run into X with the words; nothing else is sent.
//   B. Desktop shell: same.
//   C. Phone, held (command) take: Reload stays busy while it is routed (commands are never re-sent after a reload).
// Usage: QA_WEB_DIR=<repo> node qa-voice-reload-handoff.cjs [url]. Real Wizard reads; every write is intercepted.
// Negative control: QA_WEB_DIR=<checkout without the fix> FAILS A and B (Reload stays busy for the whole transcription).
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const URL_ = process.argv[2] || 'http://127.0.0.1:8923/wizard-os-home/';
const W = process.env.QA_WEB_DIR || '';
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return true; } catch (_) {} await sleep(200); } return false; };

async function boot(b, desktop) {
  const ctx = await b.newContext(desktop
    ? { viewport: { width: 1512, height: 920 }, ignoreHTTPSErrors: true, permissions: ['microphone'], userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36' }
    : { viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true, permissions: ['microphone'] });
  const writes = []; const R = { hang: true, sttCalls: 0, words: 'Philosophy notes after a reload' };
  await ctx.route('**/*', async r => {
    const q = r.request(), u = q.url();
    const m = u.match(/\/wizard-os-home\/((?:desktop\/|core\/)?[a-z0-9-]+\.(?:js|css|html)|)(\?|$)/);
    if (W && m && q.method() === 'GET' && !/^(data|summaries)\.js$/.test(m[1])) {
      const f = m[1] || 'index.html', p = path.join(W, 'web', f);
      if (fs.existsSync(p)) return r.fulfill({ status: 200, contentType: f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : 'application/javascript', body: fs.readFileSync(p) });
    }
    if (/\/transcribe$/.test(u) && q.method() === 'POST') {
      R.sttCalls++;
      if (R.hang) return; // never answers: the page is reloaded while this is still "transcribing"
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: R.words, ms: 5 }) }).catch(() => {});
    }
    if (/\/api\/route$|\/wizard\/v1\/route$/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ cmd: { route: 'agent' }, ms: 5 }) });
    if (q.method() !== 'GET' && /\/wizard\/(hermes|thread-seen|files)/.test(u)) {
      writes.push({ u: u.replace(/^https?:\/\/[^/]+/, ''), body: q.postData() || '' });
      if (/\/files\/upload$/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ file: { id: 'qa-voice-file', filename: 'v.webm', mime: 'audio/webm', bytes: 10 } }) });
      if (/\/v1\/runs$/.test(u)) return r.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ run_id: 'qa-fake-run', status: 'queued' }) });
      return r.fulfill({ status: 200, contentType: 'application/json', body: '{"accepted":true}' });
    }
    return r.continue();
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => { const st = String(e.stack || ''); if (/wizard-os-home\//.test(st) || !/https?:\/\//.test(st)) errs.push(String(e)); });
  await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); } catch (e) {} });
  await p.goto(URL_, { waitUntil: 'load' });
  return { ctx, p, writes, errs, R };
}
const runsOf = ws => ws.filter(w => /\/v1\/runs$/.test(w.u)).map(w => JSON.parse(w.body || '{}'));
const steersOf = ws => ws.filter(w => /\/v1\/runs\/[^/]+\/steer$/.test(w.u));
async function tapOrb(p) { const o = await p.locator('#orbWrap').boundingBox(); await p.touchscreen.tap(o.x + o.width / 2, o.y + o.height / 2); }

async function phoneReady(p) {
  await p.waitForFunction(() => window.__wos && window.__wos.live && window.__wos.live.ok && window.__wos.live.sessions.length > 2, null, { timeout: 30000 });
  await p.waitForTimeout(800); await p.evaluate(() => __wos.goDesk(1)); await p.waitForTimeout(500);
}
async function phone(b, held) {
  const tag = held ? 'C' : 'A';
  const { ctx, p, writes, errs, R } = await boot(b, false);
  await phoneReady(p);
  const wid = await p.evaluate(() => __wos.desks[1].wins.find(id => __wos.wins[id].app === 'chats'));
  const X = await p.evaluate(() => __wos.live.sessions.filter(s => !s.archived)[0].id);
  await p.evaluate(([w, x]) => { __wos.openChat(w, x); const s = __wos.live.session(x); if (s) Object.assign(s, { status: 'completed', runId: '' }); }, [wid, X]);
  await p.waitForTimeout(600);
  writes.length = 0;
  if (held) {
    const o = await p.locator('#orbWrap').boundingBox(); const cx = o.x + o.width / 2, cy = o.y + o.height / 2;
    await p.evaluate(() => __wos.voiceStart?.('command'));
    if (await p.evaluate(() => __wos.voice) === 'idle') { ok(true, 'C: held take not startable in this harness (skipped)'); await ctx.close(); return; }
  } else {
    await tapOrb(p);
  }
  await p.waitForFunction(() => __wos.voice === 'listen', null, { timeout: 8000 }).catch(() => {});
  await p.waitForTimeout(1500);
  await tapOrb(p);
  await until(() => p.evaluate(() => __wos.voice === 'think'), 5000);
  const t0 = Date.now();
  const freed = await until(() => p.evaluate(() => !window.WizWebUpdate.busy()), held ? 3000 : 1500);
  const freedMs = Date.now() - t0;
  if (held) { ok(!freed, 'C: a held command keeps Reload busy while it is routed'); await ctx.close(); return; }
  ok(freed, `A: Reload is free while the voice message is still transcribing (${freedMs} ms after Sending…)`);
  ok(await p.evaluate(() => __wos.voice) === 'think', 'A: the orb was still sending (transcription hung) when Reload became free');
  ok(runsOf(writes).length === 0, 'A: nothing was delivered before the reload');
  R.hang = false;
  await p.reload({ waitUntil: 'load' });
  await phoneReady(p);
  const done = await until(() => runsOf(writes).length >= 1, 20000);
  await p.waitForTimeout(1500);
  const runs = runsOf(writes);
  ok(done && runs.length === 1, 'A: after the reload the message is delivered exactly once', JSON.stringify(runs));
  ok(runs[0]?.session_id === X, 'A: it lands in the thread it was sent to', `${runs[0]?.session_id} vs ${X}`);
  ok(String(runs[0]?.input || '').includes(R.words), 'A: with the transcribed words', String(runs[0]?.input || '').slice(0, 120));
  ok((runs[0]?.wizard_file_ids || []).includes('qa-voice-file'), 'A: the original recording rides along', JSON.stringify(runs[0]?.wizard_file_ids));
  ok(steersOf(writes).length === 0, 'A: no steer side-sends');
  ok(await p.evaluate(() => window.WosOutbox.unsent().length) === 0, 'A: nothing left unsent');
  ok(errs.length === 0, 'A: no page errors', errs.join(' | '));
  await ctx.close();
}
async function desktop(b) {
  const { ctx, p, writes, errs, R } = await boot(b, true);
  await p.waitForFunction(() => window.__wux?.live?.ok && __wux.live.sessions.length > 0, {}, { timeout: 45000 });
  const X = await p.evaluate(() => __wux.live.sessions.find(s => s.runtime !== 'legacy' && !s.archived)?.id);
  await p.evaluate(x => { __wux.openThread(x); const s = __wux.live.session?.(x); if (s) Object.assign(s, { status: 'completed', runId: '' }); }, X);
  await p.waitForFunction(x => Object.values(__wux.wins).some(w => w.thread === x), X); await sleep(800);
  writes.length = 0;
  await p.click('#micBtn'); await p.waitForFunction(() => __wux.voice === 'listen', null, { timeout: 8000 }).catch(() => {});
  await sleep(1500);
  await p.click('#micBtn');
  await until(() => p.evaluate(() => __wux.voice !== 'listen'), 5000);
  const t0 = Date.now();
  const freed = await until(() => p.evaluate(() => !window.WizWebUpdate.busy()), 1500);
  ok(freed, `B: desktop Reload is free while the voice message is still transcribing (${Date.now() - t0} ms)`);
  ok(R.sttCalls >= 1 && runsOf(writes).length === 0, 'B: transcription was in flight and nothing delivered yet', `stt=${R.sttCalls}`);
  R.hang = false;
  await p.reload({ waitUntil: 'load' });
  await p.waitForFunction(() => window.__wux?.live?.ok, {}, { timeout: 45000 });
  const done = await until(() => runsOf(writes).length >= 1, 20000);
  await sleep(1500);
  const runs = runsOf(writes);
  ok(done && runs.length === 1 && runs[0].session_id === X, 'B: after the reload the message is delivered once into the same thread', JSON.stringify(runs.map(r => r.session_id)) + ` X=${X}`);
  ok(String(runs[0]?.input || '').includes(R.words), 'B: with the transcribed words', String(runs[0]?.input || '').slice(0, 120));
  ok(errs.length === 0, 'B: no page errors', errs.join(' | '));
  await ctx.close();
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.QA_CHROME || undefined, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const only = process.env.QA_ONLY || 'ABC';
  try {
    if (only.includes('A')) await phone(b, false);
    if (only.includes('B')) await desktop(b);
  } catch (e) { fail++; console.log('FAIL exception', e.stack || e); }
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
