// Continuation tests exercise real chunk assembly and cancellation boundaries.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('../web/core/app-capture.js',import.meta.url),'utf8');
const tick=async()=>{for(let i=0;i<50;i++)await Promise.resolve()};
test('persisted capture result assembles every ordered IndexedDB chunk without dropping binary bytes',async()=>{
  const chunks=[new Blob([Uint8Array.of(0,255)]),new Blob([Uint8Array.of(128)]),new Blob([Uint8Array.of(9)])];
  const ctx={storageDiagnostic(){},Blob,parts:async id=>{assert.equal(id,'synthetic');return chunks},streamChunks:async()=>[]};
  vm.runInNewContext(code.slice(code.indexOf('  async function result(row)'),code.indexOf('  // Atomically save')),ctx);
  const r=await ctx.result({id:'synthetic',mime:'audio/webm',status:'pending',meta:{}});
  assert.deepEqual([...new Uint8Array(await r.blob.arrayBuffer())],[0,255,128,9]);
});
test('hung lock acquisition expires and releases any late grant instead of leaking a permanent recorder lock',async()=>{
  let grant,timeout,released=0;
  const ctx={storageDiagnostic(){},acquire:()=>new Promise(r=>grant=r),fail:(code,message)=>Object.assign(Error(message),{code}),
    bounded:(work,ms)=>{assert.equal(ms,1500);return Promise.race([work,new Promise((_,reject)=>timeout=()=>reject(Object.assign(Error('timeout'),{code:'recovery_timeout'})))])}};
  vm.runInNewContext(code.slice(code.indexOf('  async function acquireBounded()'),code.indexOf('  async function recover()')),ctx);
  const waiting=ctx.acquireBounded();timeout();await assert.rejects(waiting,e=>e.code==='recovery_timeout');grant(()=>released++);await tick();assert.equal(released,1);
});
test('recovery timeout cancels its lease before releasing ownership; late native status cannot mutate rows',async()=>{
  let resolveStatus,expired,removed=0,writes=0,unlocked=0,lease;
  const ctx={storageDiagnostic(){},active:null,recoveryLease:null,recoveryError:null,acquireBounded:async()=>()=>unlocked++,
    bounded:(work,ms)=>{assert.equal(ms,20000);return Promise.race([work,new Promise((_,reject)=>expired=()=>reject(Object.assign(Error('timeout'),{code:'recovery_timeout'})))])},
    recoverLocked:async l=>{lease=l;await new Promise(r=>resolveStatus=r);if(l.cancelled)return;writes++},changed(){},rows:async()=>[],ownedRows:new Map()};
  vm.runInNewContext(code.slice(code.indexOf('  async function recover()'),code.indexOf('  // Start budget')),ctx);
  const waiting=ctx.recover();await tick();expired();await assert.rejects(waiting,e=>e.code==='recovery_timeout');assert(lease.cancelled);assert.equal(unlocked,1);assert.equal(ctx.recoveryLease,null);
  resolveStatus();await tick();assert.equal(writes,0);assert.equal(removed,0);
});
test('stuck IndexedDB transactions abort each attempt, close failed connections and stop after one reopen',async()=>{
  let alarm,aborted=0,closed=0,opened=0;
  const tx={abort(){aborted++},objectStore(){}};
  const ctx={storageDiagnostic(){},dbPromise:null,openDB:()=>ctx.dbPromise ||= Promise.resolve({transaction:()=>tx,close(){closed++}}).then(db=>{opened++;return db}),setTimeout:(fn,ms)=>{assert.equal(ms,5000);alarm=fn;return 1},clearTimeout(){},fail:(code,message,extra)=>Object.assign(Error(message),{code},extra)};
  vm.runInNewContext(code.slice(code.indexOf('  async function transaction('),code.indexOf('  async function rows()')),ctx);
  const waiting=ctx.transaction(['sessions'],'readonly',()=>null),failed=assert.rejects(waiting,e=>e.code==='storage_failed'&&e.detail==='timeout');
  await tick();alarm();await tick();assert.equal(aborted,1);assert.equal(closed,1);assert.equal(opened,2);
  alarm();await failed;assert.equal(aborted,2);assert.equal(closed,2);assert.equal(opened,2);assert.equal(ctx.dbPromise,null);
});
