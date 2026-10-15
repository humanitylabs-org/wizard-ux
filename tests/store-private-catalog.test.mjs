import {test} from 'node:test';
import assert from 'node:assert/strict';
import {withPrivateCatalog,mergeRows} from '../tools/store-private-catalog.mjs';
const row={id:'private-app',name:'Private App',summary:'Test',repo:'example/private-app',type:'view',category:'app',source:'owner-private',commit:'a'.repeat(40)};
const opts={sourceRead:()=>null};
test('all pages merged locally; no private names, filters, detail or id go upstream',async()=>{
 const calls=[]; const proxy=withPrivateCatalog(async(path,q)=>{calls.push([path,q.toString()]);return {status:200,body:{apps:q.get('offset')==='0'?[{id:'public-one',repo:'example/public-one',name:'Public'}]:[{id:'public-two',repo:'example/public-two',name:'Public'}],next_offset:q.get('offset')==='0'?100:null}}},()=>[row],opts);
 assert.equal((await proxy('/search',new URLSearchParams({limit:'2'}))).body.next_offset,2);
 assert.equal((await proxy('/search',new URLSearchParams({limit:'2',offset:'2'}))).body.apps.length,1);
 assert.equal((await proxy('/apps/example/private-app',new URLSearchParams())).body.name,'Private App');
 assert.equal((await proxy('/search',new URLSearchParams({q:'private',id:'private-app'}))).body.apps.length,1);
 assert.deepEqual(calls,[['/search','limit=100&offset=0'],['/search','limit=100&offset=100']]);
});
test('private list survives public outage and respects category',async()=>{
 const proxy=withPrivateCatalog(async()=>({status:502}),()=>[row],opts);
 assert.equal((await proxy('/search',new URLSearchParams())).body.apps.length,1);
 assert.equal((await proxy('/search',new URLSearchParams({category:'agent'}))).body.apps.length,0);
});
test('same repo gets choices, exact legacy pin migrates, conflict remains visible',()=>{
 const alpha={...row,source:'wizard-alpha',channel:'alpha'};
 const standard={...row,source:'standard',commit:'b'.repeat(40)};
 const rows=mergeRows([row,alpha,standard]);
 assert.equal(rows.length,1);assert.equal(rows[0].releases.length,2);assert.equal(rows[0].source,'standard');assert.equal(rows[0].alpha_badge,'Alpha available');
 assert.equal(mergeRows([alpha])[0].alpha_badge,'Alpha');
 const conflicts=mergeRows([alpha,{...standard,repo:'other/repo'}]);assert.equal(conflicts.length,2);assert.ok(conflicts.every(a=>a.conflict));
 const selected=mergeRows([alpha,standard],{'private-app':{source:'wizard-alpha',commit:'c'.repeat(40)}})[0];assert.equal(selected.source,'wizard-alpha');assert.equal(selected.update_available,true);
});
test('bad private update preserves snapshot; response allowlist strips commands and credentials',async()=>{
 let bad=false;const proxy=withPrivateCatalog(async()=>({status:200,body:{apps:[]}}),()=>{if(bad)throw Error('secret');return [{...row,install_command:'secret',token:'secret',extra:{secret:true}}]},opts);
 const a=await proxy('/search',new URLSearchParams());assert.ok(!JSON.stringify(a).includes('secret'));
 bad=true;const b=await proxy('/search',new URLSearchParams());assert.equal(b.body.apps.length,1);assert.equal(b.body.sources[1].stale,true);
});
test('public partial and failed pagination does not replace last valid snapshot',async()=>{
 let broken=false,t=1;const proxy=withPrivateCatalog(async(p,q)=>broken?(q.get('offset')==='0'?{status:200,body:{apps:[{id:'partial'}],next_offset:100}}:{status:502}):{status:200,body:{apps:[{id:'kept'}],next_offset:null}},()=>[],{...opts,now:()=>t});
 assert.equal((await proxy('/search',new URLSearchParams())).body.apps[0].id,'kept');broken=true;t=70000;
 const r=await proxy('/search',new URLSearchParams());assert.equal(r.body.apps[0].id,'kept');assert.equal(r.body.sources[0].stale,true);
});
