import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { withDesktopParts } from './fixtures/desktop-parts.mjs';
import { withShellParts } from './fixtures/shell-parts.mjs';
import { randomUUID } from 'node:crypto';
import { block, runRecording } from './fixtures/source-slice.mjs';
import { phoneVoice } from './fixtures/r6B-phone-voice.mjs';
const phone = withShellParts(readFileSync(new URL('../web/app.js', import.meta.url), 'utf8'));
const desktop = withDesktopParts(withShellParts(readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8')));
const outbox = withShellParts(readFileSync(new URL('../web/outbox.js', import.meta.url), 'utf8'));
function section(s, a, b) { return s.slice(s.indexOf(a), s.indexOf(b, s.indexOf(a))); }
const pin = {appId:'wizard-manager',token:'sealed',label:'Manager conversation'};
function desktopFixture(front) {
 const calls=[], el={textContent:''};
 const ctx={APP:{'wizard-manager':{id:'wizard-manager',name:'Manager',receives_voice_input:true}},dictationFinishing:false,VOICE:{state:'idle',async start(){this.state='listen'},async finish(){this.state='idle';return {blob:new Blob(['audio'])}},cancel(){}},focused:()=>front,winEl:()=>({querySelector:()=>({})}),window:{WizAppServices:{voiceInput:{pin:(_,id)=>id==='wizard-manager'?pin:null}}},vMode:'talk',vTarget:null,vConversation:null,vReply:null,vNewChat:false,vNewKey:'',vContext:'',CMD:'Cmd',MOD:'Alt+',W:{},syncChatsPane(){},CHATS:{incognitoActive:()=>false,WORKING_ST:new Set(),modelRoute:()=>({model:'m',provider:'p'}),sendChat:(...x)=>calls.push(['chat',...x]),sendVoiceTo:(...x)=>calls.push(['reply',...x])},LIVE:{session:()=>null},viewContext:()=>'',toast(){},$:()=>el,OUTBOX:{sendConversation:async o=>{calls.push(['manager',o]);return {state:'sent'}},enqueue:async o=>calls.push(['new',o])},Blob,setTimeout,clearTimeout,Promise};
 ctx.commandSnapshot=()=>({id:front.id,thread:front.thread,view:{kind:front.thread?'chat thread':'thread list',appId:front.appId}});ctx.vSnapshot=null;ctx.vRoute=null;ctx.vFeedback=null;ctx.vFiles=null;ctx.commandTake=false;ctx.strictReply=false;ctx.AbortSignal=AbortSignal;ctx.LOCAL_COMMANDS={parse:()=>null};ctx.window.WizConfig={transcribe:async()=>({text:'ordinary voice reply'}),voicePrompt:()=>''};ctx.OUTBOX.stage=async()=>({id:'staged',durable:true});ctx.paintVoiceFiles=()=>{};ctx.window.WosCaptureTools={take:()=>({files:[],ready:()=>true})};
 ctx.CHATS.isHosted=id=>!!ctx.W[id]?.hosted;ctx.CHATS.isWorking=s=>!!s&&!s.archived&&ctx.CHATS.WORKING_ST.has(s.status);ctx.CHATS.composerBusy=()=>false;ctx.CHATS.takeComposer=()=>({text:'',files:[]});ctx.W[front.id]=front;
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
  assert.equal(f.calls[0][0],forceNew?'chat':'reply');
  if(forceNew)assert.equal(f.calls[0].at(-1).sid,'__new__');
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
test('phone start pins destination before asynchronous recording', async () => {
  // the real startVoice: the destination the tap saw is on the take before the browser is asked for the mic
  const v = phoneVoice({ snap: { conversation: pin, view: { id: 'mgr', kind: 'app', appId: 'wizard-manager' }, route: { model: 'm', provider: 'p' } } });
  const started = v.ctx.startVoice('auto');
  assert.equal(v.seen.length, 1, 'openRec was asked');
  assert.equal(v.seen[0].snap.conversation.token, 'sealed', 'pinned before openRec resolves');
  v.open(); await started;
  assert.equal(v.V.snap.conversation.token, 'sealed');
  // a command take never carries the app conversation
  const c = phoneVoice({ snap: { conversation: pin, view: null, route: { model: 'm', provider: 'p' } } });
  c.ctx.startVoice('command'); assert.equal(c.seen[0].snap.conversation, null); assert.equal(c.seen[0].kind, 'command');
});
function recStop(Vx) {
  const calls = [];
  const ctx = { Blob, window: {}, V: { parts: [], chunks: [new Blob(['x'.repeat(2000)])], acc: 5000, kind: 'auto', replyTo: null, target: null, seal: null, cancelled: false, ...Vx },
    quickTake: () => false, takeFiles: () => [], setVoice() {}, txHide() {}, txPill() {}, toast: (...a) => calls.push(['toast', a[1]]), recDone() {}, dropHold() {},
    OUTBOX: { sendConversation: async o => { calls.push(['sendConversation', o.conversation.token, o.audio instanceof Blob]); return { state: 'sent', durable: true }; },
      stage: async o => { calls.push(['stage', o.intent]); return { id: 'st', durable: true }; }, protect: async () => {}, get: () => null, handOff: async () => false, transition: async () => {},
      bounded: async () => { calls.push(['stt']); return { text: '' }; }, completeLocal: async () => true },
    CHATS: { isWorking: () => false, sendVoiceTo: async () => calls.push(['sendVoiceTo']) }, LIVE: { session: () => null }, APPS: [], viewContext: () => '' };
  ctx.window.WizConfig = { voicePrompt: () => '', transcribe: async () => ({ text: '' }) };
  runRecording(block(phone, '  async function onRecStop(nblob, nid) {') + '\nglobalThis.onRecStop = onRecStop;', ctx);
  return { ctx, calls };
}
test('phone Manager audio branches before generic staging/STT fallback', async () => {
  const m = recStop({ snap: { conversation: pin, view: null } }); await m.ctx.onRecStop();
  assert.deepEqual(m.calls.filter(c => c[0] !== 'toast'), [['sendConversation', 'sealed', true]], 'Manager audio: no staging, no STT');
  assert.deepEqual(m.calls.find(c => c[0] === 'toast'), ['toast', 'Sent to Manager conversation']);
  // a command, a thread reply or an aimed take is never Manager input: the generic stage path
  for (const V of [{ kind: 'command' }, { replyTo: { wid: 'w', sid: 's' } }, { target: 2 }]) {
    const g = recStop({ snap: { conversation: pin, view: null }, ...V }); await g.ctx.onRecStop();
    assert.equal(g.calls[0][0], 'stage', JSON.stringify(V)); assert.ok(!g.calls.some(c => c[0] === 'sendConversation'));
  }
});
// The real web/outbox.js over an in-memory IndexedDB, with the app conversation host the shell provides.
function outboxClient({ receipt = body => ({ accepted: true, request_id: body.request_id }) } = {}) {
  const rows = new Map(), delivered = [], fetches = [];
  const indexedDB = { open() { const r = {}; queueMicrotask(() => { r.result = { close() {}, objectStoreNames: { contains: () => true }, transaction() {
    const tx = { objectStore() { return { getAll() { return { result: [...rows.values()].map(x => structuredClone(x)) }; }, put(v) { rows.set(v.id, structuredClone(v)); return {}; }, delete(id) { rows.delete(id); return {}; } }; } };
    setImmediate(() => tx.oncomplete?.()); return tx; } }; r.onsuccess(); }); return r; } };
  const ctx = { console, Blob, AbortController, AbortSignal, indexedDB, crypto: { randomUUID },
    document: { documentElement: { dataset: {} }, body: null, addEventListener() {}, querySelectorAll: () => [] },
    localStorage: { getItem: () => null, removeItem() {}, setItem() {} }, addEventListener() {},
    clearTimeout, setTimeout(fn, ms) { const t = setTimeout(fn, ms); t.unref(); return t; },
    fetch: async (...a) => { fetches.push(a); throw new Error('no network in this test'); },
    WosModels: { snapshot: (_, route) => route, resolveRoute: async route => route },
    WizAppServices: { conversation: { deliver: async (conv, body) => { delivered.push(body); return receipt(body); } } } };
  ctx.window = ctx; vm.runInNewContext(outbox, ctx);
  return { api: ctx.WosOutbox, delivered, fetches, rows };
}
test('outbox excludes Manager from generic delivery and uses same receipt identity', async () => {
  const c = outboxClient();
  const it = await c.api.enqueue({ conversation: pin, text: 'turn the lights off', model: 'm', provider: 'p' });
  assert.equal(it.kind, 'conversation'); assert.equal(it.state, 'sent');
  assert.equal(c.delivered.length, 1); assert.equal(c.delivered[0].request_id, it.id, 'the receipt identity is the item id');
  assert.equal(c.fetches.length, 0, 'never posted as an ordinary chat');
  // a receipt for another request is uncertain: the take is held, never marked sent
  const u = outboxClient({ receipt: () => ({ accepted: true, request_id: 'other' }) });
  const held = await u.api.sendConversation({ conversation: pin, text: 'hello' });
  assert.equal(held.state, 'held'); assert.match(held.error, /receipt uncertain/);
  // after a reload, an unsent conversation item comes back held, and the generic pump never delivers it
  const rows = new Map([...u.rows].map(([k, v]) => [k, { ...v, state: 'sending' }]));
  const r = outboxClient(); for (const [k, v] of rows) r.rows.set(k, v);
  await r.api.enqueue({ text: 'an ordinary message', model: 'm', provider: 'p' }); await new Promise(res => setTimeout(res, 30)); // the generic pump runs
  const back = r.api.get(held.id);
  assert.equal(back?.state, 'held'); assert.equal(r.delivered.length, 0);
  assert.ok(r.fetches.every(([url, o]) => !String(o?.body || '').includes('hello')), 'the generic pump never posts the Manager take');
});

// wizard-ux#1218: the desktop orb, like the phone, sends to the model selected at the Send key; the thread stays pinned.
test('desktop thread take uses the model picked while recording, still to the pinned thread',async()=>{
 const f=desktopFixture({id:'ch',app:'chats',thread:'original'});let staged=null;
 f.ctx.OUTBOX.stage=async x=>{staged=x;return {id:'staged',durable:true};};
 let picked={model:'sonnet',provider:'anthropic'},asked=[];f.ctx.CHATS.modelRoute=(w,s)=>{asked.push([w,s]);return picked;};
 await f.ctx.talk('start');assert.equal(f.ctx.vRoute.model,'sonnet');
 picked={model:'opus',provider:'anthropic'};f.focus({id:'other',app:'chats',thread:'elsewhere'});
 await f.ctx.talk('send');
 assert.equal(staged.model,'opus');assert.equal(staged.sessionId,'original');assert.deepEqual(asked.at(-1),['ch','original']);
});
test('desktop keeps the recording-start model when the selector cannot be read at Send',async()=>{
 const f=desktopFixture({id:'ch',app:'chats',thread:'original'});let staged=null;
 f.ctx.OUTBOX.stage=async x=>{staged=x;return {id:'staged',durable:true};};
 let picked={model:'sonnet',provider:'anthropic'};f.ctx.CHATS.modelRoute=()=>picked;
 await f.ctx.talk('start');picked=null;await f.ctx.talk('send');
 assert.equal(staged.model,'sonnet');
});
