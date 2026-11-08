import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const source=readFileSync(new URL('../web/core/app-capture.js',import.meta.url),'utf8');
const tick=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
function load(from,to,c){const a=source.indexOf(from),b=source.indexOf(to,a);assert.ok(a>=0&&b>a,from);vm.runInContext(source.slice(a,b),c);}
function fixture({instant=true, storage='ok', stop, cancel, read='ok', memoryBlob=Blob}={}) {
  const saved=[],sessions=new Map();let mic=true,lock=true,stops=0;
  const c=vm.createContext({Blob:memoryBlob,Date,Math,Promise,Map,Set,structuredClone,setTimeout,clearTimeout,clearInterval,
    fail:(code,message,extra)=>Object.assign(Error(message),{code},extra),MAX_CHUNK:1024,ownedRows:new Map(),recoveryLive:new Set(),memoryTakes:new Map(),active:null,
    changed(){},safeCall:fn=>fn?.(),emit(){},channel:null,
    transaction:async(stores,mode,work)=>{
      if(mode==='readwrite'&&storage==='hang')return new Promise(()=>{});
      if(mode==='readwrite'&&storage!=='ok')throw Object.assign(Error('synthetic-private-message-not-for-diagnostics'),{name:storage});
      return work({objectStore:name=>({put:r=>{if(name==='chunks')saved.push(r);else sessions.set(r.id,r);}})});
    },
    put:async row=>{if(storage==='hang')return new Promise(()=>{});if(storage!=='ok')throw Object.assign(Error('synthetic-private'),{name:storage});sessions.set(row.id,row);},
    result:async row=>{if(read!=='ok')throw Object.assign(Error('private'),{name:read});return {id:row.id,blob:new Blob(saved.map(p=>p.blob),{type:row.mime}),mime:row.mime,durationMs:row.durationMs};},
    remove:async id=>{if(storage==='hang')return new Promise(()=>{});if(storage!=='ok')throw Error('private');sessions.delete(id);},
  });
  load('  function storageFailure(', '  function openDB()',c);
  load('  function wav(', '  async function result(',c);
  load('  function enqueue(', '  function emit(',c);
  const s={instant,row:{id:'synthetic',appId:'messenger',kind:instant?'audio':'meeting',seq:0,bytes:0,mime:'audio/webm;codecs=opus',startedAt:Date.now()-2000,meta:{}},opts:{},limit:100000,queue:[],writes:Promise.resolve(),levels:new Set(),offs:[],phase:'recording',stream:{getTracks:()=>[{stop(){mic=false;}}]},unlock(){lock=false;},engine:{async stop(){stops++;if(stop)return stop();return {blob:new Blob(['C']),durationMs:2345};},async cancel(){if(cancel)return cancel();}}};
  c.active=s;
  return {c,s,saved,sessions,setStorage(value){storage=value;},enqueue:async text=>{c.enqueue(s,new Blob([text]));await tick();},get mic(){return mic;},get lock(){return lock;},get stops(){return stops;}};
}
for(const name of ['QuotaExceededError','InvalidStateError','UnknownError'])test('instant put rejects '+name+': ordered committed + queued + final bytes, mic and lock released',async()=>{
  const f=fixture({storage:name});await f.enqueue('A');await f.enqueue('B');const out=await f.c.finish(f.s);
  assert.equal(await out.blob.text(),'ABC');assert.equal(out.mime,'audio/webm;codecs=opus');assert.equal(out.durationMs,2345);assert.equal(out.durable,false);assert.equal(out.storageError,name);assert.equal(f.mic,false);assert.equal(f.lock,false);assert.equal(f.c.active,null);
});
test('memory-only result can be recovered and acknowledged without any IDB row, scoped to its app',async()=>{const f=fixture({storage:'QuotaExceededError'});await f.enqueue('AB');const out=await f.c.finish(f.s);Object.assign(f.c,{validate(){},ready:new Promise(()=>{})});load('  async function pending(', '  const channel =',f.c);assert.equal((await f.c.pending('messenger'))[0],out);await assert.rejects(f.c.ack('other',out.id),e=>e.code==='forbidden');await f.c.ack('messenger',out.id);assert.equal(f.c.memoryTakes.size,0);assert.equal(f.s.memoryParts.length,0);assert.equal(f.s.queue.length,0);});
test('memory-only ack is bounded even when removal hangs',async()=>{const f=fixture({storage:'hang'});await f.enqueue('AB');const out=await f.c.finish(f.s);Object.assign(f.c,{validate(){},ready:new Promise(()=>{})});load('  async function pending(', '  const channel =',f.c);await f.c.ack('messenger',out.id);assert.equal(f.c.memoryTakes.size,0);});
test('successful durable handoff drops fallback Blob references',async()=>{const f=fixture();await f.enqueue('AB');await f.c.finish(f.s);assert.equal(f.s.memoryParts.length,0);assert.equal(f.s.final,null);assert.equal(f.c.memoryTakes.size,0);});
test('committed prefix plus failed queued tail and final blob are preserved once, in order',async()=>{const f=fixture();await f.enqueue('A');assert.equal(f.saved.length,1);f.setStorage('QuotaExceededError');await f.enqueue('B');const out=await f.c.finish(f.s);assert.equal(await out.blob.text(),'ABC');assert.equal(out.durable,false);});
test('facade forwards explicit Discard separately while Stop is in flight',async()=>{
  const service=readFileSync(new URL('../web/core/app-services.js',import.meta.url),'utf8');
  const a=service.indexOf('        const finished = {}'),b=service.indexOf('        check();\n        const observe',a);assert.ok(a>=0&&b>a);
  let stopped=0,cancelled=0,done;
  const c=vm.createContext({check(){},release(){},session:{stop(){stopped++;return new Promise(r=>done=r);},async cancel(){cancelled++;}},Promise});
  vm.runInContext(service.slice(a,b)+';globalThis.run=finish;',c);
  const stopping=c.run('stop');await tick();await c.run('cancel');assert.equal(stopped,1);assert.equal(cancelled,1);done({durable:false});await stopping;
});
test('healthy storage still returns its ordinary durable result unchanged',async()=>{const f=fixture();await f.enqueue('A');await f.enqueue('B');const out=await f.c.finish(f.s);assert.equal(await out.blob.text(),'ABC');assert.equal(out.durable,undefined);assert.equal(f.s.queue.length,0);assert.equal(f.mic,false);assert.equal(f.lock,false);});
test('saved chunks survive a later read failure without duplicating queued/final bytes',async()=>{const f=fixture({read:'InvalidStateError'});await f.enqueue('A');await f.enqueue('B');assert.equal(f.saved.length,2);const out=await f.c.finish(f.s);assert.equal(await out.blob.text(),'ABC');assert.equal(out.durable,false);});
test('hung initial persistence returns within the bound and late resolution cannot drain handed-off memory',async()=>{const f=fixture();let resolve;f.s.persistencePending=true;f.s.persistence=new Promise(r=>resolve=r);await f.enqueue('AB');const before=Date.now();const out=await f.c.finish(f.s);assert.ok(Date.now()-before<2500);assert.equal(await out.blob.text(),'ABC');assert.equal(out.storageError,'timeout');assert.equal(f.mic,false);assert.equal(f.lock,false);resolve();await tick();assert.equal(f.sessions.size,0);});
test('hung chunk transaction returns in-memory audio within the bound',async()=>{const f=fixture({storage:'hang'});await f.enqueue('AB');const out=await f.c.finish(f.s);assert.equal(await out.blob.text(),'ABC');assert.equal(out.durable,false);assert.equal(f.mic,false);assert.equal(f.lock,false);});
test('failed engine Stop then Discard ignores failed storage and releases mic and active lock',async()=>{const f=fixture({storage:'QuotaExceededError',stop:async()=>{throw Error('synthetic-stop');}});await f.enqueue('AB');await assert.rejects(f.c.finish(f.s),/synthetic-stop/);assert.equal(f.s.finishPromise,null);assert.equal(f.mic,false);await f.c.cancelSession(f.s);assert.equal(f.lock,false);assert.equal(f.c.active,null);assert.equal(f.s.queue.length,0);assert.equal(f.s.memoryParts.length,0);
  // Actual Start admission runs after Discard, not a hand-written active check.
  Object.assign(f.c,{validate:()=>({}),preparations:new Map(),crypto:{randomUUID},DEFAULT_LIMIT:10000,yieldRecovery(){},observe(){},START_BOUND_MS:10000,PROMPT_BOUND_MS:60000,startRun:async s=>{assert.equal(f.c.active,s);return 'next-start';},W:{}});
  load('  async function start(appId, opts = {}) {','  async function startRun(',f.c);assert.equal(await f.c.start('messenger',{}),'next-start');
});
test('Discard after inputStopped + failed durable save works (the old permanent trap)',async()=>{const f=fixture({instant:false,storage:'QuotaExceededError'});await f.enqueue('AB');await assert.rejects(f.c.finish(f.s),e=>e.code==='storage_failed');assert.equal(f.s.inputStopped,true);await f.c.cancelSession(f.s);assert.equal(f.c.active,null);assert.equal(f.mic,false);assert.equal(f.lock,false);});
test('Discard during actual in-flight Stop waits, then deletes the take',async()=>{let done;const f=fixture({stop:()=>new Promise(r=>done=r)});await f.enqueue('AB');const stopping=f.c.finish(f.s);await tick();const discarding=f.c.cancelSession(f.s);await tick();assert.equal(f.s.discard,undefined);done({blob:new Blob(['C']),durationMs:2345});await stopping;await discarding;assert.equal(f.sessions.size,0);assert.equal(f.s.discard,true);assert.equal(f.c.active,null);});
test('Discard never hangs on engine cancellation or removal',async()=>{const f=fixture({storage:'hang',cancel:()=>new Promise(()=>{})});await f.enqueue('AB');const before=Date.now();await f.c.cancelSession(f.s);assert.ok(Date.now()-before<4000);assert.equal(f.mic,false);assert.equal(f.lock,false);assert.equal(f.c.active,null);});
for(const native of [undefined,'wizard-device'])test('non-instant strict durable contract retained: '+native,async()=>{const f=fixture({instant:false,storage:'QuotaExceededError'});f.s.row.native=native;await f.enqueue('AB');await assert.rejects(f.c.finish(f.s),e=>e.code==='storage_failed'&&e.detail==='QuotaExceededError');assert.equal(f.s.memoryOnly,undefined);assert.equal(f.s.queue.length>0,true);assert.equal(f.mic,false);assert.equal(f.lock,true);await f.c.cancelSession(f.s);});
test('failed in-memory assembly keeps bytes and exposes retry/discard with mic released',async()=>{class BrokenBlob {constructor(){throw Error('synthetic-memory');}}const f=fixture({storage:'QuotaExceededError',memoryBlob:BrokenBlob});await f.enqueue('AB');await assert.rejects(f.c.finish(f.s),e=>e.code==='memory_result_failed');assert.ok(f.s.memoryParts.length);assert.equal(f.mic,false);await f.c.cancelSession(f.s);assert.equal(f.lock,false);});
test('error detail rejects arbitrary content and preserves known DOMException names only',()=>{const f=fixture();for(const error of [{message:'private',detail:'private',name:'private'},{name:'QuotaExceededError',message:'private'}]){const e=f.c.storageFailure(error);assert.doesNotMatch(e.message,/private/);assert.ok(['UnknownError','QuotaExceededError'].includes(e.detail));assert.equal(e.cause,undefined);}});
function opening(mode) {
  let request,closed=0;const db={close(){closed++;}};
  const c=vm.createContext({DB_NAME:'synthetic',dbPromise:null,W:{indexedDB:{}},indexedDB:{open(){request={};queueMicrotask(()=>{if(mode==='ok'){request.result=db;request.onsuccess();}else if(mode==='blocked')request.onblocked({oldVersion:0,newVersion:1});});return request;}},setTimeout,clearTimeout,fail:(code,message,extra)=>Object.assign(Error(message),{code},extra)});
  load('  function storageFailure(', '  async function transaction(',c);
  return {c,db,get request(){return request;},get closed(){return closed;}};
}
test('IDB blocked open fails with a code, and closes a late connection',async()=>{const f=opening('blocked');await assert.rejects(f.c.openDB(),e=>e.detail==='blocked');f.request.result=f.db;f.request.onsuccess();assert.equal(f.closed,1);});
test('never-resolving IDB open times out, resets retry, and closes late success',async()=>{const f=opening('hang');await assert.rejects(f.c.openDB(),e=>e.detail==='timeout');await tick();assert.equal(f.c.dbPromise,null);f.request.result=f.db;f.request.onsuccess();assert.equal(f.closed,1);});
test('healthy IDB closes on versionchange so another page can upgrade',async()=>{const f=opening('ok');assert.equal(await f.c.openDB(),f.db);f.db.onversionchange();assert.equal(f.closed,1);assert.equal(f.c.dbPromise,null);});

// James, 6 Nov 2026: Mizel failed to start/stop with "On-device audio storage timed out". Native meetings upload
// full-quality audio to the meeting backend; the phone store is only a backup and must never block or stop them.
for(const storage of ['QuotaExceededError','UnknownError'])test('native meeting keeps recording and stops cleanly when phone storage fails: '+storage,async()=>{
  const f=fixture({instant:false,storage,stop:async()=>({partial:true,durationMs:4000,meta:{meetingId:'m1',backendOwned:true}})});
  f.s.row.native='wizard-meetings';f.s.meetingNative=true;f.s.row.mime='audio/wav';
  const warns=[];f.c.emit=(s,kind,msg)=>{if(kind==='warn')warns.push(msg);};
  await f.enqueue('AB');
  const out=await f.c.finish(f.s);
  assert.equal(out.meta.native.backendOwned,true);assert.equal(out.durationMs,4000);assert.equal(out.durable,false);
  assert.equal(f.s.noLocal,true);assert.equal(f.s.phase,'stopped');assert.equal(f.mic,false);assert.equal(f.lock,false);
  assert.ok(warns.some(w=>/Recording continues/.test(w)));
});
// James, 6 Nov 2026: pressing the orb during a Mizel meeting failed with "On-device audio storage timed out".
// The phone's backup store must not block the orb's microphone loan or its return.
test('orb borrows and returns a native meeting mic when phone storage fails',async()=>{
  const f=fixture({instant:false,storage:'UnknownError'});
  load('  function beginVoiceBorrow(', '  function deviceAdapter(',f.c);
  const calls=[];
  f.c.W={WizardOSDevice:{recHandoffVersion:()=>1,recStartBorrowed(){},
    recHandoffBegin:(id,m)=>{calls.push('begin');return JSON.stringify({status:'paused',open:true,id,meetingId:m});},
    recHandoffEnd:id=>{calls.push('end');return JSON.stringify({id,open:false,status:'recording',pausedByHandoff:true});}}};
  Object.assign(f.s.row,{native:'wizard-meetings',pcm:true,meta:{meetingId:'m1'}});f.s.meetingNative=true;f.s.phase='recording';
  const b=await f.c.beginVoiceBorrow('handoff-0001');
  assert.equal(b.micReleased,true);assert.equal(f.s.phase,'handoff');assert.equal(f.s.noLocal,true);
  const m=await f.c.endVoiceBorrow('handoff-0001',{status:'captured'});
  assert.equal(m.resumeStatus,'recording');assert.equal(f.s.phase,'recording');assert.deepEqual(calls,['begin','end']);
});
