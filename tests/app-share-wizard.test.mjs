import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import { withServicesParts } from './fixtures/app-services-parts.mjs';
import { withParts } from './fixtures/chats-parts.mjs'; // chats.js parts moved out verbatim (issue 1665)
import { withShellParts } from './fixtures/shell-parts.mjs';
import { appClient } from './fixtures/app-client-harness.mjs';
import { shareSheet, flush } from './fixtures/share-sheet-harness.mjs';
const read = p => withShellParts(readFileSync(new URL('../'+p,import.meta.url),'utf8'));
const source=withServicesParts(read('web/core/app-services.js')), shared=read('web/core/share-wizard.js');
function fixture() {
 const calls=[],replies=[],events={},location=new URL('https://wizard.example/wizard-os-home/');
 const child={location:new URL('/messenger/',location),document:{},addEventListener(){},postMessage(m){replies.push(m);}};
 const frame={tagName:'IFRAME',src:child.location.href,isConnected:true,contentWindow:child,hasAttribute:()=>false,addEventListener(){},removeEventListener(){}};
 const document={hidden:false,readyState:'loading',addEventListener(){}};
 const window={WizCore:{apps:()=>({APPS:[{id:'messenger',kind:'wizard',url:'/messenger/'}]})},dispatchEvent(){}};
 const context={window,document,location,URL,addEventListener(n,fn){events[n]=fn;},setInterval(){},setTimeout,clearTimeout,CustomEvent:class{},navigator:{}};
 vm.runInNewContext(shared,context);
 const validate=window.WizShareWizard.valid;
 window.WizShareWizard={valid:validate,wizard:async (data,authorize)=>{calls.push({data,authorize});return 'sent';}};
 vm.runInNewContext(source,context);
 const detach=window.WizAppServices.attach(frame,{appId:'messenger',path:'/messenger/',isVisible:()=>true});
 return {calls,replies,child,frame,detach,window,service:window.WizAppServices.connect(child,{}),message:events.message};
}
const payload=()=>({files:[new File(['a'],'voice.ogg',{type:'audio/ogg'}),new File(['b'],'photo.png',{type:'image/png'})],text:'Miguel: hello',title:'Messenger'});
test('installed frame forwards one batch internally, holds until sheet settles',async()=>{
 const f=fixture(),p=payload();let resolve;
 f.window.WizShareWizard.wizard=(data,authorize)=>new Promise(r=>{resolve=r;f.calls.push({data,authorize});});
 const result=f.service.share.wizard(p);assert.equal(f.window.WizAppServices.update.busy(),true);
 assert.equal(f.calls[0].data,p);assert.equal(f.calls[0].authorize(),true);
 resolve('sent');assert.equal(await result,'sent');assert.equal(f.window.WizAppServices.update.busy(),false);
});
// No file COUNT cap (James, 6 Nov 2026: "don't impose arbitrary limits on the user"); blob identity, title and text stay checked.
test('blob identity, title and text are bounded before showing sheet; any number of files passes',async()=>{
 const f=fixture();for(const data of [{files:[{}]},{text:'a'.repeat(100001)},{text:'a',title:[]},{files:[]}])await assert.rejects(f.service.share.wizard(data));assert.equal(f.calls.length,0);
 await f.service.share.wizard({files:Array(12).fill(new File(['a'],'x'))});assert.equal(f.calls[0].data.files.length,12);
 await f.service.share.wizard({files:Array(21).fill(new File(['a'],'x'))});assert.equal(f.calls[1].data.files.length,21);
});
test('foreign, stale and detached documents fail closed; active sheet authorization is rechecked',async()=>{
 const f=fixture();await f.service.share.wizard(payload());f.child.document={};assert.equal(f.calls[0].authorize(),false);await assert.rejects(f.service.share.wizard(payload()));
 const g=fixture();g.detach();await assert.rejects(g.service.share.wizard(payload()));
 const h=fixture();h.child.location=new URL('https://foreign.example/');await assert.rejects(h.service.share.wizard(payload()));
});
test('missing sheet returns unsupported; cancellation remains cancelled and releases hold',async()=>{
 const f=fixture();f.window.WizShareWizard.wizard=async()=>'cancelled';assert.equal(await f.service.share.wizard(payload()),'cancelled');assert.equal(f.window.WizAppServices.update.busy(),false);
 f.window.WizShareWizard=null;assert.equal(await f.service.share.wizard(payload()),'unsupported');
});
test('postMessage admits share.wizard only for installed source and returns its receipt',async()=>{
 const f=fixture(),data={type:'wizard:app:request',version:1,id:'share-1',op:'share.wizard',args:payload()};
 await f.message({origin:'https://wrong.example',source:f.child,data});assert.equal(f.calls.length,0);
 await f.message({origin:'https://wizard.example',source:f.child,data});assert.equal(f.calls.length,1);assert.equal(f.replies.at(-1).value,'sent');
});
test('real shared Chats send enqueues all 21 attachments once without consuming destination draft',async()=>{
 const src=withParts(read('web/core/chats.js')),start=src.indexOf('  async function sendChat('),end=src.indexOf('  const picker =',start);
 const files=Array.from({length:21},(_,n)=>({id:'f'+n,name:'voice-'+n+'.ogg',mime:'audio/ogg',bytes:10}));
 const draft={draft:'Keep my words',files:[{id:'existing',name:'mine'}]},enqueued=[];
 const sandbox={window:{},INC:null,W:{w1:{id:'w1',app:'chats',thread:'__new__'}},ch:()=>draft,
  joinWords:(a,b)=>[a,b].filter(Boolean).join('\n\n'),focusOf:()=>null,PW:null,winAgent:()=>'',AGS:()=>null,
  KIT:{drafts:{get:()=>({}),clear(){throw Error('Do not consume my draft');}}},LIVE:{},OUTBOX:{async enqueue(it){enqueued.push(it);return {durable:true,id:'receipt'};}},
  viewContext:()=>'',isWorking:()=>false,pendRef:f=>f,renderChats(){},applyLayout(){},deskOf:()=>0};
 vm.runInNewContext(src.slice(start,end)+';this.sendChat=sendChat;',sandbox);
 const receipt=await sandbox.sendChat('w1','Forwarded words','shared to Wizard',null,{sid:'__new__',files,seal:false,away:true});
 assert.equal(receipt.durable,true);assert.equal(enqueued.length,1);assert.equal(enqueued[0].files.length,21);assert.equal(enqueued[0].text,'Forwarded words');assert.equal(draft.draft,'Keep my words');assert.equal(draft.files[0].id,'existing');
});
test('share destination wording keeps one Chat picker, a valid default and a decorative chevron',async()=>{
 // the real sheet on the tiny DOM (tests/fixtures/share-sheet-harness.mjs)
 const h=shareSheet();h.S.open({text:'hi'});await flush();
 const row=h.q('.dv-row.dv-chat');
 assert.deepEqual(row.children.map(c=>[c.tagName.toLowerCase(),c.textContent,c.getAttribute('aria-hidden')]),[['span','Chat',null],['strong','New chat',null],['span','⌄','true']],'label, value, decorative chevron');
 assert.equal(h.all('.dv-row.dv-chat').length,1,'one Chat picker');
 assert.equal(h.all('[role="radiogroup"], input[value="pick"]').length,0);
 h.tap('.dv-chat');assert.equal(row.getAttribute('aria-expanded'),'true');
 h.tap(h.all('[data-dvpick]').find(b=>b.dataset.dvpick==='t1'));
 assert.equal(h.q('.dv-chat strong').textContent,'Plans','picking a chat names it in the row');
 assert.equal(h.all('[data-dvpick]').length,0,'and closes the picker');
});
test('a fresh import defaults to New chat; an explicit retry keeps its chat',async()=>{
 const h=shareSheet();h.S.open({text:'hi'});await flush();
 assert.equal(h.q('.dv-chat strong').textContent,'New chat');
 const r=shareSheet();r.S.open({text:'hi',dest:'t1'});await flush();
 assert.equal(r.q('.dv-chat strong').textContent,'Plans');
});
test('share title names the chosen agent and text remains a separate read-only quote',async()=>{
 const h=shareSheet();h.S.open({text:'Shared <words>'});await flush();
 assert.equal(h.q('.dv-title').textContent,'Send to Wizard');
 assert.equal(h.q('[role=dialog]').getAttribute('aria-label'),'Send to Wizard');
 h.tap('.dv-agent');h.tap(h.all('[data-dvpick]').find(b=>b.dataset.dvpick==='merlin'));await flush();
 assert.equal(h.q('.dv-title').textContent,'Send to Merlin','the title follows the chosen agent');
 assert.equal(h.q('[role=dialog]').getAttribute('aria-label'),'Send to Merlin');
 const quote=h.q('.dv-quote');
 assert.equal(quote.textContent,'Shared <words>','the shared text, escaped, as a quote');
 assert.equal(quote.getAttribute('aria-label'),'Shared content (not editable)');assert.equal(quote.getAttribute('tabindex'),'0');
 assert.equal(h.q('.dv-text').getAttribute('placeholder'),'Add a comment (optional)');
 const e=shareSheet();e.S.open({});await flush();
 const sent=[];e.window.__wos.chats.sendChat=async(...a)=>{sent.push(a);return {durable:true};};
 e.tap('[data-sharesend]');await flush();
 assert.equal(e.q('.dv-status').textContent,'Add a comment first','nothing to send asks for a comment');
 assert.equal(sent.length,0);
});
test('share receipt toast names the actual destination agent, only after durable send',async()=>{
 const start=shared.indexOf('  async function carry('),end=shared.indexOf('  function wizard(',start),toasts=[];
 const w={wins:{c:{app:'chats'}},toast:(...args)=>toasts.push(args)};
 let release; const chats={sendChat:()=>new Promise(r=>{release=r;})};
 const sandbox={};vm.runInNewContext(shared.slice(start,end)+';this.carry=carry;',sandbox);
 const pending=sandbox.carry(w,chats,{note:'Synthetic share',target:'__new__',agent:'synthetic-agent',agentLabel:'Synthetic Agent',stay:false},[]);
 assert.equal(toasts.length,0);release({durable:true});assert.equal(await pending,'sent');
 assert.deepEqual(toasts,[['✦','Sent to Synthetic Agent',1800]]);
 await sandbox.carry(w,{sendChat:async()=>({durable:true})},{target:'__new__',agentLabel:'Synthetic Agent',stay:true},[]);
 assert.equal(toasts.length,1);
});
test('both shells load the same sheet and route Back to it, native imports reuse it without desktop device.js',async()=>{
 for(const p of ['index.html','desktop.html']){const s=read('web/'+p);assert.match(s,/core\/share-wizard.js/);assert.match(s,/core\/share-wizard.css/);}
 for(const p of ['app.js','desktop/desktop.js'])assert.match(read('web/'+p),/WizEscapeBack\.installOwners\(/);
 // Back: the shared owner catalog (core/escape-back.js) closes the sheet first, on both shells.
 let open=true;const W={WizShareWizard:{get isOpen(){return open;},back:()=>{open=false;return 'share-wizard';}}};
 vm.runInNewContext(read('web/core/escape-back.js'),{window:W,document:{addEventListener(){}},addEventListener(){},setTimeout,clearTimeout,queueMicrotask,MutationObserver:class{observe(){}disconnect(){}}});
 const stack=W.WizEscapeBack.create();W.WizEscapeBack.installOwners(stack,{chats:()=>({}),links:()=>null});
 assert.equal(stack.run({fallback:()=>'root'}),'share-wizard');assert.equal(open,false);assert.equal(stack.run({fallback:()=>'root'}),'root');
 // A native (Android) import opens the same sheet (core/device.js onShare), and releases the share once it is sent.
 const dev=read('web/device.js'),start=dev.indexOf('  async function onShare(id) {'),end=dev.indexOf("    log('share:result', id, result);\n  }",start);
 const opened=[],done=[];
 const ctx={window:{WizShareWizard:{open:async o=>(opened.push(o),'sent')}},J:x=>x,closeSheet(){},toast(){},log(){},readBlob:()=>null,
  DEV:()=>({shareMeta:id=>({text:'hello',subject:'s',items:[{n:0,name:'a.png',mime:'image/png'}]}),shareDone:id=>done.push(id),shareRead(){}})};
 vm.runInNewContext(dev.slice(start,end)+'}\nthis.onShare=onShare;',ctx);
 await ctx.onShare('sh1');
 assert.equal(opened.length,1);assert.equal(opened[0].durable,true);assert.equal(opened[0].android,true);assert.equal(opened[0].text,'hello');
 assert.equal(opened[0].items.length,1);assert.equal(typeof opened[0].items[0].read,'function');assert.deepEqual(done,['sh1']);
 assert.doesNotMatch(dev,/data-shareto/);
 // Apps reach the same sheet through the SDK (WizardApp.share.wizard), which hands the batch to the shell's service.
 const sent=[],c=appClient({service:{share:{wizard:async d=>(sent.push(d),'sent')}}});
 const batch={text:'x'};assert.equal(await c.api.share.wizard(batch),'sent');assert.equal(sent[0],batch);
 assert.equal(appClient().api.share.wizard,undefined,'no services and no transport: not offered');
 assert.doesNotMatch(withParts(read('web/core/chats.js')),/MAX_FILES|files per message/);
});
