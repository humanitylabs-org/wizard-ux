// Store "Remove app": the exact-identity request, its outcomes and the confirmation contents. Fixture fetches only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {removalPlan, removeInstalledApp, canRemove, confirmView, forgetAppData, markRemoved, settleRemoved, pendingForgets, forgetRemoved, keptAppIds, sweepGone} from '../web/store/store-remove.js';
const A='a'.repeat(40), B='b'.repeat(40);
const base=new URL('https://box.example/wizard-os-home/');
const esc=s=>String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const plan={app:'ledger',name:'Ledger',installed:true,removable:true,protected:false,reason:'',identity:{repo:'example/ledger',commit:A,source:'standard'},dependents:[{id:'budget',name:'Budget'}],empties:[{slot:'bank-connection',name:'Bank connection'}],backups:2};
function server(script) {
 const calls=[];
 const fetchImpl=async(url,opts={})=>{calls.push({url:String(url),method:opts.method || 'GET',headers:opts.headers || {},body:opts.body});const r=script(calls.at(-1),calls.length);return r instanceof Response?r:Response.json(r.body ?? {},{status:r.status ?? 200});};
 return {calls,fetchImpl};
}

test('the plan is read from the Store listener for exactly that app id',async()=>{
 const s=server(()=>({body:plan}));
 assert.deepEqual(await removalPlan('ledger',{base,fetchImpl:s.fetchImpl}),plan);
 assert.equal(s.calls[0].url,'https://box.example/wizard-os-home/store-install/_remove/ledger/plan');
 assert.equal(s.calls[0].method,'GET');
 await assert.rejects(removalPlan('../etc',{base,fetchImpl:s.fetchImpl}),/app/);
 const old=server(()=>new Response('not found',{status:404}));
 await assert.rejects(removalPlan('ledger',{base,fetchImpl:old.fetchImpl}),/needs updating/);
});

test('one POST carries only the reviewed identity and consequences, then polls to a verified removal',async()=>{
 let polls=0;
 const s=server((c)=>c.method==='POST'?{status:202,body:{app:'ledger',state:'removing',identity:{repo:'example/ledger',commit:A}}}:(++polls<3?{body:{state:'removing',identity:{repo:'example/ledger',commit:A}}}:{body:{state:'removed',identity:{repo:'example/ledger',commit:A}}}));
 const job=await removeInstalledApp(plan,{base,fetchImpl:s.fetchImpl,wait:()=>Promise.resolve()});
 assert.equal(job.state,'removed');
 const post=s.calls.find(c=>c.method==='POST');
 assert.equal(post.url,'https://box.example/wizard-os-home/store-install/_remove/ledger');
 assert.equal(post.headers['X-Wizard-Store'],'1'); assert.equal(post.headers['Content-Type'],'application/json');
 assert.deepEqual(JSON.parse(post.body),{repo:'example/ledger',commit:A,dependents:['budget'],empties:['bank-connection']});
 assert.equal(s.calls.filter(c=>c.method==='POST').length,1);
});

test('refusals, failures, unknown outcomes and mismatched receipts never resolve as removed',async()=>{
 const cases=[
  [{status:409,body:{error:'Ledger changed since you opened it.'}},/changed since/,false],
  [{status:403,body:{error:'only the box owner can install from the Store'}},/box owner/,false],
  [{status:404,body:{}},/needs updating/,false],
  [{status:400,body:{error:'invalid installed identity'}},/invalid installed identity/,false],
 ];
 for(const [reply,message,unknown] of cases) {
  const s=server(()=>reply);
  await assert.rejects(removeInstalledApp(plan,{base,fetchImpl:s.fetchImpl,wait:()=>Promise.resolve()}),e=>message.test(e.message) && e.unknown===unknown);
 }
 for(const [final,message,unknown] of [[{state:'failed',error:'Not removed: busy. Ledger is still installed.'},/still installed/,false],[{state:'unknown',error:'Removing Ledger hasn’t finished yet. Refresh to check.'},/Refresh/,true],[{state:'removed',identity:{repo:'example/ledger',commit:B}},/different/,true]]) {
  const s=server(c=>c.method==='POST'?{status:202,body:{state:'removing',identity:{repo:'example/ledger',commit:A}}}:{body:{identity:{repo:'example/ledger',commit:A},...final}});
  await assert.rejects(removeInstalledApp(plan,{base,fetchImpl:s.fetchImpl,wait:()=>Promise.resolve()}),e=>message.test(e.message) && e.unknown===unknown);
 }
 // The job disappears (the App Manager restarted) or the network drops: unknown, never removed.
 for(const poll of [()=>new Response('{}',{status:404}),()=>{throw new TypeError('network');}]) {
  const s=server(c=>c.method==='POST'?{status:202,body:{state:'removing',identity:{repo:'example/ledger',commit:A}}}:poll());
  await assert.rejects(removeInstalledApp(plan,{base,fetchImpl:s.fetchImpl,wait:()=>Promise.resolve()}),e=>e.unknown===true && /Refresh/.test(e.message));
 }
 const s=server(()=>({}));
 await assert.rejects(removeInstalledApp({...plan,removable:false},{base,fetchImpl:s.fetchImpl}),/remove/); assert.equal(s.calls.length,0);
 await assert.rejects(removeInstalledApp({...plan,identity:{repo:'https://evil.example/x',commit:A}},{base,fetchImpl:s.fetchImpl})); assert.equal(s.calls.length,0);
 // An identity without the exact installed commit is never sent.
 for(const commit of ['','abc',undefined]) await assert.rejects(removeInstalledApp({...plan,identity:{repo:'example/ledger',commit}},{base,fetchImpl:s.fetchImpl}),/identity/);
 assert.equal(s.calls.length,0);
});

test('Remove is offered only for an exact App Manager install that is not part of Wizard',()=>{
 const i={id:'ledger',repo:'example/ledger',commit:A,source:'standard'};
 assert.equal(canRemove(i,true),true);
 for(const [inst,complete] of [[i,false],[{...i,system:true},true],[{...i,conflict:true},true],[{id:'calendar',status:'running'},true],[{id:'',status:'running'},true],[null,true],[{...i,id:'ledger-next',app_id:'ledger'},true],[{...i,commit:''},true],[{...i,commit:'abc'},true]]) assert.equal(canRemove(inst,complete),false,JSON.stringify(inst));
});

test('the confirmation names the app, the data it deletes and what else it affects',()=>{
 const html=confirmView(plan,{name:'Ledger',installed:{repo:'example/ledger',commit:A}},{esc});
 assert.match(html,/Remove Ledger\?/);
 assert.match(html,/Ledger and its app data on this Wizard will be deleted/);
 assert.doesNotMatch(html,/data it keeps/);
 assert.match(html,/Budget/); assert.match(html,/Bank connection/);
 assert.match(html,/2 earlier backups are kept/);
 assert.match(html,/data-remove-confirm/); assert.match(html,/data-back/);
 assert.doesNotMatch(html,/confirm\(|alert\(/);
 const plain=confirmView({...plan,dependents:[],empties:[],backups:null},{name:'Ledger',installed:{repo:'example/ledger',commit:A}},{esc});
 assert.doesNotMatch(plain,/backup/i); assert.doesNotMatch(plain,/Budget/);
 // Unknown/refused plans show why and offer no destructive button.
 for(const [p,reason] of [[{...plan,removable:false,reason:'Ledger is part of Wizard, so the Store doesn’t remove it.'},/part of Wizard/],[{...plan,identity:{...plan.identity,commit:B}},/changed since/],[{...plan,installed:false,removable:false,reason:'Ledger isn’t installed on this Wizard.'},/isn’t installed/]]) {
  const view=confirmView(p,{name:'Ledger',installed:{repo:'example/ledger',commit:A}},{esc});
  assert.match(view,reason); assert.doesNotMatch(view,/data-remove-confirm/);
 }
 assert.match(confirmView(null,{name:'Ledger'},{esc,loading:true}),/Checking/);
 assert.match(confirmView(null,{name:'Ledger'},{esc,error:'This Wizard’s App Manager needs updating before apps can be removed here.'}),/needs updating/);
 assert.match(confirmView(plan,{name:'Ledger',installed:{repo:'example/ledger',commit:A}},{esc,busy:true}),/Removing…/);
 assert.match(confirmView(plan,{name:'<b>x</b>',installed:{repo:'example/ledger',commit:A}},{esc}),/&lt;b&gt;x&lt;\/b&gt;/);
});

// wizard-os#133: after a confirmed removal the Store deletes this device's copy of the app's sandboxed-window data
// (core/browser-boundary.js appStorage + appIdb). Real-Chromium proof: tests/qa-browser-boundary-forget.cjs.
function fakeIdb({exists=true,stores=['dbs','rows'],failTx=false}={}) {
 const log={opened:0,created:false,deletes:[],closed:0};
 const later=fn=>queueMicrotask(fn);
 const db={objectStoreNames:stores,close(){log.closed++;},transaction(names,mode){
  const tx={oncomplete:null,onabort:null,onerror:null,error:failTx?new Error('quota'):null,objectStore:n=>({delete:r=>log.deletes.push([n,mode,r])})};
  log.tx=names; later(()=>failTx?tx.onabort?.():tx.oncomplete?.()); return tx;}};
 return {log,open(name){log.opened++;log.name=name;const r={result:null,error:null,transaction:{abort(){r.error={name:'AbortError'};later(()=>r.onerror?.());}}};
  later(()=>{if(!exists){log.created=true;r.onupgradeneeded?.();if(r.error)return;}r.result=db;r.onsuccess?.();});return r;}};
}
const keyRange={bound:(lo,hi,lo2,hi2)=>({lo,hi,lo2,hi2})};
function fakeStorage(seed){const m=new Map(Object.entries(seed));return {m,removeItem:k=>m.delete(k)};}

test('forgetAppData deletes exactly the removed app\'s saved settings and shell databases on this device',async()=>{
 const storage=fakeStorage({'wos.app-storage.v1.ledger':'{"a":"1"}','wos.app-storage.v1.ledger-two':'{"b":"2"}','wos.skin':'nebula'});
 const idb=fakeIdb();
 assert.equal(await forgetAppData('ledger',{storage,idb,keyRange}),true);
 assert.deepEqual([...storage.m.keys()].sort(),['wos.app-storage.v1.ledger-two','wos.skin']);
 assert.equal(idb.log.name,'wos-app-idb-v1');
 assert.deepEqual(idb.log.tx,['dbs','rows']);
 // [id] .. [id + '\0'] (upper bound open): every key that starts with this app id, never 'ledger-two'.
 assert.deepEqual(idb.log.deletes,[['dbs','readwrite',{lo:['ledger'],hi:['ledger\u0000'],lo2:false,hi2:true}],['rows','readwrite',{lo:['ledger'],hi:['ledger\u0000'],lo2:false,hi2:true}]]);
 assert.equal(idb.log.closed,1);
});

test('forgetAppData drops the removed app from the notes of databases its same-origin page opened (wizard-os#133)',async()=>{
 const m=new Map(Object.entries({'wos.app-idb-owners.v1':JSON.stringify({'trackhunt-offline-v1':{app:'ledger'},tasks:{app:'ledger'},'shared-db':{app:''},'notes-db':{app:'ledger-two'}})}));
 const storage={m,getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)};
 assert.equal(await forgetAppData('ledger',{storage,idb:fakeIdb(),keyRange}),true);
 assert.deepEqual(JSON.parse(m.get('wos.app-idb-owners.v1')),{'shared-db':{app:''},'notes-db':{app:'ledger-two'}},'a reinstall never gets the old databases copied over');
 assert.equal(await forgetAppData('ledger-two',{storage,idb:fakeIdb(),keyRange}),true);
 assert.deepEqual(JSON.parse(m.get('wos.app-idb-owners.v1')),{'shared-db':{app:''}});
});

test('forgetAppData never creates the shell database, refuses bad ids and reports a failed delete',async()=>{
 const none=fakeIdb({exists:false});
 assert.equal(await forgetAppData('ledger',{storage:fakeStorage({}),idb:none,keyRange}),true);
 assert.equal(none.log.created,true,'the open would have created it'); assert.deepEqual(none.log.deletes,[],'and it was aborted, nothing written');
 const s=fakeStorage({'wos.app-storage.v1.x':'1'}), idb=fakeIdb();
 for(const bad of ['', '../x', 'Ledger', null, 'a'.repeat(65)]) assert.equal(await forgetAppData(bad,{storage:s,idb,keyRange}),false);
 assert.equal(idb.log.opened,0); assert.equal(s.m.size,1);
 assert.equal(await forgetAppData('ledger',{storage:fakeStorage({}),idb:fakeIdb({failTx:true}),keyRange}),false);
 // Without IndexedDB (an old browser) the settings still go.
 const only=fakeStorage({'wos.app-storage.v1.ledger':'1'});
 assert.equal(await forgetAppData('ledger',{storage:only,idb:undefined,keyRange}),true); assert.equal(only.m.size,0);
});

function memStorage(){const m=new Map();return {m,getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)};}
test('the removed-apps note: marked before deleting, settled after, pending again after a failed delete, kept 30 days',async()=>{
 const storage=memStorage(), now=1_800_000_000_000, note=()=>JSON.parse(storage.getItem('wos.app-removed.v1'));
 storage.setItem('wos.app-storage.v1.ledger','{"a":"1"}');
 assert.equal(await forgetRemoved('ledger',{storage,now,idb:fakeIdb(),keyRange}),true);
 assert.deepEqual(note(),{ledger:{at:now}}); assert.equal(storage.getItem('wos.app-storage.v1.ledger'),null);
 assert.deepEqual(pendingForgets({storage,now}),[]);
 // Both tries fail: the note stays pending, so the Store tries again on its next load.
 const fail=fakeIdb({failTx:true});
 assert.equal(await forgetRemoved('cards',{storage,now:now+1,idb:fail,keyRange}),false);
 assert.equal(fail.log.opened,2,'one more try');
 assert.deepEqual(pendingForgets({storage,now:now+2}),['cards']);
 // A retry never moves `at` (the windows opened since are not blocked by an old removal).
 assert.equal(await forgetRemoved('cards',{retry:true,storage,now:now+50,idb:fakeIdb(),keyRange}),true);
 assert.deepEqual(note().cards,{at:now+1}); assert.deepEqual(pendingForgets({storage,now:now+51}),[]);
 // Old notes and junk drop out; bad ids are refused.
 storage.setItem('wos.app-removed.v1',JSON.stringify({ledger:{at:now},'Bad Id':{at:now},x:{at:'soon'}}));
 assert.equal(markRemoved('fresh',{storage,now:now+31*864e5}),true);
 assert.deepEqual(note(),{fresh:{at:now+31*864e5,pending:true}});
 assert.equal(markRemoved('../x',{storage,now}),false); assert.equal(settleRemoved('nope',{storage,now}),false);
});


// wizard-os#133 slice 42: an app removed some other way (the agent, the box command, another device's Store). The
// shell's app list (core/apps.js) hands each fresh list to sweepGone. Real-Chromium proof: tests/qa-browser-boundary-sweep.cjs.
function listStorage(seed={}){const s=memStorage();for(const [k,v] of Object.entries(seed))s.m.set(k,v);s.key=i=>[...s.m.keys()][i]??null;Object.defineProperty(s,'length',{get:()=>s.m.size});return s;}
// fakeIdb plus a read-only `dbs` store whose keys are [app, database name].
function sweepIdb(dbKeys=[]){
 const i=fakeIdb(), open=i.open;
 i.open=name=>{const r=open(name);let fn=null;
  Object.defineProperty(r,'onsuccess',{set:v=>{fn=v;},get:()=>fn&&(()=>{const db=r.result,tx=db.transaction;
   db.transaction=(names,mode)=>mode!=='readonly'?tx.call(db,names,mode):{objectStore:()=>({getAllKeys(){const q={result:dbKeys,onsuccess:null};queueMicrotask(()=>q.onsuccess?.());return q;}})};
   fn();})});
  return r;};
 return i;}
test('keptAppIds lists the apps this device keeps shell data for, from saved settings and the shell databases',async()=>{
 const storage=listStorage({'wos.app-storage.v1.ledger':'{}','wos.app-storage.v1.Bad Id':'{}','wos.skin':'x'});
 assert.deepEqual([...await keptAppIds({storage,idb:sweepIdb([['music','clips'],['music','x'],['files','frames'],['../x','y']])})].sort(),['files','ledger','music']);
 const none=fakeIdb({exists:false});
 assert.deepEqual([...await keptAppIds({storage:listStorage(),idb:none})],[]); assert.deepEqual(none.log.deletes,[],'never creates the shell database');
});
test('sweepGone: an app missing from the box list loses its data here only after 2 reads at least a day apart',async()=>{
 const now=1_800_000_000_000, day=864e5, gone=s=>JSON.parse(s.getItem('wos.app-gone.v1')||'null');
 const storage=listStorage({'wos.app-storage.v1.ledger':'{\"a\":\"1\"}','wos.app-storage.v1.cards':'{}'});
 const idb=()=>sweepIdb([['music','clips']]);
 // First miss: noted, nothing deleted.
 assert.deepEqual(await sweepGone(['cards','notes'],{storage,now,idb:idb(),keyRange}),[]);
 assert.deepEqual(gone(storage),{ledger:{at:now,reads:1},music:{at:now,reads:1}});
 assert.ok(storage.getItem('wos.app-storage.v1.ledger'));
 // Missed again within the day: still kept.
 assert.deepEqual(await sweepGone(['cards'],{storage,now:now+day-1,idb:idb(),keyRange}),[]);
 assert.deepEqual(gone(storage).ledger,{at:now,reads:2});
 // Music is back in a list: its note goes, its data stays.
 assert.deepEqual(await sweepGone(['cards','music'],{storage,now:now+day-1,idb:idb(),keyRange}),[]);
 assert.deepEqual(Object.keys(gone(storage)),['ledger']);
 // A day after the first miss and still gone: deleted, marked removed (old windows stop writing), note dropped.
 const i=idb();
 assert.deepEqual(await sweepGone(['cards'],{storage,now:now+day,idb:i,keyRange}),['ledger']);
 assert.equal(storage.getItem('wos.app-storage.v1.ledger'),null); assert.ok(storage.getItem('wos.app-storage.v1.cards'));
 assert.ok(i.log.deletes.some(([n,,r])=>n==='rows'&&r.lo[0]==='ledger'));
 assert.deepEqual(JSON.parse(storage.getItem('wos.app-removed.v1')),{ledger:{at:now+day}});
 assert.deepEqual(gone(storage),{music:{at:now+day,reads:1}},'music, gone from this list, starts its own wait');
});
test('sweepGone: an empty list deletes nothing; an app the Store removed here goes at once once it is gone',async()=>{
 const now=1_800_000_000_000;
 const storage=listStorage({'wos.app-storage.v1.ledger':'1'});
 assert.deepEqual(await sweepGone([],{storage,now,idb:sweepIdb(),keyRange}),[]);
 assert.equal(storage.getItem('wos.app-gone.v1'),null); assert.equal(storage.getItem('wos.app-storage.v1.ledger'),'1');
 // The Store removed cards here but its delete failed (pending): the next read without it deletes it at once.
 markRemoved('cards',{storage,now}); storage.setItem('wos.app-storage.v1.cards','1');
 assert.deepEqual(await sweepGone(['ledger'],{storage,now:now+2,idb:sweepIdb(),keyRange}),['cards']);
 assert.equal(storage.getItem('wos.app-storage.v1.cards'),null);
 assert.deepEqual(JSON.parse(storage.getItem('wos.app-removed.v1')),{cards:{at:now}},'a retry keeps the first removal time');
 assert.equal(storage.getItem('wos.app-gone.v1'),null);
 // Same, but the app is listed again first (reinstalled): the pending removal is over, so a later miss of the
 // reinstalled app waits the day like any other.
 markRemoved('notes',{storage,now:now+3}); storage.setItem('wos.app-storage.v1.notes','new');
 assert.deepEqual(await sweepGone(['notes','ledger'],{storage,now:now+4,idb:sweepIdb(),keyRange}),[]);
 assert.deepEqual(pendingForgets({storage,now:now+5}),[]);
 assert.deepEqual(await sweepGone(['ledger'],{storage,now:now+5,idb:sweepIdb(),keyRange}),[]);
 assert.equal(storage.getItem('wos.app-storage.v1.notes'),'new');
 assert.deepEqual(JSON.parse(storage.getItem('wos.app-gone.v1')),{notes:{at:now+5,reads:1}});
});
