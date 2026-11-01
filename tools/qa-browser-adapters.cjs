// Real Chromium + nginx + Agent Service acceptance. Synthetic app/data only.
// Run on the dedicated QA host with QA_SERVICE_ROOT, QA_OUT, QA_NGINX_MIME,
// QA_PLAYWRIGHT set. This is candidate proof, NOT installation/native proof.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const assert = require('node:assert/strict'), { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url'), crypto = require('node:crypto');
const appFrame = require('./qa-browser-frame.cjs');
const root = path.resolve(process.env.QA_UX_ROOT || path.join(__dirname, '..')), out = process.env.QA_OUT;
const { chromium } = require(path.join(root, 'tools/qa-playwright.cjs'));
if (!out || !process.env.QA_SERVICE_ROOT) throw new Error('QA_OUT and QA_SERVICE_ROOT are required');
fs.mkdirSync(out, { recursive: true });
const serviceRoot = process.env.QA_SERVICE_ROOT;
const token = crypto.randomBytes(32).toString('hex');
// Synthetic proxy credential: independent of browser possession, never sent to JS.
const ownerProof = crypto.randomBytes(32).toString('hex');
const web = path.join(root, 'web');
const listen = server => new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const close = s => new Promise(r => { s.closeAllConnections?.(); s.close(r); });
const report = { candidate: true, nativeProven: false, realStoreInstallProven: false, checks: [], screenshots: [], errors: [] };
const check = (value, name) => { assert.ok(value, name); report.checks.push(name); };
(async () => {
  const { createWizardServer } = await import(pathToFileURL(path.join(serviceRoot, 'server/service.mjs')));
  const { createAgentRegistry } = await import(pathToFileURL(path.join(serviceRoot, 'server/agents.mjs')));
  const { createHermesFixture } = await import(pathToFileURL(path.join(serviceRoot, 'server/fixture.mjs')));
  const hermes = createHermesFixture({ expectedKey: 'boundary-fixture-only' });
  const hp = await listen(hermes);
  const home = path.join(out, 'synthetic-home'); fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'apps.json'), JSON.stringify({ schema: 1, apps: [{ id: 'boundary-fixture', name: 'Hostile frame', status: 'running', view: { url: '/fixture-app/' } }, ...['fixture-list','fixture-drafts'].map(id => ({id,name:id,status:'running',view:{url:'/'+id+'/'}}))] }));
  const mainHome = path.join(home, 'synthetic-main'); fs.mkdirSync(mainHome, { recursive: true });
  const runtime = { apply: async () => ({}), stop: async () => ({}), start: async () => ({}) };
  const registry = createAgentRegistry({ agentsDir: path.join(home, 'agents'), mainHome, runtime,
    localModels: ['synthetic-model'], fetchImpl: async () => new Response(JSON.stringify({ data: [], has_more: false })) });
  const priv = (await registry.create({ label: 'Synthetic sealed notebook', model: { provider: 'tinfoil', model: 'glm-5-3' }, permissions: { preset: 'private' } })).agent;
  fs.mkdirSync(path.join(registry.stateHome(priv.id), 'wiki'), { recursive: true });
  fs.writeFileSync(path.join(registry.stateHome(priv.id), 'wiki/index.md'), 'SYNTHETIC-PRIVATE-NOTEBOOK-CANARY');
  // The registry owns identity (labels truncate to 24 characters); never guess a slug.
  const notesPath = `/wizard/v1/agent-notes/${priv.id}`;
  report.privateAgentId = priv.id;
  const serviceOptions = { upstreamOrigin: `http://127.0.0.1:${hp}`, hermesKey: 'boundary-fixture-only', requireAccess: false, ownerProof,
    browserBoundary: { enabled: true, token }, hermesHome: mainHome, agentRuntime: runtime, wizardOsHome: home,
    appsJsonPath: path.join(home, 'apps.json'), settingsPath: path.join(home, 'settings.json'),
    launcherPath: path.join(home, 'launcher.json'), agentBridge: false, followThrough: false, joinedDelegation: 'off' };
  // Programmatic equivalents of WIZARD_OWNER_PRIVATE_NOTES=1/0. Both retain the boundary.
  const fixtureRoot=path.join(root,'tests/fixtures/browser-trust');
  const manifests=Object.fromEntries(['fixture-list','fixture-drafts'].map(id=>[id,JSON.parse(fs.readFileSync(path.join(fixtureRoot,id,'manifest.json'),'utf8'))]));
  const grants=new Map(Object.entries(manifests).map(([id,m])=>[id+'-instance',{operations:[...m.browser_contract.operations]}]));
  const installs=new Map(Object.entries(manifests).map(([id,m])=>[id,{installationId:id+'-instance',sourceId:'synthetic:'+id,installedCommit:'a'.repeat(40),permissionRevision:'p1',status:'running',browser_contract:m.browser_contract}]));
  const adapterOptions={resolveInstallation:id=>installs.get(id),resolveGrants:id=>grants.get(id)};
  const service = createWizardServer({ ...serviceOptions, ownerPrivateNotes: true, browserAdapterPrototype:adapterOptions });
  const serviceOff = createWizardServer({ ...serviceOptions, ownerPrivateNotes: false });
  const serviceTrace = [];
  report.serviceTrace = serviceTrace;
  for (const [target, privateNotes] of [[service, true], [serviceOff, false]]) {
    target.on('request', (request, response) => response.on('finish', () => serviceTrace.push({
      privateNotes, method: request.method, path: new URL(request.url, 'http://fixture').pathname, status: response.statusCode,
      origin: request.headers.origin || '', hasShellToken: typeof request.headers['x-wizard-shell-token'] === 'string',
      hasOwnerProof: request.headers['x-wizard-owner-proof'] === ownerProof,
    })));
  }
  const sp = await listen(service), offPort = await listen(serviceOff);
  const fixture = http.createServer((req, res) => {
    const staticFiles={ '/fixture-assets/styles.css':'styles.css', ...Object.fromEntries(['fixture-list','fixture-drafts'].flatMap(id=>[['/'+id+'/',id+'/index.html'],['/'+id+'/fixture.js',id+'/fixture.js']])) };
    if (staticFiles[req.url]) {const p=path.join(fixtureRoot,staticFiles[req.url]);res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'text/html');return res.end(fs.readFileSync(p));}
    if (req.url === '/fixture-app/app.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(`
      let nested = false;
      WizardApp.back.register({ canGoBack: () => nested, back() { nested = false; document.querySelector('#state').textContent = 'Root'; return true; } });
      document.querySelector('button').onclick = () => { nested = true; document.querySelector('#state').textContent = 'Nested'; };
      window.probe = async () => {
        const p = {};
        try { p.parent = parent.document.documentElement.outerHTML; } catch (_) { p.parentDenied = true; }
        try { p.storage = localStorage.length; } catch (_) { p.storageDenied = true; }
        try { p.chats = await (await fetch('/wizard/hermes/api/sessions')).text(); } catch (_) { p.chatsDenied = true; }
        try { p.html = await (await fetch('/wizard-os-home/desktop.html')).text(); } catch (_) { p.htmlDenied = true; }
        try { await fetch('/wizard/v1/setup/seen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch (_) { p.mutationDenied = true; }
        try { await fetch('/wizard/v1/setup/seen', { method: 'POST', body: '{}', mode: 'no-cors' }); p.simplePostAttempted = true; } catch (_) { p.simplePostAttempted = true; }
        for (const [name, url] of Object.entries({ privateList: '/wizard/v1/agent-notes', privateRead: '${notesPath}/read?path=index.md', privateSearch: '${notesPath}/search?q=canary', settings: '/wizard/v1/settings', store: '/wizard/v1/store' })) {
          try { p[name] = await (await fetch(url)).text(); } catch (_) { p[name + 'Denied'] = true; }
        }
        try { await fetch('/wizard/hermes/v1/runs', { method: 'POST', body: JSON.stringify({ input: 'HOSTILE-SYNTHETIC-ONLY' }), mode: 'no-cors' }); } catch (_) {}
        p.nativeAbsent = !window.WizardOSNative && !window.WizardOSDevice && !window.WizardNative && !window.webkit?.messageHandlers?.wizardNative;
        return p;
      };
    `); }
    res.setHeader('Content-Type', 'text/html'); res.end(`<!doctype html><html><head><meta charset="utf-8"><script src="/wizard-os-home/core/browser-boundary-client.js"></script><script src="/wizard-os-home/core/app-client.js"></script><style>html,body{margin:0;background:transparent;color:var(--wz-text,#eee);font:18px system-ui}main{padding:32px}button,input{font:inherit;padding:12px;margin:12px 0;color:inherit;background:var(--wz-surface,#222);border:1px solid var(--wz-border,#555);border-radius:12px}input{display:block}</style></head><body><main><h1>Boundary fixture</h1><p>Opaque origin · no owner authority</p><p id="state">Root</p><button>Open nested view</button><input value="Hello" aria-label="Dictation field"></main><script src="/fixture-app/app.js"></script></body></html>`);
  });
  const fp = await listen(fixture);
  const socket = http.createServer(); const np = await listen(socket); await close(socket);
  let doc = fs.readFileSync(path.join(root, 'packaging/browser-boundary-document.conf.template'), 'utf8').replace('${WIZARD_SHELL_TOKEN}', token);
  if (process.env.QA_COOP_NEGATIVE_CONTROL === '1') doc = doc.replace('add_header Cross-Origin-Opener-Policy "noopener-allow-popups" always;', '');
  const docPath = path.join(out, 'document.conf'); fs.writeFileSync(docPath, doc);
  let exact = '';
  for (const prefix of ['wizard-os-home', 'wizard-ux']) for (const page of ['', 'index.html', 'desktop.html']) exact += `location = /${prefix}/${page} { root ${web}; try_files /${page || 'index.html'} =404; include ${docPath}; }\n`;
  const config = `worker_processes 1; pid ${path.join(out, 'nginx.pid')}; error_log ${path.join(out, 'nginx.log')}; events { worker_connections 256; } http { client_body_temp_path ${path.join(out, 'client_body')}; proxy_temp_path ${path.join(out, 'proxy_temp')}; fastcgi_temp_path ${path.join(out, 'fastcgi_temp')}; uwsgi_temp_path ${path.join(out, 'uwsgi_temp')}; scgi_temp_path ${path.join(out, 'scgi_temp')}; include ${process.env.QA_NGINX_MIME || '/etc/nginx/mime.types'}; access_log off; server { listen 127.0.0.1:${np}; ${exact} location /wizard-os-home/ { alias ${web}/; } location ~ ^/(?:fixture-app|fixture-list|fixture-drafts|fixture-assets)/ { proxy_pass http://127.0.0.1:${fp}; } location /wizard/v1/agent-notes-off { rewrite ^/wizard/v1/agent-notes-off(.*)$ /wizard/v1/agent-notes$1 break; proxy_set_header X-Wizard-Owner-Proof ${ownerProof}; proxy_pass http://127.0.0.1:${offPort}; } location /wizard/ { proxy_set_header X-Wizard-Owner-Proof ${ownerProof}; proxy_pass http://127.0.0.1:${sp}; } location / { return 404; } } }`;
  const configPath = path.join(out, 'nginx.conf'); fs.writeFileSync(configPath, config);
  const nginx = spawn(process.env.QA_NGINX || 'nginx', ['-p', out + '/', '-e', path.join(out, 'nginx-startup.log'), '-c', configPath, '-g', 'daemon off;'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = ''; nginx.stderr.on('data', b => { stderr += b; });
  let browser;
  let lifecycleSerial = 0;
  report.lifecycle = [];
  const event = (name, extra = {}) => {
    report.lifecycle.push({serial:++lifecycleSerial,at:Date.now(),name,phase:report.phase || 'boot',...extra});
    if (report.lifecycle.length > 256) report.lifecycle.shift();
    fs.writeFileSync(path.join(out,'lifecycle.json'),JSON.stringify(report.lifecycle,null,2));
  };
  const settled = async frame => {
    const wait=target=>target.waitForFunction(() => document.getAnimations().every(a => a.effect?.getTiming().iterations === Infinity || ['finished','idle','paused'].includes(a.playState)),null,{timeout:5000});
    await wait(page);if(frame)await wait(frame);
  };
  let page;
  try {
    let available = false;
    for (let i = 0; i < 30; i++) { try { const r = await fetch(`http://127.0.0.1:${np}/wizard-os-home/core/browser-boundary.js`); if (r.ok) { available = true; break; } } catch (_) {} await new Promise(r => setTimeout(r, 100)); }
    assert.ok(available, 'nginx readiness: ' + stderr);
    browser = await chromium.launch({ headless: true, ...(process.env.QA_CHROME ? { executablePath: process.env.QA_CHROME } : {}) });
    browser.on('disconnected',()=>event('browser.disconnected'));
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    context.on('close',()=>event('context.close'));
    page = await context.newPage(); page.on('pageerror', e => report.errors.push(e.message));
    await require('./qa-browser-onboarding.cjs')(page, token, report);
    page.on('crash',()=>event('page.crash'));page.on('close',()=>event('page.close'));
    page.on('framedetached',f=>event('frame.detached',{url:f.url()}));
    page.on('framenavigated',f=>event('frame.navigated',{url:f.url(),main:f===page.mainFrame()}));
    page.on('console',m=>{if(m.text().startsWith('[qa-canvas]'))event(m.text());});
    await page.goto(`http://127.0.0.1:${np}/wizard-os-home/desktop.html?open=boundary-fixture`);
    await page.waitForFunction(() => window.WizBrowserBoundary?.enabled && window.wizardUX, { timeout: 15000 });
    check(await page.locator('meta[name="wizard-shell-token"]').count() === 0, 'bootstrap secret removed from shell DOM');
    check(await page.evaluate(async () => (await fetch('/wizard/v1/settings')).status) === 200, 'real shell fetch reaches token-gated service');
    await page.evaluate(() => dispatchEvent(new CustomEvent('wizard:open', { detail: { path: '/fixture-app/' } })));
    const app = await appFrame(page,'/fixture-app/');
    await app.waitForFunction(() => typeof window.probe === 'function' && window.WizBoundaryClient?.ready);
    check(await page.locator('iframe[src*="/fixture-app/"]').getAttribute('sandbox') === 'allow-scripts allow-forms allow-downloads', 'real shell render sandboxes app without same-origin/top-navigation/popups');
    const probe = await app.evaluate(() => window.probe());
    report.hostileProbe = probe;
    for (const field of ['parentDenied', 'storageDenied', 'chatsDenied', 'htmlDenied', 'mutationDenied', 'nativeAbsent', 'privateListDenied', 'privateReadDenied', 'privateSearchDenied', 'settingsDenied', 'storeDenied']) check(probe[field] === true, `hostile frame: ${field}`);
    // CORS exceptions alone do not prove refusal: a server can mutate and then
    // return an unreadable 200. Confirm the real server's completed responses.
    report.hostileServiceTrace = serviceTrace.filter(r => r.origin === 'null');
    check(report.hostileServiceTrace.some(r => r.method === 'GET' && r.path === '/wizard/hermes/api/sessions' && [401, 403].includes(r.status) && !r.hasShellToken), 'server-side denial proves hostile chat read refusal, not merely CORS');
    check(report.hostileServiceTrace.some(r => r.method === 'POST' && r.path === '/wizard/v1/setup/seen' && [401, 403].includes(r.status) && !r.hasShellToken), 'server-side denial proves simple hostile mutation refused before route');
    for (const route of ['/wizard/v1/agent-notes', `${notesPath}/read`, `${notesPath}/search`, '/wizard/v1/settings', '/wizard/v1/store', '/wizard/hermes/v1/runs']) {
      check(serviceTrace.some(r => r.privateNotes && r.origin === 'null' && r.path === route && [401, 403].includes(r.status) && !r.hasShellToken && r.hasOwnerProof), 'server-side hostile denial: ' + route);
    }
    // Record actual HTTP status/body before asserting; keep future failures diagnosable.
    report.notebookMatrix = [];
    for (const privateNotes of [true, false]) {
      const base = privateNotes ? '/wizard/v1/agent-notes' : '/wizard/v1/agent-notes-off';
      const routes = [base, `${base}/${priv.id}`, `${base}/${priv.id}/read?path=index.md`, `${base}/${priv.id}/search?q=canary`];
      const start = serviceTrace.length;
      const responses = await page.evaluate(async routes => {
        const rows = [];
        for (const url of routes) { const r = await fetch(url); rows.push({ url, status: r.status, body: await r.json() }); }
        return rows;
      }, routes);
      const trace = serviceTrace.slice(start).filter(r => r.privateNotes === privateNotes && r.path.startsWith('/wizard/v1/agent-notes'));
      report.notebookMatrix.push({ privateNotes, responses, trace });
      fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2));
      check(trace.length === 4 && trace.every(r => r.hasShellToken && r.hasOwnerProof), `shell sent possession and proxy owner proof, private notes ${privateNotes ? 'on' : 'off'}`);
      if (privateNotes) {
        check(responses.every(r => r.status === 200), 'owner shell private notebook list/index/read/search ALLOWED with opt-in');
        check(responses[0].body.sources.some(s => s.id === priv.id), 'owner shell lists actual registry private notebook id');
        check(responses[1].body.entries.includes('index.md'), 'owner shell lists synthetic private notebook file');
        check(responses[2].body.text === 'SYNTHETIC-PRIVATE-NOTEBOOK-CANARY', 'owner shell reads synthetic private canary with shell possession');
        check(responses[3].body.notes.some(n => n.path === 'index.md' && n.snippet.includes('SYNTHETIC-PRIVATE-NOTEBOOK-CANARY')), 'owner shell searches synthetic private notebook');
      } else {
        check(responses[0].status === 200 && !responses[0].body.sources.some(s => s.id === priv.id), 'flag off hides private notebook from legitimate shell listing');
        check(responses.slice(1).every(r => r.status === 404 && r.body.error === 'agent_not_found'), 'flag off DENIES private notebook index/read/search even to legitimate shell');
        check(!JSON.stringify(responses).includes('SYNTHETIC-PRIVATE-NOTEBOOK-CANARY'), 'flag off returns no private canary');
      }
    }
    const noProof = await fetch(`http://127.0.0.1:${sp}${notesPath}/read?path=index.md`, { headers: { 'X-Wizard-Shell-Token': token } });
    report.shellWithoutOwnerProof = { status: noProof.status, body: await noProof.json() };
    check(report.shellWithoutOwnerProof.status === 403 && report.shellWithoutOwnerProof.body.error === 'owner_required' && report.shellWithoutOwnerProof.body.check === 'agent_notes.owner' && Object.keys(report.shellWithoutOwnerProof.body).sort().join(',') === 'check,error' && !JSON.stringify(report.shellWithoutOwnerProof.body).includes('SYNTHETIC-PRIVATE-NOTEBOOK-CANARY'), 'shell possession alone cannot replace independent owner proof');
    const wrongId = await page.evaluate(async () => {
      const r = await fetch('/wizard/v1/agent-notes/synthetic-sealed-notebook/read?path=index.md');
      return { status: r.status, body: await r.json() };
    });
    report.originalWrongIdCounterproof = wrongId;
    check(priv.id !== 'synthetic-sealed-notebook' && wrongId.status === 404 && wrongId.body.error === 'agent_not_found', 'original hard-coded label slug fails even for authorized opt-in shell');
    await app.locator('button').click();
    check(await app.locator('#state').textContent() === 'Nested', 'nested app view opened');
    await page.evaluate(() => dispatchEvent(new CustomEvent('wizard:back')));
    await app.waitForFunction(() => document.querySelector('#state').textContent === 'Root');
    check(!page.isClosed() && page.url().includes('/wizard-os-home/desktop.html'), 'shell Back consumes one nested app step without leaving');
    await app.locator('input').click();
    const pinned = await page.evaluate(async () => { const f = document.querySelector('iframe[src*="/fixture-app/"]'); window.testPin = await WizBrowserBoundary.pinField(f); return !!window.testPin; });
    check(pinned, 'field pin acknowledged by opaque client');
    check(await page.evaluate(() => window.testPin.insert('world')), 'field insertion acknowledged, not fire-and-forget');
    check(await app.locator('input').inputValue() === 'Hello world', 'dictation bridge inserts only in pinned field');
    // Only resource endpoints are synthetic: the SDK, port/nonce handshake,
    // admission, budgets and trusted-click sheet all run unmodified real code.
    await page.evaluate(() => {
      if(WizAppServices.inspect().some(s=>s.appId==='boundary-fixture' && s.holds.length))throw new Error('fixture transcription budget was used before SDK proof');
      window.qaServices={transcribes:[],shares:[]};
      window.qaOriginalTranscribe=WizConfig.transcribe;
      WizConfig.transcribe=async(file,opts)=>{qaServices.transcribes.push({bytes:file.size,language:opts.language});return {text:' synthetic spoken words '};};
      const chats=(window.__wos || window.__wux).chats;
      if(!chats?.sendChat)throw new Error('synthetic share delivery sink unavailable');
      window.qaOriginalSend=chats.sendChat;
      chats.sendChat=async(wid,text,how,audio,opts)=>{qaServices.shares.push({text,how,sid:opts.sid});return {accepted:true};};
    });
    const voice=await app.evaluate(async()=>{
      const audio=()=>new Blob(['synthetic audio'],{type:'audio/ogg'}),out={};
      out.first=await WizardApp.voice.transcribe(audio(),{language:'en'});
      try {await WizardApp.voice.transcribe(new Blob([new Uint8Array(25*1024*1024+1)]));} catch(e){out.large=e.code;}
      for(let i=1;i<10;i++)await WizardApp.voice.transcribe(audio());
      try {await WizardApp.voice.transcribe(audio());} catch(e){out.limit=e.code;}
      return out;
    });
    check(voice.first.text==='synthetic spoken words' && voice.large==='too_large' && voice.limit==='rate_limited','real opaque WizardApp transcribe preserves results, size limit and ten-call budget');
    check(await page.evaluate(()=>qaServices.transcribes.length===10 && qaServices.transcribes[0].language==='en'),'only ten authorized synthetic transcription calls reach upstream');
    const startShare=()=>app.evaluate(()=>{window.qaShareResult=null;WizardApp.share.wizard({text:'Synthetic channel share'}).then(r=>window.qaShareResult=r);});
    await startShare();await page.locator('.wz-share [data-sharesend]').waitFor();
    await page.locator('.wz-share [data-sharesend]').evaluate(b=>b.click());
    await app.waitForFunction(()=>window.qaShareResult==='denied');
    await page.locator('.wz-share').waitFor({state:'detached'});
    check(await page.evaluate(()=>qaServices.shares.length===0),'programmatic shell Send cannot authorize an opaque share');
    await startShare();await page.locator('.wz-share [data-sharesend]').click();
    await app.waitForFunction(()=>window.qaShareResult==='sent');
    await page.locator('.wz-share').waitFor({state:'detached'});
    check(await page.evaluate(()=>qaServices.shares.length===1 && qaServices.shares[0].text==='Synthetic channel share' && qaServices.shares[0].sid==='__new__'),'real opaque WizardApp share reaches shared sheet and delivers once after trusted shell click');
    await startShare();await page.locator('.wz-share .dv-scrim[data-dvclose]').click({position:{x:5,y:5}});
    await app.waitForFunction(()=>window.qaShareResult==='cancelled');
    await page.locator('.wz-share').waitFor({state:'detached'});
    check(await page.evaluate(()=>qaServices.shares.length===1),'outside sheet tap cancels share without another delivery');
    await page.evaluate(()=>{WizConfig.transcribe=qaOriginalTranscribe;(window.__wos || window.__wux).chats.sendChat=qaOriginalSend;});
    await app.locator('input').click();
    await page.evaluate(async () => { window.testPin = await WizBrowserBoundary.pinField(document.querySelector('iframe[src*="/fixture-app/"]')); });
    await app.locator('input').fill('Changed');
    check(!(await page.evaluate(() => window.testPin.insert('must not insert'))), 'edited field refuses stale voice insertion');
    for (const skin of ['nebula', 'sepia']) {
      await page.evaluate(s => { document.documentElement.dataset.skin = s; window.WosSkin?.set?.(s); window.WizAppearance.sync(); }, skin);
      await app.waitForFunction(s => document.documentElement.dataset.skin === s, skin);
      await page.waitForFunction(() => document.querySelector('iframe[src*="/fixture-app/"]')?.closest('.win')?.classList.contains('wz-themed'));
      const shot = path.join(out, `shell-${skin}.png`); await page.screenshot({ path: shot }); report.screenshots.push(shot);
      check(await app.evaluate(() => document.documentElement.hasAttribute('data-wz-hosted')), `in-shell Appearance v1 ${skin}`);
    }
    check((await fetch(`http://127.0.0.1:${np}/wizard-os-home/desktop.html`)).status === 403, 'credential-bearing HTML refuses non-navigation fetch');
    // A frame cannot self-grant an API/native/install operation via this bridge.
    await app.evaluate(() => parent.postMessage({ type: 'wizard:app:request', version: 1, op: 'fetch', args: { path: '/wizard/v1/settings' } }, '*'));
    check(await page.evaluate(() => typeof WizBrowserBoundary.fetch === 'undefined'), 'no generic privileged app fetch RPC');
    const topApp = await context.newPage();
    await topApp.goto(`http://127.0.0.1:${np}/fixture-app/`);
    const popupReady = topApp.waitForEvent('popup');
    await topApp.evaluate(() => { window.shellPopup = open('/wizard-os-home/desktop.html', '_blank'); });
    const popup = await popupReady; await popup.waitForLoadState('load');
    const openerAccess = await topApp.evaluate(() => { try { return !!window.shellPopup?.document?.documentElement; } catch (_) { return false; } });
    const negative = process.env.QA_COOP_NEGATIVE_CONTROL === '1';
    report.openerNegativeControl = negative;
    check(openerAccess === negative, negative ? 'negative control reproduces same-origin app popup access without COOP' : 'same-origin top-level app cannot access owner shell popup');
    await topApp.close(); await popup.close();
    // Stage 2: only two migrated fixtures. The inherited hostile frame is not a data app.
    await page.evaluate(()=>localStorage.setItem('fixture-drafts.legacy.v1',JSON.stringify({version:1,text:'Synthetic recovered draft'})));
    const openFixture=async id=>{
      await page.evaluate(id=>dispatchEvent(new CustomEvent('wizard:open',{detail:{path:'/'+id+'/'}})),id);
      const frame=await appFrame(page,'/'+id+'/');
      await frame.waitForFunction(()=>window.WizBoundaryClient?.ready);return frame;
    };
    const list=await openFixture('fixture-list');
    await list.waitForFunction(()=>document.querySelector('#status').textContent==='Loaded synthetic list');
    check((await list.locator('#items').textContent()).includes('Synthetic list item'),'typed data list loads synthetic backend result');
    const denied=await list.evaluate(async()=>{
      const result={};
      for(const [name,req] of Object.entries({unknown:{operation:'owner.fetch',args:{}},forged:{operation:'fixture.notifications.list',args:{limit:2},appId:'fixture-drafts'}})){
        try{await WizardApp.data.call(req);result[name]='ALLOWED';}catch(e){result[name]=e.code;}
      }
      try{await WizardApp.state.read({area:'persistent',key:'draft'});result.crossApp='ALLOWED';}catch(e){result.crossApp=e.code;}
      try{await fetch('/wizard/v1/browser-adapters/bindings',{method:'POST',mode:'no-cors',body:JSON.stringify({appId:'fixture-drafts',generation:crypto.randomUUID()})});}catch(_){}
      return result;
    });
    check(denied.unknown==='not_allowed'&&denied.forged==='bad_request'&&denied.crossApp==='not_allowed','hostile data.call unknown operation, forged identity and cross-app state denied');
    check(serviceTrace.some(r=>r.origin==='null'&&r.path==='/wizard/v1/browser-adapters/bindings'&&[401,403].includes(r.status)&&!r.hasShellToken),'forged direct binding denied server-side before operation');
    for(const skin of ['nebula','sepia']){
      await page.evaluate(s=>{WosSkin.set(s);WizAppearance.sync();},skin);
      await list.waitForFunction(s=>document.documentElement.dataset.skin===s,skin);
      await settled(list);
      report.phase='list-opacity-'+skin;event('opacity.before-evaluate',{frameDetached:list.isDetached(),pageClosed:page.isClosed(),browserConnected:browser.isConnected()});
      const panelOpaque=await list.evaluate(()=>{console.error('[qa-canvas] begin');const c=document.createElement('canvas');c.width=c.height=1;const x=c.getContext('2d');x.fillStyle=getComputedStyle(document.querySelector('#status')).backgroundColor;x.fillRect(0,0,1,1);const alpha=x.getImageData(0,0,1,1).data[3];console.error('[qa-canvas] after-readback');return alpha===255;});
      event('opacity.after-evaluate');
      check(panelOpaque,'text status panel fully opaque on '+skin);
      const shot=path.join(out,'fixture-list-'+skin+'.png');await page.screenshot({path:shot});report.screenshots.push(shot);
    }
    report.phase='drafts';
    let drafts=await openFixture('fixture-drafts');
    await drafts.waitForFunction(()=>!document.querySelector('#draft').disabled);
    check(await drafts.locator('#draft').inputValue()==='Synthetic recovered draft','verified migration hydrates synthetic legacy draft');
    await drafts.locator('#draft').fill('Synthetic newer autosaved draft');
    await drafts.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Saved locally'));
    for(const skin of ['nebula','sepia']){
      await page.evaluate(s=>{WosSkin.set(s);WizAppearance.sync();},skin);
      await drafts.waitForFunction(s=>document.documentElement.dataset.skin===s,skin);
      check(await drafts.locator('#draft').inputValue()==='Synthetic newer autosaved draft','skin change preserves unsent draft '+skin);
      await settled(drafts);
      const shot=path.join(out,'fixture-drafts-'+skin+'.png');await page.screenshot({path:shot});report.screenshots.push(shot);
    }
    await page.evaluate(()=>localStorage.setItem('fixture-drafts.legacy.v1',JSON.stringify({version:1,text:'Synthetic old-state rollback'})));
    await page.reload();await page.waitForFunction(()=>window.WizBrowserBoundary?.enabled&&window.wizardUX);
    await page.waitForFunction(()=>window.WosWelcome?.log.some(s=>s.startsWith('boot:')));
    check(await page.evaluate(()=>localStorage.getItem('wos.welcome.v1')==='done' && !WosWelcome.active),'reload preserves established-owner onboarding state without welcome overlay');
    check(report.onboardingFixture.providerReads>0 && report.onboardingFixture.setupReads>0,'reload reads synthetic provider and setup fixtures through token-bearing shell requests');
    drafts=await openFixture('fixture-drafts');await drafts.waitForFunction(()=>!document.querySelector('#draft').disabled);
    check(await drafts.locator('#draft').inputValue()==='Synthetic newer autosaved draft','browser reload plus old legacy rollback preserves newer durable draft');
    await drafts.locator('#recover').click();
    check(await drafts.locator('#draft').inputValue()==='Synthetic newer autosaved draft','explicit recovery reads same durable draft');
    grants.set('fixture-drafts-instance',{operations:[]});
    const revoked=await drafts.evaluate(async()=>{try{await WizardApp.state.read({area:'persistent',key:'draft'});return 'ALLOWED';}catch(e){return e.code;}});
    check(revoked==='not_allowed','revoked grant denied on next call without frame reload');
    report.stage2={syntheticOnly:true,migratedFixtures:2,localProfileOnly:true,fullSuiteRun:false};
    const darkContext=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block',colorScheme:'dark'});
    const standalone=await darkContext.newPage();await standalone.goto(`http://127.0.0.1:${np}/fixture-list/`);
    check(await standalone.evaluate(()=>getComputedStyle(document.documentElement).colorScheme==='dark'&&getComputedStyle(document.body).backgroundColor!=='rgba(0, 0, 0, 0)'),'standalone fixture has opaque dark fallback without shell authority');
    const fallbackShot=path.join(out,'fixture-standalone-dark.png');await standalone.screenshot({path:fallbackShot});report.screenshots.push(fallbackShot);
    check(new Set(report.screenshots.filter(s=>/fixture-(?:list|drafts)-(?:nebula|sepia)\.png$|fixture-standalone-dark\.png$/.test(s))).size===5,'all five stage-2 acceptance screenshots retained');
    await darkContext.close();
    check(report.serviceTrace.length>0 && report.serviceTrace.every(r=>typeof r.path==='string' && Number.isInteger(r.status)) && !report.serviceTrace.some(r=>/\/runs(?:[/?]|$)/.test(r.path) && r.method==='POST' && r.status<400),'browser proof never sends a run to an owner agent');
    await context.close();
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    event('harness.catch',{message:error.message});report.failure = error.stack; fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2));
    throw error;
  } finally {
    event('harness.finally');await browser?.close(); nginx.kill('SIGTERM');
    await Promise.all([close(fixture), close(service), close(serviceOff)]);
    await Promise.all([service.drained, serviceOff.drained]);
    await hermes.closeFixture();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
