// Browser QA for wizard-ux#1750: an existing Wizard whose AI is signed out gets only "Reconnect your AI", never the
// whole first-run Welcome (look, Say hello). Real Chromium, the real phone shell (web/index.html) at phone size
// (412 px), on a fake box: the Agent Service setup says first_run false, the agent's model is ChatGPT (openai-codex)
// and it is not signed in. The ChatGPT and Claude apps are installed (their pages are stand-ins).
//   1. existing Wizard, reload: one screen, "Reconnect your AI", no step dots, ChatGPT and Claude to choose from
//   2. tap ChatGPT, the box signs it in: the screen says it is connected, then closes by itself (no Pick a skin, no
//      Say hello), and the next reload shows nothing
//   3. the same with Claude (it becomes the agent's model, the way the Claude app makes it after a sign-in)
//   4. a device that reconnected on an older build (wos.welcome.v1 = "ai") on an existing Wizard: reload shows nothing
//   5. a fresh Wizard (first_run true) still gets Connect your AI -> sign in -> Pick a skin -> Say hello
//   QA_PLAYWRIGHT=<path to playwright> node tests/qa-welcome-reconnect.cjs
//   QA_WEB=<another web/ dir, e.g. main's> QA_EXPECT=broken: cases 1, 2 and 4 must fail there.
//   QA_SHELL=desktop: the desktop shell (web/desktop.html, 1280 px) instead of the phone shell.
//   QA_SHOTS=<dir>: reconnect.png (the reconnect screen) and after.png (the shell once it closed).
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('../tools/qa-playwright.cjs');
const WEB = process.env.QA_WEB ? path.resolve(process.env.QA_WEB) : path.join(__dirname, '..', 'web');
const SHOTS = process.env.QA_SHOTS || '';
const BROKEN = process.env.QA_EXPECT === 'broken';
const DESKTOP = process.env.QA_SHELL === 'desktop', HOME = '/wizard-os-home/' + (DESKTOP ? 'desktop.html' : '');
const TYPES = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const APPS = [
  { id: 'wizard-chatgpt', name: 'ChatGPT', url: '/wizard-chatgpt/', kind: 'wizard', source: 'apps.json' },
  { id: 'wizard-claude', name: 'Claude', url: '/wizard-claude/', kind: 'wizard', source: 'apps.json' },
];
const SIGNIN = n => `<!doctype html><meta charset="utf-8"><body style="font:15px system-ui;padding:16px"><h1 style="font-size:18px">Sign in to ${n}</h1><p>Stand-in sign-in page.</p></body>`;

// The box: firstRun, the agent's model and which providers are signed in, changed by each case.
const box = { firstRun: false, current: 'openai-codex', signed: new Set() };
const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname;
  req.on('data', () => {});
  req.on('end', () => {
    if (p === '/') { res.writeHead(302, { location: '/wizard-os-home/' }); return res.end(); }
    if (p.startsWith('/wizard-os-home/')) {
      let f = path.join(WEB, decodeURIComponent(p.slice('/wizard-os-home/'.length)) || 'index.html');
      if (f.endsWith('/')) f += 'index.html';
      if (!f.startsWith(WEB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
      return fs.createReadStream(f).pipe(res);
    }
    if (p === '/wizard-chatgpt/' || p === '/wizard-claude/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(SIGNIN(p.includes('claude') ? 'Claude' : 'ChatGPT')); }
    if (p === '/wizard/v1/bootstrap') return json(res, 200, { bootstrap: 1, settings: { agent: { name: 'Oscar' }, owner: { name: '' } }, capabilities: {}, endpoints: { apps: '/wizard/v1/apps' } });
    if (p === '/wizard/v1/apps') return json(res, 200, { apps: APPS });
    if (p === '/wizard/hermes/api/model/options') return json(res, 200, { provider: box.current, providers: [
      { slug: 'openai-codex', name: 'ChatGPT', authenticated: box.signed.has('openai-codex'), auth_type: 'oauth' },
      { slug: 'claude-subscription-directsdk-experimental', name: 'Claude', authenticated: true, auth_type: 'external' },
      { slug: 'moa', name: 'Mixture of Agents', authenticated: true, auth_type: 'virtual' },
    ] });
    if (p === '/wizard/v1/setup') return json(res, 200, { first_run: box.firstRun, items: [] });
    // The private AI offer (wizard-ux issue 1800, standard first) was already answered: this script is about other steps.
    if (p === '/wizard/v1/private-first') return json(res, 200, { schema: 'wizard.private-first/1', on: false, private_agent: null, standard_on: true, offer: 'declined' });
    if (p === '/wizard/v1/setup/seen') return json(res, 200, { ok: true });
    if (p === '/troubleshoot/api/ping') return json(res, 200, { ok: true });
    if (p === '/troubleshoot/api/status') return json(res, 200, { checks: [] });
    if (p === '/wizard/hermes/api/sessions') return json(res, 200, { data: [] });
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
  async function device(seed) {
    const ctx = await browser.newContext(DESKTOP ? { viewport: { width: 1280, height: 820 } } : { viewport: { width: 412, height: 860 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    await ctx.addInitScript(s => { if (window !== window.top || sessionStorage.getItem('qa.seeded')) return; sessionStorage.setItem('qa.seeded', '1');
      try { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.tour.v1', 'true'); if (s) localStorage.setItem('wos.welcome.v1', s); } catch (e) {} }, seed || '');
    const page = await ctx.newPage();
    page.on('pageerror', e => notes.push(`pageerror: ${e.message}`));
    return { ctx, page };
  }
  // The Welcome opens within a few seconds of boot, or never: give it the boot's own wait (5 s) and a little more.
  const opened = page => page.waitForFunction(() => window.WosWelcome?.active, null, { timeout: 9000 }).then(() => true, () => false);
  const settled = async page => { await page.waitForFunction(() => (window.__welcomeLog || []).some(s => /^boot:/.test(s) && s !== 'boot:busy'), null, { timeout: 12000 }).catch(() => {}); await page.waitForTimeout(500); };
  const title = page => page.locator('.wl-card h2').textContent().then(t => t.trim(), () => '');
  // Sign in to one provider and follow the Welcome until it closes or shows another step (up to 12 s).
  async function signIn(page, app, after) {
    await page.locator(`.wl-card [data-wl="provider"][data-app="${app}"]`).click();
    await page.waitForSelector('.wl-frame iframe', { timeout: 5000 });
    const signing = await title(page);
    after();
    const seen = [];
    for (let i = 0; i < 48; i++) {
      await page.waitForTimeout(250);
      const on = await page.evaluate(() => !!window.WosWelcome?.active);
      if (!on) { seen.push('(closed)'); break; }
      const t = await title(page); if (seen[seen.length - 1] !== t) seen.push(t);
      if (t !== signing) { await page.waitForTimeout(600); const t2 = await title(page); if (t2 !== t) seen.push(t2); }
      if (/Pick a skin|Say hello/.test(seen.join('|'))) break;
    }
    return { signing, seen };
  }
  async function reconnectCase(k, app, provider, current) {
    box.firstRun = false; box.current = current; box.signed = new Set();
    const { ctx, page } = await device('done');
    await page.goto(base + HOME);
    if (!(await opened(page))) { fail(k, 'no screen at all on a Wizard whose AI is signed out'); await ctx.close(); return; }
    const t = await title(page), dots = await page.locator('.wl-card .wl-dots').count(), choices = await page.locator('.wl-card [data-wl="provider"]').count();
    const words = await page.locator('.wl-card .wl-head p').textContent().catch(() => '');
    if (t !== 'Reconnect your AI') fail(k, `the screen says "${t}", not "Reconnect your AI"`);
    if (dots) fail(k, 'it shows the step dots of the three-step first run');
    if (choices < 2) fail(k, `${choices} provider choices`);
    if (k === 'chatgpt' && SHOTS) await page.screenshot({ path: path.join(SHOTS, 'reconnect.png') });
    const r = await signIn(page, app, () => { box.signed.add(provider); box.current = provider; });
    const closed = r.seen[r.seen.length - 1] === '(closed)';
    if (!closed || r.seen.some(s => /Pick a skin|Say hello|Name your/.test(s))) fail(k, `after signing in it went ${JSON.stringify(r.seen)}`);
    else notes.push(`${k}: "${t}" (${choices} choices, no dots, "${words}") -> ${r.signing} -> ${r.seen.join(' -> ')}`);
    const state = await page.evaluate(() => localStorage.getItem('wos.welcome.v1'));
    if (closed && k === 'chatgpt' && SHOTS) await page.screenshot({ path: path.join(SHOTS, 'after.png') });
    await page.reload(); await settled(page);
    const again = await page.evaluate(() => !!window.WosWelcome?.active);
    if (again) fail(k, `the next reload shows "${await title(page)}" (saved state ${state})`);
    else notes.push(`${k}: next reload shows nothing`);
    await ctx.close();
  }
  try {
    await reconnectCase('chatgpt', 'wizard-chatgpt', 'openai-codex', 'openai-codex');
    await reconnectCase('claude', 'wizard-claude', 'claude-subscription-directsdk-experimental', 'openai-codex');
    // 4. reconnected on an older build: the device saved "ai", the AI works now, the Wizard is not new.
    {
      box.firstRun = false; box.current = 'openai-codex'; box.signed = new Set(['openai-codex']);
      const { ctx, page } = await device('ai');
      await page.goto(base + HOME); await settled(page);
      if (await page.evaluate(() => !!window.WosWelcome?.active)) fail('older-build', `an existing Wizard with a working AI shows "${await title(page)}"`);
      else notes.push('older-build: an existing Wizard that reconnected earlier shows nothing');
      await ctx.close();
    }
    // 5. a fresh Wizard keeps the whole first run.
    {
      box.firstRun = true; box.current = 'openai-codex'; box.signed = new Set();
      const { ctx, page } = await device('');
      await page.goto(base + HOME);
      if (!(await opened(page))) fail('fresh', 'no Welcome on a fresh Wizard');
      else {
        let t = await title(page);
        if (/^Name your/.test(t)) { await page.locator('.wl-card [data-wl="skip-name"]').click(); t = await title(page); }
        const dots = await page.locator('.wl-card .wl-dots i').count();
        if (t !== 'Connect your AI' || !dots) fail('fresh', `starts at "${t}" with ${dots} dots`);
        const r = await signIn(page, 'wizard-chatgpt', () => { box.signed.add('openai-codex'); });
        if (!r.seen.includes('Pick a skin')) fail('fresh', `after signing in it went ${JSON.stringify(r.seen)}`);
        else {
          for (let i = 0; i < 3 && (await title(page)) !== 'Say hello'; i++) await page.locator('.wl-card [data-wl="next"]').first().click();
          const last = await title(page);
          if (last !== 'Say hello') fail('fresh', `ends at "${last}"`);
          else notes.push(`fresh: ${t} (${dots} dots) -> ${r.signing} -> ${r.seen.join(' -> ')} -> Say hello`);
        }
      }
      await ctx.close();
    }
  } finally {
    await browser.close(); server.close();
  }
  for (const n of notes) console.log('  ' + n);
  if (BROKEN) {
    if (!['chatgpt', 'older-build'].every(k => fails.some(f => f.startsWith(k + ':')))) { console.error('expected the reconnect and older-build cases to fail on this build\n  ' + fails.join('\n  ')); process.exit(1); }
    if (fails.some(f => f.startsWith('fresh:'))) { console.error('the fresh case must pass on every build\n  ' + fails.join('\n  ')); process.exit(1); }
    console.log('broken as expected:\n  ' + fails.join('\n  ')); return;
  }
  if (fails.length) { console.error('FAIL\n  ' + fails.join('\n  ')); process.exit(1); }
  console.log('PASS: an existing Wizard gets only Reconnect your AI; a fresh one the whole Welcome');
})().catch(e => { console.error(e); process.exit(1); });
