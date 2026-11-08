import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const handle=require('../tools/fixtures/backgrounds-orb.cjs');
const web=new URL('../web/',import.meta.url).pathname;
function request(url,method='GET'){
  const r={status:0,headers:{},body:'',writeHead(code,h){this.status=code;this.headers=h;},end(body=''){this.body=body;}};
  const consumed=handle({url,method},r,web);return{...r,consumed};
}

test('synthetic preview fences every mutation, run path and owner-data route before proxy dispatch',()=>{
  for(const method of ['POST','PUT','PATCH','DELETE','OPTIONS']){
    for(const path of ['/wizard/hermes/v1/runs','/wizard/v1/sessions','/wizard/v1/my-skin','/wizard/v1/pages/wizard-look/look.json','/wizard/voice/transcribe']){
      const r=request(path,method);assert.equal(r.consumed,true);assert.equal(r.status,403);assert.match(r.body,/disabled/);
    }
  }
  const owner=request('/wizard/hermes/api/sessions');assert.deepEqual(JSON.parse(owner.body),{data:[],has_more:false});
  const unknown=request('/an-unexpected-api');assert.equal(unknown.consumed,true);assert.equal(unknown.body,'{}');
  const receipt=JSON.parse(request('/__preview/receipt').body);assert.equal(receipt.synthetic,true);assert.equal(receipt.upstream,false);assert.equal(receipt.readOnly,true);
});

test('synthetic HTML uses only an external fixture bootstrap and blocks microphone permission',()=>{
  for(const p of ['/wizard-os-home/','/wizard-os-home/index.html','/wizard-os-home/desktop.html']){
    const r=request(p);assert.equal(r.status,200);assert.match(r.body,/<script src="\/__preview\/bootstrap.js"><\/script>/);assert.equal(r.headers['permissions-policy'],'microphone=()');
  }
  assert.equal(request('/wizard-os-home/core/skins.js').consumed,false,'tracked shell assets use the existing qa-origin static dispatcher');
  assert.match(request('/wizard-os-home/data.js').body,/threads:\[\]/,'never reads the owner-generated data symlink');
});
