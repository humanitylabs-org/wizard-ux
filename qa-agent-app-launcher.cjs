// Thales-only, production-origin assets (or QA_SOURCE overlay), read-only live APIs.
// Fixture lifecycle changes exist only in this browser; never create/rename real agents.
const { chromium } = require(process.env.PW);
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const BASE = process.argv[2], OUT = process.env.QA_OUT, SOURCE = process.env.QA_SOURCE;
if (!OUT?.startsWith('/Volumes/ThalesMedia/') || !os.hostname().toLowerCase().includes('thales')) throw Error('Thales evidence required');
fs.mkdirSync(OUT, { recursive: true });
const cases = [], errors = [], writes = [], assets = {}, reads = [];
const check = (pass, name, detail) => { cases.push({ pass: !!pass, name, detail }); console.log(pass ? 'PASS' : 'FAIL', name, detail || ''); };
const nap = ms => new Promise(r => setTimeout(r, ms));
let browser;
async function context(mobile, delay = 0) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: mobile, hasTouch: mobile,
    userAgent: mobile ? 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/141.0.0.0 Mobile Safari/537.36' : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36' });
  await ctx.addInitScript(() => { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.tour.done', '1'); });
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url());
    if (!['GET', 'HEAD'].includes(q.method())) { writes.push({ method: q.method(), url: q.url() }); return r.fulfill({ status: 403, body: '{}' }); }
    if (u.pathname === '/wizard/v1/agents' && delay) await nap(delay);
    if (u.pathname.includes('/api/sessions')) reads.push(u.pathname + u.search);
    // Only future-agent session data is a fixture; live main/private reads pass through unchanged.
    if (u.searchParams.get('agent') === 'qa-future') return r.fulfill({ json: { data: [], sessions: [], total: 0 } });
    if (SOURCE && u.pathname.startsWith('/wizard-os-home/')) {
      const rel = decodeURIComponent(u.pathname.slice('/wizard-os-home/'.length)) || 'index.html';
      const f = path.resolve(SOURCE, 'web', rel);
      if (f.startsWith(path.resolve(SOURCE, 'web') + '/') && fs.existsSync(f) && fs.statSync(f).isFile()) {
        assets[rel] = crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
        return r.fulfill({ path: f });
      }
    }
    return r.continue();
  });
  const p = await ctx.newPage(); p.on('pageerror', e => errors.push(String(e)));
  return { ctx, p };
}
async function ready(p, mobile, query = '') {
  await p.goto(BASE + query);
  await p.waitForFunction(m => !!(m ? window.__wos : window.__wux)?.live?.ok, mobile, { timeout: 60000 });
  await p.evaluate(() => WosAgents.load()); await nap(400);
}
async function search(p, mobile, q) {
  if (mobile) { await p.evaluate(() => __wos.openSheet('launcher')); await p.locator('#search').fill(q); }
  else { await p.keyboard.press('Meta+k'); await p.locator('#palInput').fill(q); }
  await nap(250);
}
function hit(p, mobile, id, title) {
  return mobile ? p.locator(`#launcherBody [data-app="${id}"]`) : p.locator('#palList .pal-it').filter({ hasText: new RegExp('^' + title + 'Chats') });
}
async function windows(p) { return p.evaluate(() => Object.values((window.__wos || window.__wux).wins).filter(w => w.app === 'chats').map(w => ({ id: w.id, agent: w.agent || '', thread: w.thread }))); }
async function closeSearch(p, mobile) { await p.evaluate(m => m ? __wos.closeSheets(true) : __wux.closePalette(), mobile); }
async function run(mobile) {
  const kind = mobile ? 'phone' : 'desktop', { ctx, p } = await context(mobile);
  try {
    await ready(p, mobile);
    check(await p.evaluate(m => document.documentElement.dataset.shell === (m ? 'phone' : 'desktop'), mobile), kind + ' actual shell');
    const initialMainIds = (await windows(p)).filter(w => !w.agent).map(w => w.id);
    await search(p, mobile, 'Private Agent');
    const privateHit = hit(p, mobile, 'agent:private', 'Private Agent');
    check(await privateHit.count() === 1, kind + ' Private Agent searchable exactly once');
    await p.screenshot({ path: path.join(OUT, kind + '-search.png') });
    check(await privateHit.locator('.sg-hat-private').count() === 1, kind + ' private app keyhole sigil');
    if (await privateHit.count() === 1) {
      await privateHit.click(); await nap(800);
      let ws = await windows(p); const privateId = ws.find(w => w.agent === 'private')?.id;
      check(!!privateId && ws.filter(w => !w.agent).every(w => initialMainIds.includes(w.id)), kind + ' single click opens private, never main', ws);
      check(await p.locator('[data-agent-titlebar="private"]').count() === 1, kind + ' private title bar');
      await p.screenshot({ path: path.join(OUT, kind + '-private.png') });
      await p.evaluate(m => m ? __wos.goDesk(0, true) : __wux.newDesktop(), mobile);
      await search(p, mobile, 'Private Agent'); await hit(p, mobile, 'agent:private', 'Private Agent').click(); await nap(500);
      ws = await windows(p);
      check(ws.filter(w => w.agent === 'private').length === 1 && ws.find(w => w.agent === 'private')?.id === privateId, kind + ' repeat launch across desks reuses window');
      const scoped = await p.evaluate(() => { const s = window.__wos || window.__wux, w = Object.values(s.wins).find(w => w.agent === 'private'); const a = WosAgents.get(w.agent); return WosAgents.route(a); });
      check(scoped?.agent === 'private' && !!scoped.provider, kind + ' private composer routing retains agent/provider', scoped);
      await p.evaluate(() => WizOpenAgentChats('private', { thread: '__new__' })); await nap(300);
      await p.evaluate(() => history.back()); await nap(500);
      check(!p.isClosed() && p.url().startsWith(BASE) && (await windows(p)).some(w => w.id === privateId), kind + ' Back from nested private draft keeps app open');
    } else await closeSearch(p, mobile);
    await search(p, mobile, 'Hermes Main Agent');
    const main = hit(p, mobile, 'wizard', 'Hermes Main Agent'); check(await main.count() === 1, kind + ' main agent searchable');
    if (await main.count() === 1) { await main.click(); await nap(350); check((await windows(p)).some(w => !w.agent), kind + ' main app opens main chats'); }
    else await closeSearch(p, mobile);
    check(await p.evaluate(() => { const r = WizCore.apps('desktop'); return ['Chats', 'chat', 'wizard', 'threads'].every(q => r.findApp(q)?.id === 'wizard'); }), kind + ' legacy main aliases retained');
    const mainBefore = (await windows(p)).filter(w => !w.agent).map(w => w.id);
    await p.evaluate(m => m ? __wos.goDesk(0, true) : __wux.newDesktop(), mobile);
    await search(p, mobile, 'Hermes Main Agent');
    if (await hit(p, mobile, 'wizard', 'Hermes Main Agent').count() === 1) {
      await hit(p, mobile, 'wizard', 'Hermes Main Agent').click(); await nap(200);
      check(JSON.stringify((await windows(p)).filter(w => !w.agent).map(w => w.id)) === JSON.stringify(mainBefore), kind + ' repeated main app reuses window across desks');
    } else { check(false, kind + ' repeated main app reuses window across desks'); await closeSearch(p, mobile); }
    await search(p, mobile, 'Agents');
    check(mobile ? await p.locator('#launcherBody [data-app="agents"]').count() === 0 : await p.locator('#palList .nm').filter({ hasText: /^AgentsYour agents:/ }).count() === 0, kind + ' management app excluded from search');
    await closeSearch(p, mobile);
    // Browser-only lifecycle fixture: an additional configured agent and in-place rename/delete.
    await p.evaluate(() => { window.__qaOriginalAgents = structuredClone(WosAgents.list); WosAgents.list.push({ ...structuredClone(WosAgents.get('private')), id: 'qa-future', label: 'Research', privacy: 'standard', appearance: { hue: 40 }, status: 'running' }); WosAgents.emit(); });
    await search(p, mobile, 'Research Agent');
    check(await hit(p, mobile, 'agent:qa-future', 'Research Agent').count() === 1, kind + ' future agent appears without reload');
    if (await hit(p, mobile, 'agent:qa-future', 'Research Agent').count() === 1) { await hit(p, mobile, 'agent:qa-future', 'Research Agent').click(); await nap(350); check((await windows(p)).some(w => w.agent === 'qa-future'), kind + ' future app opens scoped chats'); }
    else await closeSearch(p, mobile);
    await search(p, mobile, 'Research Agent');
    await p.evaluate(() => { WosAgents.get('qa-future').label = 'Library'; WosAgents.emit(); }); await nap(200);
    check(await hit(p, mobile, 'agent:qa-future', 'Research Agent').count() === 0, kind + ' open search removes stale renamed tile');
    await p.locator(mobile ? '#search' : '#palInput').fill('Library Agent'); await nap(200);
    check(await hit(p, mobile, 'agent:qa-future', 'Library Agent').count() === 1, kind + ' renamed agent searchable once');
    await p.evaluate(() => { window.__qaStale = WizCore.apps('desktop').APP['agent:qa-future']; WosAgents.list = WosAgents.list.filter(a => a.id !== 'qa-future'); WosAgents.emit(); }); await nap(200);
    check(await hit(p, mobile, 'agent:qa-future', 'Library Agent').count() === 0, kind + ' delete removes open search tile');
    await closeSearch(p, mobile);
    const before = await windows(p);
    const stale = await p.evaluate(async () => { if (!window.__qaStale) return null; return await (window.__wos || window.__wux).openApp(window.__qaStale); });
    check(stale === false && JSON.stringify(await windows(p)) === JSON.stringify(before), kind + ' stale deleted tile refuses launch without main fallback');
    // A real known agent can be unavailable but its app still opens its own scoped view.
    for (const status of ['stopped', 'error']) {
      await p.evaluate(s => { WosAgents.get('private').status = s; WosAgents.emit(); }, status);
      await search(p, mobile, 'Private Agent');
      const h = hit(p, mobile, 'agent:private', 'Private Agent');
      if (await h.count() === 1) { const n = (await windows(p)).filter(w => !w.agent).length; await h.click(); await nap(250); const ws = await windows(p); check(ws.some(w => w.agent === 'private') && ws.filter(w => !w.agent).length === n, kind + ' ' + status + ' private agent never falls back'); }
      else { check(false, kind + ' ' + status + ' private agent never falls back'); await closeSearch(p, mobile); }
    }
    await p.evaluate(() => { WosAgents.list = window.__qaOriginalAgents; WosAgents.emit(); });
    await closeSearch(p, mobile);
    if (mobile) {
      await p.evaluate(() => __wos.openSheet('launcher')); await nap(250);
      const grid = p.locator('#launcherBody .lgroup').filter({ has: p.locator('h4', { hasText: 'Wizard apps' }) });
      check(await grid.locator('[data-app="agent:private"]').count() === 1, 'phone Apps grid includes private once');
      if (await grid.locator('[data-app="agent:private"]').count()) await grid.locator('[data-app="agent:private"]').scrollIntoViewIfNeeded();
      await nap(2500); // Let tile entrance animations and the intentional stale-agent refusal toast settle.
      await p.screenshot({ path: path.join(OUT, 'phone-apps.png') });
      if (await grid.locator('[data-app="agent:private"]').count() === 1) { await grid.locator('[data-app="agent:private"]').click(); await nap(200); check((await windows(p)).filter(w => w.agent === 'private').length === 1, 'phone Apps tile reuses scoped app'); }
      await closeSearch(p, mobile);
    } else {
      await p.evaluate(() => __wux.goHome()); await nap(350);
      const home = p.locator('#desktopHome [data-app="agent:private"]');
      check(await home.count() === 1, 'desktop Home apps includes private');
      await nap(2500);
      await p.screenshot({ path: path.join(OUT, 'desktop-home.png') });
      if (await home.count() === 1) { await home.click(); await nap(200); check((await windows(p)).filter(w => w.agent === 'private').length === 1, 'desktop Home private click reuses same scoped app'); }
    }
    check(reads.some(u => u.includes('agent=private')), kind + ' real private sessions API requested');
    const invalid = await p.evaluate(() => ['agent:', 'agent:Private', 'agent:../private', 'agent:private:other'].every(id => !WizCore.deeplink.parse('?open=' + encodeURIComponent(id))));
    check(invalid, kind + ' malformed agent app identifiers rejected');
    const missingBefore = await windows(p);
    await p.evaluate(() => WizCore.deeplink.route(location.pathname + '?open=agent:missing-agent'));
    await nap(500);
    check(JSON.stringify(await windows(p)) === JSON.stringify(missingBefore), kind + ' missing agent deep link never opens another app');
  } finally { await ctx.unrouteAll({ behavior: 'wait' }); await ctx.close(); }
  // Fresh storage and delayed discovery reproduce ?open startup ordering.
  const cold = await context(mobile, 1800);
  try {
    await ready(cold.p, mobile, '?open=agent:private'); await nap(700);
    const ws = await windows(cold.p);
    check(ws.filter(w => w.agent === 'private').length === 1 && await cold.p.evaluate(() => { const s = window.__wos || window.__wux; const d = s.desks ? s.desks[s.idx] : s.ws[s.cur]; return s.wins[d.focus]?.agent === 'private'; }), kind + ' cold delayed agent deep link focuses private', ws);
    await cold.p.screenshot({ path: path.join(OUT, kind + '-cold.png') });
  } finally { await cold.ctx.unrouteAll({ behavior: 'wait' }); await cold.ctx.close(); }
}
(async () => {
  browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  try { for (const mobile of [true, false]) await run(mobile); }
  finally { await browser.close(); }
  check(errors.length === 0, 'zero page errors', errors);
  check(writes.length === 0, 'zero attempted production mutations', writes);
})().catch(e => { check(false, 'suite completed', String(e.stack)); }).finally(() => {
  const report = { worker: os.hostname(), source: SOURCE || 'live', sourceSHA: process.env.QA_SHA || null, base: BASE, cases, errors, writes, assets, reads, pass: cases.filter(c => c.pass).length, fail: cases.filter(c => !c.pass).length };
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ pass: report.pass, fail: report.fail })); process.exitCode = report.fail ? 1 : 0;
});
