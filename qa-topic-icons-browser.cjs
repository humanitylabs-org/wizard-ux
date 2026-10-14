const {chromium}=require(process.env.PLAYWRIGHT || '/Users/thales/workspace/wizard-mobile-link-candidate/node_modules/playwright');
const fs=require('fs'),crypto=require('crypto'),assert=require('assert');
const url='https://topic-icons.staging.wizard001.com/wizard-os-home/?open=chats';
const out=process.env.QA_OUT;fs.mkdirSync(out,{recursive:true});
const source=JSON.parse(fs.readFileSync(process.env.QA_HASHES,'utf8'));
const cases=[];const check=(v,name,detail)=>{cases.push({name,pass:!!v,detail});if(!v)throw Error(name+' '+JSON.stringify(detail));};
(async()=>{
 const b=await chromium.launch({headless:true});
 try{
 for(const mobile of [false,true]){
  const name=mobile?'phone':'desktop';
  const ctx=await b.newContext({viewport:mobile?{width:412,height:892}:{width:1440,height:960},isMobile:mobile,hasTouch:mobile,ignoreHTTPSErrors:true,...(mobile?{userAgent:'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'}:{})});
  const p=await ctx.newPage();const errors=[],writes=[],hashes={};
  p.on('pageerror',e=>errors.push(String(e)));
  p.on('response',r=>{const path=new URL(r.url()).pathname;const file=path.split('/wizard-os-home/')[1];if(source[file]&&r.ok())r.body().then(body=>{hashes[file]=crypto.createHash('sha256').update(body).digest('hex')}).catch(()=>{});});
  await ctx.route('**/*',r=>{const q=r.request();if(!['GET','HEAD'].includes(q.method())){writes.push(new URL(q.url()).pathname);return r.fulfill({status:403,contentType:'application/json',body:'{"error":"read-only preview"}'});}return r.continue();});
  if(process.env.QA_RED) await ctx.route('**/core/chats.js',async r=>{const response=await r.fetch();const body=await response.text();const fixed="    for (const id of Object.keys(CH)) {\n      const w = H.win(id), el = elOf(id);\n      if (w && !w.thread && el && el.querySelector('.ch-list') && !holdList(id)) renderChatList(w, el);\n    }";assert(body.includes(fixed));await r.fulfill({response,body:body.replace(fixed,"    for (const id of Object.keys(CH)) { const w = W[id]; if (w && !w.thread) renderChats(w); }")});});
  try{
   await p.goto(url,{waitUntil:'domcontentloaded'});
   await p.waitForFunction(()=>{const h=window.__wos||window.__wux;return h?.live.ok&&h.live.session('wizard_topics')&&document.querySelector('[data-thread-app="topics"]')},{},{timeout:90000});
   await p.waitForTimeout(4000);
   check(new URL(p.url()).hostname==='topic-icons.staging.wizard001.com',name+' exact HTTPS preview');
   check(await p.getAttribute('html','data-shell')===(mobile?'phone':'desktop'),name+' correct shell');
   check(await p.locator('#wiz-staging-tag').count()===1,name+' staging marker');
   const live=await p.evaluate(()=>{const h=window.__wos||window.__wux,s=h.live.session('wizard_topics'),r=document.querySelector('[data-chopen="wizard_topics"]'),ic=r.querySelector('.emo'),rect=r.getBoundingClientRect();return {id:s.id,appId:s.appId,eye:!!ic.querySelector('.sg-eye'),colour:ic.style.getPropertyValue('--c'),label:ic.getAttribute('aria-label'),top:rect.top,bottom:rect.bottom,scrollY,visible:rect.top>=0&&rect.bottom<=innerHeight}});
   check(live.id==='wizard_topics'&&live.appId==='topics'&&live.eye&&live.colour==='#0ED8BB',name+' real Topics row uses launcher sigil',live);
   check(live.visible&&live.scrollY===0,name+' review row is on screen without shell displacement',live);
   if(!process.env.QA_RED) check(Object.keys(source).every(k=>hashes[k]===source[k]),name+' actual response bytes match candidate',hashes);
   await p.screenshot({path:out+'/'+name+'.png'});
   // Browser-only registry fixture: no production metadata or session is written.
   let glyph='music';
   await ctx.route('**/wizard/v1/apps',async r=>{const response=await r.fetch(),data=await response.json();const apps=Array.isArray(data)?data:data.apps;const topic=apps.find(a=>a.id==='topics');topic.icon=glyph;topic.colors=[glyph==='eye'?'#0ED8BB':'#FE8AAA'];await r.fulfill({response,json:data});});
   const wid=await p.evaluate(()=>document.querySelector('[data-chopen="wizard_topics"]').closest('[data-chats]').dataset.chats);
   await p.evaluate(wid=>(window.__wos||window.__wux).chats.openRenameSheet(wid,'wizard_topics'),wid);
   await p.locator('.ch-rename input').fill('Unsaved Topics rename');
   await p.evaluate(()=>window.__savedRename=document.querySelector('.ch-rename input'));
   await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await p.waitForFunction(g=>window.WizCore.threadApp('topics').icon===g,glyph);await p.waitForTimeout(700);
   check(await p.evaluate(()=>window.__savedRename.isConnected&&window.__savedRename===document.querySelector('.ch-rename input')&&window.__savedRename.value==='Unsaved Topics rename'),name+' registry refresh preserves open rename and unsaved input');
   check(await p.locator('[data-thread-app="topics"] .sg-eye').count()===1,name+' icon repaint is held while rename is open');
   await p.locator('[data-rncancel]').click();
   await p.waitForFunction(()=>document.querySelector('[data-thread-app="topics"] .sg-music'),{},{timeout:16000});
   check(true,name+' queued registry glyph flushes after rename closes');
   await p.evaluate(wid=>(window.__wos||window.__wux).chats.openRowSheet(wid,'wizard_topics'),wid);
   glyph='eye';await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await p.waitForFunction(g=>window.WizCore.threadApp('topics').icon===g,glyph);await p.waitForTimeout(500);
   check(await p.locator('.ch-sheet').count()===1,name+' registry refresh preserves thread actions');
   await p.evaluate(()=>(window.__wos||window.__wux).chats.closeRowSheet());
   await p.waitForFunction(()=>document.querySelector('[data-thread-app="topics"] .sg-eye'),{},{timeout:16000});
   if(mobile){
    const box=await p.locator('[data-chopen="wizard_topics"]').boundingBox(),x=Math.floor(box.x+box.width*.7),y=Math.floor(box.y+box.height*.5);
    const cdp=await ctx.newCDPSession(p);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-22}]});
    await p.evaluate(()=>window.__savedList=document.querySelector('[data-chopen="wizard_topics"]').closest('.ch-list'));
    glyph='music';await p.evaluate(()=>{const app=window.WizCore.threadApp('topics');app.icon='music';app.colors=['#FE8AAA'];window.dispatchEvent(new CustomEvent('wizard:apps'));});await p.waitForTimeout(500);
    check(await p.evaluate(()=>window.__savedList.isConnected&&!!document.querySelector('[data-thread-app="topics"] .sg-eye')),name+' registry refresh preserves active touch-scroll nodes');
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await p.waitForFunction(()=>document.querySelector('[data-thread-app="topics"] .sg-music'),{},{timeout:16000});
    check(true,name+' registry update lands after touch lift');glyph='eye';await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await p.waitForFunction(g=>window.WizCore.threadApp('topics').icon===g,glyph);
    await p.waitForFunction(()=>document.querySelector('[data-thread-app="topics"] .sg-eye'),{},{timeout:16000});
   }
   // Click exact real thread, then use real browser Back after user activation.
   await p.evaluate(()=>document.querySelector('[data-chopen="wizard_topics"]').click());
   await p.waitForTimeout(1400);
   check(await p.evaluate(()=>Object.values((window.__wos||window.__wux).wins).some(w=>w.thread==='wizard_topics')),name+' actual Topics thread opens');
   await p.locator('.ch-compose textarea').fill('Unsaved icon-refresh draft');
   await p.evaluate(()=>window.__savedComposer=document.querySelector('.ch-compose textarea'));
   glyph='music';await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await p.waitForFunction(g=>window.WizCore.threadApp('topics').icon===g,glyph);await p.waitForTimeout(500);
   check(await p.evaluate(()=>window.__savedComposer.isConnected&&window.__savedComposer===document.querySelector('.ch-compose textarea')&&window.__savedComposer.value==='Unsaved icon-refresh draft'),name+' registry refresh leaves open thread and composer intact');
   glyph='eye';await p.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await p.waitForFunction(g=>window.WizCore.threadApp('topics').icon===g,glyph);
   await p.goBack();await p.waitForTimeout(1000);
   check(await p.evaluate(()=>!!(window.__wos||window.__wux)&&!Object.values((window.__wos||window.__wux).wins).some(w=>w.thread==='wizard_topics')),name+' Back returns to list and app stays open');
   await p.reload({waitUntil:'domcontentloaded'});await p.waitForFunction(()=>document.querySelector('[data-thread-app="topics"]'),{},{timeout:90000});
   check(await p.locator('[data-thread-app="topics"] .sg-eye').count()>=1,name+' sigil survives reload');
   check(errors.length===0,name+' zero page errors',errors);
   check(writes.every(x=>x.includes('/thread-seen')||x.includes('/thread-dispositions')),name+' only intercepted read-state writes',writes);
   if(mobile){await p.setViewportSize({width:360,height:640});await p.waitForTimeout(1000);const box=await p.locator('[data-thread-app="topics"]').first().boundingBox();check(box&&box.x>=0&&box.x+box.width<=360,name+' narrow-width icon fits',box);}
  }catch(e){await p.screenshot({path:out+'/'+name+'-failure.png'}).catch(()=>{});console.error('DIAGNOSTIC',JSON.stringify({url:p.url(),errors,body:(await p.locator('body').innerText().catch(()=>'' )).slice(0,5000),state:await p.evaluate(()=>{const h=window.__wos||window.__wux;return {shell:document.documentElement.dataset.shell,ok:h?.live.ok,error:h?.live.error,topic:h?.live.session('wizard_topics'),wins:h?.wins,ch:h?.chats.CH}}).catch(()=>null)}));throw e;}finally{await ctx.close();}
 }
 }finally{await b.close();fs.writeFileSync(out+'/result.json',JSON.stringify({host:require('os').hostname(),url,cases,pass:cases.filter(x=>x.pass).length,fail:cases.filter(x=>!x.pass).length},null,2));}
})().catch(e=>{console.error(e);process.exitCode=1;});
