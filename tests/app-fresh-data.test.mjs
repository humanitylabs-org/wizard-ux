// Issue 1243: an open app window kept old data (Calendar after the agent moved events) until it was closed and
// reopened. The shell now asks a connected app to read again when its window comes back into view or to the front,
// about once a minute while in view (never while hidden), and soon after an agent tool named for that app finishes.
// The app side turns that ask into view.onRefresh, or into the visibilitychange existing apps already reload on.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const services=readFileSync(new URL('../web/core/app-services.js',import.meta.url),'utf8');
const client=readFileSync(new URL('../web/core/app-client.js',import.meta.url),'utf8');
const live=readFileSync(new URL('../web/live.js',import.meta.url),'utf8');

function host(id='wizard-calendar') {
 const posted=[],location=new URL('https://wizard.example/wizard-os-home/'),view={seen:true,front:false},doc={hidden:false,readyState:'loading',listeners:{},addEventListener(t,fn){(this.listeners[t]||=[]).push(fn);}};
 const child={location:new URL('/'+id+'/',location),document:{},addEventListener(){},postMessage:(m,o)=>posted.push([m,o])};
 const frame={tagName:'IFRAME',src:child.location.href,isConnected:true,contentWindow:child,hasAttribute:()=>false,addEventListener(){},removeEventListener(){}};
 const app={id,kind:'wizard',url:'/'+id+'/',name:id};
 const window={WizCore:{apps:()=>({APPS:[app]}),workspaceNav:{setCount(){}}},dispatchEvent(){}};
 const listeners={};
 vm.runInNewContext(services,{window,location,URL,addEventListener(t,fn){(listeners[t]||=[]).push(fn);},setInterval(){},setTimeout,clearTimeout,document:doc,CustomEvent:class{constructor(t,o){this.type=t;this.detail=o?.detail;}},navigator:{}});
 const S=window.WizAppServices;
 S.attach(frame,{appId:id,path:app.url,isVisible:()=>view.seen,isFront:()=>view.front});
 S.connect(child,{});
 const asks=()=>posted.filter(([m])=>m.type==='wizard:app:refresh').map(([m,o])=>{assert.equal(o,'https://wizard.example');return m.reason;});
 return {S,view,doc,asks,listeners,child};
}

test('a window coming back into view or to the front asks its app to read again, once per gap',()=>{
 const h=host(); let t=1_000_000;
 h.S.fresh.tick(t); assert.deepEqual(h.asks(),[],'a just-loaded document is fresh');
 h.view.seen=false; h.S.fresh.tick(t+=5000); assert.deepEqual(h.asks(),[]);
 h.view.seen=true; h.S.fresh.tick(t+=5000); assert.deepEqual(h.asks(),['visible']);
 h.view.front=true; h.S.fresh.tick(t+=1000); assert.deepEqual(h.asks(),['visible'],'focus inside the gap waits');
 h.S.fresh.tick(t+=1000); h.S.fresh.tick(t+=1000); assert.deepEqual(h.asks(),['visible','focus'],'and is sent once the gap passes, not dropped');
 h.view.front=false; h.S.fresh.tick(t+=4000); h.view.front=true; h.S.fresh.tick(t+=1000); assert.deepEqual(h.asks(),['visible','focus','focus']);
});

test('about once a minute while in view, never while hidden',()=>{
 const h=host(); let t=2_000_000;
 h.S.fresh.tick(t); h.S.fresh.tick(t+=59_000); assert.deepEqual(h.asks(),[]);
 h.S.fresh.tick(t+=1000); assert.deepEqual(h.asks(),['poll']);
 h.view.seen=false; for(let i=0;i<5;i++) h.S.fresh.tick(t+=60_000); assert.deepEqual(h.asks(),['poll'],'window out of view: no poll');
 h.view.seen=true; h.doc.hidden=true; for(let i=0;i<5;i++) h.S.fresh.tick(t+=60_000); assert.deepEqual(h.asks(),['poll'],'page hidden: no poll');
});

test('the page itself coming back counts as the read (the app frame gets its own real visibilitychange)',()=>{
 const h=host(); let t=3_000_000;
 h.S.fresh.tick(t); h.doc.hidden=true; h.S.fresh.tick(t+=10_000);
 h.doc.hidden=false; for(const fn of h.doc.listeners.visibilitychange||[]) fn();
 h.S.fresh.tick(Date.now()+1000); assert.deepEqual(h.asks(),[]);
});

test('an agent tool named for the app asks that open window to read again',()=>{
 const h=host(); let t=4_000_000;
 h.S.fresh.tick(t);
 assert.equal(h.S.fresh.tool('mcp_wizard_calendar_calendar_update_event',t+=10_000),1);
 assert.deepEqual(h.asks(),['agent']);
 assert.equal(h.S.fresh.tool('calendar_create_event',t+=1000),1,'inside the gap: queued');
 h.S.fresh.tick(t+=3000); assert.deepEqual(h.asks(),['agent','agent']);
 assert.equal(h.S.fresh.tool('notes_write',t+=10_000),0); assert.equal(h.S.fresh.tool('terminal',t),0); assert.equal(h.S.fresh.tool('mycalendarx_add',t),0);
 assert.ok(h.listeners['wizard:agent-tool']?.length,'the shell listens for agent tools');
 h.view.seen=false; assert.equal(h.S.fresh.tool('calendar_update_event',t+=10_000),0,'out of view: it reads when it comes back');
});

test('the agent run stream announces each finished tool',()=>{
 assert.match(live,/type === 'tool\.completed'[\s\S]{0,600}dispatchEvent\(new CustomEvent\('wizard:agent-tool', \{ detail: \{ tool: String\(d\.tool\) \} \}\)\)/);
});

function app({register}={}) {
 const parent={postMessage(){}},msgs=[],events=[];
 const docL={};
 const document={hidden:false,documentElement:{style:{setProperty(){}},dataset:{},setAttribute(){}},head:{appendChild(){}},createElement:()=>({}),addEventListener(t,fn){(docL[t]||=[]).push(fn);},dispatchEvent(e){events.push(e);for(const fn of docL[e.type]||[]) fn(e);return true;}};
 const winL={};
 const window={};
 const ctx={window,parent,location:new URL('https://wizard.example/wizard-calendar/'),document,history:{pushState(){},replaceState(){},state:null},addEventListener(t,fn){(winL[t]||=[]).push(fn);},dispatchEvent(){},setTimeout,clearTimeout,setInterval(){},console,URL,Event:class{constructor(t,o){this.type=t;this.bubbles=!!o?.bubbles;this.isTrusted=false;}},CustomEvent:class{constructor(t,o){this.type=t;this.detail=o?.detail;}},navigator:{},MessageEvent:class{}};
 ctx.window=ctx; ctx.self=ctx;
 vm.runInNewContext(client,ctx);
 const send=data=>{for(const fn of winL.message||[]) fn({source:parent,origin:'https://wizard.example',data});};
 return {W:ctx.WizardApp,send,events,document,docL};
}

test('an app without a handler gets the visibilitychange it already reloads on; one with onRefresh gets the reason',()=>{
 const a=app(); a.send({type:'wizard:app:refresh',version:1,reason:'agent'});
 assert.equal(a.events.length,1); assert.equal(a.events[0].type,'visibilitychange'); assert.equal(a.events[0].bubbles,true);
 a.document.hidden=true; a.send({type:'wizard:app:refresh',version:1,reason:'poll'}); assert.equal(a.events.length,1,'never while hidden');
 const b=app(), got=[]; const off=b.W.view.onRefresh(r=>got.push(r.reason));
 b.send({type:'wizard:app:refresh',version:1,reason:'focus'}); b.send({type:'wizard:app:refresh',version:1,reason:'<x>'});
 assert.deepEqual(got,['focus','poll']); assert.equal(b.events.length,0,'no synthetic event once the app handles it');
 for(const fn of b.docL.visibilitychange) fn({isTrusted:true}); assert.deepEqual(got,['focus','poll','visible'],'a real return also refreshes');
 off(); b.send({type:'wizard:app:refresh',version:1,reason:'poll'}); assert.equal(b.events.length,1);
 assert.throws(()=>b.W.view.onRefresh(null),{name:'TypeError'});
 b.send({type:'wizard:app:refresh',version:2,reason:'poll'}); assert.equal(b.events.length,1,'other protocol versions ignored');
});
