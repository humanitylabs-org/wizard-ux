// QA: apps that ship a logo wear it on every app-icon surface; apps without one keep their sigil.
// Usage: QA_WEB_DIR=$PWD QA_SHOTS=<dir> QA_SKINS=nebula,landscapes-light node qa-app-logos.cjs [shell origin]
//   Serves this checkout's web/ and its own Store-data logo routes (tools/store-app-logos.mjs, against this box's
//   ~/.wizard-os/apps.json and Runtipi metadata) over the live shell; every other read is real, every write refused.
// Needs puppeteer-core (QA_PUPPETEER) and Chromium (QA_CHROME).
const fs = require('fs'), path = require('path'), http = require('http');
const puppeteer = require(process.env.QA_PUPPETEER || 'puppeteer-core');
const ORIGIN = (process.argv[2] || 'http://127.0.0.1:8796').replace(/\/$/, '');   // the owner's real shell origin also loads the apps
const W = process.env.QA_WEB_DIR || __dirname;
const SHOTS = process.env.QA_SHOTS || '';
const SKINS = (process.env.QA_SKINS || 'nebula').split(',');
const LOGO_APPS = (process.env.QA_LOGO_APPS || 'maverick-command,carlos-crm-demo').split(',');
const SIGIL_APP = process.env.QA_SIGIL_APP || 'money';   // ships only the template placeholder → keeps its sigil
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, x); } };
const CT = { '.css': 'text/css', '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

async function adapter() {
  const { createStoreDataRoutes } = await import(path.join(W, 'tools/store-data-origin.mjs'));
  const s = http.createServer(createStoreDataRoutes()); await new Promise(r => s.listen(0, '127.0.0.1', r));
  return { s, base: `http://127.0.0.1:${s.address().port}` };
}

async function page(b, mobile, skin, sd, writes) {
  const p = await b.newPage();
  if (mobile) await p.emulate({ viewport: { width: 412, height: 892, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36' });
  else await p.setViewport({ width: 1440, height: 900 });
  await p.evaluateOnNewDocument(s => { try { localStorage.setItem('wos.coached', '1'); localStorage.setItem('wos.skin', s); localStorage.setItem('wos.tour.done', '1'); } catch (_) {} }, skin);
  // A registered Wizard service worker would fetch past the interception below.
  await p.evaluateOnNewDocument(() => { try { navigator.serviceWorker.register = () => Promise.reject(new Error('qa: no service worker')); } catch (_) {} });
  await p.setRequestInterception(true);
  p.on('request', async q => {
    try {
      const u = new URL(q.url());
      if (!['GET', 'HEAD'].includes(q.method())) { writes.push(q.method() + ' ' + u.pathname); return q.respond({ status: 403, body: 'qa: writes refused' }); }
      if (u.pathname.endsWith('/sw.js')) return q.respond({ status: 404, body: '' });
      // The box-wide skin choice would override the skin under test: this page sees none.
      if (/^\/wizard\/v1\/(skins|my-skin)(\/|$)/.test(u.pathname)) return q.respond({ status: 404, contentType: 'application/json', body: '{}' });
      if (/^\/wizard-os-home\/store-data\/(wizard\/v1\/app-logos|app-logo\/)/.test(u.pathname)) {
        const r = await fetch(sd + u.pathname + u.search); const body = Buffer.from(await r.arrayBuffer());
        return q.respond({ status: r.status, contentType: r.headers.get('content-type') || undefined, headers: { 'cache-control': r.headers.get('cache-control') || '' }, body });
      }
      const m = u.pathname.match(/^\/wizard-os-home\/(.*)$/);
      if (m) {
        const f = m[1] || (mobile ? 'index.html' : 'desktop.html'), file = path.join(W, 'web', f);
        if (fs.existsSync(file) && fs.statSync(file).isFile()) return q.respond({ status: 200, contentType: CT[path.extname(f)], body: fs.readFileSync(file) });
      }
      return q.continue();
    } catch (e) { try { q.abort(); } catch (_) {} }
  });
  return p;
}
// The box may carry the owner's own skin choice; wear the one under test on this page only (writes are refused).
const wear = async (p, skin) => { await p.waitForFunction(() => !!window.WosSkin, { timeout: 15000 }).catch(() => {}); await p.evaluate(s => window.WosSkin?.set(s), skin); await new Promise(r => setTimeout(r, 1200)); };
// An icon box (window bar, dock) holding a logo is the same size as one holding a sigil, and the logo fills it.
const boxes = (p, sel) => p.evaluate(sel => [...document.querySelectorAll(sel)].map(el => {
  const r = el.getBoundingClientRect(), l = el.querySelector(':scope > .sglogo'), lr = l?.getBoundingClientRect();
  return { logo: !!l, w: Math.round(r.width), h: Math.round(r.height), lw: lr ? Math.round(lr.width) : 0, lh: lr ? Math.round(lr.height) : 0 };
}), sel);
// Boxes a layout hides (0×0, e.g. phone window bars without an icon) are skipped.
const sameBoxes = list => { const s = list.filter(x => !x.logo && x.w), l = list.filter(x => x.logo); return l.length > 0 && l.every(x => !x.w || x.lw === x.w && x.lh === x.h && (!s.length || s.some(y => y.w === x.w && y.h === x.h))); };
// Thrown by an installed app's own page on stock main too (control run without this change): not this QA's subject.
const KNOWN = /Back needs synchronous canGoBack\/back callbacks/;
const wait = ms => new Promise(r => setTimeout(r, ms));
const shot = async (p, name) => { if (SHOTS) { await p.screenshot({ path: path.join(SHOTS, name + '.png') }); console.log('shot', name); } };
// Every rendered icon for an app id, wherever it is: { logo, sgi } counts plus the logo boxes' sizes.
const census = (p, sel) => p.evaluate(sel => [...document.querySelectorAll(sel)].map(el => {
  const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
  return { w: Math.round(r.width), h: Math.round(r.height), bg: cs.backgroundImage.slice(0, 120), radius: cs.borderRadius, filter: cs.filter, visible: r.width > 0 && cs.visibility !== 'hidden' };
}), sel);

(async () => {
  const sd = await adapter();
  const logos = await (await fetch(sd.base + '/wizard-os-home/store-data/wizard/v1/app-logos')).json();
  for (const id of LOGO_APPS) ok(/^[0-9a-f]{16}$/.test(logos.logos[id] || ''), `box lists a logo for ${id}`);
  ok(!(SIGIL_APP in logos.logos), `${SIGIL_APP} (template placeholder logo) is not listed`);
  const b = await puppeteer.launch({ executablePath: process.env.QA_CHROME || '/usr/bin/chromium', args: ['--no-sandbox', '--ignore-certificate-errors'] });
  try {
    for (const skin of SKINS) {
      // ---------- desktop ----------
      {
        const writes = [], errs = [];
        const p = await page(b, false, skin, sd.base, writes); p.on('pageerror', e => { if (!KNOWN.test(e.message)) errs.push(e.message); });
        await p.goto(ORIGIN + '/wizard-os-home/desktop.html', { waitUntil: 'domcontentloaded' });
        await p.waitForFunction(ids => ids.every(id => window.WizCore?.appLogo?.(id)), { timeout: 20000 }, LOGO_APPS).catch(() => {});
        await wear(p, skin);
        ok(await p.evaluate(s => document.documentElement.dataset.skin === s, skin), `desktop ${skin}: skin applied`, await p.evaluate(() => document.documentElement.dataset.skin));
        await wait(1500);
        console.log(`info desktop ${skin}: ${(await census(p, '.home-apps .app-chip .sglogo')).length} Home chips wear a logo`);
        await shot(p, `desktop-${skin}-home`);
        // window title bars + desk bar
        for (const id of LOGO_APPS) { await p.evaluate(id => window.WizOpenApp(id), id); await wait(1200); }
        await p.evaluate(id => window.WizOpenApp(id), SIGIL_APP); await wait(1500);
        const wb = await boxes(p, '.wbar .ic'), bar = await census(p, '#bar .sglogo');
        ok(sameBoxes(wb), `desktop ${skin}: window-bar logos fill the same box a sigil gets`, JSON.stringify(wb));
        ok(bar.length >= 1 && bar.every(x => x.visible && x.w >= 14), `desktop ${skin}: desk bar shows the logo`, JSON.stringify(bar));
        ok(await p.evaluate(id => !!document.querySelector(`.wbar .ic .sgi`) , SIGIL_APP), `desktop ${skin}: ${SIGIL_APP} keeps its sigil`);
        await shot(p, `desktop-${skin}-windows`);
        await p.click('#searchBtn'); await wait(900);
        const pal = await census(p, '#pal .sglogo, .pal .sglogo, [id^="pal"] .sglogo');
        ok(pal.length >= 1, `desktop ${skin}: palette rows show logos (${pal.length})`);
        await shot(p, `desktop-${skin}-palette`);
        ok(errs.length === 0, `desktop ${skin}: no page errors`, errs.join(' | '));
        await p.close();
      }
      // ---------- phone ----------
      {
        const writes = [], errs = [];
        const p = await page(b, true, skin, sd.base, writes); p.on('pageerror', e => { if (!KNOWN.test(e.message)) errs.push(e.message); });
        await p.goto(ORIGIN + '/wizard-os-home/index.html', { waitUntil: 'domcontentloaded' });
        await p.waitForFunction(ids => ids.every(id => window.WizCore?.appLogo?.(id)), { timeout: 20000 }, LOGO_APPS).catch(() => {});
        await wear(p, skin);
        ok(await p.evaluate(s => document.documentElement.dataset.skin === s, skin), `phone ${skin}: skin applied`);
        await wait(1500);
        await p.evaluate(() => window.__wos?.openSheet?.('launcher')); await wait(1200);
        const tiles = await census(p, '.launcher .sglogo');
        // Folded sections (backend-only apps on some skins) keep their tiles at 0×0; every shown tile is square.
        const shown = tiles.filter(x => x.visible && x.w), odd = shown.filter(x => Math.abs(x.w - x.h) > 2);
        ok(shown.length >= LOGO_APPS.length && !odd.length, `phone ${skin}: launcher tiles show logos (${tiles.length})`, JSON.stringify(odd));
        await shot(p, `phone-${skin}-launcher`);
        await p.evaluate(() => window.__wos?.closeSheets?.()); await wait(500);
        await p.evaluate(id => window.WizOpenApp(id), LOGO_APPS[0]); await wait(2500);
        const wic = await boxes(p, '.wbar .wic'), dock = await census(p, '.dock .sglogo, #orbApp .sglogo');
        ok(sameBoxes(wic), `phone ${skin}: window-bar logo fills the same box a sigil gets`, JSON.stringify(wic));
        ok(dock.length >= 1, `phone ${skin}: dock/orb shows the logo (${dock.length})`, JSON.stringify(dock));
        await shot(p, `phone-${skin}-app`);
        ok(errs.length === 0, `phone ${skin}: no page errors`, errs.join(' | '));
        await p.close();
      }
    }
  } finally { await b.close(); sd.s.close(); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
