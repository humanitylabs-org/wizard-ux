// Exact-source synthetic persisted-client proof. Never connects to owner APIs.
// Two independent UA profiles are Chromium touch emulation, NOT physical devices.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {chromium}=require('./tools/qa-playwright.cjs');
const {boot,T,slide,orbXY,sleep,runs,log}=require('./qa-orb-radial.cjs');
const {createSkinFixture}=require('./tools/qa-legacy-skin-fixture.cjs');
const css=fs.readFileSync(process.env.QA_OWNER_CSS,'utf8');
const out=process.env.QA_SHOTS,broken=process.env.QA_EXPECT_BROKEN==='1';
fs.mkdirSync(out,{recursive:true});
const reports=[];let current;
const save=()=>fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({scope:'synthetic Chromium independent profiles; no handset interaction',broken,reports},null,2));
function check(condition,name,detail){current.checks.push({name,pass:!!condition,detail});save();assert.ok(condition,name+': '+JSON.stringify(detail));}
const snap=p=>p.evaluate(()=>({on:WosExperience.state.tweaks.find(t=>t.id==='wizard/orb-radial')?.on,handler:!!window.WosOrbSwitcher,active:WosSkinHost.tweakState.includes('wizard/orb-radial'),busy:WosExperience.state.busy,voice:__wos.voice,skin:WosSkin.current,overlay:WosMySkin.overlay,mySkin:WosMySkin.active?.id,swipe:getComputedStyle(document.documentElement).getPropertyValue('--wos-orb-swipe-up').trim(),two:WosSkinHost.layout,cache:localStorage.getItem('wos.own-skins.cache.v1')}));
async function shot(p,n){await sleep(700);await p.screenshot({path:path.join(out,current.id+'-'+n+'.png')});}
async function close(p){await p.evaluate(()=>{__wos.closeOverview();__wos.closeSheets();});await sleep(400);}
async function look(p){await p.evaluate(()=>__wos.openSheet('settings'));await p.locator('#settings.open [data-st-page="appearance"]').click();await p.waitForFunction(()=>document.querySelector('#settingsBody').dataset.settingsPage==='appearance');}
async function swipe(p){const o=await orbXY(p);await T(p,'touchStart',o.x,o.y);await slide(p,o,{x:o.x,y:o.y-176},2,0);await T(p,'touchEnd');await sleep(650);}
async function hold(p){const o=await orbXY(p);await T(p,'touchStart',o.x,o.y);await sleep(140);await T(p,'touchMove',o.x+1,o.y);await sleep(370);return o;}
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.QA_CHROME,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
 try{
 for(const profile of ['samsung','vanadium'])for(const two of [false,true]){
  if(broken&&(profile!=='vanadium'||two))continue;
  current={id:profile+'-'+(two?'two':'classic'),checks:[],imports:[],writes:[],errors:[]};reports.push(current);save();
  const data={active:'My skin',skins:[{id:'My skin',name:'My skin',base:'nebula',bytes:9890,empty:false,has_script:false,has_recipe:true,tweaks:{'wizard/orb-radial':true,'wizard/two-orbs':two}}]};
  const fixture=createSkinFixture(data,{metadata:{name:'My skin',tweaks:{'wizard/orb-radial':true,'wizard/two-orbs':two}},activeWrites:current.writes,recipeWrites:current.writes,refused:current.errors});
  let firstImport=true;
  const seed={'wos.skin':profile==='samsung'?'nebula':'grove','wos.tour.v1':'true','wos.skin-tweaks.v1':JSON.stringify({version:1,off:{wizard:['wizard/app-borders','wizard/pin-buttons',...(two?[]:['wizard/two-orbs'])]}}),'wos.orb-radial.migrated.v1':'true','wos.app-borders.migrated.v1':'true','wos.pin-buttons.migrated.v1':'true','wos.orbSwitcher.v1':JSON.stringify({pins:[],quickTakes:false})};
  const ua=profile==='samsung'?'Mozilla/5.0 (Linux; Android 16; SM-S938B) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/156.0.8078.47 Mobile Safari/537.36':'Mozilla/5.0 (Linux; Android 17; Pixel 10 Pro XL) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/156.0.8078.79 Mobile Safari/537.36';
  // Adapter changes only userAgent; runtime remains the pinned Linux Chromium.
  process.env.QA_CLIENT_UA=ua;
  const {ctx,p}=await boot(browser,{width:412,height:892},seed,false,async ctx=>{
   ctx.on('page',page=>page.on('pageerror',e=>current.errors.push(String(e))));
   await ctx.route('**/wizard/v1/skins**',async r=>{await sleep(200);const q=r.request(),u=new URL(q.url());const a=fixture.handle(u.pathname,q.method(),q.postData()?q.postDataJSON():undefined);return r.fulfill({status:a.status,json:a.body});});
   await ctx.route('**/wizard/v1/user-files/content?path=Skins%2FMy%20skin%2Fskin.json',r=>{const a=fixture.recipe();return r.fulfill({status:a.status,json:a.body});});
   await ctx.route('**/wizard/v1/my-skin*',r=>r.request().method()!=='GET'?r.fulfill({status:403,json:{error:'refused'}}):new URL(r.request().url()).searchParams.has('format')?r.fulfill({json:{path:'Skins/My skin/skin.css',exists:true,empty:false,script:{exists:false}}}):r.fulfill({contentType:'text/css',body:css}));
   await ctx.route('**/core/orb-switcher.js*',r=>{current.imports.push(r.request().url());save();if(profile==='vanadium'&&firstImport){firstImport=false;return r.abort('failed');}return r.fallback();});
  });
  try{
   await p.waitForFunction(()=>window.WosMySkin?.state.loaded&&!WosExperience.state.busy);
   let s=await snap(p);check(s.on,'existing saved ON preference survived cold boot',s);
   if(broken){check(!s.handler&&s.active,'base reproduces ON + active membership + absent handler after failed lazy module',s);check(current.imports.length===1,'base makes no recovery request',current.imports);continue;}
   await p.waitForFunction(()=>window.WosOrbSwitcher?.active());s=await snap(p);
   check(s.handler&&s.active&&!s.busy,'ON waits for installed radial handler without a toggle',s);
   check(s.mySkin==='My skin'&&s.swipe==='pill','box customization arrives without recipe cache',s);
   check(s.two===(two?'two-orb':'classic'),'independent persisted two-orbs state retained',s);
   check(profile!=='vanadium'||current.imports.some(x=>x.includes('orb-retry=')),'failed module URL recovered by a distinct retry URL',current.imports);
   for(const skin of ['nebula','grove']){
    // Locator.click re-resolves, waits for pending controls and scrolls; no stale ElementHandle or separate scroll across Settings re-renders.
    await look(p);const button=p.locator(`[data-skinpick="${skin}"]`);await button.click();await p.waitForFunction(s=>WosSkin.current===s&&!WosExperience.state.busy,skin);await close(p);
    const o=await hold(p);check(await p.evaluate(()=>WosOrbSwitcher.isOpen&&__wos.voice==='idle'),'jittered hold opens radial without microphone '+skin,await snap(p));
    const wedges=await p.evaluate(()=>WosOrbSwitcher._wedges().map(w=>w.kind));check(wedges.length===2&&wedges.includes('voice')&&wedges.includes('custom'),'empty device-local pins still show Voice + Customize '+skin,wedges);await shot(p,skin+'-empty-radial');
    const custom=await p.evaluate(()=>{const w=WosOrbSwitcher._wedges().find(w=>w.kind==='custom');return{x:w.x,y:w.y};});await slide(p,o,custom,2,0);await p.evaluate(()=>new Promise(requestAnimationFrame));await T(p,'touchEnd');await p.waitForFunction(()=>document.querySelector('.wor-sheet'));await shot(p,skin+'-customize');await p.keyboard.press('Escape');await close(p);
    await p.evaluate(()=>WosOrbSwitcher.set({pins:['notes','wizard-calendar']}));await hold(p);const apps=await p.evaluate(()=>WosOrbSwitcher._wedges().filter(w=>w.kind==='app').map(w=>w.item.id));check(apps.length===2&&apps.every(x=>['notes','wizard-calendar'].includes(x)),'only pinned app wedges '+skin,apps);await T(p,'touchCancel');await p.evaluate(()=>WosOrbSwitcher.set({pins:[]}));
    await swipe(p);check(await p.evaluate(()=>!!document.querySelector('#overview.open.ov-pill .ov-close')&&!document.getElementById('launcher').classList.contains('open')),'swipe-up still reaches Miguel selector '+skin);await shot(p,skin+'-selector');await close(p);
   }
   await p.evaluate(()=>localStorage.removeItem('wos.own-skins.cache.v1'));await p.reload({waitUntil:'load'});await p.waitForFunction(()=>window.WosOrbSwitcher?.active()&&window.WosMySkin?.state.loaded&&!WosExperience.state.busy);await hold(p);check(await p.evaluate(()=>WosOrbSwitcher.isOpen&&__wos.voice==='idle'),'ON survives cache-free receipt replay/reload',await snap(p));await T(p,'touchCancel');
   await look(p);await p.locator('[data-tweak-toggle="wizard/orb-radial"]').click();await p.waitForFunction(()=>!window.WosOrbSwitcher&&!WosExperience.state.busy);await close(p);check(await p.locator('.wor,.wor-scrim').count()===0,'explicit OFF tears down radial');
   await p.reload({waitUntil:'load'});await p.waitForFunction(()=>window.WosExperience&&!WosExperience.state.busy&&WosExperience.state.tweaks.length);await sleep(600);check(await p.evaluate(()=>!window.WosOrbSwitcher&&!performance.getEntriesByType('resource').some(r=>/orb-switcher\.js/.test(r.name))),'saved OFF reload loads no radial module');
   check(current.errors.length===0,'zero page errors / unrelated writes',current.errors);check(!current.writes.some(x=>Object.hasOwn(x,'id')),'active My skin pointer never rewritten',current.writes);
  }catch(e){current.failure=String(e);await shot(p,'failure').catch(()=>{});throw e;}finally{await ctx.close();save();}
 }
 assert.equal(runs().length,0,'no inference or session admission');
 console.log('COMPLETE',JSON.stringify({profiles:reports.length,checks:reports.reduce((n,r)=>n+r.checks.length,0),failed:reports.flatMap(r=>r.checks).filter(c=>!c.pass).length,realRuns:runs().length,writes:log.writes}));
 }finally{await browser.close();save();}
})().catch(e=>{if(current){current.failure=String(e);save();}console.error(e);process.exitCode=1;});
