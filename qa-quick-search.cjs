// QA (quick search): the "image search …" / "quick search …" spell opens Wizard Search in the link sheet
// over whatever James is doing: no new thread, no desk change. Images open in the shell's viewer; Back steps
// viewer → sheet → stays in Wizard. Wizard Search itself is the real local service (real images + overview).
// Usage: node qa-quick-search.cjs. Every Hermes/Wizard write is refused and recorded.
const { chromium } = require('./tools/qa-playwright.cjs');
const fs = require('fs'), path = require('path');
const ORIGIN = require('./tools/qa-paths.cjs').origin(), URL_ = ORIGIN + '/wizard-os-home/';
const WEB = process.env.QA_WEB_DIR || __dirname, SEARCH = process.env.QA_SEARCH || 'http://127.0.0.1:9288';
const SHOTS = process.env.QA_SHOTS || '';
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const NOW = Date.now();
const THREADS = Array.from({ length: 6 }, (_, i) => ({ id: `qa-${i}`, title: `QA thread ${i + 1}`, source: 'api_server', model: 'qa', message_count: 2, preview: 'Preview', last_active: NOW / 1000 - i * 600, started_at: NOW / 1000 - i * 600 - 60 }));
const CT = { '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.js': 'application/javascript' };

async function boot(b) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true });
  const writes = [];
  const json = (r, o, s = 200) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url()), m = q.method();
    if (u.hostname !== new URL(require('./tools/qa-paths.cjs').origin()).hostname) {
      // Image hosts the search page may touch directly (favicons): allow, they are read-only.
      return m === 'GET' ? r.continue() : r.abort();
    }
    if (u.pathname.startsWith('/wizard-search/')) {
      const res = await r.fetch({ url: SEARCH + u.pathname + u.search }).catch(() => null);
      return res ? r.fulfill({ response: res }) : r.abort();
    }
    const sh = u.pathname.match(/^\/wizard-os-home\/(.*)$/);
    if (sh && (m === 'GET' || m === 'HEAD')) {
      const f = sh[1] || 'index.html', p = path.join(WEB, 'web', f);
      if (!fs.existsSync(p) || /^(data|summaries)\.js$/.test(f)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
      return r.fulfill({ status: 200, contentType: CT[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(p) });
    }
    if (m !== 'GET' && m !== 'HEAD') {
      writes.push(`${m} ${u.pathname}`);
      if (u.pathname === '/wizard/thread-seen') return json(r, { state: { initializedAt: NOW, threads: {} } });
      if (u.pathname === '/wizard/v1/route') return json(r, { ms: 5, cmd: { route: 'agent' } });
      return json(r, { error: 'qa: write refused' }, 403);
    }
    if (u.pathname === '/wizard/v1/bootstrap') return json(r, { bootstrap: 1, api: 'wizard-agent-service/1', settings: { owner: { name: 'Robin', place: '' }, agent: { name: 'Merlin' }, clock: { timezone: 'UTC', day_starts_at: '06:00' }, voice: { language: 'en', vocabulary: [] } },
      capabilities: { voice: true, router: true, files: true, approvals: true, steer: true, markdown: true }, endpoints: { sessions: '/wizard/hermes/api/sessions', runs: '/wizard/hermes/v1/runs', transcribe: '/wizard/voice/transcribe', route: '/wizard/v1/route', upload: '/wizard/files/upload', apps: '/wizard/v1/apps' } });
    if (u.pathname === '/wizard/hermes/api/sessions') return json(r, { data: THREADS, has_more: false });
    const mm = u.pathname.match(/^\/wizard\/hermes\/api\/sessions\/([^/]+)\/messages$/);
    if (mm) return json(r, { object: 'list', data: [{ id: 1, role: 'user', content: 'hello', timestamp: NOW / 1000 - 100 }, { id: 2, role: 'assistant', content: 'hi', timestamp: NOW / 1000 - 90 }] });
    const sm = u.pathname.match(/^\/wizard\/hermes\/api\/sessions\/([^/]+)$/);
    if (sm) { const t = THREADS.find(x => x.id === decodeURIComponent(sm[1])); return t ? json(r, { session: t }) : json(r, { error: 'not_found' }, 404); }
    if (u.pathname === '/wizard/thread-seen') return json(r, { state: { initializedAt: NOW - 864e5, threads: {} } });
    if (u.pathname === '/wizard/thread-dispositions') return json(r, { state: {} });
    if (u.pathname === '/wizard/v1/apps') return json(r, { apps: [{ id: 'wizard-search', name: 'Search', desc: 'Image search and AI overview', url: '/wizard-search/', icon: '⌕', colors: ['#8f63ff', '#ff5ccf'], source: 'launcher.json' }] });
    return json(r, {});
  });
  await ctx.addInitScript(() => { try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.voiceTipSeen', 'true'); } catch (e) {} });
  const p = await ctx.newPage(); p.errs = [];
  p.on('pageerror', e => p.errs.push(String(e)));
  await p.goto(ORIGIN + '/qa-start').catch(() => {}); // a page before ours, so a wrong Back would really leave
  await p.goto(URL_, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__wos && window.__wos.live && window.__wos.live.ok, null, { timeout: 30000 });
  await p.waitForFunction(() => window.WizCore.apps && document.querySelector('#search'), null, { timeout: 10000 });
  await sleep(1200);
  return { ctx, p, writes };
}
const sheetState = p => p.evaluate(() => { const L = window.__wos.links; return L ? L.state() : { open: false }; });
const frame = p => p.frames().find(f => /\/wizard-search\//.test(f.url()));
const shot = async (p, n) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, n + '.png') }); };

(async () => {
  const b = await chromium.launch();
  const { p, writes } = await boot(b);
  const startUrl = p.url(), deskBefore = await p.evaluate(() => window.__wos.idx);

  // 1. The image spell from home.
  await p.evaluate(() => window.__wos.runUtterance('image search capybaras', 'auto', true));
  await sleep(1500);
  let s = await sheetState(p);
  ok(s.open && /\/wizard-search\/\?q=capybaras&tab=images/.test(s.url), '"image search capybaras" opens the search sheet on Images', JSON.stringify(s));
  let f = frame(p);
  await f.waitForFunction(() => window.WizardSearch && window.WizardSearch.state().images > 10, null, { timeout: 20000 }).catch(() => {});
  let st = await f.evaluate(() => window.WizardSearch.state());
  ok(st.images > 10 && st.tab === 'images', `real image results load (${st.images})`, JSON.stringify(st));
  const thumbsOk = await f.waitForFunction(() => [...document.querySelectorAll('#grid img')].slice(0, 6).filter(i => i.complete && i.naturalWidth > 20).length >= 4, null, { timeout: 15000 }).then(() => true).catch(() => false);
  ok(thumbsOk, 'thumbnails actually render (proxied, same origin)');
  ok(!writes.some(w => /runs|sessions/.test(w)), 'no thread or run was created', JSON.stringify(writes));
  ok(await p.evaluate(() => window.__wos.idx) === deskBefore, 'desk unchanged');
  await shot(p, '1-images');

  // 2. Tap an image → the shell's full-screen viewer; Back closes it, Back closes the sheet, Back stays in Wizard.
  await f.locator('#grid .tile').first().tap();
  await sleep(800);
  let v = await p.evaluate(() => window.__wos.viewer);
  ok(v.open && v.n > 10 && v.kind === 'image', 'tapping an image opens the full-screen viewer with every result', JSON.stringify(v));
  const fullOk = await p.waitForFunction(() => { const i = document.querySelector('.mv-stage img'); return i && i.complete && i.naturalWidth > 100; }, null, { timeout: 15000 }).then(() => true).catch(() => false);
  ok(fullOk, 'full-size image loads in the viewer');
  await shot(p, '2-viewer');
  await p.evaluate(() => history.back()); await sleep(700);
  v = await p.evaluate(() => window.__wos.viewer); s = await sheetState(p);
  ok(!v.open && s.open, 'Back #1 closes the viewer, search stays', JSON.stringify({ v, s }));
  await p.evaluate(() => history.back()); await sleep(700);
  s = await sheetState(p);
  ok(!s.open, 'Back #2 closes the search sheet', JSON.stringify(s));
  await p.evaluate(() => history.back()); await sleep(900);
  ok(p.url().startsWith(URL_) && p.url() !== ORIGIN + '/qa-start', 'Back #3 at home: still in Wizard', p.url());
  void startUrl;

  // 3. Over an open thread: plain "search …" stays the thread's; "quick search …" opens the overlay; thread stays open.
  await p.evaluate(() => window.__wos.openWizardThread('qa-0')); await sleep(1500);
  const lm = await p.evaluate(() => { const S = window.WizCore.apps('mobile'); return { plain: S.quickSearch('search best ramen in bangkok'), strong: S.quickSearch('quick search best ramen in bangkok'), chats: S.quickSearch('search my chats for ramen'), img: S.quickSearch('show me pictures of eames chairs'), pics: S.quickSearch('Pictures of Bangkok skyline at night.') }; });
  ok(lm.plain && lm.plain.strong === false, 'plain "search …" is the weak form (agent keeps it inside a thread)', JSON.stringify(lm.plain));
  ok(lm.chats === null, '"search my chats for …" is not a web search');
  ok(lm.img && lm.img.tab === 'images' && lm.img.query === 'eames chairs', '"show me pictures of …" → images', JSON.stringify(lm.img));
  ok(lm.pics && lm.pics.query === 'Bangkok skyline at night', 'trailing punctuation trimmed', JSON.stringify(lm.pics));
  await p.evaluate(() => window.__wos.runUtterance('quick search why is the sky blue', 'auto', true));
  await sleep(1500);
  s = await sheetState(p);
  ok(s.open && /q=why\+is\+the\+sky\+blue/.test(s.url) && !/tab=images/.test(s.url), '"quick search …" opens All with the overview, over the thread', JSON.stringify(s));
  f = frame(p);
  const ovOk = await f.waitForFunction(() => window.WizardSearch.state().overview, null, { timeout: 45000 }).then(() => true).catch(() => false);
  st = await f.evaluate(() => window.WizardSearch.state());
  ok(ovOk && st.web > 3, `AI overview + web results arrive (web ${st.web})`, JSON.stringify(st));
  const cites = await f.evaluate(() => document.querySelectorAll('#ov a.cite').length);
  ok(cites >= 1, `overview carries source citations (${cites})`);
  await shot(p, '3-overview');
  await p.evaluate(() => history.back()); await sleep(700);
  const th = await p.evaluate(() => { const d = window.__wos.desks[window.__wos.idx], w = window.__wos.wins[d.focus]; return w && w.app === 'chats' ? w.thread : null; });
  ok(!(await sheetState(p)).open && th === 'qa-0', 'Back closes search and the thread is still open underneath', String(th));

  // 4. Launcher: typing a query offers Search and Image search rows.
  await p.evaluate(() => { window.__wos.goDesk(window.__wos.HOME, true); window.__wos.openSheet('launcher', 'capybara'); });
  await sleep(400);
  const rows = await p.evaluate(() => [...document.querySelectorAll('[data-qsearch]')].map(b => b.dataset.qtab));
  ok(rows.includes('all') && rows.includes('images'), 'launcher offers Search + Image search for a typed query', JSON.stringify(rows));
  await p.locator('[data-qsearch][data-qtab="images"]').tap(); await sleep(1200);
  s = await sheetState(p);
  ok(s.open && /q=capybara&tab=images/.test(s.url), 'tapping Image search opens the overlay', JSON.stringify(s));

  ok(!writes.some(w => /runs|sessions/.test(w)), 'whole run: zero thread/run writes', JSON.stringify(writes));
  ok(p.errs.length === 0, 'no page errors', JSON.stringify(p.errs));
  console.log(`\n${pass}/${pass + fail} passed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
