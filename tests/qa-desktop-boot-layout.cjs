'use strict';
// Real shell, synthetic origin only. Never contacts an owner API or sends.
// A desktop refresh decides its view before first paint: with the default view Classic's chat list is never attached
// or visible from document start through layout ready (sampled on every mutation and animation frame); Classic Desks,
// when chosen, still boots with its list.
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const origin = 'https://boot.test', prefix = '/wizard-os-home/';
const out = process.env.QA_OUT || 'boot-layout-evidence'; fs.mkdirSync(out, { recursive: true });
let currentPage;
(async () => {
 const browser = await chromium.launch();
 try {
  for (const mode of ['restored-chat', 'default', 'reload', 'classic', 'stale-ai-apps', 'stale-classic']) {
   const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, serviceWorkers: 'block' });
   await context.routeWebSocket('**/*', ws => ws.close());
   await context.addInitScript(({ mode }) => {
    if (sessionStorage.getItem('qa.seeded') !== '1') {   // seed once; a reload keeps whatever the shell itself saved
     sessionStorage.setItem('qa.seeded', '1');
     localStorage.setItem('wos.shell', 'desktop');
     for (const [k, v] of Object.entries({ 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': 'nebula' })) localStorage.setItem(k, v);
     if (mode === 'restored-chat') {
     localStorage.setItem('wos.desktop-view.v1', 'ai-apps');
     localStorage.setItem('wux.desk.wins', JSON.stringify({ restored: { id: 'restored', app: 'chats', thread: 'qa-thread' } }));
     localStorage.setItem('wux.desk.ws', JSON.stringify([{ id: 'drestored', wins: ['restored'], focus: 'restored', mono: false }]));
     localStorage.setItem('wux.desk.cur', '0');
     localStorage.setItem('wux.desk.homeOpen', 'false');
    }
    if (mode === 'classic' || mode === 'stale-classic') localStorage.setItem('wos.desktop-view.v1', 'classic');
     if (mode === 'stale-classic') localStorage.setItem('wos.layout', 'ai-apps');
     if (mode === 'stale-ai-apps') { localStorage.setItem('wos.desktop-view.v1', 'ai-apps'); localStorage.setItem('wos.layout', 'orb'); }
    }
    // Sampler runs from document start: every DOM mutation, every frame. A legacy list counts if it is attached and
    // drawn: display, visibility, the opacity of it and all its ancestors, and a real box.
    window.__legacy = { samples: 0, hits: [], rows: 0, phases: [] };
    const drawn = n => {
     const r = n.getBoundingClientRect(); if (r.width <= 0 || r.height <= 0) return false;
     let o = 1; for (let e = n; e; e = e.parentElement) { const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden') return false; o *= parseFloat(s.opacity); }
     return o > 0.01;
    };
    const sample = why => {
     if (!document.documentElement) return; __legacy.samples++;
     for (const n of document.querySelectorAll('.pane-list,.pane-split,.pane-empty,.ch-list')) if (drawn(n)) __legacy.hits.push({ why, cls: n.className, t: Math.round(performance.now()) });
     __legacy.rows = Math.max(__legacy.rows, document.querySelectorAll('.ch-row').length);
     const ph = document.readyState + (document.documentElement.dataset.layout ? '+' + document.documentElement.dataset.layout : '');
     if (__legacy.phases.at(-1) !== ph) __legacy.phases.push(ph);
    };
    new MutationObserver(() => sample('mutation')).observe(document, { subtree: true, childList: true, attributes: true });
    const frame = () => { sample('frame'); requestAnimationFrame(frame); }; requestAnimationFrame(frame);
    document.addEventListener('DOMContentLoaded', () => sample('DOMContentLoaded'));
   }, { mode });
   const errors = [], writes = [], runs = [];
   await context.route('**/*', async r => {
    const q = r.request(), u = new URL(q.url());
    if (u.origin !== origin) return r.abort();
    if (u.pathname.includes('/v1/runs')) { runs.push(u.pathname); return r.abort(); }
    if (!['GET', 'HEAD'].includes(q.method())) { writes.push(q.method() + ' ' + u.pathname); return r.fulfill({ status: 403, json: { error: 'No writes in QA' } }); }
    if (u.pathname === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: [{ id: 'qa-thread', title: 'Synthetic chat', status: 'completed', updatedAt: '2026-11-05T00:00:00Z' }], has_more: false } });
    // An established owner has already completed the launcher migration. Keep the zero-write assertion strict:
    // a missing migration in the generic fixture would trigger an unrelated bootstrap seed POST.
    if (u.pathname === '/wizard/v1/ui-preferences') return r.fulfill({ json: { migrations: { 'launcher-seed-v1': true } } });
    if (u.pathname.startsWith('/wizard/')) return r.fulfill({ json: ownerRead(u.pathname) });
    if (u.pathname.startsWith(prefix)) {
     const root = path.resolve(__dirname, '../web'), file = path.resolve(root, u.pathname.slice(prefix.length) || 'index.html');
     if (file.startsWith(root + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) return r.fulfill({ path: file });
    }
    return r.fulfill({ json: { apps: [], agents: [], sessions: [], connected: false } });
   });
   const p = currentPage = await context.newPage(); p.on('pageerror', e => { errors.push(e.message); console.error('PAGEERROR', e.stack); }); p.on('console', m => { if (['warning', 'error'].includes(m.type())) console.error('BROWSER', m.type(), m.text()); });
   await p.goto(origin + prefix + 'desktop.html');
   if (mode === 'reload') {   // the shell saved the view it wore; a refresh must decide it again before paint
    await p.waitForFunction(() => localStorage.getItem('wos.desktop-view.v1') === 'ai-apps' && document.documentElement.dataset.aiApps === 'desktop');
    await p.reload();
   }
   if (mode === 'classic' || mode === 'stale-classic') {
    await p.waitForFunction(() => window.__wux && !WosExperience.state.busy);
    await p.waitForFunction(() => { const n = document.querySelector('.pane-list'); return n && getComputedStyle(n).display !== 'none' && n.getBoundingClientRect().width > 0; }, null, { timeout: 15000 });
    const root = await p.evaluate(() => ({ layout: document.documentElement.dataset.layout || null, owner: document.documentElement.dataset.chatsOwner || null, booting: document.documentElement.dataset.layoutBooting ?? null }));
    assert.deepEqual(root, { layout: null, owner: null, booting: null }, 'Classic Desks boots normally: no layout, nothing claimed');
    await p.screenshot({ path: path.join(out, 'classic.png') });
    console.log('classic ok', { writes, runs, errors });
   } else {
    await p.waitForFunction(() => window.__wux && document.documentElement.dataset.aiApps === 'desktop' && !WosExperience.state.busy && !document.documentElement.hasAttribute('data-layout-booting') && document.querySelector('.ch-compose'), null, { timeout: 20000 });
    for (let i = 0; i < 30; i++) await p.evaluate(() => new Promise(requestAnimationFrame));
    const res = await p.evaluate(() => ({ ...__legacy, layout: document.documentElement.dataset.layout, owner: document.documentElement.dataset.chatsOwner || null, bodyOpacity: getComputedStyle(document.body).opacity }));
    await p.screenshot({ path: path.join(out, mode + '.png') });
    console.log(mode, JSON.stringify({ samples: res.samples, phases: res.phases, rows: res.rows, hits: res.hits.slice(0, 3) }));
    assert.ok(res.samples > 30, 'sampler ran from document start through layout ready');
    const at = res.phases.indexOf('loading+ai-apps');
    assert.ok(at >= 0, 'AI apps was worn while the document was still loading (before DOMContentLoaded): ' + res.phases.join(','));
    assert.ok(res.phases.slice(at).every(x => x.endsWith('+ai-apps')), 'Classic never came back into view: ' + res.phases.join(','));
    assert.equal(res.layout, 'ai-apps'); assert.equal(res.owner, 'layout'); assert.equal(res.bodyOpacity, '1', 'veil lifted when the layout applied');
    assert.equal(res.rows, 0, 'Classic list rows were never attached');
    assert.deepEqual(res.hits, [], 'Classic chats list never drawn from DOMContentLoaded through layout ready');
   }
   assert.deepEqual([writes, runs], [[], []], 'no writes, no sends');
   await context.close();
  }
  console.log('ok');
 } catch (e) {
  try { await currentPage.screenshot({ path: path.join(out, 'failure.png') }); fs.writeFileSync(path.join(out, 'failure.html'), await currentPage.content()); } catch (_) {}
  throw e;
 } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
