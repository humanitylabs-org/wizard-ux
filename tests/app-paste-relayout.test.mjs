import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import { withServicesParts } from './fixtures/app-services-parts.mjs';
const source=withServicesParts(readFileSync(new URL('../web/core/app-services.js',import.meta.url),'utf8'));
// Android Chrome put a framed field's Paste bubble at its pre-keyboard spot (top of the screen) until the app was
// reopened. The shell gives every attached app document one extra layout after each frame resize.
function fixture(){
 const listeners={},frames=[];
 const body={style:{minHeight:''}};
 const child={document:{body,addEventListener(){}},addEventListener(t,fn){(listeners[t]||=[]).push(fn);},requestAnimationFrame(fn){frames.push(fn);},postMessage(){}};
 const location=new URL('https://wizard.example/wizard-os-home/');
 child.location=new URL('/telegram/',location);
 const frame={tagName:'IFRAME',src:child.location.href,isConnected:true,contentWindow:child,hasAttribute:()=>false,addEventListener(){},removeEventListener(){}};
 const app={id:'telegram',kind:'wizard',url:'/telegram/'};
 const window={WizCore:{apps:()=>({APPS:[app]}),workspaceNav:{setCount(){}}},dispatchEvent(){}};
 vm.runInNewContext(source,{window,location,URL,addEventListener(){},setInterval(){},setTimeout,clearTimeout,document:{hidden:false,readyState:'loading',addEventListener(){}},CustomEvent:class{},navigator:{}});
 window.WizAppServices.attach(frame,{appId:'telegram',path:app.url,isVisible:()=>true});
 return {listeners,frames,body,frame,window,app};
}
test('a keyboard resize of an app frame lays the app out once more, then restores its body',()=>{
 const f=fixture();
 assert.equal(f.listeners.resize?.length,1);
 f.listeners.resize[0]();
 assert.equal(f.body.style.minHeight,'1px');
 f.frames.shift()();
 assert.equal(f.body.style.minHeight,'');
});
test('several resizes before the next frame keep the app\'s own min-height',()=>{
 const f=fixture(); f.body.style.minHeight='50vh';
 f.listeners.resize[0](); f.listeners.resize[0]();
 assert.equal(f.frames.length,1);
 f.frames.shift()();
 assert.equal(f.body.style.minHeight,'50vh');
});
test('attaching the same frame again does not stack resize listeners',()=>{
 const f=fixture();
 f.window.WizAppServices.attach(f.frame,{appId:'telegram',path:f.app.url,isVisible:()=>true});
 assert.equal(f.listeners.resize.length,1);
});
