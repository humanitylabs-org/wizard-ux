import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import { withShellParts } from './fixtures/shell-parts.mjs';
import { runRecording } from './fixtures/source-slice.mjs';
// Composer mic (#13) while Mizel records (James, 18 Oct 2026: "the orb works … shouldn't the microphone button be
// triggering the same pathway"): recordReply has no admission logic of its own. It hands the reply pin to startVoice,
// the orb's recorder, which borrows the meeting's mic through WosOrbHandoff exactly as an orb tap does.
const phone=withShellParts(readFileSync(new URL('../web/app.js',import.meta.url),'utf8'));
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
// Runs the real startVoice (app.js) with a meeting holding the mic: the loan is awaited, and the take that starts
// afterwards carries the reply pin (V.replyTo, replyTake) instead of losing it to the take's reset.
function voice({ meeting = true } = {}) {
  let lend; const loan = { id: 'mt_a', native: true };
  const V = { state: 'idle', native: null, replyTo: null, admitting: false, admitReply: null, admitSend: false, stopAsked: false };
  const window = { WizAppCapture: { getState: () => (meeting ? { active: true, recording: true, meetingId: 'mt_a' } : null) },
    WosOrbHandoff: { begin: () => new Promise(r => { lend = r; }), end: async () => {}, bind() {} } };
  const dev = { recActive: () => 'null', recStart: () => 'take-1', recStartBorrowed: () => 'take-1', recCancel() {} };
  const ctx = runRecording(sv + '\nglobalThis.startVoice = startVoice;', { V, window, parking: false, parkedReply: null, document: { activeElement: null }, performance,
    DEV: () => dev, CHATS: { incognitoActive: () => false, modelRoute: () => ({ agent: 'hermes' }) }, sendSnap: () => ({ view: { id: 'w1', thread: 'thread-a' }, route: { agent: 'hermes' } }),
    generalVoiceSnap: () => null, store: { get: () => true, set() {} }, requestAnimationFrame: () => 1, setTimeout: () => 0, clearTimeout() {} });
  return { ctx, V, lend: () => lend(loan), started: () => ctx.calls.filter(c => c[0] === 'replyTake').map(c => JSON.parse(JSON.stringify(c.slice(1)))) };
}
const sv=section(phone,'  async function startVoice(','\n  function ');

test('startVoice sets the reply pin with the take itself, so it survives the asynchronous loan',async()=>{
  const pin={wid:'w1',sid:'thread-a',steerRunId:'run-9'};
  const h=voice();
  const run=h.ctx.startVoice('auto',{replyTo:pin});
  assert.equal(h.V.admitting,true,'the meeting is asked to lend its mic first');
  assert.deepEqual({...h.V.admitReply},pin,'a second tap during the loan knows which reply it is for');
  assert.deepEqual(h.started(),[],'no take before the loan');
  h.lend(); await run;
  assert.equal(h.V.admitting,false); assert.equal(h.V.admitReply,null);
  assert.equal(h.V.native,'take-1');
  assert.deepEqual({...h.V.replyTo},pin,'the take after the loan still carries the pin');
  assert.deepEqual(h.started(),[['take-1',pin]],'and the native take is pinned to that reply');
  // no meeting, no opt: the take starts unpinned
  const g=voice({meeting:false}); await g.ctx.startVoice('auto');
  assert.equal(g.V.replyTo,null); assert.deepEqual(g.started(),[]); assert.equal(g.V.native,'take-1');
});
