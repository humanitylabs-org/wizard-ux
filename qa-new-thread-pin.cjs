// QA: a message sent from New chat stays a NEW thread, and a message sent in thread X stays in X, even when
// James opens another thread while it is still transcribing/routing. Repro (10 Oct 2026, James): "When I create
// a new thread and hit send and then I open a thread, it posts it as a reply to the thread I just opened."
// Cause: the orb path decided the destination after transcription + routing (seconds), from whatever was in front.
// Usage: QA_WEB_DIR=<repo> node qa-new-thread-pin.cjs [url]. Real Wizard reads; every write is intercepted.
let chromium; try { ({ chromium } = require('playwright-core')); } catch (e) { ({ chromium } = require('/home/telos/node_modules/playwright')); }
const URL_ = process.argv[2] || 'https://private.wizard001.com/wizard-os-home/';
const RESOLVE = process.env.QA_RESOLVE || 'MAP private.wizard001.com 127.0.0.1:18443';
const W = process.env.QA_WEB_DIR || '';
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function boot(b) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true, permissions: ['microphone'] });
  const writes = []; const R = { routeDelay: 0, sttDelay: 0, words: 'Please make a brand new plan for the garden project' };
  await ctx.route('**/*', async r => {
    const q = r.request(), u = q.url();
    const m = u.match(/\/wizard-os-home\/((?:desktop\/|core\/)?[a-z-]+\.(?:js|css|html)|)(\?|$)/);
    if (W && m && q.method() === 'GET' && !/^(data|summaries)\.js$/.test(m[1])) {
      const f = m[1] || 'index.html', p = require('path').join(W, 'web', f);
      if (require('fs').existsSync(p)) return r.fulfill({ status: 200, contentType: f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : 'application/javascript', body: require('fs').readFileSync(p) });
    }
    if (/\/transcribe$/.test(u) && q.method() === 'POST') { await sleep(R.sttDelay); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: R.words, ms: 5 }) }); }
    if (/\/api\/route$|\/wizard\/v1\/route$/.test(u)) { await sleep(R.routeDelay); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ cmd: { route: 'agent' }, ms: 5 }) }); }
    if (q.method() !== 'GET' && /\/wizard\/(hermes|thread-seen|files)/.test(u)) {
      writes.push({ u: u.replace(/^https?:\/\/[^/]+/, ''), body: q.postData() || '' });
      if (/\/api\/sessions$/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ session: { id: 'qa-fake-session' } }) });
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
  await p.waitForFunction(() => window.__wos && window.__wos.live && window.__wos.live.ok && window.__wos.live.sessions.length > 2, null, { timeout: 30000 });
  await p.waitForTimeout(800);
  await p.evaluate(() => __wos.goDesk(1)); await p.waitForTimeout(500);
  return { ctx, p, writes, errs, R };
}
const chatsWin = p => p.evaluate(() => __wos.desks[1].wins.find(id => __wos.wins[id].app === 'chats'));
const sessionsOf = ws => ws.filter(w => /\/api\/sessions$/.test(w.u));
const runsOf = ws => ws.filter(w => /\/v1\/runs$/.test(w.u)).map(w => JSON.parse(w.body || '{}'));
const steersOf = ws => ws.filter(w => /\/v1\/runs\/[^/]+\/steer$/.test(w.u));
const pickThreads = p => p.evaluate(() => __wos.live.sessions.filter(s => !s.archived).slice(0, 2).map(s => s.id));
// A real orb take (fake mic device): tap to start, ~1.2 s of audio, tap to send.
async function tapOrb(p) { const o = await p.locator('#orbWrap').boundingBox(); await p.touchscreen.tap(o.x + o.width / 2, o.y + o.height / 2); }
async function orbTake(p) {
  await tapOrb(p); await p.waitForTimeout(1600);
  const on = await p.evaluate(() => __wos.voice);
  await tapOrb(p); await p.waitForTimeout(250);
  return on;
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.QA_CHROME || undefined, args: ['--host-resolver-rules=' + RESOLVE, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });

  // 1. The repro, typed/command path: New chat in front, send, router is slow, James opens thread Y meanwhile.
  {
    const { ctx, p, writes, errs, R } = await boot(b);
    const wid = await chatsWin(p); const [Y] = await pickThreads(p);
    await p.evaluate(w => __wos.openChat(w, '__new__'), wid); await p.waitForTimeout(400);
    writes.length = 0; R.routeDelay = 2500;
    await p.evaluate(() => { __wos.handleText('Please make a brand new plan for the garden project', 'auto', false, 0, null); });
    await p.waitForTimeout(400);
    await p.evaluate(([w, y]) => __wos.openChat(w, y), [wid, Y]); await p.waitForTimeout(3500);
    const runs = runsOf(writes);
    ok(sessionsOf(writes).length === 1, 'routed send from New chat creates exactly one new session', JSON.stringify(writes.map(w => w.u)));
    ok(runs.length === 1 && runs[0].session_id !== Y, 'the run goes to the new session, not the thread opened meanwhile', JSON.stringify(runs.map(r => r.session_id)) + ' Y=' + Y);
    ok(steersOf(writes).length === 0, 'no steer into the opened thread');
    ok(await p.evaluate(w => __wos.wins[w].thread, wid) === Y, 'the thread James opened stays open');
    ok(errs.length === 0, 'no page errors (1)', errs.join(' | '));
    await ctx.close();
  }
  // 2. The repro with a real orb take: slow transcription, James opens thread Y between the send tap and the words.
  {
    const { ctx, p, writes, errs, R } = await boot(b);
    const wid = await chatsWin(p); const [Y] = await pickThreads(p);
    await p.evaluate(w => __wos.openChat(w, '__new__'), wid); await p.waitForTimeout(400);
    writes.length = 0; R.sttDelay = 2500;
    const on = await orbTake(p);
    const st = await p.evaluate(() => __wos.voice);
    ok(on === 'listen' && st === 'think', 'a real orb take records, then is transcribing after the send tap', on + ' → ' + st);
    await p.evaluate(([w, y]) => __wos.openChat(w, y), [wid, Y]); await p.waitForTimeout(4500);
    const runs = runsOf(writes);
    ok(sessionsOf(writes).length === 1 && runs.length === 1 && runs[0].session_id !== Y, 'orb take from New chat lands as a new thread, not a reply in the opened thread', JSON.stringify({ s: sessionsOf(writes).length, runs: runs.map(r => r.session_id), Y }));
    ok(/New chat/.test(runs[0]?.instructions || ''), 'its context note names New chat (where it was sent), not the opened thread', (runs[0]?.instructions || '').slice(0, 200));
    ok(steersOf(writes).length === 0, 'no steer into the opened thread (orb)');
    ok(await p.evaluate(w => __wos.wins[w].thread, wid) === Y, 'the thread James opened stays open (orb)');
    ok(errs.length === 0, 'no page errors (2)', errs.join(' | '));
    await ctx.close();
  }
  // 3. The mirror: a reply from thread X stays in X when James opens thread Y while it routes.
  {
    const { ctx, p, writes, errs, R } = await boot(b);
    const wid = await chatsWin(p); const [X, Y] = await pickThreads(p);
    await p.evaluate(([w, x]) => { __wos.openChat(w, x); const s = __wos.live.session(x); if (s) Object.assign(s, { status: 'completed', runId: '' }); }, [wid, X]); await p.waitForTimeout(600);
    writes.length = 0; R.routeDelay = 2500;
    await p.evaluate(() => { __wos.handleText('One more thing on this one', 'auto', false, 0, null); });
    await p.waitForTimeout(400);
    await p.evaluate(([w, y]) => __wos.openChat(w, y), [wid, Y]); await p.waitForTimeout(3500);
    const runs = runsOf(writes);
    ok(sessionsOf(writes).length === 0, 'reply from thread X creates no new session');
    ok(runs.length === 1 && runs[0].session_id === X, 'the reply lands in X (where it was sent), not Y', JSON.stringify(runs.map(r => r.session_id)) + ` X=${X} Y=${Y}`);
    ok(await p.evaluate(w => __wos.wins[w].thread, wid) === Y, 'Y stays open; James is not pulled back');
    ok(errs.length === 0, 'no page errors (3)', errs.join(' | '));
    await ctx.close();
  }
  // 4. Typed New chat send, then a thread tap straight after: new thread, and the list step-back doesn't fight the tap.
  {
    const { ctx, p, writes, errs } = await boot(b);
    const wid = await chatsWin(p); const [Y] = await pickThreads(p);
    await p.evaluate(w => __wos.openChat(w, '__new__'), wid); await p.waitForTimeout(400);
    writes.length = 0;
    const ta = p.locator(`.win[data-win="${wid}"] [data-chform] textarea`);
    await ta.fill('Start a fresh thread about the roof repair');
    await p.evaluate(([w, y]) => { const f = document.querySelector(`.win[data-win="${w}"] [data-chform]`); f.requestSubmit(); __wos.openChat(w, y); }, [wid, Y]);
    await p.waitForTimeout(3000);
    const runs = runsOf(writes);
    ok(sessionsOf(writes).length === 1 && runs.length === 1 && runs[0].session_id !== Y, 'typed New chat send stays a new thread', JSON.stringify(runs.map(r => r.session_id)));
    ok(await p.evaluate(w => __wos.wins[w].thread, wid) === Y, 'the thread tapped right after stays open (not kicked back to the list)');
    ok(errs.length === 0, 'no page errors (4)', errs.join(' | '));
    await ctx.close();
  }
  // 5. Repro (10 Oct 2026, James): "I started a thread on the chat list, I clicked into a thread while I was
  // recording it, and then I hit send and it replied to that thread." The take belongs where recording STARTED.
  {
    const { ctx, p, writes, errs } = await boot(b);
    const wid = await chatsWin(p); const [Y] = await pickThreads(p);
    await p.evaluate(w => { if (__wos.wins[w].thread) __wos.chats.chatsBack(__wos.wins[w]); __wos.focusWin(w); }, wid);
    await p.waitForTimeout(400);
    const startView = await p.evaluate(w => __wos.wins[w].thread || '', wid);
    writes.length = 0;
    await tapOrb(p); await p.waitForTimeout(900);
    const on = await p.evaluate(() => __wos.voice);
    await p.evaluate(([w, y]) => __wos.openChat(w, y), [wid, Y]); await p.waitForTimeout(900);
    await tapOrb(p); await p.waitForTimeout(3500);
    const runs = runsOf(writes);
    ok(!startView && on === 'listen', 'take starts on the Chats list', JSON.stringify({ startView, on }));
    ok(sessionsOf(writes).length === 1 && runs.length === 1 && runs[0].session_id !== Y, 'take started on the list and sent from thread Y starts a NEW thread', JSON.stringify({ s: sessionsOf(writes).length, runs: runs.map(r => r.session_id), Y }));
    ok(steersOf(writes).length === 0, 'no steer into Y (list-started take)');
    ok(/thread list/.test(runs[0]?.instructions || ''), 'context note names the Chats list, where recording started', (runs[0]?.instructions || '').slice(0, 200));
    ok(await p.evaluate(w => __wos.wins[w].thread, wid) === Y, 'Y stays open after the send (list-started take)');
    ok(errs.length === 0, 'no page errors (5)', errs.join(' | '));
    await ctx.close();
  }
  // 6. Mirror: a take started inside thread X, then James opens Y while recording and sends: it lands in X.
  {
    const { ctx, p, writes, errs } = await boot(b);
    const wid = await chatsWin(p); const [X, Y] = await pickThreads(p);
    await p.evaluate(([w, x]) => { __wos.openChat(w, x); const s = __wos.live.session(x); if (s) Object.assign(s, { status: 'completed', runId: '' }); }, [wid, X]); await p.waitForTimeout(600);
    writes.length = 0;
    await tapOrb(p); await p.waitForTimeout(900);
    await p.evaluate(([w, y]) => __wos.openChat(w, y), [wid, Y]); await p.waitForTimeout(900);
    await tapOrb(p); await p.waitForTimeout(3500);
    const runs = runsOf(writes);
    ok(sessionsOf(writes).length === 0 && runs.length === 1 && runs[0].session_id === X, 'take started in X and sent from Y lands in X', JSON.stringify({ s: sessionsOf(writes).length, runs: runs.map(r => r.session_id), X, Y }));
    ok(await p.evaluate(w => __wos.wins[w].thread, wid) === Y, 'Y stays open (X-started take)');
    ok(errs.length === 0, 'no page errors (6)', errs.join(' | '));
    await ctx.close();
  }
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
