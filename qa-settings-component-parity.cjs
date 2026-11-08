// Extends the settings-redesign/home-settings acceptance contracts with fully synthetic API routing.
// Queue on forum only. QA_WEB_DIR=<sealed source> QA_OUT=<evidence> node qa-settings-component-parity.cjs
'use strict';
const {chromium} = require('./tools/qa-playwright.cjs');
const {seedOwner, ownerRead} = require('./tools/qa-settings-fixture.cjs');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const WEB = path.resolve(process.env.QA_WEB_DIR || __dirname, 'web');
const OUT = process.env.QA_OUT; if (!OUT) throw Error('QA_OUT required'); fs.mkdirSync(OUT,{recursive:true});
const BASE = 'https://wizard.test/wizard-os-home/';
const checks=[],contexts=[], errors=[]; let browser, activePage, activeJournal;
const flush=()=>fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({checks,contexts,errors,passed:checks.filter(x=>x.pass).length,failed:checks.filter(x=>!x.pass).length,forwardedWrites:0,realAgentRuns:0,screenshotsInspected:false},null,2));
const ok=(condition,name,detail)=>{checks.push({pass:!!condition,name,detail});flush();console.log(condition?'PASS':'FAIL',name);};
const categoryReady=entry=>{
 const root=document.querySelector('#settingsBody'), pane=root?.querySelector('.st-page'), heading=pane?.querySelector('h3');
 return root?.dataset.settingsPage===entry.id&&!pane?.hidden&&heading?.textContent.trim()===entry.label&&root.querySelector('[data-st-page="'+entry.id+'"][aria-current="page"]')!==null;
};
const nap=ms=>new Promise(r=>setTimeout(r,ms));
// #880: one outside tap must finish the visual dismissal, not only clear model state.
const phoneDismissed=()=>{
 const settings=document.querySelector('#settings'),device=document.querySelector('#device'),backdrop=document.querySelector('#scrim');
 if(!settings||!device||!backdrop)return false;
 const box=settings.getBoundingClientRect(),rect={top:box.top,right:box.right,bottom:box.bottom,left:box.left,width:box.width,height:box.height};
 const viewport={width:innerWidth,height:innerHeight},sheetNull=__wos.sheet===null,settingsOpen=settings.classList.contains('open'),deviceSheetOpen=device.classList.contains('sheet-open');
 const opacity=getComputedStyle(settings).opacity,backdropPointerEvents=getComputedStyle(backdrop).pointerEvents;
 const offViewport=rect.bottom<=0||rect.top>=viewport.height||rect.right<=0||rect.left>=viewport.width;
 const pass=sheetNull&&!settingsOpen&&!deviceSheetOpen&&Number(opacity)===0&&offViewport&&backdropPointerEvents==='none';
 return pass?{pass,sheetNull,settingsOpen,deviceSheetOpen,opacity,rect,viewport,offViewport,backdropPointerEvents}:false;
};
(async()=>{
 browser=await chromium.launch({headless:true,...(process.env.QA_CHROME?{executablePath:process.env.QA_CHROME}:{})});
 try {
  for(const phone of process.env.QA_EXPECT_RED ? [false] : [false,true]) {
   const kind=phone?'phone':'desktop', ctx=await browser.newContext({viewport:phone?{width:412,height:892}:{width:1440,height:900},isMobile:phone,hasTouch:phone,serviceWorkers:'block',...(phone?{userAgent:'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/129.0.0.0 Mobile Safari/537.36'}:{})});
   const journal={kind,requests:[],writes:[],pages:{},shots:[]};contexts.push(journal);
   let available=true, pending=false, policy='auto', channel='stable';
   const status=()=>({mode:policy,always_auto:true,chosen:true,installed:'0.3.101',latest:pending?'0.3.102':'0.3.101',checked:true,update_available:pending,channel,channels:1});
   await ctx.route('**/*',async r=>{
    const q=r.request(),u=new URL(q.url()),method=q.method(); journal.requests.push({path:u.pathname,method});
    const json=(body,status=200)=>r.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
    if(u.origin!==new URL(BASE).origin)return r.abort();
    if(!['GET','HEAD'].includes(method)){
     const body=q.postData()||'';journal.writes.push({path:u.pathname,method,body});flush();
     if(u.pathname.endsWith('/store-install/_updates')&&available){const d=JSON.parse(body);if(d.mode)policy=d.mode;if(d.channel)channel=d.channel;return json(status());}
     return json({error:'Synthetic QA refuses writes'},403);
    }
    if(u.pathname.endsWith('/store-install/_updates'))return available?json(status()):json({error:'not_found'},404);
    if(u.pathname.endsWith('/ux-version.txt')){if(!/^[a-f0-9]{40}$/.test(process.env.QA_INTERFACE_BUILD||''))throw Error('Verified source web tree required');return r.fulfill({contentType:'text/plain',body:process.env.QA_INTERFACE_BUILD});}
    if(u.pathname.endsWith('/store-install/_slots/chats'))return json({default:'wizard-chats',candidates:['wizard-chats']});
    if(u.pathname==='/wizard/v1/apps')return json({apps:[],slots:{chats:{default:'wizard-chats',candidates:['wizard-chats']}}});
    if(u.pathname==='/wizard/v1/agents')return json({agents:[{id:'hermes',label:'QA Agent',is_default:true,status:'running'}]});
    const owner=ownerRead(u.pathname);if(owner)return json(owner);
    if(u.pathname==='/wizard/hermes/api/sessions')return json({object:'list',data:[],has_more:false,limit:100,offset:0,snapshot:'qa-settings'});
    if(u.pathname==='/wizard/thread-seen')return json({state:{initializedAt:1,threads:{}}});
    if(u.pathname==='/wizard/v1/ui-preferences')return json({pinnedChats:[],spaces:[],readyOrder:'newest',subjectOrder:[],migrations:{'launcher.v1':true}});
    if(u.pathname.endsWith('/voice/status'))return json({ready:true,name:'Synthetic voice',model:'fixture'});
    if(u.pathname==='/wizard/v1/boomerangs')return json({reminders:[]});
    if(u.pathname.endsWith('/connections/status'))return json({});
    if(u.pathname.startsWith('/wizard/'))return json({});
    if(u.pathname==='/wizard-os-home/data.js'||u.pathname==='/wizard-os-home/summaries.js')return r.fulfill({contentType:'application/javascript',body:u.pathname.endsWith('/data.js')?'window.WIZ_DATA={threads:[],projects:{}};':'window.WIZ_SUMMARIES={};'});
    const rel=u.pathname.replace(/^\/wizard-os-home\//,'')||'index.html',file=path.resolve(WEB,rel);
    if(!file.startsWith(WEB+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return r.fulfill({status:404,body:''});
    const types={'.js':'application/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.txt':'text/plain','.webp':'image/webp'};
    return r.fulfill({status:200,contentType:types[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});
   });
   await ctx.addInitScript(seedOwner);
   const p=await ctx.newPage();p.setDefaultTimeout(8000);p.on('pageerror',e=>{errors.push({kind,error:String(e)});flush();});
   activePage=p;activeJournal=journal;
   const tap=async sel=>{await p.locator('.mz-intro').waitFor({state:'detached'});const el=p.locator(sel+':visible').first();phone?await el.tap():await el.click();await nap(140);};
   const open=async view=>{await p.evaluate(v=>WizCore.deeplink.route('/wizard-os-home/?view='+v),view);await p.locator('#settingsBody').waitFor({state:'visible'});await nap(180);};
   const back=async()=>{phone?await p.evaluate(()=>window.__wos.onBack()):await p.keyboard.press('Escape');await nap(180);};
   const shot=async name=>{await p.locator('.mz-intro').waitFor({state:'detached'});const file=path.join(OUT,kind+'-'+name+'.png');await p.screenshot({path:file});journal.shots.push(file);flush();};
   await p.goto(BASE+(phone?'index.html':'desktop.html'),{waitUntil:'load'});
   await p.waitForFunction(()=>!!(window.__wos||window.__wux)&&window.WosSettings&&window.WosOutbox?.recoveryComplete);
   await p.waitForFunction(()=>window.__welcomeLog?.includes('boot:true:done:false'));
   const welcome=await p.evaluate(()=>({log:window.__welcomeLog,active:WosWelcome.active,overlay:!!document.querySelector('#wosWelcome')}));
   journal.welcome=welcome;ok(welcome.active===false&&welcome.overlay===false,kind+': established-owner Welcome decision, no overlay',welcome);
   assert.equal(welcome.active,false);assert.equal(welcome.overlay,false);
   ok(await p.evaluate(phone=>phone?!!window.__wos&&!window.__wux:!!window.__wux&&!window.__wos,phone),kind+': actual requested shell booted');
   if(phone)await p.evaluate(()=>{window.__qaNativeChecks=0;window.WizardOSDevice={version:()=>1,platform:()=> 'Android fixture',notifications:()=>JSON.stringify({allowed:true}),updateState:()=>JSON.stringify({installed:'0.10.23',installedCode:87,state:'current'}),updateCheck:()=>{window.__qaNativeChecks++;}};});
   for(const skin of ['nebula','obsidian-light']){
    if(!phone){await p.locator('[data-home-settings]').waitFor({state:'visible'});await tap('[data-home-settings]');}
    else await open('settings');
    await open('skin');
    if(skin!=='nebula'){
     // Current live renders only the selected family's palettes; old main renders all palettes.
     const family=await p.evaluate(s=>WosSkin.familyOf?.(s),skin);
     if(family&&await p.locator('[data-skinfamily="'+family+'"]:visible').count())await tap('[data-skinfamily="'+family+'"]');
     await tap('[data-skinpick="'+skin+'"]');
    }
    await p.waitForFunction(s=>WosSkin.current===s&&!window.WosExperience?.state?.busy,skin);
    ok(await p.evaluate(s=>WosSkin.current===s,skin),kind+' '+skin+': live skin change');
    await shot(skin+'-appearance');
    if(!phone){const geom=await p.locator('#dsettings').evaluate(el=>{const r=el.getBoundingClientRect();return{modal:el.classList.contains('is-modal'),inBody:el.parentNode===document.body,center:Math.abs(r.left+r.width/2-innerWidth/2)<4,windows:document.querySelectorAll('.win .settings-host').length};});ok(geom.modal&&geom.inBody&&geom.center&&geom.windows===0,skin+': #1552 Settings centred over Home, no desk window',geom);}
    await open('settings');
    const menu=await p.locator('#settingsBody [data-st-page]').evaluateAll(els=>els.map(e=>({id:e.dataset.stPage,label:e.querySelector('b').textContent})));
    journal.pages[skin]={menu,content:{}};
    for(const entry of menu){
     await tap('[data-st-page="'+entry.id+'"]');
     await p.waitForFunction(categoryReady,entry);
     ok(await p.evaluate(categoryReady,entry),kind+' '+skin+': reachable '+entry.id);
     journal.pages[skin].content[entry.id]=await p.locator('.st-page:visible').evaluate(el=>({features:[...el.querySelectorAll('[data-settings-feature]')].map(e=>e.dataset.settingsFeature),actions:[...el.querySelectorAll('[data-st],[data-osu]')].map(e=>e.dataset.st||e.dataset.osu)}));
     if(entry.id==='about'){
      if(!process.env.QA_EXPECT_RED)await p.waitForFunction(()=>window.WizWebUpdate?.firstObservedVersion);
      const text=await p.locator('.st-page:visible').innerText();
      const hasInterface=await p.locator('[data-settings-version="interface"]').count()===1;
      if(process.env.QA_EXPECT_RED){ok(!hasInterface,'RED_EXPECTED desktop interface version absent');await shot('baseline-about');throw Object.assign(Error('RED_EXPECTED desktop interface version absent'),{expectedRed:!hasInterface});}
      ok(hasInterface&&text.includes('Wizard OS (server) 0.3.101'),kind+' '+skin+': server version visible and interface revision in Technical details');
      await tap('[data-settings-technical] summary');
      await p.waitForFunction(()=>document.querySelector('[data-settings-technical]')?.open);
      ok((await p.locator('[data-settings-observed-full]:visible').innerText())===process.env.QA_INTERFACE_BUILD,kind+' '+skin+': exact first-observed interface fingerprint in Technical details');
      await shot(skin+'-technical');
      await tap('[data-settings-technical] summary');
      if(phone){ok(text.includes('Phone app (Android) 0.10.23')&&!text.includes('Wizard OS 0.10.23'),skin+': native app identity distinct from server');await tap('[data-dvupd]');ok(await p.evaluate(()=>__qaNativeChecks)>0,skin+': existing native check action preserved');}
      ok(await p.locator('[data-osu="ask"],[data-osu="auto"]').count()===0&&(await p.locator('[data-osu-auto]:visible').innerText()).includes('Install by themselves overnight'),kind+' '+skin+': no Ask me, always automatic readback');
      ok((await p.locator('[data-osu="ch-latest"]').innerText()).trim()==='For testers'&&(await p.locator('[data-osu="ch-stable"]').innerText()).trim()==='For everyone',kind+' '+skin+': For testers / For everyone names');
      await tap('[data-osu="ch-latest"]');ok(channel==='latest',kind+' '+skin+': channel action/readback');
      await tap('[data-osu="ch-stable"]');
      await shot(skin+'-about');
      if(phone){const file=path.join(OUT,kind+'-'+skin+'-native-row.png');await p.locator('[data-settings-version="phone"]').screenshot({path:file});journal.shots.push(file);await shot(skin+'-about-native');}
      await p.evaluate(()=>WosUpdates.load(true)); // drain any prior coalesced read before changing the fixture
      available=false;await p.evaluate(()=>WosUpdates.load(true));
      await p.waitForFunction(()=>document.querySelector('.st-page')?.innerText.includes('could not be verified'));
      ok((await p.locator('.st-page:visible').innerText()).includes('could not be verified')&&await p.locator('[data-osu="ch-latest"],[data-osu-auto]').count()===0,kind+' '+skin+': missing route visible and fail-closed');
      await shot(skin+'-unavailable');
      const writesBeforeRetry=journal.writes.length;
      available=true;await tap('[data-osu="retry"]');await p.locator('[data-osu-auto]').waitFor();
      ok(journal.writes.length===writesBeforeRetry,kind+' '+skin+': retry is read-only');
      ok((await p.locator('[data-osu-auto]:visible').innerText()).includes('Install by themselves overnight'),kind+' '+skin+': read-only retry recovers verified mode');
      await p.evaluate(()=>WosUpdates.load(true));
      pending=true;await p.evaluate(()=>WosUpdates.load(true));
      ok((await p.locator('.st-page:visible').innerText()).includes('Wizard OS (server) 0.3.101'),kind+' '+skin+': installed version retained beside pending update');
      await tap('#settingsBody [data-osu="apply"]');ok(journal.writes.some(w=>w.path.endsWith('/store-install/_updates')&&w.body==='{"action":"apply"}'),kind+' '+skin+': original Install action intercepted');
      await p.evaluate(()=>WosUpdates.load(true));
      pending=false;await p.evaluate(()=>WosUpdates.load(true));
     }
     await back();ok(await p.locator('#settingsBody [data-st-page]:visible').count()>0,kind+' '+skin+': nearest Back returns to categories');
    }
    await tap('#settingsBody [data-st-page="about"]:visible');
    await p.waitForFunction(categoryReady,menu.find(entry=>entry.id==='about'));
    const opacity=await p.locator(phone?'#settings':'#dsettings').evaluate(el=>({background:getComputedStyle(el).backgroundColor,image:getComputedStyle(el).backgroundImage}));
    // Shared page backing itself is fully opaque; skins may additionally layer solid gradients.
    const panel=await p.locator(phone?'#settings':'#dsettings').evaluate(el=>({color:getComputedStyle(el).backgroundColor,image:getComputedStyle(el).backgroundImage}));
    ok(!/rgba\([^)]*,\s*0(?:\.\d+)?\)/.test(panel.color)&&panel.color!=='transparent',kind+' '+skin+': opaque text-bearing page', {opacity,panel});
    if(!phone){await p.locator('.dsettings-scrim').click({position:{x:2,y:2}});ok(await p.locator('#dsettings').isHidden(),skin+': outside dismiss leaves Home');}
    else {
     await p.locator('#scrim').tap({position:{x:2,y:2}});
     await p.waitForFunction(()=>__wos.sheet===null);
     const dismissal=await (await p.waitForFunction(phoneDismissed)).jsonValue();
     ok(dismissal.pass,skin+': one outside tap dismisses Settings to Home',dismissal);
    }
   }
   ok(journal.writes.every(w=>!w.path.endsWith('/v1/runs')),kind+': zero agent runs');
   await ctx.close();activePage=null;
  }
  const desktop=contexts.find(c=>c.kind==='desktop'),phone=contexts.find(c=>c.kind==='phone');
  if(desktop&&phone)for(const skin of ['nebula','obsidian-light']){
   const d=desktop.pages[skin],m=phone.pages[skin];
   ok(JSON.stringify(d.menu.filter(e=>e.id!=='phone'))===JSON.stringify(m.menu.filter(e=>e.id!=='phone')),skin+': identical common category labels/order');
   for(const id of Object.keys(d.content))if(m.content[id]){
    const normalize=v=>v.features.filter(f=>!['bar-voice-buttons','orb-switcher'].includes(f));
    ok(JSON.stringify(normalize(d.content[id]))===JSON.stringify(normalize(m.content[id])),skin+': common page registrations '+id);
   }
  }
  ok(errors.length===0,'no page errors',errors);flush();assert.equal(checks.filter(c=>!c.pass).length,0,'Settings acceptance failures');
 }catch(e){errors.push({error:String(e),expectedRed:!!e.expectedRed});
  if(activePage&&!activePage.isClosed()){
   try{activeJournal.failure={url:activePage.url(),state:await activePage.evaluate(()=>({welcome:window.__welcomeLog,overlay:!!document.querySelector('#wosWelcome'),active:document.activeElement?.outerHTML,settings:document.querySelector('#settingsBody')?.outerHTML}))};await activePage.screenshot({path:path.join(OUT,activeJournal.kind+'-failure.png'),timeout:5000});}catch(capture){errors.push({capture:String(capture)});}
  }
  flush();throw e;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
