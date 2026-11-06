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
    bounded:(work,ms)=>{assert.equal(ms,4500);return Promise.race([work,new Promise((_,reject)=>expired=()=>reject(Object.assign(Error('timeout'),{code:'recovery_timeout'})))])},
    recoverLocked:async l=>{lease=l;await new Promise(r=>resolveStatus=r);if(l.cancelled)return;writes++},changed(){},rows:async()=>[],ownedRows:new Map()};
  vm.runInNewContext(code.slice(code.indexOf('  async function recover()'),code.indexOf('  // Start budget')),ctx);
  const waiting=ctx.recover();await tick();expired();await assert.rejects(waiting,e=>e.code==='recovery_timeout');assert(lease.cancelled);assert.equal(unlocked,1);assert.equal(ctx.recoveryLease,null);
  resolveStatus();await tick();assert.equal(writes,0);assert.equal(removed,0);
});
test('a stuck IndexedDB transaction is aborted at the storage boundary rather than leaving recovery running',async()=>{
  let alarm,aborted=0;
  const tx={abort(){aborted++},objectStore(){}};
  const ctx={storageDiagnostic(){},openDB:async()=>({transaction:()=>tx}),setTimeout:fn=>{alarm=fn;return 1},clearTimeout(){},fail:(code,message)=>Object.assign(Error(message),{code})};
  vm.runInNewContext(code.slice(code.indexOf('  async function transaction('),code.indexOf('  async function rows()')),ctx);
  const waiting=ctx.transaction(['sessions'],'readonly',()=>null);await tick();alarm();await assert.rejects(waiting,e=>e.code==='storage_failed');assert.equal(aborted,1);
});
