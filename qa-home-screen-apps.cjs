// Run only on Thales under the shared worker lease. Real Wisdom/Signal GET data, never app fixtures.
// QA_ORIGIN=durable-staging-origin QA_OUT=/Volumes/ThalesMedia/... node qa-home-screen-apps.cjs
// QA_WEB_DIR may overlay exact candidate/baseline shell source for a focused negative control.
const os=require('os'),fs=require('fs'),path=require('path');
if(process.platform!=='darwin'||!os.hostname().toLowerCase().includes('thales'))throw Error('Thales-only browser QA');
const {chromium}=require(process.env.PW||'/Users/thales/workspace/wizard-mobile-link-candidate/node_modules/playwright');
const origin=new URL(process.env.QA_ORIGIN||'https://home-screen-apps.staging.wizard001.com').origin;
const out=process.env.QA_OUT;if(!out||!out.startsWith('/Volumes/ThalesMedia/'))throw Error('QA_OUT must be under ThalesMedia');
fs.mkdirSync(out,{recursive:true});const checks=[],blocked=[],errors=[];
const check=(name,pass,detail)=>{checks.push({name,pass:!!pass,detail});console.log(pass?'PASS':'FAIL',name,detail||'');};
(async()=>{const browser=await chromium.launch({headless:true});const ctx=await browser.newContext({viewport:{width:412,height:892},hasTouch:true,isMobile:true,serviceWorkers:'block'});let failure=null;
try{
 await ctx.route('**/*',r=>{
  const req=r.request(),u=new URL(req.url());
  if(!['GET','HEAD'].includes(req.method())){blocked.push({method:req.method(),url:req.url()});return r.abort('blockedbyclient');}
  if(process.env.QA_WEB_DIR&&u.origin===origin&&u.pathname.startsWith('/wizard-os-home/')){
   const rel=decodeURIComponent(u.pathname.slice('/wizard-os-home/'.length))||'index.html',root=path.resolve(process.env.QA_WEB_DIR,'web'),p=path.resolve(root,rel);
   if(!p.startsWith(root+path.sep))return r.abort('blockedbyclient');
   if(fs.existsSync(p)&&fs.statSync(p).isFile())return r.fulfill({body:fs.readFileSync(p),contentType:rel.endsWith('.js')?'text/javascript':rel.endsWith('.css')?'text/css':rel.endsWith('.html')?'text/html':'application/octet-stream'});
  }
  return r.continue();
 });
 await ctx.addInitScript(()=>{if(window!==top)return;localStorage.setItem('wos.coached','true');});
 const main=await ctx.newPage();main.on('pageerror',e=>errors.push(String(e)));await main.goto(origin+'/wizard-os-home/?shell=phone');await main.waitForFunction(()=>!!window.__wos);await main.evaluate(()=>WizCore.appsLoaded());
 const snapshot=()=>main.evaluate(()=>Object.fromEntries(['wins4','strip','idx4','recent'].map(k=>[k,localStorage.getItem('wos.'+k)])));
 const before=await snapshot();const pages={};
 for(const id of ['wisdom','wizard-signal']){
  const p=await ctx.newPage();pages[id]=p;p.on('pageerror',e=>errors.push(id+': '+String(e)));
  await p.goto(origin+'/wizard-os-home/?app-session='+id);await p.waitForTimeout(2200);
  const probe=await p.evaluate(()=>({id:window.__wos?.singleApp||null,frames:document.querySelectorAll('#singleApp iframe').length,workspace:!!window.__wos?.wins,chrome:[...document.querySelectorAll('#launcher,#dock,#orb,.statusbar,#track')].filter(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height&&getComputedStyle(e).display!=='none').map(e=>e.id)}));
  check(id+' uses one isolated frontend surface',probe.id===id&&probe.frames===1&&!probe.workspace,probe);
  check(id+' has no launcher/desk/orb/status chrome',probe.chrome.length===0,probe.chrome);
  if(probe.id===id){
   const registered=await p.evaluate(id=>WizCore.apps('mobile').APP[id]?.url,id),frame=p.frames().find(f=>f!==p.mainFrame());
   check(id+' resolves current registered real view',!!registered&&!!frame&&new URL(frame.url()).pathname.startsWith(new URL(registered,origin).pathname),frame?.url());
   await p.screenshot({path:path.join(out,id+'-fullscreen.png')});
   const route=frame?.url();for(let n=0;n<4;n++)await p.evaluate(()=>__wosNativeBack());
   check(id+' repeated root Back cannot reveal desks',await p.evaluate(()=>!!__wos.singleApp&&!__wos.wins));
   if(id==='wisdom'&&frame){const link=frame.locator('[data-wisdom-route*="/read/"]').first();if(await link.count()){
     await link.tap();await p.waitForTimeout(1000);const nested=frame.url();check('Wisdom opens actual nested chapter',nested!==route,nested);
     await p.evaluate(()=>__wosSessionCheckpoint());await p.reload();await p.waitForTimeout(2000);
     check('Wisdom shell refresh restores chapter route',p.frames().some(f=>f.url()===nested),nested);
     await p.evaluate(()=>__wosNativeBack());check('Wisdom nested Back keeps isolated fullscreen task',await p.evaluate(()=>__wos.singleApp==='wisdom'&&!__wos.wins));
   }else check('actual Wisdom chapter available for nested Back',false,'No actual chapter link found');}
  }
 }
 check('separate apps leave original workspace arrangement unchanged',JSON.stringify(before)===JSON.stringify(await snapshot()));
 const wisdom=pages.wisdom;await wisdom.bringToFront();check('switching retains Wisdom session identity',await wisdom.evaluate(()=>__wos?.singleApp==='wisdom'));
 // Pin UX: actual trusted browser pointer input; native OS confirmation is a separate emulator gate.
 await main.bringToFront();await main.evaluate(()=>__wos.openSheet('launcher'));const tile=main.locator('#launcher [data-app="wisdom"]').first();const box=await tile.boundingBox();
 if(box){await main.mouse.move(box.x+box.width/2,box.y+box.height/2);await main.mouse.down();await main.waitForTimeout(550);await main.mouse.up();await main.waitForTimeout(100);check('trusted hold opens one small pin action sheet',await main.locator('.home-pin-sheet').count()===1);
  const state=await main.evaluate(()=>WizHomeScreenApps?.state);check('finger release cannot issue a pin',state?.pending===false,state);
  if(state?.open){check('browser unsupported launcher explanation is honest',await main.locator('.home-pin-sheet button').textContent()==="Can't add on this device");await main.evaluate(()=>__wosNativeBack());check('Back closes pin sheet before Apps menu',await main.locator('.home-pin-sheet').count()===0&&await main.locator('#launcher').evaluate(e=>e.classList.contains('open')));}
 }else check('Wisdom launcher tile available for real hold',false);
 check('no page runtime errors',errors.length===0,errors);
}catch(e){failure=String(e);console.error(e);}finally{await ctx.close();await browser.close();const result={host:os.hostname(),source_revision:process.env.QA_SHA,scope:'real staging GET data; shell overlay only if QA_WEB_DIR set; not Android pin/task proof',checks,blockedWrites:blocked,actualBackendWrites:0,errors,failure};fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify(result,null,2));process.exitCode=failure||checks.some(c=>!c.pass)?1:0;}
})();
