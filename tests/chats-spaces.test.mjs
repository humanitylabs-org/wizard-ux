import test from 'node:test'
import assert from 'node:assert/strict'
import { editSpaces, run } from '../skills/wizard-spaces/scripts/wizard-spaces.mjs'
const sample = () => [{id:'launch',name:'Launch',threads:['wizard_1'],createdAt:'2026-10-24T00:00:00.000Z'}]
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
test('Spaces HTTP helper read/merge/write/readback preserves all unrelated preferences', async () => {
  let state={compact:true,pinnedChats:['wizard_pin'],spaces:sample()}, calls=[]
  const request=async (u,o)=>{ calls.push({url:String(u),...o});if(o.method==='PUT')state={...state,...JSON.parse(o.body)};return Response.json(state) }
  const result=await run(['add','launch','wizard_2'],{url:'http://localhost/owner/ui-preferences',request})
  assert.deepEqual(result.spaces[0].threads,['wizard_1','wizard_2'])
  assert.deepEqual(calls.map(c=>c.method),['GET','PUT','GET'])
  assert.deepEqual(Object.keys(JSON.parse(calls[1].body)),['spaces'])
  assert.deepEqual(state.pinnedChats,['wizard_pin']);assert.equal(state.compact,true)
})
test('Spaces helper list is read only and auth/old-service/readback errors are real failures',async()=>{
  let calls=0
  await run(['list'],{request:async()=>{calls++;return Response.json({spaces:sample()})}});assert.equal(calls,1)
  await assert.rejects(run(['list'],{request:async()=>Response.json({}, {status:403})}),/HTTP 403/)
  await assert.rejects(run(['list'],{request:async()=>Response.json({})}),/does not support Spaces/)
  await assert.rejects(run(['add','launch','wizard_2'],{request:async()=>Response.json({spaces:sample()})}),/read-back differs/)
})
