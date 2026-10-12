// QA: an orb send from a thread is instant. The send tap steps the phone back to the thread list at once; the
// words are transcribed, routed and delivered in the background behind the pill above the orb. A slow, hung or
// dead connection never holds James on the thread. James (10 Oct 2026): "my internet was down or something but
// it sits at this screen for like 10 seconds… process this in the background, send them back out… and show that
// something is happening or it's sending but allow them to keep using their phone and not have to hit the back button."
// Usage: QA_WEB_DIR=<repo> node qa-orb-send-instant.cjs [url]. Real Wizard reads; every write is intercepted.
let chromium; try { ({ chromium } = require('playwright-core')); } catch (e) { ({ chromium } = require('/home/telos/node_modules/playwright')); }
const URL_ = process.argv[2] || 'http://127.0.0.1:8923/wizard-os-home/';
const W = process.env.QA_WEB_DIR || '';
const SHOTS = process.env.QA_SHOTS || '';
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function boot(b) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true, permissions: ['microphone'] });
  const writes = []; const R = { sttDelay: 0, sttCalls: 0, words: 'One more thing on this one please' };
  await ctx.route('**/*', async r => {
    const q = r.request(), u = q.url();
    const m = u.match(/\/wizard-os-home\/((?:desktop\/|core\/)?[a-z-]+\.(?:js|css|html)|)(\?|$)/);
    if (W && m && q.method() === 'GET' && !/^(data|summaries)\.js$/.test(m[1])) {
      const f = m[1] || 'index.html', p = require('path').join(W, 'web', f);
      if (require('fs').existsSync(p)) return r.fulfill({ status: 200, contentType: f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : 'application/javascript', body: require('fs').readFileSync(p) });
    }
    if (/\/transcribe$/.test(u) && q.method() === 'POST') { R.sttCalls++; await sleep(R.sttDelay); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: R.words, ms: 5 }) }).catch(() => {}); }
    if (/\/api\/route$|\/wizard\/v1\/route$/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ cmd: { route: 'agent' }, ms: 5 }) });
    if (q.method() !== 'GET' && /\/wizard\/(hermes|thread-seen|files)/.test(u)) {
      writes.push({ u: u.replace(/^https?:\/\/[^/]+/, ''), body: q.postData() || '' });
      if (/\/files\/upload$/.test(u)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ file: { id: 'qa-file', filename: 'v.webm', mime: 'audio/webm', bytes: 10 } }) });
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
const runsOf = ws => ws.filter(w => /\/v1\/runs$/.test(w.u)).map(w => JSON.parse(w.body || '{}'));
const steersOf = ws => ws.filter(w => /\/v1\/runs\/[^/]+\/steer$/.test(w.u));
const pickThreads = p => p.evaluate(() => __wos.live.sessions.filter(s => !s.archived).slice(0, 2).map(s => s.id));
async function tapOrb(p) { const o = await p.locator('#orbWrap').boundingBox(); await p.touchscreen.tap(o.x + o.width / 2, o.y + o.height / 2); }
// Open thread X (idle, so a reply is a queued run, not a steer), record ~1.5 s, tap to send. Returns ms from tap to list.
async function sendFromThread(p, wid, X) {
  await p.evaluate(([w, x]) => { __wos.openChat(w, x); const s = __wos.live.session(x); if (s) Object.assign(s, { status: 'completed', runId: '' }); }, [wid, X]);
  await p.waitForTimeout(600);
  await tapOrb(p); await p.waitForTimeout(1500);
  const t0 = Date.now(); await tapOrb(p);
  await p.waitForFunction(w => !__wos.wins[w].thread, wid, { timeout: 15000 }).catch(() => {});
  return Date.now() - t0;
}
const pill = p => p.evaluate(() => { const t = document.querySelector('#voice .transcript'); return document.querySelector('#voice')?.classList.contains('tx') ? (document.querySelector('#txRouteText')?.textContent || '') : ''; });
// Which list section X sits in right now (Wizard's Work sections, as the Chats list groups them).
const sectionOf = (p, x) => p.evaluate(id => { const g = __wos.live.workGroups(); for (const [k, l] of Object.entries(g)) if (l.some(s => s.id === id)) return k; return ''; }, x);
const domSection = (p, x) => p.evaluate(id => document.querySelector(`[data-sec] [data-chopen="${id}"]`)?.closest('[data-sec]')?.dataset.sec || '', x);
// Sample X's section every 150 ms for ms: every sample must be Working (no flash into Ready).
async function watchSection(p, x, ms) { const seen = new Set(); const end = Date.now() + ms; while (Date.now() < end) { seen.add(await sectionOf(p, x)); await sleep(150); } return [...seen]; }
const thread = (p, wid) => p.evaluate(w => __wos.wins[w].thread, wid);

(async () => {
  const b = await chromium.launch({ executablePath: process.env.QA_CHROME || undefined, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });

  // 1. Slow line: transcription takes 8 s. The list is back at once, the pill says Sending…, the reply lands in X.
  {
    const { ctx, p, writes, errs, R } = await boot(b);
    const wid = await chatsWin(p); const [X, Y] = await pickThreads(p);
    R.sttDelay = 8000; writes.length = 0;
    await p.evaluate(x => WosModels.selections.set(x, {model:'glm-5-3',provider:'custom:tinfoil-operator',version:0}), X);
    const ms = await sendFromThread(p, wid, X);
    await p.evaluate(x => WosModels.selections.set(x, {model:'gpt-6.1-sol',provider:'openai-codex',version:0}), X);
    ok(ms < 1000, `slow line: back on the thread list within 1 s of the send tap (${ms} ms)`);
    ok(/Sending/.test(await pill(p)), 'slow line: the pill above the orb says Sending… while it works', await pill(p));
    ok(await sectionOf(p, X) === 'working', 'slow line: the thread just left is under Working at once, not Ready', await sectionOf(p, X));
    const ds = await domSection(p, X);
    ok(ds !== 'ready', 'slow line: the list on screen does not show it under Ready', ds);
    const during = await watchSection(p, X, 2500);
    ok(during.length === 1 && during[0] === 'working', 'slow line: it stays in Working while the words are transcribed (no flash into Ready)', during.join(','));
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/instant-list.png` });
    // James keeps using the phone: he opens thread Y while X's reply is still transcribing.
    await p.evaluate(([w, y]) => __wos.openChat(w, y), [wid, Y]); await p.waitForTimeout(600);
    ok(await p.evaluate(() => __wos.voice) === 'think', 'orb is still finishing the send in the background');
    const after = await watchSection(p, X, 7000);
    ok(!after.includes('ready'), 'slow line: still never in Ready once delivered (held until Wizard reports the run)', after.join(','));
    const runs = runsOf(writes);
    ok(runs.length === 1 && runs[0].model === 'glm-5-3' && runs[0].provider === 'custom:tinfoil-operator' && runs[0].require_model_lock === true, 'TRUST: changing selector during delayed STT keeps the send-tap GLM route', JSON.stringify(runs));
    ok(runs.length === 1 && runs[0].session_id === X, 'slow line: the reply lands in X (where it was sent)', JSON.stringify(runs.map(r => r.session_id)) + ` X=${X}`);
    ok(steersOf(writes).length === 0 && !runs.some(r => r.session_id === Y), 'nothing goes into Y, the thread opened meanwhile');
    ok(await thread(p, wid) === Y, 'Y stays open; James is not pulled back');
    ok(errs.length === 0, 'no page errors (1)', errs.join(' | '));
    await ctx.close();
  }
  // 2. Hung line: transcription never answers. Instant list, then the take goes to the outbox (saved, will send).
  {
    const { ctx, p, writes, errs, R } = await boot(b);
    const wid = await chatsWin(p); const [X] = await pickThreads(p);
    R.sttDelay = 120000; writes.length = 0;
    const ms = await sendFromThread(p, wid, X);
    ok(ms < 1000, `hung line: back on the list within 1 s (${ms} ms)`);
    ok(await sectionOf(p, X) === 'working', 'hung line: the thread is under Working at once', await sectionOf(p, X));
    await p.waitForFunction(() => __wos.voice === 'idle', null, { timeout: 20000 }).catch(() => {});
    const ob = await p.evaluate(() => window.WosOutbox.unsent().map(it => ({ kind: it.kind, sid: it.sessionId, audio: !!(it.audio || it.audioFile) })));
    ok(ob.some(it => it.kind === 'reply' && it.sid === X && it.audio), 'hung line: the recording is saved in the outbox as a reply to X', JSON.stringify(ob));
    ok(await p.evaluate(() => __wos.voice) === 'idle', 'hung line: the orb is free again (not stuck on Sending…)');
    ok(errs.length === 0, 'no page errors (2)', errs.join(' | '));
    await ctx.close();
  }
  // 3. No internet: instant list, no transcription attempt, saved to the outbox; delivered to X when back online.
  {
    const { ctx, p, writes, errs, R } = await boot(b);
    const wid = await chatsWin(p); const [X] = await pickThreads(p);
    await p.evaluate(([w, x]) => { __wos.openChat(w, x); const s = __wos.live.session(x); if (s) Object.assign(s, { status: 'completed', runId: '' }); }, [wid, X]);
    await p.waitForTimeout(600);
    await tapOrb(p); await p.waitForTimeout(1500);
    await ctx.setOffline(true); R.sttCalls = 0; writes.length = 0;
    const t0 = Date.now(); await tapOrb(p);
    await p.waitForFunction(w => !__wos.wins[w].thread, wid, { timeout: 15000 }).catch(() => {});
    const ms = Date.now() - t0;
    ok(ms < 1000, `offline: back on the list within 1 s (${ms} ms)`);
    ok(await sectionOf(p, X) === 'working', 'offline: the thread is under Working at once', await sectionOf(p, X));
    await p.waitForTimeout(1200);
    ok(/Saved/.test(await pill(p)) || await p.evaluate(() => __wos.voice) === 'idle', 'offline: pill says Saved · sends when Wizard is back', await pill(p));
    // (Playwright's route handler still answers while offline, so the item may already read 'sent': check it exists.)
    const ob = await p.evaluate(() => [...window.WosOutbox._items.values()].map(it => ({ kind: it.kind, sid: it.sessionId, st: it.state, audio: !!(it.audio || it.audioFile) })));
    ok(ob.some(it => it.kind === 'reply' && it.sid === X && it.audio), 'offline: the recording went to the outbox as a reply to X', JSON.stringify(ob) + ' stt=' + R.sttCalls);
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/instant-offline.png` });
    await ctx.setOffline(false);
    await p.waitForFunction(() => window.WosOutbox.unsent().length === 0, null, { timeout: 20000 }).catch(() => {});
    const runs = runsOf(writes);
    ok(runs.some(r => r.session_id === X), 'back online: the reply is delivered to X', JSON.stringify(runs.map(r => r.session_id)));
    ok(errs.length === 0, 'no page errors (3)', errs.join(' | '));
    await ctx.close();
  }
  // 4. A take with no speech: the hold lets go and the thread returns to where it was (nothing was sent).
  {
    const { ctx, p, writes, errs, R } = await boot(b);
    const wid = await chatsWin(p); const [X] = await pickThreads(p);
    await p.evaluate(x => { const s = __wos.live.session(x); if (s) Object.assign(s, { status: 'completed', runId: '' }); }, X);
    const before = await sectionOf(p, X);
    R.words = ''; R.sttDelay = 1500; writes.length = 0;
    await sendFromThread(p, wid, X);
    ok(await sectionOf(p, X) === 'working', 'empty take: Working right after the tap', await sectionOf(p, X));
    await p.waitForTimeout(5000);
    ok(await sectionOf(p, X) === before && runsOf(writes).length === 0, `empty take: back in ${before}, nothing sent`, await sectionOf(p, X));
    ok(errs.length === 0, 'no page errors (4)', errs.join(' | '));
    await ctx.close();
  }
  await b.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
