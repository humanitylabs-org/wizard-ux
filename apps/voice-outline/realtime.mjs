// App-owned session lifecycle only. Attestation/TLS remain in the configured
// TinfoilProvider.client (tinfoil-js); provider/model and native dialect unchanged.
// Protocol: https://docs.tinfoil.sh/guides/processing-audio
export class OutlineRealtime {
 constructor(client, handlers, {model='voxtral-mini-4b-realtime',handshakeMs=8000,finalMs=10000,stallMs=20000,retries=1}={}) {
  Object.assign(this,{client,handlers,model,handshakeMs,finalMs,stallMs,retries});
  this.frames=[];this.bytes=0;this.generation=0;this.ended=false;this.terminal=false;this.started=false;this.retryCount=0;
  this.result=new Promise(resolve=>this.resolve=resolve);
 }
 async open(){await this.connect();return this;}
 async connect(){
  const gen=++this.generation;this.ready=false;this.started=false;this.deltaAt=Date.now();this.stalledSince=null;
  this.timer=setTimeout(()=>this.failed(gen,new Error('Live connection timed out')),this.handshakeMs);
  try {
   const rt=await this.client.realtime({model:this.model});
   // Register the SDK error handler before every possible terminate(), including
   // a CONNECTING socket delivered after abort/handshake expiry.
   rt.on('error',e=>this.failed(gen,new Error(e?.error?.message||e?.message||'Live provider error')));
   if(gen!==this.generation||this.terminal){rt.socket?.terminate();return;}
   this.rt=rt;
   rt.on('session.created',()=>{
    if(!this.current(gen))return;clearTimeout(this.timer);this.ready=true;
    rt.send({type:'session.update',model:this.model});
    // Start generation only when there is actual audio. This also avoids an
    // idle model generation during microphone permission/startup delays.
    for(const b of this.frames)this.sendAudio(b);
    this.handlers.created?.();
    if(this.ended)this.finishAudio();
    else this.watch=setInterval(()=>{if(this.stalledSince&&Date.now()-this.stalledSince>this.stallMs)this.failed(gen,new Error('Live words stalled'));},1000);
   });
   rt.on('transcription.delta',e=>{if(this.current(gen)){this.deltaAt=Date.now();this.stalledSince=null;this.handlers.delta?.(e.delta||'');}});
   rt.on('transcription.done',e=>{if(this.current(gen)){this.terminal=true;this.dispose();this.handlers.completed?.(e.text||'');this.resolve(true);}});
   rt.socket?.on('close',(code,reason)=>{if(this.current(gen))this.failed(gen,new Error('Live connection closed ('+code+'): '+String(reason||'').slice(0,160)));});
  }catch(e){this.failed(gen,e);}
 }
 current(gen){return !this.terminal&&gen===this.generation;}
 sendAudio(b){this.rt.send({type:'input_audio_buffer.append',audio:b.toString('base64')});if(!this.started){this.started=true;this.rt.send({type:'input_audio_buffer.commit'});}}
 append(b){if(this.terminal||this.ended)return;const frame=Buffer.from(b);if(this.bytes+frame.length>32*1024*1024){this.failed(this.generation,new Error('Thought reached audio limit'));return;}this.frames.push(frame);this.bytes+=frame.length;let peak=0;for(let i=0;i+1<frame.length;i+=32)peak=Math.max(peak,Math.abs(frame.readInt16LE(i)));if(peak>500)this.stalledSince ||= Date.now();else this.stalledSince=null;if(this.ready)this.sendAudio(frame);}
 finishAudio(){
  if(this.terminal||!this.ready)return;
  clearInterval(this.watch);
  if(!this.bytes){this.terminal=true;this.dispose();this.handlers.completed?.('');this.resolve(true);return;}
  // Zero padding flushes the model look-ahead; it is transport padding only,
  // never included in retained original audio or represented as user speech.
  this.sendAudio(Buffer.alloc(32000));
  this.rt.send({type:'input_audio_buffer.commit',final:true});
  clearTimeout(this.timer);this.timer=setTimeout(()=>this.failed(this.generation,new Error('Final transcript timed out')),this.finalMs);
 }
 close(){if(!this.ended){this.ended=true;this.finishAudio();}return this.result;}
 failed(gen,e){
  if(!this.current(gen))return;this.generation++;this.dispose();
  if(this.bytes&&this.retryCount++<this.retries){this.handlers.reset?.();this.handlers.retry?.();void this.connect();return;}
  this.terminal=true;this.handlers.error?.(e);this.resolve(false);
 }
 dispose(){clearTimeout(this.timer);clearInterval(this.watch);this.ready=false;const rt=this.rt;this.rt=null;try{rt?.socket?.terminate();}catch{try{rt?.close();}catch{}}}
 abort(){if(this.terminal)return;this.terminal=true;this.generation++;this.dispose();this.resolve(false);}
}
