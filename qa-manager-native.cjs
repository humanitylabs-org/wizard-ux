// Run on Thales. Candidate assets over the live entry URL; isolated browser storage.
// Real canonical IDs/history are read-only. Every mutation is intercepted (never sent).
const fs=require('fs'), path=require('path'), assert=require('assert/strict');
const {chromium}=require(process.env.PW);
const ROOT=process.env.QA_WEB_DIR||__dirname, MANAGER=process.env.QA_MANAGER_DIR;
const BASE=process.env.QA_URL, OUT=process.env.QA_OUT;
const checks=[],receipts=[]; fs.mkdirSync(OUT,{recursive:true});
function ok(name,value,detail){checks.push({name,pass:!!value,detail});console.log(value?'PASS':'FAIL',name,JSON.stringify(detail||''));assert(value,name);}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function run(browser,mobile){
 const label=mobile?'phone':'desktop', ctx=await browser.newContext({viewport:mobile?{width:412,height:892}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile,ignoreHTTPSErrors:true,permissions:['microphone'],serviceWorkers:'block'});
 const writes=[],errors=[],served=[];
 const res=await ctx.request.get(new URL('/wizard/hermes/api/sessions?limit=30',BASE).href);
 assert(res.ok(),'live canonical inventory readable'); const inventory=await res.json();
 const sessions=inventory.data||inventory.sessions||[];
 const selected=sessions.find(s=>s.id&&!['running','queued','waiting_for_approval'].includes(s.status)&&s.message_count>2)||sessions.find(s=>s.id);
 assert(selected,'real canonical ID required'); const sid=selected.id;
 const R={messages:Array.from({length:24},(_,i)=>({id:i+1,role:'assistant',kind:'ready',source_id:sid,title:'QA fixture work '+(i+1),text:'Synthetic catch-up summary. '.repeat(8),created:1700000000+i})),text:'Synthetic QA voice reply'};
 const json=(r,x,status=200)=>r.fulfill({status,contentType:'application/json',body:JSON.stringify(x)});
 await ctx.route('**/*',async r=>{
  const q=r.request(),u=new URL(q.url());
  if(!['GET','HEAD'].includes(q.method())){
   writes.push({path:u.pathname,body:u.pathname==='/wizard/thread-seen'?{intercepted:true}:/json/.test(q.headers()['content-type']||'')?q.postDataJSON():{binary:true,bytes:q.postDataBuffer()?.length||0}});
   if(/\/transcribe$/.test(u.pathname))return json(r,{text:R.text,ms:1});
   if(/\/(?:files|v1)\/uploads$/.test(u.pathname))return json(r,{error:'Synthetic QA uses bounded upload route'},404);
   if(/\/files\/upload$/.test(u.pathname)){const attachment=q.headers()['x-wizard-filename']==='qa-native.txt';return json(r,{file:attachment?{id:'qa-attachment',filename:'qa-native.txt',mime:'text/plain',bytes:18}:{id:'qa-audio',filename:'qa.webm',mime:'audio/webm',bytes:4096}});}
   if(/\/v1\/runs$/.test(u.pathname))return json(r,{run_id:'qa-run',status:'queued'},202);
   if(/\/route$/.test(u.pathname))return json(r,{cmd:{route:'agent'},ms:1});
   return json(r,{accepted:true});
  }
  if(u.pathname==='/wizard/thread-seen')return json(r,{state:{initializedAt:Date.now(),threads:{}}});
  if(u.pathname==='/wizard-manager/api/state')return json(r,{enabled:true,messages:R.messages.filter(m=>m.id>Number(u.searchParams.get('after')||0)),jobs:[]});
  for(const [prefix,dir]of[['/wizard-os-home/',ROOT],['/wizard-manager/',MANAGER]])if(u.pathname.startsWith(prefix)&&!u.pathname.slice(prefix.length).startsWith('api/')){
   const rel=u.pathname.slice(prefix.length)||'index.html',p=path.resolve(dir,'web',rel);
   if(p.startsWith(path.resolve(dir,'web')+path.sep)&&fs.existsSync(p)&&fs.statSync(p).isFile()){served.push(rel);return r.fulfill({status:200,contentType:({'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'})[path.extname(p)]||'application/octet-stream',body:fs.readFileSync(p)});}
  }
  return r.continue();
 });
 await ctx.addInitScript(()=>{if(window!==top)return;localStorage.setItem('wos.coached','true');localStorage.setItem('wos.voiceTipSeen','true');});
 const p=await ctx.newPage();p.on('pageerror',e=>errors.push(String(e)));
 const entry=BASE+'?open=wizard-manager'+(mobile?'&shell=phone':'&shell=desktop');
 await p.goto(entry);await p.waitForFunction(m=>m?!!window.__wos:!!window.__wux,mobile);
 await p.waitForFunction(()=>[...document.querySelectorAll('iframe')].some(f=>f.src.includes('/wizard-manager/')&&f.contentWindow?.WizardApp?.hosted));
 let f=p.frames().find(x=>x.url().includes('/wizard-manager/'));
 await f.waitForFunction(()=>document.querySelector('[data-message-id="24"]'));
 ok(label+' entry opens Manager',true,{entry,landed:p.url(),sid});
 await f.locator('#message').fill('Retained Manager draft');
 await f.locator('#conversation').evaluate(n=>{n.scrollTop=350;});await delay(300);
 const position=await f.locator('#conversation').evaluate(n=>n.scrollTop);
 const boundary=()=>f.locator('.mgr-new-messages').evaluate(n=>n.nextElementSibling?.dataset.messageId);
 const anchor=await boundary();
 await delay(1100);
 const read=()=>f.evaluate(()=>JSON.parse(localStorage.getItem('wizard-manager:conversation:v1')).read);
 const before=await read();
 const source=f.locator('[data-message-id="2"] .mgr-actions a');await source.click();
 await p.waitForSelector('.hosted-thread .ch-compose textarea').catch(async e=>{console.log('OPEN DEBUG',JSON.stringify({errors,host:await p.evaluate(()=>({services:WizAppServices.inspect(),layers:[...document.querySelectorAll('.hosted-thread')].map(n=>({html:n.innerHTML.slice(0,600),rect:n.getBoundingClientRect().toJSON()})),state:window.__wos?.wins||window.__wux?.wins})),manager:await f.evaluate(()=>({text:document.body.innerText.slice(-1500),hosted:WizardApp.hosted,visible:WizardApp.view?.isVisible(),nav:!!WizardApp.nav}))}));await p.screenshot({path:path.join(OUT,label+'-open-fail.png')});throw e;});
 const wid=await p.locator('.hosted-thread').getAttribute('data-chats');
 const info=await p.evaluate(({mobile,wid})=>{const s=mobile?__wos:__wux,w=s.wins[wid];return {app:w.app,appId:w.appId,thread:w.thread,layerInWindow:!!document.querySelector(`[data-win="${wid}"] .hosted-thread`),visibility:document.querySelector(`[data-win="${wid}"] iframe`).contentWindow.WizardApp.view.isVisible(),view:mobile?s.viewOf(wid):null};},{mobile,wid});
 ok(label+' exact canonical chat inside original Manager window',info.appId==='wizard-manager'&&info.app==='frame'&&info.thread===sid&&info.layerInWindow,info);
 ok(label+' Manager read visibility suspended under child',info.visibility===false);
 await p.waitForFunction(()=>document.querySelector('.hosted-thread .ch-msgs .msg, .hosted-thread .msg'));
 ok(label+' shared canonical history and standard composer',await p.locator('.hosted-thread [data-chmic]').count()===1&&await p.locator('.hosted-thread .msg').count()>0);
 await delay(1000);ok(label+' covered Manager does not advance read receipts',JSON.stringify(await read())===JSON.stringify(before),{before,after:await read()});
 await p.screenshot({path:path.join(OUT,label+'-native-thread.png')});
 await p.locator('.hosted-thread [data-chattach]').click();
 await p.locator('[data-chfile]').setInputFiles({name:'qa-native.txt',mimeType:'text/plain',buffer:Buffer.from('Synthetic fixture')});
 await p.waitForFunction(()=>document.querySelector('.hosted-thread .ch-compose')?.innerText.includes('qa-native.txt')&&!document.querySelector('.hosted-thread .uploading')).catch(async e=>{console.log('ATTACH FAILURE',JSON.stringify({writes,composer:await p.locator('.hosted-thread .ch-compose').innerText(),files:await p.evaluate(wid=>window.__wux?.chats.ch(wid)?.files,wid)}));throw e;});
 await delay(500);
 await p.locator('.hosted-thread .ch-compose textarea').fill('Synthetic QA typed reply — intercepted, never delivered');
 await p.locator('.hosted-thread .ch-compose').evaluate(n=>n.requestSubmit());
 await p.waitForFunction(()=>!document.querySelector('.hosted-thread'));
 await p.waitForFunction(sid=>[...WosOutbox._items.values()].some(i=>i.kind==='reply'&&i.sessionId===sid),sid);
 const item=await p.evaluate(sid=>{const x=[...WosOutbox._items.values()].find(i=>i.kind==='reply'&&i.sessionId===sid);return {sessionId:x.sessionId,kind:x.kind,text:x.text,files:x.files};},sid);
 ok(label+' typed send uses exact thread outbox and returns Manager',item.sessionId===sid,item);
 ok(label+' standard attachment travels with typed reply',item.files?.some(x=>x.id==='qa-attachment'),item.files);
 ok(label+' Manager draft survives child and send',await f.locator('#message').inputValue()==='Retained Manager draft');
 const afterPosition=await f.locator('#conversation').evaluate(n=>n.scrollTop);
 ok(label+' Manager reading position survives child',Math.abs(position-afterPosition)<=2,{position,afterPosition});
 ok(label+' divider remains anchored while catching up',await boundary()===anchor,{anchor,after:await boundary()});
 // Arrival during catch-up: poll normally, no inventory fetch may mark it read.
 R.messages.push({...R.messages[0],id:25,title:'New arrival while catching up'});
 await f.waitForFunction(()=>document.querySelector('[data-message-id="25"]'),null,{timeout:15000});
 ok(label+' arrival does not shift divider or scroll',await boundary()===anchor&&Math.abs(await f.locator('#conversation').evaluate(n=>n.scrollTop)-position)<=2);
 ok(label+' offscreen arrival remains unread',!(await read()).viewed.includes(25)&&(await read()).seen<25);
 await source.click();await p.waitForSelector('.hosted-thread');
 await p.locator('.hosted-thread [data-chback]').click();await p.waitForFunction(()=>!document.querySelector('.hosted-thread'));
 ok(label+' standard header Back returns to Manager',await f.evaluate(()=>WizardApp.view.isVisible()));
 // Standard Back returns to the app and root Back stays there.
 await source.click();await p.waitForSelector('.hosted-thread').catch(async e=>{console.log('REOPEN DEBUG',await p.locator('.hosted-thread').evaluate(n=>{const out=[];for(let x=n;x&&out.length<7;x=x.parentElement)out.push({tag:x.tagName,cls:x.className,style:x.style.cssText,rect:x.getBoundingClientRect().toJSON(),display:getComputedStyle(x).display,visibility:getComputedStyle(x).visibility});return out;}));console.log('REOPEN STATE',await p.evaluate(()=>({idx:__wos.idx,desks:__wos.desks,wins:__wos.wins})));await p.screenshot({path:path.join(OUT,label+'-reopen-fail.png')});throw e;});
 if(mobile)await p.evaluate(()=>__wosNativeBack());else await p.keyboard.press('Escape');
 await p.waitForFunction(()=>!document.querySelector('.hosted-thread'));
 if(mobile)await p.evaluate(()=>__wosNativeBack());else await p.keyboard.press('Escape');
 ok(label+' nested Back and Manager root Back never exit',p.url().includes('/wizard-os-home/')&&await f.locator('#message').inputValue()==='Retained Manager draft');
 await p.evaluate(m=>m?__wos.goDesk(0):__wux.goHome(),mobile);await delay(350);
 const awayRead=await read();const awayScroll=await f.evaluate(()=>JSON.parse(localStorage.getItem('wizard-manager:conversation:v1')).scroll);console.log('AWAY SCROLL',JSON.stringify({label,position,awayScroll,actual:await f.locator('#conversation').evaluate(n=>n.scrollTop)}));
 ok(label+' hidden Manager reports unread visibility correctly',await f.evaluate(()=>WizardApp.view.isVisible())===false);
 R.messages.push({...R.messages[0],id:26,title:'Arrival while Manager away'});await delay(900);
 ok(label+' hidden app leaves durable read watermark unchanged',JSON.stringify(await read())===JSON.stringify(awayRead));
 // Reload/re-entry retains durable boundary and scroll; missed new inventory stays unread.
 await p.reload();await p.waitForFunction(m=>m?!!window.__wos:!!window.__wux,mobile);
 await p.evaluate(async m=>{await WizCore.appsLoaded();const s=m?__wos:__wux;s.openApp(WizCore.apps(m?'mobile':'desktop').APP['wizard-manager']);},mobile);
 await p.waitForFunction(()=>[...document.querySelectorAll('iframe')].some(f=>f.src.includes('/wizard-manager/')&&f.contentWindow?.WizardApp?.hosted));
 f=p.frames().find(x=>x.url().includes('/wizard-manager/'));await f.waitForFunction(()=>document.querySelector('[data-message-id="26"]'));await delay(1200);
 ok(label+' away arrival remains unread after re-entry',!(await read()).viewed.includes(26)&&(await read()).seen<26);
 ok(label+' reload retains draft and divider',await f.locator('#message').inputValue()==='Retained Manager draft'&&await boundary()===anchor);
 ok(label+' reload restores reading position',Math.abs(await f.locator('#conversation').evaluate(n=>n.scrollTop)-position)<=2,{position,after:await f.locator('#conversation').evaluate(n=>n.scrollTop),awayScroll,afterScroll:await f.evaluate(()=>JSON.parse(localStorage.getItem('wizard-manager:conversation:v1')).scroll)});
 await delay(700);await p.screenshot({path:path.join(OUT,label+'-catchup.png')});
 await f.locator('.mgr-new-messages').scrollIntoViewIfNeeded();await p.screenshot({path:path.join(OUT,label+'-divider.png')});
 await f.locator('#conversation').evaluate(n=>{n.scrollTop=350;});
 // Orb in child must route to exact canonical thread, never hidden Manager receiver.
 await f.locator('[data-message-id="2"] .mgr-actions a').click();await p.waitForSelector('.hosted-thread .ch-compose textarea');
 await p.locator('.hosted-thread .ch-compose textarea').fill('Voice companion text');
 await p.evaluate(m=>{window.__qaBefore=[...WosOutbox._items.keys()];return m?__wos.startVoice('auto'):__wux.talk('start');},mobile);await delay(800);
 await p.evaluate(async m=>{if(m)__wos.finishVoice();else await __wux.talk('send');},mobile);
 await p.waitForFunction(()=>[...WosOutbox._items.values()].some(i=>!__qaBefore.includes(i.id)&&i.kind==='reply'),null,{timeout:20000});
 await p.waitForFunction(()=>!document.querySelector('.hosted-thread'));
 const voice=await p.evaluate(()=>{const x=[...WosOutbox._items.values()].find(i=>!__qaBefore.includes(i.id)&&i.kind==='reply');return {sessionId:x.sessionId,typed:x.typed,text:x.text,bytes:x.audio?.size,conversation:x.conversation};});
 ok(label+' orb targets child not Manager and returns',voice.sessionId===sid&&!voice.conversation&&voice.bytes>0,voice);
 await p.waitForFunction(()=>[...WosOutbox._items.values()].some(i=>!__qaBefore.includes(i.id)&&i.kind==='reply'&&i.state==='sent'),null,{timeout:20000});
 const submissions=writes.filter(x=>/\/v1\/runs$/.test(x.path));
 ok(label+' intercepted API dispatch pins exact canonical ID',submissions.length>=2&&submissions.every(x=>x.body.session_id===sid),submissions.map(x=>({path:x.path,session_id:x.body.session_id})));
 ok(label+' no Manager posts during canonical replies',writes.every(w=>w.path!=='/wizard-manager/api/messages'));
 ok(label+' no browser errors',errors.length===0,errors);
 receipts.push({label,sid,writes,errors,served:[...new Set(served)],position,anchor});await ctx.close();
}
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROME,headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});try{for(const mobile of(process.env.QA_SHELL==='desktop'?[false]:process.env.QA_SHELL==='phone'?[true]:[true,false]))await run(browser,mobile);}finally{fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify({checks,receipts},null,2));await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
