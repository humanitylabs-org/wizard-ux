import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../web/core/'+p,import.meta.url),'utf8');
function fixture({id='wizard-music',provides=[],legacy=true,admitted=true}={}) {
  const origin='https://wizard.example',listeners={},sent=[],timers=new Map(),received=[];let seq=0;
  const win={location:new URL(origin+'/'+id+'/'),document:{documentElement:{}},addEventListener(){},postMessage(){}};
  const frame={tagName:'IFRAME',isConnected:true,src:origin+'/'+id+'/',contentWindow:win,addEventListener(){},removeEventListener(){},hasAttribute:()=>false,getAttribute:()=>frame.src};
  const app={id,kind:'wizard',name:'Test provider',url:'/'+id+'/',provides};
  const c={URL,console,location:new URL(origin+'/wizard-os-home/'),document:{querySelectorAll:()=>[frame],readyState:'loading',addEventListener(){}},
    WizCore:{apps:()=>({APPS:[app]})},dispatchEvent(){},CustomEvent:class{},navigator:{},
    addEventListener:(n,f)=>{(listeners[n] ||= []).push(f);},setInterval(){},
    setTimeout:fn=>{timers.set(++seq,fn);return seq;},clearTimeout:id=>timers.delete(id),
    wizardAudioPort:{postMessage:raw=>sent.push(JSON.parse(raw))}};
  c.window=c;vm.createContext(c);
  if(legacy)vm.runInContext(read('background-audio-legacy.js'),c);
  vm.runInContext(read('background-audio.js'),c);vm.runInContext(read('app-services.js'),c);
  c.WizAppServices.attach(frame,{appId:id,path:app.url});
  const handler={claims:(text)=>text==='test provider grammar',receive:text=>{received.push(text);return true;}};
  const service=c.WizAppServices.connect(win,{voiceCommands:handler});
  c.WizBackgroundAudio.init(()=>({[id]:app}),f=>admitted&&c.WizAppServices.authorized(f));
  const answer=result=>c.wizardAudioPort.onmessage({data:JSON.stringify({id:sent.at(-1).id,ok:true,result:result||{sessionId:'s',wantPlaying:false}})});
  return {c,win,frame,app,sent,service,answer,handler,received};
}
test('Music admitted through legacy seed; current APK receives exactly the legacy token',async()=>{
  const f=fixture();assert(f.c.WizBackgroundAudio.canAttach(f.win));
  const result=f.service.device.backgroundAudio.request('play',{sessionId:'s',appId:'spoof',id:'spoof',method:'load'});
  assert.equal(f.sent[0].appId,'wizard-music');assert.equal(f.sent[0].method,'play');assert.notEqual(f.sent[0].id,'spoof');f.answer();await result;
});
test('any registry-granted provider can use the shared capability; compatibility token is unchanged',async()=>{
  const f=fixture({id:'radio',provides:['background-audio']});
  const playing=f.service.device.backgroundAudio.request('play',{sessionId:'s'});f.answer({sessionId:'s',wantPlaying:true});await playing;
  const closed=f.c.WizBackgroundAudio.closeApp('radio');assert.equal(f.sent.at(-1).method,'pause');assert.equal(f.sent.at(-1).appId,'wizard-music');f.frame.isConnected=false;f.answer();await closed;assert.equal(f.c.WizBackgroundAudio.lastState.wantPlaying,false);
});
for(const options of [{id:'foreign'},{id:'radio',provides:['background-audio'],admitted:false},{id:'wizard-music',legacy:false}])test('no live grant/host admission denies '+JSON.stringify(options),async()=>{
  const f=fixture(options);assert.equal(f.c.WizBackgroundAudio.frameOk(f.win),false);await assert.rejects(f.service.device.backgroundAudio.request('play'),/refused/);assert.equal(f.sent.length,0);
});
for(const alter of [f=>f.frame.isConnected=false,f=>f.win.location=new URL('https://foreign.example/wizard-music/'),f=>f.win.location=new URL('https://wizard.example/adjacent/'),f=>f.frame.src='https://wizard.example/adjacent/',f=>f.win.document={}])test('foreign, navigated or closed document cannot invoke native audio '+alter.toString(),async()=>{
  const f=fixture();alter(f);await assert.rejects(Promise.resolve().then(()=>f.service.device.backgroundAudio.request('play')));assert.equal(f.sent.length,0);
});
test('voice handler claims app grammar and receives unchanged utterance, once',async()=>{
  const f=fixture({id:'reader'}),claim=f.c.WizAppServices.voiceCommand('test provider grammar',{kind:'command',view:{kind:'home'}});
  assert.equal(claim.action,'app_voice');assert.equal(claim.appId,'reader');let done;
  assert.equal(f.c.WizAppServices.runVoiceCommand(claim,ok=>done=ok),true);await Promise.resolve();assert.deepEqual(f.received,['test provider grammar']);assert.equal(done,true);assert.equal(f.c.WizAppServices.runVoiceCommand(claim),false);
});
test('a claim cannot survive navigation, handler replacement or removal',()=>{
  for(const alter of [f=>f.win.document={},f=>f.frame.isConnected=false,f=>f.c.WizAppServices.connect(f.win,{voiceCommands:{...f.handler}})]) {
    const f=fixture({id:'reader'}),claim=f.c.WizAppServices.voiceCommand('test provider grammar',{kind:'command'});alter(f);assert.equal(f.c.WizAppServices.runVoiceCommand(claim),false);assert.equal(f.received.length,0);
  }
});
test('app-owned command registration is exposed by shared SDK without a second audio transport',()=>{
  const source=read('app-client.js');assert.match(source,/voice: Object.freeze\(\{ commands,/);assert.match(source,/get voiceCommands\(\)/);assert.match(source,/service.device.backgroundAudio.request\(method, params\)/);
});
