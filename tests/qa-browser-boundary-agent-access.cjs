// Browser QA for wizard-ux issue 1668 (switch wizard/boundary-agent-access): with the browser owner boundary on
// (wizard-os#133), Connected accounts' Agent access screen still shows each agent's tick per account app and a tap
// changes it in the Agent Service, through the shell's bounded agent-access service (agents.read / agents.set).
// Real Chromium: a top-level shell page with a shell token in its meta (as nginx writes it), the real
// core/shell-token.js, core/browser-boundary.js and core/app-services*.js; the app page runs in a sandboxed frame
// and loads the real core/app-client.js. A stand-in Agent Service answers GET/PUT /wizard/v1/apps/<id>/agents only
// with the shell token (as the real one does with the boundary on).
//  - QA_APP=<wizard-connectors web/ dir>: the real Connected accounts page (its own /api is a small stand-in).
//    Without it, a stand-in page makes the same calls the way wizard-connectors web/connections.js does.
//  - QA_SWITCH=off: the switch is off; the shell refuses the service and the app falls back to today's message.
//  - QA_SHOT=<png>: a phone-size (412 px) shot of the Agent access screen.
//  - QA_WEB=<another web/ dir> QA_EXPECT=broken: the on checks must fail there (e.g. main).
//   QA_PLAYWRIGHT=<path to playwright> node tests/qa-browser-boundary-agent-access.cjs
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('../tools/qa-playwright.cjs');
const WEB = process.env.QA_WEB ? path.resolve(process.env.QA_WEB) : path.join(__dirname, '..', 'web');
const APPDIR = process.env.QA_APP ? path.resolve(process.env.QA_APP) : '';
const ON = process.env.QA_SWITCH !== 'off', SHOT = process.env.QA_SHOT || '';
const TOKEN = 'ab'.repeat(32), SWITCH = 'wizard/boundary-agent-access';
const seen = [];
// The Agent Service's agent.json ticks, per app id.
const ticks = {
  'connected-accounts': { hermes: true, oscar: false },
  messenger: { hermes: true, oscar: true },
  'wizard-google': { hermes: false, oscar: false },
};
const LABELS = { hermes: 'Wizard', oscar: 'Oscar' };
const agentsOf = id => ({ app_id: id, kind: 'wizard', agents: Object.entries(ticks[id]).map(([a, on]) => ({ id: a, label: LABELS[a], privacy: 'standard', enabled: on })) });
// A stand-in for the app page: the same calls wizard-connectors web/connections.js makes (WizardApp.agentAccess under
// the boundary, otherwise the owner route), drawn as one switch per agent and app.
const STANDIN = `<!doctype html><html><head><meta charset="utf-8"><script src="/wizard-os-home/core/app-client.js"></script></head>
<body><h2>Agent access</h2><section id="grants-row"></section><section id="list"></section><script>
  const IDS = ['connected-accounts', 'messenger', 'wizard-google', 'money'];
  const svc = () => self.origin === 'null' && WizardApp.agentAccess;
  async function read(id) {
    if (svc()) { try { return await WizardApp.agentAccess.read(id); } catch (e) { return { state: 'unavailable' }; } }
    try { const r = await fetch('/wizard/v1/apps/' + id + '/agents'); return r.ok ? { state: 'ok', agents: (await r.json()).agents } : { state: 'unavailable' }; } catch (_) { return { state: 'unavailable' }; }
  }
  async function paint() {
    const rows = await Promise.all(IDS.map(async id => ({ id, ...(await read(id)) })));
    const list = document.getElementById('list'); list.replaceChildren();
    if (!rows.some(r => r.state !== 'unavailable')) { const p = document.createElement('p'); p.className = 'google-status'; p.textContent = 'You can still choose that in App Manager, under Connections.'; list.append(p); }
    for (const r of rows.filter(r => r.state === 'ok')) {
      const card = document.createElement('article'); card.className = 'google-account'; card.dataset.app = r.id; list.append(card);
      for (const a of r.agents) {
        const t = document.createElement('button'); t.className = 'google-toggle'; t.setAttribute('role', 'switch'); t.setAttribute('aria-label', a.label + ' may use ' + r.id);
        t.setAttribute('aria-checked', String(a.enabled)); t.textContent = a.label;
        t.onclick = async () => { const ids = r.agents.filter(x => x.id === a.id ? !a.enabled : x.enabled).map(x => x.id);
          try { await WizardApp.agentAccess.set(r.id, ids); } catch (e) { window.lastError = e.message; } paint(); };
        card.append(t);
      }
    }
    window.painted = (window.painted || 0) + 1;
  }
  WizardApp.ready?.(); paint();
</script></body></html>`;
const SHELL = `<!doctype html><html data-shell="mobile"${ON ? ` data-tweaks="${SWITCH}"` : ''}><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="wizard-shell-token" content="${TOKEN}">
<script src="/wizard-os-home/core/shell-token.js"></script>
<script src="/wizard-os-home/core/browser-boundary.js"></script>
<script>
  const APPS = [{ id: 'connected-accounts', kind: 'wizard', url: '/connected-accounts/', name: 'Connected accounts', source: 'apps.json' },
    { id: 'notes', kind: 'wizard', url: '/notes/', name: 'Notes', source: 'apps.json' }];
  window.WizCore = { apps: () => ({ APPS }), workspaceNav: { setCount() {} } };
  window.WizConfig = { stripAddress: s => s };</script>
<script src="/wizard-os-home/core/app-services-windows.js"></script><script src="/wizard-os-home/core/app-services-boundary.js"></script><script src="/wizard-os-home/core/app-services.js"></script>
<style>html,body{margin:0;background:#101018}iframe{width:412px;height:900px;border:0;display:block}#n{width:412px;height:200px}</style></head>
<body><iframe id="a" class="appframe" sandbox="allow-scripts allow-forms allow-downloads" src="/connected-accounts/"></iframe>
<iframe id="n" class="appframe" sandbox="allow-scripts allow-forms allow-downloads" src="/notes/"></iframe>
<script>
  WizAppServices.attach(document.getElementById('a'), { appId: 'connected-accounts', path: '/connected-accounts/', isVisible: () => true });
  WizAppServices.attach(document.getElementById('n'), { appId: 'notes', path: '/notes/', isVisible: () => true });
</script></body></html>`;
// Another installed app trying the same service: never answered.
const NOTES = `<!doctype html><html><head><meta charset="utf-8"><script src="/wizard-os-home/core/app-client.js"></script></head>
<body><p>Notes</p><script>window.results = {}; (async () => { await WizardApp.ready?.();
  try { results.read = await WizardApp.agentAccess.read('messenger'); } catch (e) { results.read = 'refused:' + e.message; }
  try { results.set = await WizardApp.agentAccess.set('messenger', []); } catch (e) { results.set = 'refused:' + e.message; }
  results.done = true; })();</script></body></html>`;
const STATE = { google: { accounts: [{ id: 'g1', email: 'me@example.com', status: 'active', scopes: [] }], client_configured: true, client_source: 'owner', calendar_binding: { accounts: [] } },
  mail: { agent_access: { level: 'read', what: 'Agents may read your mail.', levels: [{ id: 'none', label: 'No access' }, { id: 'read', label: 'Read only' }] } } };
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    seen.push({ method: req.method, path: u.pathname, origin: req.headers.origin || '', token: req.headers['x-wizard-shell-token'] || '', body });
    const send = (code, type, text) => { res.statusCode = code; res.setHeader('content-type', type); res.end(text); };
    const json = (code, v) => send(code, 'application/json', JSON.stringify(v));
    if (u.pathname === '/') return send(200, 'text/html', SHELL);
    if (u.pathname === '/notes/') return send(200, 'text/html', NOTES);
    if (u.pathname.startsWith('/connected-accounts/')) {
      const rest = u.pathname.slice('/connected-accounts/'.length);
      if (rest === 'api/state') return json(200, STATE);
      if (rest.startsWith('api/')) return json(404, { error: 'not_found' });
      if (!APPDIR) return rest === '' ? send(200, 'text/html', STANDIN) : send(404, 'text/plain', '');
      const file = path.join(APPDIR, rest || 'index.html');
      if (file.startsWith(APPDIR) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        // Like the real app: its own files may be read by its sandboxed page.
        res.setHeader('access-control-allow-origin', '*');
        return send(200, TYPES[path.extname(file)] || 'text/plain', fs.readFileSync(file));
      }
      return send(404, 'text/plain', '');
    }
    if (u.pathname.startsWith('/wizard-os-home/')) {
      const file = path.join(WEB, u.pathname.slice('/wizard-os-home/'.length));
      if (file.startsWith(WEB) && fs.existsSync(file) && fs.statSync(file).isFile()) return send(200, TYPES[path.extname(file)] || 'text/plain', fs.readFileSync(file));
    }
    // The Agent Service with the boundary on: owner routes need the shell token.
    if (/^\/(wizard\/|api\/|v1\/)/.test(u.pathname)) {
      if (req.headers['x-wizard-shell-token'] !== TOKEN) return json(401, { error: 'owner_auth_required' });
      const m = u.pathname.match(/^\/wizard\/v1\/apps\/([^/]+)\/agents$/);
      if (m) {
        const id = decodeURIComponent(m[1]);
        if (!ticks[id]) return json(404, { error: 'app_not_found', check: 'app.id' });
        if (req.method === 'PUT') {
          let want; try { want = JSON.parse(body).agents; } catch (_) { return json(400, { error: 'bad_json' }); }
          for (const a of Object.keys(ticks[id])) ticks[id][a] = want.includes(a);
        }
        return json(200, agentsOf(id));
      }
      return json(404, { error: 'not_found' });
    }
    send(404, 'text/plain', '');
  });
});
const fails = [];
const check = (ok, what) => { console.log((ok ? 'PASS ' : 'FAIL ') + what); if (!ok) fails.push(what); };
(async () => {
  await new Promise(r => server.listen(Number(process.env.QA_PORT) || 0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 412, height: 1100 } });
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.goto(base + '/');
    const frame = () => page.frames().find(f => new URL(f.url() || 'about:blank', 'http://x').pathname === '/connected-accounts/');
    await page.waitForFunction(() => !!document.getElementById('a').contentWindow, null, { timeout: 5000 });
    for (let i = 0; i < 50 && !frame(); i++) await page.waitForTimeout(100);
    const fr = frame();
    check(await fr.evaluate(() => self.origin) === 'null', 'the Connected accounts page is opaque (sandboxed)');
    // Open Agent access (the real app: its main screen row).
    if (APPDIR) {
      await fr.waitForSelector('#grants-row', { timeout: 8000 });
      await fr.waitForFunction(() => !document.getElementById('workspace').hidden, null, { timeout: 8000 }).catch(() => {});
      await fr.click('#grants-row');
    }
    await fr.waitForFunction(() => document.querySelector('.google-toggle[role="switch"]') || document.querySelector('.google-status'), null, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(600);
    const view = async () => fr.evaluate(() => ({
      message: [...document.querySelectorAll('.google-status')].map(e => e.textContent).join(' '),
      ticks: Object.fromEntries([...document.querySelectorAll('article[data-app]')].map(c => [c.dataset.app,
        [...c.querySelectorAll('.google-toggle[role="switch"]')].filter(t => /may use/.test(t.getAttribute('aria-label') || '')).map(t => t.getAttribute('aria-label').split(' may use ')[0] + ':' + t.getAttribute('aria-checked'))]).filter(([, v]) => v.length)),
    }));
    const v1 = await view();
    console.log('screen:', JSON.stringify(v1));
    if (SHOT) {
      // This rig sends no appearance, so the page wears its own standalone dark look for the shot.
      await fr.evaluate(() => { document.documentElement.classList.remove('wz-hosted'); document.documentElement.dataset.colorScheme = 'dark'; });
      await page.waitForTimeout(200);
      await page.locator('#a').screenshot({ path: SHOT });
    }
    if (ON) {
      const sorted = o => JSON.stringify(Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b))));
      check(sorted(v1.ticks) === sorted({ 'connected-accounts': ['Wizard:true', 'Oscar:false'], messenger: ['Wizard:true', 'Oscar:true'], 'wizard-google': ['Wizard:false', 'Oscar:false'] }),
        'Agent access shows each agent\'s tick per account app, as the Agent Service keeps them');
      check(!/App Manager/.test(v1.message), 'no "choose that in App Manager" fallback message');
      const reads = seen.filter(s => /\/wizard\/v1\/apps\/[^/]+\/agents$/.test(s.path) && s.method === 'GET');
      check(reads.length >= 3 && reads.every(s => s.token === TOKEN && s.origin === ''), 'the shell read the ticks with its own token; the app page never held it: ' + JSON.stringify(reads.filter(s => s.token !== TOKEN || s.origin)));
      // A real tap on Oscar for Messenger turns it off in the Agent Service.
      const before = seen.length;
      await fr.click('article[data-app="messenger"] .google-toggle[aria-label="Oscar may use Messenger"], article[data-app="messenger"] .google-toggle[aria-label="Oscar may use messenger"]', { timeout: 5000 }).catch(e => console.log('click: ' + e.message.split('\n')[0]));
      await fr.waitForFunction(() => document.querySelector('article[data-app="messenger"] .google-toggle[aria-label^="Oscar may use"]')?.getAttribute('aria-checked') === 'false', null, { timeout: 6000 }).catch(() => {});
      const puts = seen.slice(before).filter(s => s.method === 'PUT');
      check(puts.length === 1 && puts[0].path === '/wizard/v1/apps/messenger/agents' && puts[0].token === TOKEN && JSON.parse(puts[0].body).agents.join() === 'hermes',
        'a tap changed it in the Agent Service (PUT with the shell token): ' + JSON.stringify(puts.map(p => p.path + ' ' + p.body)));
      check(ticks.messenger.oscar === false && ticks.messenger.hermes === true, 'the Agent Service now keeps Oscar off for Messenger, Wizard still on');
      const v2 = await view();
      check(JSON.stringify(v2.ticks.messenger) === '["Wizard:true","Oscar:false"]', 'the screen shows the stored answer: ' + JSON.stringify(v2.ticks.messenger));
      // A page that asks to change agent access without a tap is refused (after the tap's activation has run out).
      // (Playwright's evaluate counts as a gesture, so the page calls it by itself from a timer after activation is gone.)
      const putsBefore = seen.filter(s => s.method === 'PUT').length;
      const untapped = await fr.evaluate(() => new Promise(done => setTimeout(() => WizardApp.agentAccess.set('messenger', [])
        .then(v => done('set:' + JSON.stringify(v)), e => done('refused:' + e.message)), 6500)));
      check(untapped.startsWith('refused') && seen.filter(s => s.method === 'PUT').length === putsBefore && ticks.messenger.hermes === true, 'a change with no tap is refused: ' + untapped);
      // An app id that holds no accounts is not answered.
      const other = await fr.evaluate(() => WizardApp.agentAccess.read('notes').then(v => JSON.stringify(v), e => 'refused:' + e.message));
      check(other.startsWith('refused'), 'an app that holds no accounts is not answered: ' + other);
    } else {
      check(Object.keys(v1.ticks).length === 0 && /App Manager/.test(v1.message), 'switch off: the screen says "choose that in App Manager" as before');
      check(!seen.some(s => /\/agents$/.test(s.path) && s.token === TOKEN), 'switch off: the shell never asked the Agent Service for the app');
    }
    // Another installed app gets nothing.
    const nf = page.frames().find(f => new URL(f.url() || 'about:blank', 'http://x').pathname === '/notes/');
    await nf.waitForFunction(() => window.results?.done, null, { timeout: 8000 }).catch(() => {});
    const nr = await nf.evaluate(() => window.results);
    check(String(nr?.read).startsWith('refused') && String(nr?.set).startsWith('refused') && ticks.messenger.hermes === true, 'another app is refused both: ' + JSON.stringify(nr));
    check(!errors.length, 'no shell page errors ' + (errors.length ? JSON.stringify(errors) : ''));
  } finally {
    await browser.close(); server.close();
  }
  if (process.env.QA_EXPECT === 'broken') {
    console.log(fails.length ? `EXPECTED: ${fails.length} checks fail on this build` : 'UNEXPECTED: every check passed');
    process.exit(fails.length ? 0 : 1);
  }
  console.log(fails.length ? `${fails.length} FAILED` : 'all passed');
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
