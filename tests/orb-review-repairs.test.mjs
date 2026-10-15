import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
const read=p=>readFileSync(new URL('../web/'+p,import.meta.url),'utf8');
const phone=read('app.js'),device=read('device.js');
const section=(s,a,b)=>s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)));
function storage(data={}) {return {getItem:k=>data[k]??null,setItem:(k,v)=>data[k]=v,removeItem:k=>delete data[k]};}
function handoff(localStorage=storage(),device=null) {
 const c={window:{WizardOSDevice:device},localStorage,navigator:{onLine:false},crypto:webcrypto,setInterval(){},addEventListener(){},console};
 vm.runInNewContext(read('core/orb-handoff.js'),c);return c.window.WosOrbHandoff;
}
const databases=new WeakMap();
function outbox(store=storage()) {
 if(!databases.has(store))databases.set(store,new Map());const rows=databases.get(store);
 const indexedDB={open(){const r={};queueMicrotask(()=>{r.result={transaction(){const t={objectStore:()=>({put(x){rows.set(x.id,structuredClone(x));queueMicrotask(()=>t.oncomplete());return {};},getAll(){const r={result:[...rows.values()].map(x=>structuredClone(x))};queueMicrotask(()=>t.oncomplete());return r;}})};return t;}};r.onsuccess();});return r;}};
 const c={window:{},Blob,Uint8Array,crypto:webcrypto,console,AbortController,AbortSignal,atob,btoa,setTimeout(){},clearTimeout(){},addEventListener(){},document:{documentElement:{dataset:{}},body:null,addEventListener(){}},localStorage:store,indexedDB,FileReader:class {readAsDataURL(b){b.arrayBuffer().then(a=>{this.result='data:'+b.type+';base64,'+Buffer.from(a).toString('base64');this.onload();});}}};
 vm.runInNewContext(read('outbox.js'),c);return c.window.WosOutbox;
}
test('real native receipt admits only its exact recovered borrower while meeting is active',()=>{
 const receipt={id:'event-a',meetingId:'meeting-a',voiceTakeId:'native-a',open:true,status:'capturing'};
 const h=handoff(storage(),{recHandoffEvents:()=>JSON.stringify({'event-a':JSON.stringify(receipt)})});
 h.update('event-a',{meetingId:'meeting-a',voiceTakeId:'native-a',status:'paused'});
 const state={active:true,recording:true,meetingId:'meeting-a',nativeRegistryReady:true,nativeDeviceTakeIds:[]};
 const c={window:{WosOrbHandoff:h,WizAppCapture:{getState:()=>state}}};vm.createContext(c);vm.runInContext(section(device,'  function nativeOwner(','  function offerRecorderControls('),c);
 assert.equal(c.nativeOwner('native-a'),'voice');assert.equal(c.nativeOwner('unrelated'),'unknown');
 receipt.voiceTakeId='different';assert.equal(c.nativeOwner('native-a'),'unknown');
 receipt.voiceTakeId='native-a';state.nativeDeviceTakeIds=['native-a'];assert.equal(c.nativeOwner('native-a'),'app');
});
const route={model:'private-model',provider:'private-provider'};
function producer(thread) {
 const c={W:{w:{app:'chats',thread}},agentWin:()=>true,agentApp:()=>({agent:'private-agent',name:'Private',private:true}),winTitle:()=> 'PRIVATE TITLE'};
 vm.runInNewContext(section(phone,'  function viewOf(','  // Rides as'),c);return c.viewOf('w');
}
for(const thread of ['thread-a',''])test('actual producer view survives journal reload: '+(thread||'private list'),()=>{
 const store=storage(),h=handoff(store),view=producer(thread);
 assert.equal(view.kind,thread?'chat thread':'agent chats');
 h.update('event-a',{meetingId:'meeting-a',status:'paused'});h.bind({id:'event-a'},'native-a',{route,view});
 const snap=handoff(store).takeSnap('native-a');
 assert.equal(snap.view.kind,view.kind);assert.equal(snap.view.thread,thread);assert.equal(snap.view.agent,'private-agent');assert.equal(snap.meetingEventId,'event-a');assert.equal(snap.route.model,route.model);assert.equal(snap.screen,'');assert.equal(snap.conversation,null);
 assert(!JSON.stringify(snap).includes('PRIVATE TITLE'));
});
test('parked stage → crash before ack, append, reload, tombstone all own exact native IDs',async()=>{
 const store=storage();let ob=outbox(store);await ob.load();
 const audio=new Blob(['synthetic audio'],{type:'audio/aac'});
 const first=await ob.stage({nativeId:'segment-a',audio,kind:'reply',sessionId:'thread-a',...route,parkedDraft:{parts:[audio],typed:'original typed',replyTo:{sid:'thread-a'}}});
 assert(first.durable);assert.equal(first.state,'held'); // no transition/recDone before crash
 ob=outbox(store);await ob.load();assert.equal(ob.nativeItem('segment-a').id,first.id);
 const duplicate=await ob.stage({nativeId:'segment-a',audio});assert.equal(duplicate.id,first.id);assert.equal(ob._items.size,1);
 const final=await ob.stage({captureId:first.id,nativeId:'segment-b',audio:new Blob([audio,'appended']),kind:'reply',sessionId:'thread-a',typed:'original typed',...route});
 assert.equal(final.id,first.id);assert.equal(final.audio.size,audio.size+8);assert.equal(final.typed,'original typed');
 for(const id of ['segment-a','segment-b'])assert.equal(ob.nativeItem(id).id,first.id);
 await ob.transition(first.id,'held');await ob.remove(first.id);
 ob=outbox(store);await ob.load();
 for(const id of ['segment-a','segment-b']){const marker=ob.nativeItem(id);assert.equal(marker.id,first.id);assert.equal(marker.state,'sent');assert(marker.compact);assert.equal((await ob.stage({nativeId:id,audio})).id,first.id);}
 assert.equal(ob._items.size,1);
});
test('meeting take queues new run; non-meeting parked steering remains intact',async()=>{
 const ob=outbox();await ob.load();
 const a=await ob.stage({meetingEventId:'event-a',steerRunId:'other-run',sessionId:'thread-a',agent:'private-agent',...route});
 assert.equal(a.steerRunId,'');assert.equal(a.agent,'private-agent');assert.equal(a.sessionId,'thread-a');
 const b=await ob.stage({steerRunId:'original-run',sessionId:'thread-a'});assert.equal(b.steerRunId,'original-run');
});
function resumeContext(h,prior=null,pin=null) {
 const V={state:'idle'},c={V,window:{WosOrbHandoff:h,WosModels:{load:async()=>{}},__wosDictationTake:()=>false,__wosVoiceRecovery:()=>[]},voiceTake:()=>null,replyTake:()=>pin,OUTBOX:{get:()=>prior},performance,renderVoiceFiles(){},setVoice:s=>V.state=s,txPill(){},txHide(){},requestAnimationFrame:()=>1,tick(){}};
 vm.createContext(c);vm.runInContext(section(phone,'  function nativeResume(','  // Tell the native shell'),c);return c;
}
test('active native recovery uses immutable meeting pin, not unrelated foreground',()=>{
 const h=handoff();h.update('event-a',{status:'paused'});h.bind({id:'event-a'},'native-a',{route,view:producer('thread-a')});
 const c=resumeContext(h);assert(c.nativeResume({id:'native-a',kind:'auto',ms:10}));assert.equal(c.V.snap.view.thread,'thread-a');assert.equal(c.V.snap.view.agent,'private-agent');assert.equal(c.V.meetingLoan.id,'event-a');assert.equal(c.V.snap.meetingEventId,'event-a');
});
test('native stop preserves sealed typed draft while reapplying immutable meeting routing',()=>{
 const h=handoff();h.update('event-a',{status:'paused'});h.bind({id:'event-a'},'native-a',{route,view:producer('thread-a')});
 const seal={text:'typed draft stays',files:[]},V={kind:'auto',snap:{seal},acc:10};let seen;
 const c={V,window:null,WosOrbHandoff:h,__wosDictationTake:()=>false,__wosVoiceRecovery:()=>[],nativeTakeAppOwned:()=>false,saveVoiceRoute(){},DEV:()=>({recStop:()=>JSON.stringify({id:'native-a',kind:'auto',ms:10,bytes:700})}),voiceRecovery(){},nativeBlob:()=>new Blob(['audio']),onRecStop(){seen=V.snap;}};c.window=c;
 vm.createContext(c);vm.runInContext(section(phone,'  function nativeFinish(','  const releasedTakes'),c);c.nativeFinish('native-a',false);
 assert.equal(seen.seal,seal);assert.equal(seen.meetingEventId,'event-a');assert.equal(seen.view.thread,'thread-a');
});
test('active appended segment rehydrates original parts and typed draft',()=>{
 const audio=new Blob(['original']),prior={id:'owner',state:'held',durable:true,audio,parkedDraft:{parts:[audio],typed:'original typed',acc:20,snap:{route,view:producer('thread-a')}}};
 const c=resumeContext(handoff(),prior,{sid:'thread-a',custodyId:'owner'});assert(c.nativeResume({id:'segment-b',ms:30}));assert.equal(c.V.custodyCapture,'owner');assert.equal(c.V.parts[0],audio);assert.equal(c.V.acc,50);assert.equal(c.V.seal.text,'original typed');
});
function recoveredDevice(h,existing=null) {
 const calls=[],w={recDone:id=>calls.push(['done',id]),openWizardThread(){}};
 const c={window:{WosOrbHandoff:h,__wosReplyTake:()=>null,WosModels:{voiceRoute:()=>null},WizConfig:{owner:()=>''}},DEV:()=>({}),W$:()=>w,voiceKind:()=>true,handledTakes:new Set(),isDictation:()=>false,OUTBOX:{load:async()=>{},nativeItem:()=>existing,enqueue:async o=>{calls.push(['enqueue',o]);return {...o,id:'owner',durable:true}}},readRecording:()=>new Blob([new Uint8Array(700)]),releaseNativeCustody:()=>calls.push(['release']),log(){},toast(){}};
 h.end=async(_,d)=>calls.push(['end',d]);
 vm.createContext(c);vm.runInContext(section(device,'  async function sendTake(','  const releasedNative'),c);return {c,calls};
}
test('stopped recovery retains event/thread/private agent and no steer',async()=>{
 const h=handoff();h.update('event-a',{status:'paused'});h.bind({id:'event-a'},'native-a',{route,view:producer('thread-a')});
 const {c,calls}=recoveredDevice(h);await c.sendTake({id:'native-a',bytes:700},'recovered');
 const o=calls.find(x=>x[0]==='enqueue')[1];assert.equal(o.sessionId,'thread-a');assert.equal(o.agent,'private-agent');assert.equal(o.meetingEventId,'event-a');assert.equal(o.steerRunId,'');assert.equal(o.model,route.model);assert(calls.some(x=>x[0]==='end'));
});
test('native recovery does not enqueue parked owner or sent tombstone',async()=>{
 for(const state of ['held','sent']){const {c,calls}=recoveredDevice(handoff(),{id:'owner',state});await c.sendTake({id:'segment-a'},'notification');assert(!calls.some(x=>x[0]==='enqueue'));}
});
test('meeting Manager admission clears conversation and implicit context before recording',()=>{
 const s=section(phone,'    V.snap = initialSnap;','    setVoice(kind');
 const V={},initialSnap={conversation:{appId:'wizard-manager'},view:{kind:'app',name:'Manager'},screen:'PRIVATE',others:['PRIVATE']};
 vm.runInNewContext(s,{V,initialSnap,meetingLoan:{id:'event-a'},kind:'auto',paintVoiceDestination(){}});
 assert.equal(V.snap.conversation,null);assert.equal(V.snap.view,null);assert.equal(V.snap.meetingEventId,'event-a');assert.equal(V.snap.screen,'');assert.equal(V.snap.others.length,0);
});
