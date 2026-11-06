// Saved-state regression for James's original Miguel selector customization.
// QA_OWNER_FIXTURE: narrowly captured Files CSS + skins metadata; never owner content.
// QA_EXPECT_BROKEN=1 serves baseline bytes and proves the old palette -> active:null transition.
const fs = require('fs'), path = require('path');
const { chromium } = require('./tools/qa-playwright.cjs');
const { boot, ready, T, slide, orbXY, sleep, runs } = require('./qa-orb-radial.cjs');
const fixture = JSON.parse(fs.readFileSync(process.env.QA_OWNER_FIXTURE, 'utf8'));
const broken = process.env.QA_EXPECT_BROKEN === '1', shots = process.env.QA_SHOTS;
const assert = require('node:assert/strict');
const {provePanelOpaque} = require('./tools/qa-panel-opacity.cjs');
const {checks:expectedChecks} = require('./tools/qa-legacy-overlay-contract.cjs');
const {createSkinFixture} = require('./tools/qa-legacy-skin-fixture.cjs');
const diagnostic=process.env.QA_OPACITY_DIAGNOSTIC==='1';
const checked=[];
let passed = 0;
function check(value, name, detail) { if (!value) throw new Error(name + ': ' + JSON.stringify(detail)); checked.push(name);passed++; console.log('PASS', name); }
function complete(){assert.deepEqual(checked,expectedChecks(broken,diagnostic),'all semantic acceptance obligations completed');console.log('CHECKS',JSON.stringify(checked));console.log(`COMPLETE ${passed} passed, 0 failed`);}
const copy = value => JSON.parse(JSON.stringify(value));
async function setup(ctx, data, css, writes, recipeWrites = [], refused = []) {
  // Persist each event immediately, including on assertion/timeout failures. The
  // synthetic routes retain responses; page fetch traces retain the exact caller.
  ctx.lifecycle = 'boot';
  const record = row => {
    const line = JSON.stringify({ profile: ctx.profile || 'initial-deactivated', lifecycle: ctx.lifecycle, ...row });
    console.log('SKIN_REQUEST', line);
    if (shots) { fs.mkdirSync(shots, {recursive:true}); fs.appendFileSync(path.join(shots,'skin-requests.ndjson'), line+'\n'); }
  };
  ctx.on('page', p => p.on('console', message => {
    if (message.text().startsWith('SKIN_INITIATOR ')) record({ initiator: JSON.parse(message.text().slice(15)) });
  }));
  await ctx.addInitScript(() => {
    const original = window.fetch;
    window.fetch = function(input, init) {
      const url = typeof input === 'string' ? input : input?.url;
      if (url && /\/wizard\/v1\/(skins|my-skin|user-files\/content)/.test(url)) {
        console.log('SKIN_INITIATOR '+JSON.stringify({url,method:init?.method || 'GET',body:init?.body || null,
          stack:new Error('skin request initiator').stack,legacy:localStorage.getItem('wos.own-skins.v1'),
          cachedCSS:!!localStorage.getItem('wos.myskin.v1'),cachedRecipes:!!localStorage.getItem('wos.own-skins.cache.v1')}));
      }
      return original.apply(this, arguments);
    };
  });
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const fixture = createSkinFixture(data, { activeWrites: writes, recipeWrites, refused });
  await ctx.route('**/wizard/v1/skins**', route => {
    const req = route.request(), u = new URL(req.url());
    let input; try { input = req.postData() ? req.postDataJSON() : undefined; } catch (_) { refused.push({pathname:u.pathname,method:req.method(),invalidJSON:true});return json(route, { error: 'qa: invalid JSON refused' }, 403); }
    const result = fixture.handle(u.pathname + u.search, req.method(), input);
    record({path:u.pathname,method:req.method(),input,status:result.status,active:data.active});
    return json(route, result.body, result.status);
  });
  await ctx.route('**/wizard/v1/user-files/content?path=Skins%2FMy%20skin%2Fskin.json', r => {
    if (r.request().method() !== 'GET') { refused.push({pathname:new URL(r.request().url()).pathname,method:r.request().method()});return json(r, { error: 'qa: file write refused' }, 403); }
    const result = fixture.recipe(); return json(r, result.body, result.status);
  });
  await ctx.route('**/wizard/v1/my-skin*', r => {
    if (r.request().method() !== 'GET') { refused.push({pathname:new URL(r.request().url()).pathname,method:r.request().method()});return json(r, { error: 'qa: CSS write refused' }, 403); }
    if (new URL(r.request().url()).searchParams.has('format')) return json(r, { path: data.active ? 'Skins/My skin/skin.css' : '', exists: !!data.active, empty: !data.active, script: { exists: false } });
    return r.fulfill({ status: 200, contentType: 'text/css', body: data.active ? css : '' });
  });
}
async function swipe(p) {
  const o = await orbXY(p); await T(p, 'touchStart', o.x, o.y); await slide(p, o, {x:o.x,y:o.y-176}, 8, 16); await T(p, 'touchEnd'); await sleep(550);
}
const state = p => p.evaluate(() => ({ skin: WosSkin.current, active: WosMySkin.active?.id || null, overlay: WosMySkin.overlay, variable: getComputedStyle(document.documentElement).getPropertyValue('--wos-orb-swipe-up').trim(), pill: !!document.querySelector('#overview.open.ov-pill .ov-close'), apps: document.getElementById('launcher').classList.contains('open'), css: document.getElementById('wosMySkin')?.textContent || '' }));
async function close(p) { await p.evaluate(() => { __wos.closeOverview(); __wos.closeSheets(); }); await sleep(350); }
async function look(p) {
  await p.evaluate(()=>__wos.openSheet('settings'));
  await p.waitForFunction(()=>__wos.sheet==='settings'&&document.querySelector('#settings.open'));
  const settings=p.locator('#settings.open #settingsBody');
  await settings.locator('[data-st-page="appearance"]').click();
  await p.waitForFunction(()=>document.querySelector('#settingsBody').dataset.settingsPage==='appearance');
  return settings;
}
async function shot(p, name) {
  if (!shots) return; fs.mkdirSync(shots, {recursive:true}); await sleep(700); await p.screenshot({path:path.join(shots,name+'.png')});
}
(async () => {
  const browser = await chromium.launch({executablePath:process.env.QA_CHROME || undefined,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
  try {
    // The REAL broken persisted state: nonempty CSS remains in Files, active pointer empty.
    const data = copy(fixture.skins), writes = [];
    const {ctx,p} = await boot(browser, undefined, {'wos.skin':'nebula','wos.tour.v1':'true'}, false, c=>setup(c,data,fixture.css,writes));
    await p.waitForFunction(()=>WosMySkin.state.loaded); await swipe(p); let s=await state(p);
    check(s.apps && !s.pill && !s.variable && data.active===null, 'captured deactivated owner CSS reproduces Apps before restoration', s);
    await shot(p,'before-disabled-overlay'); await close(p);
    // Supported restore (not hidden client storage), then reproduce the transition that lost it.
    ctx.lifecycle='explicit-initial-restore';
    await p.evaluate(()=>WosMySkin.wear('My skin')); await p.waitForFunction(()=>getComputedStyle(document.documentElement).getPropertyValue('--wos-orb-swipe-up').trim()==='pill');
    await swipe(p); s=await state(p); check(s.pill&&!s.apps,'restored real CSS selects Miguel panel, not generic overview',s); await close(p);
    ctx.lifecycle='initial-palette';await p.evaluate(()=>WosSkin.set('grove')); await sleep(900); await swipe(p); s=await state(p);
    if (broken) {
      check(data.active===null&&s.apps&&!s.pill&&writes.some(x=>x.id===null),'baseline palette switch silently clears persisted active pointer and returns Apps',s);
      await shot(p,'baseline-palette-loses-overlay');
    } else {
      check(data.active==='My skin'&&s.pill&&!s.apps&&s.skin==='grove'&&!writes.some(x=>x.id===null),'fixed legacy overlay keeps selector and box pointer across palette switch',s);
      check(s.css===fixture.css,'all original My skin rules preserved byte-for-byte',s.css.length);
    }
    check(p.errs.length===0,'saved-state scenario has zero page errors',p.errs); await ctx.close();
    if (broken) { complete(); return; }
    // Independent fresh profiles with restored box state, radial OFF/ON and optional two-orbs.
    for (const enabled of [false,true]) for (const two of [false,true]) {
      const data=copy(fixture.skins);data.active='My skin';const writes=[],recipeWrites=[],refused=[];
      // Boot without ready()'s implicit radial write; label the explicit UI opt-in.
      const {ctx,p}=await boot(browser,undefined,{'wos.skin':'grove','wos.tour.v1':'true'},false,c=>{c.profile=`radial-${enabled}-two-${two}`;return setup(c,data,fixture.fixed_css,writes,recipeWrites,refused);});
      await p.waitForFunction(()=>WosMySkin.state.loaded&&WosMySkin.overlay);
      if(enabled){ctx.lifecycle='explicit-radial-opt-in';await ready(p,true);}
      assert.deepEqual(writes,[]);assert.deepEqual(refused,[]);
      assert.deepEqual(recipeWrites,enabled?[{tweaks:{'wizard/orb-radial':true}}]:[],'the explicit radial click, not palette/reload, owns this PATCH');
      check((await state(p)).skin==='grove','fresh profile retains current palette, never guessed nebula base');
      if(two){
        ctx.lifecycle='explicit-two-orbs-opt-in';
        const settings=await look(p);
        const toggle=settings.locator('[data-tweak-toggle="wizard/two-orbs"]');
        await toggle.waitFor({state:'visible'});assert.equal(await toggle.getAttribute('aria-checked'),'false');await toggle.click();
        await p.waitForFunction(()=>WosSkinHost.tweakState.includes('wizard/two-orbs')&&WosSkinHost.layoutState.id==='two-orb'&&WosSkinHost.layoutState.active&&!WosExperience.state.busy&&!document.querySelector('#settingsBody [data-tweak-toggle][disabled]'));
        check(data.skins.find(s=>s.id==='My skin').has_recipe===true&&(await state(p)).overlay,'real two-orbs control saves tweak-only recipe without binding overlay to a palette');
        await close(p);await sleep(700);
      }
      for (const skin of ['nebula','grove']) {
        ctx.lifecycle=`palette-${skin}-radial-${enabled}-two-${two}`;
        // Use actual Appearance controls, including family and palette entry points.
        const settings=await look(p);
        await settings.locator('[data-skinfamily="wizard"]').click();
        // Look paints pending before its rAF action. !busy alone can pass before the action starts.
        await p.waitForFunction(()=>!WosExperience.state.busy&&!document.querySelector('#settingsBody [data-skinfamily][disabled], #settingsBody [data-skinfamily][aria-busy="true"]'));
        await settings.locator(`[data-skinpick="${skin}"]`).click();
        await p.waitForFunction(s=>WosSkin.current===s&&!WosExperience.state.busy&&!document.querySelector('#settingsBody [data-skinpick][disabled], #settingsBody [data-skinpick][aria-busy="true"]'),skin);
        await p.evaluate(()=>__wos.closeSheets());
        await p.waitForFunction(()=>!__wos.sheet&&!document.querySelector('#settings.open'));
        await sleep(650);
        await swipe(p);let s=await state(p);check(s.pill&&!s.apps&&s.skin===skin&&s.active==='My skin',`${skin} radial:${enabled} two-orbs:${two}: actual Look -> Miguel selector`,s);
        const fill=await p.locator('#overview .ov-sheet').evaluate(e=>{const s=getComputedStyle(e),c=document.createElement('canvas');c.width=c.height=1;const ctx=c.getContext('2d');ctx.fillStyle=s.backgroundColor;ctx.fillRect(0,0,1,1);return {background:s.backgroundColor,alpha:ctx.getImageData(0,0,1,1).data[3],blur:s.backdropFilter,radius:s.borderRadius,opacity:s.opacity};});
        check(fill.alpha===255&&fill.opacity==='1'&&fill.blur==='none'&&parseFloat(fill.radius)>20,'Miguel pill has opaque shared panel and rounded identity',fill);
        // Compare decoded background-interior RGBA, never rounded bounding-box corners.
        // Same-state controls, exact same physical ROI, loud-layer stacking/paint proof,
        // and deliberately translucent positive control are mandatory, with retained PNGs.
        const proof=await provePanelOpaque(p,{shots,name:`${skin}-radial-${enabled}-two-${two}`,legacyProbe:diagnostic});
        check(proof.complete&&proof.changed.mismatches===0,'selector panel pixels unchanged over loud text',proof.changed);
        if(diagnostic){assert.equal(p.errs.length,0);await ctx.close();complete();return;}
        if(!two)await shot(p,`fixed-${skin}-radial-${enabled}`);await close(p);
      }
      ctx.lifecycle=`cache-free-reload-radial-${enabled}-two-${two}`;
      await p.evaluate(()=>{localStorage.removeItem('wos.own-skins.cache.v1');localStorage.removeItem('wos.own-skins.v1');});
      await p.reload({waitUntil:'load'});await ready(p,enabled);await p.waitForFunction(()=>WosMySkin.state.loaded);await swipe(p);
      let s=await state(p);check(s.pill&&!s.apps&&data.active==='My skin'&&s.skin==='grove','reload reads restored CSS and active pointer from box without reseeding',s);await close(p);
      check(await p.evaluate(two=>WosMySkin.overlay&&WosSkinHost.tweakState.includes('wizard/two-orbs')===two,two),'cache-free reload preserves overlay metadata and actual two-orbs choice');
      if(two)await p.waitForFunction(()=>WosSkinHost.layoutState.id==='two-orb'&&WosSkinHost.layoutState.active&&document.querySelector('#agentOrb:not([hidden])'));
      // Real thumb hold + tap still use the existing voice/radial handlers.
      ctx.lifecycle=`physical-hold-tap-radial-${enabled}-two-${two}`;
      let o=await orbXY(p);await T(p,'touchStart',o.x,o.y);await sleep(750);
      if(enabled)check(await p.evaluate(()=>WosOrbSwitcher.isOpen&&WosOrbSwitcher._wedges().every(w=>w.kind==='voice'||w.kind==='custom'||(w.kind==='app'&&WosLauncher.get().pins.includes(w.item.id)))),'long hold remains pins-only radial (no desk wedges)');
      else check(await p.evaluate(()=>__wos.voice==='command'),'OFF long hold remains ordinary voice command');
      await p.evaluate(()=>__wos.cancelVoice(true));await T(p,'touchEnd');await sleep(500);
      // In real two-orbs, the white centre orb dictates into a focused field;
      // the right-hand agent orb is the ordinary voice-message tap target.
      if(two){const r=await p.locator('#agentOrb').boundingBox();assert.ok(r);o={x:r.x+r.width/2,y:r.y+r.height/2};}else o=await orbXY(p);
      await T(p,'touchStart',o.x,o.y);await sleep(40);await T(p,'touchEnd');await sleep(500);
      check(await p.evaluate(()=>__wos.voice!=='idle'),'tap remains voice');await p.evaluate(()=>__wos.cancelVoice(true));await sleep(300);
      check(writes.length===0,'skin changes and reload perform no hidden owner active writes',writes);
      const expectedRecipes=[...(enabled?[{tweaks:{'wizard/orb-radial':true}}]:[]),...(two?[{tweaks:{'wizard/two-orbs':true}}]:[])];
      assert.deepEqual(recipeWrites,expectedRecipes);
      check(refused.length===0,'only explicit radial and two-orbs recipe PATCHes occur; no other recipe writes or refused routes', {recipeWrites,refused});
      console.log('SKIN_WRITES',JSON.stringify({radial:enabled,two,activeWrites:writes,recipeWrites,refused}));
      ctx.lifecycle=`explicit-leave-radial-${enabled}-two-${two}`;
      await p.evaluate(()=>WosMySkin.leave());ctx.lifecycle=`opt-out-reload-radial-${enabled}-two-${two}`;await p.reload({waitUntil:'load'});await ready(p,enabled);await swipe(p);s=await state(p);
      check(s.apps&&!s.pill&&data.active===null,'explicit leave is durable opt-out; no automatic resurrection',s);
      assert.deepEqual(writes,[{id:null}]);assert.deepEqual(recipeWrites,expectedRecipes);assert.deepEqual(refused,[]);
      check(p.errs.length===0,'restored profile has zero page errors',p.errs);await ctx.close();
    }
    check(runs().length===0,'no agent runs or new sessions',runs()); complete();
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
