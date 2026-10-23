// Held-orb commands are commands, never messages (James, 17 Oct 2026: "Why are my long press voice
// commands all popping up here as failed voice errors?"). Through the REAL phone and desktop callers:
// an executed, router-resolved, unmatched or music command leaves no row in Settings → Unsent & retained
// and posts nothing; a failed music receipt keeps the recording; old settled rows are cleared on load.
// Run: QA_HELD_ONLY=1 node qa-voice-custody-callers.cjs
module.exports=async({boot,ok,sleep,sid,model,provider})=>{
 const holdTake=async f=>{await f.p.evaluate(()=>document.activeElement?.blur());await f.p.evaluate(()=>__wos.goDesk(0));await f.p.evaluate(()=>__wos.startVoice('command'));await f.p.waitForFunction(()=>['listen','command'].includes(__wos.voice));await sleep(1100);await f.p.evaluate(()=>__wos.finishVoice());};
 const unsent=f=>f.p.evaluate(()=>WosOutbox.unsent().map(x=>({state:x.state,error:x.error,text:x.recoveryText||x.text,bytes:x.audio?.size})));
 const settle=f=>f.p.waitForFunction(()=>['idle','done'].includes(__wos.voice)&&![...WosOutbox._items.values()].some(x=>['processing','preparing','capturing'].includes(x.state)),null,{timeout:15000}).catch(()=>{});
 const musicStub=(f,result)=>f.p.evaluate(result=>{window.__musicRuns=[];WosMusic.available=()=>true;WosMusic.run=(cmd,onDone)=>{__musicRuns.push(cmd);if(result!==null)setTimeout(()=>onDone&&onDone(result),300);return true;};},result);

 // 1. Router-resolved app open ("Open meditation." → open_app). Before: router skipped, row "Delivery not confirmed".
 {const f=await boot();f.state.text='Open meditation.';f.state.cmd={route:'command',action:'open_view',view:'settings'};
  let routed=0;await f.p.route('**/wizard/v1/route',r=>{routed++;return r.fallback();});
  await holdTake(f);await settle(f);await sleep(400);
  const rows=await unsent(f);
  ok(routed>0,'phone held: no on-device match still asks the router',{routed});
  ok(rows.length===0&&f.state.posts.length===0,'phone held: router command leaves no Unsent row and sends nothing',{rows,posts:f.state.posts.length});
  await f.done('held router command');}

 // 1b. Held over an open thread (James, 23 Oct 2026 screenshot): while the take is transcribing, the thread shows no
 // "Voice note · words come when it sends" bubble. A held take is a system command, never a message in any chat.
 {const f=await boot();f.state.text='Open air lock.';f.state.cmd={route:'agent',summary:'x'};f.state.sttDelay=2500;
  await f.p.evaluate(s=>__wos.openWizardThread(s),sid);await sleep(1500);
  await f.p.evaluate(()=>document.activeElement?.blur());await f.p.evaluate(()=>__wos.startVoice('command'));await f.p.waitForFunction(()=>['listen','command'].includes(__wos.voice));await sleep(1100);await f.p.evaluate(()=>__wos.finishVoice());
  await sleep(1200);
  const mid=await f.p.evaluate(s=>({bubbles:document.querySelectorAll('.msg.pending').length,staged:[...WosOutbox._items.values()].filter(x=>x.intent==='command').length,inThread:WosOutbox.forThread(s).length}),sid);
  ok(mid.staged>0&&mid.bubbles===0&&mid.inThread===0,'phone held over a thread: the take never shows as a voice note in that chat',mid);
  await settle(f);f.state.sttDelay=0;
  await f.done('held over thread');}

 // 2. Router says "agent" (not a command): choice card, nothing sent, no failed-voice row.
 {const f=await boot();f.state.text='what is the capital of peru';f.state.cmd={route:'agent',summary:'x'};
  await holdTake(f);await settle(f);await sleep(400);
  const rows=await unsent(f),chips=await f.p.evaluate(()=>[...document.querySelectorAll('#txChips [data-hold]')].map(b=>b.dataset.hold));
  ok(rows.length===0&&f.state.posts.length===0,'phone held no-match: no Unsent row, nothing sent',{rows,posts:f.state.posts.length});
  ok(chips.includes('agent'),'phone held no-match: Send-to-agent choice still offered',chips);
  await f.p.locator('#txChips [data-hold="agent"]').click();await sleep(1500);
  ok(f.state.posts.length>0||(await unsent(f)).length>0,'phone held no-match: tapping Send queues the words on purpose',{posts:f.state.posts.length});
  await f.done('held no-match');}

 // 3. Music with a done receipt ("Play music Home Tides.") and the router's play_music vocabulary.
 for(const [label,text,cmd] of [['local music','Play music Home Tides.',{route:'agent'}],['router play_music','Put Home Tides by Rüfüs on please maybe',{route:'command',action:'play_music',query:'Home Tides'}],['open music and play','Open music and play Home Tides.',{route:'agent'}]]){
  const f=await boot();f.state.text=text;f.state.cmd=cmd;await musicStub(f,true);
  await holdTake(f);await settle(f);await sleep(900);
  const rows=await unsent(f),runs=await f.p.evaluate(()=>__musicRuns);
  ok(runs.length===1&&runs[0].op==='play'&&/home tides/i.test(runs[0].said||''),`phone held ${label}: Wizard Music asked to play Home Tides`,runs);
  ok(rows.length===0&&f.state.posts.length===0,`phone held ${label}: confirmed playback leaves no Unsent row`,{rows});
  await f.done('held '+label);}

 // 4. Music that fails keeps the recording, with an honest label.
 {const f=await boot();f.state.text='Play music Home Tides.';await musicStub(f,false);
  await holdTake(f);await settle(f);await sleep(900);
  const rows=await unsent(f);
  ok(rows.length===1&&rows[0].bytes>0&&/Music didn’t confirm/.test(rows[0].error),'phone held music failure: recording kept, labelled honestly',rows);
  await f.done('held music failure');}

 // 5. Desktop held command: executed or unmatched, no row.
 for(const [label,text] of [['executed','open settings'],['unmatched','what is the capital of peru']]){
  const f=await boot(true);f.state.text=text;
  await f.p.evaluate(()=>__wux.commandVoice());await sleep(1100);await f.p.evaluate(()=>__wux.commandVoice());await sleep(2000);
  const rows=await unsent(f);
  ok(rows.length===0&&f.state.posts.length===0,`desktop held ${label}: no Unsent row, nothing sent`,{rows});
  await f.done('desktop held '+label);}

 // 6. Upgrade: settled command rows left by earlier builds clear on load; unheard/interrupted and messages stay.
 {const f=await boot();
  const ids=await f.p.evaluate(async({model,provider})=>{
   const old=Date.now()-2*3600e3,cases=[
    ['accepted','Command accepted · completion unconfirmed; original recording kept','command','Play music Home Tides.',old],
    ['delivery','Delivery not confirmed · original recording kept; not queued for retry','command','Open meditation.',old],
    ['fresh','Command accepted · completion unconfirmed; original recording kept','command','zoom in',Date.now()],
    ['unheard','Command not heard · recording kept; nothing sent','command','',old],
    ['message','Delivery not confirmed · original recording kept; not queued for retry','message','hello there',old]];
   const ids={};for(const [k,error,intent,text,at] of cases){const x=await WosOutbox.stage({kind:'new',model,provider,intent,audio:new Blob(['orig '+k])});if(text)await WosOutbox.keepTranscript(x.id,text);await WosOutbox.transition(x.id,'held',error);const it=WosOutbox._items.get(x.id);it.createdAt=it.updatedAt=at;
    await new Promise(res=>{const q=indexedDB.open('wos-outbox',1);q.onsuccess=()=>{const d=q.result,t=d.transaction('items','readwrite');t.objectStore('items').put(it);t.oncomplete=()=>{d.close();res();};};});ids[k]=x.id;}
   return ids;},{model,provider});
  await f.p.reload();await f.p.waitForFunction(()=>WosOutbox?.recoveryComplete);await sleep(300);
  const st=await f.p.evaluate(ids=>Object.fromEntries(Object.entries(ids).map(([k,id])=>{const x=WosOutbox.get(id);return [k,{state:x?.state,completion:x?.completion,bytes:x?.audio?.size}];})),ids);
  ok(st.accepted.completion==='local'&&st.delivery.completion==='local','upgrade: old settled held-command rows are cleared',st);
  ok(st.fresh.state==='held'&&st.fresh.bytes>0,'upgrade: a just-made pending command keeps its recording',st);
  ok(st.unheard.state==='held'&&st.unheard.bytes>0&&st.message.state==='held'&&st.message.bytes>0,'upgrade: unheard commands and real messages keep their recordings',st);
  ok(f.state.posts.length===0,'upgrade: cleanup never replays or sends anything');
  await f.done('held upgrade');}
};
