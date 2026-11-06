import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
const require = createRequire(import.meta.url);
const { admit, fenceContext, responseFor, FIXTURE_ORIGIN } = require('../tools/qa-synthetic-fence.cjs');
const root = new URL('../', import.meta.url).pathname;

test('both entrypoints refuse owner origins before Playwright, requests, output or screenshots', async () => {
 let reached = 0;
 const owner = http.createServer((q,r) => { reached++; r.end('must never be read'); });
 owner.listen(0,'127.0.0.1'); await once(owner,'listening');
 const dir = mkdtempSync(path.join(tmpdir(),'qa-admission-'));
 try {
  for (const helper of ['qa-hosted-notes-read.cjs','qa-owner-shell-sync.cjs']) {
   const out = path.join(dir,helper);
   const cp = spawnSync(process.execPath,[path.join(root,helper)],{env:{...process.env,QA_BASE:`http://127.0.0.1:${owner.address().port}`,QA_OUT:out,QA_SHA:'synthetic',QA_FIXTURE:'/missing/catalogue.json'},encoding:'utf8'});
   assert.notEqual(cp.status,0); assert.match(cp.stderr,/owner\/network origins refused/);
   assert.equal(existsSync(out),false,'not even the output directory may exist before admission');
   const src=readFileSync(path.join(root,helper),'utf8');
   assert.ok(src.indexOf('const fixture = admit(')<src.indexOf("require('./tools/qa-playwright.cjs')"));
   assert.doesNotMatch(src,/route\.continue\(|r\.continue\(/);
  }
  // Give pending network events a chance to arrive, not merely zero POSTs.
  await new Promise(resolve=>setTimeout(resolve,25)); assert.equal(reached,0);
 } finally { owner.closeAllConnections(); await new Promise(resolve=>owner.close(resolve)); rmSync(dir,{recursive:true,force:true}); }
});

test('browser and APIRequestContext share the same closed response-only catalogue', async () => {
 const fixture={base:FIXTURE_ORIGIN,responses:{'GET /fixture':{status:200,body:'{"synthetic":true}'}}};
 let network=0, shots=0, handler, sockets;
 const ctx={request:{get(){network++;throw Error('real API escape')}},async route(glob,fn){handler=fn;},async routeWebSocket(glob,fn){sockets=fn;}};
 const denied=[]; await fenceContext(ctx,fixture,denied);
 assert.deepEqual(await (await ctx.request.get(FIXTURE_ORIGIN+'/fixture')).json(),{synthetic:true});
 for(const method of ['get','head','post','put','patch','delete','fetch']) await assert.rejects(()=>ctx.request[method]('https://owner.example/private'),/Non-fixture origin/);
 await assert.rejects(()=>ctx.request.get(FIXTURE_ORIGIN+'/unknown'),/Uncatalogued/);
 const route=url=>({request:()=>({url:()=>url,method:()=>'GET'}),continue(){network++;},fulfill(){},abort(){return 'aborted';}});
 assert.equal(await handler(route('https://owner.example/private')),'aborted');
 assert.equal(await handler(route(FIXTURE_ORIGIN+'/unknown')),'aborted');
 await handler(route(FIXTURE_ORIGIN+'/fixture'));
 let closed=false;sockets({close(){closed=true;}});assert.equal(closed,true);
 assert.equal(network,0);assert.equal(shots,0);assert.equal(denied.length,2);
 // A deliberately unsafe request is detected by the same counter.
 const unsafe={get(){network++;}};unsafe.get('https://owner.example/private');assert.equal(network,1);
});

test('binary fixture assets preserve exact bytes and malformed encodings fail shut', async()=>{
 const bytes=Buffer.from([0,128,255,13,10,195,169]);
 const fixture={base:FIXTURE_ORIGIN,responses:{'GET /binary':{status:200,body:bytes.toString('base64'),encoding:'base64'}}};
 assert.deepEqual(responseFor(fixture,'/binary').body,bytes);
 let fulfilled;const ctx={async route(g,h){await h({request:()=>({url:()=>FIXTURE_ORIGIN+'/binary',method:()=>'GET'}),fulfill:r=>fulfilled=r,abort:()=>assert.fail('valid binary aborted')});},async routeWebSocket(){}};
 await fenceContext(ctx,fixture);assert.deepEqual(fulfilled.body,bytes);assert.deepEqual(await (await ctx.request.get(FIXTURE_ORIGIN+'/binary')).body(),bytes);
 for(const body of ['!not base64','AB==','abc']){fixture.responses['GET /binary'].body=body;assert.throws(()=>responseFor(fixture,'/binary'),/Invalid fixture base64/);}
 fixture.responses['GET /binary'].encoding='hex';assert.throws(()=>responseFor(fixture,'/binary'),/Uncatalogued/);
});

test('admission cannot be enabled by a flag, loopback name, URL credentials or a live path',()=>{
 for(const base of ['https://owner.example','http://localhost','http://127.0.0.1','http://wizard-qa.invalid/live','http://user@wizard-qa.invalid','https://wizard-qa.invalid']) assert.throws(()=>admit(base,'missing'),/origins refused/);
 const dir=mkdtempSync(path.join(tmpdir(),'qa-catalogue-'));
 try{const f=path.join(dir,'fixture.json');writeFileSync(f,JSON.stringify({synthetic:true,responses:{}}));assert.equal(admit(FIXTURE_ORIGIN,f).base,FIXTURE_ORIGIN);assert.throws(()=>responseFor(admit(FIXTURE_ORIGIN,f),'/unknown'),/Uncatalogued/);}finally{rmSync(dir,{recursive:true,force:true});}
});
