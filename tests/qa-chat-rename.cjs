'use strict';
// Full shell, synthetic HTTPS origin only. No owner data, sends or live writes.
const {chromium}=require('../tools/qa-playwright.cjs');
const {ownerRead}=require('../tools/qa-desktop-frame-fixture.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=process.env.QA_OUT||'rename-evidence';fs.mkdirSync(out,{recursive:true});
const origin='https://rename.test',prefix='/wizard-os-home/',id='synthetic-rename';
(async()=>{
 const browser=await chromium.launch();const results=[];
 try {for(const phone of [false,true]) {
  const name=phone?'phone':'desktop',errors=[],writes=[],blocked=[];
  let title='Old title',patches=0,stale=0,detailRelease,detailHeld=false;
  // Timestamps relative to the run: a fixed date ages out of the list a day later and the row never shows.
  const T=Math.floor(Date.now()/1000)-600;
  const row=t=>({id,title:t,source:'wizard-mobile',status:'completed',archived:false,hidden:false,message_count:2,started_at:T-1000,last_active:T,wizard_last_user_at:T-500,wizard_last_assistant_at:T,last_user_message:{role:'user',content:'Synthetic question',timestamp:T-500},latest_message:{role:'assistant',content:'Synthetic answer',timestamp:T}});
  const context=await browser.newContext({viewport:phone?{width:412,height:892}:{width:1440,height:960},isMobile:phone,hasTouch:phone,serviceWorkers:'block'});
  await context.routeWebSocket('**/*',ws=>ws.close());
  await context.addInitScript(({phone})=>{
   for(const[k,v]of Object.entries({'wos.coached':'true','wos.tour.v1':'true','wos.welcome.v1':'done','wos.skin':'nebula','wos.shell':phone?'mobile':'desktop'}))if(localStorage.getItem(k)===null)localStorage.setItem(k,v);
  },{phone});
  await context.route('**/*',async r=>{
   const q=r.request(),u=new URL(q.url());
   if(u.origin!==origin){blocked.push(q.url());return r.abort();}
   if(u.pathname.includes('/v1/runs')){blocked.push(q.url());return r.abort();}
   if(q.method()==='PATCH'&&u.pathname===`/wizard/hermes/api/sessions/${id}`){
    patches++;writes.push({method:q.method(),path:u.pathname,body:q.postDataJSON()});
    await new Promise(resolve=>setTimeout(resolve,5000));title=q.postDataJSON().title;stale=2;
    return r.fulfill({json:row(title)});
   }
   if(!['GET','HEAD'].includes(q.method())){writes.push({method:q.method(),path:u.pathname,refused:true});return r.fulfill({status:405,json:{error:'Synthetic read-only fixture'}});}
   if(u.pathname==='/wizard/v1/ui-preferences')return r.fulfill({json:{migrations:{'launcher-seed-v1':true}}});
   if(u.pathname==='/wizard/v1/agents')return r.fulfill({json:{agents:[{id:'hermes',is_default:true,label:'Wizard',privacy:'standard',status:'running'}]}});
   if(u.pathname==='/wizard/hermes/api/sessions')return r.fulfill({json:{data:[row(stale-->0?'Old title':title)],has_more:false}});
   if(u.pathname===`/wizard/hermes/api/sessions/${id}`){const captured=row(title);if(detailHeld){detailHeld=false;await new Promise(resolve=>{detailRelease=resolve;});}return r.fulfill({json:captured});}
   if(u.pathname.startsWith('/wizard/'))return r.fulfill({json:ownerRead(u.pathname)});
   if(u.pathname.startsWith(prefix)){
    const root=path.resolve(__dirname,'../web'),file=path.resolve(root,u.pathname.slice(prefix.length)||'index.html');
    if(file.startsWith(root+path.sep)&&fs.existsSync(file)&&fs.statSync(file).isFile())return r.fulfill({path:file});
   }
   return r.fulfill({status:404,body:''});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+prefix+(phone?'index.html':'desktop.html'));
  await page.waitForFunction(()=>window.WizLive?.ok&&window.WosExperience&&!WosExperience.state.busy);
  await page.evaluate(()=>document.getElementById('wosWelcome')?.remove());
  if(phone)await page.evaluate(()=>__wos.openApp(WizCore.apps('mobile').APPS.find(a=>a.id==='wizard')));
  const selector=phone?`.ch-row[data-chopen="${id}"]`:`.aad-rw[data-sid="${id}"] .aad-row`;
  await page.locator(selector).first().waitFor({state:'visible'});
  // Start a real detail read before the write; deliver it only after a confirming poll.
  detailHeld=true;await page.evaluate(id=>{window.renameOldDetail=WizLive.sessionInfo(id);},id);
  await page.waitForTimeout(100);
  if(phone)await page.locator(selector).first().dispatchEvent('contextmenu');else await page.locator(selector).first().click({button:'right'});
  await page.getByRole('button',{name:'Rename',exact:true}).or(page.getByRole('menuitem',{name:'Rename',exact:true})).click();
  await page.getByRole('textbox',{name:'Thread name'}).fill('Owner title');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  assert.equal(await page.evaluate(id=>WizLive.session(id).title,id),'Owner title','same-frame pending title');
  assert.ok((await page.locator(selector).first().innerText()).includes('Owner title'),'pending title visibly painted before PATCH response');
  await page.evaluate(()=>WizLive.refresh());
  assert.equal(await page.evaluate(id=>WizLive.session(id).title,id),'Owner title','stale poll during five-second PATCH');
  assert.ok((await page.locator(selector).first().innerText()).includes('Owner title'),'stale pending poll preserves visible title');
  await page.waitForTimeout(5200);
  for(let i=0;i<4;i++)await page.evaluate(()=>WizLive.refresh());
  if(detailRelease)detailRelease();await page.evaluate(()=>window.renameOldDetail);
  assert.equal(await page.evaluate(id=>WizLive.session(id).title,id),'Owner title','late pre-write detail fenced');
  assert.equal(patches,1,'only one rename PATCH');
  for(const skin of ['nebula','obsidian']){
   await page.evaluate(skin=>WosSkin.set(skin),skin);
   await page.waitForFunction(()=>!WosExperience.state.busy);
   await page.waitForTimeout(500);
   assert.ok((await page.locator(selector).first().innerText()).includes('Owner title'),'visible shared list title');
   await page.screenshot({path:path.join(out,`${name}-${skin}.png`)});
  }
  await page.reload();await page.waitForFunction(id=>window.WizLive?.ok&&WizLive.session(id)?.title==='Owner title',id);
  assert.equal(patches,1,'reload required no second write');
  assert.deepEqual(blocked,[]);assert.deepEqual(errors,[]);
  assert.ok(writes.every(w=>w.path===`/wizard/hermes/api/sessions/${id}`||w.refused),'only synthetic rename accepted');
  results.push({name,patches,title,writes,errors,blocked});await context.close();
 }}finally{await browser.close();fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(results,null,2));}
 console.log(JSON.stringify(results));assert.equal(results.length,2);
})().catch(e=>{console.error(e);process.exit(1);});
