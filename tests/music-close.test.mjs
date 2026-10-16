import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../web/core/background-audio.js', import.meta.url),'utf8');
const shell = readFileSync(new URL('../web/app.js', import.meta.url),'utf8');
function fixture({native=true, known=true}={}) {
  const sent=[], replies=[], listeners={}, timers=new Map(); let seq=0;
  const origin='https://wizard.example';
  const win={location:{href:origin+'/wizard-music/'},document:{documentElement:{}},postMessage:m=>replies.push(m)};
  const frame={contentWindow:win,isConnected:true,hasAttribute:()=>false,getAttribute:()=>'/wizard-music/'};
  const state={sessionId:'session-one',playing:true,wantPlaying:true,positionMs:12345,queue:[{id:'lib:one'}],index:0};
  const c={location:{origin,href:origin+'/wizard-os-home/'},document:{querySelectorAll:()=>[frame]},URL,console,
    setTimeout:fn=>{const id=++seq;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),addEventListener:(name,fn)=>listeners[name]=fn};
  if(native)c.wizardAudioPort={postMessage:raw=>sent.push(JSON.parse(raw))};
  c.window=c; vm.createContext(c); vm.runInContext(source,c);
  c.WizBackgroundAudio.init(()=>({'wizard-music':{url:'/wizard-music/'}}),()=>true);
  if(known)c.WizBackgroundAudio.lastState={...state};
  const answer=(command=sent.at(-1),ok=true)=>{
    if(ok&&command.method==='pause'){state.playing=false;state.wantPlaying=false;}
    c.wizardAudioPort.onmessage({data:JSON.stringify({id:command.id,ok,result:{...state},error:ok?undefined:'Native refused'})});
  };
  const message=(method,params={sessionId:state.sessionId})=>listeners.message({source:win,origin,data:{type:'wizard:background-audio:v1',id:'frame-'+sent.length,method,params}});
  return {c,sent,replies,frame,state,answer,message,timers,listeners};
}
test('explicit Music close immediately pauses native playback even after frame removal',async()=>{
  const f=fixture(); const closed=f.c.WizBackgroundAudio.closeApp('wizard-music');
  assert.equal(f.sent.length,1); assert.equal(f.sent[0].method,'pause');
  assert.equal(f.sent[0].sessionId,'session-one');assert.equal(f.sent[0].appId,'wizard-music');assert.equal(f.sent[0].v,1);
  f.frame.isConnected=false;f.answer();await closed;
  assert.equal(f.state.playing,false);assert.equal(f.state.wantPlaying,false);
  assert.equal(f.state.positionMs,12345);assert.equal(f.state.queue[0].id,'lib:one');
  assert.equal(f.c.WizBackgroundAudio.lastState.wantPlaying,false);assert.equal(f.timers.size,0);
  assert.equal(f.replies.length,0); // completion is shell-owned, no dead-frame round trip
});
test('close before first state response recovers session then pauses after removal',async()=>{
  const f=fixture({known:false});const closed=f.c.WizBackgroundAudio.closeApp('wizard-music');
  assert.equal(f.sent[0].method,'state');f.frame.isConnected=false;f.answer();await Promise.resolve();await Promise.resolve();
  assert.equal(f.sent[1].method,'pause');assert.equal(f.sent[1].sessionId,'session-one');f.answer();await closed;assert.equal(f.state.wantPlaying,false);
});
test('unrelated app close and browser-only Music do not issue native commands',async()=>{
  const f=fixture();await f.c.WizBackgroundAudio.closeApp('calendar');assert.equal(f.sent.length,0);
  const browser=fixture({native:false});await browser.c.WizBackgroundAudio.closeApp('wizard-music');assert.equal(browser.sent.length,0);
});
test('reload detach preserves playback and closed frames cannot restart it',async()=>{
  const f=fixture();f.message('detach');assert.equal(f.sent.at(-1).method,'detach');f.answer();assert.equal(f.state.playing,true);
  f.message('state');f.answer();assert.equal(f.replies.at(-1).result.wantPlaying,true);
  const close=f.c.WizBackgroundAudio.closeApp('wizard-music');f.frame.isConnected=false;f.answer();await close;
  const count=f.sent.length;f.message('play');assert.equal(f.sent.length,count);assert.equal(f.state.wantPlaying,false);
});
test('explicit close errors and timeout are observable, without leaking requests',async()=>{
  const f=fixture();const close=f.c.WizBackgroundAudio.closeApp('wizard-music');f.answer(undefined,false);await assert.rejects(close,/Native refused/);assert.equal(f.timers.size,0);
  const timeout=fixture();const missing=timeout.c.WizBackgroundAudio.closeApp('wizard-music');for(const fn of timeout.timers.values())fn();await assert.rejects(missing,/timed out/);
});
function functionSource(name) {const start=shell.indexOf('  function '+name+'(');return shell.slice(start,shell.indexOf('\n  }',start)+4);}
function shellFixture() {
  const calls=[],W={music:{id:'music',appId:'wizard-music'},chat:{id:'chat',appId:'chats'}},desks=[{wins:['music','chat'],focus:'music',full:false}];
  const c={window:{WizBackgroundAudio:{closeApp:id=>{calls.push({id,present:!!W.music});return Promise.resolve();}}},W,desks,CH:{},idx:0,
    deskOf:id=>desks.findIndex(d=>d.wins.includes(id)),winTitle:w=>w.id,CHATS:{closeHosted:()=>{}},renderDesk:()=>{},pruneDesks:()=>{},toast:()=>{},esc:x=>x,vib:()=>{},deskName:()=> 'Music',ovLog:()=>{}};
  vm.createContext(c);
  vm.runInContext(['closeAppPlayback','closeWin','closeDesk'].map(functionSource).join('\n'),c);
  return {c,calls,W,desks};
}
test('both normal and quiet window close stop music before removing its owner',()=>{
  for(const quiet of [false,true]){
    const {c,calls,W}=shellFixture();c.closeWin('music',quiet);
    assert.deepEqual(calls,[{id:'wizard-music',present:true}]);assert.equal(W.music,undefined);assert.ok(W.chat);
  }
});
test('closing the whole Music desk stops playback before deleting windows',()=>{
  const {c,calls,W}=shellFixture();c.closeDesk(0);
  assert.equal(calls[0].id,'wizard-music');assert.equal(calls[0].present,true);assert.equal(W.music,undefined);
});
