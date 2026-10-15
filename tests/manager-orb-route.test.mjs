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
 const ctx={dictationFinishing:false,VOICE:{state:'idle',async start(){this.state='listen'},async finish(){this.state='idle';return {blob:new Blob(['audio'])}},cancel(){}},focused:()=>front,winEl:()=>({querySelector:()=>({})}),window:{WizAppServices:{conversation:{pin:(_,id)=>id==='wizard-manager'?pin:null}}},vMode:'talk',vTarget:null,vConversation:null,vReply:null,vNewChat:false,vNewKey:'',vContext:'',CMD:'Cmd',W:{},CHATS:{WORKING_ST:new Set(),modelRoute:()=>({model:'m',provider:'p'}),sendChat:(...x)=>calls.push(['chat',...x]),sendVoiceTo:(...x)=>calls.push(['reply',...x])},LIVE:{session:()=>null},viewContext:()=>'',toast(){},$:()=>el,OUTBOX:{sendConversation:async o=>{calls.push(['manager',o]);return {state:'sent'}},enqueue:async o=>calls.push(['new',o])},Blob};
 ctx.CHATS.composerBusy=()=>false;ctx.CHATS.takeComposer=()=>({text:'',files:[]});ctx.W[front.id]=front;
 vm.createContext(ctx);vm.runInContext(section(desktop,'  async function talk(action','  // Composer mic:'),ctx);
 return {ctx,calls,focus:f=>{front=f;ctx.W[f.id]=f;}};
}
test('desktop Manager pin survives focus change before finish',async()=>{const f=desktopFixture({id:'mgr',app:'frame',appId:'wizard-manager'});await f.ctx.talk('start');f.focus({id:'ch',app:'chats',thread:'other'});await f.ctx.talk('send');assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],'manager');assert.equal(f.calls[0][1].conversation.token,'sealed');});
test('desktop explicit new gesture bypasses foreground Manager',async()=>{const f=desktopFixture({id:'mgr',app:'frame',appId:'wizard-manager'});await f.ctx.talk('start',true);await f.ctx.talk('send');assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],'new');});
test('missing shared host capability retains Manager intent rather than Chats',async()=>{const f=desktopFixture({id:'mgr',app:'frame',appId:'wizard-manager'});f.ctx.window.WizAppServices={};await f.ctx.talk('start');await f.ctx.talk('send');assert.equal(f.calls[0][0],'manager');assert.equal(f.calls[0][1].conversation.token,'unavailable');});
test('desktop existing thread keeps reply route',async()=>{const f=desktopFixture({id:'ch',app:'chats',thread:'original'});await f.ctx.talk('start');f.focus({id:'mgr',app:'frame',appId:'wizard-manager'});await f.ctx.talk('send');assert.equal(f.calls[0][0],'reply');assert.equal(f.calls[0][2],'original');});
test('desktop private agent list still creates chat for its agent',async()=>{const f=desktopFixture({id:'ch',app:'chats',agent:'private'});await f.ctx.talk('start');await f.ctx.talk('send');assert.equal(f.calls[0][0],'chat');assert.equal(f.calls[0].at(-1).sid,'__new__');});
test('phone Manager bypass precedes local commands, files and router',async()=>{const calls=[];const ctx={OUTBOX:{sendConversation:async o=>{calls.push(o);return {state:'sent'}}},takeFiles:()=>[{id:'attachment'}],setVoice(){},txHide(){},toast(){}};vm.createContext(ctx);vm.runInContext(section(phone,'  async function handleText(','  /* Hold-command'),ctx);await ctx.handleText('help','auto',false,0,null,{conversation:pin});assert.equal(calls.length,1);assert.equal(calls[0].text,'help');assert.equal(calls[0].files[0].id,'attachment');});
test('phone start pins destination before asynchronous recording',()=>{const s=section(phone,'  async function startVoice(','  function tick(');assert(s.indexOf('V.snap =')<s.indexOf('await openRec'));assert(s.includes("kind === 'command') V.snap.conversation = null"));});
test('phone Manager audio branches before generic staging/STT fallback',()=>{const s=section(phone,'  async function onRecStop(','  /* ---------------- view-aware');assert(s.indexOf('OUTBOX.sendConversation')<s.indexOf('OUTBOX.stage'));assert(s.includes("kind !== 'command' && !rt && aimAt == null"));});
test('outbox excludes Manager from generic delivery and uses same receipt identity',()=>{assert(outbox.includes("if (it.kind === 'conversation') throw"));assert(outbox.includes('request_id: it.id'));assert(outbox.includes('receipt.request_id !== it.id'));assert(outbox.includes("it.state = 'held'"));});
