// Synthetic VM tests only: no owner storage, native commands or audio.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const read = name => readFileSync(process.env.QA_REVIEW_CORE ? `${process.env.QA_REVIEW_CORE}/${name}.js` : new URL(`../web/core/${name}.js`,import.meta.url),'utf8');
function capture(patch={}) {
  const source=read('app-capture'),start=source.indexOf('  function reloadCheck()'),end=source.indexOf('  // Last moment before the shell reloads',start);
  assert(start>=0&&end>start);
  const c={MEETING_APP:'mizel',active:null,memoryTakes:new Map(),preparations:new Map(),recoveryLease:null,configuredNative:null,attachedMeetingBridge:null,
    ownedRows:new Map(),recoveryLive:new Set(),ownershipLoaded:true,recoveryError:null,unknownMeetingActive:false,
    W:{wizardMizelPort:{}},ready:Promise.resolve(),recover:async()=>{},...patch};
  vm.runInNewContext(source.slice(start,end),c);return c;
}
function service(c) {
  const sourceWindow={location:new URL('https://fixture.invalid/synthetic/'),document:{},addEventListener(){},postMessage(){}};
  const frame={tagName:'IFRAME',src:sourceWindow.location.href,isConnected:true,contentWindow:sourceWindow,hasAttribute:()=>false,addEventListener(){},removeEventListener(){}};
  const window={WizCore:{apps:()=>({APPS:[{id:'synthetic',name:'Synthetic',kind:'wizard',url:'/synthetic/'}]})},WizAppCapture:{reloadCheck:()=>c.reloadCheck()},dispatchEvent(){}};
  vm.runInNewContext(read('app-services'),{window,location:new URL('https://fixture.invalid/wizard-os-home/'),URL,crypto:{randomUUID},addEventListener(){},setInterval(){},setTimeout,clearTimeout,document:{readyState:'loading',addEventListener(){}},CustomEvent:class{},navigator:{}});
  const host=window.WizAppServices;host.attach(frame,{appId:'synthetic',path:'/synthetic/'});
  return {host,facade:host.connect(sourceWindow,{}),plan:()=>host.update.reloadPlan()};
}
function updater(c,s) {
  const timers=[],toasts=[],els=new Map();let reloads=0;
  const element=()=>({classList:{toggle(){}},setAttribute(){},dataset:{},addEventListener(){},innerHTML:'',remove(){}});
  const body={appendChild(el){if(el.id)els.set(el.id,el)}};
  const document={currentScript:{src:'https://fixture.invalid/wizard-os-home/core/web-update.js'},body,hidden:false,
    querySelector:()=>null,getElementById:id=>els.get(id),createElement:element,addEventListener(){},querySelectorAll:()=>[]};
  const window={WizAppServices:s.host,WizAppCapture:{reconcileReload:()=>c.reconcileReload()},WizAppReadingPosition:{flush(){}}};
  vm.runInNewContext(read('web-update'),{window,document,URL,location:{href:'https://fixture.invalid/wizard-os-home/',reload(){reloads++}},navigator:{onLine:true},fetch:async()=>({ok:true,text:async()=> 'a'.repeat(40),json:async()=>({updates:[]})}),setTimeout:(fn,ms)=>{timers.push([fn,ms]);return timers.length},clearTimeout(){},setInterval(){},clearInterval(){},addEventListener(){}});
  window.WizWebUpdate.init({shell:'phone',mount:()=>body,busy:()=>false,toast:(...a)=>toasts.push(a),log(){}});
  return {web:window.WizWebUpdate,timers,toasts,get reloads(){return reloads}};
}
const tick=async()=>{for(let i=0;i<40;i++)await Promise.resolve()};
test('memory-only audio blocks Reload until its app acknowledges handoff',()=>{const c=capture({memoryTakes:new Map([['synthetic',{}]])});assert.equal(c.reloadCheck().safe,false);c.memoryTakes.clear();assert.equal(c.reloadCheck().safe,true);});
const retained=()=>Object.freeze({id:'synthetic-retained',appId:'synthetic',native:'device',nativeId:'synthetic-take',kind:'audio',status:'recoverable',bytes:32000,meta:Object.freeze({synthetic:true})});
for(const mode of ['native_claim_pending','unloaded','native_owner_uncertain','recoverable_row'])test(`page-independent ${mode} allows check, reconciliation and the actual Reload tap without mutating custody`,async()=>{
  const row=retained(),map=new Map([[row.id,row]]),before=JSON.stringify([...map]);let recoveries=0;
  const c=capture({ownedRows:map,recover:async()=>{recoveries++},
    ...(mode==='native_claim_pending'?{recoveryError:{code:'native_claim_pending'}}:{}),
    ...(mode==='unloaded'?{ownershipLoaded:false}:{}),
    ...(mode==='native_owner_uncertain'?{unknownMeetingActive:true}:{})});
  const check=c.reloadCheck();assert.equal(check.safe,true);assert.equal(check.reason,null);assert.equal(check.keeps,null);
  assert.equal(check.recheck,true);assert.equal(check.durable,false);assert.equal(check.uncertain,mode==='native_owner_uncertain'?'native_owner_uncertain':'capture_custody_uncertain');
  assert.equal((await c.reconcileReload()).safe,true);assert.equal(recoveries,1);
  const s=service(c),f=updater(c,s);assert.equal(s.plan().ok,true);
  f.web.reload('tap');await tick();const animation=f.timers.find(([,ms])=>ms===900);assert(animation);animation[0]();await tick();
  assert.equal(f.reloads,1);assert.equal(f.web.armed,false);assert.equal(f.toasts.length,0);
  assert.equal(map.size,1);assert.equal(map.get(row.id),row);assert.equal(JSON.stringify([...map]),before);
});
for(const [name,patch,reason] of [
  ['active take',{active:{row:{id:'live'},phase:'recording',engine:{}}},'capture_custody_uncertain'],
  ['preparation',{preparations:new Map([['synthetic-warm',{}]])},'capture_starting'],
  // Android's meeting port survives reload and the lease only reads phone storage (James, 6 Nov 2026).
  ['recovery lease (no Android meeting port)',{recoveryLease:{},W:{}},'capture_custody_uncertain'],
  ['attached in-page meeting bridge',{attachedMeetingBridge:{}},'capture_custody_uncertain'],
  ['Mac meeting bridge',{W:{wizardNative:{meetings:{}}}},'capture_custody_uncertain'],
  ['configured in-page native engine',{configuredNative:{}},'capture_custody_uncertain'],
])test(`${name} preserves fail-closed uncertainty`,()=>{
  const c=capture({recoveryError:{code:'native_claim_pending'},...patch});
  const check=c.reloadCheck();assert.equal(check.safe,false);assert.equal(check.reason,reason);assert.equal(service(c).plan().ok,false);
});
test('native uncertainty is still unsafe on desktop/in-page bridges',()=>{
  for(const patch of [{attachedMeetingBridge:{}},{configuredNative:{}},{W:{wizardNative:{meetings:{}}}}]) {
    const check=capture({unknownMeetingActive:true,...patch}).reloadCheck();assert.equal(check.safe,false);assert.equal(check.reason,'native_owner_uncertain');
  }
});
test('device_recording and non-surviving live capture rules are never bypassed by uncertainty',()=>{
  for(const raw of ['{"id":"synthetic-device-take"}','{broken']) {
    const c=capture({recoveryError:{code:'native_claim_pending'},W:{WizardOSDevice:{recActive:()=>raw}}});
    assert.equal(c.reloadCheck().safe,false);assert.equal(c.reloadCheck().reason,'device_recording');
  }
  const row={id:'synthetic-live',native:'device',nativeId:'synthetic-device',status:'recording'};
  const c=capture({recoveryError:{code:'native_claim_pending'},ownedRows:new Map([[row.id,row]]),recoveryLive:new Set([row.id])});
  assert.equal(c.reloadCheck().safe,false);assert.equal(c.reloadCheck().reason,'capture');
});
test('surviving Android meeting keeps its existing identity even beside uncertain stored custody',()=>{
  const row={id:'synthetic-live',appId:'synthetic',kind:'meeting',native:'wizard-meetings',nativeId:'synthetic-meeting',status:'recoverable'};
  const c=capture({recoveryError:{code:'native_claim_pending'},ownedRows:new Map([[row.id,row]]),recoveryLive:new Set([row.id])});
  const check=c.reloadCheck();assert.equal(check.safe,true);assert.equal(check.keeps.id,row.id);assert.equal(check.keeps.meetingId,row.nativeId);assert.equal(check.durable,false);
});
test('frame-owned unsaved work still blocks the Reload tap when this page holds no audio',async()=>{
  const row=retained(),c=capture({ownedRows:new Map([[row.id,row]]),recoveryError:{code:'native_claim_pending'}}),s=service(c);
  const hold=s.facade.update.hold('Synthetic unsaved notes'),f=updater(c,s);
  assert.equal(c.reloadCheck().safe,true);assert.equal(s.plan().ok,false);
  f.web.reload('tap');await tick();for(const [fn,ms] of f.timers)if(ms===900)fn();await tick();
  assert.equal(f.reloads,0);assert.equal(s.host.inspect()[0].holds.length,1);assert.equal(c.ownedRows.get(row.id),row);
  hold.release();assert.equal(s.plan().ok,true);
});
