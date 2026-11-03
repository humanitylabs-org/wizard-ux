// Flat relevance-aware search on both shells, main + routed host-profile agent. Synthetic only; all writes blocked.
const fs = require('fs'), path = require('path'), os = require('os');
const { chromium } = require('./tools/qa-playwright.cjs');
const TREE = process.env.QA_TREE || __dirname;
const OUT = process.env.QA_OUT || path.join(os.homedir(), '.hermes/cache/screenshots');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const cases = [];
const ok = (value, name, detail = '') => { const success = !!value; success ? pass++ : fail++; cases.push({ name, pass: success, detail }); console.log(`${success ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail)}`); };
const NOW = Date.now(), HOUR = 3600000, ROUTED = 'qa-host';
const agents = [{ id: 'hermes', is_default: true, label: 'Hermes' }, { id: ROUTED, label: 'Synthetic routed', runtime: { kind: 'host-profile', profile: ROUTED } }].map(a => ({ harness: 'hermes', privacy: 'standard', status: 'running', ...a }));
const rowsFor = agent => [
  ['body', 'Follow-up plan', 1, { archived: true, preview: 'A recent answer', searchSnippet: 'The messenger work is ready' }],
  ['preview', 'Delivery notes', 2, { preview: 'Update for messenger' }],
  ['working', 'Messenger delivery', 12, { status: 'running' }],
  ['snoozed', 'Messenger later', 48, { deferred: true, deferredAt: new Date(NOW).toISOString() }],
  ['error', 'Messenger retry', 72, { status: 'failed' }],
  ['old', 'Messenger project', 168, {}],
].map(([suffix, title, hours, extra]) => { const at = new Date(NOW - hours * HOUR).toISOString(); return { id: `qa_${agent}_${suffix}`, agent, title, preview: 'Synthetic answer', status: 'completed', archived: false, hidden: false, messageCount: 2, listVersion: 1, cardTime: at, updatedAt: at, activityAt: at, previewAt: at, lastUserAt: at, assignedAt: at, requestAt: at, ...extra }; });
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const errors = [], writes = [], bodyRequests = [];
  const browser = await chromium.launch({ executablePath: process.env.QA_CHROME || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    for (const shell of ['phone', 'desktop']) {
      const ctx = await browser.newContext({ viewport: shell === 'phone' ? { width: 412, height: 892 } : { width: 1280, height: 860 }, ...(shell === 'phone' ? { isMobile: true, hasTouch: true } : {}), serviceWorkers: 'block' });
      try {
        await ctx.addInitScript(shell => {
          for (const [k,v] of Object.entries({
            'wos.chats.pinned.v2': JSON.stringify(['qa_hermes_old', 'qa_qa-host_old']), 'wos.chats.pinned.migrated.v1': '1',
            'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.tour.done': '1', 'wos.welcome.v1': 'done', 'wos.skin': 'nebula', 'wux.shell': shell, 'wos.chats.layout.v1': 'status', 'wos.chats.archiveAfter.v1': '0' })) localStorage.setItem(k,v);
        }, shell);
        await ctx.route('**/*', async route => {
          const req = route.request(), u = new URL(req.url());
          const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
          if (u.hostname !== 'wizard.test') return route.abort();
          if (!['GET', 'HEAD'].includes(req.method())) { writes.push([req.method(), u.pathname]); return json({ error: 'synthetic QA: write refused' }, 403); }
          if (u.pathname === '/wizard/v1/ui-preferences') return json({ pinnedChats: ['qa_hermes_old', `qa_${ROUTED}_old`], chatLayout: 'status', archiveAfterDays: 0 });
          if (u.pathname === '/wizard/v1/agents') return json({ agents });
          if (u.pathname === '/wizard/v1/setup/status') return json({ first_run: false, complete: true });
          if (u.pathname === '/wizard/hermes/model/options') return json({ options: [{ provider: 'synthetic', model: 'qa', authenticated: true }], current: { provider: 'synthetic', model: 'qa' } });
          if (u.pathname === '/wizard/hermes/api/sessions') {
            const agent = u.searchParams.get('agent') || 'hermes', rows = rowsFor(agent);
            if (u.searchParams.get('mode') === 'body') { bodyRequests.push(agent); return json({ mode: 'body', list_version: 1, snapshot: 'qa-body-' + agent, data: rows.map(r => ({ id: r.id, agent, snippet: r.searchSnippet || 'messenger synthetic match' })), search_total: rows.length, has_more: false, partial: false }); }
            return json({ data: rows, view: 'list', list_version: 1, window: 'archive-50', archive_total: 1, archive_returned: 1, has_more: false, archive_cursor: null, snapshot: 'qa-flat-' + agent, fields: u.searchParams.get('fields') || undefined });
          }
          if (u.pathname === '/wizard/thread-dispositions') return json({ state: { 'direct:qa_hermes_snoozed': { deferred: true, updatedAt: new Date(NOW).toISOString() }, [`agent/${ROUTED}/direct:qa_${ROUTED}_snoozed`]: { deferred: true, updatedAt: new Date(NOW).toISOString() } } });
          if (u.pathname === '/wizard/thread-seen') return json({ state: { initializedAt: 1, threads: {} } });
          if (u.pathname === '/wizard/v1/boomerangs') return json({ reminders: [] });
          if (u.pathname.startsWith('/wizard/')) return json({});
          if (u.pathname.startsWith('/wizard-os-home/')) {
            const rel = u.pathname.slice('/wizard-os-home/'.length) || 'index.html', file = path.join(TREE, 'web', rel);
            if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: '' });
            const ct = { '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' }[path.extname(file)] || 'application/javascript';
            return route.fulfill({ contentType: ct, body: fs.readFileSync(file) });
          }
          return route.fulfill({ status: 404, body: '' });
        });
        const page = await ctx.newPage(); page.on('pageerror', e => errors.push(String(e)));
        await page.goto(`https://wizard.test/wizard-os-home/${shell === 'desktop' ? 'desktop.html' : ''}`, { waitUntil: 'load' });
        await page.waitForFunction(() => (window.__wos || window.__wux) && window.WizCore?.apps);
        ok(await page.evaluate(shell => shell === 'desktop' ? window.__wux?.shell === 'desktop' && document.documentElement.dataset.shell === 'desktop' : !!window.__wos && !window.__wux, shell), `${shell}: correct shell runtime, not a redirected phone mock`);
        for (const agent of ['hermes', ROUTED]) {
          ok(await page.evaluate(a => WizOpenAgentChats(a), agent), `${shell}/${agent}: shell opens agent Chats`);
          const wid = await page.waitForFunction(a => Object.values((window.__wux || window.__wos).wins).find(w => w.app === 'chats' && w.focus?.kind === 'agent' && w.focus.key === a)?.id, agent).then(h => h.jsonValue());
          const root = shell === 'desktop' ? `.win[data-win="${wid}"]` : `[data-chats="${wid}"]`;
          await page.waitForSelector(`${root} [data-chsearch]`);
          await page.waitForFunction(() => window.WosExperience && !WosExperience.state.busy);
          await sleep(700); await page.evaluate(() => document.getElementById('wosWelcome')?.remove());
          await page.fill(`${root} [data-chsearch]`, 'messenger');
          await page.waitForSelector(`${root} [data-chbs="done"]`); await sleep(400);
          // Desktop keeps an inert, hidden list in the split-view main pane; assert only rendered geometry.
          const get = () => page.evaluate(root => { const r = document.querySelector(root), visible = e => !!(e.getBoundingClientRect().width && e.getBoundingClientRect().height), rows = [...r.querySelectorAll('.ch-row')].filter(visible), footer = [...r.querySelectorAll('[data-chbs="done"]')].find(visible); return { headers: [...r.querySelectorAll('.ch-sec-h')].filter(visible).length, ids: rows.map(e => e.dataset.chopen), tags: rows.map(e => e.querySelector('.ch-search-status')?.textContent), bounds: rows.map(e => { const b=e.getBoundingClientRect(); return { top:b.top,bottom:b.bottom,width:b.width }; }), footer: footer?.getBoundingClientRect().top }; }, root);
          let s = await get();
          ok(bodyRequests.includes(agent), `${shell}/${agent}: body search uses the requested agent route`, bodyRequests);
          ok(await page.locator(`${root} .ch-row-wrap.pinned [data-chopen="qa_${agent}_old"]:visible`).count() === 1, `${shell}/${agent}: the oldest fixture really is pinned`);
          ok(s.headers === 0, `${shell}/${agent}: no search section headers`, s.headers);
          const expected = ['working', 'snoozed', 'error', 'old', 'preview', 'body'].map(k => `qa_${agent}_${k}`);
          ok(JSON.stringify(s.ids) === JSON.stringify(expected), `${shell}/${agent}: exact relevance rank, incidental body mention last; pins receive no boost`, s.ids);
          ok(s.tags.length === 6 && s.tags.every(t => ['Working','Ready','Archive','Error','Snoozed'].includes(t)) && s.tags.includes('Archive') && s.tags.includes('Snoozed') && s.tags.includes('Error'), `${shell}/${agent}: every row has its status chip`, s.tags);
          ok(s.ids.includes(`qa_${agent}_body`) && s.ids.indexOf(`qa_${agent}_body`) > s.ids.indexOf(`qa_${agent}_old`), `${shell}/${agent}: week-old title beats recent incidental archived body hit`, s.ids);
          ok(s.bounds.length > 0 && s.bounds.every((b,i) => b.width > 0 && (!i || b.top >= s.bounds[i-1].bottom - 1)) && s.footer >= Math.max(...s.bounds.map(b => b.bottom)) - 1, `${shell}/${agent}: no overlap, completed footer below rows`, s);
          if (agent === 'hermes') {
            for (const skin of shell === 'phone' ? ['nebula','grove','obsidian','landscapes'] : ['nebula','grove']) {
              await page.evaluate(id => WosSkin.set(id), skin);
              await page.waitForFunction(id => document.documentElement.dataset.skin === id && !WosExperience.state.busy, skin);
              if (await page.$('.nv-boot')) await page.locator('.nv-boot').click({ position: { x: 10, y: 10 } }).catch(() => {});
              await sleep(900);
              s = await get();
              ok(s.headers === 0 && s.ids.length === 6 && s.footer >= Math.max(...s.bounds.map(b => b.bottom)) - 1, `${shell}/${skin}: flat flow and footer after live skin switch`, s);
              await page.screenshot({ path: path.join(OUT, `search-rank2-${shell}-${skin}.png`) });
            }
          }
          await page.fill(`${root} [data-chsearch]`, ''); await sleep(400);
          const sections = await page.evaluate(root => [...document.querySelectorAll(`${root} .ch-sec[data-sec]`)].filter(e => e.getBoundingClientRect().width && e.getBoundingClientRect().height).map(e => [e.dataset.sec,e.getBoundingClientRect().top]).sort((a,b)=>a[1]-b[1]), root);
          ok(sections.length >= 2 && sections[0][0] === 'archive', `${shell}/${agent}: clearing search restores By-status sections with Archive on top`, sections);
        }
      } catch(e) { ok(false, `${shell}: complete search scenario`, String(e.stack)); }
      finally { await ctx.close(); }
    }
    ok(errors.length === 0, 'no page errors', errors);
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(OUT, 'search-flat-results.json'), JSON.stringify({ pass, fail, cases, writes, bodyRequests, tree: TREE }, null, 2));
  console.log(`${pass} pass, ${fail} fail`); process.exitCode = fail ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
