// Browser QA for wizard-ux#1800 (standard first, switch wizard/standard-first-setup): a fresh Wizard's Welcome asks for
// Claude or ChatGPT first, then offers private AI once (Set up private AI / Later / No thanks). Real Chromium, the real
// phone shell (web/index.html, 412 px; QA_SHELL=desktop: web/desktop.html at 1280 px) on a fake fresh box whose Agent
// Service answers GET/POST /wizard/v1/private-first the way wizard-agent-service does (POST {offer: setup} turns private
// first on for the box; the Tinfoil hand-off then makes the private agent). The provider apps are stand-in pages; a
// sign-in is the box marking that provider signed in. The first message goes through the real outbox to a fake agent
// that replies.
//   1. chatgpt: private first on (a fresh Mac today) -> Connect your AI (Sign in with Claude / ChatGPT, Skip for now, no
//      Tinfoil) -> ChatGPT -> Want a fully private AI? -> Later -> Pick a skin -> Say hello -> Send -> the reply shows;
//      no Tinfoil page or private agent anywhere; Settings › Privacy shows Finish setting up private AI and it opens
//      the private AI setup
//   2. claude: the same with Claude, then No thanks: Settings › Privacy has nothing
//   3. skip-setup: Skip for now -> the step leads with private AI -> Set up private AI -> the Tinfoil sign-in -> the
//      private agent exists -> Pick a skin
//   4. off: the switch off: the Welcome is main's (Tinfoil leads while private first is on), nothing is POSTed
//   7. mac-deeplink: a Mac's setup connected ChatGPT and opened the first chat with ?session= (try-wizard#171): the
//      offer opens once over that chat, Later closes it back to the reply, and it does not come back
// Skins: the Connect your AI and Private AI cards in Nebula and Grove (QA_SHOTS), and the card follows a live skin change.
//   QA_PLAYWRIGHT=<path to playwright> node tests/qa-welcome-standard-first.cjs
//   QA_WEB=<another web/ dir, e.g. main's> QA_EXPECT=broken: cases 1-3 must fail there.
//   QA_SHOTS=<dir>: connect-<skin>.png, offer-<skin>.png, offer-none.png, privacy-row.png, off.png
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('../tools/qa-playwright.cjs');
const WEB = process.env.QA_WEB ? path.resolve(process.env.QA_WEB) : path.join(__dirname, '..', 'web');
const SHOTS = process.env.QA_SHOTS || '';
const BROKEN = process.env.QA_EXPECT === 'broken';
const DESKTOP = process.env.QA_SHELL === 'desktop', HOME = '/wizard-os-home/' + (DESKTOP ? 'desktop.html' : '');
const SW = 'wizard/standard-first-setup';
const TYPES = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const APPS = [
  { id: 'wizard-chatgpt', name: 'ChatGPT', url: '/wizard-chatgpt/', kind: 'wizard', source: 'apps.json' },
  { id: 'wizard-claude', name: 'Claude', url: '/wizard-claude/', kind: 'wizard', source: 'apps.json' },
  { id: 'wizard-tinfoil', name: 'Tinfoil', url: '/wizard-tinfoil/', kind: 'wizard', source: 'apps.json' },
];
const SIGNIN = n => `<!doctype html><meta charset="utf-8"><body style="font:15px system-ui;padding:16px"><h1 style="font-size:18px">Sign in to ${n}</h1><p>Stand-in sign-in page.</p></body>`;
const SLUG = { 'wizard-chatgpt': 'openai-codex', 'wizard-claude': 'anthropic', 'wizard-tinfoil': 'wizard-tinfoil' };

let box;
const fresh = pfOn => ({ firstRun: true, current: '', signed: new Set(), pf: { schema: 'wizard.private-first/1', on: pfOn, standard_agent: 'hermes', private_agent: null, standard_on: true, offer: null },
  posts: [], pages: [], delivered: [], sessions: {} });
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname;
  let body = ''; req.on('data', c => { body += c; });
  req.on('end', () => {
    if (p === '/') { res.writeHead(302, { location: '/wizard-os-home/' }); return res.end(); }
    if (p.startsWith('/wizard-os-home/')) {
      let f = path.join(WEB, decodeURIComponent(p.slice('/wizard-os-home/'.length)) || 'index.html');
      if (f.endsWith('/')) f += 'index.html';
      if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
      return fs.createReadStream(f).pipe(res);
    }
    const app = APPS.find(a => p === a.url);
    if (app) { box.pages.push(app.id); res.writeHead(200, { 'content-type': 'text/html' }); return res.end(SIGNIN(app.name)); }
    if (p === '/wizard/v1/bootstrap') return json(res, 200, { bootstrap: 1, settings: { agent: { name: 'Oscar' }, owner: { name: '' } }, capabilities: {}, endpoints: { apps: '/wizard/v1/apps' } });
    if (p === '/wizard/v1/apps') return json(res, 200, { apps: APPS });
    if (p === '/wizard/hermes/api/model/options') return json(res, 200, { provider: box.current, model: box.current ? 'm-1' : '', providers: [
      { slug: 'openai-codex', name: 'ChatGPT', authenticated: box.signed.has('openai-codex'), auth_type: 'oauth', models: ['m-1'] },
      { slug: 'anthropic', name: 'Claude', authenticated: box.signed.has('anthropic'), auth_type: 'oauth', models: ['m-1'] },
      { slug: 'moa', name: 'Mixture of Agents', authenticated: true, auth_type: 'virtual' },
    ].filter(x => x.authenticated) });
    if (p === '/wizard/v1/private-first') {
      if (req.method === 'POST') {
        let j = {}; try { j = JSON.parse(body); } catch (e) {}
        if (!['setup', 'later', 'declined'].includes(j.offer)) return json(res, 400, { ok: false, error: 'invalid_offer' });
        box.posts.push(j.offer); box.pf = { ...box.pf, offer: j.offer, on: j.offer === 'setup' ? true : box.pf.on };
      }
      return json(res, 200, box.pf);
    }
    if (p === '/wizard/v1/setup') return json(res, 200, { first_run: box.firstRun, items: [] });
    if (p === '/wizard/v1/setup/seen') { box.firstRun = false; return json(res, 200, { ok: true }); }
    if (p === '/troubleshoot/api/ping') return json(res, 200, { ok: true });
    if (p === '/troubleshoot/api/status') return json(res, 200, { checks: [] });
    if (p === '/wizard/hermes/api/sessions' && req.method === 'POST') { try { const j = JSON.parse(body); box.sessions[j.id] = box.sessions[j.id] || []; } catch (e) {} return json(res, 200, { ok: true }); }
    if (p === '/wizard/hermes/v1/runs' && req.method === 'POST') {
      let j = {}; try { j = JSON.parse(body); } catch (e) {}
      const words = typeof j.input === 'string' ? j.input : JSON.stringify(j.input);
      // The agent answers only with a signed-in model (a box with none can't reply).
      if (!box.current) return json(res, 500, { error: 'no model configured' });
      box.delivered.push(words);
      const now = Date.now() / 1000;
      box.sessions[j.session_id] = [{ id: 'm1', role: 'user', content: words, timestamp: now }, { id: 'm2', role: 'assistant', content: 'Hi! I am Oscar, on your ChatGPT. What would you like to start with?', timestamp: now + 1 }];
      return json(res, 200, { run_id: 'r-' + box.delivered.length, status: 'completed' });
    }
    const m = p.match(/^\/wizard\/hermes\/api\/sessions\/([^/]+)\/messages$/);
    if (m) return json(res, 200, { data: box.sessions[decodeURIComponent(m[1])] || [] });
    const d = p.match(/^\/wizard\/hermes\/api\/sessions\/([^/]+)$/), sid = d && decodeURIComponent(d[1]);
    if (d && box.sessions[sid]) return json(res, 200, { id: sid, title: 'First chat', message_count: box.sessions[sid].length, last_active: Date.now() / 1000, source: 'wizard-mobile', messages: box.sessions[sid] });
    if (p === '/wizard/hermes/api/sessions') return json(res, 200, { data: Object.keys(box.sessions).map(id => ({ id, title: 'First chat', message_count: box.sessions[id].length, last_active: Date.now() / 1000, source: 'wizard-mobile' })) });
    if (process.env.QA_DEBUG) console.log('404', req.method, p);
    json(res, 404, { error: 'not here' });
  });
});

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const fails = [], notes = [];
  const fail = (k, m) => fails.push(`${k}: ${m}`);
  async function device({ on = true, skin = 'nebula' } = {}) {
    const ctx = await browser.newContext(DESKTOP ? { viewport: { width: 1280, height: 820 } } : { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    await ctx.addInitScript(({ on, skin, SW }) => { if (window !== window.top || sessionStorage.getItem('qa.seeded')) return; sessionStorage.setItem('qa.seeded', '1');
      try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.tour.v1', 'true'); localStorage.setItem('wos.skin', skin);
        localStorage.setItem('wos.skin-tweaks.v1', JSON.stringify({ version: 1, preset: 'none', off: {}, mix: on ? { [SW]: true } : {} })); } catch (e) {} }, { on, skin, SW });
    const page = await ctx.newPage();
    page.on('pageerror', e => notes.push(`pageerror: ${e.message}`));
    return { ctx, page };
  }
  const title = page => page.locator('.wl-card h2').textContent().then(t => t.trim(), () => '');
  const waitTitle = (page, t, ms = 12000) => page.waitForFunction(t => document.querySelector('.wl-card h2')?.textContent.trim() === t, t, { timeout: ms }).then(() => true, () => false);
  async function start(page, k) {
    await page.goto(base + HOME);
    if (!(await page.waitForFunction(() => window.WosWelcome?.active, null, { timeout: 25000 }).then(() => true, () => false))) { fail(k, 'no Welcome on a fresh Wizard ' + JSON.stringify(await page.evaluate(() => window.__welcomeLog).catch(() => null))); return false; }
    // The switch is painted by the tweak loader a moment after boot; the Welcome follows it (an owner sees the same).
    await page.waitForFunction(sw => (document.documentElement.dataset.tweaks || '').split(' ').includes(sw), SW, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(400);
    if (/^Name your/.test(await title(page))) await page.locator('.wl-card [data-wl="skip-name"]').click();
    return true;
  }
  const choices = page => page.$$eval('.wl-card [data-wl="provider"]', b => b.map(x => x.dataset.app + '=' + x.textContent.trim()));
  async function signIn(page, app) {
    await page.locator(`.wl-card [data-wl="provider"][data-app="${app}"]`).click();
    await page.waitForSelector('.wl-frame iframe', { timeout: 15000 });
    if (app !== 'wizard-tinfoil') { box.signed.add(SLUG[app]); box.current = SLUG[app]; }
  }
  async function hello(page, k) {
    for (let i = 0; i < 4 && (await title(page)) !== 'Say hello'; i++) await page.locator('.wl-card [data-wl="next"]').first().click();
    if ((await title(page)) !== 'Say hello') { fail(k, `ends at "${await title(page)}"`); return; }
    await page.locator('.wl-hello button[type=submit]').click();
    await page.waitForFunction(() => !window.WosWelcome?.active, null, { timeout: 8000 }).catch(() => {});
    const reply = await page.waitForFunction(() => /What would you like to start with/.test(document.body.innerText), null, { timeout: 20000 }).then(() => true, () => false);
    if (process.env.QA_DEBUG) console.log('hello', k, await page.evaluate(() => JSON.stringify({ log: window.__welcomeLog, active: !!window.WosWelcome?.active, err: document.querySelector('.wl-status.err')?.textContent, ob: [...(window.WosOutbox?._items?.values?.() || [])].map(i => ({ state: i.state, error: i.error, text: i.text })), list: window.WosOutbox?.list?.()?.map?.(i => [i.state, i.error, i.text]) })));
    // Desktop only, and on main too: a provider signed in inside the Welcome leaves the desktop's send-time model empty
    // (wizard-ux#1805, its own bug). Reported, not counted here; an AI signed in before the page loaded replies.
    const known = DESKTOP && !reply && !box.delivered.length && await page.evaluate(() => [...(window.WosOutbox?._items?.values?.() || [])].some(i => /Model unavailable/.test(i.error || '')));
    if (known) notes.push(`${k}: desktop, first message held by wizard-ux#1805 (Model unavailable), as on main`);
    else if (!reply || !box.delivered.length) fail(k, `first message: delivered ${JSON.stringify(box.delivered)}, reply shown ${reply}`);
    else notes.push(`${k}: first message "${box.delivered[0]}" -> the agent's reply shows in chat`);
  }
  async function privacyRow(page) {
    await page.evaluate(() => (window.__wos?.openSettings || window.__wux?.openSettings)?.('privacy'));
    await page.waitForTimeout(1200);
    return page.locator('[data-private-ai-finish]:visible').count();
  }
  try {
    // 1. ChatGPT -> Later
    for (const [k, app, answer] of [['chatgpt', 'wizard-chatgpt', 'later'], ['claude', 'wizard-claude', 'declined']]) {
      box = fresh(true);
      const { ctx, page } = await device();
      if (!(await start(page, k))) { await ctx.close(); continue; }
      const t = await title(page), c = await choices(page), sub = await page.locator('.wl-card .wl-head p').first().textContent().catch(() => '');
      const skip = await page.locator('.wl-card [data-wl="skip-ai"]').count(), cont = await page.locator('.wl-card [data-wl="next"]').count();
      if (t !== 'Connect your AI' || JSON.stringify(c) !== JSON.stringify(['wizard-claude=Sign in with Claude', 'wizard-chatgpt=Sign in with ChatGPT']) || !skip
        || sub.trim() !== 'Sign in with the AI you already pay for. We recommend at least one; you can add more later.') { fail(k, `Connect your AI: "${t}" ${JSON.stringify(c)} skip=${skip} "${sub}"`); await ctx.close(); continue; }
      notes.push(`${k}: "${t}" ${JSON.stringify(c)}, Skip for now, "${sub.trim()}"`);
      if (k === 'chatgpt' && SHOTS) await page.screenshot({ path: path.join(SHOTS, 'connect-nebula.png') });
      await signIn(page, app);
      if (!(await waitTitle(page, 'Want a fully private AI?'))) { fail(k, `after signing in: "${await title(page)}"`); await ctx.close(); continue; }
      const buttons = await page.$$eval('.wl-card [data-wl="offer"]', b => b.map(x => x.dataset.offer + '=' + x.textContent.trim()));
      if (JSON.stringify(buttons) !== JSON.stringify(['setup=Set up private AI', 'later=Later', 'declined=No thanks'])) fail(k, `offer buttons ${JSON.stringify(buttons)}`);
      if (k === 'chatgpt' && SHOTS) await page.screenshot({ path: path.join(SHOTS, 'offer-nebula.png') });
      // Live skin change: the open card repaints in the new skin's colours.
      if (k === 'chatgpt') {
        const bg = () => page.$eval('.wl-card', e => getComputedStyle(e).backgroundColor + '|' + getComputedStyle(e.querySelector('.wl-primary')).backgroundColor);
        const before = await bg();
        await page.evaluate(() => window.WosSkin.set('grove')); await page.waitForTimeout(600);
        const after = await bg();
        if (before === after) fail(k, `a live skin change left the card as it was (${before})`);
        else notes.push(`live skin change Nebula -> Grove: card ${before} -> ${after}`);
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'offer-grove.png') });
        await page.evaluate(() => window.WosSkin.set('nebula')); await page.waitForTimeout(300);
      }
      await page.locator(`.wl-card [data-wl="offer"][data-offer="${answer}"]`).click();
      if (!(await waitTitle(page, 'Pick a skin'))) fail(k, `after ${answer}: "${await title(page)}"`);
      if (JSON.stringify(box.posts) !== JSON.stringify([answer])) fail(k, `the box got ${JSON.stringify(box.posts)}`);
      await hello(page, k);
      if (box.pages.includes('wizard-tinfoil') || box.pf.private_agent) fail(k, `Tinfoil touched: pages ${box.pages}, private first ${JSON.stringify(box.pf)}`);
      else notes.push(`${k}: no Tinfoil page and no private agent anywhere`);
      const rows = await privacyRow(page);
      if (answer === 'later') {
        if (rows !== 1) fail(k, `Settings › Privacy shows ${rows} Finish setting up private AI rows`);
        else {
          if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'privacy-row.png') });
          await page.locator('[data-private-ai-finish]:visible').click();
          if (!(await waitTitle(page, 'Want a fully private AI?', 5000))) fail(k, `the row opened "${await title(page)}"`);
          else notes.push(`${k}: Settings › Privacy › Finish setting up private AI opens "Want a fully private AI?"`);
        }
      } else if (rows) fail(k, 'No thanks still shows a Settings › Privacy row');
      else notes.push(`${k}: No thanks leaves no Settings › Privacy row`);
      await ctx.close();
    }
    // 3. Skip for now -> Set up private AI
    try {
      const k = 'skip-setup'; box = fresh(false);
      const { ctx, page } = await device({ skin: 'grove' });
      if (await start(page, k)) {
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'connect-grove.png') });
        if (!(await page.locator('.wl-card [data-wl="skip-ai"]').count())) { fail(k, `no Skip for now on "${await title(page)}"`); await ctx.close(); throw Object.assign(Error('skip'), { qaSkip: true }); }
        await page.locator('.wl-card [data-wl="skip-ai"]').click();
        const lead = await page.locator('.wl-card .wl-lead').textContent().catch(() => '');
        if ((await title(page)) !== 'Want a fully private AI?' || !/haven.t connected an AI yet/.test(lead)) fail(k, `after Skip: "${await title(page)}" lead "${lead}"`);
        else notes.push(`${k}: Skip for now -> "${await title(page)}" leading with "${lead.trim()}"`);
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'offer-none.png') });
        await page.locator('.wl-card [data-wl="offer"][data-offer="setup"]').click();
        const signing = await waitTitle(page, 'Sign in to Tinfoil', 8000);
        if (!signing || !box.pf.on || JSON.stringify(box.posts) !== '["setup"]') fail(k, `Set up private AI: "${await title(page)}", box ${JSON.stringify(box.pf)} posts ${JSON.stringify(box.posts)}`);
        else {
          box.pf = { ...box.pf, private_agent: 'private', standard_on: false }; // the Tinfoil hand-off (wizard-agent-service#545)
          if (!(await waitTitle(page, 'Pick a skin', 20000))) fail(k, `after the private agent: "${await title(page)}"`);
          else notes.push(`${k}: Set up private AI -> box opted in -> Sign in to Tinfoil -> private agent -> Pick a skin`);
        }
      }
      await ctx.close();
    } catch (e) { if (!e.qaSkip) throw e; }
    // 4. Switch off: main's Welcome
    {
      const k = 'off'; box = fresh(true);
      const { ctx, page } = await device({ on: false });
      if (await start(page, k)) {
        const c = await choices(page), skip = await page.locator('.wl-card [data-wl="skip-ai"]').count();
        if (c[0]?.split('=')[0] !== 'wizard-tinfoil' || skip) fail(k, `switch off shows ${JSON.stringify(c)} skip=${skip}`);
        else notes.push(`off: unchanged Connect your AI ${JSON.stringify(c.map(x => x.split('=')[0]))}, no Skip for now`);
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'off.png') });
        await page.waitForTimeout(1500);
        if (box.posts.length) fail(k, `POSTed ${JSON.stringify(box.posts)}`);
      }
      await ctx.close();
    }
    // 5. Switch off, private first off (Linux): main's Welcome, ChatGPT -> Pick a skin (no offer) -> Say hello -> reply.
    {
      const k = 'off-chatgpt'; box = fresh(false);
      const { ctx, page } = await device({ on: false });
      if (await start(page, k)) {
        await signIn(page, 'wizard-chatgpt');
        if (!(await waitTitle(page, 'Pick a skin'))) fail(k, `after signing in: "${await title(page)}"`);
        else { notes.push(`${k}: ChatGPT -> Pick a skin (no private AI offer)`); await hello(page, k); }
        if (box.posts.length) fail(k, `POSTed ${JSON.stringify(box.posts)}`);
      }
      await ctx.close();
    }
    // 6. An AI connected before the Welcome (a Mac's setup signs in to ChatGPT first): the Welcome opens at the offer.
    {
      const k = 'setup-first'; box = fresh(false); box.signed.add('openai-codex'); box.current = 'openai-codex';
      const { ctx, page } = await device();
      if (await start(page, k)) {
        if ((await title(page)) !== 'Want a fully private AI?') fail(k, `the Welcome opens at "${await title(page)}"`);
        else {
          await page.locator('.wl-card [data-wl="offer"][data-offer="later"]').click();
          if (!(await waitTitle(page, 'Pick a skin'))) fail(k, `after Later: "${await title(page)}"`);
          else { notes.push(`${k}: ChatGPT signed in before the Welcome -> "Want a fully private AI?" -> Later -> Pick a skin`); await hello(page, k); }
        }
      }
      await ctx.close();
    }
    // 7. A Mac's setup (try-wizard#171, StandardFirstSetup on) signs in to ChatGPT, sends the first message itself and
    //    opens that chat with ?session=: the offer opens over the chat once, Later closes it back to the reply.
    {
      const k = 'mac-deeplink'; box = fresh(false); box.signed.add('openai-codex'); box.current = 'openai-codex';
      const now = Date.now() / 1000;
      box.sessions['mac-first'] = [{ id: 'm1', role: 'user', content: 'Meet Oscar', timestamp: now }, { id: 'm2', role: 'assistant', content: 'Hi! I am Oscar, on your ChatGPT. What would you like to start with?', timestamp: now + 1 }];
      const { ctx, page } = await device();
      await page.goto(base + HOME + '?session=mac-first');
      if (!(await waitTitle(page, 'Want a fully private AI?', 20000))) fail(k, `no offer over the first chat: ${JSON.stringify(await page.evaluate(() => [window.__welcomeLog, window.__deeplinkLog]).catch(() => null))}`);
      else {
        const dots = await page.locator('.wl-card .wl-dots').count();
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'mac-offer.png') });
        await page.locator('.wl-card [data-wl="offer"][data-offer="later"]').click();
        const closed = await page.waitForFunction(() => !window.WosWelcome?.active, null, { timeout: 8000 }).then(() => true, () => false);
        const reply = await page.waitForFunction(() => /What would you like to start with/.test(document.body.innerText), null, { timeout: 15000 }).then(() => true, () => false);
        if (dots || !closed || !reply || JSON.stringify(box.posts) !== '["later"]') fail(k, `dots ${dots} closed ${closed} reply ${reply} posts ${JSON.stringify(box.posts)}`);
        else notes.push(`${k}: ?session= first chat -> "Want a fully private AI?" over it -> Later -> back to the chat with the reply; the box remembers later`);
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'mac-after-later.png') });
        await page.goto(base + HOME + '?session=mac-first'); await page.waitForTimeout(4000);
        if (await page.evaluate(() => !!window.WosWelcome?.active)) fail(k, 'the offer came back after Later');
      }
      await ctx.close();
    }
  } finally { await browser.close(); server.close(); }
  for (const n of notes) console.log('  ' + n);
  if (BROKEN) { console.log(fails.length ? `expected failures (${fails.length}):\n  ` + fails.join('\n  ') : 'UNEXPECTED: nothing failed'); process.exit(fails.length ? 0 : 1); }
  if (fails.length) { console.log('FAIL\n  ' + fails.join('\n  ')); process.exit(1); }
  console.log('PASS: standard first Welcome (' + (DESKTOP ? 'desktop' : 'phone') + ')');
})().catch(e => { console.error(e); process.exit(1); });
