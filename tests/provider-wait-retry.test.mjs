import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../web/core/chat-power.js',import.meta.url),'utf8');
function fixture(){
 const s={id:'synthetic',status:'queued',queueReason:'provider_access',retryRunId:'wizardq_source',request:'  Complete synthetic request\nwith all words  ',model:'original',provider:'anthropic'};
 const state={files:[{id:'draft-file'}],draft:'An unrelated unsent draft'},sent=[],notices=[],changes=[];
 let detail=()=>s,change=async o=>({model:o.value,provider:o.provider});
 const w={id:'win',thread:s.id},M={pending:new Map(),currentRoute:()=>({model:s.model,provider:s.provider}),setThreadModel:async(id,o)=>{changes.push(o);return change(o)}};
 const ctx={console,URL,Intl,Date,setTimeout,clearTimeout,location:{origin:'https://fixture.invalid'},navigator:{},localStorage:{getItem:()=>null,setItem(){},removeItem(){}},document:{addEventListener(){},querySelector:()=>null},addEventListener(){},WizCore:{esc:String,clip:s=>s},WizConfig:{owner:()=> 'Owner'},WizLive:{session:()=>s,sessionInfo:async()=>detail()},WosModels:M,WosOutbox:{unsent:()=>sent,enqueue:async it=>{sent.push(it);return it}}};ctx.window=ctx;
 vm.runInNewContext(source.replace('return { tweakModels, tweakModel,','return { pickModel, tweakModels, tweakModel,'),ctx);
 const api=ctx.WosChatPower({ch:()=>state,toast:(...x)=>notices.push(x),H:{win:()=>w},CH:{win:state},owner:()=>w.id,winAgent:()=>'',renderChats(){},renderThreadNow(){}});
 const option={value:'chosen',provider:'other-provider',name:'Chosen model'},selection={wid:w.id,sid:s.id,mode:'retry',retryRunId:s.retryRunId};
 return{api,s,state,sent,notices,changes,M,option,selection,setDetail:fn=>detail=fn,setChange:fn=>change=fn};
}
test('explicit new model saves before exactly one source-bound retry; full request and composer are untouched',async()=>{
 const h=fixture(),before=structuredClone(h.state);await h.api.pickModel(h.option,h.selection);
 assert.equal(h.changes.length,1);assert.equal(h.sent.length,1);assert.equal(h.sent[0].retryRunId,'wizardq_source');assert.equal(h.sent[0].text,h.s.request);assert.equal(h.sent[0].model,'chosen');assert.equal(h.sent[0].provider,'other-provider');assert.equal(h.state.draft,before.draft);assert.deepEqual(h.state.files,before.files);
 await h.api.retryThread('win',h.s.id);assert.equal(h.sent.length,1);
});
test('failed model acknowledgement leaves previous model and draft, and sends nothing',async()=>{
 const h=fixture();h.setChange(async()=>{throw Error('wrong model acknowledgement')});await h.api.pickModel(h.option,h.selection);
 assert.equal(h.s.model,'original');assert.equal(h.s.provider,'anthropic');assert.equal(h.sent.length,0);assert.equal(h.state.draft,'An unrelated unsent draft');assert.equal(h.state.files[0].id,'draft-file');
});
test('picker opened before automatic recovery never changes model or replays the stale source',async()=>{
 const h=fixture();h.setDetail(()=>({...h.s,status:'running',queueReason:'',retryRunId:''}));await h.api.pickModel(h.option,h.selection);
 assert.equal(h.changes.length,0);assert.equal(h.sent.length,0);assert(h.notices.some(x=>/request has changed/.test(x[1])));
});
test('recovery after model save but before retry hydration never becomes a fresh send',async()=>{
 const h=fixture();let reads=0;h.setDetail(()=>++reads===1?h.s:{...h.s,status:'running',retryRunId:''});await h.api.pickModel(h.option,h.selection);assert.equal(h.changes.length,1);assert.equal(h.sent.length,0);
});
test('pending model change blocks retry and picker without eating the draft',async()=>{
 const h=fixture();h.M.pending.set(h.s.id,Promise.resolve());await h.api.pickModel(h.option,h.selection);await h.api.retryThread('win',h.s.id);assert.equal(h.changes.length,0);assert.equal(h.sent.length,0);assert.equal(h.state.draft,'An unrelated unsent draft');
});
test('model selection changes only after an exact server acknowledgement, and failure keeps previous selection',async()=>{
 const ctx={console,localStorage:{getItem:()=>null},WizLive:{session:()=>({id:'synthetic',model:'original',provider:'anthropic'})}};ctx.window=ctx;
 let ack={runtime:{model_lock:'accepted',model:'wrong',provider:'other-provider'}},status=200;
 ctx.fetch=async()=>({ok:status===200,status,json:async()=>ack});
 vm.runInNewContext(readFileSync(new URL('../web/core/chat-models.js',import.meta.url),'utf8'),ctx);
 const M=ctx.WosModels;M.ready=true;M.providers=[];M.selections.set('synthetic',{model:'previous',provider:'previous-provider'});
 await assert.rejects(M.setThreadModel('synthetic',{value:'chosen',provider:'other-provider'}),/did not confirm/);assert.equal(M.selections.get('synthetic').model,'previous');assert.equal(M.pending.size,0);
 status=503;await assert.rejects(M.setThreadModel('synthetic',{value:'chosen',provider:'other-provider'}),/not changed/);assert.equal(M.selections.get('synthetic').model,'previous');
 status=200;ack={runtime:{model_lock:'accepted',model:'chosen',provider:'other-provider',selection_version:17}};
 await M.setThreadModel('synthetic',{value:'chosen',provider:'other-provider'});assert.equal(M.selections.get('synthetic').model,'chosen');assert.equal(M.selections.get('synthetic').version,17);assert.equal(M.pending.size,0);
});
test('concurrent Retry taps coalesce while detail is pending',async()=>{
 const h=fixture();let release;h.setDetail(()=>new Promise(r=>{release=()=>r(h.s)}));const first=h.api.retryThread('win',h.s.id);await h.api.retryThread('win',h.s.id);release();await first;assert.equal(h.sent.length,1);
});
