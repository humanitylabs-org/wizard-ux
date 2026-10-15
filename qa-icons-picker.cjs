// Thales-only browser acceptance: real read APIs, all external mutations refused.
// PLAYWRIGHT_PATH, QA_OUT, QA_CHROME; node qa-icons-picker.cjs <read-only-origin>
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const fs = require('fs'), path = require('path'), os = require('os');
if (!os.hostname().toLowerCase().includes('thales') || !process.env.QA_OUT || !process.env.QA_CHROME) throw Error('Run on Thales with QA_OUT on its external work volume and QA_CHROME configured');
const BASE = process.argv[2], OUT = process.env.QA_OUT;
fs.mkdirSync(OUT, { recursive: true });
const checks = [], errors = [], writes = [], reads = []; let browser;
const nap = ms => new Promise(r => setTimeout(r, ms));
function ok(pass, name, detail) { checks.push({ pass: !!pass, name, detail }); console.log(pass ? 'PASS' : 'FAIL', name, detail === undefined ? '' : JSON.stringify(detail)); }
async function shot(p, name) { await nap(450); await p.screenshot({ path: path.join(OUT, name + '.png') }); }
async function boot(phone = false) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 }, hasTouch: phone, isMobile: phone, userAgent: phone ? 'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/141.0.0.0 Mobile Safari/537.36' : 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36' });
  await ctx.route('**/*', r => { const q = r.request(); if (!['GET', 'HEAD'].includes(q.method())) { writes.push({ method: q.method(), url: q.url() }); return r.fulfill({ status: 403, body: '{}' }); } if (/\/wizard\//.test(q.url())) reads.push(q.url()); return r.continue(); });
  await ctx.addInitScript(() => { localStorage.setItem('wos.coached', 'true'); localStorage.setItem('wos.tour.done', '1'); });
  const p = await ctx.newPage(); p.on('pageerror', e => errors.push(String(e)));
  await p.goto(BASE); await p.waitForFunction(m => m ? window.__wos?.live?.ok : window.__wux?.live?.ok, phone, { timeout: 60000 });
  await p.evaluate(() => WosAgents.load()); await nap(400); return { p, ctx };
}
async function visible(p) { return p.locator('#palette').isVisible(); }
async function focused(p) { return p.evaluate(() => document.activeElement?.id === 'palInput'); }
async function close(p) { if (await visible(p)) await p.keyboard.press('Escape'); }
(async () => {
  browser = await chromium.launch({ executablePath: process.env.QA_CHROME });
  const { p, ctx } = await boot();
  ok(!await visible(p), 'restore/initial boot never opens picker');
  ok(await p.locator('.ch-row').count() > 0, 'real Chats rows loaded');
  // Keep the actual mounted composer and its local draft through all picker navigation.
  await p.evaluate(() => __wux.newChat());
  await nap(100); // Let newChat's existing delayed composer focus finish before seeding a retained draft.
  const wid = await p.evaluate(() => __wux.ws[__wux.cur].focus);
  const ta = p.locator(`.win[data-win="${wid}"] textarea`).last();
  await ta.fill('QA retained picker draft — never send');
  await p.evaluate(() => { window.__qaComposer = document.activeElement; window.__qaWin = document.querySelector('.win.focus'); });
  await p.keyboard.press('Control+o');
  ok(await visible(p) && await focused(p), 'Ctrl+O opens app selector with search focus');
  if (await visible(p)) {
    await p.fill('#palInput', 'Private Agent');
    ok((await p.locator('#palList').innerText()).includes('Private Agent'), 'app selector searches private agent');
    await p.keyboard.press('Escape');
    const restored = await p.evaluate(() => ({ value:document.querySelector(`.win[data-win="${__wux.ws[0].focus}"] textarea`)?.value, active:document.activeElement?.id, focusSame:document.activeElement === __qaComposer, nodeSame:document.querySelector('.win.focus') === __qaWin, capturedConnected:__qaComposer?.isConnected }));
    restored.value = await ta.inputValue();
    ok(restored.value === 'QA retained picker draft — never send' && restored.focusSame && restored.nodeSame, 'Escape restores exact composer and preserves draft/node', restored);
    const churn=[];
    for (let i=0;i<20;i++) {
      await p.keyboard.press('Control+o'); await p.fill('#palInput',i%2?'Agents':'Chats'); await p.keyboard.press('Escape');
      churn.push(await p.evaluate(id=>{ const fields=document.querySelectorAll(`.win[data-win="${id}"] textarea`),field=fields[fields.length-1]; return {draft:field?.value==='QA retained picker draft — never send',focus:document.activeElement===field,original:document.activeElement===__qaComposer,connected:__qaComposer.isConnected,active:document.activeElement?.tagName}; },wid));
    }
    ok(churn.every(x=>x.draft&&x.focus), '20 repeated search/open/Escape cycles retain draft and composer focus', {passes:churn.filter(x=>x.draft&&x.focus).length,cycles:churn.length,details:churn});
  }
  await p.keyboard.press('Meta+o'); ok(await visible(p) && await focused(p), 'Cmd+O equivalent opens selector'); await close(p);
  // Capture-phase event proves prevention without asking the browser to show a native file dialog.
  const prevented = await p.evaluate(() => { const e = new KeyboardEvent('keydown', { key: 'o', code: 'KeyO', ctrlKey: true, bubbles: true, cancelable: true }); document.dispatchEvent(e); return e.defaultPrevented; });
  ok(prevented, 'Open shortcut prevents browser default'); await close(p);
  const before = await p.evaluate(() => __wux.ws.length);
  await p.click('[data-newdesk]');
  ok(await visible(p) && await focused(p), 'new-desktop plus auto-opens focused picker');
  ok(await p.evaluate(n => __wux.ws.length === n + 1 && !__wux.ws[__wux.cur].wins.length, before), 'new desk is empty and added once');
  if (await visible(p)) {
    const geom = await p.locator('#palList .ic.sgt').first().evaluate(e => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, radius: getComputedStyle(e).borderRadius }; });
    ok(geom.w >= 48 && Math.abs(geom.w - geom.h) < 1, 'picker uses large square app tiles', geom);
    ok((await p.locator('#palList').innerText()).includes('Private Agent'), 'empty app selector includes private agent');
    ok(await p.locator('#palList .nm').filter({hasText:/^Agents$/}).count() === 0, 'app selector preserves management separation');
    const sel = () => p.evaluate(() => document.querySelector('#palList .sel')?.dataset.i);
    const a = await sel(); await p.keyboard.press('ArrowRight'); const b = await sel(); await p.keyboard.press('ArrowDown'); const c = await sel(); await p.keyboard.press('ArrowUp'); const d = await sel(); await p.keyboard.press('ArrowLeft'); const e = await sel();
    ok(a !== b && b !== c && b === d && a === e, 'four-arrow grid navigation is spatial and reversible', { a, b, c, d, e });
    await shot(p, 'desktop-picker');
    const last = p.locator('#palList [data-i]').last();
    await last.focus(); await p.keyboard.press('Tab');
    ok(await focused(p), 'Tab from last result cycles to search');
    await p.keyboard.press('Shift+Tab');
    ok(await focused(p), 'reverse Tab remains on the combobox-only tab stop');
    await p.locator('#palInput').focus();
    ok(await p.locator('#palInput').getAttribute('aria-label')?.then(Boolean), 'search combobox has explicit accessible label');
    ok(await p.evaluate(() => { const e=document.querySelector('#palInput'), o=document.getElementById(e.getAttribute('aria-activedescendant')); return o?.getAttribute('aria-selected') === 'true'; }), 'search exposes selected result to accessibility tree');
    await p.fill('#palInput','nonexistent-app-qa-xyz');
    ok(await p.locator('#palList [data-i]').count() === 0 && await p.locator('.pal-empty').isVisible(), 'no-match query has honest empty state');
    await p.keyboard.press('Tab'); ok(await focused(p), 'empty-result Tab remains in search');
    await p.keyboard.press('Enter');
    ok(await p.evaluate(() => __wux.palMode === 'all') && await p.inputValue('#palInput') === 'nonexistent-app-qa-xyz', 'no-match Enter widens search without creating a conversation');
    await p.keyboard.press('Control+o');
    ok(await p.evaluate(() => __wux.palMode === 'apps') && await p.inputValue('#palInput') === 'nonexistent-app-qa-xyz', 'Ctrl+O switches modes keeping query');
    await p.fill('#palInput','Agents'); await p.keyboard.press('Control+k');
    ok(await p.evaluate(() => __wux.palMode === 'all') && await p.inputValue('#palInput') === 'Agents', 'Ctrl+K widens app search without losing query');
    await p.keyboard.press('Escape');
    ok(await p.evaluate(() => document.activeElement !== document.body && !document.activeElement.closest('#palette') && !!document.activeElement.getClientRects().length), 'Escape on empty desk restores visible focus');
  }
  const emptyCount = await p.evaluate(() => __wux.ws.length);
  await p.evaluate(() => __wux.newDesktop());
  ok(await p.evaluate(n => __wux.ws.length === n, emptyCount), 'repeated new desktop reuses empty desk without duplicates');
  ok(await visible(p) && await focused(p), 'reused empty desk reopens focused picker'); await close(p);
  await p.reload(); await p.waitForFunction(() => window.__wux?.live?.ok); ok(!await visible(p), 'restoring an empty desk does not auto-popup');
  // Every creation route; leave each empty desktop reusable.
  for (const key of ['Alt+t', 'Control+t', 'Meta+t']) {
    await p.keyboard.press(key); ok(await visible(p) && await focused(p), key + ' creates/reuses desk and opens picker'); await close(p);
  }
  await p.evaluate(() => __wux.goWs(0));
  ok(!await visible(p), 'ordinary desktop navigation never opens picker');
  const slot = await p.evaluate(() => __wux.ws.length + 2);
  await p.keyboard.press('Alt+Digit' + slot); ok(await visible(p) && await focused(p), 'next Alt-digit creation opens focused picker'); await close(p);
  await p.keyboard.press('Control+k'); await p.fill('#palInput', 'New desktop');
  await p.locator('#palList .pal-it').filter({ hasText: 'New desktop' }).first().click();
  ok(await visible(p) && await focused(p), 'New desktop command opens app picker'); await close(p);
  // Launch the real built-in Agents UI through its read-only API, not an invented app.
  await p.keyboard.press('Control+o');
  if (!await visible(p)) await p.keyboard.press('Control+k');
  await p.fill('#palInput', 'Files'); await p.keyboard.press('Enter'); await nap(500);
  ok(await p.evaluate(() => Object.values(__wux.wins).some(w => w.appId === 'files')), 'search + Enter launches actual Files app');
  const agentsBefore = await p.evaluate(() => Object.values(__wux.wins).filter(w => w.appId === 'files').length);
  await p.evaluate(() => __wux.newDesktop());
  if (!await visible(p)) await p.keyboard.press('Control+k');
  await p.fill('#palInput', 'Files');
  await p.locator('#palList [data-i]').first().focus(); await p.keyboard.press('Enter');
  ok(await p.evaluate(n => Object.values(__wux.wins).filter(w => w.appId === 'files').length === n, agentsBefore), 'focused result button Enter preserves single instance across desktops');
  await p.evaluate(() => __wux.openApp(WizCore.apps('desktop').APP.agents)); await nap(350);
  ok(await p.locator('#wsList .sg-agents').count() > 0 && await p.locator('.wbar .sg-agents').count() > 0, 'layered Agents identity reaches workspace and header');
  await shot(p, 'desktop-agents');
  const chatsBefore = await p.evaluate(() => Object.values(__wux.wins).filter(w => w.app === 'chats').length);
  await p.evaluate(() => __wux.newDesktop());
  if (await visible(p)) {
    const targetDesk = await p.evaluate(() => __wux.ws[__wux.cur].id);
    await p.fill('#palInput', await p.evaluate(() => WizCore.apps('desktop').APP.wizard.name)); await p.keyboard.press('Shift+Enter');
    ok(await p.evaluate(([n,id]) => Object.values(__wux.wins).filter(w => w.app === 'chats').length === n + 1 && __wux.ws[__wux.cur].id === id && __wux.ws[__wux.cur].wins.length === 1,[chatsBefore,targetDesk]), 'Shift+Enter makes a fresh local Chats window on the selected desk');
    ok(!await visible(p), 'app placement dismisses new-desktop picker');
  }
  await p.evaluate(() => __wux.goHome());
  await p.click('#desktopHome [data-res-open="server"]'); await p.waitForFunction(() => WosResources.state.panel);
  await p.keyboard.press('Control+o');
  ok(await visible(p) && await p.locator('.rs-sheet').count() === 0, 'app picker takes Resources overlay ownership'); await close(p);
  await p.keyboard.press('Control+o');
  if (await visible(p)) { await p.evaluate(() => history.back()); await nap(250); ok(!await visible(p) && await p.evaluate(() => __wux.homeOpen) && p.url().includes('wizard-os-home'), 'browser Back closes picker only, stays Home'); }
  await p.keyboard.press('Control+k'); await p.fill('#palInput', 'Home');
  ok(await p.locator('#palList .pal-grp').allTextContents().then(x => x.includes('Commands')), 'Ctrl+K retains command search');
  await p.fill('#palInput', 'Files');
  ok(await p.locator('#palList .pal-grp').first().textContent() === 'Apps', 'Ctrl+K keeps apps-first query search');
  await p.fill('#palInput', '');
  ok(await p.locator('#palList .pal-grp').allTextContents().then(x => x.some(s => /needs|unread|working/i.test(s))), 'Ctrl+K retains attention threads');
  await p.keyboard.press('Alt+Digit1'); ok(await p.evaluate(() => __wux.homeOpen) && !await visible(p), 'Alt+1 returns Home and dismisses picker');
  await p.keyboard.press('Alt+Digit2'); ok(await p.evaluate(() => __wux.cur === 0 && !__wux.homeOpen) && !await visible(p), 'Alt+2 existing desk does not popup');
  ok(await ta.inputValue() === 'QA retained picker draft — never send', 'draft survives app launch and Home/desktop round trip');
  // Both shells use the same identity; real private Chats never receive a message.
  for (const [kind, page] of [['desktop', p]]) {
    await page.evaluate(() => WizOpenAgentChats('private')); await nap(300);
    ok(await page.locator('[data-agent-titlebar="private"] .sg-hat-private').count() > 0, kind + ' private identity in Chats');
    const sizes = await page.evaluate(() => {
      const get = s => { const e=document.querySelector(s),r=e?.getBoundingClientRect(),c=e&&getComputedStyle(e); return { h:r?.height,w:r?.width,mask:c?.maskSize }; };
      return { main:get('.wbar .ic .sg-hat'),private:get('.wbar .ic .sg-hat-private'),workspace:get('#wsList .sg-hat-private') };
    });
    ok(sizes.main.h === sizes.private.h && sizes.main.mask === sizes.private.mask && sizes.private.mask === 'auto 80%', 'actual tiny window headers use equal optical sizing for main/private', sizes);
    ok(sizes.workspace.mask === 'auto 62%', 'bare workspace identity retains consistent 62% sizing', sizes.workspace);
  }
  // Source alpha bounds and enlarged keyhole opening: no reconstruction of the supplied main mark.
  const alpha = await p.evaluate(async () => {
    async function read(name) { const im = new Image(); im.src = '/wizard-os-home/brand/' + name; await im.decode(); const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data; let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0; for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y*c.width+x)*4+3] > 128) { x0 = Math.min(x0,x); y0 = Math.min(y0,y); x1 = Math.max(x1,x); y1 = Math.max(y1,y); } let holeWidth = 0; for (let y = 1100; y < 1740; y++) { let run = 0; for (let x = 400; x < 1000; x++) { if (d[(y*c.width+x)*4+3] < 128) { run++; holeWidth = Math.max(holeWidth,run); } else run=0; } } return { bounds:[x0,y0,x1,y1], holeWidth }; }
    return { main: await read('wizard-mark-white.png'), private: await read('wizard-mark-private.png') };
  });
  ok(JSON.stringify(alpha.main.bounds) === JSON.stringify(alpha.private.bounds), 'private and main source ink bounds match exactly', alpha);
  ok(alpha.private.holeWidth >= 330, 'private keyhole is enlarged beyond tiny old opening', alpha.private);
  // Contact sheet uses actual shared renderer/CSS at actual tiny and launcher sizes.
  await p.evaluate(() => { const host = document.createElement('div'); host.id = 'qa-icons'; host.style = 'position:fixed;inset:70px 120px;background:#100b1b;z-index:99999;padding:24px;color:white;display:flex;flex-direction:column;gap:24px'; const apps = [{id:'wizard'}, {id:'private',sigil:{icon:'hat-private',colors:['#4ff0b0']}}, WizCore.apps('desktop').APP.agents]; host.innerHTML = '<h2>Actual shared icons · Main / Private / Agents</h2>' + [16,18,22,32,58].map(s => '<div style="display:flex;align-items:center;gap:32px"><span style="width:45px">'+s+'px</span>'+apps.map(a=>WizSigil.box('span',s<=24?'wic':'',a).replace('style="',`style="width:${s}px;height:${s}px;border-radius:${Math.round(s*.25)}px;`)).join('')+'</div>').join(''); document.body.append(host); });
  await p.evaluate(() => { const d=document.createElement('div'); d.style='display:flex;gap:32px;align-items:center'; d.innerHTML='<span>Actual 21px workspace marks</span>'+['hat','hat-private','agents'].map((g,i)=>'<span class="dsg" style="--c:'+(i===1?'#4ff0b0':'#b58dff')+'">'+WizSigil.named(g)+'</span>').join(''); document.querySelector('#qa-icons').append(d); });
  await shot(p, 'icon-contact-sheet'); await p.evaluate(() => document.querySelector('#qa-icons').remove());
  await ctx.close();
  const mobile = await boot(true), m = mobile.p;
  ok(await m.evaluate(() => WizSigil.of({id:'agents'}).glyph === 'agents'), 'mobile registry uses distinct layered Agents mark');
  await m.evaluate(() => WizOpenAgentChats('private')); await nap(500);
  ok(await m.locator('[data-agent-titlebar="private"] .sg-hat-private').count() > 0, 'phone private Chats uses enlarged keyhole mask');
  await m.evaluate(() => __wos.goDesk(0,true)); await nap(500);
  ok(await m.locator('#dock .sg-hat-private').count() > 0, 'phone dock shares private identity');
  await m.evaluate(() => __wos.openApp(WizCore.apps('phone').APP.agents)); await nap(600);
  await shot(m,'phone-agents');
  const agentHeader = await m.locator('.win .wic .sg-agents').count();
  // The active phone desk is represented by the orb, not a duplicate app icon. Check its mark off-active.
  await m.evaluate(() => __wos.goDesk(0,true)); await nap(500);
  ok(await m.locator('#dock .sg-agents').count() > 0 && agentHeader > 0, 'phone Agents identity reaches off-active dock and active header');
  await m.evaluate(() => __wos.openSheet('launcher')); await nap(400); await m.fill('#search','Private Agent');
  ok(await m.locator('#launcher .sg-hat-private').count() > 0, 'phone app chooser uses private keyhole');
  await shot(m,'phone-app-chooser'); await m.evaluate(() => __wos.closeSheets(true));
  await m.evaluate(() => __wos.openOverview()); await shot(m,'phone-overview'); await m.evaluate(() => __wos.closeOverview());
  await m.evaluate(() => __wos.goDesk(0,true)); await nap(500);
  const plus = m.locator('#dock [data-plus]');
  ok(await plus.count() === 1, 'mobile plus remains available');
  if (await plus.count()) { await plus.click(); await nap(250); ok(await m.locator('.new-desk .lgrid .lapp').count() > 0 && await m.evaluate(() => !__wos.desks[__wos.idx].wins.length), 'mobile plus retains inline app-grid behavior'); await m.keyboard.press('Escape'); }
  await m.evaluate(() => WizOpenAgentChats('hermes')); await nap(300);
  const sid = await m.evaluate(() => __wos.live.sessions.find(s => !s.archived)?.id);
  if (sid) { await m.evaluate(id => __wos.openWizardThread(id),sid); await nap(500); await m.evaluate(() => history.back()); await nap(250); ok(!m.isClosed() && m.url().includes('/wizard-os-home/'), 'phone nested Back stays in shell'); }
  await m.setViewportSize({width:360,height:800}); await shot(m,'phone-small');
  ok(await m.locator('#dock').evaluate(e => e.getBoundingClientRect().right <= innerWidth + 1), '360px mobile dock stays within screen');
  await mobile.ctx.close();
  ok(errors.length === 0, 'zero page errors', errors);
  ok(reads.some(u => u.includes('/api/sessions')) && reads.some(u => u.includes('/v1/apps')), 'real sessions and app registry GETs exercised');
  ok(!writes.some(w => /\/v1\/runs|\/api\/sessions$/.test(w.url)), 'no conversation/run creation attempted', writes);
})().catch(e => ok(false,'suite completed',String(e.stack || e))).finally(async () => { await browser?.close(); const result = { worker: os.hostname(), base: BASE, checks, errors, writes, readCount: reads.length, pass: checks.filter(x=>x.pass).length, fail: checks.filter(x=>!x.pass).length }; fs.writeFileSync(path.join(OUT,'result.json'),JSON.stringify(result,null,2)); console.log('RESULT',result.pass,result.fail); process.exitCode = result.fail ? 1 : 0; });
