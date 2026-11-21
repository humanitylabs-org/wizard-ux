// A stopped app says so in its window instead of a blank page (wizard-ux issue 1464).
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import { withServicesParts } from './fixtures/app-services-parts.mjs';
const source=withServicesParts(readFileSync(new URL('../web/core/app-services.js',import.meta.url),'utf8'));
class El {
 constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.attrs={};this.listeners={};this.textContent='';this.parentElement=null;}
 setAttribute(k,v){this.attrs[k]=v;} getAttribute(k){return this.attrs[k]??null;}
 append(...c){for(const x of c){x.parentElement=this;this.children.push(x);}} appendChild(x){this.append(x);return x;}
 remove(){const p=this.parentElement;if(p)p.children=p.children.filter(x=>x!==this);this.parentElement=null;}
 get isConnected(){return !!this.parentElement;}
 addEventListener(t,f){(this.listeners[t]||=[]).push(f);} removeEventListener(){}
 find(cls){if(this.className===cls)return this;for(const c of this.children){const r=c.find?.(cls);if(r)return r;}return null;}
}
function fixture({status='running',answer={status:502,headers:{}},body=null,origin='https://wizard.example',url,start=null,fastAbort=false}={}) {
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
 const starts=[];
 const fetch=async(h,o)=>{
  if(h.includes('/store-install/_start/')){starts.push([h,o]);const a=start?await start(o?.method||'GET',starts.length,h):{status:404,json:{error:'not found'}};
   if(a.hang)return new Promise((_,no)=>o.signal.addEventListener('abort',()=>no(new Error('aborted'))));
   if(a.throw)throw new Error('offline');return {status:a.status,headers:{get:()=>null},json:async()=>a.json};}
  fetched.push([h,o]);return {status:answer.status,headers:{get:k=>answer.headers[k.toLowerCase()]??null},body:{cancel(){}}};};
 const timer=fastAbort?(fn,ms)=>setTimeout(fn,ms===20000?1:ms):setTimeout;
 vm.runInNewContext(source,{window,location,URL,fetch,AbortController,addEventListener(){},setInterval(){},setTimeout:timer,clearTimeout,document,CustomEvent:class{},navigator:{}});
 window.WizAppServices.attach(frame,{appId:id,path:app.url,isVisible:()=>true});
 const fire=async()=>{for(const f of frame.listeners.load||[])f();await new Promise(r=>setTimeout(r,5));};
 return {app,host,frame,fire,fetched,loads,starts,answer,panel:()=>host.find('wos-app-stopped'),child};
}
const textOf=p=>p.children.map(c=>c.textContent).join(' | ');
test('a same-origin app whose address answers 502 with an empty page shows "is stopped" with Start',async()=>{
 const f=fixture(); assert.equal(f.panel(),null,'nothing before the page loads');
 await f.fire();
 const p=f.panel(); assert.ok(p,'the window says the app is stopped');
 assert.match(textOf(p),/Messenger is stopped\./); assert.match(textOf(p),/Tap Start/);
 assert.doesNotMatch(textOf(p),/Ask your Wizard/,'never sends the owner to an agent that cannot start apps');
 assert.equal(p.children[2].textContent,'Start');
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
const click=async b=>{for(const h of b.listeners.click) await h();};
test('Start calls the App Manager start route, waits for running, then loads the app',async()=>{
 let f; f=fixture({start:async(m,n)=>{ if(m==='POST') return {status:202,json:{app:'messenger',state:'starting',status:'stopped'}};
  if(n<3) return {status:200,json:{app:'messenger',state:'starting'}}; f.answer.status=200; return {status:200,json:{app:'messenger',state:'running',status:'running'}}; }});
 await f.fire(); const p=f.panel(), b=p.children[2];
 const done=click(b); assert.equal(b.textContent,'Starting…'); assert.equal(b.disabled,true); assert.match(textOf(p),/Starting Messenger/);
 await done;
 const [post]=f.starts; assert.equal(post[0],'https://wizard.example/wizard-os-home/store-install/_start/messenger');
 assert.equal(post[1].method,'POST'); assert.equal(post[1].body,'{}'); assert.equal(post[1].headers['Content-Type'],'application/json'); assert.equal(post[1].headers['X-Wizard-Store'],'1');
 assert.ok(f.starts.slice(1).every(([h,o])=>h===post[0]&&!o.method),'then GET the same address'); assert.equal(f.starts.length,3);
 assert.deepEqual(f.loads,['https://wizard.example/messenger/'],'the window loads by itself'); assert.equal(f.panel(),null);
});
test('an app that is already running answers 200 running: the window just loads',async()=>{
 const f=fixture({start:async()=>{return {status:200,json:{app:'messenger',state:'running',status:'running',note:'already running'}};}});
 await f.fire(); f.answer.status=200; await click(f.panel().children[2]);
 assert.equal(f.starts.length,1); assert.deepEqual(f.loads,['https://wizard.example/messenger/']); assert.equal(f.panel(),null);
 f.answer.status=502; await f.fire(); assert.ok(f.panel(),'still down later: shown again');
});
test('a failed start shows the reason on one line and Retry, which starts again',async()=>{
 let n=0; const f=fixture({start:async(m)=>{ if(m==='POST'){n++; return n===1?{status:202,json:{state:'starting'}}:{status:200,json:{state:'running'}};}
  return {status:200,json:{state:'failed',error:'the app did not come back\nTraceback ...'}}; }});
 await f.fire(); const p=f.panel(), b=p.children[2]; await click(b);
 assert.equal(f.panel(),p,'still on the stopped page'); assert.equal(b.textContent,'Retry'); assert.equal(b.disabled,false);
 assert.equal(p.children[1].textContent,'Could not start Messenger: the app did not come back');
 f.answer.status=200; await click(b); assert.equal(f.panel(),null); assert.equal(f.loads.length,1);
});
for(const [status,json] of [[400,{error:'bad app id'}],[404,{error:'not found'}]]) test(`an App Manager without the start route (${status} ${json.error}) says to update WizardOS`,async()=>{
 const f=fixture({start:async()=>({status,json})}); await f.fire(); const p=f.panel(), b=p.children[2]; await click(b);
 assert.equal(p.children[1].textContent,'Update WizardOS in Settings, then tap Start.'); assert.equal(b.textContent,'Start'); assert.equal(f.loads.length,0);
});
test('other refusals (busy updating, owner gate) show their reason; no connection says so',async()=>{
 const f=fixture({start:async()=>({status:409,json:{error:'messenger is updating; wait for that to finish, then start it'}})}); await f.fire();
 const p=f.panel(); await click(p.children[2]); assert.equal(p.children[1].textContent,'Could not start Messenger: messenger is updating; wait for that to finish, then start it');
 const g=fixture({start:async()=>({throw:true})}); await g.fire(); const q=g.panel(); await click(q.children[2]);
 assert.equal(q.children[1].textContent,'Could not start Messenger: Could not reach your Wizard.'); assert.equal(q.children[2].textContent,'Retry');
});
test('an app on another origin cannot be asked: the listed status decides until it is started here',async()=>{
 const f=fixture({status:'stopped',url:'https://wizard.example:8861/',start:async()=>({status:200,json:{state:'running'}})}); assert.ok(f.panel());
 await f.fire(); assert.ok(f.panel()); assert.equal(f.fetched.length,0);
 await click(f.panel().children[2]); assert.equal(f.fetched.length,0,'another origin is never asked');
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
test('every start request carries an abort deadline, so a box that never answers ends in Retry',async()=>{
 const f=fixture({fastAbort:true,start:async()=>({hang:true})}); await f.fire(); const p=f.panel();
 await click(p.children[2]);
 assert.ok(f.starts[0][1].signal,'the POST has an abort signal');
 assert.equal(p.children[2].textContent,'Retry'); assert.equal(p.children[2].disabled,false);
 assert.equal(p.children[1].textContent,'Could not start Messenger: Could not reach your Wizard.');
});
