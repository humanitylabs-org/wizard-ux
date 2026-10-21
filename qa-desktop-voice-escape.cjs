// Desktop voice cancel: Escape cancels a live take before it navigates (thread stays open); a cancelled take
// under 20 s leaves nothing to recover; a take cancelled at ≥20 s is kept. Every backend write is intercepted.
// Usage: QA_CHROME=<chrome> node qa-desktop-voice-escape.cjs <origin>/wizard-os-home/
const fs = require('fs');
const pw = require('./tools/qa-playwright.cjs');
const BASE = process.argv[2], OUT = process.env.QA_OUT || '.';
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0; const ok = (c, n, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : JSON.stringify(x)); c ? pass++ : fail++; };
const nap = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await pw.chromium.launch({ executablePath: process.env.QA_CHROME || undefined, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const ctx = await b.newContext({ viewport: { width: 1512, height: 920 }, ignoreHTTPSErrors: true, permissions: ['microphone'], userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36' });
  const writes = [], errors = [];
  await ctx.route('**/*', r => { if (!['GET', 'HEAD'].includes(r.request().method())) { writes.push(r.request().url()); return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); } return r.continue(); });
  const p = await ctx.newPage(); p.on('pageerror', e => errors.push(String(e)));
  await p.addInitScript(() => localStorage.setItem('wos.coached', 'true'));
  await p.goto(BASE); await p.waitForFunction(() => window.__wux?.live?.ok, {}, { timeout: 45000 });
  await p.waitForFunction(() => __wux.live.sessions.length > 0);
  const sid = await p.evaluate(() => __wux.live.sessions.find(s => s.runtime !== 'legacy')?.id);
  await p.evaluate(sid => __wux.openThread(sid), sid);
  await p.waitForFunction(sid => Object.values(__wux.wins).some(w => w.thread === sid), sid); await nap(800);
  const inThread = () => p.evaluate(sid => { const f = __wux.wins[__wux.ws[__wux.cur].focus]; return !!f && f.thread === sid; }, sid);
  const live = () => p.evaluate(() => WosOutbox.recordings().filter(it => it.state !== 'sent').length + [...WosOutbox._items.values()].filter(it => it.kind === 'capture' && it.state !== 'sent').length);
  const kept = () => p.evaluate(() => WosCancelled.list().length);
  const base = await live(), keptBase = await kept();
  ok(await inThread(), 'setup: thread open');

  // 1. Short take, Escape: cancels, stays in thread, nothing recoverable.
  await p.click('#micBtn'); await p.waitForFunction(() => __wux.voice === 'listen'); await nap(3000);
  await p.keyboard.press('Escape'); await nap(900);
  ok(await p.evaluate(() => __wux.voice) === 'idle', 'Escape cancels the recording');
  ok(await inThread(), 'first Escape keeps the thread open');
  ok(await live() === base, 'short cancelled take is deleted, not held for recovery', { base, now: await live() });
  ok(await kept() === keptBase, 'short cancelled take not added to Cancelled recordings');
  ok(await p.locator('.recording-recovery:not([hidden])').count() === 0, 'no recovery panel after a short cancel');
  await p.keyboard.press('Escape'); await nap(500);
  ok(!(await inThread()), 'second Escape leaves the thread as before');

  // 2. Short dictation cancelled with ✕: also nothing kept.
  await p.evaluate(sid => __wux.openThread(sid), sid); await nap(600);
  await p.locator('.win.focus .pane-main textarea').focus();
  await p.click('#dictateBtn'); await p.waitForFunction(() => __wux.voice === 'listen'); await nap(2000);
  await p.click('#voiceCancel'); await nap(900);
  ok(await p.evaluate(() => __wux.voice) === 'idle' && await live() === base && await kept() === keptBase, 'short dictation cancel leaves nothing behind');

  // 3. Long take (≥20 s), Escape: kept as a possible accident.
  await p.click('#micBtn'); await p.waitForFunction(() => __wux.voice === 'listen'); await nap(21500);
  await p.keyboard.press('Escape'); await nap(2500);
  ok(await p.evaluate(() => __wux.voice) === 'idle' && await inThread(), 'long take: Escape cancels and stays in thread');
  ok(await kept() > keptBase, 'long cancelled take kept in Cancelled recordings', { keptBase, now: await kept() });
  await p.screenshot({ path: OUT + '/long-cancel.png' });

  ok(errors.length === 0, 'no page errors', errors); ok(writes.filter(u => !/transcribe|thread-seen/.test(u)).length === 0, 'zero agent sends (writes all intercepted)', writes);
  console.log(JSON.stringify({ pass, fail })); await b.close(); process.exitCode = fail ? 1 : 0;
})().catch(e => { console.log('FAIL crashed', String(e)); process.exitCode = 1; });
