import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {listFixture,sectionKeys} from './fixtures/chats-list-render.mjs';
const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
test('routed search selects the actual list root, never the whole desktop window',()=>{
 const s=read('qa/scripts/qa-search-archive-routed.cjs');
 const def=s.match(/const rootOf = id => [^;]+;/)[0];
 for(const shell of ['phone','desktop']){
  const root=vm.runInNewContext(`${def}\nrootOf('routed')`,{shell});
  assert.equal(root,`[data-chats="routed${shell==='desktop'?'::list':''}"]`);
 }
 const fx=listFixture({query:'match',status:true});
 assert.deepEqual(sectionKeys(fx.render()),[],'real renderer is flat for matching current and archive rows');
 assert.match(fx.render(),/data-chopen="archive"/);
 assert.ok(sectionKeys(fx.render('')).includes('archive'),'negative control retains normal Archive section');
});
test('Wisdom case and top-level failures emit useful stderr before nonzero exit',()=>{
 const s=read('qa/scripts/qa-wisdom-pinned-thread.cjs'),logs=[];
 const def=s.slice(s.indexOf('function reportFailure('),s.indexOf('\nfunction sourceError'));
 vm.runInNewContext(`${def}\nreportFailure({width:390,skin:'signal',action:'selection-ask-ai'},new Error('synthetic timeout')); reportFailure(null,new Error('launch failed'));`,{console:{error:(...a)=>logs.push(a.join(' '))}});
 assert.equal(logs.length,2);assert.match(logs[0],/390.*signal.*selection-ask-ai.*synthetic timeout/);assert.match(logs[1],/launch failed/);
});
// The whole Wisdom QA script against a fake Chromium: a case that fails, and a launch that fails.
async function wisdomRun(mode){
 const s=read('qa/scripts/qa-wisdom-pinned-thread.cjs'),logs=[],writes={};
 const page=new Proxy({pages:()=>[],close:async()=>{}},{get:(t,k)=>(k in t?t[k]:k==='then'?undefined:()=>Promise.reject(new Error('synthetic '+String(k))))});
 const chromium={launch:mode==='launch'?async()=>{throw new Error('launch failed');}:async()=>({newContext:async()=>page,close:async()=>{}})};
 const fs={readFileSync:f=>(f==='/allow'?'[]':f==='/fx'?JSON.stringify({entries:[{id:1,title:'T',body:'pay attention',body_sha256:'x'}]}):'{"files":{},"shell_files":{}}'),mkdirSync(){},writeFileSync:(f,t)=>{writes[f]=t;}};
 const mods={'node:fs':fs,'node:path':await import('node:path'),'node:crypto':await import('node:crypto'),'node:assert/strict':assert,'../../tools/qa-playwright.cjs':{chromium},'../../tools/qa-no-service-workers.cjs':{blockServiceWorkerRegistration(){}}};
 const proc={env:{QA_ORIGIN:'https://wizard.test',QA_OUT:'/out',QA_SOURCE:'/src',QA_FIXTURE:'/fx',QA_SOURCE_MANIFEST:'/m',QA_SHELL_ALLOWLIST:'/allow',QA_BASELINE:'1'},exitCode:0};
 vm.runInNewContext(s,{require:m=>mods[m],process:proc,console:{error:(...a)=>logs.push(a.join(' ')),log(){}},URL,setTimeout,clearTimeout,Promise,JSON,Error,Set,Map,Buffer,DOMException,structuredClone});
 for(let i=0;i<50;i++)await new Promise(r=>setImmediate(r));
 return {logs,exitCode:proc.exitCode,result:JSON.parse(writes['/out/hosted-route.json']||'null')};
}
test('the Wisdom QA script reports each failed case and a failed launch on stderr, and exits nonzero',async()=>{
 const c=await wisdomRun('case');
 assert.deepEqual(c.result.cases.map(x=>x.status),['fail','fail'],'each case fails on its own');
 assert.equal(c.logs.length,2);for(const [i,action] of ['selection-ask-ai','selection-open-discussion'].entries())assert.match(c.logs[i],new RegExp(`^FAIL wisdom-pinned-thread .*"width":390,"skin":"nebula","action":"${action}".*synthetic`));
 assert.equal(c.result.status,'fail');
 const l=await wisdomRun('launch');
 assert.equal(l.result.status,'blocked');assert.equal(l.exitCode,1,'nonzero exit');
 assert.equal(l.logs.length,1);assert.match(l.logs[0],/^FAIL wisdom-pinned-thread .*launch failed/);
});
