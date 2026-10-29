import test from 'node:test';
import assert from 'node:assert/strict';
import {historyRevision,assessCache,waitForRevision} from './cache-evidence.mjs';
const rows=[{role:'user',timestamp:100,content:'synthetic request'},
 {role:'assistant',timestamp:101,content:'SYNTHETIC_CURRENT_ANSWER_1_v2\nstatus'}];
const revision=historyRevision(rows);
const snapshot=(accepted=rows)=>({key:revision.key,trusted:true,accepted});

test('canonical revision uses exact row count, assistant/user timestamps and full answer token',()=>{
 assert.deepEqual(revision,{messageCount:2,lastAssistantAt:'1970-01-01T00:01:41.000Z',lastUserAt:'1970-01-01T00:01:40.000Z',key:'2|1970-01-01T00:01:41.000Z|1970-01-01T00:01:40.000Z',marker:'SYNTHETIC_CURRENT_ANSWER_1_v2'});
});
test('null cache under exact trusted revision rejects the old copy',()=>{
 assert.equal(assessCache(snapshot(null),revision),'rejected-old-copy');
});
test('legitimate non-null refill must match canonical content, count and timestamps',()=>{
 assert.equal(assessCache(snapshot(),revision),'current-copy-refilled');
});
test('non-null stale answer fails even if tagged with the expected revision',()=>{
 const old=structuredClone(rows);old[1].content='SYNTHETIC_CURRENT_ANSWER_1_v1';
 assert.throws(()=>assessCache(snapshot(old),revision),/exact newest canonical answer/);
});
test('a changed but intermediate list key never meets expected canonical authority',()=>{
 assert.throws(()=>assessCache({...snapshot(null),key:'1|old|old'},revision),/exact canonical revision/);
});
test('right answer with incomplete history is not a current cache',()=>{
 assert.throws(()=>assessCache(snapshot(rows.slice(1)),revision),/exact canonical count/);
});
test('right count and answer with stale timestamps is not a current cache',()=>{
 const stale=structuredClone(rows);stale[0].timestamp=99;
 assert.throws(()=>assessCache(snapshot(stale),revision),/timestamps match canonical revision/);
});
test('untrusted restored list cannot authorize a current cache',()=>{
 assert.throws(()=>assessCache({...snapshot(),trusted:false},revision),/live canonical list authority/);
});
test('refresh barrier records intermediate and untrusted observations then waits for exact revision',async()=>{
 const states=[{...snapshot(null),key:'old'},{...snapshot(null),key:'intermediate'}, {...snapshot(null),trusted:false},snapshot(null)],seen=[];
 let refreshes=0;
 const page={evaluate:async(fn,arg)=>{if(arg===undefined){refreshes++;return;}return states.shift();}};
 const found=await waitForRevision(page,'synthetic',revision,s=>seen.push(s));
 assert.equal(found.key,revision.key);assert.equal(found.trusted,true);
 assert.equal(refreshes,4);assert.equal(seen.length,4);assert.equal(seen[1].key,'intermediate');
});
