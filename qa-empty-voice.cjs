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
  const settings=await f.p.evaluate(()=>WosSettings.features.find(x=>x.id==='unsent').html({outbox:WosOutbox,live:WizLive}));
  ok(settings.includes('No speech detected')&&!settings.includes('retrying')&&!settings.includes('Sending…'),`${label}: saved notes recovery is honest`,settings);
  await f.p.reload();await f.p.waitForFunction(()=>WosOutbox?.recoveryComplete&&(window.__wos||window.__wux)?.chats);
  const persisted=await f.p.evaluate(id=>{const r=WosOutbox.get(id);return {hidden:r.threadHidden,bytes:r.audio?.size,state:r.state,listed:WosOutbox.unsent().some(x=>x.id===id),thread:WosOutbox.forThread(r.sessionId).some(x=>x.id===id)};},id);
  ok(persisted.hidden&&persisted.bytes>0&&persisted.state==='empty'&&persisted.listed&&!persisted.thread,`${label}: reload retains audio but not dismissed bubble`,persisted);
  await f.p.evaluate(({wid,id2})=>{const a=window.__wos||window.__wux;const w=Object.keys(a.wins).find(k=>a.wins[k].app==='chats')||wid;a.chats.openChat(w,'empty-second-thread');}, {wid:f.wid,id2});await sleep(250);
  const second=await f.p.locator(`[data-ob="${id2}"]`).innerText();ok(second.includes('No speech detected')&&!second.includes('Sending'),`${label}: second thread independently corrected`,second);
  f.state.text='Recovered dictated feedback';await f.p.locator(`[data-obretry="${id2}"]`).click();await f.p.waitForFunction(id=>WosOutbox.get(id)?.state==='sent',id2);
  ok(f.state.posts.length===1&&f.state.posts[0].session_id==='empty-second-thread',`${label}: explicit retry sends once to original thread`,f.state.posts);
  ok(await f.p.evaluate(id=>WosOutbox.get(id).state==='empty'&&WosOutbox.get(id).threadHidden,id),`${label}: retry of second note leaves first safely retained`);
  ok(await f.p.evaluate(id=>WosOutbox.dismissEmpty(id),id2)===false,`${label}: dismissal refuses already sent notes`);
  await f.done(label+' empty-note recovery');
 }
};
