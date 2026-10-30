import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
// Reply to selected words in any app (Miguel, 30 Oct 2026): the shell draws one Reply over an app's selection and
// hands the words to the same unsent context-draft path Morning Report uses. Nothing is sent.
const source=readFileSync(new URL('../web/core/app-services.js',import.meta.url),'utf8');
function el(tag){const l={};return {tag,hidden:false,style:{},attrs:{},offsetWidth:72,offsetHeight:44,setAttribute(k,v){this.attrs[k]=v;},addEventListener(t,f){(l[t]||=[]).push(f);},fire(t){for(const f of l[t]||[])f({preventDefault(){},stopPropagation(){}});},append(){} };}
function fixture({id='wizard-music',kind='wizard',text='Draft a reply to Ana',meta=false,editable=false}={}){
 const calls=[],location=new URL('https://wizard.example/wizard-os-home/');
 const docL={};let cleared=0;
 const range={startContainer:{nodeType:1,closest:()=>editable?{}:null},endContainer:{nodeType:1,closest:()=>null},getClientRects:()=>[{left:100,top:200,width:80,height:18,bottom:218}]};
 const sel={text,get isCollapsed(){return !this.text;},get rangeCount(){return this.text?1:0;},getRangeAt:()=>range,toString(){return this.text;},removeAllRanges(){cleared++;this.text='';}};
 const doc={title:'Music',activeElement:null,addEventListener(t,f){(docL[t]||=[]).push(f);},querySelector:q=>meta&&/wizard-selection-reply/.test(q)?{}:null};
 const child={location:new URL('/'+id+'/',location),document:doc,getSelection:()=>sel,addEventListener(){},postMessage(){}};
 const frame={tagName:'IFRAME',src:child.location.href,isConnected:true,contentWindow:child,hasAttribute:()=>false,addEventListener(){},removeEventListener(){},getBoundingClientRect:()=>({left:500,top:40,right:1300,bottom:900})};
 const app={id,kind,name:'Music',url:'/'+id+'/'};
 const made=[];let rafs=[];
 const document={hidden:false,readyState:'loading',addEventListener(){},createElement:t=>{const e=el(t);made.push(e);return e;},body:{append(){}}};
 const window={WizCore:{apps:()=>({APPS:[app]})},dispatchEvent(){},__wos:{toast:(...a)=>calls.push({toast:a})}};
 vm.runInNewContext(source,{window,location,URL,document,addEventListener(){},setInterval(){},setTimeout,clearTimeout,CustomEvent:class{},navigator:{},requestAnimationFrame:f=>{rafs.push(f);return rafs.length;},cancelAnimationFrame(){}});
 const state={visible:true};
 window.WizAppServices.attach(frame,{appId:id,path:app.url,isVisible:()=>state.visible,openContextDraft:(key,item)=>{calls.push({key,item});return {kind:'unsent-draft',id:'fixture',sent:false};}});
 const select=()=>{for(const f of docL.selectionchange||[])f();const r=rafs;rafs=[];for(const f of r)f();};
 return {services:window.WizAppServices,frame,calls,state,sel,made,select,button:()=>made.find(e=>e.tag==='button'),cleared:()=>cleared};
}
test('selected words in an app show the shell Reply above them, inside the window',()=>{
 const f=fixture();f.select();const b=f.button();assert.ok(b);assert.equal(b.hidden,false);assert.equal(b.textContent,'Reply');
 assert.equal(b.style.left,Math.round(500+100+40-36)+'px');assert.equal(b.style.top,Math.round(40+200-44-8)+'px');
});
test('Reply opens an unsent Chats draft keyed to this app with the words as its reply, then clears the selection',()=>{
 const f=fixture();f.select();f.button().fire('click');
 assert.equal(f.calls.length,1);assert.match(f.calls[0].key,/^wizard-music:sel-[0-9a-f]+$/);
 assert.deepEqual({...f.calls[0].item},{title:'Music',message:'Draft a reply to Ana'});
 assert.equal(f.cleared(),1);assert.equal(f.button().hidden,true);
});
test('the same words reuse one draft id; different words start another',()=>{
 const a=fixture(),b=fixture(),c=fixture({text:'Something else'});
 for(const f of [a,b,c]){f.select();f.button().fire('click');}
 assert.equal(a.calls[0].key,b.calls[0].key);assert.notEqual(a.calls[0].key,c.calls[0].key);
});
for(const [name,opts,alter] of [['an app that draws its own Reply',{meta:true}],['an editable field',{editable:true}],['a hidden window',{},f=>f.state.visible=false],['a non-Wizard page',{kind:'web'}],['no selection',{text:''}]]) test('no Reply for '+name,()=>{
 const f=fixture(opts);alter?.(f);f.select();assert.ok(!f.button()||f.button().hidden);assert.equal(f.calls.filter(c=>c.key).length,0);
});
test('a window hidden after selecting cannot open a draft',()=>{
 const f=fixture();f.select();f.state.visible=false;f.button().fire('click');assert.equal(f.calls.filter(c=>c.key).length,0);
});
test('⌥A with words selected replies with those words, even in an app that draws its own Reply',()=>{
 const f=fixture({meta:true});assert.equal(f.services.replyAbout(f.frame,'screen words'),'selection');
 assert.deepEqual({...f.calls[0].item},{title:'Music',message:'Draft a reply to Ana'});assert.equal(f.cleared(),1);
});
test('⌥A with nothing selected quotes what is on screen',()=>{
 const f=fixture({text:''});assert.equal(f.services.replyAbout(f.frame,'Now playing · Song A'),'screen');
 assert.deepEqual({...f.calls[0].item},{title:'Music',message:'Now playing · Song A'});
});
for(const [name,opts,alter,screen] of [['a hidden window',{},f=>f.state.visible=false,'x'],['a non-Wizard page',{kind:'web'},null,'x'],['nothing to quote',{text:''},null,'  ']]) test('⌥A opens nothing for '+name,()=>{
 const f=fixture(opts);alter?.(f);assert.equal(f.services.replyAbout(f.frame,screen),'');assert.equal(f.calls.filter(c=>c.key).length,0);
});
