'use strict';
// Real shell, synthetic origin only. Never contacts an owner API or sends.
// Sample from document start, not merely after layout readiness. Exercise restored
// app documents (SDK tools), companion placement, pins and an established thread.
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const origin = 'https://boot.test', prefix = '/wizard-os-home/';
const out = process.env.QA_OUT || 'boot-layout-evidence'; fs.mkdirSync(out, { recursive: true });
const apps = ['editor', 'notes', 'calendar', 'music'].map(id => ({
 id: 'qa-' + id, name: 'Synthetic ' + id, url: '/qa-boot-apps/' + id + '/',
 source: 'apps.json', type: 'view', kind: 'wizard', status: 'running',
}));
const thread = { id: 'qa-thread', title: 'Synthetic restored thread', status: 'completed',
 source: 'wizard-mobile', updated_at: '2026-11-05T00:00:00Z', message_count: 2,
 latest_message: { role: 'assistant', content: 'Synthetic completed reply.', timestamp: '2026-11-05T00:00:00Z' },
 wizard_attention: { kind: 'check', summary: 'Synthetic review' } };
const appHTML = '<!doctype html><html><meta charset="utf-8"><style>html{color-scheme:dark}body{background:var(--wz-base,#14141e);color:var(--wz-text,#eee);font:16px system-ui}</style><body><h1>Synthetic installed app</h1><input aria-label="Retained draft" value="Synthetic draft"><script src="/wizard-os-home/core/app-client.js"></script><script src="/qa-boot-apps/fixture.js"></script></body></html>';
const appJS = `window.fixtureCalls=[];window.fixturePulses=0;
window.fixturePulse=()=>WizardApp.titlebar.set([{id:'search',kind:'button',icon:'search',label:'Synthetic search '+(++fixturePulses),dot:fixturePulses%2===0},{id:'mode',kind:'select',label:'Synthetic mode',value:'one',options:[{value:'one',label:'One'},{value:'two',label:'Two'}]}],e=>fixtureCalls.push(e));
window.fixtureReady=WizardApp.ready().then(fixturePulse).then(()=>{window.fixtureToolsRegistered=true;setTimeout(fixturePulse,900);setInterval(fixturePulse,1700);});fixtureReady.catch(e=>{window.fixtureError=e.stack;console.error(e);});`;
const modes = process.env.QA_BOOT_MODES ? process.env.QA_BOOT_MODES.split(',') : ['restored-apps-chat', 'restored-apps-front', 'default', 'reload', 'classic', 'stale-ai-apps', 'stale-classic'];
const report = { synthetic: true, source: process.env.QA_SOURCE_SHA || null, modes, cases: [], failures: [] };
function save() { fs.writeFileSync(path.join(out, 'boot-report.json'), JSON.stringify(report, null, 2) + '\n'); }
async function interaction(p, row) {
 const started = Date.now(); row.interaction = { steps: [], seconds: 0 };
 await p.evaluate(() => {
  window.__interaction = { samples: 0, failures: [], panelModes: [] };
  window.__interactionTimer = setInterval(() => {
   const s = WosSkinHost.layoutState, x = __interaction; x.samples++;
   if (!x.panelModes.includes(WosSkinHost.panelMode)) x.panelModes.push(WosSkinHost.panelMode);
   const toast = /gestures turned off after an error/.test(document.body.textContent);
   if (toast || s.disabled || (!WosExperience.state.busy && (!s.active || document.documentElement.dataset.aiApps !== 'desktop'))) {
    if (x.failures.length < 20) x.failures.push({ t: performance.now(), state: s, toast, html: { ...document.documentElement.dataset } });
   }
  }, 100);
 });
 // Click the pinned app dock, not shell internals. SDK tool churn runs in all
 // retained frames throughout; late registration used to be absent from boot QA.
 await p.locator('.aad-vtab[data-app="qa-notes"]').click({ timeout: 7000 });
 await p.locator('.aad-ptools [data-tool="search"]').waitFor({ state: 'visible', timeout: 7000 });
 const notes = p.frames().find(f => new URL(f.url()).pathname === '/qa-boot-apps/notes/');
 assert.ok(notes, 'dock selected the retained notes document');
 const companion = await notes.evaluate(() => WizardApp.shell.openCompanion({ path: '/qa-boot-apps/notes/?pane=late', title: 'Late companion', focus: false, share: .36 }));
 assert.ok(companion?.id, 'real SDK companion open returned a window');
 await p.waitForFunction(id => !!__wux.wins[id], companion.id, { timeout: 7000 });
 row.interaction.steps.push('dock open + real SDK companion open');
 let i = 0;
 while (Date.now() - started < 120000) {
  const app = apps[i++ % apps.length];
  await p.locator('.aad-vtab[data-app="' + app.id + '"]').click({ timeout: 7000 });
  await p.locator('.aad-ptools [data-tool="search"]').waitFor({ state: 'visible', timeout: 7000 });
  const f = p.frames().find(f => new URL(f.url()).pathname === app.url && !new URL(f.url()).search);
  assert.ok(f, 'selected frame remains retained');
  // Main does not yet contain the independent companion-column CSS repair
  // already retained by live (#1053). Keep this lifecycle oracle about focus,
  // not pointer hit-testing through that unrelated stacked-companion bug.
  if (app.id === 'qa-editor' || app.id === 'qa-notes') await f.locator('input').focus({ timeout: 7000 });
  else await f.locator('input').click({ timeout: 7000 });
  await f.evaluate(() => fixturePulse());
  await p.locator('.aad-scroll .aad-row').first().click({ timeout: 7000 });
  await p.locator('.ch-compose textarea').first().focus({ timeout: 7000 });
  if (i === 4 || i === 9) {
   const skin = i === 4 ? 'novairecito' : 'nebula';
   await p.evaluate(id => WosSkin.set(id), skin);
   await p.waitForFunction(() => !WosExperience.state.busy && document.documentElement.dataset.aiApps === 'desktop', null, { timeout: 10000 });
   // The experience promise resolves before the browser's skin crossfade paints.
   await p.waitForTimeout(800);
   await p.screenshot({ path: path.join(out, 'interaction-' + skin + '.png') });
   row.interaction.steps.push('live skin ' + skin);
  }
  const state = await p.evaluate(() => ({ failures: __interaction.failures, state: WosSkinHost.layoutState, diagnostic: localStorage.getItem('wos.layout-fault.v1') }));
  assert.deepEqual(state.failures, [], 'layout stays mounted throughout app/chat/tool interaction: ' + JSON.stringify(state));
  await p.waitForTimeout(6500);
 }
 await notes.evaluate(() => WizardApp.shell.closeCompanion());
 await p.waitForFunction(id => !__wux.wins[id], companion.id, { timeout: 7000 });
 row.interaction = { ...row.interaction, cycles: i, seconds: (Date.now() - started) / 1000,
  ...await p.evaluate(() => { clearInterval(__interactionTimer); return { ...__interaction, diagnostic: localStorage.getItem('wos.layout-fault.v1') }; }) };
 assert.ok(row.interaction.seconds >= 120); assert.ok(row.interaction.samples > 600);
 assert.deepEqual(row.interaction.failures, []);
 assert.equal(await p.locator('#wsList').isVisible(), false);
 assert.equal(await p.locator('.aad-side').isVisible(), true);
 row.checks.push('120s real dock/app/chat/SDK tools/companion interaction; two live skins; no layout off toast');
}
(async () => {
 const browser = await chromium.launch();
 try {
  for (const mode of modes) {
   const realistic = mode.startsWith('restored-apps-');
   const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, serviceWorkers: 'block' });
   await context.routeWebSocket('**/*', ws => ws.close());
   await context.addInitScript(({ mode, apps }) => {
    if (window !== top) return; // child documents must never reseed the owner workspace
    if (sessionStorage.getItem('qa.seeded') !== '1') {
     sessionStorage.setItem('qa.seeded', '1');
     localStorage.setItem('wos.shell', 'desktop');
     for (const [k, v] of Object.entries({ 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': 'nebula' })) localStorage.setItem(k, v);
     if (mode.startsWith('restored-apps-')) {
      localStorage.setItem('wos.desktop-view.v1', 'ai-apps');
      localStorage.setItem('wux.apps.v1', JSON.stringify(apps)); // installed cache exists before the async census
      localStorage.setItem('wos.skin.layout:ai-apps.pins', JSON.stringify(['qa-editor', 'qa-notes', 'qa-music']));
      const wins = { restored: { id: 'restored', app: 'chats', thread: 'qa-thread' } };
      const ws = [{ id: 'drestored', wins: ['restored'], focus: 'restored', mono: false }];
      for (const a of apps) {
       const id = a.id + '-win';
       wins[id] = { id, app: 'frame', appId: a.id, url: a.url, title: a.name };
       ws.push({ id: 'd' + a.id.replaceAll('-', ''), wins: [id], focus: id, mono: false });
      }
      // Exactly the window record produced by WizCompanionPane.open, retained on its owner's desk.
      wins.peer = { id: 'peer', app: 'frame', appId: 'qa-editor-companion', servicesAs: 'qa-editor',
       url: '/qa-boot-apps/editor/?pane=notes', title: 'Synthetic companion', companionOwner: 'qa-editor-win', share: .36 };
      ws[1].wins.push('peer');
      for (const [k, v] of Object.entries({ wins, ws, cur: mode.endsWith('front') ? 1 : 0, homeOpen: false })) localStorage.setItem('wux.desk.' + k, JSON.stringify(v));
     }
     if (mode === 'classic' || mode === 'stale-classic') localStorage.setItem('wos.desktop-view.v1', 'classic');
     if (mode === 'stale-classic') localStorage.setItem('wos.layout', 'ai-apps');
     if (mode === 'stale-ai-apps') { localStorage.setItem('wos.desktop-view.v1', 'ai-apps'); localStorage.setItem('wos.layout', 'orb'); }
    }
    window.__legacy = { samples: 0, hits: [], rows: 0, phases: [], ownership: [] };
    const drawn = n => {
     const r = n.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0) return false;
     let o = 1; for (let e = n; e; e = e.parentElement) { const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden') return false; o *= parseFloat(s.opacity); }
     return o > 0.01;
    };
    const sample = why => {
     if (!document.documentElement) return; __legacy.samples++;
     for (const n of document.querySelectorAll('.pane-list,.pane-split,.pane-empty,.ch-list')) if (drawn(n) && __legacy.hits.length < 50) __legacy.hits.push({ why, cls: n.className, t: Math.round(performance.now()) });
     __legacy.rows = Math.max(__legacy.rows, document.querySelectorAll('.ch-row').length);
     const ph = document.readyState + (document.documentElement.dataset.layout ? '+' + document.documentElement.dataset.layout : '');
     if (__legacy.phases.at(-1) !== ph) __legacy.phases.push(ph);
     const state = JSON.stringify({ layout: document.documentElement.dataset.layout || null, owner: document.documentElement.dataset.chatsOwner || null, booting: document.documentElement.hasAttribute('data-layout-booting'), state: window.WosSkinHost?.layoutState });
     if (__legacy.ownership.at(-1)?.state !== state) __legacy.ownership.push({ t: Math.round(performance.now()), state });
    };
    new MutationObserver(() => sample('mutation')).observe(document, { subtree: true, childList: true, attributes: true });
    const frame = () => { sample('frame'); requestAnimationFrame(frame); }; requestAnimationFrame(frame);
    document.addEventListener('DOMContentLoaded', () => sample('DOMContentLoaded'));
   }, { mode, apps });
   const errors = [], logs = [], writes = [], seenWrites = [], runs = [], pending = new Set();
   await context.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url());
    if (u.origin !== origin) return r.abort();
    if (u.pathname.includes('/v1/runs')) { runs.push(u.pathname); return r.abort(); }
    // The restored thread auto-marks seen; allow ONLY the exact product route.
    if (q.method() === 'PUT' && u.pathname === '/wizard/thread-seen') { seenWrites.push(q.method() + ' ' + u.pathname); return r.fulfill({ json: { ok: true } }); }
    if (!['GET', 'HEAD'].includes(q.method())) { writes.push(q.method() + ' ' + u.pathname); return r.fulfill({ status: 403, json: { error: 'No writes in QA' } }); }
    if (u.pathname === '/qa-boot-apps/fixture.js') return r.fulfill({ contentType: 'text/javascript', body: appJS });
    if (u.pathname.startsWith('/qa-boot-apps/')) return r.fulfill({ contentType: 'text/html', body: appHTML });
    if (u.pathname === '/wizard/hermes/api/sessions') return r.fulfill({ json: { object: 'list', data: [thread], has_more: false, total: 1 } });
    if (u.pathname === '/wizard/hermes/api/sessions/qa-thread') return r.fulfill({ json: { session: thread } });
    if (u.pathname === '/wizard/hermes/api/sessions/qa-thread/messages') return r.fulfill({ json: { data: [{ id: 'qa-user', role: 'user', content: 'Synthetic request.' }, { id: 'qa-assistant', role: 'assistant', content: 'Synthetic completed reply.' }], has_more: false } });
    if (u.pathname === '/wizard/v1/apps') return r.fulfill({ json: { apps: realistic ? apps : [] } });
    if (u.pathname === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
    if (u.pathname.startsWith('/wizard/')) return r.fulfill({ json: ownerRead(u.pathname) });
    if (u.pathname.startsWith(prefix)) {
     const root = path.resolve(__dirname, '../web'), file = path.resolve(root, u.pathname.slice(prefix.length) || 'index.html');
     if (file.startsWith(root + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) return r.fulfill({ path: file });
    }
    return r.fulfill({ json: { apps: [], agents: [], sessions: [], connected: false } });
   });
   const p = await context.newPage();
   p.on('pageerror', e => { errors.push(e.stack || e.message); console.error('PAGEERROR', mode, e.stack); });
   p.on('console', m => {
    if (!['warning', 'error'].includes(m.type())) return;
    const row = { type: m.type(), text: m.text(), location: m.location(), args: [] }; logs.push(row);
    // skin-host catches setup/listener exceptions: pageerror alone misses the fallback reason.
    const job = Promise.all(m.args().map(a => a.evaluate(v => v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : String(v)).catch(() => null))).then(args => { row.args = args; console.error('BROWSER', mode, JSON.stringify(row)); });
    pending.add(job); job.finally(() => pending.delete(job));
   });
   try {
    await p.goto(origin + prefix + 'desktop.html');
    if (mode === 'reload') {
     await p.waitForFunction(() => localStorage.getItem('wos.desktop-view.v1') === 'ai-apps' && document.documentElement.dataset.aiApps === 'desktop');
     await p.reload();
    }
    for (const pass of realistic ? ['fresh', 'reload'] : ['fresh']) {
     if (pass === 'reload') await p.reload(); // never reapply the seed; restore what production saved
     const row = { mode, phase: pass, checks: [], errors, logs, writes, seenWrites, runs }; report.cases.push(row);
     try {
      if (mode === 'classic' || mode === 'stale-classic') {
       await p.waitForFunction(() => window.__wux && !WosExperience.state.busy);
       await p.waitForFunction(() => { const n = document.querySelector('.pane-list'); return n && getComputedStyle(n).display !== 'none' && n.getBoundingClientRect().width > 0; }, null, { timeout: 15000 });
       const root = await p.evaluate(() => ({ layout: document.documentElement.dataset.layout || null, owner: document.documentElement.dataset.chatsOwner || null, booting: document.documentElement.dataset.layoutBooting ?? null }));
       assert.deepEqual(root, { layout: null, owner: null, booting: null }, 'Classic Desks boots normally: no layout, nothing claimed');
      } else {
       await p.waitForFunction(() => window.__wux && document.documentElement.dataset.aiApps === 'desktop' && !WosExperience.state.busy && !document.documentElement.hasAttribute('data-layout-booting') && document.querySelector('.ch-compose'), null, { timeout: 20000 });
       for (let i = 0; i < 30; i++) await p.evaluate(() => new Promise(requestAnimationFrame));
       const res = row.result = await p.evaluate(() => ({ ...__legacy, layout: document.documentElement.dataset.layout, owner: document.documentElement.dataset.chatsOwner || null, bodyOpacity: getComputedStyle(document.body).opacity }));
       assert.ok(res.samples > 30, 'sampler ran from document start through layout ready');
       const at = res.phases.indexOf('loading+ai-apps');
       assert.ok(at >= 0, 'AI apps was worn before DOMContentLoaded: ' + res.phases.join(','));
       assert.ok(res.phases.slice(at).every(x => x.endsWith('+ai-apps')), 'Classic never came back: ' + res.phases.join(','));
       assert.equal(res.layout, 'ai-apps'); assert.equal(res.owner, 'layout'); assert.equal(res.bodyOpacity, '1');
       assert.equal(res.rows, 0, 'Classic list rows were never attached');
       assert.deepEqual(res.hits, [], 'Classic chats list never drawn');
       if (realistic) {
        await p.locator('.aad-side').waitFor({ state: 'visible' });
        await p.locator('.aad-scroll .aad-row').first().waitFor({ state: 'visible' });
        assert.equal(await p.locator('#wsList').count(), 1, 'Classic workspace menu exists for the negative oracle');
        assert.equal(await p.locator('#wsList').isVisible(), false, 'Classic workspace menubar is not visible');
        assert.equal(await p.locator('#logo').isVisible(), false, 'Classic Home menubar button is not visible');
        await p.waitForFunction(() => [...document.querySelectorAll('.win iframe[src*="/qa-boot-apps/"]')].length === 5 && [...document.querySelectorAll('.win iframe[src*="/qa-boot-apps/"]')].every(f => f.contentWindow?.fixtureToolsRegistered));
        row.workspace = await p.evaluate(() => ({ wins: Object.values(__wux.wins).map(w => ({ id: w.id, app: w.app, appId: w.appId, thread: w.thread, companionOwner: w.companionOwner })), desks: __wux.ws.map(d => ({ id: d.id, wins: d.wins })), pins: [...document.querySelectorAll('.aad-vtab.is-pinned')].map(n => n.dataset.app), state: WosSkinHost.layoutState }));
        assert.equal(row.workspace.wins.filter(w => w.app === 'frame').length, 5, 'all four installed apps and companion survived');
        assert.equal(row.workspace.wins.find(w => w.id === 'restored')?.thread, 'qa-thread', 'real restored thread remains open');
        assert.equal(row.workspace.wins.find(w => w.id === 'peer')?.companionOwner, 'qa-editor-win');
        assert.deepEqual(row.workspace.pins, ['qa-editor', 'qa-notes', 'qa-music'], 'saved pinned apps retained');
        if (mode.endsWith('front')) await p.locator('.aad-ptools [data-tool="search"]').waitFor({ state: 'visible' });
        row.checks.push('AI apps sidebar + populated chats list; no Classic menubar; SDK tools in five retained frames; restored thread; companion; pins');
        if (mode === 'restored-apps-chat' && pass === 'fresh' && process.env.QA_BOOT_INTERACT !== '0') {
         await interaction(p, row);
        }
       }
      }
      assert.deepEqual([writes, runs], [[], []], 'no writes, no sends');
      assert.deepEqual(errors, [], 'no uncaught browser errors');
      assert.equal(logs.some(m => /\[skin layout:ai-apps\]|\[layout\].*(failed|error)/.test(m.text)), false, 'no caught layout fallback errors');
      row.pass = true;
     } catch (e) {
      row.pass = false; row.error = e.stack; report.failures.push({ mode, pass, error: e.stack });
      row.failureState = await p.evaluate(() => ({ legacy: window.__legacy, interaction: window.__interaction, diagnostic: localStorage.getItem('wos.layout-fault.v1'), html: { ...document.documentElement.dataset }, layout: window.WosSkinHost?.layoutState, wins: window.__wux && Object.values(__wux.wins).map(w => ({ id: w.id, app: w.app, appId: w.appId })) })).catch(() => null);
      fs.writeFileSync(path.join(out, mode + '-' + pass + '-failure.html'), await p.content());
      console.error('FAIL', mode, pass, e.stack);
     } finally {
      await Promise.all([...pending]);
      await p.screenshot({ path: path.join(out, mode + '-' + pass + '.png') }); save();
     }
    }
   } catch (e) { report.failures.push({ mode, error: e.stack }); save(); }
   finally { await context.close(); }
  }
  report.pass = report.failures.length === 0; save();
  assert.equal(report.failures.length, 0, JSON.stringify(report.failures));
  console.log('ok', report.cases.map(r => r.mode + ':' + r.pass).join(', '));
 } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
