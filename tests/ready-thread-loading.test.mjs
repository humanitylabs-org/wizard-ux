import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../web/core/chats.js',import.meta.url),'utf8');
const start=source.indexOf('  async function loadThread('),end=source.indexOf('\n  }\n',start)+5;
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
function harness({pending=[],messages=async()=>['answer'],approval=async()=>false,detail=async()=>({})}={}){
 const c={readNav:1},w={id:'w',thread:'A'},row={id:'A',status:'completed',messageCount:2,detailNeeded:true},paints=[],retry=[];
 const context={Date,JSON,Number,Promise,clearTimeout(){},INC:null,PW:null,W:{w},ch:()=>c,turnsCurrent:()=>true,threadOnScreen:()=>true,
  pendingFor:()=>pending,isWorking:()=>false,LIVE:{session:()=>row,busy:()=>false,listTrusted:()=>true,cachedMessages:()=>null,contentKey:()=> 'v1',messages,sessionInfo:detail,forgetMessages(){}},
  toTurns:rows=>rows,retireLanded:()=>false,loadApproval:approval,elOf:()=>({}),track:{querySelector:()=>({})},
  renderLive:()=>paints.push([...c.turns]),renderThreadLive:()=>paints.push('error'),retryRead:(...args)=>retry.push(args),
  window:{WizReach:{failure(){}}}};
 const load=vm.runInNewContext(`(${source.slice(start,end)})`,context);
 return {load,c,w,row,paints,retry};
}
test('current answer is painted before delayed approval or detail, retaining the read generation',async()=>{
 const a=deferred(),d=deferred(),h=harness({approval:()=>a.promise,detail:()=>d.promise});
 const reading=h.load(h.w);await new Promise(r=>setImmediate(r));
 assert.equal(h.paints.length,1);assert.equal(h.paints[0][0],'answer');assert.equal(h.c.loadedNav,1);
 a.resolve(false);d.resolve({});await reading;assert.equal(h.c.loading,false);
});
test('pending voice send cannot suppress a history failure or automatic retry',async()=>{
 const h=harness({pending:[{kind:'reply',source:'voice',state:'sending'}],messages:async()=>{throw Error('synthetic offline')}});
 await h.load(h.w);assert.equal(h.c.err,'Couldn’t load this thread');assert.equal(h.retry.length,1);assert.equal(h.c.loading,false);
});
test('A to B to A ignores old completions without releasing the newest loading lock',async()=>{
 const old=deferred(),b=deferred(),fresh=deferred(),reads=[old,b,fresh];let index=0;
 const h=harness({messages:()=>reads[index++].promise});
 const p1=h.load(h.w);h.w.thread='B';h.c.readNav=2;const p2=h.load(h.w);
 h.w.thread='A';h.c.readNav=3;const p3=h.load(h.w);const lock=h.c.loading;
 old.resolve(['OLD_A']);b.resolve(['OLD_B']);await Promise.all([p1,p2]);
 assert.equal(h.c.loading,lock);assert.equal(h.paints.length,0);
 fresh.resolve(['CURRENT_A']);await p3;assert.equal(h.paints[0][0],'CURRENT_A');assert.equal(h.c.loadedNav,3);
});
