// Both real shells, fixture-only reads, no writes or agent runs.
const {chromium}=require('../tools/qa-playwright.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({headless:true});let results=[];
try {for(const shell of ['phone','desktop']){
 const ctx=await browser.newContext({viewport:{width:shell==='phone'?390:1280,height:844},isMobile:shell==='phone',hasTouch:shell==='phone',serviceWorkers:'block'});
 await ctx.addInitScript(shell=>{localStorage.setItem('wos.shell',shell);},shell);
 const errors=[],writes=[],runs=[],posts=[];const installedNow=[{id:'shared',name:'Shared app',type:'view',repo:'o/r',commit:'b'.repeat(40),source:'link',state:'running'}];
 await ctx.route('**/*',async r=>{
  const req=r.request(),u=new URL(req.url());
  if(u.pathname.includes('/v1/runs')){runs.push(req.url());return r.abort();}
  if(req.method()==='POST'&&u.pathname.includes('/store-install/')){posts.push(JSON.parse(req.postData()||'{}'));return r.fulfill({status:409,json:{error:'Refused by test.'}});}
  if(!['GET','HEAD'].includes(req.method())){writes.push(req.method()+' '+u.pathname);return r.abort();}
  if(u.pathname.includes('/store-data/')){
   if(u.pathname.includes('/index/search'))return r.fulfill({json:{apps:[],sources:[],next_offset:null}});
   if(u.pathname.endsWith('/wizard/v1/link'))return r.fulfill({json:{id:'shared',name:'Shared app',type:'view',repo:'o/r',commit:'a'.repeat(40),source:'link'}});
   if(u.pathname.endsWith('/wizard/v1/installed-apps'))return r.fulfill({json:{complete:true,wam:installedNow,shell:[]}});
   return r.fulfill({json:{installed:[],architecture:'amd64',models:[]}});
  }
  if(u.pathname.startsWith('/wizard-os-home/')){
   const file=path.join(__dirname,'../web',u.pathname.slice('/wizard-os-home/'.length)||'index.html');
   if(fs.existsSync(file)&&fs.statSync(file).isFile())return r.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream',body:fs.readFileSync(file)});
  }
  if(u.pathname.endsWith('/v1/apps'))return r.fulfill({json:{apps:[]}});
  return r.fulfill({json:{sessions:[],agents:[],apps:[],connected:false}});
 });
 const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));
 await p.goto('https://shell.test/wizard-os-home/'+(shell==='desktop'?'desktop.html':'')+'?view=install&repo=o/r&from=Jane');
 await p.waitForFunction(()=>Array.from(document.querySelectorAll('iframe')).some(f=>f.src.includes('/store/index.html'))).catch(e=>{console.error(shell,errors);throw e;});
 let f=p.frames().find(f=>f.url().includes('/store/index.html'));await f.locator('[data-link-install]').waitFor();
 assert.match(await f.locator('#sheet').innerText(),/Shared with you by Jane/);await f.locator('#sheet [data-back]').click();assert.ok(await f.locator('#discover').isVisible());
 // A second link reuses the same Store frame, preserves its prior screen, and invalid input never blanks.
 await p.evaluate(()=>window.WizCore.deeplink.route(location.origin+'/wizard-os-home/?view=install&repo=bad'));
 assert.equal(p.frames().filter(f=>f.url().includes('/store/index.html')).length,1);
 await f.locator('.link-error').waitFor();await f.locator('#sheet [data-back]').click();assert.ok(await f.locator('#discover').isVisible());
 // Store root hands Back to the shell (phone → Home, desktop closes the window): it must not consume it.
 assert.equal(await f.evaluate(()=>window.__wizardCloseOverlay()),false);
 // Same repo installed at another commit: the pinned link offers Switch (not Open) and posts operation switch.
 await p.evaluate(()=>window.WizCore.deeplink.route(location.origin+'/wizard-os-home/?view=install&repo=o/r&commit='+'a'.repeat(40)+'&from=Jane'));
 await f.locator('[data-link-install]').waitFor();assert.match(await f.locator('[data-link-install]').innerText(),/Switch to this release/);
 await f.locator('[data-link-install]').click();await f.locator('.link-error').waitFor();
 assert.deepEqual(posts,[{source:'link',repo:'o/r',commit:'a'.repeat(40),operation:'switch'}]);
 await f.locator('#sheet [data-back]').click();assert.ok(await f.locator('#discover').isVisible());
 assert.ok(writes.every(w=>w==='PUT /wizard/thread-seen'),JSON.stringify(writes));assert.deepEqual(runs,[]);assert.deepEqual(errors,[]);
 results.push({shell,deepLink:true,reused:true,badLink:true,backStays:true,rootBackToShell:true,pinnedSwitch:true,writes:writes.length,runs:runs.length});await ctx.close();
 }}finally{await browser.close();}console.log(JSON.stringify({passed:results.length,results},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
