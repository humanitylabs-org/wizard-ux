// QA: a hosted app's own history steps stay the app's (James, 10 Oct 2026).
// Projects in full screen: expand "Platform and appliance", tap it again to collapse. Apps like that push a history
// entry on expand and collapse with history.back(); the shell used to read that pop as the user's Back and dropped
// full screen. The fixture app below (/qa-hist/) is that exact pattern, so the test outlives any one app's redesign. Also: Android Back
// with a part open collapses it (app step), and only Back at the app's root leaves full screen. Never exits.
// Usage: QA_WEB_DIR=$PWD node qa-frame-history.cjs  (serves the tree's web/ files; real reads; every write intercepted)
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
let pw; try { pw = require('playwright-core'); } catch (e) { pw = require('/home/telos/node_modules/playwright-core'); }
const CHROME = process.env.QA_CHROME || fs.readdirSync(os.homedir() + '/.cache/ms-playwright').filter(d => d.startsWith('chromium-')).sort().map(d => os.homedir() + '/.cache/ms-playwright/' + d + '/chrome-linux64/chrome').pop();
const W = process.env.QA_WEB_DIR || path.join(os.homedir(), 'apps/wizard-os-home');
const MAIN = path.join(os.homedir(), 'apps/wizard-os-home/web');
let pass = 0, fail = 0; const ok = (c, m, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + m + (c ? '' : ' ' + x)); c ? pass++ : fail++; };
const FIXTURE = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="background:#05030c;color:#fff;font:16px sans-serif">
<div id="l">${['alpha','beta','gamma'].map(k => `<section data-k="${k}"><button class="h" data-tog="${k}" style="display:block;width:100%;height:56px">${k}</button><div class="b" hidden>${k} body</div></section>`).join('')}</div>
<script>
const open = new Set(), stack = []; let skip = 0;
const paint = () => document.querySelectorAll('section').forEach(s => { s.classList.toggle('open', open.has(s.dataset.k)); s.querySelector('.b').hidden = !open.has(s.dataset.k); });
document.getElementById('l').addEventListener('click', e => { const t = e.target.closest('[data-tog]'); if (!t) return; const k = t.dataset.tog;
  if (open.has(k)) { open.delete(k); const i = stack.lastIndexOf(k); if (i >= 0) { stack.splice(i, 1); if (i === stack.length) { skip++; history.back(); } } }
  else { open.add(k); stack.push(k); history.pushState({ k }, ''); } paint(); });
addEventListener('popstate', () => { if (skip) { skip--; return; } const k = stack.pop(); if (k) { open.delete(k); paint(); } });
window.__qh = () => ({ open: [...open], stack: [...stack], skip });
</script>`;
const proxy = http.createServer((req, res) => {
  if (req.url.startsWith('/qa-hist/')) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(FIXTURE); }
  const m = req.method === 'GET' && req.url.match(/^\/wizard-os-home\/((?:desktop\/|core\/)?[a-z0-9-]+\.(?:js|css|html)|)(\?|$)/);
  if (m) {
    const f = m[1] || 'index.html'; let fp = path.join(W, 'web', f);
    if (!fs.existsSync(fp) && /^(data|summaries)\.js$/.test(f)) fp = path.join(MAIN, f);
    if (fs.existsSync(fp)) { res.writeHead(200, { 'content-type': f.endsWith('.css') ? 'text/css' : f.endsWith('.html') ? 'text/html' : 'application/javascript', 'cache-control': 'no-store' }); return res.end(fs.readFileSync(fp)); }
  }
  const port = 8923;
  const up = http.request({ host: '127.0.0.1', port, path: req.url, method: req.method, headers: { ...req.headers, host: '127.0.0.1:' + port } }, r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  up.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(up);
});
proxy.listen(0, async () => {
  const P = proxy.address().port; const writes = [];
  const b = await pw.chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', `--host-resolver-rules=MAP wizard.qa 127.0.0.1:${P}`] });
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (Linux; Android 15; SM-S938B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' });
  await ctx.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); } catch (e) {} });
  await ctx.route('**/*', r => {
    const q = r.request(), u = q.url();
    if (!u.includes('wizard.qa')) return q.resourceType() === 'document' ? r.fulfill({ status: 200, body: 'stub' }) : r.continue();
    if (q.method() !== 'GET' && q.method() !== 'HEAD') { writes.push(q.method() + ' ' + u); return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); }
    return r.continue();
  });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => { console.log('PAGEERR', String(e).slice(0, 200)); if (/wizard-os-home\//.test(String(e.stack))) errs.push(String(e)); });
  await p.goto('http://wizard.qa/wizard-os-home/?shell=phone');
  await p.waitForFunction(() => window.WizCore && window.__wos && window.WizCore.apps, null, { timeout: 30000 }).catch(async e => { console.log('BOOT', await p.evaluate(() => ({ core: !!window.WizCore, wos: !!window.__wos }))); throw e; });
  await p.waitForFunction(() => (window.WizCore.apps('mobile').APPS || []).some(a => a.id === 'projects'), null, { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(1500);
  await p.evaluate(() => __wos.openWin({ app: 'frame', url: '/qa-hist/', title: 'QA history app' }));
  const fr = () => p.frames().find(f => /\/qa-hist\//.test(f.url()));
  for (let i = 0; i < 40 && !fr(); i++) await p.waitForTimeout(250);
  ok(!!fr(), 'fixture app opens in a Wizard window');
  await fr().waitForSelector('[data-tog="beta"]', { timeout: 15000 }); await p.waitForTimeout(1200);
  const fid = await p.evaluate(() => Object.values(__wos.wins).find(w => w.app === 'frame' && /qa-hist/.test(w.url || ''))?.id);
  const shell = () => p.evaluate(id => { const d = __wos.desks[__wos.idx]; return { full: !!(d.full && d.focus === id), open: !!__wos.wins[id], idx: __wos.idx }; }, fid);
  const settle = async () => { let last = ''; for (let i = 0; i < 30; i++) { const r = await p.evaluate(id => JSON.stringify(document.querySelector(`.win[data-win="${id}"]`)?.getBoundingClientRect()), fid); if (r === last) return; last = r; await p.waitForTimeout(120); } };
  await p.evaluate(id => __wos.setFull(id, true), fid); await p.waitForTimeout(400); await settle();
  ok((await shell()).full, 'fixture app is full screen');
  await p.waitForFunction(() => !document.querySelector('#toast.show'), null, { timeout: 8000 }).catch(() => {}); // the "pinch in to exit" hint sits over the top rows
  const isOpen = k => fr().evaluate(k => window.__qh().open.includes(k), k);
  const tap = async k => { await fr().locator(`[data-tog="${k}"]`).tap(); await p.waitForTimeout(900); };
  const back = async () => { await p.evaluate(() => window.__wosNativeBack()); await p.waitForTimeout(900); };

  // 1. The reported bug: tap to expand, tap to collapse, full screen stays.
  await tap('beta'); ok(await isOpen('beta'), 'tap expands a section');
  ok((await shell()).full, 'still full screen after expanding');
  await tap('beta'); ok(!(await isOpen('beta')), 'tap collapses the section');
  let s = await shell(); ok(s.full && s.open, 'collapsing by tap keeps full screen', JSON.stringify(s));
  ok((await fr().evaluate(() => window.__qh().skip)) === 0, "the app's own pop reached the app (skip counter settled)");

  // 2. Repeated cycles, and nested: open two, collapse the top one by tap.
  for (let i = 0; i < 3; i++) { await tap('alpha'); await tap('alpha'); }
  s = await shell(); ok(s.full && !(await isOpen('alpha')), 'three more expand/collapse cycles keep full screen', JSON.stringify(s));
  await tap('alpha'); await tap('gamma'); await tap('gamma');
  s = await shell(); ok(s.full && (await isOpen('alpha')) && !(await isOpen('gamma')), 'nested: collapsing the top section by tap keeps the other open and full screen', JSON.stringify(s));

  // 3. Android Back with a section open: the app collapses it, full screen stays.
  await back(); s = await shell();
  ok(!(await isOpen('alpha')), 'Back collapses the open section (app step)');
  ok(s.full, 'Back that collapses a section keeps full screen', JSON.stringify(s));

  // 4. Back at the app's root: the shell's step (full screen → tile), app stays open.
  await back(); await settle(); s = await shell();
  ok(!s.full && s.open, 'Back at the app root leaves full screen and keeps the app open', JSON.stringify(s));

  // 5. Tiled: expand + tap-collapse leaves the shell where it was.
  const idx0 = s.idx; await tap('beta'); await tap('beta');
  s = await shell(); ok(s.open && !s.full && s.idx === idx0, 'tiled: tap-collapse leaves the shell where it was', JSON.stringify(s));

  // 6. Back from tiled at the root still takes the shell step (never swallowed, never exits).
  await back(); s = await shell();
  ok(s.open && (await p.evaluate(() => (window.__backLog || []).slice(-1)[0])) !== 'exit-warn' || s.idx !== idx0, 'Back at the tiled root still moves the shell', JSON.stringify(s));

  ok(writes.filter(w => /\/v1\/runs|\/api\/sessions/.test(w)).length === 0, 'zero agent writes (' + writes.length + ' intercepted)');
  ok(errs.length === 0, 'no shell page errors ' + errs.slice(0, 2).join(';'));
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close(); proxy.close(); process.exit(fail ? 1 : 0);
});
