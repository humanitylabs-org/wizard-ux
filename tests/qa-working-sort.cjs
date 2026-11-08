 'use strict';
// Synthetic origins only. UI preference writes are fixture-local; other writes are aborted.
const assert = require('node:assert/strict');
const { chromium } = require('../tools/qa-playwright.cjs');
const { ownerRead } = require('../tools/qa-desktop-frame-fixture.cjs');
const fs = require('node:fs'), path = require('node:path');
const repo = path.resolve(__dirname, '..'), origin = 'https://working-sort.test', prefix = '/wizard-os-home/';
const out = process.env.QA_OUT || 'working-sort-evidence'; fs.mkdirSync(out, { recursive: true });
const now = Date.now();
<<<<<<< HEAD
const rows = [['z', 'Zulu', 1000], ['a', 'alpha', 3000], ['b', 'Beta', 2000]].map(([id, title, age]) => ({ id, title, runtime: 'direct', status: 'running', updated_at: new Date(now - age).toISOString(), updatedAt: new Date(now - age).toISOString(), message_count: 2, messageCount: 2 }));
=======
const rows = [['z', 'Zulu', 1000], ['a', 'alpha', 3000], ['b', 'Beta', 2000]].map(([id, title, age]) => ({ id, title, runtime: 'direct', status: 'running', updated_at: new Date(now - age).toISOString(), updatedAt: new Date(now - age).toISOString(), message_count: 2, messageCount: 2 }))
  // Synthetic finished threads so Ready (and its order bar) sits beside Working for the side-by-side comparison.
  .concat([['r1', 'Synthetic finished report', 60000], ['r2', 'Synthetic test note', 120000]].map(([id, title, age]) => ({ id, title, runtime: 'direct', status: 'completed', updated_at: new Date(now - age).toISOString(), updatedAt: new Date(now - age).toISOString(), message_count: 2, messageCount: 2 })));
const WORKING = new Set(['z', 'a', 'b']);
>>>>>>> origin/main
const mime = f => f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : f.endsWith('.svg') ? 'image/svg+xml' : f.endsWith('.json') ? 'application/json' : 'text/html';
(async () => {
 const browser = await chromium.launch(); const report = { cases: [], screenshots: [], controlInventory: [] }, failures = [];
 try {
<<<<<<< HEAD
  for (const skin of ['nebula', 'sepia']) {
   const prefs = { migrations: { 'launcher-seed-v1': true }, readyOrder: 'oldest', chatLayout: 'status' };
   const writes = [], aborted = [], errors = [];
   async function pageFor(surface) {
    const phone = surface !== 'desktop';
    const c = await browser.newContext({ viewport: phone ? { width: 412, height: 915 } : { width: 1440, height: 960 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block' });
=======
  for (const skin of (process.env.QA_SKINS || 'nebula,grove').split(',')) {
   const prefs = { migrations: { 'launcher-seed-v1': true }, readyOrder: 'oldest', chatLayout: 'status' };
   const writes = [], aborted = [], errors = [], delay = { newest: false };
   async function pageFor(surface) {
    const phone = surface !== 'desktop' && surface !== 'classic';
    const c = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 960 }, isMobile: phone, hasTouch: phone, serviceWorkers: 'block' });
>>>>>>> origin/main
    await c.routeWebSocket('**/*', w => w.close());
    await c.addInitScript(({ skin, surface }) => {
     if (window !== top) return;
     const seed = { 'wos.shell': surface === 'desktop' ? 'desktop' : 'phone', 'wos.coached': 'true', 'wos.tour.v1': 'true', 'wos.welcome.v1': 'done', 'wos.skin': skin };
     if (surface === 'desktop') seed['wos.desktop-view.v1'] = 'ai-apps';
<<<<<<< HEAD
=======
     if (surface === 'classic') { seed['wos.shell'] = 'desktop'; seed['wos.desktop-view.v1'] = 'classic'; }
>>>>>>> origin/main
     if (surface === 'drawer') seed['wos.mobile-view.v1'] = 'ai-apps';
     for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
    }, { skin, surface });
    await c.route('**/*', async r => {
     const q = r.request(), u = new URL(q.url());
     if (u.origin !== origin) return r.abort();
     if (!['GET','HEAD'].includes(q.method())) {
<<<<<<< HEAD
      if (u.pathname === '/wizard/v1/ui-preferences' && q.method() === 'PUT') { const body = q.postDataJSON(); assert.deepEqual(Object.keys(body), ['workingOrder']); if (body.workingOrder === 'newest' && !writes.length) await new Promise(resolve => setTimeout(resolve, 5000)); Object.assign(prefs, body); writes.push(body); return r.fulfill({ json: { ...prefs } }); }
=======
      if (u.pathname === '/wizard/v1/ui-preferences' && q.method() === 'PUT') { const body = q.postDataJSON(); assert.deepEqual(Object.keys(body), ['workingOrder']); if (body.workingOrder === 'newest' && (!writes.length || delay.newest)) { delay.newest = false; await new Promise(resolve => setTimeout(resolve, 5000)); } Object.assign(prefs, body); writes.push(body); return r.fulfill({ json: { ...prefs } }); }
>>>>>>> origin/main
      aborted.push({ method: q.method(), path: u.pathname }); return r.abort();
     }
     if (u.pathname.startsWith(prefix)) {
      const file = decodeURIComponent(u.pathname.slice(prefix.length) || 'index.html'), abs = path.resolve(repo,'web',file);
      if (!abs.startsWith(path.join(repo,'web') + path.sep)) return r.abort();
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return r.fulfill({ body: fs.readFileSync(abs), contentType: mime(file) });
      return r.fulfill({ status: 404, body: 'Missing synthetic asset' });
     }
     if (u.pathname === '/wizard/v1/ui-preferences') return r.fulfill({ json: { ...prefs } });
     if (u.pathname === '/wizard/hermes/api/sessions') return r.fulfill({ json: { data: rows, has_more: false } });
     if (/\/sessions\/[^/]+\/messages/.test(u.pathname)) return r.fulfill({ json: { messages: [{ role: 'user', content: 'Synthetic work', timestamp: now/1000-10 },{ role: 'assistant', content: 'Synthetic progress', timestamp: now/1000-5 }] } });
     const id = /\/sessions\/([^/]+)$/.exec(u.pathname)?.[1];
     if (id && rows.some(r => r.id === id)) return r.fulfill({ json: { session: rows.find(r => r.id === id) } });
     return r.fulfill({ json: ownerRead(u.pathname) });
    });
    const p = await c.newPage(); p.on('pageerror', e => errors.push(e.message));
    await p.goto(origin+prefix+(phone ? 'index.html' : 'desktop.html'));
<<<<<<< HEAD
=======
    await p.evaluate(() => document.getElementById('wosWelcome')?.remove());
>>>>>>> origin/main
    await p.waitForFunction(() => (window.__wux || window.__wos) && !window.WosWelcome?.active && !window.WosExperience?.state?.busy);
    return { c, p };
   }
   async function persist(p, act) { await Promise.all([p.waitForResponse(r => r.url().endsWith('/wizard/v1/ui-preferences') && r.request().method() === 'PUT'), act()]); }
   async function shot(p, name) { const file = path.join(out, skin+'-'+name+'.png'); await p.screenshot({ path:file, animations:'disabled' }); report.screenshots.push(file); }
<<<<<<< HEAD
=======
   // Stock Chats list (phone and desktop Classic): Working's control is Ready's order bar, never a native select.
   async function stockBar(p, win, name) {
    for (const k of ['working', 'ready']) {
     const hd = win.locator(`section[data-sec="${k}"] [data-sectoggle="${k}"]`);
     if (await hd.count() && await hd.getAttribute('aria-expanded') !== 'true') await hd.click();
    }
    await win.locator('section[data-sec="working"] .ch-row').nth(2).waitFor();
    assert.equal(await p.locator('select[data-working-order], .ch-working-sort').count(), 0, name + ': no native Sort Working select');
    assert.equal(await p.getByText('Sort Working', { exact: false }).count(), 0, name + ': no Sort Working label');
    const bar = win.locator('section[data-sec="working"] .ch-rdy-bar[aria-label="Order Working"]');
    const rbar = win.locator('section[data-sec="ready"] .ch-rdy-bar[aria-label="Order Ready"]');
    await bar.waitFor(); await rbar.waitFor();
    const controls = await p.locator('.ch-rdy-bar[aria-label="Order Working"]').evaluateAll(ns => ns.map(n => ({ list: n.closest('[data-chats]')?.dataset.chats, section: n.closest('section')?.dataset.sec })));
    assert.equal(controls.length, 1, name + ': one Working bar'); report.controlInventory.push({ skin, surface: name, controls });
    const state = () => bar.locator('button').evaluateAll(ns => ns.map(n => [n.dataset.workorder, n.getAttribute('aria-pressed'), n.classList.contains('on'), n.textContent]));
    const listIds = () => win.locator('section[data-sec="working"] [data-chopen]').evaluateAll(ns => ns.map(n => n.dataset.chopen));
    assert.deepEqual(await state(), [['alphabetical', 'true', true, 'A to Z'], ['newest', 'false', false, 'Newest']], name + ' A to Z');
    assert.deepEqual(await listIds(), ['a', 'b', 'z']);
    // Same look as Ready: compare computed pill styles (pressed with pressed, idle with idle).
    const look = sel => win.locator(sel).first().evaluate(n => { const c = getComputedStyle(n), r = n.getBoundingClientRect(); return { h: Math.round(r.height), fs: c.fontSize, fw: c.fontWeight, pad: c.padding, rad: c.borderRadius, col: c.color, bg: c.backgroundColor, bc: c.borderTopColor, gap: getComputedStyle(n.parentElement).gap }; });
    const rOn = await look('section[data-sec="ready"] .ch-rdy-bar button.on'), wOn = await look('section[data-sec="working"] .ch-rdy-bar button.on');
    const rOff = await look('section[data-sec="ready"] .ch-rdy-bar button:not(.on)'), wOff = await look('section[data-sec="working"] .ch-rdy-bar button:not(.on)');
    assert.deepEqual(wOn, rOn, name + ': pressed pill matches Ready'); assert.deepEqual(wOff, rOff, name + ': idle pill matches Ready');
    if (name === 'phone') assert.ok(wOn.h >= 28, 'phone touch target at least Ready\'s 28px');
    await shot(p, name + '-ready-working');
    // Tap Newest with a 5 s delayed preference write: the order and pressed pill change on the tap's frame.
    delay.newest = true;
    const sameFrame = await win.locator('section[data-sec="working"] [data-workorder="newest"]').evaluate(b => {
     const sec = b.closest('[data-chats]'); b.click();
     const ids = [...sec.querySelectorAll('section[data-sec="working"] [data-chopen]')].map(n => n.dataset.chopen);
     const on = [...sec.querySelectorAll('section[data-sec="working"] [data-workorder]')].map(n => [n.dataset.workorder, n.getAttribute('aria-pressed'), n.textContent]);
     return { ids, on, saved: localStorage.getItem('wos.chats.workingOrder.v1') };
    });
    assert.deepEqual(sameFrame, { ids: ['z', 'b', 'a'], on: [['alphabetical', 'false', 'A to Z'], ['newest', 'true', 'Newest']], saved: 'newest' }, name + ': same-frame Newest');
    await p.waitForResponse(r => r.url().endsWith('/wizard/v1/ui-preferences') && r.request().method() === 'PUT', { timeout: 9000 });
    assert.equal(prefs.workingOrder, 'newest');
    // Real tap on Newest again flips to Oldest (label shows Oldest).
    const phoneLike = name === 'phone';
    const tapNewest = () => phoneLike ? win.locator('section[data-sec="working"] [data-workorder="newest"]').tap() : win.locator('section[data-sec="working"] [data-workorder="newest"]').click();
    await persist(p, tapNewest);
    assert.deepEqual(await state(), [['alphabetical', 'false', false, 'A to Z'], ['newest', 'true', true, 'Oldest']], name + ' Oldest');
    assert.deepEqual(await listIds(), ['a', 'b', 'z']); assert.equal(prefs.workingOrder, 'oldest');
    await shot(p, name + '-working-oldest');
    await persist(p, tapNewest);
    assert.deepEqual(await state(), [['alphabetical', 'false', false, 'A to Z'], ['newest', 'true', true, 'Newest']], name + ' Oldest back to Newest');
    assert.deepEqual(await listIds(), ['z', 'b', 'a']);
    const tapAz = () => phoneLike ? bar.locator('[data-workorder="alphabetical"]').tap() : bar.locator('[data-workorder="alphabetical"]').click();
    await persist(p, tapAz);
    assert.deepEqual(await state(), [['alphabetical', 'true', true, 'A to Z'], ['newest', 'false', false, 'Newest']], name + ' back to A to Z');
    assert.deepEqual(await listIds(), ['a', 'b', 'z']); assert.equal(prefs.workingOrder, 'alphabetical');
    assert.equal(prefs.readyOrder, 'oldest', 'Ready order untouched');
    assert.equal(await rbar.locator('button.on').textContent(), 'Oldest', 'Ready bar unchanged');
    await persist(p, tapNewest); await persist(p, tapNewest); // leave Oldest for the Settings/drawer read-back below
    assert.equal(prefs.workingOrder, 'oldest');
   }
>>>>>>> origin/main
   try {
    const { c, p } = await pageFor('desktop');
    await p.locator('.aad-working-orderb').waitFor();
    await p.locator('.aad-sec[data-sec="working"]').click();
    const ids = () => p.locator('#aad-sec-working .aad-rw').evaluateAll(ns => ns.map(n=>n.dataset.sid));
    await p.waitForFunction(() => document.querySelectorAll('#aad-sec-working .aad-rw').length === 3);
<<<<<<< HEAD
    assert.deepEqual(await ids(), ['a','b','z']);
=======
    assert.deepEqual((await ids()).filter(id => WORKING.has(id)), ['a','b','z']);
>>>>>>> origin/main
    await p.locator('.aad-working-orderb').click();
    await p.getByRole('menu',{name:'Sort Working',exact:true}).waitFor();
    await shot(p,'desktop-menu');
    await p.getByRole('menuitemradio',{name:'Newest first',exact:true}).click();
    assert.deepEqual(await ids(), ['z','b','a'], 're-sorts before the delayed preference write returns');
    assert.equal(await p.evaluate(() => localStorage.getItem('wos.chats.workingOrder.v1')), 'newest');
    await p.waitForResponse(r => r.url().endsWith('/wizard/v1/ui-preferences') && r.request().method() === 'PUT');
    assert.equal(prefs.workingOrder,'newest');
    assert.equal(prefs.readyOrder,'oldest');
    await p.locator('.aad-working-orderb').click();
    await persist(p, () => p.getByRole('menuitemradio',{name:'Oldest first',exact:true}).click());
    assert.deepEqual(await ids(), ['a','b','z']);
    await p.locator('.aad-working-orderb').click(); await p.mouse.click(1000,600);
    assert.equal(await p.locator('.aad-sortmenu').count(),0);
    await p.locator('.aad-working-orderb').click(); await p.keyboard.press('Escape');
    assert.equal(await p.locator('.aad-sortmenu').count(),0);
    await p.evaluate(() => __wux.openSettings('working-order'));
    const setting = p.locator('[data-settings-working-order]'); await setting.waitFor(); assert.equal(await setting.inputValue(),'oldest');
    await persist(p, () => setting.selectOption('alphabetical')); await p.waitForFunction(() => WizLive.workingOrder()==='alphabetical');
    assert.equal(prefs.workingOrder,'alphabetical');
    await shot(p,'desktop-settings'); await c.close();
    const { c: pc, p: phone } = await pageFor('phone');
    // freshLayout already mounts Chats. openWin creates a second legitimate desk,
    // not a duplicate repaint: use the original window and scope its retained DOM.
    const phoneWin = await phone.evaluate(() => {
     const chats = Object.values(__wos.wins).filter(w => w.app === 'chats');
     if (chats.length !== 1) throw Error(`Expected the initial Chats window, found ${chats.length}`);
     const id = chats[0].id, desk = __wos.desks.findIndex(d => d.wins.includes(id));
     __wos.goDesk(desk, true); __wos.focusWin(id); return id;
    });
    const phoneWindow = phone.locator(`.win[data-win="${phoneWin}"]`);
<<<<<<< HEAD
    const select = phoneWindow.locator('[data-working-order]'); await select.waitFor();
    const controls = await phone.locator('[data-working-order]').evaluateAll(ns => ns.map(n => ({ win: n.closest('.win')?.dataset.win, section: n.closest('section')?.dataset.sec })));
    assert.deepEqual(controls, [{ win: phoneWin, section: 'working' }], 'one Working control in the initial Chats window');
    report.controlInventory.push({ skin, surface: 'phone-working-controls', controls });
    assert.equal(await select.inputValue(),'alphabetical');
    const hd = phoneWindow.locator('section[data-sec="working"] [data-sectoggle="working"]');
    if (await hd.count() && await hd.getAttribute('aria-expanded') !== 'true') await hd.click();
    await phoneWindow.locator('section[data-sec="working"] .ch-row').nth(2).waitFor();
    const phoneIds = async () => {
     assert.equal(await select.count(), 1, 'repaint must not duplicate Working controls');
     return phoneWindow.locator('section[data-sec="working"] [data-chopen]').evaluateAll(ns=>ns.map(n=>n.dataset.chopen));
    };
    assert.deepEqual(await phoneIds(),['a','b','z']);
    await persist(phone, () => select.selectOption('newest')); assert.deepEqual(await phoneIds(),['z','b','a']);
    await persist(phone, () => select.selectOption('oldest')); assert.deepEqual(await phoneIds(),['a','b','z']);
    await shot(phone,'phone-working');
=======
    await stockBar(phone, phoneWindow, 'phone');
>>>>>>> origin/main
    await phone.evaluate(() => __wos.openSettings('working-order'));
    await phone.locator('[data-settings-working-order]').waitFor();
    assert.equal(await phone.locator('[data-settings-working-order]').inputValue(),'oldest');
    await shot(phone,'phone-settings');
    await pc.close();
<<<<<<< HEAD
    const { c: dc, p: drawer } = await pageFor('drawer');
    await drawer.locator('.aa-menu').waitFor(); await drawer.locator('.aa-menu').click();
    const drawerSort = drawer.locator('.aa-sech select[aria-label="Sort Working"]');
    await drawerSort.waitFor(); assert.equal(await drawerSort.inputValue(), 'oldest');
    const drawerHead = drawer.locator('.aa-sec[data-sec="working"]');
    if (await drawerHead.getAttribute('aria-expanded') !== 'true') await drawerHead.click();
    await persist(drawer, () => drawerSort.selectOption('alphabetical'));
    assert.deepEqual(await drawer.locator('#aa-sec-working [data-sid]').evaluateAll(ns => ns.map(n => n.dataset.sid)), ['a','b','z']);
    await shot(drawer,'phone-drawer'); await dc.close();
    assert.equal(prefs.readyOrder,'oldest'); assert.ok(writes.length>=5);
=======
    const { c: cc, p: classic } = await pageFor('classic');
    await classic.evaluate(() => { if (!document.querySelector('[data-chats] section[data-sec="working"]')) __wux.openChatsList?.(); });
    await classic.locator('[data-chats] section[data-sec="working"]').first().waitFor();
    const classicWin = await classic.evaluate(() => { const n = document.querySelectorAll('[data-chats]'); const withList = [...n].filter(x => x.querySelector('section[data-sec="working"]')); if (withList.length !== 1) throw Error(`Expected one Classic Chats list, found ${withList.length}`); return withList[0].dataset.chats; });
    await persist(classic, () => classic.evaluate(() => WizLive.setWorkingOrder('alphabetical')));
    await stockBar(classic, classic.locator(`[data-chats="${classicWin}"]`), 'desktop-classic');
    await cc.close();
    const { c: dc, p: drawer } = await pageFor('drawer');
    await drawer.locator('.aa-menu').waitFor(); await drawer.locator('.aa-menu').click();
    const drawerSort = drawer.locator('.aa-sech select[aria-label="Sort Working"]');
    await drawerSort.waitFor(); assert.equal(await drawerSort.inputValue(), 'oldest', 'AI apps drawer control unchanged, reads the shared value');
    const drawerHead = drawer.locator('.aa-sec[data-sec="working"]');
    if (await drawerHead.getAttribute('aria-expanded') !== 'true') await drawerHead.click();
    await persist(drawer, () => drawerSort.selectOption('alphabetical'));
    assert.deepEqual((await drawer.locator('#aa-sec-working [data-sid]').evaluateAll(ns => ns.map(n => n.dataset.sid))).filter(id => WORKING.has(id)), ['a','b','z']);
    await shot(drawer,'phone-drawer'); await dc.close();
    assert.equal(prefs.readyOrder,'oldest'); assert.ok(writes.length>=8);
>>>>>>> origin/main
    assert.equal(aborted.filter(r=>r.path.includes('/v1/runs')).length,0);
    assert.deepEqual(errors,[]);
    report.cases.push({skin,passed:true,writes,aborted});
   } catch (e) { failures.push(skin+': '+e.stack); report.cases.push({skin,passed:false,error:e.stack,writes,aborted,errors}); }
  }
 } finally { await browser.close(); fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)); }
 if (failures.length) throw Error(failures.join('\n'));
 console.log(JSON.stringify(report,null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
