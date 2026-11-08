import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../web/core/app-capture.js',import.meta.url),'utf8');
function fn(from,to,ctx){const start=source.indexOf(from),end=source.indexOf(to,start);assert.ok(start>=0&&end>start,from);vm.createContext(ctx);vm.runInContext(source.slice(start,end),ctx);return ctx;}
async function admission(opts){const timers=[],ctx={validate:()=>({}),preparations:new Map(),active:null,crypto:{randomUUID:()=> 'synthetic'},observe(){},yieldRecovery(){},changed(){},setTimeout:(cb,ms)=>{timers.push(ms);return 1;},clearTimeout(){},START_BOUND_MS:10000,PROMPT_BOUND_MS:60000,DEFAULT_LIMIT:1024,micPromptOpen:async()=>false,startRun:async s=>({instant:s.instant}),W:{}};fn('  async function start(appId, opts = {}) {','  async function startRun(',ctx);return {result:await ctx.start('messenger',opts),timers};}
test('abandoned browser permission result stops tracks before an engine can be constructed', async () => {
  let grant, stopped = 0, engine = 0;
  const ctx = {W:{}, ownedRows:new Map(), recoveryLive:new Set(), unknownMeetingActive:false,
    navigator:{mediaDevices:{getUserMedia:()=>new Promise(r=>grant=r)}},
    fail:(code,message)=>Object.assign(Error(message),{code}), externalMic:async()=>{engine++;return false;}};
  fn('  async function browserEngine(s) {','  function beginVoiceBorrow(',ctx);
  const s={opts:{},timedOut:false}, pending=ctx.browserEngine(s);
  s.timedOut=true; grant({getTracks:()=>[{stop:()=>stopped++}]});
  await assert.rejects(pending,e=>e.code==='start_abandoned');
  assert.equal(stopped,1);assert.equal(engine,0);assert.equal(s.stream,null);
});
test('only fresh compressed audio/song skips storage admission and gets the short bound',async()=>{for(const opts of [{},{kind:'audio'},{kind:'song'}]){const r=await admission(opts);assert.equal(r.result.instant,true);assert.deepEqual(r.timers,[10000]);}});
test('meeting, PCM, camera, screen and resume keep their existing protocol, without the voice deadline',async()=>{for(const opts of [{kind:'meeting'},{pcm:true},{kind:'camera'},{kind:'screen'},{resumeId:'kept'},{systemAudio:true},{mime:'audio/wav'}]){const r=await admission(opts);assert.equal(r.result.instant,false);assert.deepEqual(r.timers,[]);}});
function late({native='null',error,resuming=false,id=null}={}){const removed=[],ctx={cleanup(){},remove:async id=>removed.push(id),safeCall:fn=>fn?.(),W:{WizardOSDevice:{recActive:()=>native}}};fn('  function lateStart(', '  async function start(appId',ctx);ctx.lateStart({row:{id:'synthetic',nativeId:id}},resuming,error);return removed;}
test('a late failed start with no physical recording drops its empty reservation',()=>assert.deepEqual(late(),['synthetic']));
test('a definitive busy rejection drops only its own empty reservation despite another active take',()=>assert.deepEqual(late({native:'{"id":"other"}',error:{code:'busy'}}),['synthetic']));
test('unknown native outcomes, known native IDs and resumed takes retain custody',()=>{assert.deepEqual(late({native:'{"id":"unknown"}',error:{code:'bridge_failure'}}),[]);assert.deepEqual(late({id:'kept'}),[]);assert.deepEqual(late({resuming:true}),[]);});
test('busy cleanup waits briefly but returns only stopped pending takes, never recoverable live rows',async()=>{const waits=[],ctx={validate(){},active:null,ready:Promise.resolve(),acquire:async wait=>{waits.push(wait);throw Object.assign(Error('busy'),{code:'busy'});},rows:async()=>[{id:'stopped',appId:'messenger',status:'pending'},{id:'live',appId:'messenger',status:'recoverable'},{id:'other',appId:'recorder',status:'pending'}],result:async r=>r,recoveryLease:null};fn('  async function settle(', '  async function pending(',ctx);const out=await ctx.settle('messenger');assert.deepEqual(waits,[true]);assert.deepEqual(Array.from(out,r=>r.id),['stopped']);});
