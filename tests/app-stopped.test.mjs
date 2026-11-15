// A stopped app says so in its window instead of a blank page (wizard-ux issue 1464).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../web/core/app-services.js',import.meta.url),'utf8');
class El {
 constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.attrs={};this.listeners={};this.textContent='';this.parentElement=null;}
 setAttribute(k,v){this.attrs[k]=v;} getAttribute(k){return this.attrs[k]??null;}
 append(...c){for(const x of c){x.parentElement=this;this.children.push(x);}} appendChild(x){this.append(x);return x;}
 remove(){const p=this.parentElement;if(p)p.children=p.children.filter(x=>x!==this);this.parentElement=null;}
 get isConnected(){return !!this.parentElement;}
 addEventListener(t,f){(this.listeners[t]||=[]).push(f);} removeEventListener(){}
 find(cls){if(this.className===cls)return this;for(const c of this.children){const r=c.find?.(cls);if(r)return r;}return null;}
}
function fixture({status='running',answer={status:502,headers:{}},body=null,origin='https://wizard.example',url}={}) {
 const location=new URL('https://wizard.example/wizard-os-home/'), id='messenger';
 const appUrl=url||'/messenger/', loads=[], fetched=[];
 const head=new El('head'), byId={};
 const document={hidden:false,readyState:'loading',head,addEventListener(){},getElementById:k=>byId[k]||null,
  createElement:t=>{const e=new El(t);Object.defineProperty(e,'id',{set(v){byId[v]=e;},get(){return '';}});return e;}};
 const doc={body:body||{childElementCount:0,textContent:''}};
 const child={location:{href:new URL(appUrl,location).href,replace:h=>loads.push(h)},document:doc,addEventListener(){},postMessage(){}};
 const host=new El('div'); const frame=new El('iframe');
 Object.assign(frame,{src:child.location.href,contentWindow:child,contentDocument:doc,hasAttribute:()=>false});
 host.append(frame);
 const app={id,name:'Messenger',kind:'wizard',url:appUrl,status};
 const window={WizCore:{apps:()=>({APPS:[app]}),refreshApps:async()=>true,workspaceNav:{setCount(){}}},dispatchEvent(){}};
 const fetch=async(h,o)=>{fetched.push([h,o]);return {status:answer.status,headers:{get:k=>answer.headers[k.toLowerCase()]??null},body:{cancel(){}}};};
 vm.runInNewContext(source,{window,location,URL,fetch,AbortController,addEventListener(){},setInterval(){},setTimeout,clearTimeout,document,CustomEvent:class{},navigator:{}});
 window.WizAppServices.attach(frame,{appId:id,path:app.url,isVisible:()=>true});
 const fire=async()=>{for(const f of frame.listeners.load||[])f();await new Promise(r=>setTimeout(r,5));};
 return {app,host,frame,fire,fetched,loads,panel:()=>host.find('wos-app-stopped'),child};
}
const textOf=p=>p.children.map(c=>c.textContent).join(' | ');
test('a same-origin app whose address answers 502 with an empty page shows "is stopped" with Try again',async()=>{
 const f=fixture(); assert.equal(f.panel(),null,'nothing before the page loads');
 await f.fire();
 const p=f.panel(); assert.ok(p,'the window says the app is stopped');
 assert.match(textOf(p),/Messenger is stopped\./); assert.match(textOf(p),/Ask your Wizard to start it/);
 assert.equal(p.children[2].textContent,'Try again');
 assert.equal(f.fetched[0][0],'https://wizard.example/messenger/'); assert.equal(f.fetched[0][1].headers.Accept,'text/html');
});
for(const status of [503,504]) test(`${status} counts as stopped too`,async()=>{ const f=fixture({answer:{status,headers:{}}}); await f.fire(); assert.ok(f.panel()); });
test('the App Manager owner edge "restarting" page (X-Wizard-Waiting) is left alone',async()=>{
 const f=fixture({answer:{status:503,headers:{'x-wizard-waiting':'1'}}}); await f.fire(); assert.equal(f.panel(),null);
});
test('a running app is never covered, and a page with content is not even asked',async()=>{
 const f=fixture({answer:{status:200,headers:{}}}); await f.fire(); assert.equal(f.panel(),null);
 const g=fixture({body:{childElementCount:3,textContent:'Chats'}}); await g.fire(); assert.equal(g.panel(),null); assert.equal(g.fetched.length,0);
});
test('the box list saying stopped shows the panel before the page loads; a same-origin page that answers wins',async()=>{
 const f=fixture({status:'stopped',answer:{status:200,headers:{}}}); assert.ok(f.panel(),'shown at once');
 await f.fire(); assert.equal(f.panel(),null,'the page answered, so the stale list is ignored');
});
test('Try again reloads the window, and the panel goes once the app answers',async()=>{
 const f=fixture(); await f.fire(); const p=f.panel();
 for(const h of p.children[2].listeners.click) await h();
 assert.deepEqual(f.loads,['https://wizard.example/messenger/']); assert.equal(f.panel(),null);
 f.fetched.length=0; await f.fire(); assert.ok(f.panel(),'still down: shown again');
});
test('an app on another origin cannot be asked: the listed status decides until Try again',async()=>{
 const f=fixture({status:'stopped',url:'https://wizard.example:8861/'}); assert.ok(f.panel());
 await f.fire(); assert.ok(f.panel()); assert.equal(f.fetched.length,0);
 for(const h of f.panel().children[2].listeners.click) await h();
 await f.fire(); assert.equal(f.panel(),null,'a stale list costs one tap, never a locked app');
});
test('an empty page whose app answers by the time it is asked loads again once (no blank window left)',async()=>{
 const f=fixture({answer:{status:200,headers:{}}}); await f.fire();
 assert.equal(f.panel(),null); assert.deepEqual(f.loads,['https://wizard.example/messenger/']);
 await f.fire(); assert.equal(f.loads.length,1,'only once: a page that is really empty never loops');
});
test('an opaque page (browser boundary) that answers is not reloaded',async()=>{
 const f=fixture({answer:{status:200,headers:{}}}); f.frame.contentDocument=null; await f.fire();
 assert.equal(f.panel(),null); assert.equal(f.loads.length,0);
});
