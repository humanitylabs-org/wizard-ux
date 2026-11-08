// Deterministic synthetic custody/Reload tests. No owner data, audio or native commands.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = n => readFileSync(new URL('../web/core/' + n + '.js', import.meta.url), 'utf8');
const tick = async () => { for (let i=0;i<60;i++) await Promise.resolve(); };
const fail = (code,message) => Object.assign(Error(message),{code});
function custody(patch={}) {
  const row={id:'synthetic-old',appId:'messenger',status:'pending',startedAt:Date.parse('2026-11-03T10:00:00Z'),bytes:4,mime:'audio/webm',meta:{}};
  const state={active:null,preparations:new Map(),ownedRows:new Map([[row.id,row]]),memoryTakes:new Map(),recoveryLive:new Set(),recoveryLease:null,unknownMeetingActive:false,
    W:{},Date,Map,Blob,AbortController,setTimeout,clearTimeout,fail,changed(){},meetingBridge:()=>null,
    rows:async()=>[row],result:async()=>({blob:new Blob([Uint8Array.of(0,255,128,9)],{type:'audio/webm'}),meta:{}}),
    acquireBounded:async()=>()=>{state.released++},released:0,removed:[],uploads:[],
    remove:async id=>{state.removed.push(id);state.ownedRows.delete(id)},
    fetch:async (url,init)=>{if(init.method==='HEAD')return {ok:true,status:200,headers:new Headers({'content-length':'4'})};state.uploads.push({url,init});return {ok:true,json:async()=>({file:{id:'wf_synthetic',bytes:4}})}},
    bounded:async work=>work,adapter:()=>({ack:async()=>{state.acks++}}),acks:0,...patch};
  const code=source('app-capture');
  vm.runInNewContext(code.slice(code.indexOf('  function staleTakes()'),code.indexOf('  // Reload may re-probe')),state);
  return {state,row};
}
test('Save to Files sends the exact blob through the existing route, reads it back, then removes',async()=>{
  const {state:s,row}=custody();let readback=false;s.fetch=async(url,init)=>{
    if(init.method==='HEAD'){readback=true;return {ok:true,status:200,headers:new Headers({'content-length':'4'})}}
    assert.equal(url,'/wizard/files/upload');assert.equal(init.headers['Content-Type'],'application/octet-stream');
    assert.match(init.headers['X-Wizard-Filename'],/^Recovered-recording-2026-11-03T10-00-00-000Z-voice.webm$/);
    assert.deepEqual([...new Uint8Array(await init.body.arrayBuffer())],[0,255,128,9]);assert.equal(s.removed.length,0);
    return {ok:true,json:async()=>({file:{id:'wf_synthetic',bytes:4}})};
  };
  const out=await s.rescueTake(row.id,'save');assert(readback);assert.equal(out.cleared,true);assert.deepEqual(s.removed,[row.id]);assert.equal(s.released,1);
});
for(const mode of ['network','reject','wrong-bytes','wrong-id','readback-failure','readback-bytes'])test('Save failure retains original: '+mode,async()=>{
  const {state:s,row}=custody();s.fetch=async(url,init)=>{
    if(mode==='network')throw Error('synthetic offline');
    if(init.method==='HEAD')return {ok:mode!=='readback-failure',status:200,headers:new Headers({'content-length':mode==='readback-bytes'?'3':'4'})};
    return {ok:mode!=='reject',json:async()=>({file:{id:mode==='wrong-id'?'bad/id':'wf_synthetic',bytes:mode==='wrong-bytes'?3:4}})};
  };
  await assert.rejects(s.rescueTake(row.id,'save'));assert.equal(s.removed.length,0);assert.equal(s.ownedRows.get(row.id),row);assert.equal(s.released,1);
});
test('all stored chunks and both audio tracks must be read and confirmed before removal',async()=>{
  const {state:s,row}=custody();row.bytes=7;
  s.result=async()=>({blob:new Blob(['1234']),meta:{captureTracks:[{source:'them',blob:new Blob(['567'])}]}});
  let calls=0,bytes;
  s.fetch=async(url,init)=>{if(init.method==='HEAD')return {ok:true,status:200,headers:new Headers({'content-length':String(bytes)})};calls++;bytes=init.body.size;return {ok:true,json:async()=>({file:{id:'wf_track'+calls,bytes}})}};
  await s.rescueTake(row.id,'save');assert.equal(calls,2);assert.deepEqual(s.removed,[row.id]);
});
test('missing stored chunk, zero-byte audio, or failed second track never clears the take',async()=>{
  for(const mode of ['missing','zero','second']){
    const {state:s,row}=custody();if(mode==='missing')row.bytes=5;if(mode==='zero')row.bytes=0;
    if(mode==='second'){row.bytes=7;s.result=async()=>({blob:new Blob(['1234']),meta:{captureTracks:[{source:'them',blob:new Blob(['567'])}]}});let count=0;s.fetch=async(url,init)=>init.method==='HEAD'?{ok:true,status:200,headers:new Headers({'content-length':'4'})}:{ok:++count===1,json:async()=>({file:{id:'wf_synthetic',bytes:4}})};}
    await assert.rejects(s.rescueTake(row.id,'save'));assert.equal(s.removed.length,0);
  }
});
test('Discard requires an explicit second confirmation and performs no upload',async()=>{
  const {state:s,row}=custody();await assert.rejects(s.rescueTake(row.id,'discard'),e=>e.code==='confirm_discard');assert.equal(s.removed.length,0);
  await s.rescueTake(row.id,'discard',true);assert.deepEqual(s.removed,[row.id]);assert.equal(s.uploads.length,0);
});
test('in-memory stale blob is retained on upload failure and cleared only after verified rescue',async()=>{
  const {state:s,row}=custody();s.memoryTakes.set(row.id,{session:{row,queue:[1],memoryParts:[1],final:{}},result:{blob:new Blob(['1234'])}});
  const good=s.fetch;s.fetch=async()=>{throw Error('offline')};await assert.rejects(s.rescueTake(row.id,'save'));assert(s.memoryTakes.has(row.id));
  s.fetch=good;await s.rescueTake(row.id,'save');assert(!s.memoryTakes.has(row.id));
});
for(const mode of ['active','warm','recovery','native-live','native-unknown','device-live','device-malformed','live-row','native-backup-only','lock-busy'])test('live/unknown custody untouched: '+mode,async()=>{
  const {state:s,row}=custody();
  if(mode==='active')s.active={row};if(mode==='warm')s.preparations.set('warm',{});if(mode==='recovery')s.recoveryLease={};
  if(mode==='native-live'||mode==='native-unknown')s.meetingBridge=()=>({status:async()=>mode==='native-live'?{recording:true}:{}});
  if(mode==='device-live'||mode==='device-malformed')s.W.WizardOSDevice={recActive:()=>mode==='device-live'?'{}':'{broken'};
  if(mode==='live-row')s.recoveryLive.add(row.id);if(mode==='native-backup-only')row.native='wizard-device';
  if(mode==='lock-busy')s.acquireBounded=async()=>{throw fail('busy','busy')};
  await assert.rejects(s.rescueTake(row.id,'discard',true));assert.equal(s.removed.length,0);assert.equal(s.uploads.length,0);assert.equal(s.acks,0);
});
test('native start during upload leaves the original intact even after successful Files upload',async()=>{
  const {state:s,row}=custody();let running=false;s.meetingBridge=()=>({status:async()=>({recording:running})});const good=s.fetch;
  s.fetch=async(...args)=>{const out=await good(...args);running=true;return out};
  await assert.rejects(s.rescueTake(row.id,'save'));assert.equal(s.removed.length,0);
});
test('a complete positively quiet native rescue alone can acknowledge native storage',async()=>{
  const {state:s,row}=custody();row.native='wizard-device';row.nativeId='fixture';row.rescueComplete=true;s.W.WizardOSDevice={recActive:()=> 'null'};
  s.meetingBridge=()=>({status:async()=>({recording:false})});await s.rescueTake(row.id,'save');assert.equal(s.acks,1);assert.equal(s.removed.length,1);
});
function updater() {
  const timers=[],intervals=[],els=new Map();let clock=Date.parse('2026-11-05T12:00:00Z'),reloads=0;
  const element=()=>({classList:{toggle(){}},setAttribute(){},dataset:{},addEventListener(){},innerHTML:'',remove(){}});
  const body={appendChild(e){if(e.id)els.set(e.id,e)}};
  const document={currentScript:{src:'https://synthetic.invalid/wizard-os-home/core/web-update.js'},body,querySelector:()=>null,getElementById:id=>els.get(id),createElement:element,addEventListener(){},querySelectorAll:()=>[]};
  const f={timers,intervals,els,plan:{ok:true,blocking:[],capture:{safe:true}},revision:'a'.repeat(40),busy:false};
  const window={WizCore:{apps:()=>({APPS:[{id:'messenger',name:'Messenger'},{id:'mizel',name:'Recorder'}]})},WizAppServices:{update:{reloadPlan:()=>f.plan}},WizAppCapture:{staleTakes:()=>f.takes||[]},WizAppReadingPosition:{flush(){}}};f.window=window;
  vm.runInNewContext(source('web-update'),{window,document,URL,Date:class extends Date{static now(){return clock}},location:{href:'https://synthetic.invalid/wizard-os-home/',reload(){reloads++}},navigator:{onLine:true},fetch:async()=>({ok:true,text:async()=>f.revision,json:async()=>({updates:[]})}),setTimeout:(fn,ms)=>{timers.push([fn,ms]);return timers.length},clearTimeout(){},setInterval:fn=>{intervals.push(fn);return intervals.length},clearInterval(){},addEventListener(){}});
  f.web=window.WizWebUpdate;f.web.init({mount:()=>body,busy:()=>f.busy,toast(){}});
  f.advance=ms=>{clock+=ms};Object.defineProperty(f,'reloads',{get:()=>reloads});return f;
}
async function fire(f,ms){const timer=f.timers.find(t=>t[1]===ms);assert(timer,'timer '+ms);timer[0]();await tick()}
test('healthy Reload still navigates exactly once after the existing animation',async()=>{const f=updater();f.web.reload('tap');await fire(f,900);assert.equal(f.reloads,1)});
test('Reload asks the app to keep its draft before checking the recorder, then navigates once',async()=>{
 const f=updater();f.plan={ok:false,blocking:[{appId:'wisdom',kind:'work',keepable:true}],capture:{safe:true}};
 let kept=0;f.window.WizAppServices.update.keepDrafts=async()=>{kept++;f.plan={ok:true,blocking:[],capture:{safe:true}}};
 f.web.reload('tap');assert(f.web.reloadStatus().checking);assert.equal(kept,0);await tick();assert.equal(kept,1);
 await fire(f,900);assert.equal(f.reloads,1);
});
test('a draft keeper that never confirms remains blocked with one plain app reason',async()=>{
 const f=updater();f.window.WizCore.apps=()=>({APPS:[{id:'wisdom',name:'Wisdom'}]});f.plan={ok:false,blocking:[{appId:'wisdom',kind:'work',keepable:true}],capture:{safe:true}};
 f.window.WizAppServices.update.keepDrafts=()=>new Promise(()=>{});f.web.reload('tap');await fire(f,1700);
 assert.equal(f.reloads,0);assert.equal(f.web.reloadStatus().checking,false);assert.equal(f.web.reloadStatus().reason,'Wisdom has unsaved work.');
});
test('notice and blocked toast name the real blocker without troubleshooting codes or private draft text',()=>{
 for(const [app,kind,reason,line] of [['messenger','work','Sending','Messenger is sending.'],['messenger','capture','voice recording','Messenger has a voice note that isn’t sent yet.'],['mizel','work','Saving','Recorder is saving.']]){
  const f=updater();let toast;f.web.init({mount:()=>({appendChild(){}}),toast:(_i,t)=>toast=t});f.plan={ok:false,blocking:[{appId:app,kind,reason}],capture:{safe:false}};
  f.web.reload('tap');assert.equal(f.web.reloadStatus().reason,line);assert.equal(toast,line);assert.doesNotMatch(line,/RECOVERY|RELOAD_|checking|recovery/i);
 }
});
test('armed wait cannot silently last two minutes',()=>{const f=updater();f.plan={ok:false,blocking:[{kind:'capture',appId:'mizel'}],capture:{safe:false,waitForEnd:true},recording:true};f.web.reload('tap');assert(f.web.armed);f.advance(110001);f.intervals.at(-1)();assert(!f.web.armed);assert.match(f.web.reloadStatus().reason,/still waiting/);assert.equal(f.reloads,0)});
test('never-resolving recorder check stops checking and explains retention within 4.5 seconds',async()=>{const f=updater();f.plan.capture.recheck=true;f.window.WizAppCapture.reconcileReload=()=>new Promise(()=>{});f.web.reload('tap');assert(f.web.reloadStatus().checking);await fire(f,4500);assert(!f.web.reloadStatus().checking);assert.match(f.web.reloadStatus().reason,/has a voice note|audio that isn’t saved/)});
test('never-resolving native preparation stops Reloading and explains retention',async()=>{const f=updater();f.plan.keeps={appId:'mizel',id:'live'};f.window.WizAppServices.update.prepareReload=()=>new Promise(()=>{});f.web.reload('tap');await fire(f,900);await fire(f,3500);assert(!f.web.reloadStatus().going);assert.match(f.web.reloadStatus().reason,/audio that isn’t saved/);assert.equal(f.reloads,0)});
test('navigation blocked by beforeunload has a visible watchdog and retry',async()=>{const f=updater();f.web.reload('tap');await fire(f,900);await fire(f,4500);assert(!f.web.reloadStatus().going);assert.match(f.web.reloadStatus().reason,/Couldn’t reload/)});
test('a synchronous persistence error never leaves the burst stuck',async()=>{const f=updater();f.window.WizAppReadingPosition.flush=()=>{throw Error('synthetic')};f.web.reload('tap');await fire(f,900);assert(!f.web.reloadStatus().going);assert.match(f.web.reloadStatus().reason,/Couldn’t reload/)});
for(const app of ['messenger','mizel'])test(app+' frame hold has an on-notice reason with no private hold text',()=>{const f=updater();f.plan={ok:false,blocking:[{kind:'work',appId:app,reason:'DO NOT DISPLAY PRIVATE DRAFT'}]};f.web.reload('tap');const s=f.web.reloadStatus();assert.match(s.reason,app==='mizel'?/Recorder/:/Messenger/);assert.match(s.reason,/unsaved work/);assert(!s.reason.includes('PRIVATE'))});
test('stale memory/row notice names app and date only, with Save default and confirmed Discard',async()=>{
  const f=updater();f.plan={ok:false,blocking:[{kind:'capture',appId:'messenger'}],capture:{safe:false}};f.takes=[{id:'old',appId:'messenger',startedAt:Date.parse('2026-11-03T12:00:00Z')}];
  assert.match(f.web.reloadStatus().reason,/Messenger.*3 Nov|Messenger.*Nov 3/);assert.match(f.web.rescueHtml(),/Save to Files and clear.*Discard/);
  let calls=0;f.window.WizAppCapture.rescueTake=async(id,action,confirmed)=>{calls++;assert.equal(id,'old');assert.equal(action,'discard');assert.equal(confirmed,true);f.plan={ok:true,blocking:[],capture:{safe:true}};f.takes=[]};
  await f.web.rescue('discard');assert.equal(calls,0);assert.match(f.web.rescueHtml(),/Confirm discard/);await f.web.rescue('discard');assert.equal(calls,1);await fire(f,900);assert.equal(f.reloads,1);
});
test('Save on notice automatically retries safe Reload and failure keeps the rescue controls',async()=>{
  for(const bad of [false,true]){const f=updater();f.plan={ok:false,blocking:[{kind:'capture',appId:'messenger'}],capture:{safe:false}};f.takes=[{id:'old',appId:'messenger',startedAt:0}];f.window.WizAppCapture.rescueTake=async()=>{if(bad)throw Error('offline');f.plan={ok:true,blocking:[],capture:{safe:true}};f.takes=[]};await f.web.rescue('save');if(bad){assert.match(f.web.reloadStatus().reason,/still kept/);assert.match(f.web.rescueHtml(),/Save to Files/);assert.equal(f.reloads,0)}else{await fire(f,900);assert.equal(f.reloads,1)}}
});

test('a fresh take this page started (still uploading) is never offered for Save or Discard',async()=>{
  const {state:s,row}=custody();row.startedAt=Date.now()-19;
  assert.equal(s.staleTakes().length,0);
  await assert.rejects(s.rescueTake(row.id,'discard',true));assert.equal(s.removed.length,0);
  row.startedAt=Date.now()+5*60e3; assert.equal(s.staleTakes().length,0);
  row.startedAt=Date.parse('2026-11-03T10:00:00Z'); assert.equal(s.staleTakes().length,1);
});
