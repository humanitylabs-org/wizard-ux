import test from 'node:test';
import assert from 'node:assert/strict';
import { helperWorkingHarness, liveSource } from './helpers/helper-working-harness.mjs';

const source = liveSource();
const row = { id:'synthetic-rename', title:'Old title', listVersion:1, status:'completed', updatedAt:'2026-11-06T00:00:00Z' };
const detail = title => ({ id:row.id, title, wizard_retry_input:'' });
const settle = () => new Promise(resolve=>setImmediate(resolve));
function setup(agent='',storage=new Map()) {
  const h=helperWorkingHarness({source,row:{...row,agent},detail:detail(row.title),agent,storage});
  h.context.WosAgents.ready=true;
  h.context.WosAgents.others=()=>agent?[{id:agent,privacy:'standard'}]:[];
  const original=h.context.fetch;
  let release, status=200, requestedTitle;
  h.context.fetch=async(url,init={})=>{
    if(init.method==='PATCH') {
      requestedTitle=JSON.parse(init.body).title;
      h.calls.push({url,method:'PATCH',body:JSON.parse(init.body)});
      await new Promise(r=>{release=r;});
      return {ok:status===200,status,json:async()=>({error:{message:status===409?'Title already in use':'Write failed'}})};
    }
    return original(url,init);
  };
  return {...h, poll:agent?()=>h.L.refreshAgents({},agent):h.poll, finish:(code=200,canonicalTitle=requestedTitle)=>{status=code;if(code===200)h.setDetail(detail(canonicalTitle));release();}};
}
for(const agent of ['', 'researcher']) test(`first rename survives stale poll and detail (${agent||'main'})`,async()=>{
  const h=setup(agent); await h.poll();
  const release=h.deferDetail(), oldDetail=h.L.sessionInfo(row.id);
  const saving=h.L.rename(row.id,'Owner title');
  assert.equal(h.rows()[0].title,'Owner title','same-frame paint, before PATCH response');
  await h.poll();
  assert.equal(h.rows()[0].title,'Owner title','poll while PATCH pending');
  h.finish(); assert.equal(await saving,true);
  await h.poll();
  assert.equal(h.rows()[0].title,'Owner title','cached old snapshot after PATCH success');
  h.setRow({...row,agent,title:'Owner title'}); await h.poll();
  release(); await oldDetail;
  assert.equal(h.rows()[0].title,'Owner title','old detail cannot undo acknowledged list title');
  assert.equal(h.calls.filter(c=>c.method==='PATCH').length,1,'no second rename needed');
});
test('a rejected rename rolls back without trapping the title',async()=>{
  const h=setup();await h.poll();const p=h.L.rename(row.id,'Taken title');
  await h.poll();h.finish(409);assert.equal(await p,'taken');
  assert.equal(h.rows()[0].title,row.title);
  h.setRow({...row,title:'Another device title'});await h.poll();
  assert.equal(h.rows()[0].title,'Another device title');
});
test('confirmed rename allows a later owner rename from another device',async()=>{
  const h=setup();await h.poll();const p=h.L.rename(row.id,'Owner title');h.finish();await p;
  h.setRow({...row,title:'Owner title'});await h.poll();
  h.setRow({...row,title:'Other owner title'});await h.poll();
  h.setDetail(detail('Other owner title'));await h.poll();await settle();
  assert.equal(h.rows()[0].title,'Other owner title');
});
for(const agent of ['', 'researcher'])test(`simultaneous second owner wins before any read observes the first title (${agent||'main'})`,async()=>{
  const h=setup(agent);await h.poll();const p=h.L.rename(row.id,'First owner');
  // The canonical store has already accepted a second client's rename by the
  // time this client's first post-write read arrives. No 'First owner' receipt.
  h.finish(200,'Second owner');await p;await settle();
  assert.equal(h.rows()[0].title,'Second owner');
  await h.poll();await settle();
  assert.equal(h.rows()[0].title,'Second owner','an older list snapshot still cannot undo canonical truth');
  assert.equal(h.calls.filter(c=>c.method==='PATCH').length,1);
});
test('successful first rename survives snapshot hydration and canonical reload',async()=>{
  const storage=new Map(), h=setup('',storage);await h.poll();
  const p=h.L.rename(row.id,'Owner title');h.finish();await p;
  assert.ok([...storage.values()].some(v=>v.includes('Owner title')),'snapshot updated on successful rename');
  const reloaded=helperWorkingHarness({source,row:{...row,title:'Owner title'},detail:detail('Owner title'),storage});
  assert.equal(reloaded.L.session(row.id).title,'Owner title','cached first paint');
  await reloaded.poll();await reloaded.L.sessionInfo(row.id);
  assert.equal(reloaded.L.session(row.id).title,'Owner title','canonical poll and detail after reload');
});
test('an independent thread is not blocked while a rename is pending',async()=>{
  const h=setup();await h.poll();h.L.sessions.push({...row,id:'other',title:'Independent'});
  const p=h.L.rename(row.id,'Owner title');
  assert.equal(h.L.session('other').title,'Independent');
  assert.equal(await h.L.rename(row.id,'Overlapping'),false,'same-thread write serialized');
  h.finish();assert.equal(await p,true);
});
