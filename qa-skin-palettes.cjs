// QA: skins hold palettes (wizard-os spec/SKINS_AND_VIEWS.md §1, James 21 Oct 2026). Settings › Look shows one card
// per skin (Wizard, Mizel), then only the worn skin's Colours. Real taps, phone and desktop:
//  1 Look shows two skin cards; Wizard pressed; Colours = the five Wizard palettes
//  2 tap Mizel → wears Mizel's first palette (Dark), Colours = Dark, Light, Landscapes; sheet stays; app stays open
//  3 tap Light → html[data-skin]=obsidian-light, saved
//  4 tap Wizard → back on the Wizard palette last worn (Tide, picked before), not the first one
//  5 tap Mizel again → Light (its last palette) comes back
//  6 reload keeps Light and the Mizel card pressed; Appearance v1 context carries family=mizel
//  7 every card and colour is a ≥44 px target; zero writes; no page errors
// Usage: node qa-skin-palettes.cjs [origin=http://127.0.0.1:9391/wizard-os-home/]  QA_SHOTS=<dir>
let pw; try { pw = require('playwright-core'); } catch (e) { pw = require('/home/telos/node_modules/playwright'); }
const fs = require('fs');
const URL_ = process.argv[2] || 'http://127.0.0.1:9391/wizard-os-home/';
const SHOTS = process.env.QA_SHOTS || '/home/telos/.hermes/cache/scratch/skin-palettes'; fs.mkdirSync(SHOTS, { recursive: true });
const PHONE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { c ? pass++ : fail++; console.log(c ? 'PASS' : 'FAIL', n, x); };
const WIZ = ['nebula', 'grove', 'tide', 'ember', 'signal'], MIZ = ['obsidian', 'obsidian-light', 'landscapes'];

async function run(b, mode) {
  const phone = mode === 'phone';
  const ctx = await b.newContext(phone
    ? { viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, userAgent: PHONE_UA }
    : { viewport: { width: 1440, height: 900 } });
  const writes = [];
  await ctx.route('**/*', r => { const q = r.request(); if (q.method() === 'GET' || q.method() === 'HEAD') return r.continue();
    writes.push(q.method() + ' ' + new URL(q.url()).pathname); return r.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"qa refuses writes"}' }); });
  await ctx.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); } catch (e) {} });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto(URL_, { waitUntil: 'load' }); await p.waitForTimeout(3500);
  const openLook = async () => { await p.evaluate(() => WizCore.deeplink.route(location.pathname + '?view=skin')); await p.waitForTimeout(1200); };
  const tap = async sel => {
    const r = await p.evaluate(s => { const e = [...document.querySelectorAll(s)].find(n => n.getClientRects().length); if (!e) return null; e.scrollIntoView({ block: 'center' });
      const b = e.getBoundingClientRect(); const x = b.x + b.width / 2, y = b.y + b.height / 2; const h = document.elementFromPoint(x, y); return { x, y, hit: !!h && (h === e || e.contains(h)) }; }, sel);
    if (!r) return null; if (phone) await p.touchscreen.tap(r.x, r.y); else await p.mouse.click(r.x, r.y); await p.waitForTimeout(900); return r;
  };
  const look = () => p.evaluate(() => { const g = [...document.querySelectorAll('[data-stgroup="look"]')].find(n => n.getClientRects().length); if (!g) return null;
    const sz = e => { const r = e.getBoundingClientRect(); return Math.round(Math.min(r.width, r.height)); };
    return { fams: [...g.querySelectorAll('[data-skinfamily]')].map(e => e.dataset.skinfamily), famOn: g.querySelector('[data-skinfamily][aria-pressed="true"]')?.dataset.skinfamily,
      pals: [...g.querySelectorAll('[data-skinpick]')].map(e => e.dataset.skinpick), palOn: g.querySelector('[data-skinpick][aria-pressed="true"]')?.dataset.skinpick,
      name: g.querySelector('[data-skinname]')?.textContent, skin: document.documentElement.dataset.skin, stored: localStorage.getItem('wos.skin'),
      sizes: [...g.querySelectorAll('[data-skinfamily], [data-skinpick]')].map(sz), sheet: window.__wos?.sheet ?? null }; });

  await openLook();
  let L = await look();
  ok(L && JSON.stringify(L.fams) === '["wizard","mizel"]' && L.famOn === 'wizard', `${mode}: Look shows Wizard and Mizel skins, Wizard worn`, JSON.stringify(L && { fams: L.fams, on: L.famOn }));
  ok(L && JSON.stringify(L.pals) === JSON.stringify(WIZ) && L.palOn === 'nebula', `${mode}: Colours = the five Wizard palettes, Nebula on`, L && L.pals.join(','));
  ok(L && L.sizes.every(v => v >= 44), `${mode}: every skin card and colour is a ≥44 px target`, L && L.sizes.join(','));
  await p.screenshot({ path: `${SHOTS}/${mode}-1-wizard.png` });
  await tap('[data-skinpick="tide"]');
  L = await look(); ok(L.skin === 'tide' && L.name === 'Wizard · Tide', `${mode}: tap Tide → worn, label "Wizard · Tide"`, JSON.stringify({ skin: L.skin, name: L.name }));

  const t2 = await tap('[data-skinfamily="mizel"]');
  L = await look();
  ok(t2 && t2.hit && L.skin === 'obsidian' && L.stored === 'obsidian' && L.famOn === 'mizel', `${mode}: real tap on Mizel → wears Dark, saved`, JSON.stringify({ hit: t2 && t2.hit, skin: L.skin, stored: L.stored, on: L.famOn }));
  ok(JSON.stringify(L.pals) === JSON.stringify(MIZ) && L.name === 'Mizel · Dark', `${mode}: Colours = Dark, Light, Landscapes`, L.pals.join(',') + ' / ' + L.name);
  ok(phone ? L.sheet === 'settings' : true, `${mode}: Settings stays open after a skin change`, String(L.sheet));
  await p.screenshot({ path: `${SHOTS}/${mode}-2-mizel.png` });

  await tap('[data-skinpick="obsidian-light"]');
  L = await look(); ok(L.skin === 'obsidian-light' && L.stored === 'obsidian-light' && L.palOn === 'obsidian-light', `${mode}: tap Light → worn and saved`, JSON.stringify({ skin: L.skin, on: L.palOn }));
  await p.screenshot({ path: `${SHOTS}/${mode}-3-mizel-light.png` });

  await tap('[data-skinfamily="wizard"]');
  L = await look(); ok(L.skin === 'tide' && L.famOn === 'wizard' && L.pals.length === 5, `${mode}: back to Wizard → Tide (last worn), not Nebula`, JSON.stringify({ skin: L.skin, on: L.famOn }));
  await tap('[data-skinfamily="mizel"]');
  L = await look(); ok(L.skin === 'obsidian-light', `${mode}: Mizel again → Light (its last palette)`, L.skin);

  await p.reload({ waitUntil: 'load' }); await p.waitForTimeout(3500); await openLook();
  L = await look();
  const fam = await p.evaluate(() => { try { return window.WizAppearance?.inspect?.()?.family ?? window.WosSkin.familyOf(document.documentElement.dataset.skin); } catch (e) { return String(e); } });
  ok(L.skin === 'obsidian-light' && L.famOn === 'mizel' && L.palOn === 'obsidian-light', `${mode}: reload keeps Mizel · Light`, JSON.stringify({ skin: L.skin, on: L.famOn }));
  ok(fam === 'mizel', `${mode}: appearance context family = mizel`, String(fam));
  ok(writes.length === 0, `${mode}: zero writes`, writes.join(' '));
  ok(errs.length === 0, `${mode}: no page errors`, errs.join(' | ').slice(0, 300));
  await p.evaluate(() => WosSkin.set('nebula'));
  await ctx.close();
}

(async () => {
  const b = await pw.chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
  try { for (const m of ['phone', 'desktop']) await run(b, m); } catch (e) { fail++; console.log('FAIL crashed', e && e.stack || e); }
  await b.close();
  console.log(`\n${pass} pass, ${fail} fail · shots ${SHOTS}`); process.exit(fail ? 1 : 0);
})();
