// QA: onboarding skin picker (core/skins.js + tour beat 0). James, 11 Oct 2026: skins must be the SAME shell —
// same layout, sizes, gestures — only re-dressed. Asserts:
//  1 ?view=skin opens the picker on the real Home; layout boxes (clock, cards, dock, orb) are identical in every skin
//  2 swiping blends (mid-swipe tokens are between two skins) and lands on each of the six skins
//  3 hold "Wear" commits, persists wos.skin, and the real tour continues at beat 1 in that skin
//  4 Back from beat 1 returns to the picker; Back in the picker skips and restores the previous skin
//  5 reload keeps the chosen skin; Nebula sets no inline tokens (original look untouched)
//  6 zero agent writes, zero page errors
// Usage: node qa-skins.cjs [origin=http://127.0.0.1:9561/wizard-os-home/]   QA_SHOTS=<dir>
let pw; try { pw = require('/home/telos/node_modules/playwright'); } catch (e) { pw = require('playwright-core'); }
const URL_ = process.argv[2] || 'http://127.0.0.1:9561/wizard-os-home/';
const ORIGIN = new URL(URL_).origin;
const SHOTS = process.env.QA_SHOTS || '/home/telos/.hermes/cache/scratch/qa-skins'; require('fs').mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0; const ok = (c, n, x = '') => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n, x); };
(async () => {
  const b = await pw.chromium.launch({ executablePath: process.env.QA_CHROME || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true });
  const writes = [];
  await ctx.route('**/*', r => { const q = r.request(), u = new URL(q.url()); if (q.method() === 'GET' || q.method() === 'HEAD' || u.origin !== ORIGIN) return r.continue(); writes.push(q.method() + ' ' + u.pathname); return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); });
  // Returning user (first run already done): only the ?view=skin link may open the picker.
  await ctx.addInitScript(() => { try { if (location.protocol.startsWith('http')) localStorage.setItem('wos.coached', 'true'); } catch (e) {} });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto(URL_ + '?view=skin'); await p.waitForTimeout(3500);
  const st = () => p.evaluate(() => ({ picking: WosTour.picking, active: WosTour.active, step: WosTour.step, skin: document.documentElement.dataset.skin, pos: WosSkin.pos, chosen: WosSkin.chosen, name: document.querySelector('.sk-name')?.textContent, ink: getComputedStyle(document.documentElement).getPropertyValue('--ink').trim(), inline: document.documentElement.getAttribute('style') || '' }));
  const boxes = () => p.evaluate(() => Object.fromEntries(['.home-time', '.home-date', '.home-line', '.now-card', '#dock', '#orbWrap'].map(s => { const r = document.querySelector(s)?.getBoundingClientRect(); return [s, r ? [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(',') : null]; })));
  let s = await st(); ok(s.picking && s.active && s.skin === 'nebula' && s.name === 'Nebula', '?view=skin opens the picker on Home (Nebula)', JSON.stringify(s));
  ok(!s.inline.includes('--ink'), 'Nebula sets no inline tokens (original look untouched)');
  const base = await boxes(); await p.screenshot({ path: SHOTS + '/0-nebula.png' });
  const names = ['Nebula', 'Grove', 'Paper', 'Tide', 'Ember', 'Signal'];
  const swipe = async (dx, mid, y = 700) => { await p.mouse.move(206 + (dx < 0 ? 120 : -120), y); await p.mouse.down(); for (let k = 1; k <= 8; k++) { await p.mouse.move(206 + (dx < 0 ? 120 : -120) + dx * k / 8, y); await p.waitForTimeout(16); if (mid && k === 4) await mid(); } await p.mouse.up(); await p.waitForTimeout(900); };
  for (let i = 1; i < 6; i++) {
    let midInk = null;
    await swipe(-240, async () => { midInk = (await st()).ink; });
    s = await st(); ok(s.name === names[i] && s.skin === names[i].toLowerCase(), `swipe → ${names[i]}`, JSON.stringify({ name: s.name, skin: s.skin, pos: s.pos }));
    if (i === 1) ok(midInk && /rgba/.test(midInk), 'mid-swipe tokens are blended', midInk);
    const bx = await boxes(); const diff = Object.keys(base).filter(k => k !== '.home-time' && base[k] !== bx[k]);
    ok(diff.length === 0, `${names[i]}: same layout boxes as Nebula`, diff.map(k => `${k} ${base[k]} → ${bx[k]}`).join(' | '));
    const ht = [base['.home-time'], bx['.home-time']].map(v => v.split(',').map(Number)); ok(ht[0][0] === ht[1][0] && ht[0][1] === ht[1][1] && Math.abs(ht[0][3] - ht[1][3]) <= 14, `${names[i]}: clock in the same place`, `${base['.home-time']} → ${bx['.home-time']}`);
    await p.waitForTimeout(600); await p.screenshot({ path: SHOTS + `/${i}-${names[i].toLowerCase()}.png` });
  }
  const bg = await p.evaluate(() => ({ a: getComputedStyle(document.getElementById('skinA')).opacity, space: getComputedStyle(document.querySelector('.stars')).opacity }));
  ok(+bg.a > .9 && +bg.space < .05, 'skin background on, space layers off', JSON.stringify(bg));
  // dot jump to Grove, then hold to wear
  await p.evaluate(() => document.querySelector('.sk-dots b[data-sk="1"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))); await p.waitForTimeout(1200);
  s = await st(); ok(s.name === 'Grove', 'dot jumps to Grove', s.name);
  const w = await p.locator('.sk-wear').boundingBox();
  await p.mouse.move(w.x + w.width / 2, w.y + w.height / 2); await p.mouse.down(); await p.waitForTimeout(200); await p.mouse.up(); await p.waitForTimeout(300);
  ok((await st()).picking, 'a short press does not choose');
  await p.mouse.down(); await p.waitForTimeout(950); await p.mouse.up(); await p.waitForTimeout(1300);
  s = await st(); ok(!s.picking && s.active && s.step === 1 && s.chosen === 'grove' && s.skin === 'grove', 'hold → wears Grove, tour continues at beat 1', JSON.stringify(s));
  await p.screenshot({ path: SHOTS + '/7-beat1-grove.png' });
  // Back: beat 1 → picker; picker → skip (restores chosen)
  await p.evaluate(() => window.__wosNativeBack()); await p.waitForTimeout(500);
  s = await st(); ok(s.picking, 'Back at beat 1 → back to the picker', JSON.stringify(s));
  { const wb = await p.locator('.sk-wear').boundingBox(); await swipe(-240, null, wb.y + wb.height / 2); }
  s = await st(); ok(s.name === 'Paper' && s.picking, 'a swipe that starts on Wear browses (→ Paper), never wears', JSON.stringify({ name: s.name, chosen: s.chosen }));
  await p.evaluate(() => window.__wosNativeBack()); await p.waitForTimeout(600);
  s = await st(); ok(!s.active && s.skin === 'grove' && s.chosen === 'grove', 'Back in picker skips and restores the worn skin', JSON.stringify(s));
  ok(await p.evaluate(() => !!document.querySelector('#orbWrap')), 'app still open after Back');
  await p.reload(); await p.waitForTimeout(3000);
  s = await st(); ok(s.skin === 'grove' && /--ink/.test(s.inline), 'reload keeps Grove', JSON.stringify({ skin: s.skin }));
  await p.screenshot({ path: SHOTS + '/8-reload-grove.png' });
  // Help sheet offers Change skin
  await p.evaluate(() => WosTour.openHelp()); await p.waitForTimeout(500);
  ok(await p.locator('[data-hsskin]').count() === 1, 'Help sheet has Change skin');
  await p.locator('[data-hsskin]').click(); await p.waitForTimeout(800);
  s = await st(); ok(s.picking && s.name === 'Grove', 'Change skin reopens the picker on the worn skin', JSON.stringify(s));
  ok(!writes.some(x => /\/v1\/runs|\/api\/sessions/.test(x)), 'zero agent writes', writes.join(','));
  ok(errs.length === 0, 'zero page errors', errs.join(' | '));
  // Fresh install: the picker is the tour's first step without any link.
  const c2 = await b.newContext({ viewport: { width: 412, height: 892 }, hasTouch: true, isMobile: true });
  await c2.route('**/*', r => ['GET', 'HEAD'].includes(r.request().method()) ? r.continue() : r.fulfill({ status: 200, body: '{}' }));
  const p2 = await c2.newPage(); await p2.goto(URL_); await p2.waitForTimeout(3500);
  ok(await p2.evaluate(() => WosTour.picking && WosTour.active), 'fresh install: tour opens on Choose your skin');
  await b.close(); console.log(`\n${pass} pass, ${fail} fail`); process.exit(fail ? 1 : 0);
})();
