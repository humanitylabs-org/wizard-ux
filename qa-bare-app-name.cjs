// QA (bare app name, James 12 Oct): saying just an app's name ("Calendar.") opens that app, no "open" needed.
// Held orb: anywhere, on-device, no router call, nothing sent. Tap: off a thread; inside a thread a one-word tap
// stays a reply. Sentences that merely mention an app ("what's on my calendar today") never open it.
// Usage: QA_WEB_DIR=<tree> node qa-bare-app-name.cjs. Every Hermes/Wizard write is refused and recorded.
let chromium; try { ({ chromium } = require('playwright-core')); } catch (e) { ({ chromium } = require('/home/telos/node_modules/playwright')); }
const fs = require('fs'), path = require('path');
const ORIGIN = 'https://private.wizard001.com', URL_ = ORIGIN + '/wizard-os-home/';
const WEB = process.env.QA_WEB_DIR || __dirname;
const SHOTS = process.env.QA_SHOTS || '';
let pass = 0, fail = 0;
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const NOW = Date.now();
const THREADS = Array.from({ length: 6 }, (_, i) => ({ id: `qa-${i}`, title: `QA thread ${i + 1}`, source: 'api_server', model: 'qa', message_count: 2, preview: 'Preview', last_active: NOW / 1000 - i * 600, started_at: NOW / 1000 - i * 600 - 60 }));
const CT = { '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.js': 'application/javascript' };
const R = { cmd: { route: 'agent' }, down: false };
const routes = [];

async function boot(b) {
  const ctx = await b.newContext({ viewport: { width: 412, height: 892 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, ignoreHTTPSErrors: true });
  const writes = [];
  const json = (r, o, s = 200) => r.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(o) });
  await ctx.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url()), m = q.method();
    if (u.hostname !== 'private.wizard001.com') {
      // Image hosts the search page may touch directly (favicons): allow, they are read-only.
      return m === 'GET' ? r.continue() : r.abort();
    }
    if (/^\/wizard-(search|calendar|signal)\//.test(u.pathname)) {
      return r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Search</title><body>qa search</body>' });
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
      if (u.pathname === '/wizard/v1/route') { routes.push(JSON.parse(q.postData() || '{}')); return R.down ? json(r, { error: 'router_unavailable' }, 502) : json(r, { ms: 5, cmd: R.cmd }); }
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
    if (u.pathname === '/wizard/v1/apps') return json(r, { apps: [{ id: 'wizard-search', name: 'Search', desc: 'Image search and AI overview', url: '/wizard-search/', icon: '⌕', colors: ['#8f63ff', '#ff5ccf'], source: 'launcher.json' },
      { id: 'calendar', name: 'Calendar', desc: 'Your calendar', url: '/wizard-calendar/', source: 'launcher.json' },
      { id: 'wizard-signal', name: 'Wizard Signal', desc: 'Signal feed', url: '/wizard-signal/', source: 'launcher.json' }] });
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
const agentWrites = w => w.filter(x => /\/runs|\/sessions|\/upload/.test(x));
const shot = async (p, n) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, n + '.png') }); };
const closeSheet = async p => { if ((await sheetState(p)).open) { await p.evaluate(() => window.__wos.links.close()); await sleep(500); } };
const card = p => p.evaluate(() => ({ chips: [...document.querySelectorAll('#txChips [data-hold]')].map(b => b.dataset.hold), text: document.querySelector('#txText')?.textContent || '', label: document.querySelector('#txRouteText')?.textContent || '' }));
const hold = (p, text) => p.evaluate(t => window.__wos.handleText(t, 'command', false, 300, null), text);
const outboxN = p => p.evaluate(() => (window.__wos.outbox?.unsent?.() || []).length);


const front = p => p.evaluate(() => { const d = window.__wos.desks[window.__wos.idx], w = window.__wos.wins[d.focus]; return w ? (w.appId || w.app) + (w.thread ? ':' + w.thread : '') : null; });
const say = (p, t, kind) => p.evaluate(([t, k]) => window.__wos.handleText(t, k, false, 300, null), [t, kind]);
const home = async p => { await p.evaluate(() => { for (const id of Object.keys(window.__wos.wins)) if (window.__wos.wins[id].appId === 'calendar' || window.__wos.wins[id].appId === 'wizard-signal') window.__wos.closeWin(id); window.__wos.goDesk(window.__wos.HOME, true); }); await sleep(500); };

(async () => {
  const b = await chromium.launch(process.env.QA_CHROME ? { executablePath: process.env.QA_CHROME } : {});
  const { p, writes } = await boot(b);
  R.cmd = { route: 'agent', summary: 'x' };

  // 1. James's case: held "Calendar." on home → Calendar opens, on-device, router never asked, nothing sent.
  for (const t of ['Calendar.', 'calendar', 'My calendar', 'the calendar app', 'Open calendar']) {
    await home(p); writes.length = 0; routes.length = 0;
    await say(p, t, 'command'); await sleep(900);
    const f = await front(p);
    ok(f === 'calendar' && routes.length === 0 && agentWrites(writes).length === 0, `held "${t}" opens Calendar on-device`, JSON.stringify({ f, routes, writes }));
  }
  await shot(p, '1-held-calendar');
  // 2. Tapped on the Chats list / home: same.
  await home(p); await p.evaluate(() => window.__wos.openApp && window.__wos.openApp('wizard')); await sleep(800);
  writes.length = 0; routes.length = 0;
  await say(p, 'Calendar', 'auto'); await sleep(900);
  let f = await front(p);
  ok(f === 'calendar' && routes.length === 0 && agentWrites(writes).length === 0, 'tapped "Calendar" from the chat list opens Calendar', JSON.stringify({ f, routes, writes }));
  // 3. "Signal" opens Wizard Signal (name without its Wizard prefix), "search" opens Search app untouched by fuzzy guesses.
  await home(p); routes.length = 0;
  await say(p, 'Signal', 'command'); await sleep(900);
  f = await front(p); ok(f === 'wizard-signal' && routes.length === 0, 'held "Signal" opens Wizard Signal', JSON.stringify({ f, routes }));
  // 4. Held over an open thread: still opens Calendar, nothing posted into the thread.
  await home(p); await p.evaluate(() => window.__wos.openWizardThread('qa-0')); await sleep(1500);
  writes.length = 0;
  await say(p, 'Calendar.', 'command'); await sleep(900);
  f = await front(p); ok(f === 'calendar' && agentWrites(writes).length === 0, 'held "Calendar." over an open thread opens Calendar, nothing posted', JSON.stringify({ f, writes }));
  // 5. Tapped inside a thread: the word stays a reply to that thread (no app hijack).
  await home(p); await p.evaluate(() => window.__wos.openWizardThread('qa-1')); await sleep(1500);
  writes.length = 0;
  await say(p, 'Calendar', 'auto'); await sleep(2500);
  f = await front(p);
  ok(f !== 'calendar', 'tapped "Calendar" inside a thread does not open the app', String(f));
  await p.evaluate(() => { const o = window.__wos.outbox; for (const it of o.unsent()) o.remove(it.id); });
  // 6. Sentences that mention an app never open it on-device.
  for (const t of ['What is on my calendar today', 'calendar invites from Tony', 'signal is weak here']) {
    await home(p); routes.length = 0;
    await say(p, t, 'command'); await sleep(900);
    f = await front(p);
    ok(f !== 'calendar' && f !== 'wizard-signal' && routes.length === 1, `held "${t}" is not a bare name (goes to the router)`, JSON.stringify({ f, routes: routes.length }));
    await p.evaluate(() => window.__wos.onBack()); await sleep(300);
  }
  // 7. Unknown single words don't fuzzy-open anything ("cal", "music" with no music app → no Spotify guess either).
  await home(p); routes.length = 0;
  await say(p, 'cal', 'command'); await sleep(900);
  f = await front(p); ok(f !== 'calendar', 'held "cal" does not fuzzy-open Calendar', String(f));
  await p.evaluate(() => window.__wos.onBack()); await sleep(300);
  // 8. Back from Calendar stays in Wizard.
  await home(p); await say(p, 'Calendar', 'command'); await sleep(900);
  await p.evaluate(() => window.__wos.onBack()); await sleep(600);
  ok(p.url().startsWith(URL_), 'Back from Calendar stays in Wizard', p.url());

  ok(p.errs.length === 0, 'no page errors', JSON.stringify(p.errs));
  console.log(`\n${pass}/${pass + fail} passed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
