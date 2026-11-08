import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../web/core/chat-models.js', import.meta.url), 'utf8');
const SUB = 'claude-subscription-directsdk-experimental';
const payload = (native = true) => ({ provider:'openai-codex', model:'gpt-6.1-sol', providers:[
  {slug:'openai-codex',authenticated:true,models:['gpt-6.1-sol']},
  {slug:SUB,authenticated:true,models:['claude-opus-5-5[1m]','claude-sonnet-5-5']},
  {slug:'anthropic',authenticated:native,models:['claude-opus-5-5','claude-sonnet-5-5']}
] });
function models(connection, fail=false, catalogue=payload()) {
 const window={};
 const requests=[];
 const fetch=async (url,init) => {requests.push({url,init}); if(url.includes('/sessions/'))return {ok:true,json:async()=>({runtime:{model_lock:'accepted',model:'claude-opus-5-5',provider:'anthropic',selection_version:12}})};
 if(url.includes('wizard-claude')){if(fail)throw Error('offline'); return {ok:true,json:async()=>connection};}
 return {ok:true,json:async()=>url.includes('model/options')?catalogue:null};};
 vm.runInNewContext(source,{window,fetch,AbortSignal,console});
 return {M:window.WosModels,requests};
}
const native={accounts:[{id:'native',status:'ready'}]};
// James approved anthropic/claude-sonnet-5-5, then changed only the default to Sol.
// The Claude connection app uses `connected`; legacy advertises only Sonnet 5.
test('connected Claude keeps approved Sonnet 5.5 selectable after default switches to Sol',async()=>{
 const catalogue=payload(); catalogue.providers.find(p=>p.slug===SUB).models=['claude-opus-5-5[1m]','claude-sonnet-5[1m]'];
 const {M}=models({accounts:[{id:'claude-subscription',status:'connected'}]},false,catalogue); await M.load();
 const sonnet=M.popHtml({mode:'new',cur:{model:catalogue.model,provider:catalogue.provider},all:true}).list.find(o=>M.family(o.value,o.provider)==='claude:sonnet');
 assert(sonnet,'More models retains Sonnet'); assert.equal(sonnet.value,'claude-sonnet-5-5'); assert.equal(sonnet.provider,'anthropic');
 assert.equal(M.defaultOption().value,'gpt-6.1-sol'); assert.equal(M.defaultOption().provider,'openai-codex');
 assert(M.options.some(o=>o.provider===SUB&&o.value==='claude-sonnet-5[1m]'),'legacy option is preserved');
});
test('connected does not activate legacy-only or unauthenticated native routes',()=>{
 const {M}=models(null);
 assert.equal(M.hasNativeClaude({accounts:[{id:'legacy-claude-code',status:'connected'}]}),false);
 assert.equal(M.hasNativeClaude({accounts:[{id:'native',source:'legacy-claude-code',status:'connected'}]}),false);
 for(const status of ['expired','not_connected','error','unknown']) assert.equal(M.hasNativeClaude({accounts:[{id:'native',status}]}),false);
 assert(!M.normalize(payload(false),M.hasNativeClaude({accounts:[{id:'native',status:'connected'}]})).some(o=>o.provider==='anthropic'));
});
test('normal compact picker prefers native pool; explicit legacy remains selected and listed',async()=>{
 const {M}=models(native); await M.load();
 const pick=M.popHtml({mode:'new',cur:{model:'gpt-6.1-sol',provider:'openai-codex'}});
 const opus=pick.list.find(o=>M.family(o.value,o.provider)==='claude:opus');
 assert.equal(opus.provider,'anthropic'); assert.equal(opus.value,'claude-opus-5-5');
 assert.equal(M.defaultOption().provider,'openai-codex');
 assert.equal(M.visible('claude-opus-5-5[1m]',SUB).find(o=>M.family(o.value,o.provider)==='claude:opus').provider,SUB);
 assert(M.sheetHtml({mode:'thread',all:true}).list.some(o=>o.provider===SUB));
});
test('empty, legacy-only and unavailable connector preserve legacy picker',async()=>{
 for(const c of [null,{accounts:[]},{accounts:[{id:'legacy-claude-code',status:'ready'}]}]){
  const {M}=models(c);await M.load();assert.equal(M.visible().find(o=>M.family(o.value,o.provider)==='claude:opus').provider,SUB);
 }
 const {M}=models(null,true);await M.load();assert.equal(M.visible().find(o=>M.family(o.value,o.provider)==='claude:opus').provider,SUB);
});
test('native metadata does not offer unauthenticated native provider',()=>{
 const {M}=models(native);const opts=M.normalize(payload(false),true);assert(!opts.some(o=>o.provider==='anthropic'));
 assert.deepEqual(JSON.parse(JSON.stringify(M.normalize({providers:[]},true))),[]);
});
test('native route survives save, stale reconcile, reload, send resolution; explicit legacy not rewritten',async()=>{
 const {M,requests}=models(native);await M.load();
 const o=M.visible().find(o=>M.family(o.value,o.provider)==='claude:opus');
 await M.setThreadModel('test-thread',o);
 M.reconcile([{id:'test-thread',model:'gpt-6.1-sol',provider:'openai-codex',modelLockAt:0}]);
 await M.load(true);
 assert.equal(M.snapshot('test-thread').provider,'anthropic');
 assert.equal((await M.resolveRoute(M.snapshot('test-thread'))).provider,'anthropic');
 const write=requests.find(x=>x.url.includes('/sessions/'));assert.equal(JSON.parse(write.init.body).provider,'anthropic');
 assert.equal(JSON.parse(write.init.body).require_model_lock,true);
 assert.equal((await M.resolveRoute({model:'claude-opus-5-5[1m]',provider:SUB})).provider,SUB);
});
