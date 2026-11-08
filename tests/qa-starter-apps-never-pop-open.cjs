'use strict';
// James, 6 Nov 2026: "things keep popping open, particularly the Topics app ... What keeps opening apps I didn't want
// to open?" The phone shell seeds the launcher's starter apps (autoOpen: Topics, Mizel) into a layout it creates for
// a fresh browser storage, and workspace sync pushed those desks to the box as his open apps, so they appeared on
// every device. Real phone shell, synthetic origin and box only (never the owner's data or runs), two skins:
//   1. a fresh phone joining a box that already has his open apps shows only his apps and never sends Topics/Mizel;
//   2. an explicit open of Topics still opens it and it syncs like any app he opened.
// Usage: node tests/qa-starter-apps-never-pop-open.cjs   (QA_OUT=<dir> keeps screenshots and report.json)
const { chromium } = require('../tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const web = path.resolve(__dirname, '../web'), out = process.env.QA_OUT || path.resolve('qa/starter-apps-never-pop-open');
const origin = 'http://starter-apps.qa', prefix = '/wizard-os-home/';
const APPS = [
  { id: 'topics', name: 'Topics', kind: 'wizard', url: '/wizard-topics-preview/', source: 'apps.json' },
  { id: 'mizel', name: 'Mizel', kind: 'wizard', url: '/mizel-live/', source: 'apps.json' },
  { id: 'messenger', name: 'Messenger', kind: 'wizard', url: '/messenger/', source: 'apps.json' },
];
const fails = [], report = { cases: [] };
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME ? { executablePath: process.env.QA_CHROME } : {}) });
  try {
    for (const skin of ['nebula', 'grove']) {
      const box = { rev: 40, state: { desks: [
        { id: 'downer1', wins: [{ id: 'wownc1', app: 'chats', thread: null }] },
        { id: 'downer2', wins: [{ id: 'wownm1', app: 'frame', appId: 'messenger' }] },
      ] }, closed: [] };
      const st = { puts: [], runs: [], errors: [], pageerrors: [] };
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block', reducedMotion: 'reduce' });
      await ctx.routeWebSocket('**/*', ws => ws.close());
      await ctx.addInitScript(skin => {
        if (window !== top) return;
        for (const [k, v] of Object.entries({ 'wos.skin': skin, 'wos.tour.done': '1', 'wos.tour.v1': 'true', 'wos.coached': 'true', 'wos.welcome.v1': 'done' })) if (localStorage.getItem(k) === null) localStorage.setItem(k, v);
      }, skin);
      const json = (r, body, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      await ctx.route('**/*', async r => {
        const q = r.request(), u = new URL(q.url()), p = u.pathname;
        if (u.origin !== origin) return r.abort();
        if (p.includes('/v1/runs')) { st.runs.push(p); return r.abort(); }
        if (p === '/wizard/v1/workspaces') {
          if (q.method() === 'PUT') {
            const b = q.postDataJSON(); st.puts.push(b.state.desks.flatMap(d => d.wins.map(w => w.appId || w.app)));
            if (b.baseRev !== box.rev) return json(r, { rev: box.rev, state: box.state, closed: [] }, 409);
            box.rev++; box.state = b.state; return json(r, { rev: box.rev, state: box.state, closed: [] });
          }
          return json(r, { rev: box.rev, state: box.state, closed: [] });
        }
        if (p === '/wizard/v1/ui-preferences') return json(r, { migrations: { 'launcher-seed-v1': true }, launcher: { autoOpen: ['topics', 'mizel'] } });
        if (q.method() !== 'GET' && q.method() !== 'HEAD') return json(r, { error: 'QA refuses writes' }, 403);
        if (p === '/wizard/v1/bootstrap') return json(r, { bootstrap: 1, settings: { owner: {}, agent: { name: 'Wizard' }, clock: {}, voice: {} }, endpoints: { apps: '/fixture/apps' }, capabilities: {} });
        if (p === '/fixture/apps') return json(r, { apps: APPS });
        if (p === '/wizard/v1/agents') return json(r, { agents: [] });
        if (p === '/wizard/hermes/api/sessions') return json(r, { object: 'list', data: [], has_more: false });
        if (APPS.some(a => p === a.url)) return r.fulfill({ contentType: 'text/html', body: `<h1>${p}</h1>` });
        if (p.startsWith(prefix + 'store-data/')) return json(r, { apps: [], installed: [], wam: [], complete: true });
        const rel = p.startsWith(prefix) ? p.slice(prefix.length) || 'index.html' : '';
        const f = path.resolve(web, rel);
        if (rel && f.startsWith(web + path.sep) && fs.existsSync(f) && fs.statSync(f).isFile()) return r.fulfill({ contentType: types[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f) });
        if (p.endsWith('/data.js') || p.endsWith('/summaries.js')) return r.fulfill({ contentType: 'text/javascript', body: '' });
        return json(r, {}, 404);
      });
      const p = await ctx.newPage(); p.on('pageerror', e => st.pageerrors.push(e.message));
      const state = () => p.evaluate(() => ({
        apps: window.__wos.desks.filter(d => !d.home).flatMap(d => d.wins.map(id => window.__wos.wins[id]).filter(Boolean).map(w => w.appId || w.app)),
        desks: window.__wos.desks.filter(d => !d.home).map(d => d.id),
        frames: [...document.querySelectorAll('iframe.appframe')].map(f => f.getAttribute('src')).filter(Boolean),
      }));
      await p.goto(origin + prefix + 'index.html');
      await p.waitForFunction(() => window.__wos && window.WizLauncher?.settled, null, { timeout: 15000 });
      await p.waitForTimeout(3500); // the launcher settles, the app list lands (lateLayout), workspace sync joins
      await p.getByText('Skip', { exact: true }).click({ timeout: 800 }).catch(() => {});
      const joined = await state();
      const leaked = st.puts.filter(a => a.includes('topics') || a.includes('mizel'));
      const c1 = { skin, step: 'fresh phone joins', joined, puts: st.puts, box: box.state.desks.map(d => d.wins.map(w => w.appId || w.app)) };
      if (joined.apps.includes('topics') || joined.apps.includes('mizel')) fails.push(`${skin}: phone shows apps James never opened: ${joined.apps}`);
      if (joined.frames.some(s => /topics|mizel/.test(s))) fails.push(`${skin}: a starter app frame loaded: ${joined.frames}`);
      if (leaked.length) fails.push(`${skin}: workspace sync sent starter apps to the box: ${JSON.stringify(leaked)}`);
      if (!joined.apps.includes('messenger')) fails.push(`${skin}: James's own open apps did not arrive: ${joined.apps}`);
      await p.screenshot({ path: path.join(out, `${skin}-joined.png`) });
      report.cases.push(c1);
      // Explicit open still works and travels.
      await p.evaluate(() => window.WizCore.deeplink.route(location.origin + '/wizard-os-home/?open=topics'));
      await p.waitForTimeout(1500);
      const opened = await state();
      if (!opened.apps.includes('topics')) fails.push(`${skin}: explicit open of Topics did not open it: ${opened.apps}`);
      if (!box.state.desks.some(d => d.wins.some(w => w.appId === 'topics'))) fails.push(`${skin}: explicitly opened Topics did not sync`);
      await p.screenshot({ path: path.join(out, `${skin}-opened-topics.png`) });
      report.cases.push({ skin, step: 'explicit open', opened, runs: st.runs, pageerrors: st.pageerrors });
      if (st.runs.length) fails.push(`${skin}: runs ${st.runs}`);
      await ctx.close();
    }
  } finally {
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ ...report, fails }, null, 2));
    await browser.close();
  }
  if (fails.length) { console.error('FAIL', fails); process.exit(1); }
  console.log('PASS starter apps never pop open on a joining phone; explicit open still works (nebula, grove)');
})().catch(e => { console.error(e); process.exit(1); });
