// Isolated adapter fixtures only: never requests a real lifecycle or app index.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createStoreDataRoutes, PREFIX, installedMetadata } from '../tools/store-data-origin.mjs';
test('installed metadata is an allowlist (nested generated credentials never emitted)',()=>{
  const result=installedMetadata({installed:[{info:{id:'transcriber',name:'Transcriber',form_fields:[{password:'secret'}]},app:{status:'running',version:1,config:{password:'secret'},userConfig:{secret:'secret'}},metadata:{latestVersion:2,password:'secret'},config:'secret'}]});
  assert.deepEqual(result,{installed:[{info:{id:'transcriber',name:'Transcriber'},app:{status:'running',version:1},metadata:{latestVersion:2}}]});
});
test('prefix, methods, traversal, HEAD, index and installed data are bounded',async()=>{
  let remote=0;
  const handler=createStoreDataRoutes({index:async(p,q)=>p==='/search'?{status:200,body:{apps:[{id:q.get('q')}]}}:{status:404,body:{}},readApps:()=>({apps:[]}),readRuntipi:()=>({base:'http://fixture',token:'private'}),fetchImpl:async()=>{remote++;return {ok:true,json:async()=>({installed:[]})};}});
  const s=http.createServer(handler); await new Promise(r=>s.listen(0,'127.0.0.1',r)); const base=`http://127.0.0.1:${s.address().port}`;
  try {
    for(const method of ['POST','PUT','PATCH','DELETE','OPTIONS']) assert.equal((await fetch(base+PREFIX+'api/app-lifecycle/x/install',{method})).status,405);
    assert.equal((await fetch(base+'/wizard/v1/index/search')).status,404);
    assert.equal((await fetch(base+PREFIX+'unknown')).status,404);
    assert.equal((await fetch(base+PREFIX+'api/apps/installed?secret=x')).status,400);
    const raw=await new Promise(resolve=>{http.get({hostname:'127.0.0.1',port:s.address().port,path:PREFIX+'%2e%2e/api/apps/installed'},r=>{r.resume();resolve(r.statusCode);});}); assert.equal(raw,400);
    assert.equal((await fetch(base+PREFIX+'api%2fapps/installed')).status,400);
    assert.deepEqual(await (await fetch(base+PREFIX+'wizard/v1/index/search?q=transcri')).json(),{apps:[{id:'transcri'}]});
    const head=await fetch(base+PREFIX+'wizard/v1/wizard-apps',{method:'HEAD'}); assert.equal(head.status,200);assert.equal(await head.text(),'');
    assert.equal((await fetch(base+PREFIX+'api/apps/installed')).status,200);assert.equal(remote,1);
  } finally {s.closeAllConnections();await new Promise(r=>s.close(r));}
});
