import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source = readFileSync(new URL('../web/core/commands.js', import.meta.url),'utf8');
function fixture(){
 const box={WizCore:{norm:s=>String(s).toLowerCase().trim()},WosViews:{TODAY:'today',YESTERDAY:'yesterday'},WizConfig:{stripAddress:s=>s}};box.window=box;vm.runInNewContext(source,box);
 let calls=0;
 box.WosMusic={available:()=>true,parse(){calls++;return {op:'play'};}};
 const app={id:'calendar',name:'Calendar'};
 const c=box.WosCommands.create({CHATS:{UI:{},WORKING_ST:new Set()},APP:{calendar:app},findApp:()=>app,appByName:()=>app,quickSearch:()=>{calls++;return {query:'q',strong:true};},sendSnap:()=>({})});
 return {box,c,calls:()=>calls};
}
test('every non-command voice kind short-circuits all local parsers, regardless of text or view',()=>{
 const f=fixture();
 for(const kind of ['auto','tap','dictation','agent',undefined,null,''])for(const view of ['thread list','chat thread','app',undefined])for(const text of ['Google released a new model, Argon. I want you to do a deep dive on the benchmarks','Search for flights to Bangkok and book the cheapest','Music','play Home Tides','open calendar','help','order food','next desk']){
  assert.equal(f.c.parse(text,{view:{kind:view}},kind),null);
 }
 assert.equal(f.calls(),0);
});
test('held voice retains commands and typed auto preserves its existing grammar',()=>{
 const f=fixture();assert.equal(f.c.parse('search for birds',{view:{kind:'thread list'}},'command').action,'quick_search');
 assert.equal(f.c.parse('search for birds',{view:{kind:'thread list'}},'auto',true).action,'quick_search');
 assert.equal(f.box.WosCommands.isMessageTake('auto',true),false);
 assert.equal(f.box.WosCommands.isMessageTake('command'),false);
 assert.equal(f.box.WosCommands.isMessageTake('auto'),true);
});
