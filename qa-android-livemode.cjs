// Live Mode on real Android Chrome (Thales emulator): a real tap on the mockup print signs (no WebAuthn,
// no fingerprint sheet), the action becomes a moon, Back still never exits, and QA makes zero real Archimedes writes.
const { chromium } = require('/home/telos/node_modules/playwright');
const { execSync } = require('child_process');
const fs = require('fs');
const OUT = __dirname + '/qa-live/android';
fs.mkdirSync(OUT, { recursive: true });
const adb = c => execSync(`ssh thales 'export PATH=$PATH:$HOME/Library/Android/sdk/platform-tools; export ANDROID_SERIAL=emulator-5554; ${c}'`, { encoding: 'utf8', timeout: 60000 });
const shot = n => { try { adb('adb exec-out screencap -p > /tmp/lm.png'); execSync(`scp -q thales:/tmp/lm.png ${OUT}/${n}.png`); } catch (e) {} };
const top = () => adb('adb shell dumpsys activity activities | grep -m1 topResumedActivity');
let pass = 0, fail = 0;
const ok = (c, m, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${m}${d ? ' — ' + String(d).slice(0, 220) : ''}`); };
(async () => {
  adb('adb shell am force-stop com.android.chrome; adb shell input keyevent KEYCODE_WAKEUP; adb shell wm dismiss-keyguard; sleep 1; adb shell am start -a android.intent.action.VIEW -d "https://private.wizard001.com/wizard-os-home-preview/?demo=1" com.android.chrome >/dev/null; sleep 7; adb forward tcp:9333 localabstract:chrome_devtools_remote >/dev/null');
  const b = await chromium.connectOverCDP('http://127.0.0.1:9333');
  const pages = b.contexts()[0].pages();
  let p = null;
  for (const x of pages) { const v = await x.evaluate(() => document.visibilityState).catch(() => 'gone'); if (v === 'visible' && x.url().includes('wizard-os-home-preview')) p = x; }
  for (const x of pages) if (x !== p) await x.close().catch(() => {});
  if (!p) throw new Error('no visible preview tab');
  await p.bringToFront();
  const writes = [];
  await p.route(/\/wizard\/(hermes\/(v1\/runs|api\/sessions)|thread-seen)/, r => {
    if (r.request().method() === 'GET') return r.continue();
    writes.push(r.request().method() + ' ' + r.request().url()); return r.fulfill({ status: 503, body: '{"error":"qa"}' });
  });
  await p.waitForFunction(() => window.__wos && window.LiveMode && LiveMode.on, null, { timeout: 30000 });
  if (await p.isVisible('#coach')) await p.evaluate(() => document.querySelector('#coachGo')?.click());
  const ua = await p.evaluate(() => navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0]);
  await p.evaluate(() => { window.__wa = 0; const c = navigator.credentials; if (c) { c.create = () => { window.__wa++; return Promise.reject(new Error('qa')); }; c.get = () => { window.__wa++; return Promise.reject(new Error('qa')); }; } __wos.goDesk(2); });
  await p.waitForTimeout(800);
  // The card rises from a noticed action.
  await p.evaluate(() => { LiveMode.pauseSim && LiveMode.pauseSim(); if (LiveMode.card) __wos.onBack(); });
  await p.waitForTimeout(600);
  await p.evaluate(() => LiveMode.feed({ type: 'action', source: 'preview', title: 'QA · Android sign check', detail: 'Android check' }));
  await p.waitForFunction(() => !!LiveMode.card, null, { timeout: 8000 }).catch(() => {}); await p.waitForTimeout(700);
  let s = await p.evaluate(() => ({ card: !!LiveMode.card, hint: LiveMode.hint, via: LiveMode.signedVia, moons: LiveMode.moons.map(m => ({ title: m.title, status: m.shown || m.state })) }));
  ok(s.card && /touch the print/.test(s.hint), '"Wizard noticed" card rises with its hint', JSON.stringify(s));
  shot('lm-1-card');
  // Real tap on the print (trusted touch through adb) → real Android biometric sheet.
  const r = await p.evaluate(() => { const e = document.querySelector('#lmPrint').getBoundingClientRect(); return { x: e.left + e.width / 2, y: e.top + e.height / 2, dpr: devicePixelRatio, vh: innerHeight, sh: screen.height }; });
  // Chrome's toolbar sits above the web viewport; the gesture bar sits below. Find the viewport's top on screen.
  const [, SW, SH] = adb('adb shell wm size').match(/(\d+)x(\d+)/).map(Number);
  const nb = adb('adb shell dumpsys window | grep -m1 -o "navigationBars frame=.[0-9,]*.\\[[0-9,]*\\]" || true').match(/frame=\[\d+,(\d+)\]/);
  const navH = nb ? Number(nb[1]) : SH;
  const topY = (navH < SH ? navH : SH) - r.vh * r.dpr;
  adb(`adb shell input tap ${Math.round(r.x * r.dpr)} ${Math.round(topY + r.y * r.dpr)}`);
  await p.waitForTimeout(1500);
  const dump = adb('adb shell uiautomator dump /sdcard/u.xml >/dev/null; adb shell cat /sdcard/u.xml');
  ok(!/Touch the fingerprint sensor|Use your screen lock|verify it.s you/i.test(dump), 'no system fingerprint sheet (mockup print, per James)');
  shot('lm-2-signed');
  s = await p.evaluate(() => ({ card: !!LiveMode.card, hint: LiveMode.hint, via: LiveMode.signedVia, moons: LiveMode.moons.map(m => ({ title: m.title, status: m.shown || m.state })) }));
  ok(s.via === 'tap' || s.via === 'hold', 'a real tap on the print fills the ring and signs', s.via);
  ok(await p.evaluate(() => window.__wa === 0), 'WebAuthn never called');
  ok(s.moons.some(m => /QA · Android sign check/.test(m.title)), 'the action became a moon', JSON.stringify(s.moons));
  ok(!s.card, 'card closed after signing');
  shot('lm-3-moon');
  // Back still never exits (real KEYCODE_BACK).
  await p.evaluate(() => LiveMode.feed({ type: 'action', source: 'preview', title: 'QA · Back test card', detail: '' })); await p.waitForFunction(() => !!LiveMode.card, null, { timeout: 8000 }).catch(() => {}); await p.waitForTimeout(500);
  adb('adb shell input keyevent KEYCODE_BACK'); await p.waitForTimeout(1200);
  s = await p.evaluate(() => ({ card: !!LiveMode.card, hint: LiveMode.hint, via: LiveMode.signedVia, moons: LiveMode.moons.map(m => ({ title: m.title, status: m.shown || m.state })) }));
  ok(!s.card && /chrome/.test(top()) && p.url().includes('wizard-os-home-preview'), 'REAL Back closes the card, app stays open', JSON.stringify({ card: s.card }));
  const before = await p.evaluate(() => ({ idx: __wos.idx, log: (window.__backLog || []).slice(-5), back: __wos.back }));
  adb('adb shell input keyevent KEYCODE_BACK'); await p.waitForTimeout(900);
  const after = await p.evaluate(() => ({ idx: __wos.idx, log: (window.__backLog || []).slice(-5) })).catch(e => ({ gone: e.message.slice(0, 60) }));
  const toast = await p.evaluate(() => document.querySelector('#toast')?.textContent || '');
  ok(/chrome/.test(top()) && /back again/i.test(toast), 'REAL Back on Home warns before any exit', toast + ' ' + JSON.stringify({ before, after }));
  shot('lm-4-warn');
  ok(!writes.some(w => /\/v1\/runs|\/api\/sessions/.test(w)), 'QA produced zero real Archimedes runs or threads', JSON.stringify(writes));
  console.log(`${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('Error', e.message); process.exit(2); });
