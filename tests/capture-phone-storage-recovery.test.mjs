import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(process.env.CAPTURE_SOURCE || new URL('../web/core/app-capture.js',import.meta.url),'utf8');
const tick=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
const fail=(code,message,extra)=>Object.assign(Error(message),{code},extra);
function load(from,to,c){const a=source.indexOf(from),b=source.indexOf(to,a);assert.ok(a>=0&&b>a,from);vm.runInContext(source.slice(a,b),c);}
function clock(){let now=0,next=0;const timers=new Map();return {
  setTimeout(fn,ms){const id=++next;timers.set(id,{at:now+ms,fn});return id;},clearTimeout(id){timers.delete(id);},
  async advance(ms){const end=now+ms;await tick();for(;;){const entry=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!entry)break;now=entry[1].at;timers.delete(entry[0]);entry[1].fn();await tick();}now=end;await tick();}
};}
// Atomic fake IDB: aborted staged writes never reach disk; each open returns a
// distinct connection. Timers exercise the production budgets without wall waits.
function disk(plans=[]){const time=clock(),connections=[],transactions=[],committed=new Map();let opens=0,aborts=0;
 const indexedDB={open(){const req={};opens++;queueMicrotask(()=>{const db={version:1,closed:false,close(){this.closed=true;},transaction(){
   const plan=plans.shift()||{};if(plan.sync)throw Object.assign(Error('synthetic'),{name:plan.sync});
   const staged=new Map();let aborted=false;const tx={error:null,objectStore(){return {put:r=>{staged.set(r.id,structuredClone(r));}};},abort(){if(aborted)return;aborted=true;aborts++;queueMicrotask(()=>tx.onabort?.());}};transactions.push(tx);
   if(plan.error)queueMicrotask(()=>{tx.error=Object.assign(Error('synthetic'),{name:plan.error});tx.onerror?.();tx.abort();});
   else if(!plan.hang)time.setTimeout(()=>{if(aborted)return;for(const [k,v]of staged)committed.set(k,v);tx.oncomplete?.();},plan.delay??1);
   return tx;
 }};connections.push(db);req.result=db;req.onsuccess();});return req;}};
 const c=vm.createContext({storageDiagnostic(){},DB_NAME:'synthetic',dbPromise:null,W:{indexedDB},indexedDB,queueMicrotask,Promise,Date,fail,...time});
 load('  function storageFailure(', '  async function rows()',c);
 return {c,time,connections,transactions,committed,get opens(){return opens;},get aborts(){return aborts;}};
}
for(const mode of ['readonly','readwrite'])test('busy phone '+mode+' takes 1800ms without a false timeout',async()=>{
 const f=disk([{delay:1800}]);let done=false;const p=f.c.transaction(['sessions'],mode,tx=>tx.objectStore('sessions').put({id:'take',bytes:32})).then(()=>done=true);await f.time.advance(1800);await p;assert.equal(done,true);assert.equal(f.aborts,0);assert.equal(f.opens,1);
});
for(const name of ['UnknownError','AbortError','InvalidStateError'])test('failed '+name+' connection is reopened once and write commits once',async()=>{
 const f=disk([name==='InvalidStateError'?{sync:name}:{error:name},{}]);const p=f.c.transaction(['sessions'],'readwrite',tx=>tx.objectStore('sessions').put({id:'take',bytes:64}));await f.time.advance(10);await p;assert.equal(f.opens,2);assert.equal(f.connections[0].closed,true);assert.equal(f.committed.size,1);assert.equal(f.committed.get('take').bytes,64);
});
test('timeout aborts the stalled transaction before reopening; late callback cannot commit or resolve twice',async()=>{
 const f=disk([{hang:true},{}]);let resolved=0;const p=f.c.transaction(['sessions'],'readwrite',tx=>tx.objectStore('sessions').put({id:'take',bytes:96})).then(()=>resolved++);await f.time.advance(5010);await p;assert.equal(f.aborts,1);assert.equal(f.opens,2);assert.equal(f.committed.size,1);f.transactions[0].oncomplete();await tick();assert.equal(resolved,1);
});
test('second transient failure rejects without a retry loop, and the next call can heal',async()=>{
 const f=disk([{error:'UnknownError'},{error:'UnknownError'},{}]);const p=f.c.transaction(['sessions'],'readwrite',()=>{});await assert.rejects(p,e=>e.name==='UnknownError');assert.equal(f.opens,2);assert.equal(f.c.dbPromise,null);const next=f.c.transaction(['sessions'],'readwrite',()=>{});await f.time.advance(10);await next;assert.equal(f.opens,3);
});
test('quota failure is not retried or acknowledged and keeps original bytes',async()=>{
 const f=disk([{error:'QuotaExceededError'}]);f.committed.set('prior',{bytes:32});await assert.rejects(f.c.transaction(['sessions'],'readwrite',tx=>tx.objectStore('sessions').put({id:'new',bytes:64})),e=>e.name==='QuotaExceededError');assert.equal(f.opens,1);assert.equal(f.committed.size,1);assert.equal(f.committed.get('prior').bytes,32);
});
test('unexpected connection close and stale old connection events cannot poison a new open',async()=>{
 const f=disk();const old=await f.c.openDB();assert.equal(typeof old.onclose,'function');old.onclose();assert.equal(f.c.dbPromise,null);const fresh=await f.c.openDB();old.onversionchange();assert.equal(await f.c.openDB(),fresh);assert.equal(f.opens,2);
});
function locks(outcomes){let calls=0,releases=0;const c=vm.createContext({navigator:{locks:{request(name,options,callback){calls++;const value=outcomes.shift();if(typeof value==='string')return Promise.reject(Object.assign(Error('synthetic'),{name:value}));return Promise.resolve().then(()=>callback(value===false?null:{})).then(()=>releases++);}}},LOCK:'synthetic',AbortController,Promise,setTimeout,clearTimeout,ownedRows:new Map(),fail});load('  async function acquire(', '  function wav(',c);return {c,get calls(){return calls;},get releases(){return releases;}};}
test('Web Locks transient UnknownError retries once and releases the actual granted lease',async()=>{const f=locks(['UnknownError',true]);const unlock=await f.c.acquire();assert.equal(f.calls,2);await unlock();assert.equal(f.releases,1);});
test('Web Locks permanent transient error is bounded; busy never retries or steals another window lock',async()=>{for(const outcomes of [['UnknownError','UnknownError'],[false]]){const expected=outcomes.length;const f=locks(outcomes);await assert.rejects(f.c.acquire());assert.equal(f.calls,expected);}});
function recovery(overrides={}){const c=vm.createContext({active:null,recoveryError:fail('storage_failed','old'),recoveryLease:null,ownedRows:new Map(),recoveryLive:new Set(),ownershipLoaded:false,unknownMeetingActive:false,W:{},rows:async()=>[],meetingBridge:()=>null,changed(){},fail,Promise,Date,setTimeout,clearTimeout,...overrides});load('  async function recoverLocked(', '  // Start budget per attempt.',c);return c;}
test('healthy direct locked recovery clears an old store error, but native uncertainty remains strict',async()=>{const c=recovery();await c.recoverLocked();assert.equal(c.recoveryError,null);assert.equal(c.ownershipLoaded,true);c.meetingBridge=()=>({status:async()=>null});await c.recoverLocked();assert.equal(c.recoveryError.code,'native_owner_uncertain');});
test('pending/recovery during own active meeting does not request its own lock or scan sessions',async()=>{let calls=0,reads=0;const c=recovery({active:{row:{native:'wizard-meetings'}},acquire:async()=>{calls++;throw fail('busy','held');},rows:async()=>{reads++;return [];}});await c.recover();assert.equal(calls,0);assert.equal(reads,0);});
test('explicit backend acknowledgement removes a stopped native backup; unacknowledged and live rows are retained',async()=>{
 const sessions=new Map([['take',{id:'take',appId:'recorder-test',kind:'meeting',native:'wizard-meetings',nativeId:'meeting',status:'pending'}]]),chunks=new Map([['take',new Blob(['unacknowledged-audio'])]]);
 const c=vm.createContext({validate(){},ready:Promise.resolve(),active:null,memoryTakes:new Map(),ownedRows:new Map(sessions),recoveryLive:new Set(),changed(){},channel:null,DB_NAME:'synthetic',IDBKeyRange:{only:id=>id},fail,Promise,navigator:{locks:{request:async(name,cb)=>cb()}},rows:async()=>[...sessions.values()],transaction:async(stores,mode,work)=>{let request;work({objectStore:name=>name==='sessions'?{delete:id=>sessions.delete(id)}:{index:()=>({openCursor:id=>{request={};queueMicrotask(()=>{request.result=chunks.has(id)?{delete:()=>chunks.delete(id),continue:()=>{request.result=null;request.onsuccess();}}:null;request.onsuccess();});return request;}})}});await tick();}});
 load('  async function remove(', '  function validate(',c);load('  async function ack(', '  const channel =',c);
 await tick();assert.equal(chunks.size,1);c.active={row:{id:'take'}};await assert.rejects(c.ack('recorder-test','take'),e=>e.code==='capture_active');assert.equal(chunks.size,1);c.active=null;await c.ack('recorder-test','take');assert.equal(sessions.size,0);assert.equal(chunks.size,0);
});
