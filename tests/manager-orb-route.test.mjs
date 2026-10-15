import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const phone = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const desktop = readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8');
const outbox = readFileSync(new URL('../web/outbox.js', import.meta.url), 'utf8');
function section(s, a, b) { return s.slice(s.indexOf(a), s.indexOf(b, s.indexOf(a))); }
const pin = {appId:'wizard-manager',token:'sealed',label:'Manager conversation'};
function desktopFixture(front) {
 const calls=[], el={textContent:''};
 const ctx={APP:{'wizard-manager':{id:'wizard-manager',name:'Manager',receives_voice_input:true}},dictationFinishing:false,VOICE:{state:'idle',async start(){this.state='listen'},async finish(){this.state='idle';return {blob:new Blob(['audio'])}},cancel(){}},focused:()=>front,winEl:()=>({querySelector:()=>({})}),window:{WizAppServices:{voiceInput:{pin:(_,id)=>id==='wizard-manager'?pin:null}}},vMode:'talk',vTarget:null,vConversation:null,vReply:null,vNewChat:false,vNewKey:'',vContext:'',CMD:'Cmd',W:{},CHATS:{WORKING_ST:new Set(),modelRoute:()=>({model:'m',provider:'p'}),sendChat:(...x)=>calls.push(['chat',...x]),sendVoiceTo:(...x)=>calls.push(['reply',...x])},LIVE:{session:()=>null},viewContext:()=>'',toast(){},$:()=>el,OUTBOX:{sendConversation:async o=>{calls.push(['manager',o]);return {state:'sent'}},enqueue:async o=>calls.push(['new',o])},Blob,setTimeout,clearTimeout,Promise};
 ctx.commandSnapshot=()=>({id:front.id,thread:front.thread,view:{kind:front.thread?'chat thread':'thread list',appId:front.appId}});ctx.vSnapshot=null;ctx.vRoute=null;ctx.vFeedback=null;ctx.vFiles=null;ctx.commandTake=false;ctx.strictReply=false;ctx.AbortSignal=AbortSignal;ctx.LOCAL_COMMANDS={parse:()=>null};ctx.window.WizConfig={transcribe:async()=>({text:'ordinary voice reply'}),voicePrompt:()=>''};ctx.OUTBOX.stage=async()=>({id:'staged',durable:true});ctx.paintVoiceFiles=()=>{};ctx.window.WosCaptureTools={take:()=>({files:[],ready:()=>true})};
 ctx.CHATS.isHosted=id=>!!ctx.W[id]?.hosted;ctx.CHATS.composerBusy=()=>false;ctx.CHATS.takeComposer=()=>({text:'',files:[]});ctx.W[front.id]=front;
 vm.createContext(ctx);vm.runInContext(section(desktop,'  async function loadVoiceModels(','  // Composer mic:'),ctx);
 return {ctx,calls,focus:f=>{front=f;ctx.W[f.id]=f;}};
}
test('desktop Manager pin survives focus change before finish',async()=>{const f=desktopFixture({id:'mgr',app:'frame',appId:'wizard-manager'});await f.ctx.talk('start');f.focus({id:'ch',app:'chats',thread:'other'});await f.ctx.talk('send');assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],'manager');assert.equal(f.calls[0][1].conversation.token,'sealed');});
test('desktop explicit new gesture bypasses foreground Manager',async()=>{const f=desktopFixture({id:'mgr',app:'frame',appId:'wizard-manager'});await f.ctx.talk('start',true);await f.ctx.talk('send');assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],'new');});
test('missing shared host capability retains Manager intent rather than Chats',async()=>{const f=desktopFixture({id:'mgr',app:'frame',appId:'wizard-manager'});f.ctx.window.WizAppServices={};await f.ctx.talk('start');await f.ctx.talk('send');assert.equal(f.calls[0][0],'manager');assert.equal(f.calls[0][1].conversation.token,'unavailable');});
test('desktop existing thread keeps reply route',async()=>{const f=desktopFixture({id:'ch',app:'chats',thread:'original'});await f.ctx.talk('start');f.focus({id:'mgr',app:'frame',appId:'wizard-manager'});await f.ctx.talk('send');assert.equal(f.calls[0][0],'reply');assert.equal(f.calls[0][2],'original');});
test('desktop hosted canonical thread keeps its exact route after focus returns to Manager',async()=>{const f=desktopFixture({id:'hosted',app:'frame',appId:'wizard-manager',hosted:true,thread:'canonical-original'});await f.ctx.talk('start');assert.equal(f.ctx.vConversation,null);f.focus({id:'mgr',app:'frame',appId:'wizard-manager'});await f.ctx.talk('send');assert.equal(f.calls[0][0],'reply');assert.equal(f.calls[0][2],'canonical-original');});
test('desktop private agent list still creates chat for its agent',async()=>{const f=desktopFixture({id:'ch',app:'chats',agent:'private'});await f.ctx.talk('start');await f.ctx.talk('send');assert.equal(f.calls[0][0],'chat');assert.equal(f.calls[0].at(-1).sid,'__new__');});

test('cancelled command mode cannot consume the next thread or general take', async()=>{
 for(const forceNew of [false,true]){
  const f=desktopFixture({id:'ch',app:'chats',thread:'original'});
  f.ctx.VOICE.cancel=()=>{f.ctx.VOICE.state='idle';};
  f.ctx.window.WosCaptureTools.take=()=>({files:[],ready:()=>true,close(){}});
  await f.ctx.talk('start');f.ctx.commandTake=true;await f.ctx.talk('cancel');
  assert.equal(f.ctx.commandTake,false);await f.ctx.talk('start',forceNew);await f.ctx.talk('send');
  assert.equal(f.calls[0][0],forceNew?'new':'reply');
 }
});
test('desktop pre-STT stage keeps the recording-start working run and busy lock',async()=>{
 const f=desktopFixture({id:'ch',app:'chats',thread:'original'});let stage,release;
 f.ctx.CHATS.WORKING_ST=new Set(['working']);f.ctx.LIVE.session=()=>({status:'working',runId:'original-run'});
 f.ctx.OUTBOX.stage=async o=>{stage=o;await new Promise(r=>{release=r});return {id:'staged',durable:true};};
 await f.ctx.talk('start');const sending=f.ctx.talk('send');await new Promise(r=>setImmediate(r));
 assert.equal(stage.steerRunId,'original-run');assert.equal(await f.ctx.talk('start',true),'busy');
 release();await sending;assert.equal(f.ctx.dictationFinishing,false);assert.equal(f.calls[0][0],'reply');
});


test('cold app launch loads the model before recording and keeps general routing frozen',async()=>{
 const f=desktopFixture({id:'mgr',app:'frame',appId:'wizard-manager'});let ready=false,release;
 f.ctx.CHATS.modelRoute=()=>ready?{model:'general',provider:'p'}:null;
 f.ctx.window.WosModels={load:async()=>{await new Promise(r=>release=r);ready=true;}};
 const starting=f.ctx.talk('start',true);await new Promise(r=>setImmediate(r));
 assert.equal(f.ctx.VOICE.state,'idle');assert.equal(await f.ctx.talk('start'),'busy');
 f.focus({id:'private',app:'chats',thread:'private-thread',agent:'private'});release();await starting;
 assert.equal(f.ctx.vRoute.model,'general');assert.equal(f.ctx.vTarget,null);await f.ctx.talk('send');
 assert.equal(f.calls[0][0],'new');assert.equal(f.calls[0][1].model,'general');assert.equal(f.calls[0][1].sessionId,'');
});


test('cold model request timeout releases the voice lock without opening or sending',async()=>{
 const f=desktopFixture({id:'mgr',app:'frame',appId:'wizard-manager'});let deadline;
 f.ctx.CHATS.modelRoute=()=>null;f.ctx.window.WosModels={load:()=>new Promise(()=>{})};
 f.ctx.setTimeout=(fn,ms)=>{assert.equal(ms,8000);deadline=fn;return 1;};f.ctx.clearTimeout=()=>{};
 const starting=f.ctx.talk('start',true);await new Promise(r=>setImmediate(r));deadline();
 assert.equal(await starting,'busy');assert.equal(f.ctx.dictationFinishing,false);assert.equal(f.ctx.VOICE.state,'idle');assert.equal(f.calls.length,0);
});

test('phone Manager bypass precedes local commands, files and router',async()=>{const calls=[];const ctx={OUTBOX:{sendConversation:async o=>{calls.push(o);return {state:'sent'}}},takeFiles:()=>[{id:'attachment'}],setVoice(){},txHide(){},toast(){}};vm.createContext(ctx);vm.runInContext(section(phone,'  async function handleText(','  /* Hold-command'),ctx);await ctx.handleText('help','auto',false,0,null,{conversation:pin});assert.equal(calls.length,1);assert.equal(calls[0].text,'help');assert.equal(calls[0].files[0].id,'attachment');});
test('phone start pins destination before asynchronous recording',()=>{const s=section(phone,'  async function startVoice(','  function tick(');assert(s.indexOf('V.snap =')<s.indexOf('await openRec'));assert(s.includes("kind === 'command') V.snap.conversation = null"));});
test('phone Manager audio branches before generic staging/STT fallback',()=>{const s=section(phone,'  async function onRecStop(','  /* ---------------- view-aware');assert(s.indexOf('OUTBOX.sendConversation')<s.indexOf('OUTBOX.stage'));assert(s.includes("kind !== 'command' && !rt && aimAt == null"));});
test('outbox excludes Manager from generic delivery and uses same receipt identity',()=>{assert(outbox.includes("if (it.kind === 'conversation') throw"));assert(outbox.includes('request_id: it.id'));assert(outbox.includes('receipt.request_id !== it.id'));assert(outbox.includes("it.state = 'held'"));});
