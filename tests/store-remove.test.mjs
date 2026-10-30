// Store "Remove app": the exact-identity request, its outcomes and the confirmation contents. Fixture fetches only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {removalPlan, removeInstalledApp, canRemove, confirmView} from '../web/store/store-remove.js';
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
