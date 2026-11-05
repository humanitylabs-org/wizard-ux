// Synthetic page-memory/IndexedDB separation; never reads owner storage or audio.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const read = n => readFileSync(n==='web-update' && process.env.QA_RELOAD_UPDATE ? process.env.QA_RELOAD_UPDATE : new URL(`../web/core/${n}.js`, import.meta.url), 'utf8');
const tick = async () => { for (let i=0;i<60;i++) await Promise.resolve(); };
function fixture(patch={}) {
  const code=read('app-capture'); let checks=0, releases=0, reloads=0, now=0;
  const lease={cancelled:false,unlock(){releases++}};
  const c={active:null,preparations:new Map(),memoryTakes:new Map(),recoveryLease:lease,
    attachedMeetingBridge:null,configuredNative:null,W:{},ownedRows:new Map(),recoveryLive:new Set(),ownershipLoaded:false,
    recoveryError:null,unknownMeetingActive:false,ready:new Promise(()=>{}),recover:async()=>{},...patch};
  const start=code.indexOf('  function pageAudioFree()');
  assert(start>=0,'page-memory proof must exist');
  vm.runInNewContext(code.slice(code.indexOf('  function yieldRecovery()'),code.indexOf('  async function recoverLocked('))+code.slice(start,code.indexOf('  // Last moment before the shell reloads',start)),c);
  const source={location:new URL('https://synthetic.invalid/messenger/'),document:{},addEventListener(){},postMessage(){}};
  const frame={tagName:'IFRAME',src:source.location.href,isConnected:true,contentWindow:source,hasAttribute:()=>false,addEventListener(){},removeEventListener(){}};
  const window={WizCore:{apps:()=>({APPS:[{id:'messenger',name:'Messenger',kind:'wizard',url:'/messenger/'}]})},
    WizAppCapture:{reloadCheck:()=>c.reloadCheck(),pageAudioFree:()=>c.pageAudioFree(),cancelReloadRecovery:()=>c.cancelReloadRecovery(),
      reconcileReload:()=>{checks++;return c.reconcileReload()}},dispatchEvent(){},WizAppReadingPosition:{attach(){},flush(){}}};
  vm.runInNewContext(read('app-services'),{window,location:new URL('https://synthetic.invalid/wizard-os-home/'),URL,crypto:{randomUUID},addEventListener(){},setInterval(){},setTimeout,clearTimeout,document:{readyState:'loading',addEventListener(){}},CustomEvent:class{},navigator:{}});
  window.WizAppServices.attach(frame,{appId:'messenger',path:'/messenger/'});
  const facade=window.WizAppServices.connect(source,{}), timers=[],toasts=[];
  const element=()=>({classList:{toggle(){}},setAttribute(){},dataset:{},addEventListener(){},remove(){}});
  const document={currentScript:{src:'https://synthetic.invalid/wizard-os-home/core/web-update.js'},body:{appendChild(){}},querySelector:()=>null,getElementById:()=>null,createElement:element,addEventListener(){},querySelectorAll:()=>[]};
  const f={c,window,facade,timers,toasts,busy:false,lease,get checks(){return checks},get releases(){return releases},get reloads(){return reloads},get now(){return now}};
  vm.runInNewContext(read('web-update'),{window,document,URL,location:{href:'https://synthetic.invalid/wizard-os-home/',reload(){reloads++}},navigator:{onLine:true},setTimeout:(fn,ms)=>{const t={fn,ms,at:now+ms,live:true};timers.push(t);return t},clearTimeout:t=>{if(t)t.live=false},setInterval(){},clearInterval(){},addEventListener(){}});
  f.web=window.WizWebUpdate;f.web.init({busy:()=>f.busy,toast:(...a)=>toasts.push(a),beforeReload:()=>f.beforeReload?.()});
  f.fire=async ms=>{const t=timers.find(t=>t.live&&t.ms===ms);assert(t,`timer ${ms}`);t.live=false;now=t.at;t.fn();await tick()};
  return f;
}
test('hung recovery with no page audio reloads in 900ms without starting another check; cancels lease',async()=>{
  const f=fixture();assert(f.c.pageAudioFree());assert.equal(f.c.reloadCheck().safe,false);
  assert.equal(f.web.reload('tap'),true);assert.equal(f.web.reloadStatus().checking,false);assert.equal(f.checks,0);
  await f.fire(900);assert.equal(f.reloads,1);assert.equal(f.now,900);assert(f.lease.cancelled);assert.equal(f.releases,1);assert.equal(f.c.recoveryLease,null);
});
test('go final commit accepts uncertainty with no page audio, even after synchronous host persistence',async()=>{
  const f=fixture();let persisted=false;f.beforeReload=()=>{persisted=true;f.c.recoveryError=Error('synthetic store unavailable')};
  f.web.reload('tap');await f.fire(900);assert(persisted);assert.equal(f.reloads,1);assert.equal(f.toasts.length,0);
});
for(const [name,patch] of [
  ['unacknowledged memory take',{memoryTakes:new Map([['take',{session:{row:{id:'take',appId:'messenger'}}}]])}],
  ['active browser recorder',{active:{row:{id:'take',appId:'messenger'},engine:{},phase:'recording'}}],
  ['capture preparation',{preparations:new Map([['warm',{}]])}],
  ['attached meeting bridge',{attachedMeetingBridge:{}}],
  ['Mac in-page meeting bridge',{W:{wizardNative:{meetings:{}}}}],
  ['configured native engine',{configuredNative:{}}],
  ['live device recorder',{W:{WizardOSDevice:{recActive:()=>'{"id":"take"}'}}}],
  ['malformed device response',{W:{WizardOSDevice:{recActive:()=>'{broken'}}}],
  ['throwing device response',{W:{WizardOSDevice:{recActive(){throw Error('synthetic')}}}}],
])test(`hung recovery never waives ${name}`,async()=>{
  const f=fixture(patch);assert.equal(f.c.pageAudioFree(),false);f.web.reload('tap');await tick();
  if(f.web.reloadStatus().checking)await f.fire(4500);
  for(const t of f.timers.filter(t=>t.ms===900))t.fn();await tick();
  assert.equal(f.reloads,0);assert(f.web.reloadStatus().reason);assert.equal(f.lease.cancelled,false);assert.equal(f.releases,0);
});
for(const reason of ['unsent draft','recording upload','capture_custody_uncertain'])test(`Messenger frame hold is never waived: ${reason}`,async()=>{
  const f=fixture(),hold=f.facade.update.hold(reason);assert(f.c.pageAudioFree());f.web.reload('tap');await tick();await f.fire(4500);
  assert.equal(f.reloads,0);assert(f.web.reloadStatus().reason);assert.equal(f.window.WizAppServices.update.reloadPlan().blocking.at(-1).source,'frame');
  hold.release();f.web.reload('tap');await f.fire(900);assert.equal(f.reloads,1);
});
for(const boundary of ['animation','persistence'])test(`new memory audio at ${boundary} aborts Reload`,async()=>{
  const f=fixture(),start=()=>f.c.memoryTakes.set('new',{session:{row:{id:'new',appId:'messenger'}}});
  f.web.reload('tap');if(boundary==='animation')start();else f.beforeReload=start;
  await f.fire(900);assert.equal(f.reloads,0);assert.match(f.toasts.at(-1)[1],/Reload paused/);assert.equal(f.lease.cancelled,false);
});
for(const result of ['timeout','reject','uncertain'])test(`recheck ${result} proceeds if page becomes audio-free`,async()=>{
  const f=fixture({attachedMeetingBridge:{}});
  if(result!=='timeout')f.window.WizAppCapture.reconcileReload=async()=>{f.c.attachedMeetingBridge=null;if(result==='reject')throw Error('synthetic');return {safe:false}};
  f.web.reload('tap');await tick();
  if(result==='timeout'){f.c.attachedMeetingBridge=null;await f.fire(4500)}
  await f.fire(900);assert.equal(f.reloads,1);assert(f.lease.cancelled);
});
test('host busy still blocks audio-free Reload',()=>{const f=fixture();f.busy=true;f.web.reload('tap');assert.equal(f.reloads,0);assert.equal(f.checks,0);assert.match(f.web.reloadStatus().reason,/sending audio|saving/)});
test('healthy durable path still reloads exactly once without recovery wait',async()=>{
  const f=fixture({recoveryLease:null,ownershipLoaded:true});f.web.reload('tap');await f.fire(900);assert.equal(f.reloads,1);assert.equal(f.checks,0);assert.equal(f.releases,0);
});
test('host-only page proof and recovery cancellation are not in app RPC facade',()=>{const f=fixture();assert.equal(f.facade.capture.pageAudioFree,undefined);assert.equal(f.facade.capture.cancelReloadRecovery,undefined)});
test('audio-free recovery uncertainty is not advertised as a Reload blocker',async()=>{
  const f=fixture();assert.equal(f.web.plan().ok,false);
  assert.equal(f.web.reloadStatus().reason,'');
  assert.equal(f.web.busy(),false);assert.equal(f.window.WizAppUpdates.busy(),false);
  f.web.reload('tap');assert.equal(f.web.reloadStatus().going,true);
  assert.equal(f.web.reloadStatus().reason,'');
  await f.fire(900);assert.equal(f.reloads,1);
});
test('status and busy keep app holds, host work and new page audio blocking',()=>{
  const f=fixture(),hold=f.facade.update.hold('synthetic unsent draft');
  assert.equal(f.web.busy(),true);assert.notEqual(f.web.reloadStatus().reason,'');
  hold.release();assert.equal(f.web.busy(),false);assert.equal(f.web.reloadStatus().reason,'');
  f.busy=true;assert.equal(f.web.busy(),true);assert.match(f.web.reloadStatus().reason,/sending audio|saving/);
  f.busy=false;f.c.memoryTakes.set('new',{session:{row:{id:'new',appId:'messenger'}}});
  assert.equal(f.web.busy(),true);assert.notEqual(f.web.reloadStatus().reason,'');
});
