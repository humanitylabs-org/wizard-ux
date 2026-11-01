import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {randomUUID,webcrypto} from 'node:crypto';
import {IDBFactory} from 'fake-indexeddb';
const source=readFileSync(new URL('../web/core/app-state.js',import.meta.url),'utf8');
function fixture() {
 const indexedDB=new IDBFactory(),legacy=new Map(), namespace=randomUUID(); let allowed=true;
 const scope={indexedDB,structuredClone,TextEncoder,crypto:webcrypto,localStorage:{getItem:k=>legacy.get(k)??null}};
 scope.window=scope; const ctx=vm.createContext(scope);vm.runInContext(source,ctx);
 const host={appId:'fixture-drafts',sourceId:'synthetic:fixture-drafts',namespace,quota:5242880,authorize:()=>allowed};
 const call=(method,args,context=host)=>scope.WizAppState.call(context,method,vm.runInContext('('+JSON.stringify(args)+')',ctx));
 return {call,legacy,host,indexedDB,revoke:()=>allowed=false,reload:()=>{const other={...scope}; other.window=other;delete other.WizAppState;const newCtx=vm.createContext(other);vm.runInContext(source,newCtx);return (m,a)=>other.WizAppState.call(host,m,vm.runInContext('('+JSON.stringify(a)+')',newCtx))}};
}
const read={area:'persistent',key:'draft'};
const put=(text,revision=null,operationKey=randomUUID())=>({area:'persistent',key:'draft',value:{text},ifRevision:revision,operationKey});
const plain=v=>JSON.parse(JSON.stringify(v));
test('durable receipt, hydration after reload and legacy rollback keeps newer draft',async()=>{
 const f=fixture(); f.legacy.set('fixture-drafts.legacy.v1',JSON.stringify({version:1,text:'Recovered synthetic draft'}));
 assert.deepEqual(plain(await f.call('state.read',read)),{exists:true,value:{text:'Recovered synthetic draft'},revision:'r1',schemaVersion:1});
 const write=put('Newer synthetic draft','r1');assert.deepEqual(plain(await f.call('state.write',write)),{revision:'r2',committed:true});
 assert.deepEqual(plain(await f.call('state.write',write)),{revision:'r2',committed:true});
 f.legacy.set('fixture-drafts.legacy.v1',JSON.stringify({version:1,text:'Old rollback draft'}));
 const reload=f.reload();assert.equal((await reload('state.read',read)).value.text,'Newer synthetic draft');
 assert.match(f.legacy.get('fixture-drafts.legacy.v1'),/Old rollback draft/);
 await assert.rejects(f.call('state.write',put('overwrite','r1')),e=>e.code==='conflict');
 await assert.rejects(f.call('state.write',{...write,value:{text:'changed arguments'}}),e=>e.code==='conflict');
});
test('all transaction preconditions before atomic commit',async()=>{
 const f=fixture();await f.call('state.write',put('one'));
 await assert.rejects(f.call('state.transaction',{area:'persistent',operationKey:randomUUID(),changes:[{kind:'put',key:'other',value:1,ifRevision:null},{kind:'put',key:'draft',value:2,ifRevision:null}]}),e=>e.code==='conflict');
 assert.equal((await f.call('state.read',{area:'persistent',key:'other'})).exists,false);
 const changes=[{kind:'put',key:'draft',value:{text:'two'},ifRevision:'r1'},{kind:'put',key:'other',value:1,ifRevision:null}];
 const args={area:'persistent',operationKey:randomUUID(),changes};
 assert.equal((await f.call('state.transaction',args)).committed,true);
 assert.equal((await f.call('state.transaction',args)).revisions.draft,'r2');
});
test('cross-install and same-ID other publisher never inherit draft',async()=>{
 const f=fixture();f.legacy.set('fixture-drafts.legacy.v1',JSON.stringify({version:1,text:'legacy'}));await f.call('state.read',read);
 assert.equal((await f.call('state.read',read,{...f.host,appId:'other',namespace:'other'})).exists,false);
 assert.equal((await f.call('state.read',read,{...f.host,sourceId:'unreviewed',namespace:'new-source'})).exists,false);
});
test('invalid migration, quota, revocation, unknown method, schema and value bounds fail closed',async()=>{
 const f=fixture();f.legacy.set('fixture-drafts.legacy.v1','bad');await assert.rejects(f.call('state.read',read),e=>e.code==='migration_failed');f.legacy.clear();
 await assert.rejects(f.call('state.write',put('x'),{...f.host,quota:10}),e=>e.code==='quota_exceeded');
 assert.equal((await f.call('state.read',read)).exists,false);
 await assert.rejects(f.call('state.write',put('x'.repeat(32769))),e=>e.code==='too_large');
 await assert.rejects(f.call('state.read',{...read,installationId:'forged'}),e=>e.code==='bad_request');
 await assert.rejects(f.call('state.remove',read),e=>e.code==='not_allowed');
 f.revoke();await assert.rejects(f.call('state.read',read),e=>e.code==='revoked');
});
test('autosave beyond 2100 writes retains recent retry receipts without filling value quota',async()=>{
 const f=fixture();f.host.quota=1024;let revision=null, first, recent;
 for(let n=0;n<2105;n++) { const args=put('synthetic '+n,revision);if(!first)first=args;const result=await f.call('state.write',args);revision=result.revision;recent=args; }
 assert.equal((await f.call('state.write',recent)).revision,revision);
 await assert.rejects(f.call('state.write',first),e=>e.code==='conflict');
 assert.equal((await f.call('state.read',read)).value.text,'synthetic 2104');
});
test('concurrent writers cannot silently overwrite',async()=>{
 const f=fixture();const r=await Promise.allSettled([f.call('state.write',put('first')),f.call('state.write',put('second'))]);assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal(r.find(x=>x.status==='rejected').reason.code,'conflict');
});
