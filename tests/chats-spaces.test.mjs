import test from 'node:test'
import assert from 'node:assert/strict'
import { editSpaces, run, spaceOps } from '../skills/wizard-spaces/scripts/wizard-spaces.mjs'
const sample = () => [{id:'launch',name:'Launch',threads:['wizard_1'],createdAt:'2026-10-24T00:00:00.000Z'}]

test('agent ownership is explicit on create, legacy main is respected, foreign edits are refused',()=>{
 const current=sample();const next=editSpaces(current,['create','--agent','philosopher','Launch','phil_1']);
 assert.equal(next[1].agent,'philosopher');assert.equal(editSpaces([],['create','Default'])[0].agent,'hermes');
 assert.equal(editSpaces(next,['list','--agent','philosopher']).length,1);
 assert.deepEqual(editSpaces(next,['list']),current);
 assert.throws(()=>editSpaces(next,['delete',next[1].id]),/different agent/);
 assert.throws(()=>editSpaces(next,['add','launch','--agent','philosopher','phil_2']),/different agent/);
 for(const id of ['../bad','hermes\n','Bad',''])assert.throws(()=>editSpaces([],['create','--agent',id,'X']));
 assert.deepEqual(editSpaces(next,['add',next[1].id,'--agent','philosopher','phil_2'])[1].threads,['phil_1','phil_2']);
});
test('search uses exact Space owner and canonical scoped list route, never cross-agent fallback',async()=>{
 const calls=[];const request=async(u,o)=>{calls.push(String(u));return String(u).includes('ui-preferences')?Response.json({spaces:[{...sample()[0],agent:'philosopher'}]}):Response.json({data:[{id:'phil_1',title:'Reading'}]});};
 const result=await run(['search','launch','--agent','philosopher','reading'],{request});assert.equal(result.agent,'philosopher');
 const target=new URL(calls[1]);assert.equal(target.pathname,'/wizard/hermes/api/sessions');assert.equal(target.searchParams.get('agent'),'philosopher');assert.equal(target.searchParams.get('q'),'reading');assert.equal(result.threads[0].id,'phil_1');
 await assert.rejects(run(['search','launch','--agent','hermes','reading'],{request}),/different agent/);
 await assert.rejects(run(['search','launch','reading'],{request}),/different agent/);
});

test('Spaces helper creates, renames, deduplicates, adds, removes and deletes without mutating input', () => {
  const original=sample(), created=editSpaces(original,['create','Reading','wizard_2','wizard_2'])
  assert.equal(created.length,2);assert.equal(original.length,1)
  assert.match(created[1].id,/^[a-z0-9-]{1,48}$/);assert.ok(Number.isFinite(Date.parse(created[1].createdAt)))
  assert.deepEqual(created[1].threads,['wizard_2'])
  const renamed=editSpaces(original,['rename','launch','Launch next'])
  assert.equal(renamed[0].name,'Launch next');assert.equal(original[0].name,'Launch')
  assert.deepEqual(editSpaces(original,['add','launch','wizard_1','wizard_2'])[0].threads,['wizard_1','wizard_2'])
  assert.deepEqual(editSpaces(original,['remove','launch','wizard_1'])[0].threads,[])
  assert.deepEqual(editSpaces(original,['delete','launch']),[])
})
test('Spaces helper rejects malformed ids, names, duplicate names and limits', () => {
  for(const args of [['create',''],['create','x'.repeat(61)],['create','bad\nname'],['create','Launch'],['add','launch','<bad>'],['remove','launch'],['rename','launch'],['delete','launch','extra'],['add','missing','wizard_2'],['rename','BAD ID','name'],['surprise']]) assert.throws(()=>editSpaces(sample(),args))
  assert.throws(()=>editSpaces(Array.from({length:50},(_,i)=>({...sample()[0],id:'s-'+i})),['create','New']))
  assert.throws(()=>editSpaces(sample(),['add','launch',...Array.from({length:500},(_,i)=>'thread_'+i)]))
})
test('Spaces HTTP helper sends item operations, so an edit made meanwhile elsewhere survives', async () => {
  let state={compact:true,pinnedChats:['wizard_pin'],spaces:sample()}, calls=[]
  const request=async (u,o)=>{ calls.push({url:String(u),...o})
    if(o.method==='PATCH'){ const sp=structuredClone(state.spaces); sp[0].threads.push('wizard_elsewhere'); for(const op of JSON.parse(o.body).ops) if(op.op==='add'&&!sp[0].threads.includes(op.item)) sp[0].threads.push(op.item); state={...state,spaces:sp} }
    return Response.json(state) }
  const result=await run(['add','launch','wizard_2'],{url:'http://localhost/owner/ui-preferences',request})
  assert.deepEqual(calls.map(c=>c.method),['GET','PATCH'])
  assert.deepEqual(JSON.parse(calls[1].body),{ops:[{op:'add',key:'spaces/launch/threads',item:'wizard_2'}]})
  assert.deepEqual(result.spaces[0].threads,['wizard_1','wizard_elsewhere','wizard_2'])
  assert.deepEqual(spaceOps(sample(),['rename','launch','New']),[{op:'set',key:'spaces/launch/name',item:'New'}])
  assert.deepEqual(spaceOps(sample(),['delete','launch']),[{op:'remove',key:'spaces',item:'launch'}])
})
test('Spaces HTTP helper on an older service (no PATCH) read/merge/write/readback preserves all unrelated preferences', async () => {
  let state={compact:true,pinnedChats:['wizard_pin'],spaces:sample()}, calls=[]
  const request=async (u,o)=>{ calls.push({url:String(u),...o});if(o.method==='PATCH')return Response.json({},{status:405});if(o.method==='PUT')state={...state,...JSON.parse(o.body)};return Response.json(state) }
  const result=await run(['add','launch','wizard_2'],{url:'http://localhost/owner/ui-preferences',request})
  assert.deepEqual(result.spaces[0].threads,['wizard_1','wizard_2'])
  assert.deepEqual(calls.map(c=>c.method),['GET','PATCH','PUT','GET'])
  assert.deepEqual(Object.keys(JSON.parse(calls[2].body)),['spaces'])
  assert.deepEqual(state.pinnedChats,['wizard_pin']);assert.equal(state.compact,true)
})
test('Spaces helper list is read only and auth/old-service/readback errors are real failures',async()=>{
  let calls=0
  await run(['list'],{request:async()=>{calls++;return Response.json({spaces:sample()})}});assert.equal(calls,1)
  await assert.rejects(run(['list'],{request:async()=>Response.json({}, {status:403})}),/HTTP 403/)
  await assert.rejects(run(['list'],{request:async()=>Response.json({})}),/does not support Spaces/)
  await assert.rejects(run(['add','launch','wizard_2'],{request:async()=>Response.json({spaces:sample()})}),/read-back differs/)
})
