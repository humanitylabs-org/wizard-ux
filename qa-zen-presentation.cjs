// QA (James, 20 Oct 2026): distraction-free (swipe down on the orb) hides a sole window's title bar, so the host tells
// that app it is presented edge to edge (Appearance v1 presentation 'immersive'), live and without a reload. Apps such
// as Morning then drop their own in-app header while he reads. Tiled windows in distraction-free stay 'window'.
// Usage: QA_WEB_DIR=<repo> node qa-zen-presentation.cjs [url]. Every request is fulfilled locally; nothing is written.
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const URL_ = process.argv[2] || (require('./tools/qa-paths.cjs').origin() + '/wizard-os-home/');
const W = process.env.QA_WEB_DIR || __dirname;
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };
const APPS = [{ id: 'qa-pres', name: 'QA Pres', url: '/qa-pres/' }, { id: 'qa-pres2', name: 'QA Pres 2', url: '/qa-pres2/' }];
const page = n => `<!doctype html><html><body><h1>${n}</h1><script src="/wizard-os-home/core/app-client.js"></script><script>
window.__pres = []; WizardApp.ready({ name: '${n}' }); WizardApp.theme.onChange(t => window.__pres.push(t && t.presentation));</script></body></html>`;

(async () => {
  const b = await chromium.launch({ executablePath: process.env.QA_CHROME || undefined });
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true });
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url());
    if (!(u.origin === require('./tools/qa-paths.cjs').origin())) return r.abort();
    const m = u.pathname.match(/^\/wizard-os-home\/(.*)$/);
    if (m && q.method() === 'GET' && !m[1].startsWith('api/')) {
      const f = m[1] || 'index.html';
      let p = path.join(W, 'web', f); if (!fs.existsSync(p) && /^(data|summaries)\.js$/.test(f)) p = path.join(require('node:path').join(require('./tools/qa-paths.cjs').repoRoot, 'web'), f);
      if (!fs.existsSync(p)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      const ct = f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : f.endsWith('.png') ? 'image/png' : f.endsWith('.webmanifest') ? 'application/manifest+json' : 'application/javascript';
      return r.fulfill({ status: 200, contentType: ct, body: fs.readFileSync(p) });
    }
    if (u.pathname === '/qa-pres/') return r.fulfill({ status: 200, contentType: 'text/html', body: page('QA Pres') });
    if (u.pathname === '/qa-pres2/') return r.fulfill({ status: 200, contentType: 'text/html', body: page('QA Pres 2') });
    if (u.pathname === '/wizard/v1/bootstrap') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ bootstrap: 1, endpoints: { apps: '/wizard/v1/apps', sessions: '/wizard/hermes/api/sessions' } }) });
    if (u.pathname === '/wizard/v1/apps') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ schema: 1, apps: APPS }) });
    if (/\/hermes\/api\/sessions$/.test(u.pathname)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], has_more: false }) });
    return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); } catch (e) {} });
  await p.goto(URL_, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__wos && window.__wos.live, null, { timeout: 30000 });
  await p.waitForFunction(() => window.WizCore.apps('mobile').APPS.some(a => a.id === 'qa-pres'), null, { timeout: 15000 });
  const open = id => p.evaluate(id => __wos.openApp(window.WizCore.apps('mobile').APPS.find(a => a.id === id)), id);
  const pres = src => p.evaluate(src => { const f = [...document.querySelectorAll('.win iframe')].find(f => (f.getAttribute('src') || '').includes(src)); return f ? f.contentDocument.documentElement.dataset.presentation || '' : 'nof'; }, src);
  const until = async (src, want) => { for (let i = 0; i < 40; i++) { if (await pres(src) === want) return want; await p.waitForTimeout(100); } return pres(src); };
  await p.evaluate(() => __wos.goDesk(0, true));
  await open('qa-pres'); await p.waitForTimeout(1500);
  const n = await p.evaluate(() => document.querySelector('.desk[data-desk="' + __wos.idx + '"] .tiles')?.dataset.n);
  ok(await until('/qa-pres/', 'window') === 'window', 'sole window, bars showing: presentation window', 'tiles n=' + n);
  const reloads = await p.evaluate(() => [...document.querySelectorAll('.win iframe')].find(f => f.src.includes('/qa-pres/')).contentWindow.__marker = 1);
  await p.evaluate(() => document.querySelector('#device').classList.add('zen'));
  ok(await until('/qa-pres/', 'immersive') === 'immersive', 'distraction-free sole window: presentation immersive');
  const kept = await p.evaluate(() => [...document.querySelectorAll('.win iframe')].find(f => f.src.includes('/qa-pres/')).contentWindow.__marker === 1);
  ok(kept, 'pushed live without reloading the app');
  await p.evaluate(() => document.querySelector('#device').classList.remove('zen'));
  ok(await until('/qa-pres/', 'window') === 'window', 'leaving distraction-free: presentation back to window');
  // Two tiled windows in distraction-free are not edge to edge: they stay 'window'.
  await open('qa-pres2'); await p.waitForTimeout(1500);
  const n2 = await p.evaluate(() => [...document.querySelectorAll('.tiles')].map(t => t.dataset.n).join(','));
  await p.evaluate(() => document.querySelector('#device').classList.add('zen'));
  await p.waitForTimeout(800);
  const two = [await pres('/qa-pres/'), await pres('/qa-pres2/')];
  const sameDesk = await p.evaluate(() => { const fs = [...document.querySelectorAll('.win iframe')].filter(f => /qa-pres/.test(f.src)); return fs.length === 2 && fs[0].closest('.tiles') === fs[1].closest('.tiles'); });
  if (sameDesk) ok(two.every(v => v === 'window'), 'two tiled windows in distraction-free stay window', JSON.stringify({ two, n2 }));
  else ok(two[1] === 'immersive', 'second app opened on its own desk: sole window there is immersive', JSON.stringify({ two, n2 }));
  await p.evaluate(() => document.querySelector('#device').classList.remove('zen'));
  ok(errs.length === 0, 'no page errors', errs.join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
