import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../web/core/app-capture.js', import.meta.url), 'utf8');
const DB = 'wizard-app-capture-v1', LOCK = DB + ':microphone';
const turn = () => new Promise(r => setTimeout(r, 10));
function fixture({hang=false, request, db}={}) {
  const sent=[];
  const indexedDB={ databases:()=>hang?new Promise(()=>{}):Promise.resolve([{name:DB,version:2},{name:'private-other-db',version:77}]),
    open:()=>request };
  const W={indexedDB, WizardOSNative:{platform:()=> 'android:0.10.23'}, fetch:async(path,options)=>{sent.push({path,options,payload:JSON.parse(options.body)});return {ok:true};}};
  const c=vm.createContext({W,indexedDB,DB_NAME:DB,LOCK,dbPromise:null,Date,Promise,Set,AbortSignal,setTimeout,clearTimeout,
    navigator:{userAgent:'Android SM-S938B private-UA-not-forwarded', storage:{estimate:()=>hang?new Promise(()=>{}):Promise.resolve({usage:123,quota:456,private:'private-value'})},
      locks:{query:()=>Promise.resolve({held:[{name:LOCK,clientId:'private-id'},{name:'private-lock'}],pending:[{name:LOCK}]})}},
    fail:(code,message,extra)=>Object.assign(Error(message),{code},extra)});
  vm.runInContext(source.slice(source.indexOf('  function storageFailure('),source.indexOf('  async function rows(')),c);
  return {c,sent,W,indexedDB};
}
test('private collector payload is field-built control metadata only, deduplicated per page',async()=>{
  const f=fixture(); f.c.storageDiagnostic('open',{name:'VersionError',message:'private-message',stack:'private-stack'},Date.now(),{blocked:true,oldVersion:2,newVersion:1,private:'private-info'});
  f.c.storageDiagnostic('open',{name:'VersionError'},Date.now(),{});
  await turn();assert.equal(f.sent.length,1);
  const {payload,path,options}=f.sent[0], r=payload.events[0].data.result;
  assert.equal(path,'/wizard-os-home/api/diagnostics/scroll-capture');assert.equal(options.redirect,'error');assert.equal(options.credentials,'same-origin');
  assert.equal(payload.session.model,'SM-S938B');assert.equal(payload.session.appVersion,'0.10.23');assert.equal(payload.events[0].method,'storage.open');
  assert.equal(r.code,'VersionError');assert.equal(r.db,DB);assert.equal(r.requestedVersion,1);assert.equal(r.actualVersion,2);
  assert.equal(r.oldVersion,2);assert.equal(r.newVersion,1);assert.equal(r.blocked,true);assert.equal(r.usage,123);assert.equal(r.quota,456);
  assert.equal(r.heldLocks,1);assert.equal(r.pendingLocks,1);assert.doesNotMatch(JSON.stringify(payload),/private/);
});
test('hung storage estimate/database listing cannot prevent diagnostic delivery',async()=>{
  const f=fixture({hang:true});f.c.storageDiagnostic('open',{detail:'timeout'},Date.now(),{});
  await new Promise(r=>setTimeout(r,330));assert.equal(f.sent.length,1);assert.equal(f.sent[0].payload.events[0].data.result.code,'timeout');
});
test('browser desktop does not send Android diagnostics; failed transport is nonfatal',async()=>{
  const f=fixture();delete f.W.WizardOSNative;f.c.storageDiagnostic('open',{name:'UnknownError'},Date.now());await turn();assert.equal(f.sent.length,0);
  f.W.WizardOSNative={};f.W.fetch=()=>Promise.reject(Error('private network error'));f.c.storageDiagnostic('open',{name:'UnknownError'},Date.now());await turn();
});
test('production open reports blocked versions and closes late connection',async()=>{
  const req={};const f=fixture({request:req});const p=f.c.openDB();req.onblocked({oldVersion:1,newVersion:2});
  await assert.rejects(p,e=>e.detail==='blocked');let closed=0;req.result={close(){closed++;}};req.onsuccess();await turn();
  assert.equal(closed,1);assert.equal(f.sent[0].payload.events[0].data.result.blocked,true);
});
test('production transaction reports sync InvalidStateError without leaking exception text',async()=>{
  const f=fixture();vm.runInContext(`dbPromise=Promise.resolve({version:1,transaction(){throw Object.assign(Error('private'),{name:'InvalidStateError'})}})`,f.c);
  await assert.rejects(f.c.transaction(['sessions'],'readwrite',()=>{}),e=>e.name==='InvalidStateError');await turn();
  assert.equal(f.sent[0].payload.events[0].method,'storage.transaction');assert.equal(f.sent[0].payload.events[0].data.result.code,'InvalidStateError');
  assert.doesNotMatch(JSON.stringify(f.sent),/private/);
});
test('stalled transaction emits timeout before a synchronous abort event, preserving exact cause',async()=>{
  const f=fixture();const tx={abort(){this.onabort?.();}};f.c.tx=tx;
  vm.runInContext('dbPromise=Promise.resolve({version:1,transaction(){return tx;}})',f.c);
  await assert.rejects(f.c.transaction(['sessions'],'readwrite',()=>{}),e=>e.detail==='timeout');await turn();
  assert.equal(f.sent.length,1);assert.equal(f.sent[0].payload.events[0].data.result.code,'timeout');
});
test('recovery breadcrumbs name only fixed stages and counts, never row values',()=>{
  assert.match(source,/lease\.phase = 'rows'/);assert.match(source,/lease\.sessionCount = all\.length/);
  assert.match(source,/lease\.phase = 'native_status'/);assert.match(source,/lease\.phase = 'native_recover'/);
  assert.match(source,/phase: lease\?\.phase \|\| 'lock'/);
});
