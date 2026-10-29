import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
const cut=(a,b)=>src.slice(src.indexOf(a),src.indexOf(b,src.indexOf(a)));
function scene(agent, focus={kind:'agent',key:agent.id}) {
 const main={id:'hermes',is_default:true}, A={ready:false,available:false,error:'',list:[],get(id){return this.list.find(a=>a.id===id)},defaultId:()=> 'hermes',isOther:id=>id!=='hermes',others(){return this.list.filter(a=>!a.hidden&&!a.is_default)}};
 const w={id:'w',focus}, collections=[{id:'routed-space',agent:agent.id}];let saves=0;
 const env={window:{WosAgents:A},W:{w},owner:id=>id,save:()=>saves++,spaces:()=>collections,spaceAgent:s=>s?.agent||'hermes',focusedAgent:f=>f?.kind==='space'?agent.id:f?.key||'',AGS:()=>A,agentRec:id=>A.get(id)||main};
 vm.createContext(env);vm.runInContext(cut('  function focusOf(', '  function matchesFocus(')+cut('  function winAgent(', '  function agentRec('),env);
 return {A,w,env,get saves(){return saves},load(){A.list=[main,agent];A.ready=A.available=true;}};
}
for(const kind of ['profile','container','restricted']) for(const hidden of [false,true]) test(`${kind} ${hidden?'hidden':'visible'} route survives delayed load and stays scoped`,()=>{
 const agent={id:'routed-'+kind,hidden,runtime:{kind}},s=scene(agent);
 assert.equal(s.env.focusOf(s.w).key,agent.id);assert.equal(s.env.winAgent(s.w),agent.id);assert.equal(s.saves,0);
 s.load();assert.equal(s.env.focusOf(s.w).key,agent.id);assert.equal(s.env.winAgent(s.w),agent.id);assert.equal(s.saves,0);
 assert.equal(s.env.focusAgents().some(a=>a.id===agent.id),!hidden);
 s.w.focus={kind:'space',key:'routed-space'};s.env.focusedAgent=f=>f?.kind==='space'?agent.id:f?.key||'';
 assert.equal(s.env.focusOf(s.w).key,'routed-space');assert.equal(s.env.winAgent(s.w),agent.id);
});
test('main uses the canonical default route, confirmed removed agents clear only after successful census',()=>{
 const s=scene({id:'hermes',is_default:true});s.env.focusedAgent=f=>f?.key||'';
 assert.equal(s.env.winAgent(s.w),'');
 s.w.focus={kind:'agent',key:'removed'};s.A.ready=true;s.A.error='offline';
 assert.equal(s.env.focusOf(s.w).key,'removed');assert.equal(s.saves,0);
 s.load();s.A.error='';assert.equal(s.env.focusOf(s.w),null);assert.equal(s.saves,1);
});
