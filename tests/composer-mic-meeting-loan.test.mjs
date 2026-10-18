import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
// Composer mic (#13) while Mizel records: the reply borrows the meeting's mic through the same handoff the orb uses
// (startVoice → WosOrbHandoff.begin) instead of refusing with "Microphone held by another app".
const phone=readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
const section=(s,a,b)=>s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)));
function harness({shared=null,startResult,stateAfter='listen',handoff=true}={}) {
  const calls={toasts:[],starts:0,pins:[],paint:[]};
  const V={state:'idle',native:null,replyTo:null};
  const c={V,calls,
    window:{WizAppCapture:{getState:()=>shared},WosOrbHandoff:handoff?{begin(){}}:undefined},
    toast:(...a)=>calls.toasts.push(a.join(' ')),
    shock(){},finishVoice(){},
    DEV:()=>({recActive:()=>'null'}),
    startVoice:async()=>{calls.starts++;V.state=stateAfter;V.native=stateAfter==='listen'?'rec-1':null;return startResult;},
    replyTake:(id,val)=>calls.pins.push([id,val]),
    CHATS:{WORKING_ST:new Set(['running']),PW:{paintMic:(on,sid)=>calls.paint.push([on,sid])}},
    LIVE:{session:()=>({status:'running',runId:'run-9'})}};
  vm.createContext(c);vm.runInContext(section(phone,'  function recordReply(','  async function startVoice(')+';this.recordReply=recordReply;',c);
  return c;
}
test('composer mic during a recording meeting borrows the mic and pins the reply to its thread',async()=>{
  const c=harness({shared:{active:true,recording:true,meetingId:'mt_a'}});
  const r=await c.recordReply('w1','thread-a');
  assert.equal(r,'recording');
  assert.equal(c.calls.starts,1,'started through the orb handoff path');
  assert.deepEqual(c.calls.toasts,[],'no "Microphone held by another app" refusal');
  assert.deepEqual(JSON.parse(JSON.stringify(c.V.replyTo)),{wid:'w1',sid:'thread-a',steerRunId:'run-9'});
  assert.deepEqual(JSON.parse(JSON.stringify(c.calls.pins)),[['rec-1',{wid:'w1',sid:'thread-a',steerRunId:'run-9'}]]);
  assert.deepEqual(c.calls.paint,[[true,'thread-a']]);
});
test('refused loan leaves no reply pin and no second toast',async()=>{
  const c=harness({shared:{active:true,recording:true},startResult:'busy',stateAfter:'idle'});
  assert.equal(await c.recordReply('w1','thread-a'),'none');
  assert.equal(c.V.replyTo,null);
  assert.deepEqual(c.calls.pins,[]);
  assert.deepEqual(c.calls.toasts,[],'startVoice already showed why');
});
test('without the handoff module the old truthful refusal remains',async()=>{
  const c=harness({shared:{active:true},handoff:false});
  assert.equal(await c.recordReply('w1','thread-a'),'none');
  assert.equal(c.calls.starts,0);
  assert.match(c.calls.toasts[0],/Microphone held by another app/);
});
test('no meeting: unchanged synchronous reply start',()=>{
  const c=harness({shared:null});
  assert.equal(c.recordReply('w1','thread-a'),'recording');
  assert.equal(c.calls.starts,1);
  assert.equal(c.V.replyTo.sid,'thread-a');
});
