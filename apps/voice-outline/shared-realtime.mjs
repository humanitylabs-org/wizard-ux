// Outline's target/custody lifecycle around the SAME openRealtime implementation
// used by Mizel Live. No provider protocol, credentials, attestation or ASR here.
export class OutlineSharedRealtime {
 constructor(provider, handlers, {openMs=12000}={}) {
  Object.assign(this,{provider,handlers,openMs});this.queue=[];this.bytes=0;this.ended=false;this.terminal=false;
  this.result=new Promise(resolve=>this.resolve=resolve);
 }
 async open(){
  this.timer=setTimeout(()=>this.fail(new Error('Shared Wizard live voice timed out')),this.openMs);
  try {
   const stream=await this.provider.openRealtime({
    created:()=>{clearTimeout(this.timer);if(!this.terminal)this.handlers.created?.();},
    delta:text=>{if(!this.terminal)this.handlers.delta?.(text);},
    completed:text=>{if(this.terminal)return;this.terminal=true;clearTimeout(this.timer);this.handlers.completed?.(text);this.resolve(true);},
    error:e=>this.fail(e),
   });
   this.stream=stream;
   if(this.terminal){void stream.close().catch(()=>{});return this;}
   for(const bytes of this.queue)stream.append(bytes);this.queue=[];
   if(this.ended)void this.finish();
  }catch(e){this.fail(e);}
  return this;
 }
 append(bytes){if(this.terminal||this.ended)return;this.bytes+=bytes.length;if(this.bytes>32*1024*1024){this.fail(new Error('Live audio limit reached'));return;}if(this.stream)this.stream.append(bytes);else this.queue.push(Buffer.from(bytes));}
 async finish(){if(this.finishing||!this.stream||this.terminal)return;this.finishing=true;try{await this.stream.close();if(!this.terminal){this.terminal=true;clearTimeout(this.timer);this.handlers.completed?.('');this.resolve(true);}}catch(e){this.fail(e);}}
 close(){this.ended=true;void this.finish();return this.result;}
 fail(e){if(this.terminal)return;this.terminal=true;clearTimeout(this.timer);this.queue=[];this.handlers.error?.(e);this.resolve(false);void this.stream?.close().catch(()=>{});}
 abort(){if(this.terminal)return;this.terminal=true;clearTimeout(this.timer);this.queue=[];this.resolve(false);void this.stream?.close().catch(()=>{});}
}
