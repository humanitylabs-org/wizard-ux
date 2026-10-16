const fs=require('fs'),path=require('path');
module.exports=async({boot,ok,sleep,sid,model,provider})=>{
 const old=fs.readFileSync(path.join(__dirname,'tests/fixtures/outbox-3190f46.js'),'utf8');
 for(const failure of ['rejected','lost-receipt']){
  // Cosmetic compatibility for the candidate shell; legacy persistence/delivery code is unchanged.
  const legacy={source:old+'\nWosOutbox.canRetry=()=>false;WosOutbox.retryFeedback=()=>"legacy";'};
  const f=await boot(false,false,legacy);f.state.down=false;
  if(failure==='rejected')await f.ctx.route('**/wizard/hermes/v1/runs',r=>r.fulfill({status:409,contentType:'application/json',body:'{"error":"explicit rejection"}'}));
  else f.state.dropReceipt=true;
  const ids=await f.p.evaluate(async({sid,model,provider})=>{
   const options={kind:'reply',sessionId:sid,model,provider,intent:'command',audio:new Blob(['legacy original bytes'],{type:'audio/webm'}),files:[{id:'legacy-photo'}]};
   const held=await WosOutbox.stage(options);await WosOutbox.transition(held.id,'held','Local command kept');
   const send=await WosOutbox.stage(options);await WosOutbox.enqueue({custodyId:send.id,kind:'reply',sessionId:sid,model,provider,text:'Explicit old Send to agent'});
   return {held:held.id,send:send.id};
  },{sid,model,provider});
  await f.p.waitForFunction(({id,state})=>WosOutbox.get(id)?.state===state,{id:ids.send,state:failure==='rejected'?'failed':'waiting'});
  const before=await f.p.evaluate(id=>{const x=WosOutbox.get(id);return {id:x.id,body:x.body,model:x.model,provider:x.provider,audio:x.audio.size,files:x.files,flag:x.deliveryRequested};},ids.send);
  ok(before.flag===undefined&&!!before.body,'upgrade '+failure+': actual old enqueue persisted authorized command without new flag');
  legacy.source=null;if(failure==='rejected')await f.ctx.unroute('**/wizard/hermes/v1/runs');
  await f.p.reload();await f.p.waitForFunction(()=>WosOutbox?.recoveryComplete);
  if(failure==='rejected'){
   ok(await f.p.evaluate(id=>WosOutbox.canRetry(id),ids.send),'upgrade rejected: old sealed failure exposes Retry');
   await f.p.evaluate(id=>WosOutbox.retry(id),ids.send);
  }else await f.p.evaluate(()=>dispatchEvent(new Event('online')));
  await f.p.waitForFunction(id=>WosOutbox.get(id)?.state==='sent',ids.send);
  ok(f.state.runs.size===1&&f.state.calls.every(x=>x.key===before.id&&x.body===before.body),'upgrade '+failure+': exact old envelope and key admitted once');
  ok(await f.p.evaluate(id=>{const x=WosOutbox.get(id);return x.state==='held'&&x.audio.size>0&&!WosOutbox.canRetry(id);},ids.held),'upgrade '+failure+': old held command remains retained and unsent');
  await f.done('upgrade '+failure);
 }
};
