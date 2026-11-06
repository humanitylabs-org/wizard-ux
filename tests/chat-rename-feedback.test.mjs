import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../web/core/chats.js',import.meta.url),'utf8');
const body=source.slice(source.indexOf('  async function submitRename(form) {'),source.indexOf('  /* Live repaints rebuild'));
for(const result of [true,'taken',false])test(`rename action paints synchronously while the write is held; result ${result}`,async()=>{
 let finish;const calls=[],input={value:' Owner   title '};
 const c={rowSheet:{wid:'w',sid:'synthetic',rename:true},CH:{w:{}},W:{w:{id:'w',thread:'synthetic'}},
  closeRowSheet(){calls.push('close');c.rowSheet=null;},
  LIVE:{rename(id,title){assert.equal(id,'synthetic');assert.equal(title,'Owner title');calls.push('rename');return new Promise(r=>{finish=r;});}},
  H:{changed(){calls.push('host');}},renderChats(){calls.push('list');},renderThreadNow(){calls.push('thread');},toast(...args){calls.push(args[1]);}};
 vm.runInNewContext(body+';this.submitRename=submitRename;',c);
 const p=c.submitRename({querySelector:()=>input});
 assert.deepEqual(calls,['close','rename','list','host','thread'],'paint is inside the action before any I/O resolves');
 finish(result);await p;
 assert.ok(calls.some(x=>x=== (result===true?'Renamed':result==='taken'?'Another thread already has that name':'Couldn’t rename · kept the old name')));
 assert.deepEqual(calls.slice(-3),['list','host','thread'],'reconciled success or rollback is painted too');
});
