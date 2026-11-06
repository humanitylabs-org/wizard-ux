import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const app=fs.readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
const finish=app.slice(app.indexOf('  function nativeFinish(id, stopped) {'),app.indexOf('  const releasedTakes ='));
const resume=app.slice(app.indexOf('  function nativeResume(a) {'),app.indexOf('  // Tell the native shell what the orb'));
function setup(){
 const general={model:'main-model',provider:'main-provider'}, privateRoute={model:'private-model',provider:'private-provider'};
 const saved={id:'native-qa',kind:'general',general:true,conversation:null};
 const V={kind:'command',snap:{view:{thread:'private-thread'},route:privateRoute},replyTo:null,target:null,acc:2000,state:'idle'};
 let seen,claims=0;
 const c={V,console,performance,JSON,Number,window:null,idx:0, nativeTakeAppOwned:()=>false,__wosDictationTake:()=>false,
 __wosVoiceRecovery:()=>[saved],WosModels:{voiceRoute:()=>general,load:async()=>{}},
 generalVoiceSnap:()=>({general:true,view:null,screen:'',others:[],conversation:null,route:general}),
 sendSnap:()=>{throw Error('must not inspect current private view')},CHATS:{modelRoute:()=>privateRoute},
 saveVoiceRoute:(id,r)=>assert.equal(r.provider,'main-provider'),
 DEV:()=>({recStop:()=>{claims++;return JSON.stringify({id:'native-qa',kind:'command',bytes:5,ms:2000})}}),
 voiceRecovery:(id,m)=>Object.assign(saved,m),nativeBlob:()=>({audio:true}),
 onRecStop:()=>{seen={kind:V.kind,snap:V.snap}},dropHold(){},unseal(){},setVoice(s){V.state=s},txHide(){},toast(){},
 voiceTake:()=>({kind:'command'}),replyTake:()=>{throw Error('general must not restore private reply')},renderVoiceFiles(){},txPill(){},requestAnimationFrame:()=>0,tick(){}};
 c.window=c;vm.createContext(c);return {c,V,get:()=>({seen,claims})};
}
test('native notification after reload restores general route, ignoring old bridge command kind',()=>{
 const s=setup();s.V.snap=null;vm.runInContext(finish+'\nnativeFinish("native-qa",false)',s.c);
 assert.equal(s.get().claims,1);assert.equal(s.get().seen.kind,'general');assert.equal(s.get().seen.snap.route.provider,'main-provider');assert.equal(s.get().seen.snap.view,null);
});
test('native resume preserves general target while a private app is foreground',()=>{
 const s=setup();vm.runInContext(resume+'\nnativeResume({id:"native-qa",kind:"command",paused:true})',s.c);
 assert.equal(s.V.kind,'general');assert.equal(s.V.snap.general,true);assert.equal(s.V.snap.route.provider,'main-provider');assert.equal(s.V.replyTo,null);
});
