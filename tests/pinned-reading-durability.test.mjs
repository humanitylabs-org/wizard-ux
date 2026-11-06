// Generic: the app declares home_screen {offline, position_keys, route_state}; the shell names no app.
// Browser-free source-level regression. The fake distinguishes committed strict
// disk from volatile storage; it is NOT a browser or native power-loss proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=process.env.UX_SOURCE_ROOT||new URL('..',import.meta.url).pathname;
const read=n=>readFileSync(resolve(root,'web/core',n),'utf8');
const DECL={offline:true,position_keys:['wisdom:*:pos:*'],route_state:'wisdom'};
const origin='https://box.test',slot='wos.single.v1:'+JSON.stringify([origin,'wisdom']),pos='wisdom:/wisdom/:pos:chapter';
const route=hash=>({v:1,base:'/wisdom/',href:origin+'/wisdom/'+hash,at:1,state:null});
const latest=()=>({v:1,revision:8,route:route('#/read/chapter/collection'),positions:{[pos]:0.2857142857142857}});
const turn=()=>new Promise(r=>setImmediate(r));
async function settle(){for(let i=0;i<25;i++)await turn()}
function diskIDB({strict=true,fail=false,blocked=false}={}){
 const data=new Map(),writes=[],opened=[];let commits=0;
 const clone=v=>v===undefined?v:structuredClone(v);
 return {data,writes,opened,get commits(){return commits},open(name){
  opened.push(name);const req={};setImmediate(()=>{
   if(blocked){req.onblocked?.();return}
   req.result={createObjectStore(){},transaction(store,mode,opts){
    const tx={durability:strict?(opts?.durability||'default'):'default'},pending=new Map();let tasks=0,ended=false;
    const finish=()=>setImmediate(()=>{if(ended||tasks)return;ended=true;if(mode==='readwrite'&&fail){tx.error=Error('quota');tx.onabort?.();return}for(const [k,v] of pending)data.set(k,v);if(mode==='readwrite'){commits++;writes.push({opts,store,pending:clone([...pending])})}tx.oncomplete?.()});
    tx.abort=()=>{if(ended)return;ended=true;setImmediate(()=>tx.onabort?.())};
    tx.objectStore=()=>({get(k){const r={};tasks++;setImmediate(()=>{if(ended)return;r.result=clone(pending.has(k)?pending.get(k):data.get(k));r.onsuccess?.();tasks--;finish()});return r},put(v,k){pending.set(k,clone(v));finish();return {}}});
    finish();return tx;
   }};req.onsuccess?.();
  });return req;
 }};
}
function storage(){const s={};Object.defineProperties(s,{getItem:{configurable:true,value:k=>Object.hasOwn(s,k)?s[k]:null},setItem:{configurable:true,value:(k,v)=>{s[k]=String(v)}},removeItem:{configurable:true,value:k=>{delete s[k]}}});return s}
function boot(db,{app='wisdom',ls=storage(),decl=DECL}={}){
 const window={};const document={documentElement:{setAttribute(){}},querySelectorAll:()=>[]};
 const ctx=vm.createContext({window,document,indexedDB:db,location:{origin,href:origin+'/wizard-os-home/?app-session='+app,search:'?app-session='+app},URL,URLSearchParams,localStorage:ls,structuredClone,Promise,console});
 vm.runInContext(read('offline-kit.js'),ctx);window.WizOffline=ctx.WizOffline;
 vm.runInContext(read('home-screen-capabilities.js'),ctx);window.WizHomeScreenCapabilities=ctx.WizHomeScreenCapabilities;
 vm.runInContext(read('home-screen-policy.js'),ctx);if(decl)window.WizHomeScreenPolicy.configure(decl);
 return {ctx,window,policy:window.WizHomeScreenPolicy,ls,kit:ctx.WizOffline};
}
function presentation(db,opts={}){const b=boot(db);return b.kit.presentation({prefix:'wisdom-',slot,initial:()=>({route:null,positions:{}}),...opts})}

test('stale localStorage loses old restoration but authoritative committed IDB restores exact route and fraction',async()=>{
 const db=diskIDB();db.data.set('presentation:'+slot,latest());
 const ls=storage();ls.setItem(slot,JSON.stringify(route('#/collection/collection')));ls.setItem(slot+':presentation:'+pos,'0.07142857142857142');
 const b=boot(db,{ls});await b.policy.preparePresentation?.();
 const f={location:{origin},localStorage:ls,document:{}};b.policy.installPresentationStorage(f);
 const restored=b.policy.presentationRoute?.()??JSON.parse(ls.getItem(slot));
 assert.equal(restored.href,latest().route.href,'exact reader route must come from IDB, not stale collection cache');
 assert.equal(f.localStorage.getItem(pos),String(latest().positions[pos]),'exact fraction must not round through server progress');
 assert.equal(db.commits,0,'hydration never overwrites the recovered journal');
});
test('stale localStorage fraction cannot replace the last exact committed reader fraction',async()=>{
 const db=diskIDB();db.data.set('presentation:'+slot,latest());const ls=storage();ls.setItem(slot+':presentation:'+pos,'0.07142857142857142');
 const b=boot(db,{ls});await b.policy.preparePresentation?.();const f={location:{origin},localStorage:ls,document:{}};b.policy.installPresentationStorage(f);
 assert.equal(f.localStorage.getItem(pos),'0.2857142857142857','exact fraction must come from committed IDB rather than stale localStorage');
});
test('strict completion atomically journals route plus exact fraction; old cache cannot win next boot',async()=>{
 const db=diskIDB(),p=presentation(db);await p.ready;
 const a=p.commit({route:latest().route}),b=p.commit({positions:{[pos]:latest().positions[pos]}});
 assert.equal(db.commits,0,'request initiation is not durable completion');await Promise.all([a,b]);
 const value=db.data.get('presentation:'+slot);assert.equal(value.revision,2);assert.equal(value.route.href,latest().route.href);assert.equal(value.positions[pos],latest().positions[pos]);
 assert(db.writes.every(x=>x.opts.durability==='strict'&&x.store==='meta'));assert(db.opened.every(x=>x==='wisdom-offline-v1'),'reuse existing replica only');
 const q=presentation(db,{initial:()=>{throw Error('stale LS initializer must not run')}});assert.equal((await q.ready).positions[pos],latest().positions[pos]);
});
test('late boot cannot accept a pre-ready write or overwrite committed state',async()=>{
 const db=diskIDB();db.data.set('presentation:'+slot,latest());const p=presentation(db);
 await assert.rejects(p.commit({route:route('#/collection/stale')}),/not ready/);
 await p.ready;await p.commit({positions:{[pos]:0.5}});assert.equal(db.data.get('presentation:'+slot).route.href,latest().route.href);
});
test('serial snapshots and cross-instance stale revision guard refuse an older writer',async()=>{
 const db=diskIDB(),a=presentation(db),b=presentation(db);await Promise.all([a.ready,b.ready]);
 await a.commit({route:latest().route});await assert.rejects(b.commit({route:route('#/collection/stale')}),/Storage unavailable/);
 assert.equal(db.data.get('presentation:'+slot).route.href,latest().route.href);
});
test('unsupported strict durability refuses saved completion and reports quietly',async()=>{
 const db=diskIDB({strict:false});let failures=0;const p=presentation(db,{onFailure:()=>failures++});await p.ready;
 await assert.rejects(p.commit({route:latest().route}),/Crash-durable storage unavailable/);assert.equal(db.data.size,0);assert.equal(failures,1);
 await assert.rejects(p.commit({route:latest().route}),/not ready/);
});
test('aborted transaction retains previous journal; failure stays latched',async()=>{
 const db=diskIDB({fail:true});db.data.set('presentation:'+slot,latest());let failure;
 const p=presentation(db,{onFailure:e=>{failure=e}});await p.ready;await assert.rejects(p.commit({positions:{[pos]:0.5}}),/quota/);
 assert.equal(db.data.get('presentation:'+slot).positions[pos],latest().positions[pos]);assert(failure);
});
test('blocked hydration is explicit failure, never an invented ready state',async()=>{
 const p=presentation(diskIDB({blocked:true}));await assert.rejects(p.ready,/Storage blocked/);await assert.rejects(p.commit({route:latest().route}),/not ready/);
});
test('facade preserves app-owned content and normal desk positions; journal owns scoped removal',async()=>{
 const db=diskIDB(),b=boot(db);b.ls.setItem(pos,'0.8');b.ls.setItem('theme','dark');await b.policy.preparePresentation();
 const f={location:{origin},localStorage:b.ls,document:{}};b.policy.installPresentationStorage(f);
 f.localStorage.setItem(pos,String(latest().positions[pos]));f.localStorage.setItem('theme','light');await settle();
 assert.equal(b.ls.getItem(pos),'0.8');assert.equal(b.ls.getItem('theme'),'light');assert.equal(db.data.get('presentation:'+slot).positions[pos],latest().positions[pos]);
 f.localStorage.removeItem(pos);await settle();assert.equal(f.localStorage.getItem(pos),null);assert(!Object.hasOwn(db.data.get('presentation:'+slot).positions,pos));
});
test('an app that did not declare offline never opens a durability database or re-homes keys',async()=>{
 for(const decl of [null,{position_keys:['wisdom:*:pos:*']},{offline:false,route_state:'wisdom'}]){
  const db=diskIDB(),b=boot(db,{app:'reference',decl});await b.policy.preparePresentation();assert.equal(db.opened.length,0);
 }
 // position_keys alone re-homes only the declared keys per pin, with no journal
 const db=diskIDB(),b=boot(db,{decl:{position_keys:['wisdom:*:pos:*']}});await b.policy.preparePresentation();assert.equal(db.opened.length,0);
 const f={location:{origin},localStorage:b.ls,document:{}};b.policy.installPresentationStorage(f);
 f.localStorage.setItem(pos,'0.4');f.localStorage.setItem('theme','dark');
 assert.equal(b.ls.getItem(pos),null,'declared position key must not touch the shared key');assert.equal(b.ls.getItem(slot+':presentation:'+pos),'0.4');assert.equal(b.ls.getItem('theme'),'dark');
});
test('a declaration naming another app\'s keys cannot widen: patterns need a literal prefix',()=>{
 const b=boot(diskIDB(),{decl:{offline:true,position_keys:['*','a*','xyz:*:pos:*']}});
 assert.deepEqual([...b.policy.capabilities.positionKeys],['xyz:*:pos:*']);
});
test('cold first mount awaits actual hydration, and a later mount cancels stale completion',async()=>{
 let release;const ready=new Promise(r=>{release=r});let mounted=0;
 const p={mode:true,id:'wisdom',key:()=>slot,configure:()=>({offline:true}),preparePresentation:()=>ready,within:()=>true,isShell:()=>false,displayName:()=> 'Wisdom'};
 const win={dataset:{},addEventListener(){},replaceChildren(){},appendChild(){mounted++},querySelector(){return null}};
 const document={addEventListener(){},documentElement:{setAttribute(){},style:{setProperty(){}}},getElementById:()=>({classList:{add(){}},appendChild(){}}),createElement:tag=>tag==='article'?win:{dataset:{},setAttribute(){},addEventListener(){}},querySelector:()=>null};
 const w={WizHomeScreenPolicy:p,WizCore:{apps:()=>({APP:{wisdom:{kind:'wizard',url:'/wisdom/'}},APPS:[]}),appsLoaded:()=>Promise.resolve()},WizAppServices:{attach:()=>()=>{},guardBack(){}},WizardOSNative:{immersive(){}}};
 const events={};
 const ctx=vm.createContext({window:w,document,localStorage:storage(),location:{origin},URL,addEventListener(name,fn){events[name]=fn},setInterval(){},setTimeout(){}});
 vm.runInContext(read('single-app-session.js'),ctx);await settle();assert.equal(mounted,0,'no app script may mount before authoritative state');
 const later=events['wizard:apps']();assert.equal(mounted,0,'replacement mount also waits for hydration');
 release();await later;await settle();assert.equal(mounted,1,'only current mount generation can create the child');
});
test('registry withdrawal immediately revokes old position, route and journal authority in an existing frame',async()=>{
 const db=diskIDB(),b=boot(db);await b.policy.preparePresentation();
 const f={location:{origin},localStorage:b.ls,document:{}};b.policy.installPresentationStorage(f);
 f.localStorage.setItem(pos,'0.4');await settle();const commits=db.commits;
 b.policy.configure(null);assert.equal(b.policy.capabilities,null);assert.equal(b.policy.presentationRoute(),undefined);
 f.localStorage.setItem(pos,'0.9');b.policy.savePresentationRoute(route('#/withdrawn'));await b.policy.preparePresentation();await settle();
 assert.equal(b.ls.getItem(pos),'0.9','withdrawn keys return to shared app storage without remounting the facade');
 assert.equal(db.commits,commits,'withdrawal must stop later writes to the old journal');
 b.policy.configure({position_keys:['reader:*'],route_state:'reader'});
 assert.equal(b.policy.capabilities.routeState,'reader');
 f.localStorage.setItem('reader:position','0.2');assert.equal(b.ls.getItem('reader:position'),null);
 assert.equal(b.ls.getItem(slot+':presentation:reader:position'),'0.2');
 f.localStorage.setItem(pos,'0.7');assert.equal(b.ls.getItem(pos),'0.7','old matcher cannot survive a replacement declaration');
 await b.policy.preparePresentation();assert.equal(db.commits,commits,'position-only declaration opens no offline journal');
});
test('unchanged declarations preserve hydration; late revoked hydration cannot poison the current declaration',async()=>{
 const b=boot(diskIDB());let release,fail;const ready=new Promise(r=>{release=r});let creates=0;
 b.window.WizOffline={presentation:opts=>{creates++;fail=opts.onFailure;return{ready,snapshot:()=>({route:route('#/old'),positions:{}})}}};
 const old=b.policy.preparePresentation();b.policy.configure(DECL);
 assert.equal(b.policy.preparePresentation(),old);assert.equal(creates,1,'same registry must not restart hydration');
 b.policy.configure({position_keys:['reader:*'],route_state:'reader'});fail();release();
 assert.equal(await old,false,'a revoked hydration completion is not ready');assert.equal(b.policy.presentationFailed,false,'old failure must not latch on the new authority');
 assert.equal(b.policy.presentationRoute(),undefined);assert.equal(b.policy.capabilities.routeState,'reader');
});
