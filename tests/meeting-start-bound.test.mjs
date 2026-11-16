// ux#1448: a Recorder meeting start (native meeting bridge) must settle within a bounded time, and the optional
// live-PCM hookup or a phone store that never answers must not hold the take (James's phone sat on "Starting…").
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
  async advance(ms){const end=now+ms;await tick();for(;;){const entry=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!entry)break;now=entry[1].at;timers.delete(entry[0]);entry[1].fn();await tick();}now=end;await tick();},
  get pending(){return [...timers.values()].map(t=>t.at-now);}
};}
function ctx(extra={}){const time=clock();const c=vm.createContext({fail,Promise,Blob,safeCall:(fn,...a)=>{try{return fn?.(...a);}catch(_){}},navigator:{},...time,...extra});
  load('  function bounded(', '  // Use the existing append-only',c);return {c,time};}

function bridge({pcm='hang',status={recording:false}}={}){
  const calls=[];let answerPcm;
  const b={status:async()=>status,start:async()=>{calls.push('start');return {recording:true,meetingId:'m1',livePcm:true};},
    pcm:(id,on)=>{calls.push('pcm:'+on);if(on&&pcm==='hang')return new Promise(r=>{answerPcm=r;});return Promise.resolve();},
    stop:async()=>({recording:false}),onLevel:()=>()=>{},onState:()=>()=>{},onPcm:()=>()=>{}};
  return {b,calls,answer:()=>answerPcm?.()};
}
async function meetingStart(opts){const f=ctx();load('  const MEETING_PCM_MS', '  let rawMeetingBridge;',f.c);
  const stages=[],warns=[];const br=bridge(opts);const a=f.c.meetingAdapter(br.b);
  let engine,error;a.start({meta:{meetingId:'m1'},onWarn:m=>warns.push(m)},{level(){},chunk(){},stage:n=>stages.push(n)}).then(e=>engine=e,e=>error=e);
  return {...f,stages,warns,br,get engine(){return engine;},get error(){return error;}};}

test('a hung live-PCM hookup does not hold a meeting start: the take starts without it after 3 s',async()=>{
  const m=await meetingStart();await m.time.advance(2999);assert.equal(m.engine,undefined,'still waiting inside the budget');
  await m.time.advance(1);assert.ok(m.engine,'start settled');assert.equal(m.error,undefined);
  assert.equal(m.engine.livePcm,false);assert.equal(m.engine.nativeId,'m1');
  assert.deepEqual(m.stages,['native status','native recorder','live audio hookup']);
  assert.match(m.warns[0],/keeps recording/);
  // The late hookup answer after the take ended is switched off again, so no listener is left behind.
  await m.engine.stop();m.br.answer();await tick();assert.deepEqual(m.br.calls,['start','pcm:true','pcm:false']);
});
test('a live-PCM hookup that answers in time is kept and turned off at stop',async()=>{
  const m=await meetingStart({pcm:'ok'});await m.time.advance(0);assert.equal(m.engine.livePcm,true);assert.deepEqual(m.warns,[]);
  await m.engine.stop();assert.deepEqual(m.br.calls,['start','pcm:true','pcm:false']);
});

test('a meeting store step that never answers drops the local backup instead of hanging',async()=>{
  const warns=[];const f=ctx({emit:(s,k,m)=>warns.push(m),changed(){},storageFailure:e=>({detail:e.detail||'UnknownError'})});
  load('  // Native meetings upload full-quality', '  function noLocalResult(',f.c);
  const s={meetingNative:true,queue:[],row:{}};let done=false,value='unset';
  f.c.softStore(s,()=>new Promise(()=>{})).then(v=>{done=true;value=v;});
  await f.time.advance(3999);assert.equal(done,false);await f.time.advance(1);
  assert.equal(done,true);assert.equal(value,undefined);assert.equal(s.noLocal,true);assert.match(warns[0],/continues to the meeting server/);
  // Browser (non-meeting) takes keep their strict store: no budget is added.
  const plain={};let settled=false;f.c.softStore(plain,()=>new Promise(()=>{})).then(()=>settled=true);await f.time.advance(60000);assert.equal(settled,false);
});

async function admission(opts,meetingNative){const timers=[],c={validate:()=>({}),preparations:new Map(),active:null,crypto:{randomUUID:()=> 'synthetic'},observe(){},yieldRecovery(){},changed(){},setTimeout:(cb,ms)=>{timers.push(ms);return 1;},clearTimeout(){},START_BOUND_MS:10000,PROMPT_BOUND_MS:60000,DEFAULT_LIMIT:1024,micPromptOpen:async()=>false,startRun:async s=>{s.meetingNative=meetingNative;return {instant:s.instant};},W:{}};
  vm.createContext(c);load('  async function start(appId, opts = {}) {','  async function startRun(',c);await c.start('recorder',opts);return timers;}
test('a native meeting start gets the start bound; a browser meeting keeps its old protocol',async()=>{
  assert.deepEqual(await admission({kind:'meeting',pcm:true},true),[10000]);
  assert.deepEqual(await admission({kind:'meeting',pcm:true},false),[]);
});

test('a meeting recorder that comes up after the bound keeps recording and stays recoverable',async()=>{
  const puts=[];let cancelled=0,detached=0,recovered=0;
  const c=vm.createContext({cleanup(){},remove:async()=>{throw Error('must not remove');},safeCall:fn=>fn?.(),put:async r=>puts.push(r),active:null,recover:async()=>{recovered++;},W:{}});
  load('  function lateStart(', '  async function start(appId',c);
  c.lateStart({meetingNative:true,row:{id:'take',native:'wizard-meetings',nativeId:'m1',status:'starting'},engine:{cancel:async()=>{cancelled++;},detach:()=>{detached++;}}},false,fail('start_abandoned','late'));
  await tick();assert.equal(cancelled,0);assert.equal(detached,1);assert.equal(puts[0].status,'recoverable');assert.equal(recovered,1);
});
test('a late meeting is unhooked with its live PCM switched off, while the recorder keeps going',async()=>{
  const m=await meetingStart({pcm:'ok'});await m.time.advance(0);assert.equal(m.engine.livePcm,true);
  const puts=[];const c=vm.createContext({cleanup(){},remove:async()=>{},safeCall:fn=>fn?.(),put:async r=>puts.push(r),active:null,recover:async()=>{},W:{}});
  load('  function lateStart(', '  async function start(appId',c);
  c.lateStart({meetingNative:true,row:{id:'take',native:'wizard-meetings',nativeId:'m1'},engine:m.engine},false,fail('start_abandoned','late'));
  await tick();assert.deepEqual(m.br.calls,['start','pcm:true','pcm:false'],'PCM off, never stopped');assert.equal(puts[0].status,'recoverable');
});
