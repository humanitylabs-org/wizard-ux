import test from 'node:test';
import assert from 'node:assert/strict';
import {SAMPLE_IDS,implementationCaps,assertOldCopy,waitForRevisions,exactMatrix} from './batch-preparation.mjs';
import {historyRevision} from './cache-evidence.mjs';
const oldRows=[{role:'user',content:'old request',timestamp:100},{role:'assistant',content:'SYNTHETIC_CURRENT_ANSWER_1_v1',timestamp:101}];
const old=historyRevision(oldRows),rows=[...oldRows,{role:'user',content:'new request',timestamp:102},{role:'assistant',content:'SYNTHETIC_CURRENT_ANSWER_1_v2',timestamp:103}],current=historyRevision(rows);
const stale=()=>({key:current.key,trusted:true,accepted:null,persisted:{rev:old.key,rows:structuredClone(oldRows)}});
test('batch uses thirty unique targets within actual exported cache/preload caps',()=>{
 assert.equal(SAMPLE_IDS.length,30);assert.equal(new Set(SAMPLE_IDS).size,30);
 assert.deepEqual(implementationCaps(new URL('../../',import.meta.url).pathname),{max:40,bytes:2500000,preload:16,preloadOrder:['ready','errors','working']});
});
test('counterproof requires intact persisted old content as well as rejected accepted-cache',()=>{
 assert.doesNotThrow(()=>assertOldCopy(stale(),old,current));
 const absent=stale();absent.persisted=null;assert.throws(()=>assertOldCopy(absent,old,current));
 const corrupt=stale();corrupt.persisted.rows[0].content='wrong';assert.throws(()=>assertOldCopy(corrupt,old,current));
 const retagged=stale();retagged.persisted.rev=current.key;assert.throws(()=>assertOldCopy(retagged,old,current));
 const refilled=stale();refilled.accepted=rows;assert.throws(()=>assertOldCopy(refilled,old,current));
});
test('whole-batch barrier never accepts one exact row plus another intermediate count',async()=>{
 const revisions=new Map([['a',current],['b',current]]),exact={trusted:true,rows:['a','b'].map(id=>({id,key:current.key})),raw:{status:200,rows:['a','b'].map(id=>({id,...current}))}};
 const partial=structuredClone(exact);partial.rows[1].key='intermediate';let reads=0;const seen=[];
 const page={evaluate:async(fn,arg)=>arg?(++reads===1?partial:exact):undefined};
 const got=await waitForRevisions(page,revisions,s=>seen.push(s));assert.equal(got,exact);assert.equal(reads,2);assert.equal(seen.length,2);
});
test('exact client key cannot conceal wrong raw HTTP count or either timestamp',async()=>{
 for(const field of ['messageCount','lastAssistantAt','lastUserAt']){
  const snapshot={trusted:true,rows:[{id:'a',key:current.key}],raw:{status:200,rows:[{id:'a',...current,[field]:'wrong'}]}};
  const page={evaluate:async(fn,arg)=>arg?snapshot:undefined};
  await assert.rejects(waitForRevisions(page,new Map([['a',current]]),()=>{}),/raw HTTP and client agree/);
 }
});
test('full matrix demands every unique timing and ancillary tuple and all API sample counts',()=>{
 const browser=[];for(const shell of ['phone','desktop'])for(const skin of ['nebula','signal']){
  for(const state of ['current','empty','stale'])browser.push({shell,skin,state,n:30});
  for(const name of ['long-history','no-js-errors','pending-voice-hang-deadline-retry','ready-prefetch-uses-existing-current-cache'])browser.push({shell,skin,case:name});
 }
 const results={api:['health','detail','history'].map(name=>({name,n:50})),browser};assert.equal(exactMatrix(results),true);
 const duplicate=structuredClone(results);duplicate.browser[0]=duplicate.browser[1];assert.equal(exactMatrix(duplicate),false);
 const partial=structuredClone(results);partial.browser[0].n=29;assert.equal(exactMatrix(partial),false);
 const api=structuredClone(results);api.api[0].n=49;assert.equal(exactMatrix(api),false);
 const ancillary=structuredClone(results);ancillary.browser.pop();assert.equal(exactMatrix(ancillary),false);
});
