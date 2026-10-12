// QA: Oscar's App Manager views merged natively into Wizard UX (feature/apps-views).
//   My Apps = the phone's swipe-up launcher (and ⌘K → My apps on desktop), App Store = the same sheet with a chip
//   row and index search, app card, Resources = a Settings group. Real data: Runtipi installed list + load,
//   /wizard/v1/wizard-apps (apps.json) and /wizard/v1/index/* (the live App Index), through the staging origin.
//   Back: card → Store → My Apps → sheet closes → app stays open. Writes: lifecycle is refused by the preview origin
//   (shown as "Preview: read-only", never an error); zero /v1/runs and every Hermes write intercepted here.
// Run from Thales over the tailnet (loopback has no tailnet identity):
//   node qa-apps-views.cjs [https://apps-views.staging.wizard001.com/wizard-os-home/] [shotDir]
const { chromium } = require(process.env.PW || 'playwright');
const fs = require('fs'), path = require('path');
const BASE = process.argv[2] || 'https://apps-views.staging.wizard001.com/wizard-os-home/';
const SHOTS = process.argv[3] || '';
const ORIGIN = new URL(BASE).origin;
let pass = 0, fail = 0;
const ok = (c, n, x = '') => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, x); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (p, fn, arg, ms = 12000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await p.evaluate(fn, arg).catch(() => false)) return true; await sleep(150); } return false; };
const shot = async (p, n) => { if (SHOTS) { await sleep(900); /* sheets and tiles finish their entrance */ fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: path.join(SHOTS, n + '.png') }); } };
// Browser history is joint with hosted apps: a real pop can land in the top window OR a same-origin frame.
// The init-script observer runs before shell handlers (which may stop propagation), and records that receipt.
const back = async (p) => {
  const n = await p.evaluate(() => window.__qaPopCount || 0);
  await p.evaluate(() => history.back());
  try { await p.waitForFunction(n => (window.__qaPopCount || 0) > n, n, { timeout: 2500 }); await sleep(350); return 'pop'; }
  catch { return 'timeout'; }
};

async function context(b, mobile) {
  const ctx = await b.newContext(mobile
    ? { viewport: { width: 412, height: 892 }, hasTouch: true, isMobile: true, colorScheme: 'dark', userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36' }
    : { viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  const W = { runs: 0, hermes: [], lifecycle: [] };
  await ctx.route('**/*', r => {
    const q = r.request(), u = q.url();
    if (/\/v1\/runs\b/.test(u) && q.method() !== 'GET') { W.runs++; return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); }
    if (q.method() !== 'GET' && q.method() !== 'HEAD' && /\/wizard\/(hermes|thread-|attention|session-|voice|files|v1\/route)/.test(u)) { W.hermes.push(u); return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); }
    if (q.method() !== 'GET' && /\/api\/app-lifecycle\/|\/wizard\/v1\/index\//.test(u)) W.lifecycle.push(q.method() + ' ' + new URL(u).pathname); // passes through: the preview origin refuses it
    return r.continue();
  });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
  await p.addInitScript(() => {
    addEventListener('popstate', () => { try { window.top.__qaPopCount = (window.top.__qaPopCount || 0) + 1; } catch {} }, true);
    try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.tour.done', '1'); } catch (e) {}
  });
  return { ctx, p, W, errs };
}

(async () => {
  const b = await chromium.launch();
  const refused0 = await fetch(ORIGIN + '/__qa/refused-apps').then(r => r.json()).then(j => j.refused).catch(() => null);

  /* ---------------- data routes (read-only, real) ---------------- */
  {
    const { ctx, p } = await context(b, true);
    await p.goto(BASE + '?shell=phone', { waitUntil: 'load' });
    const d = await p.evaluate(async () => {
      const j = u => fetch(u, { cache: 'no-store' }).then(async r => ({ s: r.status, j: await r.json().catch(() => null) }));
      const [wa, ix, tg, inst, load, post] = await Promise.all([j('/wizard/v1/wizard-apps'), j('/wizard/v1/index/search?limit=100'), j('/wizard/v1/index/tags'), j('/api/apps/installed'), j('/api/system/load'),
        fetch('/wizard/v1/index/installs', { method: 'POST', body: '{}' }).then(r => r.status)]);
      return { wa: wa.s, waApps: (wa.j?.apps || []).map(a => a.id), waKeys: Object.keys(wa.j?.apps?.[0] || {}), ix: ix.s, ixN: ix.j?.apps?.length || 0, tg: tg.s, tags: tg.j?.tags?.length || 0, inst: inst.s, instN: inst.j?.installed?.length || 0, config: (inst.j?.installed || []).some(x => x.app && 'config' in x.app), load: load.s, disk: load.j?.diskSize, post };
    });
    ok(d.wa === 200 && d.waApps.length >= 1, 'GET /wizard/v1/wizard-apps → real apps.json', JSON.stringify(d.waApps));
    ok(!d.waKeys.some(k => /mcp|health|repo|commit|skill/.test(k)), 'wizard-apps leaves MCP/health/repo/skill on the box', d.waKeys.join(','));
    ok(d.ix === 200 && d.ixN >= 5 && d.tg === 200 && d.tags >= 3, 'GET /wizard/v1/index/search + /tags → live App Index', `${d.ixN} apps, ${d.tags} tags`);
    ok(d.inst === 200 && d.instN >= 3 && !d.config, 'Runtipi installed list (real), app config stripped', `${d.instN} installed, config:${d.config}`);
    ok(d.load === 200 && d.disk > 0, 'Runtipi system load (real)', String(d.disk));
    ok(d.post === 403 || d.post === 405, 'POST /wizard/v1/index/installs refused in the preview', String(d.post));
    await ctx.close();
  }

  /* ---------------- phone ---------------- */
  {
    const { ctx, p, W, errs } = await context(b, true);
    await p.goto(BASE + '?shell=phone&view=apps', { waitUntil: 'load' });
    ok(await until(p, () => document.querySelector('#launcher')?.classList.contains('open')), 'phone: ?view=apps opens the swipe-up sheet');
    ok(await until(p, () => document.querySelectorAll('#launcherBody [data-wam-id]').length >= 3), 'phone: My Apps draws the installed apps');
    const my = await p.evaluate(() => {
      const body = document.querySelector('#launcherBody');
      const groups = [...body.querySelectorAll('.wam-host .lgroup h4')].map(h => h.textContent.replace(/\d+/g, '').trim());
      const ids = [...body.querySelectorAll('[data-wam-id]')].map(e => e.dataset.wamId);
      return { groups, ids, dup: ids.length !== new Set(ids).size, get: !!body.querySelector('[data-wam-get]'), dots: body.querySelectorAll('.wam-dot').length, shellTiles: [...body.querySelectorAll('.wam-host [data-app]')].map(e => e.dataset.app), recent: /recent/i.test(body.innerText), oldGroup: [...body.querySelectorAll('.lgroup h4')].some(h => /^wizard apps/i.test(h.textContent.trim())), bg: getComputedStyle(document.body).backgroundColor };
    });
    ok(my.groups.some(g => /apps/i.test(g)) && my.groups.some(g => /system/i.test(g)), 'phone: My Apps grouped (Agents / Apps / System)', JSON.stringify(my.groups));
    ok(!my.dup, 'phone: one tile per app (no duplicate DeFleur from the old store)', JSON.stringify(my.ids));
    ok(my.get, 'phone: "Get apps" tile');
    ok(my.dots >= 3, 'phone: status dots on installed apps', String(my.dots));
    ok(my.shellTiles.includes('chats') || my.shellTiles.includes('wisdom') || my.shellTiles.length >= 3, 'phone: James\'s own tiles (Chats, Wisdom…) stay in My Apps', JSON.stringify(my.shellTiles.slice(0, 8)));
    ok(!my.oldGroup, 'phone: the old "Wizard apps" group is replaced, not duplicated');
    await shot(p, 'm1-my-apps');

    // Store
    await p.tap('#launcherBody [data-wam-get]');
    ok(await until(p, () => __wos.wam.mode === 'store' && document.querySelectorAll('#launcherBody [data-wam-id]').length >= 5), 'phone: Get apps → App Store in the same sheet, real index apps');
    const st = await p.evaluate(() => ({ chips: !document.querySelector('.launcher .wam-chips')?.hidden, n: document.querySelectorAll('.launcher .wam-chips .wam-chip, .launcher .wam-chips button').length, ph: document.querySelector('#search').placeholder }));
    ok(st.chips && st.n >= 4 && /App Store/.test(st.ph), 'phone: chip row above the search bar, search says "Search the App Store"', JSON.stringify(st));
    await shot(p, 'm2-store');
    await p.fill('#search', 'transcri');
    ok(await until(p, () => [...document.querySelectorAll('#launcherBody .lrow')].some(r => /Transcriber/.test(r.textContent))), 'phone: index search finds Transcriber');
    ok(await p.evaluate(() => [...document.querySelectorAll('#launcherBody .lrow')].some(r => /Transcriber/.test(r.textContent) && /Installed/.test(r.textContent))), 'phone: search result marks it Installed');
    await shot(p, 'm3-search');
    await p.fill('#search', '');
    await until(p, () => document.querySelectorAll('#launcherBody .lgrid [data-wam-id]').length >= 5);
    // An app that is not installed: card → Install → calm read-only note
    const notInst = await p.evaluate(() => { const have = new Set((window.WosApps.cached || []).map(a => a.id)); const t = [...document.querySelectorAll('#launcherBody [data-wam-id]')].find(e => !have.has(e.dataset.wamId)); return t?.dataset.wamId || ''; });
    await p.tap(`#launcherBody [data-wam-id="${notInst}"]`);
    ok(await until(p, () => __wos.wam.mode === 'card' && !!document.querySelector('#launcherBody .wam-card')), `phone: store tile (${notInst}) opens its card`);
    const hasInstall = await p.evaluate(() => !!document.querySelector('#launcherBody [data-wam-do="install"]'));
    ok(hasInstall, 'phone: card offers Install');
    if (hasInstall) {
      await p.tap('#launcherBody [data-wam-do="install"]');
      ok(await until(p, () => /Preview: read-only/.test(document.querySelector('#launcherBody').innerText)), 'phone: Install in the preview → "Preview: read-only" (not an error)');
      ok(await p.evaluate(() => !/Couldn|failed|error/i.test(document.querySelector('#launcherBody .wam-card').innerText)), 'phone: no error wording on the card');
    }
    await shot(p, 'm4-card-readonly');

    // Back contract: card → Store → My Apps → sheet closed → app still open
    let r = await back(p);
    ok(r === 'pop' && await until(p, () => __wos.wam.mode === 'store' && __wos.sheet === 'launcher'), 'phone: Back from the card → App Store', r);
    r = await back(p);
    ok(r === 'pop' && await until(p, () => __wos.wam.mode === 'apps' && __wos.sheet === 'launcher' && !!document.querySelector('#launcherBody [data-wam-get]')), 'phone: Back from the Store → My Apps', r);
    r = await back(p);
    ok(r === 'pop' && await until(p, () => !__wos.sheet), 'phone: Back from My Apps → sheet closes', r);
    ok(p.url().startsWith(ORIGIN + '/wizard-os-home'), 'phone: still in Wizard OS after closing the sheet', p.url());
    await p.tap('body', { position: { x: 200, y: 420 } }).catch(() => {}); await sleep(300);
    const bl = await p.evaluate(() => __wos.back.log.slice(-4));
    ok(bl.includes('app-card') && bl.includes('store') && bl.includes('sheet'), 'phone: Back log card → store → sheet', JSON.stringify(bl));

    // Installed app card from My Apps: Stop/Start → read-only
    await p.evaluate(() => __wos.openSheet('launcher'));
    await until(p, () => document.querySelectorAll('#launcherBody [data-wam-id]').length >= 3);
    const instId = await p.evaluate(() => { const a = (window.WosApps.cached || []).find(x => x.status === 'running'); return a?.id || ''; });
    await p.evaluate(id => document.querySelector(`#launcherBody [data-wam-id="${id}"]`)?.click(), instId);
    await until(p, () => !!document.querySelector('#launcherBody .wam-card'));
    const sb = await p.evaluate(() => [...document.querySelectorAll('#launcherBody [data-wam-do]')].map(b => b.dataset.wamDo));
    ok(sb.includes('stop') || sb.includes('start'), `phone: installed card (${instId}) shows Start/Stop`, JSON.stringify(sb));
    const life = sb.includes('stop') ? 'stop' : 'start';
    await p.tap(`#launcherBody [data-wam-do="${life}"]`);
    ok(await until(p, () => /Preview: read-only/.test(document.querySelector('#launcherBody').innerText)), `phone: ${life} → "Preview: read-only"`);
    await shot(p, 'm5-installed-card');
    r = await back(p);
    ok(r === 'pop' && await until(p, () => __wos.wam.mode === 'apps' && __wos.sheet === 'launcher'), 'phone: Back from an installed card → My Apps', r);
    r = await back(p); await until(p, () => !__wos.sheet);

    // ?view=store deep link
    await p.goto(BASE + '?shell=phone&view=store', { waitUntil: 'load' });
    ok(await until(p, () => __wos.wam?.mode === 'store' && document.querySelectorAll('#launcherBody [data-wam-id]').length >= 5), 'phone: ?view=store opens the App Store directly');
    await p.tap('#launcher .sheet-grip').catch(() => {}); await sleep(200); // a person touches the screen before Back (arms the guard)
    ok(await until(p, () => __wos.wam.mode === 'store'), 'phone: a tap on the sheet keeps the Store');
    r = await back(p);
    ok(r === 'pop' && await until(p, () => __wos.wam.mode === 'apps' && __wos.sheet === 'launcher'), 'phone: deep-linked Store → Back → My Apps', r);

    // Resources in Settings
    await p.goto(BASE + '?shell=phone&view=resources', { waitUntil: 'load' });
    ok(await until(p, () => document.querySelectorAll('#settingsBody [data-wam-res] .wam-meter').length >= 3), 'phone: Settings → Resources with Storage / Processor / Memory meters');
    const res = await p.evaluate(() => { const g = document.querySelector('#settingsBody [data-wam-res]'); const prev = g.previousElementSibling; return { txt: g.innerText, after: prev?.querySelector('h4')?.textContent.trim(), btns: [...g.querySelectorAll('[data-wam-all]')].map(b => b.dataset.wamAll), top: g.getBoundingClientRect().top }; });
    ok(/Storage/.test(res.txt) && /Processor/.test(res.txt) && /Memory/.test(res.txt), 'phone: Resources reads real numbers', res.txt.replace(/\s+/g, ' ').slice(0, 120));
    ok(/^Wizard/.test(res.after || ''), 'phone: Resources sits after the Wizard group', res.after);
    ok(['start-all', 'stop-all', 'restart-all'].every(k => res.btns.includes(k)), 'phone: Start all / Stop all / Restart all');
    await shot(p, 'm6-resources');
    await p.tap('#settingsBody [data-wam-all="stop-all"]');
    ok(await p.evaluate(() => /Tap again/.test(document.querySelector('#settingsBody [data-wam-all="stop-all"]').textContent)), 'phone: Stop all needs a second tap');
    await p.tap('#settingsBody [data-wam-all="stop-all"]');
    ok(await until(p, () => /Preview: read-only/.test(document.querySelector('#settingsBody [data-wam-msg]').textContent)), 'phone: Stop all → "Preview: read-only"');
    r = await back(p);
    ok(r === 'pop' && await until(p, () => !__wos.sheet) && p.url().startsWith(ORIGIN), 'phone: Back closes Settings, app stays', r);
    ok(!errs.length, 'phone: no page errors', JSON.stringify(errs));
    ok(W.runs === 0, 'phone: zero /v1/runs writes', String(W.runs));
    console.log('phone lifecycle attempts (refused by origin):', JSON.stringify(W.lifecycle), 'hermes writes intercepted:', W.hermes.length);
    await ctx.close();
  }

  /* ---------------- desktop ---------------- */
  {
    const { ctx, p, W, errs } = await context(b, false);
    await p.goto(BASE + '?shell=desktop', { waitUntil: 'load' });
    await until(p, () => !!window.__wux);
    await p.keyboard.press('Control+k'); await sleep(300);
    await p.keyboard.type('get apps'); await sleep(300);
    const top = await p.evaluate(() => document.querySelector('#palList [data-i]')?.textContent || '');
    ok(/Get apps/.test(top), '⌘K "get apps" → first result is Get apps', top.slice(0, 60));
    await p.keyboard.press('Enter');
    ok(await until(p, () => __wux.appsMode === 'store' && document.querySelectorAll('#dapps [data-wam-id]').length >= 5), 'desktop: Get apps opens the App Store with real index apps');
    await shot(p, 'd1-store');
    await p.fill('#dapps [data-dapps-q]', 'browser');
    ok(await until(p, () => [...document.querySelectorAll('#dapps .lrow')].some(r => /Browser/.test(r.textContent))), 'desktop: index search finds Browser');
    await p.evaluate(() => [...document.querySelectorAll('#dapps .lrow')].find(r => /Browser/.test(r.textContent))?.click());
    ok(await until(p, () => __wux.appsMode === 'card'), 'desktop: result opens the card');
    await shot(p, 'd2-card');
    await p.keyboard.press('Escape'); await sleep(250);
    ok(await p.evaluate(() => __wux.appsMode) === 'store', 'desktop: Esc card → Store');
    await p.keyboard.press('Escape'); await sleep(250);
    ok(await p.evaluate(() => __wux.appsMode) === 'apps' && await until(p, () => document.querySelectorAll('#dapps [data-wam-id]').length >= 3), 'desktop: Esc Store → My apps (installed)');
    await shot(p, 'd3-my-apps');
    await p.keyboard.press('Escape'); await sleep(250);
    ok(await p.evaluate(() => __wux.appsMode) === '' && p.url().startsWith(ORIGIN), 'desktop: Esc My apps → closed, page stays');
    await p.goto(BASE + '?shell=desktop&view=resources', { waitUntil: 'load' });
    ok(await until(p, () => document.querySelectorAll('[data-wam-res] .wam-meter').length >= 3), 'desktop: ?view=resources → Settings with Resources meters');
    await shot(p, 'd4-resources');
    await p.goto(BASE + '?shell=desktop&view=apps', { waitUntil: 'load' });
    ok(await until(p, () => __wux.appsMode === 'apps' && document.querySelectorAll('#dapps [data-wam-id]').length >= 3), 'desktop: ?view=apps → My apps panel');
    ok(!errs.length, 'desktop: no page errors', JSON.stringify(errs));
    ok(W.runs === 0, 'desktop: zero /v1/runs writes', String(W.runs));
    await ctx.close();
  }
  const refused1 = await fetch(ORIGIN + '/__qa/refused-apps').then(r => r.json()).then(j => j.refused).catch(() => null);
  ok(refused0 != null && refused1 > refused0, 'preview origin refused every lifecycle write', `${refused0} → ${refused1}`);
  await b.close();
  console.log(`\nqa-apps-views ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
