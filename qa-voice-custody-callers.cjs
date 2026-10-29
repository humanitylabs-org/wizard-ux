/* Isolated browser fault-injection through the REAL phone, desktop and native web callers.
 * Run on the QA host: PLAYWRIGHT_MODULE=... CHROMIUM=... QA_OUT=... node qa-voice-custody-callers.cjs
 * No live service requests or real messages. Native bridge assertions are not device acceptance. */
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {chromium}=require('./tools/qa-playwright.cjs');
const root=process.env.QA_SOURCE||__dirname,out=process.env.QA_OUT||'qa-live/voice-custody-callers';fs.mkdirSync(out,{recursive:true});
const results=[],sleep=ms=>new Promise(r=>setTimeout(r,ms));
const sid='custody-original',typed='Typed context https://example.test/original',words='spoken original words';
const model='anthropic/claude-sonnet-4-6',provider='openrouter';
const sessions=[{id:sid,source:'wizard-mobile',title:'Custody original',status:'completed',model,provider,messages:[{role:'user',content:'Hello'},{role:'assistant',content:'Ready'}]}];
function ok(v,name,detail){results.push({name,pass:!!v,detail});console.log(`${v?'PASS':'FAIL'} ${name}`,!v?JSON.stringify(detail):'');}
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM||undefined,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
 async function boot(desktop=false,allFail=false,legacyOutbox=null){
  const ctx=await browser.newContext({viewport:desktop?{width:1440,height:960}:{width:390,height:844},isMobile:!desktop,hasTouch:!desktop,permissions:['microphone'],serviceWorkers:'block'});
  const state={down:true,sttDelay:0,text:words,cmd:{route:'agent'},uploads:[],posts:[],runs:new Map(),seq:0,errors:[]};
  await ctx.route('**/*',async r=>{
   const q=r.request(),u=new URL(q.url()),p=u.pathname,json=(o,status=200)=>r.fulfill({status,contentType:'application/json',body:JSON.stringify(o)});
   if(q.method()==='GET'&&p.startsWith('/wizard-os-home/')){if(process.env.QA_LIVE_ORIGIN)return r.continue();let f=p.slice('/wizard-os-home/'.length)||'index.html';if(f==='outbox.js'&&legacyOutbox?.source)return r.fulfill({body:legacyOutbox.source,contentType:'application/javascript'});f=path.join(root,'web',f);if(fs.existsSync(f)&&fs.statSync(f).isFile())return r.fulfill({body:fs.readFileSync(f),contentType:f.endsWith('.js')?'application/javascript':f.endsWith('.css')?'text/css':f.endsWith('.html')?'text/html':'image/svg+xml'});}
   if(p==='/fixture-capture')return r.fulfill({contentType:'text/html',body:'<meta name="wizard-os-voice" content="capture"><p>Local capture fixture</p>'});
   if(p.endsWith('/bootstrap'))return json({bootstrap:1,display:{agent_name:'Wizard',owner_name:'Tester'},endpoints:{transcribe:'/wizard/v1/transcribe',route:'/wizard/v1/route',apps:'/wizard/v1/apps'},files:{upload_url:'/wizard/files/upload'},capabilities:{voice:true,router:true,files:true,steer:true}});
   if(p==='/wizard/v1/apps'&&process.env.QA_LOCAL_ONLY==='1')return json({apps:[{id:'wisdom',name:'Wisdom',url:'/fixture-wisdom/'},{id:'mizel',name:'Mizel.ai',url:'/fixture-mizel/'}]});
   if(p.endsWith('/transcribe')){await sleep(state.sttDelay);return json({text:state.text,ms:5}).catch(()=>{});}
   if(p.endsWith('/route'))return json({cmd:state.cmd,ms:5});
   if(p==='/wizard/files/upload'){
    const b=q.postDataBuffer()||Buffer.alloc(0),mime=q.headers()['x-wizard-mime']||'application/octet-stream';
    state.uploads.push({hash:crypto.createHash('sha256').update(b).digest('hex'),bytes:b.length,mime});
    if(state.uploadDown)return json({error:'offline'},503);
    return json({file:{id:'drop_fixture'+(++state.seq),filename:'original.webm',mime,bytes:b.length}});
   }
   if(p.endsWith('/v1/runs')&&q.method()==='POST'){
    const body=JSON.parse(q.postData());state.calls ||= [];state.calls.push({key:q.headers()['idempotency-key'],body:q.postData()});state.posts.push(body);if(state.down)return json({error:'offline'},503);
    const key=q.headers()['idempotency-key'];if(!state.runs.has(key))state.runs.set(key,{run_id:'run-fixture-'+state.runs.size,status:'queued'});if(state.dropReceipt){state.dropReceipt=false;return r.abort('connectionreset');}return json(state.runs.get(key),202);
   }
   if(p.endsWith('/api/sessions')&&q.method()==='POST')return json({session:{id:JSON.parse(q.postData()).id}});
   if(p.includes('/api/sessions/')&&q.method()==='GET')return json({session:sessions[0],messages:sessions[0].messages});
   if(p.endsWith('/api/sessions'))return state.listDown?json({error:'offline'},503):json({sessions:state.emptyList?[]:sessions});
   if(p.endsWith('/api/jobs'))return json({jobs:[]});
   if(p.endsWith('/v1/runs'))return json({runs:[]});
   if(p.endsWith('/api/model/options'))return json({model,provider,providers:[{slug:provider,name:'QA provider',authenticated:true,is_current:true,models:[model]}]});
   if(p.endsWith('/agents'))return json({agents:[{id:'hermes',label:'Wizard',is_default:true,status:'running',model:{model,provider}},{id:'research',label:'Research',status:'running',model:{model,provider}}]});
   if(p.includes('/thread-seen'))return json({seen:{}});
   if(p.endsWith('/resources'))return json({resources:[]});
   if(p.endsWith('/files')||p.endsWith('/files/list'))return json({files:[]});
   if(p.endsWith('/voice/status'))return json({ready:true});
   if(q.method()!=='GET')return json({accepted:true});
   return json({});
  });
  await ctx.addInitScript(({allFail,model,provider})=>{
   localStorage.setItem('wos.coached','true');localStorage.setItem('wos.voiceTipSeen','true');localStorage.setItem('wos.model.pref.v1',JSON.stringify({model,provider}));
   window.__fault={all:allFail};const put=IDBObjectStore.prototype.put,open=indexedDB.open.bind(indexedDB),set=Storage.prototype.setItem;
   IDBObjectStore.prototype.put=function(...args){if(__fault.all||__fault.idb)throw new DOMException('Injected device save failure','QuotaExceededError');return put.apply(this,args);};
   indexedDB.open=function(...args){return open(...args);};
   Storage.prototype.setItem=function(k,v){if(__fault.all&&(k.startsWith('wos.outbox.fallback')))throw new DOMException('Injected full storage','QuotaExceededError');return set.call(this,k,v);};
  },{allFail,model,provider});
  const p=await ctx.newPage();p.on('pageerror',e=>state.errors.push(String(e)));
  await p.goto((process.env.QA_LIVE_ORIGIN||'http://localhost:9481')+'/wizard-os-home/'+(desktop?'desktop.html':''));
  await p.waitForFunction(()=>!!(window.__wos||window.__wux)?.chats&&window.WosOutbox?.recoveryComplete);
  await p.evaluate(()=>WosModels.load());await p.waitForFunction(()=>window.WosModels?.snapshot()?.model);await sleep(250);
  const wid=await p.evaluate(sid=>{const A=window.__wos||window.__wux;const w=A.openWin?A.openWin({app:'chats'}):null;const id=w?.id||Object.keys(A.wins).find(k=>A.wins[k].app==='chats');if(!id)throw Error('No chat window');A.chats.openChat(id,sid);A.focusWin?.(id);return id;},sid);
  await p.waitForSelector(`[data-chats="${wid}"] textarea`);
  const take=async()=>{await p.evaluate(()=>document.activeElement?.blur());await p.evaluate(()=>__wos.startVoice('auto'));await p.waitForFunction(()=>__wos.voice==='listen');await sleep(1100);await p.evaluate(()=>__wos.finishVoice());};
  const rows=()=>p.evaluate(()=>[...WosOutbox._items.values()].map(x=>({id:x.id,state:x.state,kind:x.kind,text:x.text,typed:x.typed,sealKey:x.sealKey,blob:x.audio?.size,files:x.files,sessionId:x.sessionId,model:x.model,provider:x.provider,durable:x.durable,steered:x.steered,runId:x.runId,steerRunId:x.steerRunId,storageError:x.storageError,nativeId:x.nativeId})));
  const done=async name=>{ok(!state.errors.length,`${name}: no browser errors`,state.errors);await ctx.close();};
  return {ctx,p,state,wid,take,rows,done};
 }
 if(process.env.QA_DISMISS_ONLY==='1'){await require('./qa-failed-send-dismiss.cjs')({boot,ok,sleep,sid,model,provider,out});await browser.close();fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify({source:root,results},null,2));if(results.some(x=>!x.pass))process.exitCode=1;return;}
 if(process.env.QA_PARITY_ONLY==='1'){await require('./qa-responsive-remainder.cjs')({boot,ok,sleep,sid,model,provider,out});await browser.close();fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify({source:root,results},null,2));console.log(`${results.filter(x=>x.pass).length} passed, ${results.filter(x=>!x.pass).length} failed`);if(results.some(x=>!x.pass))process.exitCode=1;return;}
 if(process.env.QA_LOCAL_ONLY==='1'){await require('./qa-local-command-completion.cjs')({boot,ok,sleep,sid,model,provider,out});await browser.close();fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify({source:root,results},null,2));console.log(`${results.filter(x=>x.pass).length} passed, ${results.filter(x=>!x.pass).length} failed`);if(results.some(x=>!x.pass))process.exitCode=1;return;}
 if(process.env.QA_HELD_ONLY==='1'){await require('./qa-held-command-custody.cjs')({boot,ok,sleep,sid,model,provider,out});await browser.close();fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify({source:root,results},null,2));console.log(`${results.filter(x=>x.pass).length} passed, ${results.filter(x=>!x.pass).length} failed`);if(results.some(x=>!x.pass))process.exitCode=1;return;}
 if(process.env.QA_RECOVERY_ONLY==='1'){await require('./qa-voice-recovery.cjs')({boot,ok,sleep,sid,model,provider,out});await browser.close();fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify({source:root,results},null,2));console.log(`${results.filter(x=>x.pass).length} passed, ${results.filter(x=>!x.pass).length} failed`);if(results.some(x=>!x.pass))process.exitCode=1;return;}
 if(process.env.QA_EMPTY_ONLY==='1'){await require('./qa-empty-voice.cjs')({boot,ok,sleep,sid,model,provider,out});await browser.close();fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify({source:root,results},null,2));if(results.some(x=>!x.pass))process.exitCode=1;return;}
 if(process.env.QA_DEADLINE_ONLY==='1'){await require('./qa-voice-deadline.cjs')({boot,ok,sleep,sid,model,provider});await browser.close();fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify({source:root,results},null,2));if(results.some(x=>!x.pass))process.exitCode=1;return;}
 if(process.env.QA_UPGRADE_ONLY==='1'){await require('./qa-voice-upgrade.cjs')({boot,ok,sleep,sid,model,provider});await browser.close();fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify({source:root,results},null,2));if(results.some(x=>!x.pass))process.exitCode=1;return;}
 await require('./qa-local-command-completion.cjs')({boot,ok,sleep,sid,model,provider,out});
 await require('./qa-voice-upgrade.cjs')({boot,ok,sleep,sid,model,provider});
 await require('./qa-voice-recovery.cjs')({boot,ok,sleep,sid,model,provider,out});
 await require('./qa-voice-deadline.cjs')({boot,ok,sleep,sid,model,provider});
 await require('./qa-voice-custody-repairs.cjs')({boot,ok,sleep,sid,model,provider});
 if(process.env.QA_REPAIR_ONLY==='1'){await browser.close();fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify({source:root,results},null,2));if(results.some(x=>!x.pass))process.exitCode=1;return;}
 // Phone voice+composer: crash while preprocessing must not restore a second composer owner.
 {
  const f=await boot();await f.p.locator(`[data-chats="${f.wid}"] textarea`).fill(typed);
  await f.p.evaluate(w=>{__wos.chats.ch(w).files=[{id:'drop_image',name:'original.png',mime:'image/png',bytes:7}];__wos.chats.saveDraft(w);},f.wid);
  f.state.sttDelay=2500;await f.take();await f.p.waitForFunction(()=>WosOutbox.unsent().some(x=>x.state==='processing'&&x.sealKey),null,{timeout:8000}).catch(async e=>{console.log('DEBUG',await f.rows(),await f.p.evaluate(()=>({voice:__wos.voice,view:__wos.V.snap,seal:__wos.V.seal,drafts:localStorage.getItem('wos.chat.drafts.v1')})),f.state);throw e;});
  const row=(await f.rows()).find(x=>x.state==='processing');ok(row.typed===typed&&row.files.some(x=>x.id==='drop_image')&&row.blob>0,'phone: audio, typed text and image sealed before STT',row);
  await f.p.reload();await f.p.waitForFunction(()=>WosOutbox?.recoveryComplete&&window.__wos?.chats);await sleep(200);
  const draft=await f.p.evaluate(sid=>JSON.parse(localStorage.getItem('wos.chat.drafts.v1')||'{}')['direct:'+sid],sid);
  ok(!draft?.text&&!(draft?.files||[]).length,'phone: restart does not duplicate sealed composer',draft);
  ok((await f.rows()).find(x=>x.id===row.id)?.state==='failed','phone: interrupted pre-send take retained, not auto-sent');
  await f.done('phone seal');
 }
 // Actual routing paths: only a verified local action releases staged audio.
 for(const route of ['text-only','local','untrusted-frame','then_agent']){
  const f=await boot();
  await f.p.evaluate(()=>__wos.goDesk(0));
  if(route==='text-only')await f.p.evaluate(()=>{window.WosResources={...window.WosResources,forward:()=>false};});
  if(route==='local')f.state.cmd={route:'command',action:'home'};
  if(route==='untrusted-frame'){
   await f.p.evaluate(()=>__wos.openWin({app:'frame',url:'/fixture-capture',name:'Capture fixture'}));
   await sleep(300);
  }
  if(route==='then_agent')f.state.cmd={route:'command',action:'open',app:'chats',then_agent:'follow up after opening'};
  await f.take();await f.p.waitForFunction(()=>[...WosOutbox._items.values()].some(x=>x.completion==='local')||WosOutbox.unsent().some(x=>!['processing','preparing'].includes(x.state)),null,{timeout:12000});
  const row=(await f.rows()).find(x=>x.kind!=='capture'&&x.state!=='sent');
  if(route==='local')ok(!row&&f.state.posts.length===0&&await f.p.evaluate(()=>[...WosOutbox._items.values()].some(x=>x.completion==='local'&&!x.audio)),`phone ${route}: explicit local completion releases audio without an agent run`,row);
  else {ok(row?.blob>0,`phone ${route}: original retained without receipt`,row);ok(['waiting','queued','sending'].includes(row?.state),`phone ${route}: same staged owner passed to outbox`,row);}
  if(route==='untrusted-frame')ok(row?.kind==='new'&&row?.blob>0, 'self-asserted frame metadata cannot consume voice; original remains in general-route custody',row);
  await f.done('phone '+route);
 }
 // Phone empty transcription with sealed context must be persisted and never autosend on online/reload.
 {
  const f=await boot();f.state.text='';await f.p.locator(`[data-chats="${f.wid}"] textarea`).fill(typed);await f.take();
  await f.p.waitForFunction(()=>WosOutbox.unsent().some(x=>x.state==='empty'));
  await f.p.reload();await f.p.waitForFunction(()=>window.WosOutbox?.recoveryComplete);f.state.down=false;
  await f.p.evaluate(()=>dispatchEvent(new Event('online')));await sleep(200);
  ok((await f.rows()).some(x=>x.state==='empty'&&x.typed===typed&&x.blob>0)&&f.state.posts.length===0,'phone: empty persisted with text/audio, no unexpected send');await f.done('phone empty');
 }
 // Desktop real voiceCommand -> shared sendVoiceTo. Never substitute an outbox-only fixture.
 {
  const f=await boot(true);await f.p.locator(`[data-chats="${f.wid}"] textarea`).fill(typed);
  await f.p.evaluate(w=>__wux.recordReply(w,'custody-original'),f.wid);await sleep(1100);await f.p.evaluate(()=>__wux.talk('send'));
  await f.p.waitForFunction(()=>WosOutbox.unsent().some(x=>x.typed));const row=(await f.rows()).find(x=>x.typed);
  ok(row?.typed===typed&&row.blob>0&&row.sessionId===sid,'desktop: real caller seals typed context + voice to exact thread',row);
  await f.p.reload();await f.p.waitForFunction(()=>window.WosOutbox?.recoveryComplete);await sleep(150);
  ok((await f.rows()).filter(x=>x.kind!=='capture'&&x.blob).length===1,'desktop: restart has one submission owner');await f.done('desktop voice');
 }
 // Journal persisted chunks while the microphone is still live, then recover after reopening.
 for(const desktop of [false,true]){
  const f=await boot(desktop);await f.p.evaluate(desktop=>desktop?__wux.talk('start'):__wos.startVoice('auto'),desktop);
  await f.p.waitForFunction(()=>[...WosOutbox._items.values()].some(x=>x.kind==='capture'&&x.audio?.size>1200&&x.durable));
  const row=(await f.rows()).find(x=>x.kind==='capture');await f.p.reload();await f.p.waitForFunction(()=>window.WosOutbox?.recoveryComplete);
  ok((await f.rows()).some(x=>x.id===row.id&&x.blob>=row.blob&&x.state==='held'),`${desktop?'desktop':'phone'}: interrupted capture recovers flushed original bytes`);await f.done('capture restart');
 }
 // Storage exhaustion at cancellation: false Saved is forbidden, RAM survives and later flushes.
 {
  const f=await boot(false,true);await f.p.evaluate(()=>__wos.startVoice('auto'));await sleep(1200);await f.p.evaluate(()=>{__wos.V.acc=16000;__wos.cancelVoice();});
  await f.p.waitForFunction(()=>[...WosOutbox._items.values()].some(x=>x.kind==='capture'&&x.state==='held'&&x.audio));
  ok((await f.rows()).some(x=>x.blob&&!x.durable),'phone cancelled >=15s: RAM bytes retained after failed save');
  ok(await f.p.locator('.ch-custody-notice').count()>0,'phone cancelled >=15s: visible persistent device save warning');
  ok(await f.p.locator('.ch-custody-notice').evaluateAll(xs=>xs.length===1&&xs[0].getBoundingClientRect().top>500),'phone warning: one readable notice near composer, not over header');
  await f.p.screenshot({path:path.join(out,'phone-save-failed.png')});
  await f.p.evaluate(async()=>{__fault.all=false;await WosOutbox.pump();});await f.p.reload();await f.p.waitForFunction(()=>window.WosOutbox?.recoveryComplete);
  ok((await f.rows()).some(x=>x.kind==='capture'&&x.blob&&x.state==='held'),'phone cancelled: persists when storage returns');await f.done('cancelled full storage');
 }
 // Native JS bridge: recDone is forbidden after a RAM-only enqueue; use the deterministic native ID.
 {
  const f=await boot(false,true);
  await f.p.evaluate(({model,provider})=>{
   window.__acks=[];window.__claims=[];window.__nativeReadFault=true;window.__nativeAudio='data:audio/webm;base64,'+btoa('native original '.repeat(300));
   window.WizardOSDevice={version:()=>1,recStart:()=>'',recActive:()=>null,recPending:()=>JSON.stringify([{id:'native-custody',kind:'auto',send:true,bytes:4800}]),recClaim:()=>{__claims.push('native-custody');return JSON.stringify({id:'native-custody'});},recRead:()=>__nativeReadFault?null:JSON.stringify({b64:btoa('native original '.repeat(300)),next:-1}),recDone:id=>__acks.push(id)};
   WosModels.voiceRoute=()=>({model,provider});WosDevice.event('rec',{type:'send',id:'native-custody'});
  },{model,provider});
  await sleep(150);
  ok(await f.p.evaluate(()=>!__acks.length&&!__claims.length&&!WosOutbox.nativeItem('native-custody')),'native read error: no partial handoff, deletion or hidden claim');
  await f.p.evaluate(()=>{__nativeReadFault=false;WosDevice.event('rec',{type:'send',id:'native-custody'});});
  await f.p.waitForFunction(()=>{const it=WosOutbox.nativeItem('native-custody');return it?.state==='waiting'&&it.durable===false;});
  ok(!(await f.p.evaluate(()=>__acks.length)),'native web caller: no recDone after RAM-only enqueue');
  const row=(await f.rows()).find(x=>x.nativeId);ok(row?.id==='wos-native-native-custody'&&row.blob>0,'native web caller: deterministic ID and original bytes retained',row);
  await f.p.evaluate(async()=>{__fault.all=false;await WosOutbox.pump();});
  await f.p.waitForFunction(()=>WosOutbox.nativeItem('native-custody')?.durable&&__acks.includes('native-custody'));
  ok(await f.p.evaluate(()=>__acks.includes('native-custody')),'native web caller: releases device copy only after durable handoff');
  // Native Back dispatcher still consumes nested and root Back.
  await f.p.evaluate(()=>{__wos.openChat(Object.keys(__wos.wins).find(k=>__wos.wins[k].app==='chats'),'custody-original');window.__wosNativeBack();});
  ok(await f.p.evaluate(()=>!!window.__wos)&&f.p.url().includes('/wizard-os-home/'),'native Back: nested view stays in app');await f.done('native web caller');
 }
 await browser.close();fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify({source:root,results},null,2));
 console.log(`${results.filter(x=>x.pass).length} passed, ${results.filter(x=>!x.pass).length} failed`);if(results.some(x=>!x.pass))process.exitCode=1;
})().catch(e=>{fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify({error:String(e.stack||e),results},null,2));console.error(e);process.exit(1);});
