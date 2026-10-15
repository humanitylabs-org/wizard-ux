// Thales only. Real Chrome, live tailnet shell/registry reads + candidate asset overlay.
// ALL writes and Manager state are fixtures. Fake Chrome microphone; no real agent work.
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require(process.env.PW);
const ROOT=process.env.QA_WEB_DIR||__dirname, MANAGER=process.env.QA_MANAGER_DIR;
const BASE=process.env.QA_URL, OUT=process.env.QA_OUT, baseline=process.env.QA_BASELINE==='1';
const checks=[],receipts=[];fs.mkdirSync(OUT,{recursive:true});
function ok(name,value,detail){checks.push({name,pass:!!value,detail});console.log(value?'PASS':'FAIL',name,JSON.stringify(detail||''));assert(value,name);}
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function boot(browser,mobile){
 const ctx=await browser.newContext({viewport:mobile?{width:412,height:892}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile,ignoreHTTPSErrors:true,permissions:['microphone'],serviceWorkers:'block'});
 const writes=[],errors=[],served=[];const R={enabled:true,sttDelay:0,sttDown:false,lostAck:false,down:false,text:'QA orb message',messages:[1,2].map(id=>({id,role:'assistant',kind:'ready',source_id:'qa-source-'+id,title:'Fixture work '+id,text:'Fixture ready',created:1700000000}))};
 const json=(r,x,status=200)=>r.fulfill({status,contentType:'application/json',body:JSON.stringify(x)});
 await ctx.route('**/*',async r=>{
  const q=r.request(),u=new URL(q.url()),method=q.method();
  if(!['GET','HEAD'].includes(method)){
   writes.push({path:u.pathname,bytes:q.postDataBuffer()?.length||0,body:/json/.test(q.headers()['content-type']||'')?q.postData()?.slice(0,16000):'[binary capture]'});
   if(/\/transcribe$/.test(u.pathname)){await delay(R.sttDelay);return json(r,R.sttDown?{error:'QA STT outage'}:{text:R.text,ms:5},R.sttDown?503:200);}
   if(u.pathname==='/wizard-manager/api/messages'){
    if(R.down)return r.abort();
    if(!R.enabled)return json(r,{error:'paused'},409);
    const b=q.postDataJSON();if(!R.messages.some(m=>m.job_id==='user:'+b.request_id))R.messages.push({id:R.messages.length+1,role:'user',kind:'chat',text:b.text,job_id:'user:'+b.request_id,reply_to:b.reply_to,created:1700000001});
    if(R.lostAck){R.lostAck=false;return r.abort();}
    return json(r,{accepted:true,request_id:b.request_id},202);
   }
   if(/\/route$/.test(u.pathname))return json(r,{cmd:{route:'agent'},ms:1});
   if(/\/files\/upload$/.test(u.pathname))return json(r,{file:{id:'qa-audio',filename:'qa.webm',mime:'audio/webm',bytes:4096}});
   if(/\/v1\/runs$/.test(u.pathname))return json(r,{run_id:'qa-run',status:'queued'},202);
   return json(r,{accepted:true});
  }
  if(u.pathname==='/wizard-manager/api/state')return json(r,{enabled:R.enabled,messages:R.messages.filter(m=>m.id>Number(u.searchParams.get('after')||0)),jobs:[]});
  if(u.pathname==='/wizard/v1/apps'&&!baseline) { const res=await r.fetch(); const data=await res.json(); for(const a of data.apps||[])if(a.id==='wizard-manager')a.receives_voice_input=true; return json(r,data); } // fixture declaration, never a live registry mutation
  for(const [prefix,dir] of [['/wizard-os-home/',ROOT],['/wizard-manager/',MANAGER]]){
   if(u.pathname.startsWith(prefix)&&!u.pathname.slice(prefix.length).startsWith('api/')){
    const rel=u.pathname.slice(prefix.length)||'index.html',p=path.resolve(dir,'web',rel);
    if(p.startsWith(path.resolve(dir,'web')+path.sep)&&fs.existsSync(p)&&fs.statSync(p).isFile()){
     served.push(rel);return r.fulfill({status:200,contentType:({'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'})[path.extname(p)]||'application/octet-stream',body:fs.readFileSync(p)});
    }
   }
  }
  return r.continue();
 });
 await ctx.addInitScript(()=>{if(window!==top)return;localStorage.setItem('wos.coached','true');localStorage.setItem('wos.voiceTipSeen','true');});
 const p=await ctx.newPage();p.on('pageerror',e=>errors.push(String(e)));
 await p.goto(BASE+(mobile?'?shell=phone':'desktop.html?shell=desktop'));await p.waitForFunction(m=>m?!!window.__wos:!!window.__wux,mobile);
 await p.evaluate(()=>WizCore.appsLoaded());
 const f={ctx,p,mobile,writes,errors,R,served};await openManager(f);return f;
}
async function openManager(f){const {p,mobile}=f;await p.evaluate(m=>{const shell=m?__wos:__wux;const app=WizCore.apps(m?'mobile':'desktop').APP['wizard-manager'];if(!app)throw Error('Live Manager registry missing');shell.openApp(app);},mobile);
 await p.waitForFunction(()=>[...document.querySelectorAll('iframe')].some(f=>f.contentWindow?.WizardApp?.hosted&&f.src.includes('/wizard-manager/')));
 f.frame=p.frames().find(fr=>fr.url().includes('/wizard-manager/'));
 await f.frame.waitForFunction(()=>document.querySelector('[data-message-id="1"]'));
 await f.frame.locator('#conversation').click({position:{x:8,y:8}}); // foreground app, no focused textarea (talk rather than dictation)
}
const start=f=>f.p.evaluate(m=>{window.__qaBefore=[...WosOutbox._items.keys()];return m?__wos.startVoice('auto'):__wux.talk('start');},f.mobile);
const finish=async f=>{await delay(700);await f.p.evaluate(async m=>{if(m)__wos.finishVoice();else await __wux.talk('send');},f.mobile);await f.p.waitForFunction(()=> (!window.__wos || __wos.voice==='idle') && [...WosOutbox._items.values()].some(x=>!window.__qaBefore.includes(x.id)&&['held','sent','waiting','failed'].includes(x.state)&&x.kind!=='capture'),null,{timeout:20000}).catch(async e=>{console.log('DEBUG',JSON.stringify({writes:f.writes,errors:f.errors,state:await f.p.evaluate(()=>({voice:window.__wos?.voice,desktop:window.__wux?.voice,items:[...WosOutbox._items.values()].map(({audio,...x})=>({...x,bytes:audio?.size})),text:document.body.innerText.slice(-6000)}))}));throw e;});await delay(200);};
const last=f=>f.p.evaluate(()=>{const x=[...WosOutbox._items.values()].filter(x=>x.kind!=='capture').at(-1);return x&&{id:x.id,state:x.state,kind:x.kind,text:x.text,bytes:x.audio?.size,error:x.error,conversation:x.conversation};});
const posts=f=>f.writes.filter(x=>x.path==='/wizard-manager/api/messages');
const forbidden=f=>f.writes.filter(x=>/\/route$|\/api\/sessions$|\/v1\/runs(?:\/.*)?$/.test(x.path));
async function retry(f,it){await f.p.evaluate(id=>WosOutbox.retryConversation(id),it.id);return last(f);}
async function gestureChecks(f,label) {
 const {p,mobile}=f;
 ok(label+' accessible general action uses live configured name',await p.evaluate(()=>document.getElementById('generalVoice').getAttribute('aria-label')==='Record for '+WizConfig.agent()));
 await p.evaluate(()=>window.__qaBefore=[...WosOutbox._items.keys()]);
 await p.evaluate(()=>{window.__qaRecorder={starts:0,stops:0};for(const op of ['start','stop']){const original=MediaRecorder.prototype[op];MediaRecorder.prototype[op]=function(...args){__qaRecorder[op==='start'?'starts':'stops']++;return original.apply(this,args);};}});
 const before=posts(f).length;
 if(mobile) {
   const orb=await p.locator('#orbWrap').boundingBox(); const x=orb.x+orb.width/2,y=orb.y+orb.height/2;
   await p.mouse.move(x,y);await p.mouse.down();await p.waitForFunction(()=>__wos.voice==='command');
   await p.waitForFunction(()=>__qaRecorder.starts===1);
   const b=await p.locator('#generalVoice').boundingBox(); await p.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:5});
   ok('phone hold target visibly selected',await p.locator('#generalVoice').evaluate(n=>n.classList.contains('selected')));
   await p.screenshot({path:path.join(OUT,'phone-hold-target.png')});await p.mouse.up();await delay(500);
   ok('phone release latches, never sends or restarts microphone',await p.evaluate(()=>__wos.voice==='listen'&&__qaRecorder.starts===1&&__qaRecorder.stops===0)&&posts(f).length===before,await p.evaluate(()=>__qaRecorder));
   ok('phone target label names general agent',await p.locator('#voiceDestination').innerText().then(t=>t.includes('Talking to')&&t.includes('tap to send')));
   await p.screenshot({path:path.join(OUT,'phone-general-latched.png')});
 } else { await p.locator('#generalVoice').click();await p.waitForFunction(()=>__wux.voice==='listen'); }
 // Focus changes cannot bring app/private context back into the explicitly general take.
 await openManager(f);f.R.text='Open Movies';await delay(700);
 if(mobile) await p.locator('#orbWrap').dblclick({delay:60}); else await p.locator('#micBtn').click();
 await p.waitForFunction(()=>[...WosOutbox._items.values()].some(x=>!__qaBefore.includes(x.id)&&x.kind==='new'&&x.state==='sent')).catch(async e=>{console.log('GENERAL_DEBUG',JSON.stringify({writes:f.writes,errors:f.errors,state:await p.evaluate(()=>({voice:window.__wos?.voice,desktop:window.__wux?.voice,items:[...WosOutbox._items.values()].map(({audio,...x})=>({...x,bytes:audio?.size})),text:document.body.innerText.slice(-4500)}))}));throw e;});
 await p.waitForFunction(m=>m?__wos.voice==='idle':__wux.voice==='idle',mobile);
 ok(label+' fresh send gesture admits exactly once',await p.evaluate(()=>[...WosOutbox._items.values()].filter(x=>!__qaBefore.includes(x.id)&&x.kind==='new').length===1));
 const item=await p.evaluate(()=>{const it=[...WosOutbox._items.values()].filter(x=>x.kind==='new').at(-1);return it&&{kind:it.kind,text:it.text,instructions:it.instructions,bytes:it.audio?.size,id:it.id};});
 ok(label+' bypass seals one general request, no app POST',!!item&&item.text==='Open Movies'&&f.writes.some(w=>/files\/upload$/.test(w.path)&&w.bytes>0)&&posts(f).length===before,item);
 ok(label+' general instructions exclude foreground app/private content',!item.instructions?.includes('Manager')&&!item.instructions?.includes('Fixture work'),item.instructions);
 ok(label+' one recorder for complete take',await p.evaluate(()=>__qaRecorder.starts===1&&__qaRecorder.stops===1));
 if(mobile) {
   await p.locator('#generalVoice').click();await p.waitForFunction(()=>__wos.voice==='listen');await delay(250);await p.evaluate(()=>__wosNativeBack());
   ok('phone Back pauses and retains bypass without exiting',await p.evaluate(()=>__wos.voice==='paused'&&!!document.getElementById('device')));
   await p.evaluate(()=>__wos.cancelVoice());
   await openManager(f); f.R.text='Open apps'; const orb=await p.locator('#orbWrap').boundingBox();await p.mouse.move(orb.x+orb.width/2,orb.y+orb.height/2);await p.mouse.down();await p.waitForFunction(()=>__wos.voice==='command');await delay(700);await p.mouse.up();await delay(1500);
   ok('phone stationary hold stays command, no app delivery',posts(f).length===before&&await p.evaluate(()=>__wos.voice!=='listen'));
 }
 ok(label+' no page errors',f.errors.length===0,f.errors);
 receipts.push({label,gestures:true,writes:f.writes,errors:f.errors});
}
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROME,headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 try{for(const mobile of [true,false]){
  const label=mobile?'phone':'desktop';const f=await boot(browser,mobile);
  if(process.env.QA_GESTURES==='1'){await gestureChecks(f,label);await f.ctx.close();continue;}
  if(baseline){await start(f);await finish(f);await delay(1800);ok(label+' baseline reproduces misroute',posts(f).length===0&&forbidden(f).length>0,f.writes.map(x=>x.path));receipts.push({label,baseline:true,writes:f.writes});await f.ctx.close();continue;}
  await f.p.evaluate(()=>window.__qaBefore=[...WosOutbox._items.keys()]);
  await f.p.locator(mobile?'#orbWrap':'#micBtn').click();
  await f.p.waitForFunction(m=>m?__wos.voice==='listen':__wux.voice==='listen',mobile);
  ok(label+' app destination visibly labelled',await f.p.locator(mobile?'#voiceDestination':'#voiceText').innerText().then(t=>t.includes('Manager')));
  await f.p.screenshot({path:path.join(OUT,label+'-app-target.png')});
  await f.p.evaluate(m=>{const s=m?__wos:__wux;s.openApp(WizCore.apps(m?'mobile':'desktop').APP.chats);},mobile);
  f.R.sttDelay=350;await finish(f);
  let it=await last(f);ok(label+' foreground pinned at start, one Manager turn',it.state==='sent'&&posts(f).length===1&&f.R.messages.filter(m=>m.role==='user').length===1,it);
  ok(label+' no router/session/run writes',forbidden(f).length===0,forbidden(f));
  await openManager(f);
  await f.frame.locator('[data-message-id="1"] button').click();await f.frame.locator('#conversation').click({position:{x:8,y:8}});await start(f);
  await f.frame.locator('[data-message-id="2"] button').click();await finish(f);
  ok(label+' explicit reply target sealed before later edits',JSON.parse(posts(f).at(-1).body).reply_to===1);
  ok(label+' later draft target untouched',await f.frame.locator('#destination').innerText().then(x=>x.includes('Fixture work 2')));
  // Clear draft reply target via existing Back, preserving the mounted app.
  await f.p.evaluate(m=>m?__wosNativeBack():__wux.escStep(),mobile);
  ok(label+' nested Back stays in Manager',await f.frame.locator('h1').count()===1);
  await f.frame.locator('#conversation').click({position:{x:8,y:8}});f.R.lostAck=true;await start(f);await finish(f);it=await last(f);
  const n=posts(f).length;ok(label+' lost ack retains audio + transcript',it.state==='held'&&it.bytes>0&&it.text,it);
  await f.p.evaluate(id=>WosOutbox.transcribeDictation(id),it.id);
  ok(label+' transcribe/copy is never a hidden retry-send',posts(f).length===n&&(await last(f)).state==='held');
  const retried=await retry(f,it);ok(label+' uncertain retry reconciles same id without duplicate POST',retried.state==='sent'&&posts(f).length===n&&f.R.messages.filter(m=>m.job_id==='user:'+it.id).length===1,retried);
  f.R.enabled=false;await start(f);await finish(f);it=await last(f);ok(label+' paused recipient retains, no dispatch',it.state==='held'&&it.bytes>0&&posts(f).length===n,it);
  f.R.enabled=true;
  if(mobile) { await f.p.evaluate(()=>__wos.openSheet('settings')); await f.p.locator(`[data-cxid="${it.id}"] [data-cx="manager"]`).click(); }
  else await f.p.locator(`[data-record-retry="${it.id}"]`).click();
  await f.p.waitForFunction(id=>WosOutbox.get(id)?.state==='sent',it.id);
  ok(label+' visible retry-to-Manager control sends original after enabling',(await last(f)).state==='sent');
  if(mobile) await f.p.evaluate(()=>__wos.closeSheets(true));
  await openManager(f);
  f.R.sttDown=true;await start(f);await finish(f);it=await last(f);ok(label+' STT outage retains original, never Chats',it.state==='held'&&it.bytes>0&&forbidden(f).length===0,it);f.R.sttDown=false;await retry(f,it);
  f.R.down=true;await start(f);await finish(f);it=await last(f);const failedId=it.id;ok(label+' network outage retains transcript + audio',it.state==='held'&&it.bytes>0&&it.text,it);f.R.down=false;await retry(f,it);
  ok(label+' network retry uses original request identity',JSON.parse(posts(f).at(-1).body).request_id===failedId);
  await start(f);await f.frame.evaluate(()=>location.reload());await f.frame.waitForFunction(()=>document.querySelector('[data-message-id="1"]'));const before=posts(f).length;await finish(f);it=await last(f);
  ok(label+' reloaded frame fails closed retaining original',it.state==='held'&&it.bytes>0&&posts(f).length===before,it);
  // Outbox attachment contract: test the shared method with an explicit persisted file fixture.
  const attachment=await f.p.evaluate(async()=>{const frame=[...document.querySelectorAll('iframe')].find(f=>f.src.includes('/wizard-manager/'));const conversation=WizAppServices.conversation.pin(frame,'wizard-manager');const it=await WosOutbox.sendConversation({conversation,audio:new Blob(['original']),text:'attachment fixture',files:[{id:'qa-file',name:'retained.txt'}]});return {state:it.state,bytes:it.audio.size,files:it.files,error:it.error};});
  ok(label+' unsupported attachments retained visibly',attachment.state==='held'&&attachment.bytes>0&&attachment.files.length===1&&posts(f).length===before,attachment);
  const held=await last(f);await f.p.reload();await f.p.waitForFunction(()=>window.WosOutbox?.recoveryComplete);const recovery=await f.p.evaluate(id=>{const it=WosOutbox.get(id);return {state:it?.state,kind:it?.kind,bytes:it?.audio?.size};},held.id);
  ok(label+' shell reload preserves custody and never automatically sends',recovery.state==='held'&&recovery.kind==='conversation'&&recovery.bytes>0&&posts(f).length===before,recovery);
  ok(label+' no ordinary Chat routing throughout candidate tests',forbidden(f).length===0,forbidden(f));
  await openManager(f);await f.p.screenshot({path:path.join(OUT,label+'.png')});
  if(mobile) {
   const beforeDictation=posts(f).length;await f.frame.locator('#message').fill('Draft: ');await f.frame.locator('#message').focus();
   await f.p.evaluate(()=>__wos.startVoice('dictation'));await delay(750);await f.p.evaluate(()=>__wos.finishVoice());
   await f.p.waitForFunction(()=>__wos.voice==='idle');
   ok(label+' focused Manager field dictation inserts only, never sends',await f.frame.locator('#message').inputValue().then(x=>x.includes('QA orb message'))&&posts(f).length===beforeDictation&&forbidden(f).length===0);
  }
  receipts.push({label,writes:f.writes,errors:f.errors,served:[...new Set(f.served)]});await f.ctx.close();
 }
 }finally{await browser.close();fs.writeFileSync(path.join(OUT,'result.json'),JSON.stringify({baseline,checks,receipts,limitations:['STT, Manager state and every POST are explicit fixtures; no production admission tested','Chrome fake microphone, not physical mic or native Android bridge','Live tailnet registry and shell reads; candidate assets overlaid in browser only']},null,2));}
})().catch(e=>{console.error(e);process.exitCode=1});
