// James: "shouldn't I be able to see the contents / details of this alert and not just its title?"
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import { withWebParts } from './fixtures/web-parts.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { cascade } from './fixtures/mini-css.mjs';
import { block, runRecording } from './fixtures/source-slice.mjs';
const read=p=>withWebParts(readFileSync(new URL('../'+p,import.meta.url),'utf8'));
async function project(item){
 const window={WosSkinHost:{inboxList:true},WizCore:{backendApps:()=>[{id:'notifications'}]},dispatchEvent(){}};
 const ctx={window,document:{querySelectorAll:()=>[],addEventListener(){}},location:{origin:'https://example.test'},addEventListener(){},setInterval(){},setTimeout(){},CustomEvent:class{},fetch:async()=>({ok:true,json:async()=>({items:[item]})})};
 vm.runInNewContext(read('web/core/notif-bell.js'),ctx);window.WosBell.watch(()=>{});await new Promise(r=>setImmediate(r));return window.WosBell.item(item.id);
}
test('opened alert details retain the full original body and paragraphs beyond preview limits',async()=>{
 const details='Original title\n\n'+('Full original paragraph.\n\n'.repeat(1200))+'FINAL ORIGINAL LINE';
 const item=await project({id:'full-original',title:'Short title',message:'Short edited summary',details});
 assert.equal(item.details,details);assert.equal(item.message,'Short edited summary');
 assert.ok(Object.isFrozen(item));
});
test('opened alert details keep the complete source body for legacy unedited notifications',async()=>{
 const message='Legacy original\n\n'+'source body\n'.repeat(1500)+'LEGACY END';
 assert.equal((await project({id:'legacy',message})).details,message);
});
test('opened alert renders original details directly as escaped text, never markdown or a collapsed control',()=>{
 const src=read('web/core/chats.js'),line=src.split('\n').find(l=>l.trim().startsWith('if (NV) msgs ='));
 assert.doesNotMatch(line,/<details|md\(NV\.item\.details|slice\(|clip\(/);
 const details='<img src=x onerror="alert(1)">\n\n<script>bad()</script>';
 const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
 const ctx={NV:{id:'test',item:{details,message:'summary'},reply:{}},esc,md:esc,timeTag:()=>'',msgs:''};
 vm.runInNewContext(line,ctx);assert.ok(ctx.msgs.includes(esc(details)));assert.doesNotMatch(ctx.msgs,/<img|<script/);
 assert.ok(ctx.msgs.indexOf('summary')<ctx.msgs.indexOf('Original alert'));
 // drawn: the original block holds the details, whole, as plain text (never through md)
 const long=details+'\n\n'+'more words '.repeat(2000)+'THE END';
 const drawn={NV:{id:'test',item:{details:long,message:'summary'},reply:{}},esc,md:s=>`[md]${esc(s)}`,timeTag:()=>'',msgs:''};
 vm.runInNewContext(line,drawn);
 const doc=createDocument();doc.body.innerHTML=drawn.msgs;
 const orig=doc.querySelector('.ch-notif-original');
 assert.ok(orig,'the original block');assert.ok(orig.textContent.includes(long),'every word of the original, as text');
 assert.ok(!orig.textContent.includes('[md]'),'never markdown');assert.equal(doc.querySelector('details'),null);
});
test('legacy short alerts render once but long original bodies remain complete',async()=>{
 const line=read('web/core/chats.js').split('\n').find(l=>l.trim().startsWith('if (NV) msgs ='));
 for(const message of ['Legacy original message','long source\n'.repeat(1500)+'LEGACY END']){
  const item=await project({id:'legacy-render',message});
  const ctx={NV:{id:'legacy-render',item,reply:{}},esc:String,md:String,timeTag:()=>'',msgs:''};
  vm.runInNewContext(line,ctx);
  if(item.message===item.details){
   assert.doesNotMatch(ctx.msgs,/ch-notif-original/);
   assert.equal(ctx.msgs.split(message).length-1,1);
  }else{
   assert.match(ctx.msgs,/ch-notif-original/);
   assert.ok(ctx.msgs.includes(message));
  }
 }
});
test('opened alert original uses the shared scroller without bottom sticking or losing its place',()=>{
 const raw=f=>readFileSync(new URL('../web/core/'+f,import.meta.url),'utf8');
 const power=raw('chat-power.js'),paint=raw('chats-threadpaint.js'),css=read('web/core/chats.css');
 // placing an opened alert (real position): its own reading place, never the bottom of an empty New chat
 const C={};
 const place=runRecording(block(power,'  function position(w, el, nb, o) {')+'\nglobalThis.position=position;',{ch:()=>C,onScreen:()=>true});
 assert.equal(place.position({id:'w1',thread:'__new__'},{}, {}, {notification:true,notificationScroll:420}),true);
 const restored=place.calls.filter(c=>c[0]==='restore').map(c=>JSON.parse(JSON.stringify(c[2])));
 assert.deepEqual(restored,[{scrollTop:420}],'restored to where he was reading, not atBottom');
 place.calls.length=0; place.position({id:'w1',thread:'__new__'},{}, {}, {});
 assert.deepEqual(place.calls.filter(c=>c[0]==='restore').map(c=>JSON.parse(JSON.stringify(c[2]))),[{atBottom:true}],'a plain New chat still sits at the bottom');
 // scrolling it (real capture) records that place through the shared scroll box
 const cc={placeOptions:{notification:true}};
 const cap=runRecording(block(power,'  function capture(nb) {')+'\nglobalThis.capture=capture;',{onScreen:()=>true,H:{win:()=>({id:'w1'})},ch:()=>cc,scrollBox:()=>({scrollTop:333})});
 cap.capture({closest:sel=>sel==='[data-chats]'?{dataset:{chats:'w1'}}:null});
 assert.equal(cc.placeOptions.notificationScroll,333);
 // a repaint of the same alert keeps its scroll box (real threadpaint lines); another alert starts at the top
 const lines=paint.split('\n').filter(l=>l.includes('const noteBox = NV &&')||l.includes('const notificationScroll = noteBox')).join('\n');
 const keep=(id,nvId)=>runRecording(`globalThis.f=()=>{ ${lines}\n return notificationScroll; };`,{NV:{id:nvId},el:{dataset:{notificationId:id},querySelector:()=>({})},scrollBox:()=>({scrollTop:77})}).f();
 assert.equal(keep('n1','n1'),77); assert.equal(keep('n1','n2'),0);
 // the original body wraps and keeps its paragraphs
 const doc=createDocument(); doc.body.innerHTML='<div class="msg a ch-notif"><section class="ch-notif-details"><div class="ch-notif-original">Line one\n\nLine two</div></section></div>';
 const look=cascade(doc.querySelector('.ch-notif-original'),css);
 assert.equal(look['white-space']?.value,'pre-wrap'); assert.equal(look['overflow-wrap']?.value,'anywhere');
});
