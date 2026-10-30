import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {helperWorkingHarness, liveSource} from './helpers/helper-working-harness.mjs';
const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');
const chats=read('web/core/chats.js');

test('a failed provider start is actionable, not a running thread or passive sign-in notice',()=>{
 const start=chats.indexOf('  function threadState(s, agent) {'),end=chats.indexOf('  function renderThread(',start);
 const working=chats.match(/  const isWorking = .*;/)[0];
 const ctx={WORKING_ST:new Set(['queued','running']),window:{},agentName:()=> 'Wizard',ago:()=> 'now'};
 vm.runInNewContext(working+'\n'+chats.slice(start,end),ctx);
 const state=ctx.threadState({id:'synthetic',status:'queued',queueReason:'provider_access'},'');
 assert.equal(state.working,false); assert.match(state.sub,/could not start.*message saved.*choose another model/i);
 assert(!chats.includes('<b>Waiting for AI sign-in</b>'));
});
for(const agent of ['', 'host-profile','container','restricted']) test(`provider wait survives refresh and detail hydration in Errors: ${agent||'main'}`,async()=>{
 const row={id:'synthetic-provider-wait',title:'Synthetic saved request',status:'queued',queue_reason:'provider_access',wizard_retry_run_id:'wizardq_source',wizard_safe_error:'Selected provider could not start',model:'original',provider:'anthropic'};
 const h=helperWorkingHarness({source:liveSource(),row,detail:row,agent});
 await h.poll();await h.L.sessionInfo(row.id);
 const s=h.rows()[0];assert.equal(s.status,'queued');assert.equal(s.queueReason,'provider_access');assert.equal(s.retryRunId,'wizardq_source');
 assert.equal(h.L.workGroups(h.rows()).errors.length,1);assert.equal(h.L.workGroups(h.rows()).working.length,0);
 await h.poll();assert.equal(h.L.workGroups(h.rows()).errors.length,1);
});
test('provider wait immediately releases its own accepted send spinner, not a newer explicit retry hold',async()=>{
 const row={id:'synthetic-provider-wait',status:'queued',queue_reason:'provider_access',wizard_last_run_key:'test-send',wizard_run_id:'test-run'};
 const h=helperWorkingHarness({source:liveSource(),row,detail:row});await h.poll();h.send();
 assert.equal(h.L.pending(row.id),null);assert.equal(h.rows()[0].status,'queued');assert.equal(h.L.workGroups(h.rows()).errors.length,1);
 h.setRow({...row,wizard_last_run_key:'older-send',wizard_run_id:'older-run'});await h.poll();
 h.outbox._items.clear();h.outbox._items.set('new-retry',{id:'new-retry',kind:'reply',sessionId:row.id,text:'Saved',createdAt:Date.now(),state:'sent',sentAt:Date.now(),runId:'new-run'});h.sync();
 assert.equal(h.rows()[0].status,'running');assert.equal(h.L.workGroups(h.rows()).working.length,1);
});
test('provider-specific sign-in remains available alongside the model escape',()=>{
 const ctx={window:{},localStorage:{getItem:()=>null},document:{documentElement:{dataset:{}}}};ctx.window=ctx;
 vm.runInNewContext(read('web/core/chat-models.js'),ctx);
 const M=ctx.WosModels;M.name=()=> 'Original model';M.short=()=> 'Original';
 const s={id:'synthetic',model:'original',status:'queued',queueReason:'provider_access',safeError:'Synthetic preflight failed',reconnect:{appId:'wizard-claude',name:'Claude'}};
 const html=M.failureHtml({s,canRetry:true});
 for(const attr of ['data-chreconnect','data-chretrymodel','data-chretry'])assert(html.includes(attr));
 assert.match(html,/Synthetic preflight failed/);assert.match(html,/automatically on the same provider/);assert(!/disabled/.test(html));
 const diagnosed=M.failureHtml({s:{...s,status:'failed',queueReason:''},canRetry:true});
 assert(diagnosed.includes('data-chreconnect'));assert(!diagnosed.includes('data-chretrymodel'),'existing diagnosed-only policy is unchanged');
});
