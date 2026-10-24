import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
// Composer mic (#13) while Mizel records (James, 18 Oct 2026: "the orb works … shouldn't the microphone button be
// triggering the same pathway"): recordReply has no admission logic of its own. It hands the reply pin to startVoice,
// the orb's recorder, which borrows the meeting's mic through WosOrbHandoff exactly as an orb tap does.
const phone=readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
const section=(s,a,b)=>s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)));
const reply=section(phone,'  function recordReply(','  async function startVoice(');
function harness({shared=null,admitting=false,admitReply=null}={}) {
  const calls={toasts:[],starts:[],sent:0};
  const V={state:'idle',native:null,replyTo:null,admitting,admitReply,admitSend:false};
  const c={V,calls,
    window:{WizAppCapture:{getState:()=>shared}},
    toast:(...a)=>calls.toasts.push(a.join(' ')),
    shock(){},finishVoice(){calls.sent++;},
    DEV:()=>({recActive:()=>'null'}),
    startVoice:(kind,opt)=>{calls.starts.push([kind,JSON.parse(JSON.stringify(opt||{}))]);return Promise.resolve();},
    CHATS:{WORKING_ST:new Set(['running']),isWorking:s=>!!s&&!s.archived&&s.status==='running'},
    LIVE:{session:()=>({status:'running',runId:'run-9'})}};
  vm.createContext(c);vm.runInContext(reply+';this.recordReply=recordReply;',c);
  return c;
}
test('composer mic has no separate microphone refusal: no "held by another app" branch',()=>{
  assert.doesNotMatch(reply,/Microphone held by another app/);
  assert.doesNotMatch(reply,/WizAppCapture/);
});
for (const shared of [null,{active:true,recording:true,meetingId:'mt_a'}]) {
  test('composer mic starts the orb recorder with the thread pin; meeting='+!!shared,()=>{
    const c=harness({shared});
    assert.equal(c.recordReply('w1','thread-a'),'recording');
    assert.deepEqual(c.calls.toasts,[]);
    assert.deepEqual(c.calls.starts,[['auto',{replyTo:{wid:'w1',sid:'thread-a',steerRunId:'run-9'}}]]);
  });
}
test('second mic tap while the meeting is lending its mic sends that reply once it opens (like the orb)',()=>{
  const c=harness({admitting:true,admitReply:{wid:'w1',sid:'thread-a'}});
  assert.equal(c.recordReply('w1','thread-a'),'sent');
  assert.equal(c.V.admitSend,true);assert.deepEqual(c.calls.starts,[]);
});
test('mic tap during an orb (non-reply) admission does not hijack it',()=>{
  const c=harness({admitting:true,admitReply:null});
  assert.equal(c.recordReply('w1','thread-a'),'busy');
  assert.equal(c.V.admitSend,false);assert.deepEqual(c.calls.starts,[]);
});
test('startVoice sets the reply pin with the take itself, so it survives the asynchronous loan',()=>{
  const sv=section(phone,'  async function startVoice(','\n  function ');
  assert.match(sv,/async function startVoice\(kind, opt = \{\}\)/);
  assert.match(sv,/replyTo: opt\.replyTo \|\| null/);
  assert.match(sv,/V\.admitReply=opt\.replyTo\|\|null/);
  assert.match(sv,/V\.native = id;if \(V\.replyTo\) replyTake\(id, V\.replyTo\)/);
  // The pin is assigned after the meeting loan is awaited, never before it (where the reset would wipe it).
  assert.ok(sv.indexOf('replyTo: opt.replyTo')>sv.indexOf('WosOrbHandoff.begin()'));
});
