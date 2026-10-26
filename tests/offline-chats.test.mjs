import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
function keyed(){
 const data=new Map(),db={createObjectStore(name){data.set(name,new Map());},transaction(names){
   const copy=new Map(names.map(n=>[n,new Map(data.get(n))]));let aborted=false;
   const tx={abort(){aborted=true;setTimeout(()=>tx.onabort?.(),0)},objectStore(name){const m=copy.get(name);const request=result=>{const r={result:structuredClone(result)};queueMicrotask(()=>r.onsuccess?.());return r};return {get:k=>request(m.get(k)),getAllKeys:()=>request([...m.keys()]),clear:()=>m.clear(),put(value,key){m.set(key,structuredClone(value));return request(key)}}}};
   setTimeout(()=>{if(!aborted){for(const [n,m]of copy)data.set(n,m);tx.oncomplete?.();}},0);return tx;
 }};
 const indexedDB={open(){const r={result:db};queueMicrotask(()=>{r.onupgradeneeded?.();r.onsuccess?.()});return r;}};
 const ctx=vm.createContext({indexedDB,console,setTimeout,clearTimeout,queueMicrotask,structuredClone});vm.runInContext(read('web/core/offline-kit.js'),ctx);return ctx.WizOffline.collection({name:'wos-keyed-test'});
}
test('offline chats flight loop: keyed collection commits rows and readiness together',async()=>{
 const c=keyed();await c.replace([['one',{messages:['saved body']}],['two',{messages:['other body']}]],{at:1,ids:['one','two']});
 assert.equal((await c.get('one')).messages[0],'saved body');assert.equal((await c.manifest()).at,1);assert.deepEqual(Array.from(await c.keys()),['one','two']);
 await c.replace([['two',{messages:['new body']}]],{at:2,ids:['two']});assert.equal(await c.get('one'),undefined);assert.equal((await c.manifest()).at,2);
});
test('offline chats flight loop: synchronous clone failure aborts replacement, not a partial clear',async()=>{
 const c=keyed();await c.replace([['original',{body:'kept'}]],{at:1});
 await assert.rejects(c.replace([['bad',{nonCloneable(){}}]],{at:2}));
 assert.equal((await c.get('original')).body,'kept');assert.equal((await c.manifest()).at,1);
});
test('offline chats flight loop: generated shell identity matches every cached asset',()=>{
 const output=execFileSync(process.execPath,['tools/offline-shell-manifest.mjs','--check'],{encoding:'utf8'});assert.match(output,/PASS offline shell identity/);
});
test('offline chats flight loop: stamp and replay live in existing custody, not words or kit outbox',()=>{
 const outbox=read('web/outbox.js'),adapter=read('web/core/offline-chats.js');
 assert.match(outbox,/body\.offline_context = structuredClone\(it\.offlineContext\)/);
 assert.match(outbox,/if \(it\?\.offlineContext\) return false/);
 assert.match(outbox,/Math\.min\(2,batch\.length\)/);
 assert.doesNotMatch(adapter,/WizOffline\.create\(/);
 assert.match(outbox,/if \(it\.offlineContext && it\.state !== 'sent'\)/);
});
