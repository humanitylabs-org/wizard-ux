import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {listFixture,sectionKeys} from './fixtures/chats-list-render.mjs';
const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
test('routed search selects the actual list root, never the whole desktop window',()=>{
 const s=read('qa-search-archive-routed.cjs');
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
 const s=read('qa-wisdom-pinned-thread.cjs'),logs=[];
 const def=s.slice(s.indexOf('function reportFailure('),s.indexOf('\nfunction sourceError'));
 vm.runInNewContext(`${def}\nreportFailure({width:390,skin:'signal',action:'selection-ask-ai'},new Error('synthetic timeout')); reportFailure(null,new Error('launch failed'));`,{console:{error:(...a)=>logs.push(a.join(' '))}});
 assert.equal(logs.length,2);assert.match(logs[0],/390.*signal.*selection-ask-ai.*synthetic timeout/);assert.match(logs[1],/launch failed/);
 assert.match(s,/catch\(e\)\{reportFailure\(c,e\);c.status='fail'/);
 assert.ok(s.includes("catch(e=>{reportFailure(null,e);result.status='blocked'"));
});
