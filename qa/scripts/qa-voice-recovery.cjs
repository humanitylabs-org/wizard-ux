// Run via QA_RECOVERY_ONLY=1 QA_OUT=<private dir> node qa-voice-custody-callers.cjs (not directly).
// Focused recovery regressions, imported by the real-shell custody harness. All writes intercepted.
const path=require('node:path');
module.exports=async({boot,ok,sleep,sid,model,provider,out})=>{
 for(const desktop of [false,true]){
  const label=desktop?'desktop':'phone',f=await boot(desktop);
  const add=async(state='failed',extras={})=>f.p.evaluate(async({state,extras,sid,model,provider})=>{
   const it=await WosOutbox.stage({kind:'reply',sessionId:sid,model,provider,source:'orb',intent:'auto',audio:new Blob(['exact original recording'],{type:'audio/webm'}),files:[{id:'photo-original',name:'photo.png'}],...extras});
   await WosOutbox.transition(it.id,state,'Handled on this device · original recording kept; not queued to the agent');return it.id;
  },{state,extras,sid,model,provider});
  const failed=await add(),held=await add('held',{intent:'command'});
  await f.p.reload();await f.p.waitForFunction(()=>WosOutbox?.recoveryComplete&&(window.__wos||window.__wux)?.chats);
  // Cold entry now lands on Home. Explicitly return to the retained Chats desk before real taps.
  await f.p.evaluate(({wid,sid})=>{const A=window.__wos||window.__wux;A.chats.openChat(wid,sid);A.focusWin?.(wid);if(A.goDesk)A.goDesk(A.desks.findIndex(d=>d.wins.includes(wid)),true);},{wid:f.wid,sid});
  const settings=await f.p.evaluate(id=>WosSettings.unsentRow({...WosOutbox.get(id),origin:'app'},{outbox:WosOutbox,live:WizLive}),held);
  ok(settings.includes('Handled on this device')&&!settings.includes('words come when it sends')&&!settings.includes('data-ub="edit"')&&settings.includes('data-ub="transcribe"')&&settings.includes('data-ub="play"'),label+': held recovery exposes reason and non-delivery actions',settings);
  const recover=f.p.locator(`[data-chats="${f.wid}"] [data-obrecover="${held}"]`);
  await recover.click(); await sleep(200);
  ok(await f.p.locator(`#settingsBody [data-ubid="${held}"] [data-ub="transcribe"]`).isVisible(),label+': held bubble Recover opens selected recording controls');
  if(desktop)await f.p.evaluate(()=>__wux.closeSettings());else await f.p.locator('[data-stclose]:visible').click();
  await f.p.evaluate(wid=>(window.__wos||window.__wux).chats.openChat(wid,'__new__'),f.wid);
  const newHeld=await add('held',{kind:'new',sessionId:'',wid:f.wid,intent:'command'});await sleep(150);
  await f.p.locator(`[data-chats="${f.wid}"] [data-obrecover="${newHeld}"]`).click();await sleep(150);
  ok(await f.p.locator(`#settingsBody [data-ubid="${newHeld}"] [data-ub="play"]`).isVisible(),label+': screenshot New chat held note has working recovery');
  if(desktop)await f.p.evaluate(()=>__wux.closeSettings());else await f.p.locator('[data-stclose]:visible').click();
  await f.p.evaluate(id=>WosOutbox.dismissBubble(id),newHeld);
  await f.p.evaluate(()=>{dispatchEvent(new Event('online'));document.dispatchEvent(new Event('visibilitychange'));});await sleep(150);
  ok(f.state.posts.length===0,label+': automatic wake never sends permanent failure or held command');
  await f.p.evaluate(wid=>{const A=window.__wos||window.__wux;A.chats.openChat(wid,null);A.focusWin?.(wid);},f.wid);await sleep(200);
  // Recovery must survive search and an empty result list, not depend on Errors expanding.
  await f.p.locator(`[data-chats="${f.wid}${desktop?'::list':''}"] [data-chsearch]`).fill('no fixture thread matches');await sleep(400);
  const retry=f.p.locator(`[data-chats="${f.wid}${desktop?'::list':''}"] .ch-pill [data-obretry="${failed}"]`);
  ok(await retry.count()===1,label+': retained failed audio retry discoverable with empty searched list');
  if(await retry.count()){
   // The painted button can stay compact; measure actual hit testing, not just its visual box.
   const hit=await retry.evaluate(el=>{const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
    return {width:r.width,height:r.height,hit:[[x,y],[x,y-21.9],[x,y+21.9],[x-21.9,y],[x+21.9,y]].every(([a,b])=>el.contains(document.elementFromPoint(a,b)))};});
   ok(hit.hit,label+': real retry hit target >=44px',hit);
   await f.p.screenshot({path:path.join(out,label+'-recovery.png')});
  }
  // Explicit Retry all includes failed, but not the held command, and claims only real queueing.
  f.state.down=false;
  const count=await f.p.evaluate(()=>WosOutbox.retryAll());await sleep(500);
  ok(count===1&&f.state.runs.size===1,label+': manual bulk retries eligible failed exactly once',{count,runs:f.state.runs.size});
  ok(await f.p.evaluate(id=>WosOutbox.get(id)?.state==='held',held),label+': bulk leaves command held');
  const sent=f.state.posts.find(p=>p.session_id===sid);
  ok(sent?.model===model&&sent?.provider===provider&&sent?.wizard_file_ids?.includes('photo-original'),label+': retry preserves original route and attachments',sent);
  ok(await f.p.evaluate(()=>WosOutbox.retryAll())===0,label+': no-op bulk reports zero');
  // Real Settings controls: held is inspectable, never promoted to a send.
  await f.p.evaluate(()=> (window.__wos||window.__wux).openSettings('unsent'));await sleep(250);
  const row=f.p.locator(`#settingsBody [data-ubid="${held}"]`);
  const transcribe=row.locator('[data-ub="transcribe"]');
  const rect=await transcribe.boundingBox();ok(rect?.height>=44,label+': held Settings transcription touch target',rect);
  await f.p.screenshot({path:path.join(out,label+'-held-settings.png')});
  const before=await f.p.evaluate(id=>{const x=WosOutbox.get(id);return JSON.stringify({state:x.state,error:x.error,text:x.text,files:x.files,model:x.model,provider:x.provider,sessionId:x.sessionId,audio:x.audio.size});},held);
  await transcribe.click();await f.p.waitForFunction(id=>!!WosOutbox.get(id)?.recoveryText,held);
  const after=await f.p.evaluate(id=>{const x=WosOutbox.get(id);return JSON.stringify({state:x.state,error:x.error,text:x.text,files:x.files,model:x.model,provider:x.provider,sessionId:x.sessionId,audio:x.audio.size});},held);
  ok(before===after&&f.state.runs.size===1,label+': transcribe-only preserves held reason, original envelope and admission count');
  await row.locator('[data-ub="copy"]').click();
  ok(await row.locator('[data-ub="retry"]').count()===0,label+': held has no misleading send retry');
  await f.p.reload();await f.p.waitForFunction(()=>WosOutbox?.recoveryComplete);
  ok(await f.p.evaluate(id=>!!WosOutbox.get(id)?.recoveryText&&WosOutbox.get(id)?.state==='held',held),label+': recovered transcript and held state survive reload');
  ok(await f.p.evaluate(id=>!WosSettings.unsentAll({outbox:WosOutbox}).some(x=>x.id===id),failed),label+': proven sent receipt excluded from Unsent');
  await f.done(label+' recovery');
 }
 for(const desktop of [false,true]){
  const label=desktop?'desktop':'phone',f=await boot(desktop); f.state.down=false;
  await f.ctx.route('**/runs/*/steer**',r=>r.abort('connectionreset'));
  const unknown=await f.p.evaluate(async({sid,model,provider})=>{const x=await WosOutbox.stage({kind:'reply',sessionId:sid,agent:'',model,provider,steerRunId:'exact-original-run',audio:new Blob(['ambiguous original'],{type:'audio/webm'})});return (await WosOutbox.enqueue({custodyId:x.id,kind:'reply',sessionId:sid,model,provider,text:'unknown steer'})).id;},{sid,model,provider});
  await f.p.waitForFunction(id=>WosOutbox.get(id)?.state==='unconfirmed',unknown);
  const failed=await f.p.evaluate(async({sid,model,provider})=>{const x=await WosOutbox.stage({kind:'reply',sessionId:sid,model,provider,agent:'research',audio:new Blob(['retry-original'],{type:'audio/webm'}),files:[{id:'photo-frozen'}],text:'frozen retry'});await WosOutbox.transition(x.id,'failed','Explicit failure');return x.id;},{sid,model,provider});
  // Route-filtered bulk must not deliver the other agent; global Settings recovery may.
  ok(await f.p.evaluate(()=>WosOutbox.retryAll(''))===0,label+': Chats bulk scoped to original agent');
  f.state.dropReceipt=true;
  const taps=await f.p.evaluate(id=>[WosOutbox.retry(id),WosOutbox.retry(id)],failed);
  await f.p.waitForFunction(id=>WosOutbox.get(id)?.state==='waiting',failed);
  ok(taps[0]===true&&taps[1]===false&&f.state.calls.length===1,label+': double retry claims one attempt',taps);
  const snapshot=await f.p.evaluate(id=>{const x=WosOutbox.get(id);return {body:x.body,audio:x.audio.size,audioFile:x.audioFile,files:x.files,model:x.model,provider:x.provider,agent:x.agent};},failed);
  await f.p.reload();await f.p.waitForFunction(()=>WosOutbox?.recoveryComplete);
  await f.p.evaluate(()=>dispatchEvent(new Event('online')));await f.p.waitForFunction(id=>WosOutbox.get(id)?.state==='sent',failed);
  ok(f.state.runs.size===1&&f.state.calls.every(c=>c.key===failed&&c.body===snapshot.body),label+': lost receipt reload/reconnect reuses exact identity/body with one admission',f.state.calls);
  const sent=JSON.parse(snapshot.body);
  ok(sent.agent==='research'&&sent.model===model&&sent.provider===provider&&sent.session_id===sid&&sent.wizard_file_ids.includes('photo-frozen')&&snapshot.audio>0&&snapshot.audioFile.id,label+': lost receipt keeps all original route, file and audio receipts');
  ok(await f.p.evaluate(id=>WosOutbox.get(id)?.state==='unconfirmed'&&!WosOutbox.retry(id),unknown),label+': unknown steering remains blocked after reload and reconnect');
  // Add a same-agent failure to an ambiguous list, then click the actual mixed pill.
  const next=await f.p.evaluate(async({sid,model,provider})=>{const x=await WosOutbox.stage({kind:'reply',sessionId:sid,model,provider,text:'next eligible',audio:new Blob(['next original'],{type:'audio/webm'})});await WosOutbox.transition(x.id,'failed','Not sent');return x.id;},{sid,model,provider});
  f.state.listDown=true;await f.p.evaluate(async({wid,desktop})=>{await WizLive.refresh();WizLive.ok=false;WizLive.sessions=[];const A=window.__wos||window.__wux;A.chats.openChat(wid,null);A.focusWin?.(wid);if(A.goDesk)A.goDesk(A.desks.findIndex(d=>d.wins.includes(wid)),true);A.chats.renderChats(desktop?{id:wid+'::list',thread:null}:A.wins[wid]);},{wid:f.wid,desktop});await sleep(250);
  const scope=`[data-chats="${f.wid}${desktop?'::list':''}"]`;
  const mixed=f.p.locator(scope+' [data-obretryall]');
  ok(await mixed.count()===1,label+': offline mixed ambiguous + failed exposes eligible retry',await f.p.evaluate(()=>WosOutbox.unsent().map(x=>({id:x.id,agent:x.agent,kind:x.kind,state:x.state,eligible:WosOutbox.canRetry(x)}))));
  await f.p.screenshot({path:path.join(out,label+'-mixed-offline.png')});
  ok(await f.p.locator(scope+' .ch-empty').count()>0,label+': disconnected empty-list branch rendered');
  await f.p.evaluate(wid=>{WizLive.ok=true;WizLive.sessions=[];const A=window.__wos||window.__wux;A.chats.renderChats(A.wins[wid]);},f.wid);await sleep(150);
  ok(await mixed.count()===1,label+': connected empty list still exposes recovery');
  if(await mixed.count()){await mixed.click();await f.p.waitForFunction(id=>WosOutbox.get(id)?.state==='sent',next);}
  ok(f.state.runs.size===2&&await f.p.evaluate(id=>WosOutbox.get(id)?.state==='unconfirmed',unknown),label+': real mixed-piIl click sends eligible only');
  await f.done(label+' receipt recovery');
 }
};
