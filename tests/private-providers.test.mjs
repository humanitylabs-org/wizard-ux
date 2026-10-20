import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read = p => readFileSync(new URL(`../web/${p}`, import.meta.url), 'utf8');
const providers = [
  {id:'wizard-tinfoil', label:'Tinfoil', confidential:true, kind:'attested-relay', available:true, models:[{id:'relay-model',label:'Relay model'}]},
  {id:'wizard-local-model', label:'Local model', confidential:true, kind:'local', available:true, models:[{id:'owned-model',label:'Owned model'}]},
  {id:'another-relay',label:'Another relay',confidential:true,kind:'attested-relay',available:false,models:[]},
];
const agent = (id, provider, model, extra={}) => ({id,label:id,privacy:'private',model:{provider,model,allowed_models:[model],fallback:false},...extra});
async function setup({rows=providers, agents=[], query='?new=1', ui=false}={}) {
  const handlers={}, root={innerHTML:'',addEventListener:(name,fn)=>handlers[name]=fn};
  const document={documentElement:{dataset:{leaving:true,skin:'nebula'}},querySelectorAll:()=>[],addEventListener(){},getElementById:id=>id==='app'?root:{hidden:true,focus(){},select(){},classList:{toggle(){}}}};
  const calls=[];
  const ctx={document,location:{pathname:'/agents/index.html',search:query,origin:'http://test'},URLSearchParams,console,setInterval(){},setTimeout,clearTimeout,scrollTo(){},addEventListener(){},fetch:async path=>{
    calls.push(path);return {ok:true,status:200,json:async()=>path.includes('agent-options')?{providers:rows,harnesses:[{id:'hermes',label:'Hermes'}]}:path.endsWith('/agents')?{agents}:path.includes('model/options')?{provider:'anthropic',model:'claude-opus-5-5',providers:[{slug:'anthropic',models:['claude-opus-5-5']},{slug:'wizard-tinfoil',is_user_defined:true,authenticated:true,models:['not-private']}]}:{bindings:[]}};
  }};
  ctx.window=ctx;ctx.parent=ctx;
  ctx.WizardApp={back:{register(){},push(){return {release(){}}}},ready(){}};
  vm.createContext(ctx);vm.runInContext(read('core/agents.js'),ctx);vm.runInContext(read('core/chat-models.js'),ctx);
  if(ui) {vm.runInContext(read('agents/agents.js'),ctx);await new Promise(setImmediate);}
  else {await ctx.WosAgents.load();await ctx.WosAgents.loadOptions();}
  const click=dataset=>handlers.click({target:{closest:()=>({dataset,getAttribute:()=>''})}});
  return {A:ctx.WosAgents,M:ctx.WosModels,ctx,root,click,calls};
}
test('provider picker renders every installed private provider by API name, including unavailable',async()=>{
  const {ctx,root,click}=await setup({ui:true});ctx.__agents.state().draft.label='New';click({next:''});
  for(const p of providers) assert.match(root.innerHTML,new RegExp(`data-v="${p.id}"`));
  assert.match(root.innerHTML,/Another relay/);assert.match(root.innerHTML,/Unavailable/);
  assert.doesNotMatch(root.innerHTML,/Confidential: encrypted, attested hardware|A confidential provider can’t read/);
});
test('empty private-provider picker links to Store search even when public providers exist',async()=>{
  const {ctx,root,click}=await setup({ui:true,rows:[{id:'anthropic',models:[]}]});ctx.__agents.state().draft.label='New';click({next:''});
  assert.match(root.innerHTML,/href="\.\.\/store\/index.html\?q=private" data-store>Install a private provider/);
});
test('privacy wording is kind-based and never asserts encryption for local or unknown',async()=>{
  const {A}=await setup();
  assert.equal(A.privacyPromise(providers[0]),'Encrypted on this box; Tinfoil can’t read it');
  assert.equal(A.privacyPromise(providers[1]),'Runs on a machine you own');
  assert.equal(A.privacyPromise(providers[2]),'Encrypted on this box; Another relay can’t read it');
  assert.equal(A.privacyPromise({confidential:true}),'Private provider · no fallback');
});
for(const id of ['tinfoil','wizard-tinfoil']) test(`detail/model labels resolve ${id} against installed API provider`,async()=>{
  const {root,A}=await setup({ui:true,query:'?agent=private',agents:[agent('private',id,'relay-model')]});
  assert.equal(A.providerLabel(id),'Tinfoil');assert.equal(A.modelName(A.get('private'),'relay-model'),'Relay model');
  assert.match(root.innerHTML,/data-privacy-promise>Encrypted on this box; Tinfoil can’t read it/);
});
test('Private group contains only private agents’ allowed models on their own provider',async()=>{
  const agents=[agent('hermes','wizard-tinfoil','host-model',{is_default:true,privacy:'standard'}),agent('sealed','tinfoil','relay-model'),agent('owned','wizard-local-model','owned-model'),agent('public','anthropic','public-model',{privacy:'standard'})];
  const {M}=await setup({agents});await M.load();
  const priv=M.privateOptions();assert.equal(priv.length,2);
  assert.deepEqual(new Set(priv.map(o=>o.agent)),new Set(['sealed','owned']));
  assert.equal(priv.find(o=>o.agent==='owned').provider,'wizard-local-model');
  assert.equal(priv.find(o=>o.agent==='sealed').name,'Relay model');
  for(const render of ['sheetHtml','popHtml']) {
    const {list,html}=M[render]({mode:'new',all:true,priv});
    assert.equal(list.filter(o=>o.private).length,2);assert.doesNotMatch(html,/not-private|Set up Tinfoil/);
  }
  assert.equal((await M.resolveRoute({agent:'sealed',model:'relay-model'})).provider,'tinfoil');
  await assert.rejects(M.resolveRoute({agent:'owned',model:'relay-model'}),/can’t use/);
});
test('model API load does not call Tinfoil status; legacy saved recordings keep their route',async()=>{
  const {M,calls}=await setup();await M.load();assert.ok(!calls.some(p=>p.includes('/wizard-tinfoil/')));
  assert.equal((await M.resolveRoute({model:'glm-5-3',provider:'tinfoil'})).provider,'custom:tinfoil-operator');
});
test('provider-neutral main picker excludes installed private routes, not just Tinfoil',async()=>{
  const {M}=await setup();M.ready=true;
  M.options=M.normalize({provider:'anthropic',model:'claude-opus-5-5',providers:[{slug:'another-relay',authenticated:true,is_user_defined:true,models:['host-private']},{slug:'wizard-local-model',authenticated:true,is_user_defined:true,models:['host-local']},{slug:'anthropic',authenticated:true,models:['claude-opus-5-5']}]});
  assert.equal(M.mainOptions().length,1);
  for(const render of ['sheetHtml','popHtml']) assert.doesNotMatch(M[render]({all:true,mode:'new'}).html,/host-private|host-local/);
});
test('stale or unavailable private provider models are not selectable',async()=>{
  const {A,M}=await setup({agents:[agent('stale','wizard-local-model','removed-model'),agent('offline','another-relay','old-model')]});
  assert.equal(A.modelOptions(A.get('stale')).length,0);assert.equal(M.privateOptions().length,0);
});
test('nested Agents Back closes sheet, detail then stays at root without navigating',async()=>{
  const {ctx,click}=await setup({ui:true,query:'?agent=private',agents:[agent('private','wizard-local-model','owned-model')]});
  click({rename:''});assert.equal(ctx.__agents.state().sheet,'rename');ctx.__agents.back();
  assert.equal(ctx.__agents.state().view.name,'detail');ctx.__agents.back();assert.equal(ctx.__agents.state().view.name,'list');
  assert.equal(ctx.__agents.back(),false);assert.equal(ctx.location.pathname,'/agents/index.html');
});
test('Agents styling uses only Appearance tokens outside its dark fallback; Signal has shape',()=>{
  const css=read('agents/agents.css'), body=css.slice(css.indexOf('html {'));
  assert.doesNotMatch(body,/#(?:[a-f\d]{3,8})\b|rgba?\(|hsla?\(|var\(--(?:ink|red|green|amber|violet)/i);
  assert.match(css,/--c-text: var\(--wz-text, #f3efff\)/);assert.match(css,/data-skin="signal"/);
});
