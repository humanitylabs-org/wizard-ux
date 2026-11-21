import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import { withParts } from './fixtures/chats-parts.mjs'; // chats.js parts moved out verbatim (issue 1665)
const source=withParts(readFileSync(new URL('../web/core/chats.js',import.meta.url),'utf8'));
const outbox=readFileSync(new URL('../web/core/chats-outbox.js',import.meta.url),'utf8'); // loadThread moved there (issue 1665)
const start=outbox.indexOf('  async function loadThread(w, force) {');
const end=outbox.indexOf('  return { echoed',start);
const code=outbox.slice(start,end);
test('pending transcript read cannot paint or retry after forget deletes its state',async()=>{
 let resolve,paints=0;const w={id:'w',thread:'sid'},c={readNav:1};
 const env={CH:{w:c},W:{w},INC:null,ch:()=>c,LIVE:{session:()=>null,messages:()=>new Promise(r=>resolve=r)},
 pendingFor:()=>[],isWorking:()=>false,toTurns:x=>x,retireLanded:()=>false,elOf:()=>{paints++;throw Error('disposed root');},
 loadApproval:async()=>false,renderThreadLive:()=>{paints++;},Date,JSON,clearTimeout};
 const load=vm.runInNewContext(code+';loadThread',env);const read=load(w,true);
 delete env.CH.w; resolve([{a:{text:'new answer'}}]);await read;
 assert.equal(paints,0);assert.equal(c.turns,undefined);assert.equal(c.loading,false);
});
test('forget cancels owned read, send, pointer and reading-place timers',()=>{
 const c={retryT:1,sentTimer:2,ptrT:3},cleared=[];
 const env={INC:null,CH:{w:c},listSaveT:{w:4},closeStream(){},closeHosted(){},clearReading(){},clearTimeout:t=>cleared.push(t)};
 const start=source.indexOf('  const forget = id =>'),end=source.indexOf('\n',start);
 const forget=vm.runInNewContext(source.slice(start,end)+';forget',env);forget('w');
 assert.deepEqual(cleared,[1,2,3,4]);assert.equal(env.CH.w,undefined);assert.equal(env.listSaveT.w,undefined);
});
