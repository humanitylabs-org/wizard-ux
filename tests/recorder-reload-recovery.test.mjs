import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import stopEvidence from '../tools/qa-recorder-stop-evidence.cjs';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const read = name => readFileSync(process.env.QA_REVIEW_CORE ? process.env.QA_REVIEW_CORE+'/'+name+'.js' : new URL('../web/core/'+name+'.js', import.meta.url),'utf8');
const source = read('app-capture');
function extract(from,to,ctx) {
  const a=source.indexOf(from),b=source.indexOf(to,a); assert.ok(a>=0&&b>a,from);
  vm.runInNewContext(source.slice(a,b),ctx); return ctx;
}
function capture(overrides={}) {
  const ctx={active:null,memoryTakes:new Map(),preparations:new Map(),ownedRows:new Map(),recoveryLive:new Set(),unknownMeetingActive:false,
    ownershipLoaded:true,recoveryError:null,recoveryLease:null,configuredNative:{},attachedMeetingBridge:null,W:{},MEETING_APP:'mizel',...overrides};
  // This fail-closed matrix models an in-page adapter; the Android/no-page-audio
  // matrix lives in reload-page-audio-custody.test.mjs with configuredNative:null.
  extract('  function reloadCheck()', '  // Last moment before the shell reloads',ctx);
  return ctx;
}
function service(cap,appId='mizel') {
  const sourceWindow={location:new URL('https://fixture.invalid/'+appId+'/'),document:{},addEventListener(){},postMessage(){}};
  const frame={tagName:'IFRAME',src:sourceWindow.location.href,isConnected:true,contentWindow:sourceWindow,hasAttribute:()=>false,addEventListener(){},removeEventListener(){}};
  const window={WizCore:{apps:()=>({APPS:[{id:appId,name:'Synthetic Recorder',kind:'wizard',url:'/'+appId+'/'}]})},WizAppCapture:{reloadCheck:()=>typeof cap==='function'?cap():cap},dispatchEvent(){}};
  vm.runInNewContext(read('app-services'),{window,location:new URL('https://fixture.invalid/wizard-os-home/'),URL,crypto:{randomUUID},addEventListener(){},setInterval(){},setTimeout,clearTimeout,document:{readyState:'loading',addEventListener(){}},CustomEvent:class{},navigator:{}});
  const host=window.WizAppServices;host.attach(frame,{appId,path:'/'+appId+'/'});
  return {host,window,frame,facade:host.connect(sourceWindow,{}),plan:()=>host.update.reloadPlan()};
}
test('draft hold requires an explicit kept confirmation and becomes busy again after an edit',async()=>{
  const f=service({safe:true},'wisdom');let value='synthetic draft',stored='';
  let h=f.facade.update.hold('Wisdom unsent request',{keep:()=>{stored=value;return 'kept'}});
  assert.equal(f.plan().ok,false);assert.equal(f.host.update.busy(),true);
  assert.equal(f.host.update.frames()[0].keepable,true);
  await f.host.update.keepDrafts(f.frame);assert.equal(stored,value);assert.equal(f.plan().ok,true);assert.equal(f.host.update.busy(),false);
  assert.equal(f.host.update.frames()[0].holds.length,0);assert.equal(f.host.update.frames()[0].keepable,false);
  value+=' changed';h.release();h=f.facade.update.hold('Wisdom unsent request',{keep:()=>false});
  assert.equal(f.plan().ok,false);await f.host.update.keepDrafts();assert.equal(f.plan().ok,false);h.release();
});
for(const result of [false,true,undefined,'saved','throw','timeout'])test('unconfirmed draft stays blocked: '+result,async()=>{
  const f=service({safe:true},'wisdom');let late;
  f.facade.update.hold('Wisdom unsent request',{keep:()=>{if(result==='throw')throw Error('storage denied');if(result==='timeout')return new Promise(r=>late=r);return result}});
  await f.host.update.keepDrafts();assert.equal(f.plan().ok,false);
  late?.('kept');await tick();assert.equal(f.plan().ok,false);
});
test('an edit or document replacement while keep is pending cannot waive the new hold',async()=>{
 for(const mode of ['edit','document']){
  const f=service({safe:true},'wisdom');let finish;const h=f.facade.update.hold('Wisdom unsent request',{keep:()=>new Promise(r=>finish=r)});
  const p=f.host.update.keepDrafts();await tick();
  if(mode==='edit'){h.release();f.facade.update.hold('Wisdom unsent request',{keep:()=>false});}
  else f.frame.contentWindow.document={};
  finish('kept');await p;
  if(mode==='edit')assert.equal(f.plan().ok,false);else assert.equal(f.host.inspect()[0].ready,false);
 }
});
for(const reason of ['Recording','voice note','audio in memory','capture upload'])test('audio can never opt into a text draft keeper: '+reason,async()=>{
 const f=service({safe:true},'messenger');let calls=0;f.facade.update.hold(reason,{keep:()=>{calls++;return 'kept'}});
 await f.host.update.keepDrafts();assert.equal(calls,0);assert.equal(f.plan().ok,false);
});
test('confirmed text draft never waives another active recording or network send',async()=>{
 const f=service({safe:false,waitForEnd:true},'wisdom');f.facade.update.hold('Wisdom unsent request',{keep:()=> 'kept'});
 const send=f.facade.update.hold('Wisdom sending');await f.host.update.keepDrafts();assert.equal(f.plan().ok,false);
 assert(f.plan().blocking.some(b=>b.reason==='Wisdom sending'));send.release();assert.equal(f.plan().ok,false);
});
for(const status of ['null','invalid','missing','throw']) test(`native ${status} check cannot arm a later fresh recording or reload`,async()=>{
  const f=updater();let quiet=false;
  const c=capture({ready:Promise.resolve(),ownershipLoaded:false,
    rows:async()=>[],changed:()=>f.emit('wizard-app-capture-state'),
    meetingBridge:()=>({status:async()=>{if(quiet)return {recording:false};if(status==='throw')throw Error('offline');return status==='null'?null:status==='invalid'?{recording:'no'}:{};}}),
    fail:(code,message)=>Object.assign(Error(message),{code}),crypto:{randomUUID},Date});
  extract('  async function recoverLocked(', '  async function recover()',c);
  c.recover=async()=>{c.recoveryError=null;await c.recoverLocked({})};
  const s=service(()=>c.reloadCheck());
  f.window.WizAppServices.update.reloadPlan=s.plan;
  f.window.WizAppCapture.reconcileReload=c.reconcileReload;
  f.web.reload('tap');for(let i=0;i<8;i++)await tick();
  assert.equal(c.recoveryError.code,'native_owner_uncertain');
  const failedCheck={armed:f.web.armed,recording:s.plan().recording,toast:f.web.reloadStatus().reason,reloads:f.reloads};
  quiet=true;await c.reconcileReload();
  c.active={row:{id:'fresh',appId:'mizel'},phase:'recording',engine:{}};
  f.emit('wizard-app-capture-state');
  for(const [fn,ms] of f.intervals)if(ms===1000)fn();
  await tick();
  assert.equal(f.reloads,0,'quiet native recovery followed by fresh Start must not consume a failed Reload tap');
  assert.equal(failedCheck.armed,false,'failed check must not silently arm');
  assert.equal(failedCheck.recording,false,'unknown custody is not a recording-end promise');
  assert.match(failedCheck.toast,/voice note|audio that isn’t saved/);assert.equal(failedCheck.reloads,0);
  assert.equal(f.web.armed,false);
  assert.equal(s.plan().recording,true);
  // A NEW explicit tap during the proven recording still intentionally waits for Stop/save.
  f.web.reload('tap');assert.equal(f.web.armed,true);assert.equal(f.reloads,0);
  c.active=null;f.emit('wizard-app-capture-state');await tick();
  assert.equal(f.web.armed,false);assert.equal(f.reloads,1);
  f.emit('wizard-app-capture-state');await tick();assert.equal(f.reloads,1,'exactly one intended reload');
});
test('intentional recording arm waits through the real app-owned Stop/save holds without releasing them',async()=>{
  const c=capture({active:{row:{id:'live',appId:'mizel'},phase:'recording',engine:{}}}),s=service(()=>c.reloadCheck()),f=updater();
  const rec=s.facade.update.hold('Mizel recording'),save=s.facade.update.hold('Mizel capture or durable task save');
  f.window.WizAppServices.update.reloadPlan=s.plan;
  f.web.reload('tap');assert.equal(f.web.armed,true);
  c.active=null;f.emit('wizard-app-capture-state');await tick();
  assert.equal(f.web.armed,true,'positive stopped custody waits for app save, not disarm');assert.equal(f.reloads,0);
  assert.equal(s.plan().blocking.length,2,'neither app-owned hold was bypassed');
  rec.release();f.emit('wizard:app-holds');await tick();assert.equal(f.web.armed,true);assert.equal(f.reloads,0);
  save.release();f.emit('wizard:app-holds');await tick();assert.equal(f.web.armed,false);assert.equal(f.reloads,1);
});
test('unknown custody, unloaded/unresolved capture and microphone loans never promise recording-end reload',async()=>{
  const blockers=[{ownershipLoaded:false},{recoveryError:{code:'storage_failed'}},{unknownMeetingActive:true},
    {ownedRows:new Map([['x',{status:'recoverable'}]])},{preparations:new Map([['warm',{}]])},
    {active:{row:{id:'live'},phase:'recording',engine:{},borrow:{}}},
    {active:{row:{id:'live'},phase:'recording',engine:{},error:{code:'storage_failed'}}},
    {active:{row:{id:'live'},phase:'starting'}}];
  for(const state of blockers){
    const c=capture(state),s=service(()=>c.reloadCheck()),f=updater();
    f.window.WizAppServices.update.reloadPlan=s.plan;
    f.window.WizAppCapture.reconcileReload=async()=>c.reloadCheck();
    f.web.reload('tap');await tick();
    assert.equal(f.web.armed,false,JSON.stringify(state));assert.equal(s.plan().recording,false);
    assert.equal(f.reloads,0);
  }
});
test('unsafe, absent and throwing reconciliation results preserve retry rather than arming',async()=>{
  for(const outcome of [{safe:false,reason:'native_owner_uncertain'},undefined,'throw']){
    const f=updater();f.plan={ok:false,recording:true,blocking:[{kind:'capture'}],capture:{recheck:true,safe:false}};
    f.window.WizAppCapture.reconcileReload=async()=>{if(outcome==='throw')throw Error('offline');return outcome};
    f.web.reload('tap');await tick();assert.equal(f.web.armed,false);assert.equal(f.reloads,0);
    assert.match(f.web.reloadStatus().reason,/voice note|audio that isn’t saved/);
  }
});
test('an armed recording is cancelled if custody becomes unknown or the mic is lent',async()=>{
  for(const patch of [{recoveryError:{code:'storage_failed'}},{borrow:{}}]){
    const c=capture({active:{row:{id:'fresh',appId:'mizel'},phase:'recording',engine:{}}}),s=service(()=>c.reloadCheck()),f=updater();
    f.window.WizAppServices.update.reloadPlan=s.plan;f.web.reload('tap');assert.equal(f.web.armed,true);
    if(patch.recoveryError)c.recoveryError=patch.recoveryError;else c.active.borrow=patch.borrow;
    f.emit('wizard-app-capture-state');assert.equal(f.web.armed,false);
    c.recoveryError=null;c.active=null;f.emit('wizard-app-capture-state');await tick();assert.equal(f.reloads,0);
  }
});

test('shared durable custody never overrides app-owned capture or dirty-work holds',()=>{
  const cap=capture().reloadCheck(); assert.equal(cap.durable,true);
  for(const appId of ['mizel','other']) for(const reason of ['Mizel recording','Mizel capture or durable task save','Mizel unsaved notes','Recording','Some capture work','Mizel recording notes']) {
    const f=service(cap,appId),hold=f.facade.update.hold(reason);assert.equal(f.plan().ok,false,appId+': '+reason);
    hold.release();assert.equal(f.plan().ok,true);
  }
});
test('durability is positive proof, never inferred from an error, unloaded registry, unresolved row or active memory',()=>{
  for(const overrides of [{ownershipLoaded:false},{recoveryError:{code:'storage_failed'}},{ownedRows:new Map([['x',{status:'recoverable'}]])}]){
    const cap=capture(overrides).reloadCheck(),f=service(cap);assert.notEqual(cap.durable,true);assert.equal(cap.safe,false);assert.equal(f.plan().ok,false);
  }
  const retained={id:'stopped',appId:'mizel',kind:'meeting',status:'pending',bytes:32000};
  const ctx=capture({ownedRows:new Map([['stopped',retained]])});assert.equal(ctx.reloadCheck().durable,true);assert.equal(ctx.ownedRows.get('stopped'),retained);
});
test('real browser recording, stopping, unsaved memory, preparations and microphone loans remain blocked',()=>{
  for(const phase of ['starting','recording','paused','stopping']) {
    const cap=capture({active:{row:{id:'live',appId:'mizel'},phase,engine:{},queue:[{blob:'synthetic-unsaved'}]}}).reloadCheck();
    assert.equal(cap.safe,false,phase);assert.equal(cap.recheck,false);const f=service(cap);f.facade.update.hold('Mizel recording');assert.equal(f.plan().ok,false);
  }
  assert.equal(capture({preparations:new Map([['warm',{}]])}).reloadCheck().safe,false);
  const ctx=capture({W:{wizardMizelPort:{}},active:{row:{id:'live',appId:'mizel',native:'wizard-meetings',nativeId:'qa-meeting',kind:'meeting',meta:{}},phase:'recording',engine:{}}});
  const cap=ctx.reloadCheck();assert.equal(cap.safe,true);assert.equal(cap.keeps.appId,'mizel');
  ctx.active.borrow={};assert.equal(ctx.reloadCheck().reason,'microphone_loan');
});
test('native survival is specific: steady Android meeting keeps recording, private mic loans and unfinished saves block',()=>{
  const row={id:'native-capture',appId:'recorder-fixture',kind:'meeting',native:'wizard-meetings',nativeId:'meeting'};
  const active={row,phase:'recording',engine:{}};
  assert.equal(capture({active,W:{wizardMizelPort:{}}}).reloadCheck().safe,true);
  for(const patch of [{borrow:{private:true}},{borrowWork:Promise.resolve()},{finishPromise:Promise.resolve()},{phase:'stopping'},{engineDetached:true}]) {
    const check=capture({active:{...active,...patch},W:{wizardMizelPort:{}}}).reloadCheck();
    assert.equal(check.safe,false);if(patch.borrow||patch.borrowWork)assert.equal(check.reason,'microphone_loan');
  }
});
test('unknown/malformed native owners fail closed',()=>{
  for(const overrides of [{unknownMeetingActive:true},{W:{WizardOSDevice:{recActive:()=>'{broken'}}},{W:{WizardOSDevice:{recActive:()=>'{"id":"native-live"}'}}},{ownedRows:new Map([['x',{native:'wizard-meetings',status:'recoverable'}]])}])assert.equal(capture(overrides).reloadCheck().safe,false);
});
test('tap reconciliation only runs the existing locked recovery when inactive; no stop/cancel/ack/delete',async()=>{
  let recovered=0;
  const ctx=capture({ready:Promise.resolve(),recover:async()=>recovered++});await ctx.reconcileReload();assert.equal(recovered,1);
  ctx.active={row:{},phase:'recording',engine:{}};await ctx.reconcileReload();assert.equal(recovered,1);
  ctx.active=null;ctx.preparations.set('warm',{});await ctx.reconcileReload();assert.equal(recovered,1);
});
test('stale native ID-less reservation becomes pending without deleting metadata/chunks; live/unknown stays protected',async()=>{
  for(const st of [{recording:false},{recording:true},null]){
    const row={id:'stale',appId:'mizel',kind:'meeting',native:'wizard-meetings',status:'recoverable',bytes:32000,meta:{synthetic:true}};
    const data=[row],ctx={ownedRows:new Map(),recoveryLive:new Set(),ownershipLoaded:false,unknownMeetingActive:false,active:null,
      rows:async()=>data,changed(){},meetingBridge:()=>({status:async()=>st}),W:{},put:async r=>{data[0]=r;ctx.ownedRows.set(r.id,r)},fail:(code,message)=>Object.assign(Error(message),{code}),crypto:{randomUUID},Date};
    extract('  async function recoverLocked(', '  async function recover()',ctx);
    if(st===null){await ctx.recoverLocked({});assert.equal(ctx.recoveryError.code,'native_owner_uncertain');assert.equal(data[0].status,'recoverable');}
    else {await ctx.recoverLocked({});assert.equal(data[0].status,st.recording?'recoverable':'pending');assert.equal(data[0].bytes,32000);assert.deepEqual(data[0].meta,row.meta);}
  }
});
function updater(host={}) {
  const timers=[],intervals=[],listeners=new Map(),toasts=[],events=[],els=new Map();let revision='a'.repeat(40),reloads=0,p={ok:true,blocking:[],recording:false,capture:{recheck:true}};
  function element(){return {classList:{toggle(){}},setAttribute(){},dataset:{},addEventListener(){},innerHTML:'',remove(){els.delete('burst')}};}
  const body={appendChild(el){if(el.id)els.set(el.id,el);else if(el.className==='wos-burst')els.set('burst',el)}};
  const document={currentScript:{src:'https://fixture.invalid/wizard-os-home/core/web-update.js'},body,hidden:false,
    querySelector:s=>s==='.wos-burst'?els.get('burst'):null,getElementById:id=>els.get(id),createElement:element,addEventListener(){},querySelectorAll:()=>[]};
  const window={WizAppServices:{update:{announce(){},reloadPlan:()=>p,prepareReload:async()=>{}}},WizAppCapture:{reconcileReload:async()=>({safe:true})},WizAppReadingPosition:{flush(){}}};
  const ctx={window,document,URL,location:{href:'https://fixture.invalid/wizard-os-home/',reload(){reloads++}},navigator:{onLine:true},fetch:async u=>({ok:true,text:async()=>revision,json:async()=>({updates:[]})}),setTimeout:(f,ms)=>{timers.push([f,ms]);return timers.length},clearTimeout(){},setInterval:(f,ms)=>{intervals.push([f,ms]);return intervals.length},clearInterval(){},addEventListener:(name,f)=>listeners.set(name,f)};
  vm.runInNewContext(read('web-update'),ctx);const web=window.WizWebUpdate;web.init({shell:'phone',mount:()=>body,busy:()=>false,toast:(...a)=>toasts.push(a),log:(...a)=>events.push(a),...host});
  return {web,window,timers,intervals,toasts,els,events,emit:name=>listeners.get(name)?.(),get reloads(){return reloads},set plan(v){p=v},get plan(){return p},set revision(v){revision=v}};
}
const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve()};
test('Reload paints checking before I/O, retries once, and reloads only under the current predicate',async()=>{
  const f=updater();await f.web.check(true);f.revision='b'.repeat(40);await f.web.check(true);
  let release;f.window.WizAppCapture.reconcileReload=()=>new Promise(r=>release=r);
  f.web.reload('tap');assert.match(f.els.get('dvWeb').innerHTML,/disabled aria-busy="true">Getting ready/);assert.equal(release,undefined);await tick();assert.ok(release);assert.equal(f.reloads,0);
  release({safe:true});await tick();const animation=f.timers.find(([,ms])=>ms===900);assert.ok(animation);
  f.plan={ok:false,blocking:[{kind:'capture'}],recording:true};animation[0]();await tick();assert.equal(f.reloads,0);assert.equal(f.els.has('burst'),false);assert.match(f.toasts.at(-1)[1],/has a voice note|has unsaved work/);
  f.plan={ok:true,blocking:[],recording:false};f.web.reload('tap');f.timers.filter(([,ms])=>ms===900).at(-1)[0]();await tick();assert.equal(f.reloads,1);
});
test('reload recovery errors do not unload, discard, or get stuck in checking',async()=>{
  const f=updater();await f.web.check(true);f.revision='b'.repeat(40);await f.web.check(true);f.window.WizAppCapture.reconcileReload=async()=>{throw Error('synthetic offline')};
  f.web.reload('tap');await tick();assert.equal(f.reloads,0);assert.doesNotMatch(f.els.get('dvWeb').innerHTML,/Getting ready/);assert.match(f.web.reloadStatus().reason,/voice note|audio that isn’t saved/);
});
test('recording/work starting during asynchronous native backup flush prevents reload',async()=>{
  const f=updater();let release;f.plan={ok:true,keeps:{appId:'mizel'},blocking:[],recording:false};
  f.window.WizAppServices.update.prepareReload=()=>new Promise(r=>release=r);
  f.web.reload('tap');f.timers.find(([,ms])=>ms===900)[0]();await tick();assert.ok(release);
  f.plan={ok:false,blocking:[{kind:'work',reason:'unsaved notes'}],recording:false};release();await tick();assert.equal(f.reloads,0);assert.match(f.toasts.at(-1)[1],/has a voice note|has unsaved work/);
});
test('hung recorder check has a bounded UI wait without cancelling the underlying take',async()=>{
  const f=updater();await f.web.check(true);f.revision='b'.repeat(40);await f.web.check(true);
  f.window.WizAppCapture.reconcileReload=()=>new Promise(()=>{});f.web.reload('tap');await tick();
  f.timers.find(([,ms])=>ms===4500)[0]();await tick();assert.equal(f.reloads,0);assert.doesNotMatch(f.els.get('dvWeb').innerHTML,/Getting ready/);assert.match(f.web.reloadStatus().reason,/voice note|audio that isn’t saved/);
});

test('aborted native flush preserves the actual frame, hold and registered observers; commit alone detaches',async()=>{
  const f=service({safe:true,keeps:{appId:'mizel'}});
  let finish,removed=0,detached=0;
  f.frame.removeEventListener=()=>detached++;
  f.frame.remove=()=>{removed++;f.frame.isConnected=false};
  f.window.WizAppReadingPosition={};
  f.window.WizAppCapture.prepareReload=()=>new Promise(r=>finish=r);
  const hold=f.facade.update.hold('Mizel recording');
  const plan=f.plan();assert.equal(plan.ok,true);
  const work=f.host.update.prepareReload(plan);await tick();
  assert.equal(removed,0);assert.equal(f.host.inspect()[0].ready,true);
  assert.deepEqual(Array.from(f.host.inspect()[0].holds),['Mizel recording']);
  // Native flush completes, but unrelated unsaved work now vetoes the shell reload.
  const notes=f.facade.update.hold('Unsaved notes');finish();await work;
  assert.equal(f.plan().ok,false);assert.equal(removed,0);assert.equal(f.host.inspect()[0].ready,true);
  assert.equal(f.host.inspect()[0].holds.length,2);
  hold.release(); // exact facade is still authorized after an aborted preparation
  assert.equal(f.host.inspect()[0].holds.length,1);assert.equal(detached,0);
  notes.release();f.host.update.commitReload(f.plan());
  assert.equal(removed,1);assert.equal(detached,1);assert.equal(f.host.inspect().length,0);
});
test('host becomes busy during animation or native flush: no host hook, commit, removal or reload',async()=>{
  for(const during of ['animation','flush']) {
    let busy=false,hooks=0,commits=0,finish;
    const f=updater({busy:()=>busy,beforeReload:()=>hooks++});
    f.plan={ok:true,keeps:{appId:'mizel'},blocking:[],recording:false};
    f.window.WizAppServices.update.commitReload=()=>commits++;
    f.window.WizAppServices.update.prepareReload=()=>new Promise(r=>finish=r);
    f.web.reload('tap');if(during==='animation')busy=true;
    f.timers.find(([,ms])=>ms===900)[0]();await tick();
    if(during==='flush'){assert.ok(finish);busy=true;finish();await tick();}
    assert.equal(hooks,0);assert.equal(commits,0);assert.equal(f.reloads,0);
  }
});
test('native preparation failure is not swallowed into a reload',async()=>{
  const f=updater();let commits=0;f.plan={ok:true,keeps:{appId:'mizel'},blocking:[]};
  f.window.WizAppServices.update.prepareReload=async()=>{throw Error('unknown flush')};
  f.window.WizAppServices.update.commitReload=()=>commits++;
  f.web.reload('tap');f.timers.find(([,ms])=>ms===900)[0]();await tick();
  assert.equal(f.reloads,0);assert.equal(commits,0);assert.match(f.web.reloadStatus().reason,/audio that isn’t saved/);
});
test('timed-out Reload retries join one underlying recovery until it settles',async()=>{
  let release,calls=0;const c=capture({ready:Promise.resolve(),recover:()=>{calls++;return new Promise(r=>release=r)}});
  const a=c.reconcileReload(),b=c.reconcileReload();assert.equal(a,b);await tick();assert.equal(calls,1);
  release();await a;c.recover=async()=>calls++;await c.reconcileReload();assert.equal(calls,2);
});
for(const status of ['missing','reject'])test(`unknown native ${status} still repairs browser rows without declaring quiet`,async()=>{
  const original={id:'browser',appId:'recorder-fixture',status:'recording',bytes:32000,meta:{meetingId:'synthetic'}};
  let row=original;
  const c={active:null,ownedRows:new Map(),recoveryLive:new Set(),ownershipLoaded:false,unknownMeetingActive:false,recoveryError:null,
    rows:async()=>[row],changed(){},meetingBridge:()=>({status:async()=>{if(status==='reject')throw Error('offline');return {};}}),W:{},
    put:async r=>{row=r;c.ownedRows.set(r.id,r)},fail:(code,message)=>Object.assign(Error(message),{code}),crypto:{randomUUID},Date};
  extract('  async function recoverLocked(', '  async function recover()',c);await c.recoverLocked({});
  assert.equal(row.status,'pending');assert.equal(row.bytes,32000);assert.equal(row.meta,original.meta);
  assert.equal(c.recoveryError.code,'native_owner_uncertain');assert.equal(capture(c).reloadCheck().safe,false);
});
test('notification start during row writes invalidates the earlier idle native snapshot',async()=>{
  let calls=0,row={id:'browser',appId:'fixture',status:'recording',bytes:1,meta:{}};
  const c={active:null,ownedRows:new Map(),recoveryLive:new Set(),ownershipLoaded:false,unknownMeetingActive:false,
    rows:async()=>[row],changed(){},meetingBridge:()=>({status:async()=>++calls===1?{recording:false}:{recording:true,meetingId:'new-native'}}),W:{},
    put:async r=>{row=r;c.ownedRows.set(r.id,r)},fail:(code,message)=>Object.assign(Error(message),{code}),crypto:{randomUUID},Date};
  extract('  async function recoverLocked(', '  async function recover()',c);await c.recoverLocked({});
  assert.equal(calls,2);assert.equal(c.unknownMeetingActive,true);assert.equal(capture(c).reloadCheck().safe,false);
});
test('consumed warm preparation release cannot close input now owned by a session',async()=>{
  let closed=0,stopped=0;
  const c={preparations:new Map(),active:null,changed(){},validate:()=>({}),crypto:{randomUUID},Date,
    setTimeout,clearTimeout,DEFAULT_LIMIT:100000,START_BOUND_MS:10000,PROMPT_BOUND_MS:60000,Promise,
    startRun:async s=>{assert.equal(s.ctx,p.ctx);c.discardPrepared('fixture','warm');throw Error('late setup failure')}};
  extract('  function discardPrepared(', '  async function streamChunks(',c);
  const p={id:'warm',appId:'fixture',ctx:{close(){closed++;return Promise.resolve()}},display:Promise.resolve({getTracks:()=>[{stop(){stopped++}}]})};
  c.preparations.set(p.id,p);
  // Execute the exact production consumption path, then replay the app's late catch release.
  extract('  async function start(appId,', '  async function startRun(',c);
  await assert.rejects(c.start('fixture',{kind:'meeting',preparedId:p.id}),/late setup failure/);
  c.discardPrepared('fixture',p.id);
  assert.equal(closed,0);assert.equal(stopped,0);
});
test('unknown native status cannot become an empty app-custody proof, but repaired browser takes remain accessible',async()=>{
  const row={id:'browser',appId:'fixture',status:'pending',bytes:32000};let data=[];
  const c={validate(){},memoryTakes:new Map(),ready:Promise.resolve(),recover:async()=>{},rows:async()=>data,result:async r=>r,
    recoveryError:Object.assign(Error('native unknown'),{code:'native_owner_uncertain'}),unknownMeetingActive:false,ownershipLoaded:true,ownedRows:new Map(),
    fail:(code,message)=>Object.assign(Error(message),{code}),bounded:p=>p,nativeLiveTake:async()=>null};
  extract('  async function pending(appId)', '  async function ack(',c);
  await assert.rejects(c.pending('fixture'),e=>e.code==='native_owner_uncertain');
  data=[row];c.ownedRows.set(row.id,row);assert.equal((await c.pending('fixture'))[0],row);
});
const runner=readFileSync(new URL('../qa-recorder-reload-recovery.cjs',import.meta.url),'utf8');
test('browser Stop evidence callback sends the genuine blob without awaiting a dying page hash',async()=>{
  const start=runner.indexOf('  await page.evaluate(()=>{void syntheticSession.stop()');
  const end=runner.indexOf('\n  const kept=await stopped()',start);assert(start>=0&&end>start);
  let stop,returned,sent,opened,stored;
  const blob=new Blob([Uint8Array.of(0,255,1,128,10,13)]),pending=new Promise(r=>{stop=r});
  const ctx={page:{evaluate:fn=>{returned=fn()}},syntheticSession:{stop:()=>pending},
    sessionStorage:{setItem:(key,value)=>{stored=[key,value]}},encodeURIComponent,
    XMLHttpRequest:class{status=204;open(...args){opened=args}setRequestHeader(){}send(body){sent=body}}};
  await vm.runInNewContext('(async()=>{'+runner.slice(start,end)+'})()',ctx);
  assert.equal(returned,undefined);assert.equal(sent,undefined,'dispatch completes before Stop resolves');
  stop({id:'aabb-0011',blob});await tick();
  assert.equal(sent,blob,'same exact Stop blob, not reconstructed or post-reload bytes');
  assert.deepEqual(opened,['POST','/fixture-capture-evidence?id=aabb-0011',false]);
  assert.deepEqual(stored,['syntheticCapture','aabb-0011']);
});
test('closed Stop evidence route continues genuine wire bytes at the same owned origin without URL rewriting',async()=>{
  const start=runner.indexOf('   await c.route(u=>');
  const end=runner.indexOf('\n   });',start)+7;assert(start>=0&&end>start);
  let route,pattern,continued=false,options;const report={requests:[]};
  const ctx={c:{route:async(p,fn)=>{pattern=p;route=fn}},fixture:{report},assert,URL,sink:{url:'http://127.0.0.1:43210'}};
  await vm.runInNewContext('(async()=>{'+runner.slice(start,end)+'})()',ctx);
  const url='http://127.0.0.1:43210/fixture-capture-evidence?id=aabb-0011';
  assert(pattern(new URL(url)));assert(pattern(new URL(url.replace('aabb-0011','preflight'))));
  for(const bad of [url.replace('43210','43211'),url.replace('127.0.0.1','localhost'),url.replace('127.0.0.1:43210','owner.invalid'),url+'&extra=1',url.replace('aabb-0011','private')])assert(!pattern(new URL(bad)),bad);
  await route({request:()=>({method:()=> 'POST',url:()=>url}),continue:async v=>{continued=true;options=v}});
  assert(continued);assert.equal(options,undefined,'no URL/header/body rewriting or postDataBuffer dependency');
  await assert.rejects(route({request:()=>({method:()=> 'GET',url:()=>url})}),/POST/);
  assert(runner.includes('},sink);'),'whole fixture uses the owned evidence origin');
});
test('closed startup routes answer only pinned synthetic seed/inbox semantics and retain refusal/unknown logs',async()=>{
  let route,goto;const page={on(){},clock:{install:async()=>{}},goto:async u=>{goto=u},waitForFunction:async()=>{},evaluate:async fn=>fn.toString().includes('WosSkin.current')?'nebula':false};
  const c={routeWebSocket:async()=>{},addInitScript:async()=>{},route:async(_,fn)=>{route=fn},newPage:async()=>page};
  const module={exports:{}};
  const realRequire=require;
  vm.runInNewContext(readFileSync(new URL('../tools/qa-closed-shell.cjs',import.meta.url),'utf8'),{
    module,__dirname:path.resolve('tools'),process:{env:{QA_OUT:process.cwd(),QA_TREE:process.cwd()}},console,URL,JSON,
    require:name=>name==='./qa-playwright.cjs'?{devices:{'Pixel 7':{}}}:name==='./qa-recorder-stop-evidence.cjs'?stopEvidence:realRequire(name)});
  const fixture=module.exports;fixture.setBrowser({newContext:async()=>c});
  await assert.rejects(fixture.boot(true,null,{url:'http://127.0.0.1:43210'}),/owned/);
  const out=mkdtempSync(path.join(process.env.TMPDIR||process.cwd(),'.qa-origin-'));
  const sink=await stopEvidence.start({out,mode:'phone',report:{errors:[]}});
  try{
    await fixture.boot(true,null,sink);assert(goto.startsWith(sink.url+'/wizard-os-home/'));
    const request=async(method,payloadPath,body)=>{
      let response;
      await route({request:()=>({method:()=>method,url:()=>new URL(payloadPath,sink.url).href,postDataJSON:()=>body}),fulfill:async v=>{response=v},abort:async v=>{response={abort:v}}});
      return response;
    };
    const before=JSON.parse((await request('GET','/wizard/v1/ui-preferences')).body);assert.deepEqual(before,{migrations:{}});
    const launcher={window:{}};vm.runInNewContext(readFileSync(new URL('../web/core/launcher-defaults.js',import.meta.url),'utf8'),launcher);
    const seed={marker:'launcher-seed-v1',launcher:JSON.parse(JSON.stringify(launcher.window.WizLauncherDefaults))};
    const first=JSON.parse((await request('POST','/wizard/v1/ui-preferences/seed',seed)).body);
    assert.deepEqual(first.preferences,{launcher:seed.launcher,migrations:{'launcher-seed-v1':true}});
    assert.deepEqual(JSON.parse((await request('GET','/wizard/v1/ui-preferences')).body),first.preferences);
    assert.deepEqual(JSON.parse((await request('POST','/wizard/v1/ui-preferences/seed',seed)).body),first,'idempotent synthetic migration');
    assert.deepEqual(JSON.parse((await request('GET','/mizel/api/inbox')).body),{inbox:1,items:[]});
    assert.deepEqual(JSON.parse((await request('GET','/wizard-os-home/store-data/router/v1/needs/mizel')).body),{app_id:'mizel',models:[],services:[],ready_to_open:true});
    assert.equal(fixture.report.unknown.length,0);assert.equal(fixture.report.refusedWrites.length,0);assert.equal(fixture.report.mutations.length,2);
    await assert.rejects(request('POST','/wizard/v1/ui-preferences/seed',{...seed,marker:'private'}));
    await assert.rejects(request('POST','/wizard/v1/ui-preferences/seed',{...seed,launcher:{}}));
    assert.equal((await request('POST','/wizard/v1/ui-preferences/seed?extra=1',seed)).status,403);
    assert.equal((await request('POST','/mizel/api/inbox',{})).status,403);
    assert.equal((await request('GET','/mizel/api/inbox?private=1')).status,451);
    assert.equal((await request('GET','https://owner.invalid/mizel/api/inbox')).abort,'blockedbyclient');
    assert.equal(fixture.report.unknown.length,2);assert.equal(fixture.report.refusedWrites.length,2,'denials are kept, not blanked');
  }finally{await sink.close();rmSync(out,{recursive:true,force:true})}
  assert.throws(()=>stopEvidence.origin(sink),/owned/,'closed servers cannot become an origin override');
});
test('wire evidence sink retains exact binary Blob bytes and rejects malformed requests without hanging',async()=>{
  const out=mkdtempSync(path.join(process.env.TMPDIR||process.cwd(),'.qa-stop-')),report={errors:[]};
  const sink=await stopEvidence.start({out,mode:'phone',report});
  try{
    assert.equal(stopEvidence.origin(sink),sink.url);assert.throws(()=>stopEvidence.origin({...sink}),/owned/);
    const favicon=await fetch(sink.url+'/favicon.ico');assert.equal(favicon.status,204);
    assert.equal(report.errors.length,0);
    assert.deepEqual(report.evidenceRequests,[{mode:'phone',method:'GET',url:'/favicon.ico',host:new URL(sink.url).host,admitted:'favicon',status:204}]);
    const preflight=await fetch(sink.url+'/fixture-capture-evidence?id=preflight',{method:'POST',body:new Blob([Uint8Array.of(0,255,128)])});assert.equal(preflight.status,204);
    assert.equal(report.evidencePreflights[0].hash,createHash('sha256').update(Buffer.from([0,255,128])).digest('hex'));
    const bytes=Buffer.from([0,255,1,128,10,13]);
    const response=await fetch(sink.url+'/fixture-capture-evidence?id=aabb-0011',{method:'POST',body:new Blob([bytes])});assert.equal(response.status,204);
    const kept=await sink.received();assert.equal(kept.id,'aabb-0011');assert.equal(kept.bytes,bytes.length);
    assert.equal(kept.hash,createHash('sha256').update(bytes).digest('hex'));
    assert.deepEqual(readFileSync(path.join(out,'phone-stop.bin')),bytes);
    assert.deepEqual(JSON.parse(readFileSync(path.join(out,'phone-stop.json'),'utf8')),kept);
    assert.deepEqual(report.evidenceRequests.slice(1).map(r=>[r.method,r.url,r.status,r.admitted]),[
      ['POST','/fixture-capture-evidence?id=preflight',204,'preflight'],['POST','/fixture-capture-evidence?id=aabb-0011',204,'stop']]);
    const denied=[['GET','/unexpected'],['GET','/favicon.ico?'],['GET','/favicon.ico?x=1'],['POST','/favicon.ico'],['GET','/favicon.ico/'],['GET','/']];
    const {request:httpRequest}=await import('node:http');
    for(const [method,url] of denied){
      // Keep raw request targets, including an empty query marker (fetch normalizes it).
      const status=await new Promise((resolve,reject)=>{
        const req=httpRequest(sink.url,{method,path:url},res=>{res.resume();res.on('end',()=>resolve(res.statusCode))});req.on('error',reject);req.end();
      });assert.equal(status,500,method+' '+url);
    }
    assert.equal(report.errors.length,denied.length);
    assert.deepEqual(report.errors,denied.map(([method,url])=>({evidence:'Error: Unexpected synthetic evidence request',mode:'phone',method,url,host:new URL(sink.url).host})));
    assert.deepEqual(report.evidenceRequests.slice(3),denied.map(([method,url])=>({mode:'phone',method,url,host:new URL(sink.url).host,status:500,error:'Error: Unexpected synthetic evidence request'})));
  }finally{await sink.close();rmSync(out,{recursive:true,force:true})}
});

test('teardown wire requests serve only the exact pinned shell orb image',async()=>{
  const out=mkdtempSync(path.join(process.env.TMPDIR||process.cwd(),'.qa-orb-')),report={errors:[]};
  const sink=await stopEvidence.start({out,mode:'phone',report});
  try{
    const response=await fetch(sink.url+'/wizard-os-home/robert-thread-orb.png');assert.equal(response.status,200);
    const expected=readFileSync(new URL('../web/robert-thread-orb.png',import.meta.url));
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),expected);
    assert.equal(report.evidenceRequests[0].hash,createHash('sha256').update(expected).digest('hex'));
    assert.equal(report.evidenceRequests[0].admitted,'source-orb-image');assert.equal(report.errors.length,0);
    for(const [url,method] of [['/wizard-os-home/robert-thread-orb.png?x=1','GET'],['/wizard-os-home/robert-thread-orb.png','POST'],['/wizard-os-home/other.png','GET']]){
      assert.equal((await fetch(sink.url+url,{method})).status,500);
    }
    assert.equal(report.errors.length,3,'unadmitted asset paths, queries and methods remain failures');
  }finally{await sink.close();rmSync(out,{recursive:true,force:true})}
});
test('a different native take appearing during flush cannot inherit the prior take preparation',async()=>{
  const f=updater();let finish,commits=0;
  f.plan={ok:true,keeps:{appId:'fixture',id:'original',meetingId:'original'}};
  f.window.WizAppServices.update.prepareReload=()=>new Promise(r=>finish=r);
  f.window.WizAppServices.update.commitReload=()=>commits++;
  f.web.reload('tap');f.timers.find(([,ms])=>ms===900)[0]();await tick();
  f.plan={ok:true,keeps:{appId:'fixture',id:'new',meetingId:'new'}};finish();await tick();
  assert.equal(f.reloads,0);assert.equal(commits,0);
});
// James, 6 Nov 2026: "make reloads work live". A steady Android meeting must not be held hostage by
// phone-storage doubt (broken backup store, an older take still awaiting Retry save).
test('steady Android meeting reloads live despite phone-storage custody doubt',()=>{
  const row={id:'live',appId:'mizel',kind:'meeting',native:'wizard-meetings',nativeId:'m2',meta:{meetingId:'m2'}};
  const active={row,phase:'recording',engine:{}},W={wizardMizelPort:{}};
  for(const o of [{recoveryError:new Error('storage timed out')},{ownershipLoaded:false},
    {ownedRows:new Map([['live',{...row,status:'recording'}],['old',{id:'old',appId:'mizel',native:'wizard-meetings',nativeId:'m1',status:'retained'}]])}]){
    const c=capture({active,W,...o}).reloadCheck();assert.equal(c.safe,true);assert.equal(c.keeps.meetingId,'m2');
  }
  // Still blocks: mic lent to the orb, page-memory audio, a non-surviving (browser) recorder.
  assert.equal(capture({active:{...active,borrow:{}},W,recoveryError:new Error('x')}).reloadCheck().safe,false);
  assert.equal(capture({active,W,recoveryError:new Error('x'),memoryTakes:new Map([['t',{session:{row}}]])}).reloadCheck().safe,false);
  assert.equal(capture({active,W:{},recoveryError:new Error('x')}).reloadCheck().safe,false);
});

// James, 6 Nov 2026 (second report): after a reload the meeting keeps recording natively but this page may not own
// it (phone storage broken, stale device flag). Reload must still be allowed; page-held audio still blocks.
test('Android meeting port: reload allowed when only stored-take doubt blocks',()=>{
  const W={wizardMizelPort:{}};
  for(const o of [{recoveryError:new Error('storage timed out')},{ownershipLoaded:false},{unknownMeetingActive:true},{recoveryLease:{},recoveryError:new Error('storage timed out')}]){
    const c=capture({W,configuredNative:null,...o}).reloadCheck();assert.equal(c.safe,true);
  }
  assert.equal(capture({W,configuredNative:null,memoryTakes:new Map([['t',{session:{row:{}}}]])}).reloadCheck().safe,false);
  assert.equal(capture({W,configuredNative:null,preparations:new Map([['p',{}]])}).reloadCheck().safe,false);
  assert.equal(capture({W,configuredNative:null,active:{row:{id:'b',appId:'x',kind:'voice'},phase:'recording',engine:{}}}).reloadCheck().safe,false);
  assert.equal(capture({W:{},configuredNative:null,recoveryLease:{},recoveryError:new Error('x')}).reloadCheck().safe,false);
  assert.equal(capture({configuredNative:null,W:{...W,WizardOSDevice:{recActive:()=>'{"id":"v"}'}}}).reloadCheck().reason,'device_recording');
});
test('rowless Android meeting keeps only the Recorder frame; other apps and device notes still block',()=>{
  const W={wizardMizelPort:{}};
  const c=capture({W,configuredNative:null,recoveryError:new Error('storage timed out')}).reloadCheck();
  assert.equal(c.safe,true);assert.equal(c.keeps?.id,undefined);assert.equal(c.keeps?.appId ?? c.meetingApp,'mizel');
  // Codex review: an active or unreadable device recorder is not a surviving meeting.
  assert.equal(capture({W:{...W,WizardOSDevice:{recActive:()=>'{"id":"note"}'}},configuredNative:null,recoveryError:new Error('x')}).reloadCheck().safe,false);
  assert.equal(capture({W:{...W,WizardOSDevice:{recActive:()=>{throw Error('x')}}},configuredNative:null,recoveryError:new Error('x')}).reloadCheck().safe,false);
  // Another app's capture hold is never waived by the meeting exemption.
  const f=service({safe:true,keeps:null,nativeMeeting:true,meetingApp:'mizel'},'messenger');f.facade.update.hold('Messenger recording upload');
  assert.equal(f.plan().ok,false);
  const g=service({safe:true,keeps:null,nativeMeeting:true,meetingApp:'mizel'});g.facade.update.hold('Mizel recording');
  const p=g.plan();assert.equal(p.ok,true);assert.equal(p.keeps.appId,'mizel');
});

// James, 6 Nov 2026 ("I need to go back into the recorder and resume it manually"): with phone storage broken,
// the Android meeting service still names its live meeting, so Recorder reattaches by itself after a reload.
test('broken phone storage: pending hands Recorder the live Android meeting so it reattaches without Resume here',async()=>{
  let st={recording:true,meetingId:'mt_live',mediaMs:60000};
  const c={validate(){},memoryTakes:new Map(),active:null,ready:Promise.resolve(),
    recover:async()=>{throw Object.assign(Error('storage timed out'),{code:'recovery_timeout'});},rows:async()=>{throw Error('broken');},
    recoveryError:null,unknownMeetingActive:false,ownershipLoaded:false,ownedRows:new Map(),recoveryLive:new Set(),changed(){},
    meetingBridge:()=>({status:async()=>st}),bounded:p=>p,Blob,Date,MEETING_APP:'mizel',
    fail:(code,message)=>Object.assign(Error(message),{code})};
  extract('  async function nativeLiveTake(appId)', '  async function ack(',c);
  const [take]=await c.pending('mizel');
  assert.equal(take.meta.meetingId,'mt_live');assert.equal(take.meta.captureRecovery.resumable,true);
  assert.equal(c.ownedRows.get(take.id).memoryOnly,true);assert(c.recoveryLive.has(take.id));
  // Only the meeting service's own named meeting, only for Recorder, never invented.
  await assert.rejects(c.pending('messenger'),e=>e.code==='recovery_timeout');
  st={recording:false};c.ownedRows.clear();c.recoveryLive.clear();
  await assert.rejects(c.pending('mizel'),e=>e.code==='recovery_timeout');
  st={recording:true};await assert.rejects(c.pending('mizel'),e=>e.code==='recovery_timeout');
});
