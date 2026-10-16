// Server-side bridge to the pinned sherpa adapter. Never browser-to-model or cloud.
import {WebSocket} from 'ws';
export const LOCAL_MODEL='nemotron-speech-streaming-en-0.6b-560ms-int8';
export function localEndpoint(value){
 const u=new URL(value);
 if(u.protocol!=='ws:'||!['127.0.0.1','[::1]','localhost'].includes(u.hostname)||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw new Error('Local ASR must be a loopback WebSocket');
 return u.href;
}
export async function localHealth(endpoint){
 return new Promise(resolve=>{
  const ws=new WebSocket(localEndpoint(endpoint),{handshakeTimeout:1500});let done=false;
  const finish=value=>{if(done)return;done=true;clearTimeout(timer);ws.terminate();resolve(value);};
  const timer=setTimeout(()=>finish(false),2000);
  ws.on('error',()=>finish(false));ws.on('close',()=>finish(false));
  ws.on('open',()=>ws.send(JSON.stringify({type:'health'})));
  ws.on('message',raw=>{try{const m=JSON.parse(raw);finish(m.type==='health'&&m.receipt?.model==='nemotron'&&m.receipt?.fallback===null);}catch{finish(false);}});
 });
}
export class OutlineLocalRealtime {
 constructor(endpoint,handlers,{handshakeMs=8000,finalMs=10000,maxSeconds=590,queueBytes=640000,frameMs=100}={}){
  Object.assign(this,{endpoint:localEndpoint(endpoint),handlers,handshakeMs,finalMs,maxSeconds,queueBytes,frameMs});
  this.frames=[];this.queued=0;this.bytes=0;this.ended=false;this.terminal=false;this.ready=false;this.sentEnd=false;
  this.result=new Promise(resolve=>this.resolve=resolve);
 }
 async open(){
  if(this.terminal)return;
  return new Promise(resolve=>{
   this.opened=resolve;this.ws=new WebSocket(this.endpoint,{handshakeTimeout:this.handshakeMs});
   this.timer=setTimeout(()=>this.fail(new Error('Local Nemotron startup timed out')),this.handshakeMs);
   this.ws.on('error',e=>this.fail(new Error('Local Nemotron unavailable: '+e.message)));
   this.ws.on('close',()=>{if(!this.terminal)this.fail(new Error('Local Nemotron disconnected; audio retained'));});
   this.ws.on('open',()=>{if(!this.terminal)this.ws.send(JSON.stringify({type:'start',sample_rate:16000,format:'s16le',channels:1}));});
   this.ws.on('message',raw=>{
    if(this.terminal)return;
    try{
     const m=JSON.parse(raw);
     if(m.type==='ready'){
      if(m.model!=='nemotron'||m.replace!==true)throw new Error('Unexpected local model or transcript protocol');
      clearTimeout(this.timer);this.ready=true;this.opened?.();this.opened=null;this.pump();
     }else if(m.type==='partial'||m.type==='final'){
      if(!this.ready||m.replace!==true||typeof m.text!=='string')throw new Error('Invalid replacement hypothesis');
      if(m.type==='partial')this.handlers.replace?.(m.text);
      else{if(!this.sentEnd)throw new Error('Unexpected early final');this.finish(true);this.handlers.completed?.(m.text);}
     }else if(m.type==='error'||m.type==='cancelled')throw new Error('Local Nemotron: '+(m.code||m.type));
     else throw new Error('Unknown local ASR event');
    }catch(e){this.fail(e);}
   });
  });
 }
 append(buffer){
  if(this.terminal||this.ended)return;
  const b=Buffer.from(buffer);
  if(!b.length||b.length%2)return this.fail(new Error('Invalid PCM16 frame; audio retained'));
  if(this.bytes+b.length>this.maxSeconds*32000)return this.fail(new Error('Thought limit reached (590 seconds). Stop and save retained audio; start a new thought.'));
  if(this.queued+b.length>this.queueBytes)return this.fail(new Error('Local ASR queue full; audio retained'));
  this.bytes+=b.length;
  // Shared capture emits 250 ms / 8000 bytes. Keep every sample, including 50 ms tails.
  for(let i=0;i<b.length;i+=3200){const frame=b.subarray(i,i+3200);this.frames.push(frame);this.queued+=frame.length;}
  this.pump();
 }
 pump(){
  if(this.terminal||!this.ready||this.pumping)return;
  const b=this.frames.shift();
  if(b){
   this.queued-=b.length;
   if(this.ws.bufferedAmount>this.queueBytes)return this.fail(new Error('Local transport stalled; audio retained'));
   this.ws.send(b);this.pumping=true;
   // Pace queued audio too: the tested adapter has a bounded 80-frame inbox.
   this.tick=setTimeout(()=>{this.pumping=false;this.pump();},this.frameMs*b.length/3200);
  }else if(this.ended&&!this.sentEnd){
   this.sentEnd=true;this.ws.send(JSON.stringify({type:'end'}));
   this.timer=setTimeout(()=>this.fail(new Error('Local Nemotron final timed out; audio retained')),this.finalMs);
  }
 }
 close(){this.ended=true;this.pump();return this.result;}
 finish(ok){
  if(this.terminal)return;this.terminal=true;clearTimeout(this.timer);clearTimeout(this.tick);
  this.frames=[];this.queued=0;this.opened?.();this.opened=null;
  if(this.ws?.readyState===WebSocket.OPEN)this.ws.close();else this.ws?.terminate();
  this.resolve(ok);
 }
 fail(e){if(this.terminal)return;this.finish(false);this.handlers.error?.(e);}
 abort(){if(this.terminal)return;if(this.ws?.readyState===WebSocket.OPEN)this.ws.send(JSON.stringify({type:'cancel'}));this.finish(false);}
}
