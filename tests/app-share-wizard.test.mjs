import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read = p => readFileSync(new URL('../'+p,import.meta.url),'utf8');
const source=read('web/core/app-services.js'), shared=read('web/core/share-wizard.js');
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
test('count, aggregate bytes, blob identity, title and text are bounded before showing sheet',async()=>{
 const f=fixture();for(const data of [{files:Array(11).fill(new Blob(['a']))},{files:[{}]},{files:[new Blob([new Uint8Array(100*1048576+1)])]},{text:'a'.repeat(100001)},{text:'a',title:[]},{files:[]}])await assert.rejects(f.service.share.wizard(data));assert.equal(f.calls.length,0);
 await f.service.share.wizard({files:Array(10).fill(new File(['a'],'x'))});assert.equal(f.calls[0].data.files.length,10);
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
test('real shared Chats send enqueues all 10 attachments once without consuming destination draft',async()=>{
 const src=read('web/core/chats.js'),start=src.indexOf('  async function sendChat('),end=src.indexOf('  const picker =',start);
 const files=Array.from({length:10},(_,n)=>({id:'f'+n,name:'voice-'+n+'.ogg',mime:'audio/ogg',bytes:10}));
 const draft={draft:'Keep my words',files:[{id:'existing',name:'mine'}]},enqueued=[];
 const sandbox={window:{},MAX_FILES:Number(src.match(/const MAX_FILES = (\d+)/)[1]),W:{w1:{id:'w1',app:'chats',thread:'__new__'}},ch:()=>draft,
  joinWords:(a,b)=>[a,b].filter(Boolean).join('\n\n'),focusOf:()=>null,PW:null,winAgent:()=>'',AGS:()=>null,
  KIT:{drafts:{get:()=>({}),clear(){throw Error('Do not consume my draft');}}},LIVE:{},OUTBOX:{async enqueue(it){enqueued.push(it);return {durable:true,id:'receipt'};}},
  viewContext:()=>'',isWorking:()=>false,pendRef:f=>f,renderChats(){},applyLayout(){},deskOf:()=>0};
 vm.runInNewContext(src.slice(start,end)+';this.sendChat=sendChat;',sandbox);
 const receipt=await sandbox.sendChat('w1','Forwarded words','shared to Wizard',null,{sid:'__new__',files,seal:false,away:true});
 assert.equal(receipt.durable,true);assert.equal(enqueued.length,1);assert.equal(enqueued[0].files.length,10);assert.equal(enqueued[0].text,'Forwarded words');assert.equal(draft.draft,'Keep my words');assert.equal(draft.files[0].id,'existing');
});
test('both shells load the same sheet and route Back to it, native imports reuse it without desktop device.js',()=>{
 for(const p of ['index.html','desktop.html']){const s=read('web/'+p);assert.match(s,/core\/share-wizard.js/);assert.match(s,/core\/share-wizard.css/);}
 for(const p of ['app.js','desktop/desktop.js'])assert.match(read('web/'+p),/WizShareWizard\?\.back\(\)/);
 assert.match(read('web/device.js'),/await window.WizShareWizard.open/);assert.doesNotMatch(read('web/device.js'),/data-shareto/);
 assert.match(read('web/core/app-client.js'),/get wizard\(\)/);assert.match(read('web/core/chats.js'),/const MAX_FILES = 10/);
});
