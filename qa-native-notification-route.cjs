// Actual device.onRec -> app.nativeFinish -> app.onRecStop seam, isolated with synthetic audio.
// No browser/model/network calls. Guards notification Send against changing the selector during STT.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const web=path.join(process.env.QA_WEB_DIR||__dirname,'web');
const app=fs.readFileSync(path.join(web,'app.js'),'utf8'),device=fs.readFileSync(path.join(web,'device.js'),'utf8');
const native=app.slice(app.indexOf('  function nativeFinish(id, stopped) {'),app.indexOf('  const recDone ='));
const processing=app.slice(app.indexOf('  async function onRecStop(nblob, nid) {'),app.indexOf('  // The tap that starts recording must not also press'));
const notification=device.slice(device.indexOf('  function onRec(ev) {'),device.indexOf('  /* ================= #20 share'));
let pass=0;
async function probe({recreated=false,unavailable=false}={}){
 let selected={model:'glm-5-3',provider:'custom:tinfoil-operator'},release,started=false,lastTask,claimed=0,reads=0,seen;
 const routes=new Map([['native-test',{...selected}]]),errors=[];
 const V={native:'native-test',state:'listen',snap:recreated?null:{view:{id:'wid',kind:'chat thread',thread:'s1'}},kind:'auto',target:null,replyTo:null,
  acc:2000,chunks:[],parts:[],cancelled:false,hold:null,seal:null,files:[]};
 const ctx={console,Blob,Promise,Date,setTimeout,clearTimeout,V,W:{wid:{thread:'s1'}},APPS:[],navigator:{onLine:true},
  DEV:()=>({recClaim:()=>{claimed++;return JSON.stringify({ms:2000})},recStop:()=>{claimed++;return JSON.stringify({ms:2000})}}),
  nativeBlob:()=>{reads++;return new Blob(['x'.repeat(2000)],{type:'audio/aac'})},
  sendSnap:()=>({view:{id:'wid',kind:'chat thread',thread:'s1'}}),
  saveVoiceRoute:(id,r)=>routes.set(id,{...r}),
  CHATS:{modelRoute:()=>{if(unavailable)throw Error('Model change is still saving');return {...selected}}},
  WizConfig:{voicePrompt:()=>'',transcribe:()=>{started=true;return new Promise(r=>release=r)}},
  WosModels:{voiceRoute:id=>routes.get(id)},stopStream(){},Orb:{setLevel(){}},dropHold(){},unseal(){},setVoice(s){V.state=s},txHide(){},toast:(ic,s)=>errors.push(s),tourEv(){},
  takeFiles:()=>[],recDone(){},log(){},syncRecorder(){throw Error('unexpected recovery path')},
  handleText:async(text,kind,typed,ms,target,snap)=>{seen={text,route:snap.route};}
 };
 ctx.window=ctx;ctx.W$=()=>ctx;vm.createContext(ctx);
 const actualProcess=vm.runInContext(processing+'\nonRecStop;',ctx);
 ctx.onRecStop=(...args)=>{lastTask=actualProcess(...args);return lastTask};
 ctx.nativeFinish=vm.runInContext(native+'\nnativeFinish;',ctx);
 const actualNotification=vm.runInContext(notification+'\nonRec;',ctx);
 actualNotification({type:'send',id:'native-test'});
 if(unavailable){assert.equal(claimed,0);assert.equal(reads,0);assert.equal(started,false);assert(errors.some(e=>e.includes('Recording saved')));return}
 assert.equal(started,true,'actual onRecStop reached delayed STT');
 selected={model:'gpt-6.1-sol',provider:'openai-codex'};
 release({text:'Synthetic delayed native speech',ms:8000});await lastTask;await new Promise(r=>setTimeout(r,1));
 assert.equal(seen.route.model,'glm-5-3');assert.equal(seen.route.provider,'custom:tinfoil-operator');assert.equal(claimed,1);assert.equal(reads,1);
}
(async()=>{
 await probe();pass++;console.log('PASS notification Send freezes GLM before STT; later GPT selection cannot reroute it');
 await probe({recreated:true});pass++;console.log('PASS recreated native take restores its saved GLM route before STT');
 await probe({unavailable:true});pass++;console.log('PASS uncertain notification route leaves audio unclaimed and reports it visibly');
 console.log(`${pass} native notification route contracts passed`);
})().catch(e=>{console.error(e);process.exitCode=1});
