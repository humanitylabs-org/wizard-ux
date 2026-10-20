import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../web/core/chats.js',import.meta.url),'utf8');
const start=source.indexOf('  function openContextDraft('), end=source.indexOf('  function discardDraft(',start);
function fixture() {
 const store=new Map(), w={thread:null}, data={old:{text:'existing unsent words',files:[]}}, calls=[];
 const env={W:{w},winAgent:()=>false,saveDraft:()=>{},KIT:{drafts:{all:()=>JSON.parse(store.get('wos.chat.drafts.v1')||'{}')}},localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)},crypto:{randomUUID:()=> 'random-id'},Date,
 openNewDraft:(wid,slot)=>{const all=JSON.parse(store.get('wos.chat.drafts.v1'));if(slot!=='new'){if(all.new) all['new:previous']=all.new;all.new=all[slot];delete all[slot];}store.set('wos.chat.drafts.v1',JSON.stringify(all));calls.push(slot);}};
 store.set('wos.chat.drafts.v1',JSON.stringify(data));vm.createContext(env);vm.runInContext(source.slice(start,end)+';this.open=openContextDraft',env);return {env,store,calls};
}
test('canonical drafts preserve other words, deduplicate retries and keep edits',()=>{const f=fixture();const r=f.env.open('w','notifications:abc','quoted DATA');assert.equal(r.sent,false);const all=JSON.parse(f.store.get('wos.chat.drafts.v1'));assert.equal(all.old.text,'existing unsent words');all.new.text+=' user edit';f.store.set('wos.chat.drafts.v1',JSON.stringify(all));assert.equal(f.env.open('w','notifications:abc','replacement').id,r.id);assert.match(JSON.parse(f.store.get('wos.chat.drafts.v1')).new.text,/user edit/);});
test('reload cannot recreate a draft after it was discarded or sent',()=>{const f=fixture();f.env.open('w','notifications:abc','DATA');f.store.set('wos.chat.drafts.v1','{}');assert.throws(()=>f.env.open('w','notifications:abc','DATA'),/already opened/);});
test('storage failure is not reported as success',()=>{const f=fixture();f.env.localStorage.setItem=()=>{throw Error('quota');};assert.throws(()=>f.env.open('w','notifications:abc','DATA'),/quota/);assert.equal(f.calls.length,0);});
