import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { helperWorkingHarness, liveSource } from './helpers/helper-working-harness.mjs';
import { historyRevision, assessCache } from '../tools/ready-thread-speed/cache-evidence.mjs';
import { sampleId } from '../tools/ready-thread-speed/batch-preparation.mjs';
const source=readFileSync(new URL('../web/core/chats.js',import.meta.url),'utf8');
const start=source.indexOf('  async function loadThread('),end=source.indexOf('\n  }\n',start)+5;
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
function harness({pending=[],messages=async()=>['answer'],approval=async()=>false,detail=async()=>({}),live}={}){
 const c={readNav:1},w={id:'w',thread:'A'},row={id:'A',status:'completed',messageCount:2,detailNeeded:true},paints=[],retry=[];
 const context={Date,JSON,Number,Promise,clearTimeout(){},INC:null,PW:null,W:{w},ch:()=>c,turnsCurrent:()=>true,threadOnScreen:()=>true,
  pendingFor:()=>pending,isWorking:()=>false,LIVE:{session:()=>row,busy:()=>false,listTrusted:()=>true,cachedMessages:()=>null,contentKey:()=> 'v1',messages,sessionInfo:detail,forgetMessages(){}},
  toTurns:rows=>rows,retireLanded:()=>false,loadApproval:approval,elOf:()=>({}),track:{querySelector:()=>({})},
  renderLive:()=>paints.push([...c.turns]),renderThreadLive:()=>paints.push('error'),retryRead:(...args)=>retry.push(args),
  window:{WizReach:{failure(){}}}};
 if(live){
  context.LIVE=live;
  const t=source.indexOf('  function turnsCurrent('),e=source.indexOf('\n  }\n',t)+5;
  context.turnsCurrent=vm.runInNewContext(`(${source.slice(t,e)})`,context);
 }
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
test('focused cold setup reproduces retained-turn/no-read failure then requires exact new-thread read/cache provenance',async()=>{
 const ids=['current','empty'].map(state=>sampleId('rs17-phone-continuation',state,1));
 const raw=ids.map(id=>({id,source:'wizard-mobile',status:'completed',message_count:2,wizard_retry_input:'request',
  wizard_last_user_at:100,wizard_last_assistant_at:101,wizard_attention:{state:'done',ask:'saved'}}));
 const histories=new Map(ids.map((id,i)=>[id,[{role:'user',content:'request',timestamp:100},
  {role:'assistant',content:`SYNTHETIC_CURRENT_ANSWER_${i+1}_v1`,timestamp:101}]]));
 const h=helperWorkingHarness({source:liveSource(),row:raw[0],detail:{session:raw[0]}}),reads=[];
 const original=h.context.fetch;
 h.context.fetch=async(url,init)=>{
  const u=new URL(url,'https://fixture.invalid'),id=u.pathname.match(/\/sessions\/([^/]+)/)?.[1];
  if(u.pathname==='/wizard/hermes/api/sessions')return {ok:true,json:async()=>({data:structuredClone(raw),list_version:1,window:'archive-50',has_more:false})};
  if(u.pathname.endsWith('/messages')){
   const rows=histories.get(id),revision=historyRevision(rows);
   reads.push({id,url:String(url),capturedKey:h.L.contentKey(h.L.session(id)),revision});
   return {ok:true,json:async()=>({data:structuredClone(rows),has_more:false})};
  }
  if(id)return {ok:true,json:async()=>({session:raw.find(r=>r.id===id)})};
  return original(url,init);
 };
 await h.poll();const chat=harness({live:h.L});chat.w.thread=ids[0];
 await chat.load(chat.w);assert.equal(reads.length,1);
 await h.L.forgetMessages(ids[0]);chat.c.readNav++;
 const before=reads.length;await chat.load(chat.w);
 assert.equal(reads.length,before,'original same-thread setup takes real 60s quiet-history fast path');
 assert.equal(h.L.cachedMessages(ids[0]),null,'forget clears the real cache, not Chats turns');
 assert.equal(chat.c.turns.at(-1).content,histories.get(ids[0]).at(-1).content,'already-current answer remains paintable');
 assert.equal(assessCache({key:h.L.contentKey(h.L.session(ids[0])),trusted:h.L.listTrusted(),accepted:h.L.cachedMessages(ids[0])},historyRevision(histories.get(ids[0]))),'rejected-old-copy');
 await h.L.forgetMessages(ids[1]);assert.equal(h.L.cachedMessages(ids[1]),null);chat.w.thread=ids[1];chat.c.readNav++;
 await chat.load(chat.w);
 assert.equal(reads.length,before+1,'corrected distinct-thread setup must actually read');
 const actual=reads.at(-1),canonical=historyRevision(histories.get(ids[1]));
 assert.equal(actual.id,ids[1]);assert.equal(new URL(actual.url,'https://fixture.invalid').searchParams.get('limit'),'500');
 assert.equal(actual.capturedKey,canonical.key);assert.equal(actual.revision.contentSha256,canonical.contentSha256);
 assert.equal(assessCache({key:h.L.contentKey(h.L.session(ids[1])),trusted:h.L.listTrusted(),accepted:h.L.cachedMessages(ids[1])},canonical),'current-copy-refilled');
 assert.equal(historyRevision(chat.c.turns).contentSha256,canonical.contentSha256);
 console.log(JSON.stringify({original:{id:ids[0],history_reads_after_forget:0,accepted:null,retained_current_turns:true},corrected:{...actual,accepted_sha256:historyRevision(h.L.cachedMessages(ids[1])).contentSha256}}));
});
