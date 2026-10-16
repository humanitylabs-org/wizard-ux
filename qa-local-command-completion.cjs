// Real phone/desktop callers + old-store upgrade. Network mutations are intercepted.
module.exports=async({boot,ok,sleep,sid,model,provider})=>{
 for(const desktop of [false,true]) for(const command of ['settings','wisdom','mizel']){
  if(command!=='settings'&&process.env.QA_LOCAL_ONLY!=='1')continue;
  const label=(desktop?'desktop':'phone')+' '+command;
  const f=await boot(desktop); f.state.text='open '+(command==='mizel'?'Mizel.ai':command);f.state.cmd=command==='settings'?{route:'command',action:'open_view',view:'settings'}:{route:'command',action:'open_app',app:command};
  await f.p.evaluate(()=>{window.__sentCount=0;WosOutbox.onSent(()=>__sentCount++);});
  if(desktop){await f.p.evaluate(w=>__wux.chats.openChat(w,null),f.wid);await f.p.evaluate(()=>__wux.talk('start'));await sleep(1100);await f.p.evaluate(()=>__wux.talk('send'));}else{await f.p.evaluate(()=>__wos.goDesk(0));await f.take();}
  await f.p.waitForFunction(()=>[...WosOutbox._items.values()].some(x=>x.completion==='local')).catch(async e=>{console.log('LOCAL DEBUG',desktop,await f.rows(),f.state);throw e;});
  const before=await f.p.evaluate(()=>({items:[...WosOutbox._items.values()],unsent:WosOutbox.unsent().length,hooks:__sentCount,settings:!document.querySelector('#settingsSheet')?.hidden}));
  ok(before.items.some(x=>x.completion==='local'&&x.compact&&!x.audio&&x.durable)&&before.unsent===0,label+': executed command releases browser audio and leaves no recovery row',before);
  ok(f.state.posts.length===0&&before.hooks===0,label+': local success creates no agent run or false Sent notification');
  if(command!=='settings')ok(await f.p.evaluate(command=>Object.values((window.__wos||window.__wux).wins).some(w=>w.appId===command),command),label+': requested app actually opened');
  await f.p.reload();await f.p.waitForFunction(()=>WosOutbox?.recoveryComplete);await f.p.evaluate(()=>dispatchEvent(new Event('online')));await sleep(150);
  ok(await f.p.evaluate(()=>WosOutbox.unsent().length===0)&&f.state.posts.length===0,label+': local completion survives reload and reconnect');
  await f.done(label+' local command');
 }
 {
  const f=await boot(true);f.state.text='open settings';
  await f.p.evaluate(()=>__wux.commandVoice());await sleep(1100);await f.p.evaluate(()=>__wux.commandVoice());
  ok(await f.p.evaluate(()=>[...WosOutbox._items.values()].some(x=>x.completion==='local'&&!x.audio))&&f.state.posts.length===0,'desktop held-command: dictated local take completes without sending');await f.done('desktop held-command');
 }
 for(const desktop of [false,true]){
  const label=desktop?'desktop':'phone',f=await boot(desktop);
  const ids=await f.p.evaluate(async({sid,model,provider})=>{
   const cases=[['known','Handled on this device · original recording kept; not queued to the agent',{}],['desktop','Local command handled · original recording kept',{}],['unknown','Delivery not confirmed · original recording kept; not queued for retry',{}],['attachment','Handled on this device · original recording kept; not queued to the agent',{files:[{id:'photo',name:'original.png'}]}],['typed','Local command handled · original recording kept',{typed:'unsent draft'}],['dictation','Dictation recording · original kept',{kind:'dictation'}]];
   const ids={};for(const [name,error,extra] of cases){const x=await WosOutbox.stage({kind:'new',model,provider,audio:new Blob(['original '+name]),...extra});await WosOutbox.transition(x.id,'held',error);ids[name]=x.id;}return ids;
  },{sid,model,provider});
  await f.p.reload();await f.p.waitForFunction(()=>WosOutbox?.recoveryComplete);await sleep(150);
  const state=await f.p.evaluate(ids=>Object.fromEntries(Object.entries(ids).map(([k,id])=>{const x=WosOutbox.get(id);return [k,{state:x.state,completion:x.completion,audio:x.audio?.size,typed:x.typed,files:x.files}];})),ids);
  ok(['known','desktop'].every(k=>state[k].state==='held'&&state[k].audio>0),label+': ambiguous legacy handled labels retain original audio',state);
  ok(['unknown','attachment','typed','dictation'].every(k=>state[k].state==='held'&&state[k].audio>0),label+': upgrade preserves unknown recordings, photos, drafts and dictation',state);
  ok(f.state.posts.length===0,label+': migration never replays commands or sends recordings');
  // Persistent and fallback write failure must preserve native custody and original bytes.
  const failure=await f.p.evaluate(async({model,provider})=>{
   const x=await WosOutbox.stage({kind:'new',model,provider,nativeId:'native-completed',audio:new Blob(['original on storage failure'])});
   __fault.all=true;const result=await WosOutbox.completeLocal(x.id);const row=WosOutbox.get(x.id);__fault.all=false;await WosOutbox.transition(x.id,'held',row.error);
   return {id:x.id,result,state:row.state,bytes:row.audio?.size,localCompleted:row.localCompleted};
  },{model,provider});
  ok(!failure.result&&failure.state==='held'&&failure.bytes>0&&failure.localCompleted,label+': storage failure retains original instead of claiming cleanup',failure);
  await f.p.reload();await f.p.waitForFunction(()=>WosOutbox?.recoveryComplete);await sleep(150);
  ok(await f.p.evaluate(id=>WosOutbox.get(id)?.completion==='local'&&!WosOutbox.get(id)?.audio,failure.id),label+': saved local receipt completes cleanup when storage returns');
  await f.done(label+' local upgrade');
 }
 {
  const f=await boot();f.state.text='zoom in';f.state.cmd={route:'command',action:'zoom',dir:'in'};
  await f.p.evaluate(()=>{__wos.goDesk(0);__wos.execute({action:'zoom',dir:'in'},'zoom in');const timeout=window.setTimeout;window.setTimeout=(fn,ms,...args)=>{if(ms===200&&String(fn).includes('zoomOut')){window.__deferredZoom=fn;return 0;}return timeout(fn,ms,...args);};});
  await f.take();await f.p.waitForFunction(()=>window.__deferredZoom&&WosOutbox.unsent().some(x=>x.state==='held'));
  ok(await f.p.evaluate(()=>!WosCommands.completedLocally({action:'zoom'},true)&&WosOutbox.unsent().some(x=>x.state==='held'&&x.audio?.size>0))&&f.state.posts.length===0,'phone deferred zoom: keeps recording until actual command completion');
  await f.p.reload();await f.p.waitForFunction(()=>WosOutbox?.recoveryComplete);
  ok(await f.p.evaluate(()=>WosOutbox.unsent().some(x=>x.state==='held'&&x.audio?.size>0)),'phone deferred zoom: reload before callback retains original');
  await f.done('phone deferred zoom');
 }
 for(const desktop of [false,true]){
  const label=desktop?'desktop':'phone',f=await boot(desktop);f.state.text='pause music';f.state.cmd={route:'command',action:'music',cmd:{op:'pause'}};
  await f.p.evaluate(()=>{WosMusic.available=()=>true;WosMusic.parse=()=>({op:'pause',strong:true});WosMusic.run=()=>{window.__musicAccepted=true;return true;};});
  if(desktop){await f.p.evaluate(()=>__wux.commandVoice());await sleep(1100);await f.p.evaluate(()=>__wux.commandVoice());}else{await f.p.evaluate(()=>__wos.goDesk(0));await f.take();}
  await f.p.waitForFunction(()=>window.__musicAccepted&&[...WosOutbox._items.values()].some(x=>x.state==='held'));
  const pending=await f.p.evaluate(()=>({accepted:window.__musicAccepted,rows:[...WosOutbox._items.values()].map(x=>({state:x.state,bytes:x.audio?.size,completion:x.completion}))}));
  ok(pending.accepted&&pending.rows.some(x=>x.state==='held'&&x.bytes>0&&!x.completion)&&f.state.posts.length===0,label+': music acceptance without completion keeps audio',pending);
  await f.done(label+' pending music');
 }
 {
  const f=await boot();
  const id=await f.p.evaluate(async({model,provider})=>{const x=await WosOutbox.stage({kind:'new',model,provider,nativeId:'fallback-completed',audio:new Blob(['fallback original'])});__fault.idb=true;await WosOutbox.completeLocal(x.id);return x.id;},{model,provider});
  ok(await f.p.evaluate(id=>WosOutbox.get(id)?.completion==='local'&&JSON.parse(localStorage.getItem('wos.outbox.fallback.v2.'+id))?.completion==='local',id),'fallback: terminal marker durably stored without IndexedDB');
  await f.p.reload();await f.p.waitForFunction(()=>WosOutbox?.recoveryComplete);
  const recovered=await f.p.evaluate(async id=>{const row=WosOutbox.get(id);const stored=await new Promise(resolve=>{const req=indexedDB.open('wos-outbox',1);req.onsuccess=()=>{const d=req.result,r=d.transaction('items').objectStore('items').get(id);r.onsuccess=()=>{resolve(r.result);d.close();};};});return {local:row?.completion,primary:stored?.completion,duplicate:WosOutbox.nativeItem('fallback-completed')?.id,fallback:localStorage.getItem('wos.outbox.fallback.v2.'+id)};},id);
  ok(recovered.local==='local'&&recovered.primary==='local'&&recovered.duplicate===id&&!recovered.fallback,'fallback: completion migrates to primary without losing native dedupe',recovered);
  await f.done('fallback completion');
 }
 {
  const f=await boot();
  const id=await f.p.evaluate(async({model,provider})=>{
   const x=await WosOutbox.stage({kind:'new',model,provider,audio:new Blob(['race original'])});x.storageError='retry needed';
   const put=IDBObjectStore.prototype.put;
   IDBObjectStore.prototype.put=function(row,...args){if(row.completion==='local'){const finish=this.transaction.oncomplete;this.transaction.oncomplete=e=>{window.__releaseMarker=()=>finish(e);window.__markerCommitted=true;};}return put.call(this,row,...args);};
   window.__completionJob=WosOutbox.completeLocal(x.id);return x.id;
  },{model,provider});
  await f.p.waitForFunction(()=>window.__markerCommitted);
  await f.p.evaluate(async({id,model,provider})=>{dispatchEvent(new Event('online'));window.__staleWrite=WosOutbox.keepTranscript(id,'late transcription');await WosOutbox.enqueue({custodyId:id,kind:'new',text:'must never be sent',model,provider});},{id,model,provider});
  const result=await f.p.evaluate(async id=>{__releaseMarker();const completed=await __completionJob;await __staleWrite;return {completed,row:WosOutbox.get(id)};},id);
  ok(result.completed&&result.row.completion==='local'&&!result.row.audio&&f.state.posts.length===0,'race: completion fences stale storage retry and delayed enqueue',result);
  await f.p.reload();await f.p.waitForFunction(()=>WosOutbox?.recoveryComplete);await sleep(150);
  ok(await f.p.evaluate(id=>WosOutbox.get(id)?.completion==='local'&&!WosOutbox.unsent().some(x=>x.id===id),id)&&f.state.posts.length===0,'race: terminal marker remains durable after reload');
  await f.done('completion race');
 }
};
