// Browser panel trial (James, 9 Nov 2026: "Can we try panel as a test to see if I like it?").
// WizardOS settings.json `links.panel: true` + the WizardOS Android app's `openInPanel` bridge: a tapped outside link
// opens in a Custom Tab over Wizard (Brave when installed). Off by default; desktop, Wizard's own pages, private
// hosts, files and the explicit "Open in your browser" choices are unchanged; an APK without the bridge keeps the
// browser route. Never routed into Browser Reader.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../web/core/links.js',import.meta.url),'utf8');
function fixture({native=false,panelBridge=true,links={panel:true},throws=false}={}) {
 const calls=[], origin='https://wizard.example', location=new URL(origin+'/wizard-os-home/');
 class El {
  constructor(){this.handlers={};this.nodes={};this.style={};this.classList={add(){},remove(){},contains(){return false;},toggle(){return false;}};this.contentWindow={location:{replace(){}}};}
  setAttribute(){} appendChild(){} remove(){} querySelector(s){return this.nodes[s] ||= new El();}
  addEventListener(n,fn){(this.handlers[n] ||= []).push(fn);}
  click(){calls.push(['download',this.href]);}
 }
 const document={body:new El(),createElement:()=>new El()}, w={open:url=>calls.push(['browser',url])};
 if(native){
  w.WizardOSNative={openInBrowser:url=>calls.push(['native-browser',url]),download:url=>calls.push(['native-download',url])};
  if(panelBridge)w.WizardOSNative.openInPanel=url=>{if(throws)throw new Error('gone');calls.push(['panel',url]);};
 }
 const localStorage={getItem:()=>null,setItem(){}};
 w.WizConfig={raw:{settings:links===null?{}:{links}},localURL:(h,b)=>new URL(h,b)};
 vm.runInNewContext(source,{window:w,location,navigator:{userAgent:'fixture',userActivation:{isActive:true}},localStorage,document,URL,console,setTimeout,clearTimeout,performance:{now:()=>0},Date,JSON,Object,Set});
 const L=w.WizLinks.mount({readerApp:()=>({id:'browser',url:'/browser/'}),asWindow:path=>{calls.push(['window',path]);return true;}});
 const chat=new El();w.WizLinks.intercept(chat,L);
 const doc=new El();w.WizLinks.guardFrame({document:doc,location:new URL(origin+'/search/'),open(){},frameElement:{}},'/search/',L);
 function click(root,href,attrs={}) {
  const a={ownerDocument:document,getAttribute:k=>k==='href'?href:attrs[k] || null,hasAttribute:k=>k in attrs,closest:s=>s==='[data-mi]' || s==='[data-chats]'?null:({})};
  const e={button:0,target:{closest:()=>a},preventDefault(){this.defaultPrevented=true;},stopPropagation(){}};
  for(const fn of root.handlers.click || [])fn(e);return e;
 }
 return {calls,L,chat,doc,click};
}
const neverReader=f=>assert.equal(f.calls.some(c=>c[0]==='window'&&/\/browser\//.test(c[1])),false,'never routed into Browser Reader');

test('panel on, phone with the bridge: a chat link opens in the panel, never /browser/ and never the system browser',()=>{
 const f=fixture({native:true});f.click(f.chat,'https://en.wikipedia.org/wiki/Brave');
 assert.deepEqual(f.calls,[['panel','https://en.wikipedia.org/wiki/Brave']]);neverReader(f);
});
test('panel on, phone: a Search result and an app window.open use the same panel',()=>{
 const f=fixture({native:true});f.click(f.doc,'https://news.ycombinator.com/item?id=1',{target:'_blank'});
 assert.equal(f.L.open('https://example.com/x'),true);
 assert.deepEqual(f.calls,[['panel','https://news.ycombinator.com/item?id=1'],['panel','https://example.com/x']]);neverReader(f);
});
test('panel on with Reader on too: Reader keeps its outside links; a Wizard host Reader skips keeps the browser route',()=>{
 const f=fixture({native:true,links:{panel:true,reader:true}});f.click(f.chat,'https://example.com/story');f.click(f.chat,'https://wizard.aiwizards.com/clips/');
 assert.deepEqual(f.calls,[['window','/browser/?url=https%3A%2F%2Fexample.com%2Fstory'],['native-browser','https://wizard.aiwizards.com/clips/']]);
});
test('panel off (unset, the default): the phone keeps the existing openInBrowser route',()=>{
 for(const links of [null,{},{panel:false},{panel:'true'}]){
  const f=fixture({native:true,links});f.click(f.chat,'https://example.com/a');
  assert.deepEqual(f.calls,[['native-browser','https://example.com/a']],JSON.stringify(links));
 }
});
test('panel on, older APK without openInPanel: the existing openInBrowser route',()=>{
 const f=fixture({native:true,panelBridge:false});f.click(f.chat,'https://example.com/a');
 assert.deepEqual(f.calls,[['native-browser','https://example.com/a']]);
});
test('panel on but the bridge throws: falls back to openInBrowser on the same tap',()=>{
 const f=fixture({native:true,throws:true});f.click(f.chat,'https://example.com/a');
 assert.deepEqual(f.calls,[['native-browser','https://example.com/a']]);
});
test('desktop is unchanged with panel on: a normal new tab',()=>{
 const f=fixture({native:false});f.click(f.chat,'https://example.com/a');f.click(f.doc,'https://example.com/b');
 assert.deepEqual(f.calls,[['browser','https://example.com/a'],['browser','https://example.com/b']]);
});
test('panel on: Wizard own pages keep their in-Wizard route',()=>{
 const f=fixture({native:true});f.click(f.chat,'/notes/');f.click(f.chat,'https://wizard.example/cinequeue/');
 assert.deepEqual(f.calls,[['window','/notes/'],['window','/cinequeue/']]);
});
test('panel on: other Wizard and private hosts keep the existing browser route, never the panel',()=>{
 for(const href of ['https://wizard.example-tailnet.ts.net/notes/','https://private.wizard001.com/apps/','http://192.168.1.20/','http://nas/']){
  const f=fixture({native:true});f.click(f.chat,href);assert.deepEqual(f.calls,[['native-browser',href]],href);
 }
});
test('panel on: outside files still download and the explicit Open in your browser stays the browser',()=>{
 const f=fixture({native:true});f.click(f.chat,'https://example.com/file.pdf');
 f.click(f.doc,'https://example.com/story',{'data-wizard-browse':'',target:'_blank'});
 assert.deepEqual(f.calls,[['native-download','https://example.com/file.pdf'],['native-browser','https://example.com/story']]);
});
