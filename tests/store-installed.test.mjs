import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createStoreDataRoutes, PREFIX, wamMetadata, shellMetadata} from '../tools/store-data-origin.mjs';
test('installed identity is scalar-only; internal config and private URLs stay server side',()=>{
 const secret={password:'secret'};
 assert.deepEqual(wamMetadata({apps:[{id:'movies-next',app_id:'movies',repo:'org/movies',commit:'a'.repeat(40),version:'1.0.0',config:secret,health:'secret',view:'secret'}]}),[{id:'movies-next',app_id:'movies',repo:'org/movies',commit:'a'.repeat(40),version:'1.0.0'}]);
 assert.ok(!JSON.stringify(wamMetadata({apps:[{id:'a',repo:secret,commit:secret,version:secret,source:secret}]})).includes('secret'));
 assert.deepEqual(shellMetadata({apps:[{id:'a',url:'//other-site/',config:secret},{id:'b',url:'/b/',token:'secret'}]}),[{id:'a',system:false},{id:'b',url:'/b/',system:false}]);
 assert.throws(()=>wamMetadata({})); assert.throws(()=>shellMetadata({}));
});
test('real HTTP route merges independent read status, never treats failure as empty success',async()=>{
 let wamFail=false,shellFail=false;const calls=[];
 const route=createStoreDataRoutes({readWam:()=>{if(wamFail)throw Error('secret');return {apps:[{id:'movies-next',app_id:'movies',repo:'org/movies'}]};},fetchImpl:async(url,opts)=>{calls.push({url,method:opts.method || 'GET'});return shellFail?new Response('bad',{status:503}):Response.json({apps:[{id:'calendar',url:'/wizard-calendar/',token:'secret'}]});}});
 const s=http.createServer(route);await new Promise(r=>s.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${s.address().port}${PREFIX}wizard/v1/installed-apps`;
 try {
  let d=await (await fetch(url)).json();assert.equal(d.complete,true);assert.equal(d.wam[0].app_id,'movies');assert.equal(d.shell[0].id,'calendar');assert.ok(!JSON.stringify(d).includes('secret'));
  shellFail=true;d=await (await fetch(url)).json();assert.equal(d.complete,false);assert.equal(d.wam.length,1);assert.deepEqual(d.unavailable,['shell']);
  wamFail=true;d=await (await fetch(url)).json();assert.equal(d.complete,false);assert.deepEqual(d.unavailable,['wam','shell']);
  assert.equal((await fetch(url,{method:'POST'})).status,405);assert.equal((await fetch(url+'?anything=1')).status,400);
  assert.ok(calls.every(c=>c.url==='http://127.0.0.1:8923/wizard/v1/apps' && c.method==='GET'));
 } finally {s.closeAllConnections();await new Promise(r=>s.close(r));}
});
