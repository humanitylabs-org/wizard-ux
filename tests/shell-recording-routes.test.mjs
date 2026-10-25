import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const app=readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
const park=app.slice(app.indexOf('  async function parkReply()'),app.indexOf('  function restoreReply()'));
const cancel=app.slice(app.indexOf('  async function cancelVoice(quiet)'),app.indexOf('    cancelTakeFiles();',app.indexOf('  async function cancelVoice(quiet)')))+'\n}';
for(const route of ['main','host-profile','container','restricted'])test(`async companion stop parks only the ${route} reply before ack`,async()=>{
  for(const full of [false,true]){
    const events=[];let fetched=full,payload;
    const id='take-'+route,blob=new Blob(['original-'+route]);
    const dev={fetched:()=>fetched,recStop:()=>{events.push('stop');return fetched?JSON.stringify({id,bytes:blob.size}):'null';}};
    if(!full)dev.fetch=async()=>{events.push('fetch');await Promise.resolve();fetched=true;};
    const V={state:'paused',replyTo:{wid:route,sid:'thread-'+route},native:id,kind:'auto',acc:4000,files:[],parts:[],chunks:[],snap:{route:{agent:route,model:'fixture',provider:'fixture'}}};
    const ctx={V,Blob,structuredClone,parking:false,parkedReply:null,DEV:()=>dev,voiceRecovery(){events.push('journal')},nativeBlob:()=>blob,
      CHATS:{composerBusy:()=>false,takeComposer:(wid,sid)=>{assert.equal(wid,route);assert.equal(sid,'thread-'+route);return{text:'draft-'+route,files:[]}}},
      OUTBOX:{async stage(o){payload=o;events.push('stage');return{id:'held-'+route,durable:true}},async transition(){events.push('durable')}},
      recDone:tid=>{assert.equal(tid,id);events.push('ack')},stopStream(){},cancelAnimationFrame(){},setVoice(){},txPill(){}};
    vm.createContext(ctx);vm.runInContext(park,ctx);await ctx.parkReply();
    assert.equal(payload.sessionId,'thread-'+route);assert.equal(payload.agent,route);assert.equal(payload.nativeId,id);
    assert.equal(await payload.audio.text(),'original-'+route);assert.equal(payload.parkedDraft.typed,'draft-'+route);
    assert.ok(events.indexOf('ack')>events.indexOf('durable'));
    if(!full)assert.ok(events.indexOf('fetch')<events.indexOf('stop'));
  }
});
test('meeting cancellation awaits async shell bytes and keeps custody before acknowledgement',async()=>{
  let fetched=false;const events=[],id='take-meeting',blob=new Blob(['original']);
  const dev={fetched:()=>fetched,async fetch(){events.push('fetch');fetched=true},recStop:()=>fetched?JSON.stringify({id,bytes:blob.size}):'null'};
  const ctx={parking:false,V:{native:id,meetingLoan:{id:'loan'},kind:'auto',acc:4000},DEV:()=>dev,voiceRecovery(){},nativeBlob:()=>blob,setVoice(){},toast(){},
    window:{WosOrbHandoff:{async end(){events.push('end')}}},OUTBOX:{async capture(b){assert.equal(b,blob);events.push('capture');return{id:'held',durable:true}},async transition(){events.push('durable')}},recDone(){events.push('ack')}};
  vm.createContext(ctx);vm.runInContext(cancel,ctx);await ctx.cancelVoice();
  assert.deepEqual(events,['fetch','end','capture','durable','ack']);
});
