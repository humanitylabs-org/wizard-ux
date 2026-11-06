/* PR27 repair regressions. Called by qa-voice-custody-callers.cjs; all endpoints synthetic. */
module.exports = async ({boot,ok,sleep,sid,model,provider}) => {
  const run='exact-active-fixture', photo={id:'drop_photo',name:'original.png',mime:'image/png',bytes:4096};
  const file={id:'drop_doc',name:'original.pdf',mime:'application/pdf',bytes:2048};
  const activate=async f=>f.p.evaluate(({sid,model,provider,run})=>Object.assign((window.__wos||window.__wux).live.session(sid),{status:'running',runId:run,model,provider}),{sid,model,provider,run});
  const intercept=async(f,mode)=>{
    const calls=[];
    await f.ctx.route('**/wizard/hermes/v1/runs/*/steer*',async r=>{
      const q=r.request();calls.push({url:q.url(),body:q.postData(),key:q.headers()['idempotency-key']});
      if(mode==='lost')return r.abort();
      const receipt=mode==='bad'?{accepted:'true',run_id:run}:mode==='wrong'?{accepted:true,run_id:'wrong-run'}:mode==='reject'?{error:'run already ended'}:{accepted:true,run_id:run,status:'running'};
      return r.fulfill({status:mode==='reject'?409:202,contentType:'application/json',body:JSON.stringify(receipt)});
    });
    return calls;
  };
  // Actual phone/desktop text callers preserve the selected live run and every attachment.
  for(const desktop of [false,true]){
    const f=await boot(desktop);f.state.down=false;await activate(f);const calls=await intercept(f,'ok');
    await f.p.evaluate(({wid,photo,file})=>{const a=window.__wos||window.__wux;const c=a.chats.ch(wid);c.draft='Exact steering words';c.files=[photo,file];a.chats.sendChat(wid,'Exact steering words');},{wid:f.wid,photo,file});
    await f.p.waitForFunction(()=>[...WosOutbox._items.values()].some(x=>x.state==='sent'));
    const row=(await f.rows()).find(x=>x.state==='sent'), body=JSON.parse(calls[0]?.body||'{}');
    ok(calls.length===1&&f.state.posts.length===0&&row?.steered&&row?.runId===run,`${desktop?'desktop':'phone'} confirmed steer: exactly one mutation, no new run`,{calls,posts:f.state.posts,row});
    ok(body.input==='Exact steering words'&&body.model===model&&body.provider===provider&&body.require_model_lock===true&&body.wizard_file_ids?.join()===`${photo.id},${file.id}`,`${desktop?'desktop':'phone'} steer preserves text, model, provider, photos/files`,body);
    await f.p.evaluate(({sid})=>{const a=window.__wos||window.__wux;Object.assign(a.live.session(sid),{status:'completed',runId:'replacement'});},{sid});
    for(let i=0;i<3;i++){await f.p.evaluate(async({wid,sid})=>{const a=window.__wos||window.__wux;a.chats.openChat(wid,sid);await a.chats.loadThread(a.wins[wid],true);},{wid:f.wid,sid});await sleep(200);}
    await f.p.reload();await f.p.waitForFunction(()=>!!window.WosOutbox);await f.p.evaluate(()=>WosOutbox.retryAll());await sleep(400);
    ok(calls.length===1&&f.state.posts.length===0,'accepted steer transcript absence/reload never creates a second run');
    await f.done('confirmed steer');
  }
  for(const desktop of [false,true]){
    const f=await boot(desktop);f.state.down=false;await activate(f);const calls=await intercept(f,'ok');
    await f.p.locator(`[data-chats="${f.wid}"] [data-chmic]`).click();
    await f.p.waitForFunction(()=> (window.__wos||window.__wux).voice==='listen');
    await f.p.locator(`[data-chats="${f.wid}"] textarea`).fill('Typed voice steering');
    await f.p.evaluate(({wid,photo,file})=>{(window.__wos||window.__wux).chats.ch(wid).files=[photo,file];},{wid:f.wid,photo,file});await sleep(1100);
    await f.p.evaluate(({sid})=>Object.assign((window.__wos||window.__wux).live.session(sid),{status:'running',runId:'replacement'}),{sid});
    await f.p.evaluate(desktop=>desktop?__wux.talk('send'):__wos.finishVoice(),desktop);
    await f.p.waitForFunction(()=>[...WosOutbox._items.values()].some(x=>x.state==='sent'));
    const body=JSON.parse(calls[0]?.body||'{}');
    ok(calls.length===1&&calls[0].url.endsWith('/'+run+'/steer')&&!f.state.posts.length,`${desktop?'desktop':'phone'} actual composer voice preserves captured run through asynchronous finish`,calls);
    ok(body.input?.includes('Typed voice steering')&&body.input?.includes('spoken original words')&&body.wizard_file_ids?.includes(photo.id)&&body.wizard_file_ids?.includes(file.id)&&body.wizard_file_ids?.length===3,`${desktop?'desktop':'phone'} active voice includes typed words, transcript, photo, file and audio`,body);
    await f.done('working voice caller');
  }
  {
    const f=await boot(false,true);f.state.down=false;await activate(f);const calls=await intercept(f,'ok');
    await f.p.evaluate(({sid,model,provider,run})=>WosOutbox.enqueue({kind:'reply',sessionId:sid,model,provider,steerRunId:run,text:'No durable journal'}),{sid,model,provider,run});
    await f.p.waitForFunction(()=>[...WosOutbox._items.values()].some(x=>x.state==='failed'));
    ok(!calls.length&&!f.state.posts.length,'both stores unavailable: no steer mutation before durable dispatch journal');
    await f.done('journal write failure');
  }
  for(const mode of ['lost','bad','wrong']){
    const f=await boot();f.state.down=false;const calls=await intercept(f,mode);
    await f.p.evaluate(sid=>WizLive.pinAgent(sid,'research'),sid);
    const id=await f.p.evaluate(async({sid,model,provider,run,photo,file})=>(await WosOutbox.enqueue({kind:'reply',sessionId:sid,model,provider,agent:'research',steerRunId:run,text:'Original steer',audio:new Blob(['x'.repeat(4096)],{type:'audio/webm'}),files:[photo,file]})).id,{sid,model,provider,run,photo,file});
    await f.p.waitForFunction(id=>WosOutbox.get(id)?.state==='unconfirmed',id);
    const before=await f.p.evaluate(id=>{const x=WosOutbox.get(id);return {body:x.steerBody,dispatch:x.steerDispatch,bytes:x.audio.size,files:x.files.map(f=>f.id),durable:x.durable};},id);
    ok(calls.length===1&&calls[0].url.endsWith('/'+run+'/steer?agent=research')&&before.dispatch==='started'&&before.durable&&before.bytes===4096&&before.files.includes(photo.id)&&before.files.includes(file.id),`${mode}: durable unknown journal and original bytes/route/files retained`,{calls,before});
    await f.p.evaluate(id=>{WosOutbox.retry(id);WosOutbox.retryAll();},id);await f.p.reload();await f.p.waitForFunction(id=>!!WosOutbox.get(id),id);
    await f.p.evaluate(id=>{WosOutbox.retry(id);WosOutbox.retryAll();},id);await sleep(500);
    const after=await f.p.evaluate(id=>{const x=WosOutbox.get(id);return {body:x.steerBody,state:x.state,bytes:x.audio.size};},id);
    ok(calls.length===1&&!f.state.posts.length&&after.body===before.body&&after.state==='unconfirmed'&&after.bytes===before.bytes,`${mode}: reload plus explicit Retry cannot repeat unknown steer or admit a run`,after);
    await f.done(mode+' steer');
  }
  {
    const f=await boot();f.state.down=false;const calls=await intercept(f,'reject');await activate(f);
    await f.p.evaluate(({wid,photo})=>{__wos.chatState(wid).files=[photo];__wos.sendChat(wid,'Rejected original');},{wid:f.wid,photo});
    await f.p.waitForFunction(()=>[...WosOutbox._items.values()].some(x=>x.state==='failed'));const row=(await f.rows()).find(x=>x.state==='failed');
    await f.p.evaluate(({id,sid})=>{Object.assign(__wos.live.session(sid),{status:'running',runId:'replacement'});WosOutbox.retry(id);},{id:row.id,sid});
    await f.p.waitForFunction(id=>WosOutbox.get(id)?.attempts===2&&WosOutbox.get(id)?.state==='failed',row.id);
    ok(calls.length===2&&calls[0].body===calls[1].body&&calls.every(c=>c.url.includes('/'+run+'/steer'))&&!f.state.posts.length,'explicit rejection retries frozen bytes against captured run, never replacement/new admission',calls);
    await f.p.evaluate(({wid,sid})=>__wos.openChat(wid,sid),{wid:f.wid,sid});await f.p.locator(`[data-obedit="${row.id}"]`).first().click();await sleep(150);
    const restored=await f.p.evaluate(()=>Object.values(__wos.CH||{}).map(x=>({draft:x.draft,files:x.files})));
    // Edit restores through the public UI; inspect rendered composer instead of private CH.
    ok(await f.p.locator('textarea').evaluateAll(es=>es.some(e=>e.value==='Rejected original')),'explicit rejected steer remains editable in actual phone caller',restored);
    await f.done('rejected steer');
  }
  // Active native finish must use the same bounded exact-length reader as recovery.
  for(const mode of ['partial','short-final','no-marker','complete']){
    const f=await boot();f.state.uploadDown=true;
    await f.p.evaluate(({mode,sid,model,provider,run})=>{
      const meta={id:'active-'+mode,kind:'auto',bytes:8192,ms:2000};window.__acks=[];window.__claims=[];
      const read=(id,off)=>mode==='complete'?JSON.stringify({b64:btoa('x'.repeat(4096)),next:off===0?4096:-1}):mode==='short-final'?JSON.stringify({b64:btoa('x'.repeat(2048)),next:-1}):off===0?JSON.stringify({b64:btoa('x'.repeat(mode==='no-marker'?8192:2048)),next:mode==='no-marker'?8192:2048}):null;
      window.WizardOSDevice={version:()=>1,recStart:()=>'',recActive:()=>null,recPending:()=>JSON.stringify([meta]),recClaim:id=>{__claims.push(id);return JSON.stringify(meta);},recRead:read,recDone:id=>__acks.push(id)};
      WosModels.keepVoiceRoute(meta.id,{model,provider});localStorage.setItem('wos.reply-take.v1',JSON.stringify({id:meta.id,sid,steerRunId:run}));
      Object.assign(__wos.V,{native:meta.id,kind:'auto',acc:2000,snap:{route:{model,provider},others:[],desk:0},cancelled:false,parts:[],chunks:[],files:[],replyTo:{sid,steerRunId:run}});
      __wos.nativeFinish(meta.id,true);
    },{mode,sid,model,provider,run});await sleep(450);
    const data=await f.p.evaluate(()=>({acks:__acks,claims:__claims,rows:[...WosOutbox._items.values()].map(x=>({state:x.state,bytes:x.audio?.size,durable:x.durable,run:x.steerRunId})),pin:localStorage.getItem('wos.reply-take.v1'),recovery:__wosVoiceRecovery()}));
    ok(!data.claims.length,mode+': active finish never claims pending native owner',data);
    ok(mode==='complete'?data.acks.length===1&&data.rows.length===1&&data.rows[0].bytes===8192&&data.rows[0].durable&&data.rows[0].run===run:!data.acks.length&&!data.rows.length&&!!data.pin&&data.recovery.length===1,mode+': exact durable handoff or retained discoverable original, never truncated recDone',data);
    await f.done('active '+mode);
  }
  {
    const f=await boot();f.state.uploadDown=true;
    const native=({sid,model,provider,run,complete=false})=>{
      const meta={id:'hidden-stop',kind:'auto',bytes:8192,ms:2000};window.__acks=[];window.__claims=[];
      window.WizardOSDevice={version:()=>1,recStart:()=>'',updateState:()=>'{}',recActive:()=>null,recPending:()=>'[]',recStop:()=>JSON.stringify(meta),recClaim:id=>{__claims.push(id);return JSON.stringify(meta);},recRead:(id,off)=>complete?JSON.stringify({b64:btoa('x'.repeat(8192)),next:-1}):off===0?JSON.stringify({b64:btoa('x'.repeat(2048)),next:2048}):null,recDone:id=>__acks.push(id)};
      if(window.__wos){WosModels.keepVoiceRoute(meta.id,{model,provider});localStorage.setItem('wos.reply-take.v1',JSON.stringify({id:meta.id,sid,steerRunId:run}));Object.assign(__wos.V,{native:meta.id,kind:'auto',acc:2000,snap:{route:{model,provider},others:[],desk:0},cancelled:false,parts:[],chunks:[],files:[],replyTo:{sid,steerRunId:run}});}
    };
    await f.p.evaluate(native,{sid,model,provider,run});await f.p.evaluate(()=>__wos.nativeFinish('hidden-stop',false));await sleep(200);
    ok(await f.p.evaluate(()=>!__acks.length&&!__claims.length&&__wosVoiceRecovery().some(x=>x.id==='hidden-stop'&&x.bytes===8192)),'implicit-claim recStop failure leaves exact metadata and route in reload-visible custody');
    await f.ctx.addInitScript(native,{sid,model,provider,run,complete:true});await f.p.reload();await f.p.waitForFunction(()=>!!window.__wos&&!!window.WosDevice);
    await f.p.evaluate(()=>WosDevice.recoverRecorder());await f.p.locator('[data-take="hidden-stop"] [data-takeact="send"]').click();await sleep(400);
    const row=await f.p.evaluate(()=>({acks:__acks,claims:__claims,it:(()=>{const x=[...WosOutbox._items.values()].find(x=>x.nativeId==='hidden-stop');return x&&{bytes:x.audio?.size,durable:x.durable,steerRunId:x.steerRunId,sessionId:x.sessionId};})()}));
    ok(row.acks.length===1&&!row.claims.length&&row.it?.bytes===8192&&row.it?.durable&&row.it?.steerRunId===run&&row.it?.sessionId===sid,'same-process reload recovery reads hidden native owner without claim and retains pinned destination',row);
    await f.done('implicit stop reload');
  }
  {
    const f=await boot();f.state.uploadDown=true;
    await f.p.evaluate(()=>{
      window.__fault={idb:true,remove:false};const put=IDBObjectStore.prototype.put,rem=Storage.prototype.removeItem;
      IDBObjectStore.prototype.put=function(...args){if(__fault.idb)throw Error('put fault');return put.apply(this,args);};
      Storage.prototype.removeItem=function(...args){if(__fault.remove)throw Error('remove fault');return rem.apply(this,args);};
    });
    const id=await f.p.evaluate(async({sid,model,provider})=>(await WosOutbox.enqueue({kind:'reply',sessionId:sid,model,provider,text:'Dismissed original',audio:new Blob(['x'.repeat(2048)],{type:'audio/webm'})})).id,{sid,model,provider});
    await f.p.waitForFunction(id=>WosOutbox.get(id)?.state==='waiting',id);
    ok(await f.p.evaluate(async id=>{__fault.idb=false;__fault.remove=true;return WosOutbox.remove(id);},id),'terminal dismissal succeeds with primary marker and failed fallback cleanup');
    await f.ctx.addInitScript(()=>{const open=indexedDB.open.bind(indexedDB);window.__restorePrimary=()=>indexedDB.open=open;indexedDB.open=()=>{throw Error('startup unavailable');};});
    f.state.down=false;f.state.uploadDown=false;await f.p.reload();await f.p.waitForFunction(()=>!!window.WosOutbox);await f.p.evaluate(async()=>{await WosOutbox.load();WosOutbox.retryAll();});await sleep(500);
    const data=await f.p.evaluate(id=>({complete:WosOutbox.recoveryComplete,quarantined:WosOutbox.quarantined(id),row:WosOutbox.get(id)}),id);
    ok(!f.state.posts.length&&!data.complete&&data.quarantined,'primary failure AFTER success quarantines stale fallback across retry',data);
    await f.p.evaluate(({sid,model,provider})=>WosOutbox.enqueue({kind:'reply',sessionId:sid,model,provider,text:'Unrelated fresh submission'}),{sid,model,provider});
    await f.p.waitForFunction(()=>[...WosOutbox._items.values()].some(x=>x.text==='Unrelated fresh submission'&&x.state==='sent'));
    ok(f.state.posts.length===1&&f.state.posts[0].input==='Unrelated fresh submission','quarantine does not block unrelated new submissions');
    await f.p.evaluate(async()=>{__restorePrimary();await WosOutbox.load();WosOutbox.retryAll();});await sleep(400);
    const after=await f.p.evaluate(id=>({complete:WosOutbox.recoveryComplete,row:WosOutbox.get(id)}),id);
    ok(after.complete&&after.row?.compact&&f.state.posts.length===1,'authoritative terminal reconciliation clears quarantine without replay',after);
    await f.done('cross-store quarantine');
  }
  {
    const f=await boot();const id=await f.p.evaluate(async({sid,model,provider})=>{const x=await WosOutbox.stage({kind:'reply',sessionId:sid,model,provider,audio:new Blob(['x'.repeat(2048)])});await WosOutbox.transition(x.id,'held','Handled locally');return x.id;},{sid,model,provider});
    ok(!await f.p.evaluate(sid=>__wos.live.pending(sid),sid),'local held audio is custody, not pending delivery');
    await f.p.evaluate(id=>WosOutbox.remove(id),id);
    ok(!await f.p.evaluate(sid=>__wos.live.pending(sid),sid),'terminal compaction removes pending ownership immediately');
    const pending=await f.p.evaluate(async({sid,model,provider})=>(await WosOutbox.enqueue({kind:'reply',sessionId:sid,model,provider,text:'Real pending send'})).id,{sid,model,provider});
    await f.p.waitForFunction(id=>WosOutbox.get(id)?.state==='waiting',pending);
    await f.p.evaluate(async({sid,model,provider})=>{const x=await WosOutbox.stage({kind:'reply',sessionId:sid,model,provider,audio:new Blob(['x'.repeat(2048)])});await WosOutbox.transition(x.id,'held','Local only');},{sid,model,provider});
    ok(await f.p.evaluate(({sid,pending})=>__wos.live.pending(sid)?.key===pending,{sid,pending}),'newer held custody cannot hide an older genuine pending send');
    await f.done('held projection');
  }
};
