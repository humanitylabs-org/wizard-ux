'use strict';
// Real shell, synthetic origin only. Never contacts an owner API or sends.
// Sample from document start, not merely after layout readiness. Exercise restored
// app documents (SDK tools), companion placement, pins and an established thread.
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const missing = process.env.QA_LAYOUT_BUNDLE_MISSING === '1';
const faults = process.env.QA_LAYOUT_FAULTS === '1';
const backdropProbe = process.env.QA_BACKDROP_PROBE === '1';
let look = { version: 1, skin: { id: 'nebula', at: 40 }, tweaks: {}, views: { desktop: { id: 'miguel/ai-apps', at: 40 } }, desktopBackdrop: { id: 'custom', wide: 'qa-custom-wide', tall: 'qa-custom-tall', at: 52 } };
// Read actual painted canvas RGB, not merely the selected background id or CSS.
function backdropPixels() {
 return [...document.querySelectorAll('#skinA,#skinB')].map(c => {
  const s = getComputedStyle(c), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let maxRGB = 0, bright = 0;
  for (let i = 0; i < d.length; i += 256) { const v = Math.max(d[i], d[i+1], d[i+2]); maxRGB = Math.max(maxRGB, v); if (v > 80 && d[i+3] > 0) bright++; }
  return { id: c.id, width: c.width, height: c.height, opacity: s.opacity, display: s.display, maxRGB, bright };
 });
}
const source = path.resolve(process.env.QA_SOURCE || path.join(__dirname, '..'));
const { injectLayoutCallbackFault } = require('../tools/qa-layout-callback-fault.cjs');
// Preflight once, outside the async route: a changed source anchor is a harness
// error, never an unhandled route rejection or evidence of product fallback.
const faultModule = faults ? injectLayoutCallbackFault(fs.readFileSync(path.join(source, 'web/layouts/ai-apps/desktop.js'), 'utf8')) : null;
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
   look.skin = { id: 'nebula', at: 40 };
   const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, serviceWorkers: 'block' });
   await context.routeWebSocket('**/*', ws => ws.close());
   await context.addInitScript(({ mode, apps, faults, backdropProbe }) => {
    if (window !== top) return; // child documents must never reseed the owner workspace
    if (faults || backdropProbe) {
     localStorage.setItem('wos.skin.wallpaper.wizard.desktop', 'custom');
     localStorage.setItem('wos.skin.wallpaper.wizard.custom', JSON.stringify({ wide: 'qa-custom-wide', tall: 'qa-custom-tall' }));
    }
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
   }, { mode, apps, faults, backdropProbe });
   const errors = [], logs = [], writes = [], seenWrites = [], runs = [], pending = new Set();
   await context.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url());
    if (u.origin !== origin) return r.abort();
    if (u.pathname.includes('/v1/runs')) { runs.push(u.pathname); return r.abort(); }
    // The restored thread auto-marks seen; allow ONLY the exact product route.
    if (q.method() === 'PUT' && u.pathname === '/wizard/thread-seen') { seenWrites.push(q.method() + ' ' + u.pathname); return r.fulfill({ json: { ok: true } }); }
    // Only disposable synthetic Look state; never forward an owner request.
    if ((faults || backdropProbe) && u.pathname === '/wizard/v1/pages/wizard-look/look.json') {
     if (q.method() === 'PUT') look = JSON.parse(q.postDataJSON().text);
     return r.fulfill({ json: { text: JSON.stringify(look), version: 'qa-look' } });
    }
    if (!['GET', 'HEAD'].includes(q.method())) { writes.push(q.method() + ' ' + u.pathname); return r.fulfill({ status: 403, json: { error: 'No writes in QA' } }); }
    if (missing && u.pathname.endsWith('/layouts/ai-apps/layout.js')) return r.fulfill({ status: 503, body: 'QA synthetic missing layout bundle' });
    if (u.pathname === '/qa-boot-apps/fixture.js') return r.fulfill({ contentType: 'text/javascript', body: appJS });
    if (u.pathname.startsWith('/qa-boot-apps/')) return r.fulfill({ contentType: 'text/html', body: appHTML });
    if (u.pathname === '/wizard/hermes/api/sessions') return r.fulfill({ json: { object: 'list', data: [thread], has_more: false, total: 1 } });
    if (u.pathname === '/wizard/hermes/api/sessions/qa-thread') return r.fulfill({ json: { session: thread } });
    if (u.pathname === '/wizard/hermes/api/sessions/qa-thread/messages') return r.fulfill({ json: { data: [{ id: 'qa-user', role: 'user', content: 'Synthetic request.' }, { id: 'qa-assistant', role: 'assistant', content: 'Synthetic completed reply.' }], has_more: false } });
    if (u.pathname === '/wizard/v1/apps') return r.fulfill({ json: { apps: realistic ? apps : [] } });
    if (u.pathname === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
    if ((faults || backdropProbe) && /^\/wizard\/files\/qa-custom-(wide|tall)\/content$/.test(u.pathname)) return r.fulfill({ contentType: 'image/png', path: path.join(source, 'web/brand/wizard-mark-white.png') });
    if (u.pathname.startsWith('/wizard/')) return r.fulfill({ json: ownerRead(u.pathname) });
    if (u.pathname.startsWith(prefix)) {
      const root = path.resolve(source, 'web'), file = path.resolve(root, u.pathname.slice(prefix.length) || 'index.html');
      if (faults && u.pathname.endsWith('/layouts/ai-apps/desktop.js')) {
       // REAL module + REAL guarded host callback, identical on old and new code.
       return r.fulfill({ contentType: 'text/javascript', body: faultModule });
      }
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
    for (const pass of realistic ? (faults || backdropProbe ? ['fresh', 'reload', 'reload2', 'reload3'] : ['fresh', 'reload']) : ['fresh']) {
     if (pass.startsWith('reload')) await p.reload(); // never reapply the seed; restore what production saved
     const row = { mode, phase: pass, checks: [], errors, logs, writes, seenWrites, runs }; report.cases.push(row);
     try {
      if (backdropProbe) {
       await p.waitForFunction(() => window.WosSkin && window.__wux && !WosExperience.state.busy);
       await p.waitForTimeout(800);
       row.backdrop = { pixels: await p.evaluate(backdropPixels), ...await p.evaluate(() => ({ selected: WosSkin.desktopBackdrop || null, wallpaper: WosSkin.wallpaper, local: localStorage.getItem('wos.skin.wallpaper.wizard.desktop'), skin: WosSkin.current, html: { ...document.documentElement.dataset } })) };
       if (process.env.QA_BACKDROP_OLD !== '1') {
        assert.equal(row.backdrop.selected.id, 'custom');
        assert.ok(row.backdrop.pixels.some(c => Number(c.opacity) > .1 && c.bright > 50), 'visible custom background canvas is not black');
       }
       row.checks.push('Nebula + saved custom desktopBackdrop: painted RGB recorded after load/reload');
      } else if (missing && realistic) {
       await p.waitForFunction(() => document.documentElement.dataset.layoutRecovery === 'chats' && document.querySelector('[data-layout-recovery-chat] .ch-row'), null, { timeout: 20000 });
       assert.equal(await p.locator('#wsList').isVisible(), false, 'no Classic menubar in shared Chats recovery');
       assert.equal(await p.locator('[data-layout-recovery-chat] .pane-list').isVisible(), true);
       await p.locator('[data-layout-recovery-chat] .ch-row[data-chopen]').first().click();
       await p.locator('[data-layout-recovery-chat] .ch-compose textarea').waitFor({ state: 'visible' });
       row.recovery = await p.evaluate(() => ({ layout: WosSkinHost.layout, choice: localStorage.getItem('wos.desktop-view.v1'), dataset: { ...document.documentElement.dataset }, state: WosSkinHost.layoutState }));
       assert.equal(row.recovery.layout, 'ai-apps'); assert.equal(row.recovery.choice, 'ai-apps');
       row.checks.push('missing bundle: shared live Chats sidebar + thread opening; no Classic or saved choice change');
      } else if (mode === 'classic' || mode === 'stale-classic') {
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
        if (mode.endsWith('front')) {
         // The previous pass deliberately opened Chats, which is what reload restores.
         // Select the retained app through the real dock before expecting its tools.
         await p.locator('.aad-vtab[data-app="qa-notes"]').click();
         await p.locator('.aad-ptools [data-tool="search"]').waitFor({ state: 'visible' });
        }
        row.checks.push('AI apps sidebar + populated chats list; no Classic menubar; SDK tools in five retained frames; restored thread; companion; pins');
        if (mode === 'restored-apps-chat' && pass === 'fresh' && process.env.QA_BOOT_INTERACT !== '0') {
         await interaction(p, row);
        }
       }
      }
      assert.deepEqual([writes, runs], [[], []], 'no writes, no sends');
      assert.deepEqual(errors, [], 'no uncaught browser errors');
      if (!faults && !missing) assert.equal(logs.some(m => /\[skin layout:ai-apps\]|\[layout\].*(failed|error)/.test(m.text)), false, 'no caught layout fallback errors');
      if (faults && realistic) {
       row.backdropPixels = await p.evaluate(backdropPixels);
       if (process.env.QA_SKIP_BACKDROP !== '1') assert.ok(row.backdropPixels.some(c => Number(c.opacity) > .1 && c.bright > 50), 'custom background is painted, not black, on every load');
       const skin = pass === 'fresh' || pass === 'reload2' ? 'nebula' : 'sepia';
       await p.evaluate(id => WosSkin.set(id), skin);
       await p.waitForFunction(() => !WosExperience.state.busy && WosSkinHost.layoutState.active);
       row.fault = await p.evaluate(() => {
        const scene = document.querySelector('.aad'); const before = WosSkinHost.layoutState;
        globalThis.__qaLayoutFault = true;
        for (let i = 0; i < 12; i++) WosSkinHost.rendered('thread', 'qa-thread');
        // Keep the hook persistently failing through real app/chat navigation below.
        const visible = selector => {
         const n = document.querySelector(selector); if (!n) return false;
         const box = n.getBoundingClientRect(), style = getComputedStyle(n);
         return box.width > 0 && box.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        };
        return { before, after: WosSkinHost.layoutState, sameScene: scene === document.querySelector('.aad'), choice: localStorage.getItem('wos.desktop-view.v1'), diagnostic: JSON.parse(localStorage.getItem('wos.layout-fault.v1')), backdrop: WosSkin.desktopBackdrop,
         sidebarVisible: visible('.aad-side'), classicMenuVisible: visible('#wsList') };
       });
       assert.match(row.fault.diagnostic.stack, /QA synthetic layout callback fault/, 'fault reached the real guarded callback on both source revisions');
       assert.equal(row.fault.after.active, true, 'callback threshold never unloads the owner layout');
       assert.equal(row.fault.after.disabled, false); assert.equal(row.fault.sameScene, true);
       assert.equal(row.fault.choice, 'ai-apps'); assert.equal(row.fault.backdrop.id, 'custom');
       assert.match(row.fault.diagnostic.stack, /QA synthetic layout callback fault/);
       await p.locator('.aad-vtab[data-app="qa-notes"]').click();
       await p.locator('.aad-ptools [data-tool="search"]').waitFor({ state: 'visible' });
       const notes = p.frames().find(f => new URL(f.url()).pathname === '/qa-boot-apps/notes/');
       await notes.evaluate(() => fixturePulse());
       await p.locator('.aad-ptools [data-tool="search"]').click();
       await notes.waitForFunction(() => fixtureCalls.some(c => c.id === 'search'));
       await p.locator('.aad-scroll .aad-row').first().click();
       await p.locator('.ch-compose textarea').first().fill('Synthetic retained draft after callback failures');
       assert.equal(await p.locator('#wsList').isVisible(), false);
       assert.equal(await p.locator('.aad-side').isVisible(), true);
       row.checks.push('12 real layout callback errors; persistently armed during dock/app/SDK search/Chats navigation; exact scene retained; custom backdrop; live skin ' + skin);
      }
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
