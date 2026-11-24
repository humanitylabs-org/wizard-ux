import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { withParts } from './fixtures/chats-parts.mjs'; // chats.js parts moved out verbatim (issue 1665)
const src = withParts(readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8'));
const cut = (a,b) => src.slice(src.indexOf(a),src.indexOf(b,src.indexOf(a)));
function fixture(agentIds, collections, focus = null, remembered = {}, spaceOwner = 'hermes') {
  const env = { spaceAgent: s => s?.agent || 'hermes', focusAgents: () => agentIds.map(id=>({id,label:id==='hermes'?'Archimedes':id})), visibleSpaces:()=>collections, spaces:()=>collections,
    focusOf:()=>focus, focusedAgent:f=>f?.kind==='agent'?f.key:f?.kind==='space'?spaceOwner:'',
    esc:s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
    AGS:()=>({colour:()=>'',sigil:()=>'',isPrivate:()=>false}),agentRec:id=>({id}),
    LIVE:{unified:()=>[],spaceSessions:()=>({rows:[]}),workGroups:()=>({archive:[]}),isNew:()=>false}, matchesFocus:()=>true, rememberedFocus:(w,a)=>remembered[a]||{kind:'agent',key:a} };
  vm.createContext(env);
  vm.runInContext(cut('  function focusOptions()', '  function focusSection(')+cut('  function focusUseful()', '  // One local picker'), env);
  return env.focusStrip({});
}
test('one agent without Spaces has no strip',()=>assert.equal(fixture(['hermes'],[]),''));
test('one agent exposes All, flat Space choices and a labelled New channel chip',()=>{
  const html=fixture(['hermes'],[{id:'a',name:'Launch'},{id:'b',name:'Apps'}],{kind:'space',key:'a'});
  assert.deepEqual([...html.matchAll(/data-chfocusopt="([^"]+)"/g)].map(x=>x[1]),['all:','space:a','space:b']);
  assert.match(html,/data-chspacenew aria-label="New channel"/);
  assert.match(html,/space:a" aria-pressed="true"/);
  assert.match(html,/<span>Apps<\/span>/); // Selected Space cannot rename its siblings.
  assert.doesNotMatch(html,/ch-focus-caret|data-chfocusopt="agent:/);
});
test('multiple agents retain agent tabs, no flat Spaces or add chip',()=>{
  const html=fixture(['hermes','private'],[{id:'a',name:'Launch'}]);
  assert.deepEqual([...html.matchAll(/data-chfocusopt="([^"]+)"/g)].map(x=>x[1]),['all:','agent:hermes','agent:private']);
  assert.doesNotMatch(html,/data-chspacenew/);
});
test('row-created Space persists its thread and never starts the fill run',async()=>{
  let saved,ran=false;const p={name:' First ',agent:'hermes',sid:'thread-1',wid:'w'};
  const env={spacePicker:p,spaces:()=>[],spaceAgent:s=>s.agent,norm:s=>s.toLowerCase(),renderSpacePicker(){},crypto:{randomUUID:()=> 'new-space'},Date,
    LIVE:{prefOps:async (ops,o)=>(saved={ops,o},true)},window:{dispatchEvent(){}},Event,
    closeSpacePicker(){},W:{w:{}},setFocus(){},sendChat:async()=>{ran=true;}};
  vm.createContext(env);vm.runInContext(cut('  async function createPickerSpace(', '  function bindFocusStrip('),env);
  await env.createPickerSpace(p);
  // One add operation (never this device's whole list), and only once the box has it.
  assert.deepEqual(JSON.parse(JSON.stringify(saved.ops)).map(o=>[o.op,o.key,o.item.threads,o.item.name]),[['add','spaces',['thread-1'],'First']]);
  assert.equal(saved.o.requireShared,true);assert.equal(ran,false);
});
// wizard-ux issue 1340: a channel is a feed, never the agent tab's name (phone strip read
// "WizardOS Apps" after General, where "Archimedes" belongs).
test('an agent tab always names its agent, never a channel (main and routed agents)',()=>{
  // Main (hermes) plus a routed agent of each runtime kind, each with its own remembered channel.
  for (const [ag, kind] of [['hermes','main'],['host-ops','host'],['box','container'],['locked','restricted']]) {
    const label = ag==='hermes' ? 'Archimedes' : ag, sp=[{id:'apps-'+ag,name:'WizardOS Apps '+kind,agent:ag}], rem={[ag]:{kind:'space',key:'apps-'+ag}};
    const ids = ag==='hermes' ? ['hermes','other'] : ['hermes',ag];
    for (const focus of [null,{kind:'agent',key:ag},{kind:'space',key:'apps-'+ag}]) {
      const html=fixture(ids,sp,focus,rem,ag);
      assert.match(html,new RegExp(`agent:${ag}"[^>]*><span>${label}</span>`),kind+' '+JSON.stringify(focus));
      assert.doesNotMatch(html,/WizardOS Apps/,kind);
    }
  }
});
test('the agent tab opens the agent, not the channel it last had (main and routed agents)',()=>{
  for (const ag of ['hermes','host-ops','box','locked']) {
    const run=()=>{const env={W:{w:{id:'w',agentFocus:{[ag]:{kind:'space',key:'apps'}}}},owner:id=>id,spaces:()=>[{id:'apps',name:'WizardOS Apps',agent:ag}],spaceAgent:s=>s?.agent||'hermes'};
      vm.createContext(env);vm.runInContext(cut('  function rememberedFocus(', '  function addFilter('),env);return JSON.parse(JSON.stringify(env.rememberedFocus({id:'w'},ag)));};
    assert.deepEqual(run(),{kind:'agent',key:ag},ag);
  }
});
