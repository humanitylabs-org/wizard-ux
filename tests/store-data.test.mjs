// Isolated adapter fixtures only: never requests a real lifecycle or app index.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createStoreDataRoutes, PREFIX, installedMetadata, serviceOrigin } from '../tools/store-data-origin.mjs';
test('installed metadata is an allowlist (nested generated credentials never emitted)',()=>{
  const result=installedMetadata({installed:[{info:{id:'transcriber',name:'Transcriber',form_fields:[{password:'secret'}]},app:{status:'running',version:1,config:{password:'secret'},userConfig:{secret:'secret'}},metadata:{latestVersion:2,password:'secret'},config:'secret'}]});
  assert.deepEqual(result,{installed:[{info:{id:'transcriber',name:'Transcriber'},app:{status:'running',version:1},metadata:{latestVersion:2}}]});
});
test('allowed keys holding nested objects are dropped, never passed through',()=>{
  const nested={password:'secret'};
  const out=JSON.stringify(installedMetadata({installed:[{info:{id:'x',urn:nested,name:nested,short_desc:nested,categories:[nested,'audio'],no_gui:nested},app:{status:nested,version:nested,ignoredVersion:nested},metadata:{latestVersion:nested}}]}));
  assert.ok(!out.includes('secret'),out);
  assert.deepEqual(JSON.parse(out),{installed:[{info:{id:'x',categories:['audio']},app:{},metadata:{}}]});
});
test('oversized upstream image is refused without buffering it all',async()=>{
  const handler=createStoreDataRoutes({readRuntipi:()=>({base:'http://fixture',token:'t'}),fetchImpl:async()=>new Response(new ReadableStream({pull(c){c.enqueue(new Uint8Array(1024*1024));}}),{headers:{'content-type':'image/png'}})});
  const s=http.createServer(handler); await new Promise(r=>s.listen(0,'127.0.0.1',r));
  try { assert.equal((await fetch(`http://127.0.0.1:${s.address().port}${PREFIX}api/marketplace/apps/a:b/image`)).status,502);
        assert.equal((await fetch(`http://127.0.0.1:${s.address().port}${PREFIX}%E0%A4%A`)).status,400); }
  finally {s.closeAllConnections();await new Promise(r=>s.close(r));}
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

test('Store reads the shell app list from the configured loopback Agent Service', async () => {
  assert.equal(serviceOrigin(undefined), 'http://127.0.0.1:8923');
  assert.equal(serviceOrigin('http://127.0.0.1:8798'), 'http://127.0.0.1:8798');
  for (const bad of ['https://example.com', 'http://10.0.0.5:8798', 'http://127.0.0.1:8798/x', 'file:///etc']) assert.equal(serviceOrigin(bad), 'http://127.0.0.1:8923');
  const seen=[];
  const handler=createStoreDataRoutes({service:'http://127.0.0.1:8798',readWam:()=>({apps:[{id:'files'}]}),readRuntipi:()=>({base:'http://fixture',token:'t'}),
    fetchImpl:async(url)=>{seen.push(String(url));return new Response(JSON.stringify({apps:[{id:'files',url:'/files/'}]}),{headers:{'content-type':'application/json'}});}});
  const s=http.createServer(handler); await new Promise(r=>s.listen(0,'127.0.0.1',r));
  let res,j;
  try { res=await fetch(`http://127.0.0.1:${s.address().port}${PREFIX}wizard/v1/installed-apps`); j=await res.json(); }
  finally { s.closeAllConnections(); await new Promise(r=>s.close(r)); }
  assert.equal(res.status,200); assert.equal(j.complete,true); assert.deepEqual(j.unavailable,[]);
  assert.ok(seen.includes('http://127.0.0.1:8798/wizard/v1/apps'));
});
