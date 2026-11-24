// Real 50-second STT delay crosses the old 45-second failure. Agent writes remain intercepted.
module.exports=async({boot,ok,sleep,sid,model,provider})=>{
 await Promise.all(['outbox','orb'].map(async mode=>{
  const f=await boot();f.state.down=false;f.state.sttDelay=50000;
  if(mode==='outbox'){
   const id=await f.p.evaluate(async({sid,model,provider})=>(await WosOutbox.enqueue({kind:'reply',sessionId:sid,model,provider,audio:new Blob(['original slow recording'],{type:'audio/webm'})})).id,{sid,model,provider});
   await f.p.waitForFunction(id=>WosOutbox.get(id)?.state==='sent',id,{timeout:65000});
   ok(f.state.posts.length===1&&f.state.runs.size===1,'slow STT: outbox waits beyond 45 seconds and admits once');
  }else{
   f.state.cmd={route:'command',action:'home'};
   await f.p.evaluate(()=>__wos.goDesk(0));await f.take();
   await f.p.waitForFunction(()=>WosOutbox.unsent().some(x=>x.state==='held'&&x.recoveryText),null,{timeout:65000});
   ok(f.state.posts.length===0,'slow STT: orb keeps local command local beyond old deadline');
  }
  ok(await f.p.evaluate(()=>WosOutbox.TRANSCRIBE_TIMEOUT_MS)>180000,mode+': client budget exceeds service STT budget');
  // Accelerate only the STT timeout to prove abort and retained custody without a three-minute wait.
  const result=await f.p.evaluate(async()=>{
   const old=setTimeout,transcribe=WizConfig.transcribe;let aborted=false,observed=0;
   window.setTimeout=(fn,ms,...args)=>{if(ms===WosOutbox.TRANSCRIBE_TIMEOUT_MS){observed=ms;return old(fn,50,...args);}return old(fn,ms,...args);};
   WizConfig.transcribe=(_blob,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(new Error('timeout'));},{once:true}));
   try{const x=await WosOutbox.stage({kind:'reply',sessionId:'held-timeout',audio:new Blob(['kept after timeout'],{type:'audio/webm'})});await WosOutbox.transition(x.id,'held','Local command');await WosOutbox.transcribeRecording(x.id);return {aborted,observed,state:x.state,bytes:x.audio?.size,error:x.recoveryError};}
   finally{window.setTimeout=old;WizConfig.transcribe=transcribe;}
  });
  ok(result.aborted&&result.observed===195000&&result.state==='held'&&result.bytes>0&&!!result.error,mode+': actual deadline abort retains original audio and state',result);
  await f.done(mode+' deadline');
 }));
};
