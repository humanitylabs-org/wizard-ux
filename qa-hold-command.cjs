// QA (hold = command): a held orb is a command for the interface and never becomes a message to the agent.
// "Search for good art" held over home or over an open thread opens Wizard Search; a held phrase that matches no
// command shows choices and sends nothing until one is tapped; a router outage on a hold sends nothing.
// A tap (not a hold) still reaches the agent / the open thread as before.
// Usage: QA_WEB_DIR=<tree> node qa-hold-command.cjs. Every Hermes/Wizard write is refused and recorded.
let chromium; try { ({ chromium } = require('playwright-core')); } catch (e) { ({ chromium } = require('/home/telos/node_modules/playwright')); }
const fs = require('fs'), path = require('path');
const ORIGIN = 'https://wizard.tailc0f369.ts.net', URL_ = ORIGIN + '/wizard-os-home/';
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
    if (u.hostname !== 'wizard.tailc0f369.ts.net') {
      // Image hosts the search page may touch directly (favicons): allow, they are read-only.
      return m === 'GET' ? r.continue() : r.abort();
    }
    if (u.pathname.startsWith('/wizard-search/')) {
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
const agentWrites = w => w.filter(x => /\/runs|\/sessions|\/upload/.test(x));
const shot = async (p, n) => { if (SHOTS) await p.screenshot({ path: path.join(SHOTS, n + '.png') }); };
const closeSheet = async p => { if ((await sheetState(p)).open) { await p.evaluate(() => window.__wos.links.close()); await sleep(500); } };
const card = p => p.evaluate(() => ({ chips: [...document.querySelectorAll('#txChips [data-hold]')].map(b => b.dataset.hold), text: document.querySelector('#txText')?.textContent || '', label: document.querySelector('#txRouteText')?.textContent || '' }));
const hold = (p, text) => p.evaluate(t => window.__wos.handleText(t, 'command', false, 300, null), text);
const outboxN = p => p.evaluate(() => (window.__wos.outbox?.unsent?.() || []).length);

(async () => {
  const b = await chromium.launch(process.env.QA_CHROME ? { executablePath: process.env.QA_CHROME } : {});
  const { p, writes } = await boot(b);
  const ob0 = await outboxN(p);

  // 1. James's case: held "Search for good art." on home → Wizard Search, nothing to the agent, router not even asked.
  writes.length = 0; routes.length = 0;
  await hold(p, 'Search for good art.'); await sleep(1200);
  let s = await sheetState(p);
  ok(s.open && /\/wizard-search\/\?q=good\+art(&|$)/.test(s.url), 'held "Search for good art." opens Wizard Search with q=good art', JSON.stringify(s));
  ok(agentWrites(writes).length === 0, 'held search: zero run/session writes', JSON.stringify(writes));
  ok(routes.length === 0, 'held search resolved on-device (no router call)', JSON.stringify(routes));
  await shot(p, '1-held-search-home');
  await closeSheet(p);

  // 2. Same, held over an open chat thread (the exact place it failed): search opens, thread untouched.
  await p.evaluate(() => window.__wos.openWizardThread('qa-0')); await sleep(1500);
  writes.length = 0;
  await hold(p, 'Search for good art.'); await sleep(1200);
  s = await sheetState(p);
  const th = await p.evaluate(() => { const d = window.__wos.desks[window.__wos.idx], w = window.__wos.wins[d.focus]; return w && w.app === 'chats' ? w.thread : null; });
  ok(s.open && /q=good\+art/.test(s.url), 'held "search for …" over an open thread opens Wizard Search', JSON.stringify(s));
  ok(th === 'qa-0', 'the thread stays open underneath', String(th));
  ok(agentWrites(writes).length === 0, 'held search over a thread: nothing posted into the thread', JSON.stringify(writes));
  for (const t of ['Look up capybaras', 'google eames chair', 'Search best ramen in Bangkok']) {
    await closeSheet(p); writes.length = 0;
    await hold(p, t); await sleep(900);
    s = await sheetState(p);
    ok(s.open && /\/wizard-search\//.test(s.url) && agentWrites(writes).length === 0, `held "${t}" over a thread → search, no writes`, JSON.stringify({ s, writes }));
  }
  await closeSheet(p);

  // 3. Held phrase the router calls "agent": choices, nothing sent.
  writes.length = 0; R.cmd = { route: 'agent', summary: 'x' };
  await hold(p, 'What is the capital of Peru'); await sleep(1000);
  let c = await card(p);
  ok(agentWrites(writes).length === 0, 'held non-command: nothing sent to the agent', JSON.stringify(writes));
  ok(c.chips.includes('search') && c.chips.includes('agent'), 'held non-command shows Search / Send choices', JSON.stringify(c));
  const xs = () => p.evaluate(() => { const x = document.querySelector('#txClose'), r = x.getBoundingClientRect(), vis = getComputedStyle(x).display !== 'none' && r.width >= 28;
    const hit = vis && x.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); return { vis, hit, w: Math.round(r.width), up: document.querySelector('#voice').classList.contains('tx') }; });
  let x = await xs();
  ok(x.vis && x.hit, 'choice card has a tappable × (hit-tested)', JSON.stringify(x));
  ok(/nothing sent/i.test(c.label), 'card says nothing was sent', c.label);
  ok(await outboxN(p) === ob0, 'outbox unchanged');
  await shot(p, '3-held-nomatch');
  // Tapping "Search the web" opens search with the words.
  await p.locator('#txChips [data-hold="search"]').tap(); await sleep(900);
  s = await sheetState(p);
  ok(s.open && /q=What\+is\+the\+capital\+of\+Peru/.test(s.url), 'tapping Search the web opens Wizard Search', JSON.stringify(s));
  ok(agentWrites(writes).length === 0, 'still nothing sent', JSON.stringify(writes));
  await closeSheet(p);

  // 3b. × closes the card at once, nothing sent (James, 11 Oct).
  writes.length = 0;
  await hold(p, 'What is the capital of Peru'); await sleep(800);
  await p.locator('#txClose').tap(); await sleep(450);
  c = await card(p); x = await xs();
  ok(c.chips.length === 0 && !x.up && !x.vis, 'tapping × closes the choice card', JSON.stringify({ c, x }));
  ok(agentWrites(writes).length === 0 && p.url().startsWith(URL_), '× sends nothing and stays in Wizard', JSON.stringify(writes));
  // 3c. It no longer lingers: gone on its own within ~4 s (was 9 s).
  await hold(p, 'What is the capital of Peru'); await sleep(3000);
  x = await xs(); ok(x.up, 'card still readable at 3 s', JSON.stringify(x));
  await sleep(1800); x = await xs();
  ok(!x.up, 'card auto-hides by ~4.5 s (was 9 s)', JSON.stringify(x));
  ok(agentWrites(writes).length === 0, 'auto-hide sends nothing', JSON.stringify(writes));
  c = await card(p); ok(c.chips.length === 0, 'auto-hide clears the hidden choices (next Back navigates, no invisible card)', JSON.stringify(c));
  // A plain transcript/pill never shows the ×.
  await p.evaluate(() => window.__wos.handleText('What is the capital of Peru', 'auto', false, 300, null)); await sleep(300);
  x = await xs(); ok(!x.vis, 'no × on a plain send pill', JSON.stringify(x));
  await sleep(2600); writes.length = 0;
  await p.evaluate(() => { const o = window.__wos.outbox; for (const it of o.unsent()) o.remove(it.id); });

  // 4. Back clears the choice card and stays in Wizard.
  await hold(p, 'What is the capital of Peru'); await sleep(800);
  await p.evaluate(() => window.__wos.onBack()); await sleep(600);
  c = await card(p);
  ok(c.chips.length === 0 && p.url().startsWith(URL_), 'Back dismisses the choice card, app stays open', JSON.stringify({ c, url: p.url() }));

  // 5. Router down on a hold: choices, nothing sent (it used to post to the agent).
  writes.length = 0; R.down = true;
  await hold(p, 'turn on focus mode'); await sleep(900);
  c = await card(p);
  ok(agentWrites(writes).length === 0 && c.chips.includes('agent'), 'router outage on a hold sends nothing and offers choices', JSON.stringify({ writes, c }));
  R.down = false;

  // 6. "Send to Archimedes" is an explicit opt-in: only then is the request queued.
  writes.length = 0;
  await p.locator('#txChips [data-hold="agent"]').tap(); await sleep(2500);
  const sentNow = agentWrites(writes).length > 0 || (await outboxN(p)) > ob0;
  ok(sentNow, 'tapping Send to agent queues it (explicit choice only)', JSON.stringify(writes));
  await p.evaluate(() => { const o = window.__wos.outbox; for (const it of o.unsent()) o.remove(it.id); });

  // 7. Router answers search for a hold → search app (not the launcher).
  await p.evaluate(() => window.__wos.goDesk(window.__wos.HOME, true)); await sleep(400);
  writes.length = 0; R.cmd = { route: 'command', action: 'search', query: 'brutalist architecture' };
  await hold(p, 'find me brutalist architecture'); await sleep(1000);
  s = await sheetState(p);
  ok(s.open && /q=brutalist\+architecture/.test(s.url) && agentWrites(writes).length === 0, 'router "search" on a hold opens Wizard Search', JSON.stringify({ s, writes }));
  await closeSheet(p);

  // 9. "Ask AI …" is the quick-question spell only when HELD; a tap is always a message.
  for (const [t, q, where] of [['Ask AI is milk bad for gout?', 'is\\+milk\\+bad\\+for\\+gout', 'home'], ['Ask AI, what is the capital of Peru?', 'what\\+is\\+the\\+capital\\+of\\+Peru', 'home']]) {
    writes.length = 0; routes.length = 0;
    await hold(p, t); await sleep(900);
    s = await sheetState(p);
    ok(s.open && new RegExp(`/wizard-search/\\?q=${q}(&|$)`).test(s.url) && routes.length === 0 && agentWrites(writes).length === 0, `held "${t}" on ${where} → Search on-device`, JSON.stringify({ s, routes, writes }));
    await closeSheet(p);
  }
  await p.evaluate(() => window.__wos.openWizardThread('qa-0')); await sleep(1200);
  writes.length = 0; routes.length = 0;
  await p.evaluate(() => window.__wos.handleText('Ask AI how long do capybaras live', 'auto', false, 300, null)); await sleep(900);
  s = await sheetState(p);
  ok(!s.open && routes.length === 0 && (agentWrites(writes).length > 0 || await outboxN(p) > 0), 'tapped "Ask AI …" over an open thread → message, no Search or router', JSON.stringify({ s, writes }));
  // Tap now starts an actual outbox send. Settle its failed-write fixture before the next independent command.
  await sleep(2600);
  await p.evaluate(async () => { for(const it of __wos.outbox.unsent()) await __wos.outbox.remove(it.id); });
  await closeSheet(p);
  // STT writes the spell with a colon. Re-establish the thread after the preceding tap's refused-send fixture.
  await p.evaluate(() => __wos.openWizardThread('qa-0')); await sleep(900);
  writes.length = 0; routes.length = 0;
  await hold(p, 'Search: is milk bad for gout?'); await sleep(900);
  s = await sheetState(p);
  ok(s.open && /q=is\+milk\+bad\+for\+gout(&|$)/.test(s.url) && routes.length === 0, 'held "Search: …" (STT colon) → Search on-device', JSON.stringify({ s, routes }));
  await closeSheet(p);
  // On the Chats list "find images of …" opens image search (it used to filter the chat list).
  await p.evaluate(() => window.__wos.onBack()); await sleep(800);
  const onList = await p.evaluate(() => { const d = window.__wos.desks[window.__wos.idx], w = window.__wos.wins[d.focus]; return w && w.app === 'chats' && !w.thread; });
  for (const [t, q] of [['find images of capybaras', 'capybaras'], ['Find images red pandas', 'red\\+pandas'], ['image search eames chair', 'eames\\+chair']]) {
    writes.length = 0;
    await hold(p, t); await sleep(900);
    s = await sheetState(p);
    ok(onList && s.open && new RegExp(`q=${q}&tab=images`).test(s.url), `held "${t}" on the Chats list → image search`, JSON.stringify({ onList, s }));
    await closeSheet(p);
  }
  // A plain "search …" on the Chats list still searches the chats (unchanged).
  await hold(p, 'search gout'); await sleep(700);
  s = await sheetState(p);
  ok(!s.open, 'plain "search gout" on the Chats list stays a chat search', JSON.stringify(s));
  await p.evaluate(() => window.__wos.goDesk(window.__wos.HOME, true)); await sleep(500);

  // 10. A long held take is a message, not a missed command: the card stays with Send until tapped, nothing auto-sent.
  writes.length = 0; R.cmd = { route: 'agent', summary: 'x' };
  const longText = "Need a quick command added. When I say search, it doesn't know I'm looking for the search app a lot of the time. So I think a better spell might be ask AI.";
  const res = await p.evaluate(t => window.__wos.handleText(t, 'command', false, 300, null), longText); await sleep(900);
  c = await card(p);
  ok(res && res.outcome === 'held-message', 'long held take returns held-message (custody keeps it in Unsent)', JSON.stringify(res));
  ok(c.chips.join() === 'agent' && /tap Send/i.test(c.label), 'long held take: Send is the only choice, card says tap Send', JSON.stringify(c));
  await sleep(5500); x = await xs();
  ok(x.up && (await card(p)).chips.length === 1, 'long held take card is still up after 6 s', JSON.stringify(x));
  await p.locator('#txText').tap().catch(() => {}); await sleep(4500); x = await xs();
  ok(x.up, 'touching the long card does not start the 4 s fade', JSON.stringify(x));
  ok(agentWrites(writes).length === 0, 'long held take: nothing sent before Send', JSON.stringify(writes));
  const obL = await outboxN(p);
  await p.locator('#txChips [data-hold="agent"]').tap(); await sleep(2500);
  ok(agentWrites(writes).length > 0 || (await outboxN(p)) > obL, 'tapping Send delivers the long take', JSON.stringify(writes));
  await p.evaluate(() => { const o = window.__wos.outbox; for (const it of o.unsent()) o.remove(it.id); });
  await sleep(2700);

  // 8. A tap (not a hold) still reaches the agent as before.
  writes.length = 0; R.cmd = { route: 'agent', summary: 'x' };
  const obA = await outboxN(p);
  await p.evaluate(() => window.__wos.handleText('What is the capital of Peru', 'auto', false, 300, null)); await sleep(2500);
  ok(agentWrites(writes).length > 0 || (await outboxN(p)) > obA, 'tap-to-talk non-command still goes to the agent', JSON.stringify(writes));

  ok(p.errs.length === 0, 'no page errors', JSON.stringify(p.errs));
  console.log(`\n${pass}/${pass + fail} passed`);
  await b.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
