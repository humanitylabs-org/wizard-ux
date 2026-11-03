'use strict';
// Synthetic registry + public static icon assets only. No Messenger or agent data.
const { chromium } = require('../tools/qa-playwright.cjs');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {assertReadOnlyFixture}=require('./notes-fixture-write-policy.cjs');
const ROOT=path.resolve(__dirname,'..'),F=process.env.QA_FIXTURE,OUT=process.env.QA_OUT;
const apps=JSON.parse(fs.readFileSync(path.join(F,'apps.json'))),logoData=JSON.parse(fs.readFileSync(path.join(F,'logos.json'))),changed=JSON.parse(fs.readFileSync(path.join(F,'changed.json'))),inventory=JSON.parse(fs.readFileSync(path.join(F,'inventory.json')));
fs.mkdirSync(OUT,{recursive:true});
const MIME={'.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.woff2':'font/woff2','.json':'application/json'};
let version='candidate',fresh=false;const requests=[];
const server=http.createServer((req,res)=>{
 const p=new URL(req.url,'http://localhost').pathname,r={method:req.method,path:p};requests.push(r);
 function send(data,type='application/json',status=200){r.status=status;res.writeHead(status,{'content-type':type,'cache-control':'no-store'});res.end(type==='application/json'?JSON.stringify(data):data);}
 if(req.method!=='GET'){r.refusedBeforeHandlers=true;return send({error:'fixture refuses writes'},'application/json',405);}
 if(p==='/wizard/v1/bootstrap')return send({bootstrap:1,settings:{agent:{name:'Wizard QA'}},capabilities:{},endpoints:{apps:'/wizard/v1/apps'}});
 if(p==='/wizard/v1/apps')return send({apps});
 if(p.endsWith('/wizard/v1/app-logos'))return send({logos:Object.fromEntries(Object.entries(logoData.logos).map(([id,h])=>[id,fresh?'fedcba9876543210':h]))});
 if(p.includes('/store-data/app-logo/')){const id=p.split('/').pop();return send(fs.readFileSync(path.join(F,'logos',id+'.jpg')),'image/jpeg');}
 if(p.startsWith('/fixture-app/'))return send('<!doctype html><html><title>Synthetic empty app</title><body>Empty icon fixture; no app data.</body></html>','text/html');
 if(p.endsWith('/wizard/v1/index/search'))return send({apps:[...changed.map(id=>({id,name:apps.find(a=>a.id===id).name,repo:'fixture/'+id,version:'0.1.0',summary:'Synthetic icon fixture',type:'service',logo:'https://fixtures.invalid/logo.jpg'})),{id:'unknown-logo',name:'Unknown logo',repo:'fixture/unknown-logo',version:'0.1.0',summary:'Preserve unknown artwork',type:'service',logo:'https://fixtures.invalid/logo.jpg'}],next_offset:null,sources:[]});
 if(p.endsWith('/api/apps/installed'))return send({installed:[]});
 if(p.endsWith('/wizard/v1/installed-apps'))return send({architecture:'amd64',wam:[],shell:[],complete:true});
 if(p.includes('/store-data/logo/'))return send(fs.readFileSync(path.join(F,'logos','messenger.jpg')),'image/jpeg');
 if(p.includes('/api/')||p.includes('/wizard/v1/')||p.startsWith('/wizard/hermes/')||p.includes('/store-data/')||p==='/launcher.json'){
  if(p.endsWith('/model/options'))return send({provider:'qa',providers:[{slug:'qa',authenticated:true}]});
  if(p.endsWith('/setup'))return send({first_run:false,seen:true});
  if(p.endsWith('/config'))return send({settings:{agent:{name:'Wizard QA'}}});
  if(/\/agents\/?$/.test(p))return send({agents:[]});
  if(/sessions|threads/.test(p))return send({sessions:[],threads:[],has_more:false});
  return send({apps:[],agents:[],items:[],entries:[],children:[],sessions:[],settings:{},ok:true});
 }
 if(!p.startsWith('/wizard-os-home/'))return send({},'application/json',404);
 let file=path.resolve(ROOT,'web',p.slice('/wizard-os-home/'.length)||'index.html');
 if(!file.startsWith(path.join(ROOT,'web')+path.sep))return send({},'application/json',403);
 if(version==='baseline'&&p==='/wizard-os-home/core/sigils.js')file=path.join(F,'baseline-sigils.js');
 try{if(fs.statSync(file).isDirectory())file=path.join(file,'index.html');send(fs.readFileSync(file),MIME[path.extname(file)]||'application/octet-stream');}catch{send({},'application/json',404);}
});
function style(el){const s=getComputedStyle(el),g=el.querySelector('.sgi,.sglogo'),q=g&&getComputedStyle(g);return {class:el.className,child:g?.className,bg:s.backgroundColor,image:s.backgroundImage,border:s.borderColor,shadow:s.boxShadow,mask:q?.maskImage,logo:q?.getPropertyValue('--logo')};}
async function settle(page,selector){await page.locator(selector).first().waitFor({state:'visible'});await page.evaluate(async sel=>{
 const el=document.querySelector(sel);if(!el)throw Error('missing '+sel);document.body.getBoundingClientRect();await document.fonts.ready;
 const end=performance.now()+4500;let last='',stable=0,reason='unsettled';
 while(performance.now()<end){await new Promise(requestAnimationFrame);const r=el.getBoundingClientRect(),s=getComputedStyle(el);let running=false,hidden=false;
 for(let a=el;a;a=a.parentElement){const c=getComputedStyle(a);hidden||=+c.opacity<.99||c.visibility==='hidden'||c.filter.includes('blur(');running||=a.getAnimations().some(v=>v.playState==='running'&&v.effect.getTiming().iterations!==Infinity);}
 const mark=JSON.stringify([r.x,r.y,r.width,r.height,s.transform]);stable=mark===last&&!running&&!hidden?stable+1:0;last=mark;
 if(stable>=5){const x=r.x+r.width/2,y=r.y+r.height/2;if(r.width<8||r.height<8||x<0||y<0||x>innerWidth||y>innerHeight){reason='clipped';continue;}if(!el.contains(document.elementFromPoint(x,y))){reason='covered';continue;}return;}}
 throw Error(reason+' '+sel);
},selector);}
async function rowFor(page,shell,id){
 const resolved=await page.evaluate(({shell,id})=>{
  const registry=window.WizCore.apps(shell==='phone'?'mobile':'desktop'),a=registry.APP[id];
  return a?{id:a.id,name:a.name}:null;
 },{shell,id});
 assert.ok(resolved,'requested app must resolve through actual shell registry: '+shell+'/'+id);
 if(shell==='phone')return '#launcher.open [data-app="'+resolved.id+'"]';
 const name=resolved.name;
 const target=page.locator('#palette:not([hidden]) .pal-app').filter({has:page.locator('.nm',{hasText:new RegExp('^'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$')})});
 await target.waitFor({state:'visible'});return '#palette:not([hidden]) #'+await target.getAttribute('id');
}
// Food is source-declared native/phone-only, never a desktop picker row.
// Keep its desktop artwork + exact shared outline coverage as an explicitly
// synthetic renderer control, not an injected production picker result.
async function foodDesktopControl(page){
 return page.evaluate(()=>{
  const C=window.WizCore,desktop=C.apps('desktop');
  if(desktop.APP.food||desktop.APPS.some(a=>a.id==='food'||a.id==='usuals'))throw Error('Food unexpectedly desktop-launchable');
  const metadata=C.appMetadata('food');if(!metadata)throw Error('missing actual Food metadata');
  const rule=window.WizDeviceLegacy.find(d=>d.appId==='food');
  if(rule?.phoneOnly!==true||rule.probe!=='usuals')throw Error('Food platform contract changed');
  const panel=document.createElement('section');panel.id='qa-food-desktop';
  panel.style.cssText='position:fixed;right:16px;top:16px;z-index:2147483647;padding:16px;background:var(--wz-base);color:var(--wz-text);';
  panel.innerHTML='<div class="pal-app sel">'+window.WizSigil.box('span','ic',metadata)+'<span class="nm">Food — shared renderer control (phone-only app)</span></div>';
  document.body.append(panel);return {metadata,rule,desktopPickerAbsent:true,surface:'shared-renderer-control-not-launcher'};
 });
}
async function switchSkin(page,shell,skin){
 // Open the real shell Settings and use the real Look colour control.
 if(shell==='phone')await page.evaluate(()=>window.__wos.openSheet('settings'));
 else await page.evaluate(()=>window.__wux.openSettings('look'));
 const root=shell==='phone'?'#settings':'#dsettings';
 const look=page.locator(root+' [data-st-page="appearance"]');
 if(await look.isVisible())await look.click();
 await page.evaluate(()=>{window.__qaSkinClick=null;document.addEventListener('click',e=>{const b=e.target.closest('[data-skinpick]');if(b)window.__qaSkinClick={id:b.dataset.skinpick,trusted:e.isTrusted};},{capture:true,once:true});});
 await page.locator(root+' [data-skinpick="'+skin+'"]').click();
 await page.waitForFunction(s=>document.documentElement.dataset.skin===s&&window.WosSkin.current===s,skin);
 const receipt=await page.evaluate(()=>window.__qaSkinClick);assert.deepEqual(receipt,{id:skin,trusted:true});
 if(shell==='phone')await page.evaluate(()=>window.__wos.openSheet('launcher'));
 else{await page.evaluate(()=>window.__wux.closeSettings());await page.keyboard.press('Alt+o');}
 await page.waitForFunction(()=>!document.querySelector('.mz-intro'));
 return receipt;
}
async function shot(page,name,selector){await settle(page,selector);await page.screenshot({path:path.join(OUT,name+'.png')});return name+'.png';}
async function gallery(page,v,shell,skin){
 await page.evaluate(ids=>{
  const g=document.createElement('section');g.id='qa-contact';g.style.cssText='position:fixed;inset:12px;z-index:2147483647;overflow:auto;padding:16px;background:var(--wz-base,#101014);color:var(--wz-text,#fff);display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));align-content:start;gap:18px;border:2px solid var(--wz-text,#fff);';
  g.innerHTML=ids.map(id=>{const a=window.WizCore.apps('mobile').APP[id]||window.WizCore.apps('desktop').APP[id]||{id,name:id};return '<div class="lapp" style="text-align:center;display:grid;justify-items:center;gap:8px">'+window.WizSigil.box('span','ic',a)+'<span style="font:14px system-ui">'+a.name+'</span></div>';}).join('');document.body.append(g);
 },changed);
 const screenshot=await shot(page,[v,shell,skin,'contact-sheet'].join('-'),'#qa-contact');
 const data=await page.locator('#qa-contact').evaluate(e=>({background:getComputedStyle(e).backgroundColor,icons:[...e.querySelectorAll('.ic')].map(x=>({html:x.innerHTML,color:x.style.getPropertyValue('--c')}))}));
 assert.equal(data.icons.length,changed.length);assert.doesNotMatch(data.background,/rgba\([^)]*,\s*0\)/);await page.locator('#qa-contact').evaluate(e=>e.remove());return {screenshot,...data};
}
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});const report={changed,cases:[],galleries:[],inventory:[],environments:[],skinSwitches:[],pageErrors:[],failures:[]};
 try{
 for(const v of ['candidate','baseline']){version=v;fresh=false;
  for(const shell of ['phone','desktop']){
   fresh=false;
   const context=await browser.newContext({viewport:shell==='phone'?{width:390,height:844}:{width:1440,height:1000},hasTouch:shell==='phone',isMobile:shell==='phone',deviceScaleFactor:1,serviceWorkers:'block',...(shell==='phone'?{userAgent:'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'}:{})});
   try{
    await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
    await context.addInitScript(({shell,logos})=>{if(shell==='phone')window.WizardOSNative={usuals:()=>JSON.stringify([])};localStorage.setItem('wux.shell',shell);localStorage.setItem('wos.skin','obsidian');localStorage.setItem('wos.welcome.v1','done');localStorage.setItem('wos.onboarded','1');localStorage.setItem('wos.coached','true');localStorage.setItem('wos.tour.v1','true');localStorage.setItem('wux.applogos.v1',JSON.stringify(Object.fromEntries(Object.entries(logos).map(([id,h])=>[id,'/wizard-os-home/store-data/app-logo/'+id+'?v='+h]))));},{shell,logos:logoData.logos});
    const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',e=>report.pageErrors.push({v,shell,message:e.message}));
    await page.goto(origin+'/wizard-os-home/'+(shell==='desktop'?'desktop.html':'')+'?shell='+shell,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(shell=>document.documentElement.dataset.shell===shell&&(shell==='phone'?window.__wos?.openSheet:window.__wux?.openPicker)&&window.WizConfig?.live&&window.WizCore?.apps?.(shell==='phone'?'mobile':'desktop').APP?.messenger&&window.WizSigil&&window.WosSkin,shell);
    await page.evaluate(()=>window.WizCore.appsLoaded());
    report.environments.push({v,shell,...await page.evaluate(()=>({width:innerWidth,height:innerHeight,userAgent:navigator.userAgent,touch:navigator.maxTouchPoints}))});
    report.inventory.push({v,shell,rows:await page.evaluate(({rows,shell})=>rows.map(r=>{const a=window.WizCore.apps(shell==='phone'?'mobile':'desktop').APP[r.id],metadata=window.WizCore.appMetadata(r.id);return {id:r.id,registry:a?{id:a.id,name:a.name}:null,metadata:metadata||null,result:window.WizSigil.of(metadata||{id:r.id}),html:window.WizSigil.html(metadata||{id:r.id})};}),{rows:inventory,shell})});
    if(shell==='phone')await page.evaluate(()=>window.__wos.openSheet('launcher'));else{await page.keyboard.press('Alt+o');await page.locator('#palette:not([hidden])').waitFor({state:'visible'});}
    for(const skin of ['obsidian','obsidian-light']){
     report.skinSwitches.push({v,shell,skin,receipt:await switchSkin(page,shell,skin)});
     report.galleries.push({v,shell,skin,...await gallery(page,v,shell,skin)});
     for(const id of (v==='candidate'?changed:['messenger'])){
      // Move off the tile before every case/skin; hovering an already-hovered tile emits no event.
      const calendar=await rowFor(page,shell,'wizard-calendar');await page.locator(calendar).scrollIntoViewIfNeeded();await page.locator(calendar).hover();
      const foodControl=shell==='desktop'&&id==='food'?await foodDesktopControl(page):null;
      const row=foodControl?'#qa-food-desktop .pal-app':await rowFor(page,shell,id),ic=row+' .ic';await page.locator(row).scrollIntoViewIfNeeded();await settle(page,ic);const before=await page.locator(ic).evaluate(style);
      await page.locator(row).hover();await settle(page,ic);const hovered=await page.locator(ic).evaluate(style),screenshot=await shot(page,[v,shell,skin,id].join('-'),ic);
      const isMask=/\bsgi\b/.test(hovered.child||'')&&!/\bsglogo\b/.test(hovered.child||'');report.cases.push({v,shell,skin,id,surface:foodControl?'shared-renderer-control-not-launcher':'picker',foodControl,before,hovered,isMask,screenshot});
      if(v==='baseline'){assert.equal(isMask,false,'baseline Messenger must reproduce package-logo override');assert.match(hovered.logo,/messenger\?v=/);}
      else{assert.equal(isMask,true,id+' uses existing shared mask');assert.ok(hovered.mask&&hovered.mask!=='none');assert.equal(hovered.logo,'');if(shell==='desktop'){assert.equal(await page.locator(row).evaluate(e=>e.classList.contains('sel')),true);assert.match(hovered.shadow,/^rgba\(225, 214, 255, 0\.8\) 0px 0px 0px 2px,/,'shared white hover outline');}}
      if(foodControl)await page.locator('#qa-food-desktop').evaluate(e=>e.remove());
     }
    }
    if(v==='candidate'){
     fresh=true;await page.evaluate(()=>window.WizCore.refreshApps());await page.waitForFunction(()=>window.WizCore.appLogo('messenger').endsWith('fedcba9876543210'));
     const refreshed=await page.evaluate(ids=>ids.map(id=>({id,html:window.WizSigil.html({id})})),changed);assert.ok(refreshed.every(x=>!x.html.includes('sglogo')));report.cases.push({v,shell,surface:'metadata-refresh',rows:refreshed});
     const messenger=await rowFor(page,shell,'messenger');await page.locator(messenger).scrollIntoViewIfNeeded();await page.locator(messenger).click();
     const frame='iframe[title="Messenger"]';await page.locator(frame).waitFor({state:'visible'});
     await page.waitForFunction(()=>[...document.querySelectorAll('iframe[title="Messenger"]')].some(f=>f.contentDocument?.title==='Synthetic empty app'));
     const windowIdentity=await page.locator(frame).evaluate(f=>{const w=f.closest('.win,.dwin');return {header:w?.querySelector('.wbar')?.innerHTML,marks:[...document.querySelectorAll('.dsg .sgi')].map(g=>g.className)};});
     assert.match(windowIdentity.header||'',/sg-chats/,'real Messenger window header shares restored mask');assert.doesNotMatch(windowIdentity.header||'',/sglogo/);
     const screenshot=await shot(page,[v,shell,'messenger-window'].join('-'),frame);report.cases.push({v,shell,surface:'messenger-window',windowIdentity,screenshot});
    }
   }catch(e){report.failures.push({v,shell,message:e.message,stack:e.stack,registry:await context.pages()[0]?.evaluate(()=>({mobile:window.WizCore?.apps('mobile').APPS.map(a=>({id:a.id,name:a.name})),desktop:window.WizCore?.apps('desktop').APPS.map(a=>({id:a.id,name:a.name})),deviceLegacy:window.WizDeviceLegacy})).catch(()=>null)});for(const p of context.pages())await p.screenshot({path:path.join(OUT,'REJECTED-'+v+'-'+shell+'.png')}).catch(()=>{});}
   finally{fs.writeFileSync(path.join(OUT,'progress.json'),JSON.stringify(report,null,2));await context.close();}
  }
 }
 version='candidate';const standalone=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'});
 await standalone.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
 await standalone.goto(origin+'/wizard-os-home/store/',{waitUntil:'domcontentloaded'});await standalone.locator('#refresh').waitFor();
 await standalone.waitForFunction(()=>!document.getElementById('refresh').disabled);
 await standalone.locator('#q').fill('Messenger');await standalone.locator('#results .row .sg-chats').waitFor({state:'visible'});
 await standalone.screenshot({path:path.join(OUT,'store-standalone-dark-messenger.png')});
 report.standaloneStore={skin:await standalone.locator('html').getAttribute('data-skin'),messenger:await standalone.locator('#results .row .ic').first().evaluate(style)};
 assert.equal(report.standaloneStore.skin,'dark');assert.match(report.standaloneStore.messenger.child,/sg-chats/);
 await standalone.locator('#q').fill('Unknown logo');await standalone.locator('#results .row .ic img').waitFor({state:'visible'});
 report.standaloneStore.unknownLogoPreserved=true;await standalone.screenshot({path:path.join(OUT,'store-standalone-dark-unknown.png')});await standalone.close();
 report.writes=requests.filter(r=>r.method!=='GET');report.writePolicy=assertReadOnlyFixture(requests);report.requests=requests;
 fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2));
 assert.equal(report.failures.length,0,JSON.stringify(report.failures));assert.equal(report.pageErrors.length,0);assert.equal(report.cases.length,changed.length*4+4+2+2);assert.equal(report.galleries.length,8);
 console.log('PASS',JSON.stringify({cases:report.cases.length,galleries:report.galleries.length,changed:changed.length,inventory:inventory.length,acceptedMutations:report.writePolicy.acceptedMutations.length,refusedBootWrites:report.writePolicy.refusedShellBootstrap.length}));
 }catch(e){fs.writeFileSync(path.join(OUT,'failure.json'),JSON.stringify({message:e.message,stack:e.stack,report,requests},null,2));throw e;}
 finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
