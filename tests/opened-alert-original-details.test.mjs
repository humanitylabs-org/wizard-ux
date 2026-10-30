// James: "shouldn't I be able to see the contents / details of this alert and not just its title?"
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
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
 assert.ok(line.includes('ch-notif-original'));assert.ok(line.includes('${esc(NV.item.details)}'));
 assert.doesNotMatch(line,/<details|md\(NV\.item\.details|slice\(|clip\(/);
 const details='<img src=x onerror="alert(1)">\n\n<script>bad()</script>';
 const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
 const ctx={NV:{id:'test',item:{details,message:'summary'},reply:{}},esc,md:esc,timeTag:()=>'',msgs:''};
 vm.runInNewContext(line,ctx);assert.ok(ctx.msgs.includes(esc(details)));assert.doesNotMatch(ctx.msgs,/<img|<script/);
 assert.ok(ctx.msgs.indexOf('summary')<ctx.msgs.indexOf('Original alert'));
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
 const power=read('web/core/chat-power.js'),chats=read('web/core/chats.js'),css=read('web/core/chats.css');
 assert.ok(power.indexOf('if (o.notification)')<power.indexOf("if (sid === '__new__' || !o.turns)"));
 assert.match(power,/c\.placeOptions\.notificationScroll = scrollBox\(nb\)\.scrollTop/);
 assert.match(chats,/el\.dataset\.notificationId === NV\.id/);
 assert.match(css,/\.ch-notif-original\s*\{[^}]*white-space: pre-wrap;[^}]*overflow-wrap: anywhere;/);
});
