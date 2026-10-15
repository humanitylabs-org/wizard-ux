const path=require('node:path');
module.exports=async({boot,ok,sleep,sid,model,provider,out})=>{
 for(const desktop of [false,true]){
  const label=desktop?'desktop':'phone',f=await boot(desktop);f.state.text='';f.state.down=false;
  const add=async sessionId=>f.p.evaluate(async({sessionId,model,provider})=>{const it=await WosOutbox.enqueue({kind:'reply',sessionId,model,provider,audio:new Blob(['retained original audio'],{type:'audio/webm'})});return it.id;},{sessionId,model,provider});
  const id=await add(sid),id2=await add('empty-second-thread');
  await f.p.waitForFunction(ids=>ids.every(id=>WosOutbox.get(id)?.state==='empty'),[id,id2]);await sleep(300);
  const txt=await f.p.locator(`[data-ob="${id}"]`).innerText();
  ok(txt.includes('No speech detected')&&!txt.includes('Sending')&&!txt.includes('words come when'),`${label}: no-speech bubble reports terminal state`,txt);
  ok(f.state.posts.length===0,`${label}: no-speech notes never admitted`);
  await f.p.screenshot({path:path.join(out,`${label}-empty.png`)});
  const before=await f.p.evaluate(async id=>{const r=WosOutbox.get(id);return {bytes:Array.from(new Uint8Array(await r.audio.arrayBuffer())),file:r.audioFile,model:r.model,provider:r.provider};},id);
  await f.p.locator(`[data-obdismiss="${id}"]`).click();await f.p.waitForFunction(id=>WosOutbox.get(id)?.threadHidden===true,id);await sleep(200);
  ok(await f.p.locator(`[data-ob="${id}"]`).count()===0,`${label}: Dismiss removes only selected bubble`);
  ok(await f.p.evaluate(id=>!WosOutbox.get(id).threadHidden,id2),`${label}: second thread unchanged`);
  const after=await f.p.evaluate(async id=>{const r=WosOutbox.get(id);return {bytes:Array.from(new Uint8Array(await r.audio.arrayBuffer())),file:r.audioFile,model:r.model,provider:r.provider};},id);
  ok(JSON.stringify(before)===JSON.stringify(after),`${label}: dismissal preserves exact audio and route`);
  const settings=await f.p.evaluate(()=>WosSettings.unsentAll({outbox:WosOutbox}).map(it=>WosSettings.unsentRow(it,{outbox:WosOutbox,live:WizLive})).join(''));
  ok(settings.includes('No speech detected')&&!settings.includes('retrying')&&!settings.includes('Sending…'),`${label}: saved notes recovery is honest`,settings);
  await f.p.reload();await f.p.waitForFunction(()=>WosOutbox?.recoveryComplete&&(window.__wos||window.__wux)?.chats);
  const persisted=await f.p.evaluate(id=>{const r=WosOutbox.get(id);return {hidden:r.threadHidden,bytes:r.audio?.size,state:r.state,listed:WosOutbox.unsent().some(x=>x.id===id),thread:WosOutbox.forThread(r.sessionId).some(x=>x.id===id)};},id);
  ok(persisted.hidden&&persisted.bytes>0&&persisted.state==='empty'&&persisted.listed&&!persisted.thread,`${label}: reload retains audio but not dismissed bubble`,persisted);
  await f.p.evaluate(()=>WizCore.deeplink.route('/wizard-os-home/?session=empty-second-thread'));await sleep(250);
  const second=await f.p.locator(`[data-ob="${id2}"]`).innerText();ok(second.includes('No speech detected')&&!second.includes('Sending'),`${label}: second thread independently corrected`,second);
  f.state.text='Recovered dictated feedback';await f.p.locator(`[data-obretry="${id2}"]`).click();await f.p.waitForFunction(id=>WosOutbox.get(id)?.state==='sent',id2);
  ok(f.state.posts.length===1&&f.state.posts[0].session_id==='empty-second-thread',`${label}: explicit retry sends once to original thread`,f.state.posts);
  ok(await f.p.evaluate(id=>WosOutbox.get(id).state==='empty'&&WosOutbox.get(id).threadHidden,id),`${label}: retry of second note leaves first safely retained`);
  ok(await f.p.evaluate(id=>WosOutbox.dismissEmpty(id),id2)===false,`${label}: dismissal refuses already sent notes`);
  await f.done(label+' empty-note recovery');
 }
 // The screenshot's held state is created by local/interrupt recovery, not empty STT.
 for(const desktop of [false,true]){
  const label=desktop?'desktop':'phone',f=await boot(desktop);
  const open=async sessionId=>{await f.p.evaluate(({wid,sessionId})=>{const A=window.__wos||window.__wux;A.chats.openChat(wid,sessionId);A.focusWin?.(wid);},{wid:f.wid,sessionId});await sleep(300);};
  const add=async(sessionId,intent='auto')=>f.p.evaluate(async({sessionId,intent,model,provider})=>{
   const it=await WosOutbox.stage({kind:'reply',sessionId,intent,model,provider,audio:new Blob(['held original audio'],{type:'audio/webm'})});
   if(intent!=='command')await WosOutbox.transition(it.id,'held','Original kept after local routing');return it.id;
  },{sessionId,intent,model,provider});
  const id=await add(sid),id2=await add('held-second-thread','command');
  // Recover interrupted command via the production load path, not a hand-edited state.
  await f.p.reload();await f.p.waitForFunction(()=>WosOutbox?.recoveryComplete&&(window.__wos||window.__wux)?.chats);
  await open(sid);
  await f.p.waitForSelector(`[data-ob="${id}"]`);
  const txt=await f.p.locator(`[data-ob="${id}"]`).last().innerText();
  const button=f.p.locator(`[data-obdismiss="${id}"]`).last();
  ok(txt.includes('Kept on this device')&&!txt.includes('words come when')&&await button.count()===1,`${label}: held screenshot state has visible Dismiss and honest wording`,txt);
  if(!await button.count()){await f.done(label+' held baseline');continue;}
  const snapshot=()=>f.p.evaluate(async id=>{const r=WosOutbox.get(id);return JSON.stringify({bytes:Array.from(new Uint8Array(await r.audio.arrayBuffer())),file:r.audioFile,sessionId:r.sessionId,model:r.model,provider:r.provider,state:r.state});},id);
  const before=await snapshot();await f.p.screenshot({path:path.join(out,`${label}-held.png`)});
  await button.click();await f.p.waitForFunction(id=>WosOutbox.get(id)?.threadHidden===true,id);await sleep(200);
  ok(await f.p.locator(`[data-ob="${id}"]`).count()===0,`${label}: held Dismiss removes selected bubble`);
  ok(before===await snapshot(),`${label}: held Dismiss preserves exact original bytes and route`);
  ok(await f.p.evaluate(id=>WosOutbox.get(id).state==='held'&&!WosOutbox.get(id).threadHidden,id2),`${label}: interrupted second thread remains independently recoverable`);
  await f.p.reload();await f.p.waitForFunction(()=>WosOutbox?.recoveryComplete&&(window.__wos||window.__wux)?.chats);
  await open(sid);await sleep(250);
  ok(before===await snapshot()&&await f.p.locator(`[data-ob="${id}"]`).count()===0&&await f.p.evaluate(id=>WosOutbox.unsent().some(x=>x.id===id)&&WosOutbox.recordings().some(x=>x.id===id),id),`${label}: held dismissal survives reload/reopen with recovery retained`);
  await open('held-second-thread');await f.p.waitForSelector(`[data-obdismiss="${id2}"]`);
  await f.p.screenshot({path:path.join(out,`${label}-second-held.png`)});
  await f.p.locator(`[data-ob="${id2}"] [data-obdismiss="${id2}"]`).click();await f.p.waitForFunction(id=>WosOutbox.get(id)?.threadHidden===true,id2);
  await f.p.evaluate(wid=>{const A=window.__wos||window.__wux;A.chats.openChat(wid,null);},f.wid);await sleep(250);
  ok(await f.p.locator(`[data-chats="${f.wid}"] .ch-pill`).count()===0,`${label}: dismissed held notes leave no list pill or false Sent`,await f.p.locator('.ch-pill').allTextContents());
  ok(f.state.posts.length===0&&f.state.uploads.length===0,`${label}: held dismissal/recovery never uploads or admits`);
  await f.done(label+' held-note recovery');
 }

};
