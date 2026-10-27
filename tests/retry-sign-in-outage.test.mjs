import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFileSync} from 'node:fs'
const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8')
const power=read('web/core/chat-power.js'),live=read('web/live.js'),outbox=read('web/outbox.js')
for(const surface of ['NEEDS RETRY card','Chats Errors Retry']) for(const attachmentOnly of [false,true]) test(`Retry resends a message that never reached the AI after a sign-in outage: ${surface}${attachmentOnly?' (attachment-only request)':''}`,async()=>{
 const sent=[],state={},notices=[],w={id:'win',app:'chats',thread:surface==='NEEDS RETRY card'?'wizard_outage':''}
 const s={id:'wizard_outage',status:'failed',request:attachmentOnly?'':'The complete saved request',retryRunId:'wizardq_'+'a'.repeat(32),model:'original',provider:'anthropic'}
 const ctx={console,URL,Intl,Date,setTimeout,clearTimeout,location:{origin:'https://fixture.invalid',href:'https://fixture.invalid/',hostname:'fixture.invalid'},navigator:{},localStorage:{getItem:()=>null,setItem(){},removeItem(){}},document:{addEventListener(){},querySelector:()=>null,createElement:()=>({style:{}})},addEventListener(){},WizCore:{esc:String,clip:s=>s},WizConfig:{owner:()=> 'Owner'},WizLive:{session:()=>({id:s.id,status:'failed',request:''}),sessionInfo:async()=>s},WosModels:{currentRoute:()=>({model:s.model,provider:s.provider})},WosOutbox:{enqueue:async it=>{sent.push(it);return it}}}
 ctx.window=ctx;vm.createContext(ctx);vm.runInContext(power,ctx)
 const api=ctx.WosChatPower({ch:()=>state,toast:(...x)=>notices.push(x),H:{win:()=>w},CH:{win:state},owner:()=>w.id,renderChats(){}})
 const selector=surface==='NEEDS RETRY card'?'[data-chretry]':'[data-errretry]'
 assert.equal(api.click({target:{closest:x=>x===selector?{dataset:{errretry:s.id}}:null}},w.id),true)
 for(let i=0;i<20&&!sent.length;i++)await new Promise(r=>setImmediate(r))
 assert.equal(sent.length,1);assert.equal(sent[0].text,s.request||'Retry');assert.equal(sent[0].retryRunId,s.retryRunId);assert.equal(sent[0].sessionId,s.id);assert.equal(sent[0].how,'retry');assert.equal(sent[0].model,'original');assert(!notices.some(x=>String(x[1]).includes('no request')))
})
test('detail hydration keeps failed status and saved retry identity on the list and durable outbox freezes it',async()=>{
 const body=live.slice(live.indexOf('    async sessionInfo(id) {'),live.indexOf('    /* ---- thread actions ---- */'))
 const s={id:'wizard_outage',status:'failed',request:'Saved',retryRunId:'wizardq_saved'},L={agentSessions:{},sessions:[{id:s.id,status:'completed'}],windows:{},agentOf:()=>''}
 const ctx={L,AGENT_OF:new Map(),DETAIL:new Map(),otherAgent:()=>false,normalize:()=>s,aq:()=>'',applyLocal(){},req:async()=>({json:async()=>({id:s.id,wizard_retry_input:'Saved'})})}
 vm.runInNewContext(`L.sessionInfo=({${body}}).sessionInfo`,ctx);await L.sessionInfo(s.id);assert.equal(L.sessions[0].status,'failed');assert.equal(L.sessions[0].retryRunId,s.retryRunId)
 assert.match(outbox,/retryRunId: typeof o.retryRunId === 'string' \? o.retryRunId : ''/);assert.match(outbox,/wizard_retry_run_id: it.retryRunId/)
})
