import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../web/core/links.js',import.meta.url),'utf8');
function fixture({installed=true,native=false,appURL='/browser/'}={}) {
 const calls=[], downloads=[], origin='https://wizard.example', location=new URL(origin+'/wizard-os-home/');
 class El {
  constructor(){this.handlers={};this.nodes={};this.style={};this.classList={add(){},remove(){},contains(){return false;},toggle(){return false;}};this.contentWindow={location:{replace(){}}};}
  setAttribute(){} appendChild(){} remove(){} querySelector(s){return this.nodes[s] ||= new El();}
  addEventListener(n,fn){(this.handlers[n] ||= []).push(fn);}
  click(){calls.push(['download',this.href]);downloads.push({href:this.href,target:this.target,rel:this.rel,download:this.download});}
 }
 const document={body:new El(),createElement:()=>new El()}, w={open:url=>calls.push(['browser',url])};
 if(native)w.WizardOSNative={openInBrowser:url=>calls.push(['native-browser',url]),download:url=>calls.push(['native-download',url])};
 vm.runInNewContext(source,{window:w,location,navigator:{userAgent:'fixture'},document,URL,console,setTimeout,clearTimeout,performance:{now:()=>0}});
 const L=w.WizLinks.mount({readerApp:()=>installed?{id:'browser',url:appURL}:null,asWindow:path=>{calls.push(['window',path]);return true;}});
 const chat=new El();w.WizLinks.intercept(chat,L);
 const doc=new El(),win={document:doc,location:new URL(origin+'/search/'),open(){},frameElement:{}};
 w.WizLinks.guardFrame(win,'/search/',L);
 function click(root,href,attrs={}) {
   const a={ownerDocument:document,getAttribute:k=>k==='href'?href:attrs[k] || null,hasAttribute:k=>k in attrs,closest:s=>s==='[data-mi]' || s==='[data-chats]'?null:({})};
   const e={button:0,target:{closest:()=>a},preventDefault(){this.defaultPrevented=true;},stopPropagation(){}};
   for(const fn of root.handlers.click || [])fn(e);return e;
 }
 return {calls,downloads,L,chat,doc,click};
}
test('chat tap synchronously opens installed Browser Reader, never the remote origin',()=>{const f=fixture();f.click(f.chat,'https://example.com/story?a=1#part');assert.deepEqual(f.calls,[['window','/browser/?url=https%3A%2F%2Fexample.com%2Fstory%3Fa%3D1%23part']]);});
test('Search hosted result uses the same Browser Reader path',()=>{const f=fixture();f.click(f.doc,'https://example.com/story');assert.deepEqual(f.calls,[['window','/browser/?url=https%3A%2F%2Fexample.com%2Fstory']]);});
test('without Reader the existing system browser path is retained',()=>{const f=fixture({installed:false});f.click(f.chat,'https://example.com/story');assert.deepEqual(f.calls,[['browser','https://example.com/story']]);});
test('a Wizard internal link still opens internally',()=>{const f=fixture();f.click(f.chat,'/notes/');assert.deepEqual(f.calls,[['window','/notes/']]);});
for(const ext of ['pdf','apk'])test('external '+ext+' remains a download',()=>{const f=fixture();f.click(f.chat,'https://example.com/file.'+ext);assert.deepEqual(f.calls,[['download','https://example.com/file.'+ext]]);});
test('Reader explicit source escape opens desktop original, not another Reader',()=>{const f=fixture();f.click(f.doc,'https://example.com/story',{'data-wizard-browse':'',target:'_blank'});assert.deepEqual(f.calls,[['browser','https://example.com/story']]);});
test('Reader source escape uses the Android openInBrowser bridge',()=>{const f=fixture({native:true});f.click(f.doc,'https://example.com/story',{'data-wizard-browse':'',target:'_blank'});assert.deepEqual(f.calls,[['native-browser','https://example.com/story']]);});
test('cross-origin file downloads have a safe new context when inline responses ignore download',()=>{for(const ext of ['pdf','apk']){const f=fixture();f.click(f.chat,'https://example.com/inline.'+ext);assert.equal(f.downloads[0].target,'_blank');assert.equal(f.downloads[0].rel,'noopener');assert.equal(f.downloads[0].download,'inline.'+ext);}});
test('same-origin downloads keep the existing download context',()=>{const f=fixture();f.click(f.chat,'/reports/file.pdf');assert.equal(f.downloads[0].target,undefined);assert.equal(f.downloads[0].download,'file.pdf');});
test('native file downloads still use the native bridge',()=>{const f=fixture({native:true});f.click(f.chat,'https://example.com/file.pdf');assert.deepEqual(f.calls,[['native-download','https://example.com/file.pdf']]);assert.equal(f.downloads.length,0);});
test('Reader route rejects an outside-origin app registration',()=>{const f=fixture({appURL:'https://untrusted.example/'});assert.equal(f.L.open('https://example.com/'),true);assert.equal(f.calls[0][0],'browser');});
