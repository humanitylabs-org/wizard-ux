// Live Mode slice QA on the isolated preview: phone viewport, mockup thumbprint (tap or ~300 ms hold;
// no WebAuthn / real fingerprint, per James), all Hermes/Wizard writes intercepted.
const { chromium } = require('/home/telos/node_modules/playwright');
const BASE = 'https://private.wizard001.com';
let pass = 0, fail = 0;
const ok = (c, name, info = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'} ${name}${!c && info ? ' ' + info : ''}`); };
(async () => {
  const b = await chromium.launch({ args: ['--host-resolver-rules=MAP private.wizard001.com 127.0.0.1:18443'] });
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true });
  const writes = [];
  await ctx.route('**/wizard/hermes/**', r => {
    const m = r.request().method();
    if (m === 'GET') return r.continue();
    writes.push(m + ' ' + new URL(r.request().url()).pathname);
    if (r.request().url().includes('/v1/runs')) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ run_id: 'run_qa_livemode' }) });
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await ctx.route('**/wizard/thread-seen**', r => r.request().method() === 'GET' ? r.continue() : r.fulfill({ status: 200, body: '{}' }));
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => { if (/wizard-os-home/.test(e.stack || '') || !e.stack) errs.push(String(e)); });
  const cdp = await ctx.newCDPSession(p);
  const shots = (n) => p.screenshot({ path: `qa-live/livemode/${n}.png` });
  require('fs').mkdirSync('qa-live/livemode', { recursive: true });
  await p.goto(BASE + '/wizard-os-home-preview/', { waitUntil: 'load' });
  await p.evaluate(() => { try { localStorage.removeItem('livemode.cred'); } catch (e) {} });
  await p.waitForFunction(() => window.__wos && window.LiveMode && window.LiveMode.ambient, null, { timeout: 20000 });
  await p.evaluate(() => { if (document.querySelector('#coach') && !document.querySelector('#coach').hidden) document.querySelector('#coachGo')?.click(); window.__wos.goDesk(window.__wos.HOME); });
  await p.waitForTimeout(3500);
  const st = () => p.evaluate(() => ({ on: LiveMode.on, ambient: LiveMode.ambient, card: !!LiveMode.card, ideas: LiveMode.ideas, words: LiveMode.words, hint: LiveMode.hint, moons: LiveMode.moons.map(m => m.shown || m.state), via: LiveMode.signedVia, native: LiveMode.native, idx: __wos.idx, url: location.href, back: (window.__backLog || []).slice(-4) }));
  let s = await st();
  ok(s.on && s.ambient, 'preview opens Wizard OS Home with Live Mode listening', JSON.stringify(s));
  ok(await p.isVisible('#lmPill') && /preview/i.test(await p.textContent('#lmPill')), 'clear "preview · simulated listening" label');
  ok(s.words > 0, 'faint words drift around the orb', JSON.stringify(s));
  ok(/spread two fingers/.test(s.hint), 'Home hint: spread two fingers', s.hint);

  await shots('01-ambient');

  // A noticed action rises as a card above the orb.
  await p.evaluate(() => LiveMode.simulate());
  await p.waitForFunction(() => LiveMode.card, null, { timeout: 6000 }).catch(() => {});
  await p.waitForTimeout(1300);
  s = await st();
  ok(s.card && /touch the print to send/.test(s.hint), '"Wizard noticed" card rises, hint: touch the print', JSON.stringify(s));
  await shots('02-card');
  // Back closes the card and stays.
  await p.keyboard.press('Escape'); await p.waitForTimeout(700);
  s = await st();
  ok(!s.card && s.url.includes('wizard-os-home-preview') && s.back.includes('live-card'), 'Back closes the card, app stays open', JSON.stringify(s));

  // Quick tap on the print fills the ring and signs. No system sheet, no WebAuthn.
  await p.evaluate(() => { window.__wa = 0; const c = navigator.credentials; if (c) { c.create = () => { window.__wa++; return Promise.reject(new Error('qa')); }; c.get = () => { window.__wa++; return Promise.reject(new Error('qa')); }; } });
  await p.evaluate(() => LiveMode.simulate());
  await p.waitForFunction(() => LiveMode.card, null, { timeout: 6000 }); await p.waitForTimeout(1300);
  await p.tap('#lmPrint'); await p.waitForTimeout(1500);
  s = await st();
  ok(!s.card && s.via === 'tap' && s.moons[0] === 'working', 'a quick tap on the print signs; action becomes a violet moon', JSON.stringify(s));
  ok(await p.evaluate(() => window.__wa === 0), 'no WebAuthn / fingerprint sensor touched');
  ok(writes.length === 0, 'preview action never reaches Archimedes', JSON.stringify(writes));
  await shots('03-moon');
  await p.waitForTimeout(6500);
  s = await st(); ok(s.moons[0] === 'done', 'moon turns green when done', JSON.stringify(s.moons));

  // Hold ~300 ms fills the ring and signs.
  await p.evaluate(() => LiveMode.simulate());
  await p.waitForFunction(() => LiveMode.card, null, { timeout: 6000 }); await p.waitForTimeout(1300);
  { const bb = await p.locator('#lmPrint').boundingBox(); await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await p.mouse.down();
    await p.waitForTimeout(150); const mid = await p.evaluate(() => getComputedStyle(document.querySelector('#lmRing') || document.querySelector('.lm-print circle:last-child')).strokeDashoffset);
    await p.waitForTimeout(350); s = await st(); await p.mouse.up();
    ok(!s.card && s.via === 'hold' && s.moons.length === 2, 'a ~300 ms hold fills the ring and signs (no release needed)', JSON.stringify({ via: s.via, mid })); }
  await p.waitForTimeout(800);
  // A real (non-preview) feed item goes to Archimedes as a thread (intercepted here).
  await p.evaluate(() => LiveMode.feed({ type: 'action', title: 'QA live-mode item', said: 'qa test', source: 'mizel-live' }));
  await p.waitForFunction(() => LiveMode.card, null, { timeout: 6000 }); await p.waitForTimeout(1300);
  await p.tap('#lmPrint'); await p.waitForTimeout(2000);
  s = await st();
  ok(writes.some(w => w.includes('/v1/runs')) && await p.evaluate(() => !!LiveMode.moons[0].sessionId), 'feed action is sent as an Archimedes thread and its moon tracks it', JSON.stringify(writes));

  await p.waitForTimeout(3800);

  // Spread on Home → today's ideas; spread again → detail; Back unwinds to Home, then the exit warning.
  const spread = (from, to) => p.evaluate(([from, to]) => {
    const el = document.querySelector('#lmIdeas.on') || document.elementFromPoint(206, 420) || document.body;
    const T = (id, x, y) => new Touch({ identifier: id, target: el, clientX: x, clientY: y });
    const ev = (type, d) => { const t = d == null ? [] : [T(1, 206 - d / 2, 420), T(2, 206 + d / 2, 420)]; el.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: t, targetTouches: t, changedTouches: t.length ? t : [T(1, 0, 0)] })); };
    ev('touchstart', from); for (let k = 1; k <= 6; k++) ev('touchmove', from + (to - from) * k / 6); ev('touchend', null);
  }, [from, to]);
  await spread(60, 220); await p.waitForTimeout(900);
  s = await st(); ok(s.ideas === 1 && /spread again/.test(s.hint), 'spread on Home shows today\u2019s ideas, hint: spread again', JSON.stringify(s));
  await shots('04-ideas');
  await spread(60, 220); await p.waitForTimeout(1100);
  s = await st(); ok(s.ideas === 2, 'spread again goes one level deeper', JSON.stringify(s));
  await shots('05-ideas-deep');
  await p.keyboard.press('Escape'); await p.waitForTimeout(500);
  s = await st(); ok(s.ideas === 1, 'Back → shallower', JSON.stringify(s));
  await p.keyboard.press('Escape'); await p.waitForTimeout(600);
  s = await st(); ok(s.ideas === 0 && s.idx === 2 && s.url.includes('preview'), 'Back → Home, still open', JSON.stringify(s));
  await p.keyboard.press('Escape'); await p.waitForTimeout(500);
  s = await st(); ok(s.url.includes('preview') && s.back.includes('exit-warn'), 'Back on Home warns before any exit', JSON.stringify(s));
  ok(errs.length === 0, 'no page errors', errs.join(' | '));

  // The live shell is untouched.
  const p2 = await ctx.newPage(); await p2.goto(BASE + '/wizard-os-home/', { waitUntil: 'load' });
  await p2.waitForFunction(() => window.__wos, null, { timeout: 20000 }); await p2.waitForTimeout(1200);
  ok(await p2.evaluate(() => !window.LiveMode.on && !document.querySelector('#lmPill')), 'live /wizard-os-home/ stays without Live Mode');
  console.log(`${pass}/${pass + fail} passed`);
  await b.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.log('Error', e); process.exit(2); });
