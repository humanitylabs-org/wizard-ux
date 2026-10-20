// Desktop voice capture chrome: recording never moves the window; a compact top-centre pill shows the
// timer; a click-through synthwave edge glow lights the screen. Every backend write is intercepted.
// Usage: QA_CHROME=<chrome> node qa-desktop-voice-glow.cjs <origin>/wizard-os-home/
const fs = require('fs');
let pw; for (const m of [process.env.QA_PLAYWRIGHT, 'playwright', 'playwright-core'].filter(Boolean)) { try { pw = require(m); break; } catch {} }
const BASE = process.argv[2], OUT = process.env.QA_OUT || '.';
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0; const ok = (c, n, x = '') => { console.log(c ? 'PASS' : 'FAIL', n, c ? '' : JSON.stringify(x)); c ? pass++ : fail++; };
(async () => {
  const b = await pw.chromium.launch({ executablePath: process.env.QA_CHROME || undefined, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const ctx = await b.newContext({ viewport: { width: 1512, height: 920 }, ignoreHTTPSErrors: true, permissions: ['microphone'], userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36' });
  const writes = [], errors = [];
  await ctx.route('**/*', r => { if (!['GET', 'HEAD'].includes(r.request().method())) { writes.push(r.request().url()); return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); } return r.continue(); });
  const p = await ctx.newPage(); p.on('pageerror', e => errors.push(String(e)));
  await p.addInitScript(() => localStorage.setItem('wos.coached', 'true'));
  await p.goto(BASE); await p.waitForFunction(() => window.__wux?.live?.ok, {}, { timeout: 45000 });
  await p.waitForTimeout(800);
  const rect = sel => p.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, sel);
  const stage0 = await rect('#stage');
  await p.screenshot({ path: OUT + '/0-idle.png' });
  await p.click('#micBtn'); await p.waitForFunction(() => __wux.voice === 'listen'); await p.waitForTimeout(2300);
  const pill = await rect('#voicePill'), stage1 = await rect('#stage');
  ok(stage1.y === stage0.y && stage1.h === stage0.h, 'talk: window does not move or resize while recording', { stage0, stage1 });
  ok(pill.h <= 30 && pill.y >= 0 && pill.y + pill.h <= 34, 'talk: pill fits inside the 34px top bar', pill);
  ok(Math.abs(pill.x + pill.w / 2 - 756) <= 2 && pill.w <= 420, 'talk: pill is centred and compact', pill);
  ok(/^0:0[12]$/.test(await p.textContent('#voiceTime')), 'talk: timer counts', await p.textContent('#voiceTime'));
  const glow = await p.evaluate(() => { const g = document.getElementById('voiceGlow'), cs = getComputedStyle(g); return { on: document.documentElement.classList.contains('voice-on'), op: +cs.opacity, pe: cs.pointerEvents, z: +cs.zIndex, img: getComputedStyle(g, '::before').borderImageSource.slice(0, 20) }; });
  ok(glow.on && glow.op > .9 && glow.pe === 'none' && /conic/.test(glow.img), 'talk: synthwave edge glow on and click-through', glow);
  ok(await p.evaluate(() => getComputedStyle(document.querySelector('#voicePill .voice-tray')).visibility) === 'hidden', 'talk: controls tray hidden until hover');
  ok(await p.isVisible('#voiceCancel'), 'talk: Cancel always reachable');
  await p.screenshot({ path: OUT + '/1-talk.png' });
  await p.screenshot({ path: OUT + '/1-talk-top.png', clip: { x: 456, y: 0, width: 600, height: 120 } });
  await p.hover('#voicePill'); await p.waitForTimeout(250);
  const tray = await rect('#voicePill .voice-tray');
  ok(await p.isVisible('#voicePause') && await p.isVisible('#voiceSend') && tray.y + tray.h < 120, 'hover: Pause/Finish/Attach/Screenshot tray drops in below the pill', tray);
  await p.screenshot({ path: OUT + '/2-hover.png', clip: { x: 406, y: 0, width: 700, height: 140 } });
  await p.click('#voicePause'); await p.waitForFunction(() => __wux.voice === 'paused');
  ok(await p.evaluate(() => document.documentElement.classList.contains('voice-paused')), 'pause: glow dims');
  await p.mouse.move(700, 600); await p.waitForTimeout(250);
  await p.screenshot({ path: OUT + '/3-paused.png' });
  // Clicks reach the window under the glow edge while recording.
  const hit = await p.evaluate(() => document.elementFromPoint(4, 500)?.id !== 'voiceGlow');
  ok(hit, 'glow never intercepts clicks at the screen edge');
  await p.click('#voiceCancel'); await p.waitForFunction(() => __wux.voice === 'idle'); await p.waitForTimeout(450);
  ok(await p.evaluate(() => !document.documentElement.classList.contains('voice-on') && +getComputedStyle(document.getElementById('voiceGlow')).opacity < .05 && document.getElementById('voicePill').hidden), 'cancel: pill and glow gone');
  // Dictation flavour
  await p.click('#dictateBtn'); await p.waitForFunction(() => __wux.voice === 'listen'); await p.waitForTimeout(1300);
  ok(await p.evaluate(() => document.getElementById('voicePill').classList.contains('dict')) && (await rect('#stage')).y === stage0.y, 'dictate: compact pill, window unmoved');
  await p.screenshot({ path: OUT + '/4-dictate.png' });
  await p.click('#voiceCancel'); await p.waitForFunction(() => __wux.voice === 'idle');
  // Narrow window
  await p.setViewportSize({ width: 480, height: 800 }); await p.waitForTimeout(300);
  await p.click('#micBtn'); await p.waitForFunction(() => __wux.voice === 'listen'); await p.waitForTimeout(600);
  const np = await rect('#voicePill');
  ok(np.x >= 0 && np.x + np.w <= 480 && np.y + np.h <= 34, 'narrow 480px: pill fits', np);
  await p.screenshot({ path: OUT + '/5-narrow.png' });
  await p.click('#voiceCancel');
  ok(errors.length === 0, 'no page errors', errors); ok(writes.length === 0, 'zero writes', writes);
  console.log(JSON.stringify({ pass, fail })); await b.close(); process.exitCode = fail ? 1 : 0;
})().catch(e => { console.log('FAIL crashed', String(e)); process.exitCode = 1; });
