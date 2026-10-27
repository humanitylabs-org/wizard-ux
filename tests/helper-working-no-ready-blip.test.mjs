import test from 'node:test';
import assert from 'node:assert/strict';
import { helperWorkingHarness, liveSource } from './helpers/helper-working-harness.mjs';

const iso=new Date().toISOString();
// Turn-end race captured on the serving API: list has running + helper, latest
// queue run is completed; view=detail has retry input but NO lifecycle status.
const row={id:'helper-race-test',title:'TEST · helper handoff',listVersion:1,status:'running',waitingOn:'helper',helperStatus:{phase:'running',pending:1},lastRunKey:'test-send',lastRunStatus:'completed',lastUserAt:iso,lastAssistantAt:iso,updatedAt:iso,activityAt:iso};
const detail={id:row.id,title:row.title,wizard_retry_input:'Test only',agent:{id:'hermes'}};
const setup=(agent='')=>helperWorkingHarness({source:liveSource(),row:{...row,agent:agent||'hermes'},detail:{...detail,agent:{id:agent||'hermes'}},agent});
const checkWorking=h=>{assert.equal(h.rows()[0].status,'running');assert.equal(h.L.workGroups(h.rows()).working.length,1);assert.equal(h.L.workGroups(h.rows()).ready.length,0);};

test('a thread waiting on a helper stays in Working until the helper result is answered — no Ready blip at turn end', async()=>{
  const h=setup();
  // Phone send starts over an old Ready row, then the actual turn ends with a helper.
  h.put({...row,status:'completed',lastRunKey:'old'});h.send();
  await h.poll();checkWorking(h);
  await h.L.sessionInfo(row.id);checkWorking(h);
  // The bounded send hold must end, not become an indefinite helper workaround.
  h.advance(120001);h.sync();assert.equal(h.L.pending(row.id),null);checkWorking(h);
  await h.L.sessionInfo(row.id);checkWorking(h);
  // Helper completion/delivery is not an answer from the parent agent.
  h.setRow({...row,helperStatus:{phase:'waiting',pending:0,returned:1}});
  await h.poll();await h.L.sessionInfo(row.id);checkWorking(h);
  // A repeated partial-list merge reuses the hydrated object; it must remain Working.
  h.setRow({id:'other',listVersion:1,status:'completed'},true);
  await h.L.refresh();assert.equal(h.L.session(row.id).status,'running');
  // Real result integration releases via the next list projection, not via hydration.
  h.setRow({...row,status:'completed',waitingOn:'',helperStatus:null,lastAssistantAt:new Date(Date.now()+1000).toISOString()});
  await h.poll();
  await h.L.sessionInfo(row.id);assert.equal(h.rows()[0].status,'completed');assert.equal(h.L.workGroups(h.rows()).ready.length,1);
});

for(const agent of ['', 'host-profile','container','restricted']) test(`detail hydration cannot erase helper Working after PEND expires: ${agent||'main'}`,async()=>{
  const h=setup(agent);h.put({...row,agent:agent||'hermes'});h.send();h.advance(120001);h.sync();checkWorking(h);
  await h.L.sessionInfo(row.id);checkWorking(h);
});

test('detail begun before a list refresh cannot erase its newer helper status',async()=>{
  const h=setup();h.put({...row,status:'completed'});
  const release=h.deferDetail(), read=h.L.sessionInfo(row.id);
  await h.poll();checkWorking(h);release();await read;checkWorking(h);
});

test('explicit failure from detail still enables Retry; absent status is not a completion',async()=>{
  const h=setup();h.put({...row});h.setDetail({...detail,status:'failed',wizard_retry_run_id:'failed-run'});
  await h.L.sessionInfo(row.id);assert.equal(h.rows()[0].status,'failed');assert.equal(h.rows()[0].retryRunId,'failed-run');
});

test('explicit sign-in wait from detail preserves queued auto-send state',async()=>{
  const h=setup();h.put({...row});h.setDetail({...detail,status:'queued',queue_reason:'provider_access'});
  await h.L.sessionInfo(row.id);assert.equal(h.rows()[0].status,'queued');assert.equal(h.rows()[0].queueReason,'provider_access');
});
