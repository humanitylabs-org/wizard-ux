// Production discovery/refresh source executed in a VM; network, DOM and list dependencies are facades.
// This is not browser, durable-storage or canonical routed-runtime acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {modelContext} from './fixtures/chats-list-model.mjs';
const live=readFileSync(new URL('../web/live.js',import.meta.url),'utf8');
const RID='bg_'+'a'.repeat(32);
function fixture() {
 const ctx=modelContext({document:{documentElement:{dataset:{tweaks:'wizard/background-continue'}},hidden:true},window:{addEventListener(){}},Date,Map,Set,Array,setTimeout,clearTimeout,WORKING:new Set(['submitting','queued','running','stopping']),L:{refresh(){}},listSignal:()=>({})});
 vm.runInContext(live.slice(live.indexOf('  const READY_OR_ATTENTION'),live.indexOf('  /* ---- thread-seen')),ctx);
 vm.runInContext(live.slice(live.indexOf('  /* Saved background results'),live.indexOf('  const FULL_EVERY'))+'; this.merge=mergeBackgroundResults;',ctx);
 return ctx;
}
const payload={results:[{id:RID,session_id:'old'}],sessions:[{id:'old',status:'completed',wizard_background_result:{id:RID,session_id:'old'}}],scanning:false};
test('disabling the tweak during GET prevents late row insertion',async()=>{
 const ctx=fixture(); let release; ctx.req=()=>new Promise(resolve=>{release=()=>resolve({json:async()=>payload});});
 const rows=[]; const pending=ctx.merge(rows); ctx.document.documentElement.dataset.tweaks=''; release(); await pending;
 assert.equal(rows.length,0);
});
for (const includeSession of [true,false]) test(`a working row clears its retained result with session projection ${includeSession}`,async()=>{
 const ctx=fixture();ctx.req=async()=>({json:async()=>({...payload,sessions:includeSession?payload.sessions:[]})});
 const rows=[{id:'old',status:'running',backgroundResult:{id:RID}}];await ctx.merge(rows);
 assert.equal(rows[0].status,'running');assert.equal(rows[0].backgroundResult,null);
});
test('held optional discovery does not block production refresh paint or routed refresh',async()=>{
 const ctx=fixture();let release,discovered=false,routed=0,emits=0;
 ctx.req=()=>{discovered=true;return new Promise(resolve=>{release=()=>resolve({json:async()=>({...payload,sessions:[],results:[]})});});};
 Object.assign(ctx,{STALE_AFTER:60000,FULL_EVERY:60000,SNAP_EVERY:60000,AGENT_WAIT:0,MAX:100,OVER:new Map(),fetchDispositions:async()=>({}),fetchSeen:async()=>({threads:{}}),fetchSessions:async()=>({sessions:[{id:'normal',status:'completed'}],complete:true}),otherAgent:()=>false,seenKeyOf:s=>s.id,applyLocal(){},addSynthetic(){},merge:()=>({threads:{}}),readLocal:()=>({threads:{}}),writeLocal(){},preload(){},writeSnap(){}});
 const start=live.indexOf('    async refresh() {');const end=live.indexOf('    /* Each non-default agent',start);
 vm.runInContext('this.refreshHolder={'+live.slice(start,end)+'};',ctx);
 const state={ok:true,at:Date.now(),fullAt:Date.now(),snapAt:Date.now(),cached:true,sessions:[],seen:{threads:{}},emit(){emits++;},refreshAgents:async()=>{routed++;}};
 const pending=ctx.refreshHolder.refresh.call(state);
 for(let i=0;i<30;i++)await Promise.resolve();
 assert.equal(discovered,true);assert.equal(state.sessions[0].id,'normal');
 const painted=emits>0,started=routed===1;
 release();await pending;assert.equal(painted,true,'ordinary list must paint before discovery finishes');assert.equal(started,true,'routed discovery must start independently');
});
test('a superseded discovery generation cannot mutate its old list',async()=>{
 const ctx=fixture();let release,current=true;ctx.req=()=>new Promise(resolve=>{release=()=>resolve({json:async()=>payload});});
 const rows=[];const pending=ctx.merge(rows,()=>current);current=false;release();await pending;assert.equal(rows.length,0);
});
