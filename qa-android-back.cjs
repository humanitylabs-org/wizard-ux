// Real Android Back on a real Chrome (Thales emulator): CDP for state + trusted taps, adb KEYCODE_BACK for Back.
const { chromium } = require('/home/telos/node_modules/playwright');
const { execSync } = require('child_process');
const OUT = '/home/telos/apps/wizard-os-home/qa-live/android';
require('fs').mkdirSync(OUT, { recursive: true });
const adb = c => execSync(`ssh -o ConnectTimeout=8 thales 'export PATH=$PATH:$HOME/Library/Android/sdk/platform-tools; ${c}'`, { encoding: 'utf8' });
const back = () => adb('adb shell input keyevent 4');
const top = () => (adb('adb shell dumpsys activity activities | grep -m1 topResumedActivity') || '').trim();
const shot = n => { adb(`adb exec-out screencap -p > /tmp/wos-${n}.png`); execSync(`scp -q thales:/tmp/wos-${n}.png ${OUT}/${n}.png`); };
let pass = 0, fail = 0;
const ok = (c, name, d = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${name}${d ? ' — ' + d : ''}`); };
(async () => {
  const b = await chromium.connectOverCDP('http://127.0.0.1:9333');
  // Attach to the tab that is actually on screen; close stale Wizard OS tabs behind it.
  const pages = b.contexts()[0].pages().filter(x => x.url().includes('wizard-os-home') && !x.url().includes('preview'));
  let p = null;
  for (const x of pages) { if (!p && await x.evaluate(() => document.visibilityState === 'visible').catch(() => false)) p = x; }
  p = p || pages.at(-1);
  for (const x of pages) if (x !== p) await x.close().catch(() => {});
  // Never send anything from QA.
  await p.route('**/*', r => ['GET', 'HEAD'].includes(r.request().method()) || r.request().url().endsWith('/wizard/thread-seen') ? r.continue() : r.abort());
  await p.reload(); await p.waitForFunction(() => window.__wos?.live?.ok, null, { timeout: 40000 });
  const cdp = await p.context().newCDPSession(p);
  const tapEl = async sel => {
    const bb = await p.locator(sel).first().boundingBox();
    const pt = [{ x: bb.x + bb.width / 2, y: bb.y + Math.min(bb.height / 2, 30) }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p.waitForTimeout(900);
  };
  const st = () => p.evaluate(() => { const s = __wos, c = Object.values(s.wins).find(w => w.app === 'chats'); return { idx: s.idx, thread: c?.thread || null, sheet: s.sheet, back: s.back, toast: document.querySelector('#toast')?.classList.contains('show') ? document.querySelector('#toast').innerText : '' }; });
  console.log('chrome', await p.evaluate(() => navigator.userAgent.match(/Chrome\/[\d.]+/)[0]), 'CloseWatcher' , await p.evaluate(() => 'CloseWatcher' in window));
  if (await p.isVisible('#coach')) await tapEl('#coachGo');
  await p.evaluate(() => { const c = Object.values(__wos.wins).find(w => w.app === 'chats'); if (c?.thread) __wos.onBack(); __wos.goDesk(1); }); await p.waitForTimeout(1200);
  await tapEl('.desk[data-desk="1"] .ch-row');
  await p.waitForTimeout(1500);
  let s = await st(); ok(!!s.thread, 'tap opens a thread in Chats', JSON.stringify(s)); shot('a-thread');
  back(); await p.waitForTimeout(1200);
  s = await st(); ok(/chrome/.test(top()) && p.url().includes('wizard-os-home') && !s.thread && s.idx === 1, 'REAL Back from a thread → thread list, app still open', JSON.stringify(s)); shot('b-list');
  back(); await p.waitForTimeout(1200);
  s = await st(); ok(/chrome/.test(top()) && s.idx === 2, 'second Back (no tap between) → Home desk, still open', JSON.stringify(s)); shot('c-home');
  back(); await p.waitForTimeout(500);
  s = await st(); ok(/chrome/.test(top()) && p.url().includes('wizard-os-home') && /back again/i.test(s.toast), 'Back on Home → "Press back again to exit", stays', JSON.stringify(s)); shot('d-warn');
  await p.waitForTimeout(3000);
  // Sheet path with a tap: open inbox, Back closes it.
  await p.evaluate(() => __wos.openSheet('inbox')); await p.waitForTimeout(600); await tapEl('#inbox .sheet-grip');
  const open = (await st()).sheet;
  back(); await p.waitForTimeout(1000);
  s = await st(); ok(open === 'inbox' && /chrome/.test(top()) && !s.sheet && s.back.log.at(-1) === 'sheet', 'Back closes the inbox sheet, stays', JSON.stringify({ open, ...s }));
  await p.waitForTimeout(2500);
  back(); await p.waitForTimeout(400);
  s = await st(); ok(/chrome/.test(top()) && /back again/i.test(s.toast), 'Back on Home warns again after the window lapses', JSON.stringify(s));
  console.log(`${pass}/${pass + fail} passed`);
  await b.close().catch(() => {});
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
