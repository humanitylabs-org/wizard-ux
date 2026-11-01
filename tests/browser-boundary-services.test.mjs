import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {webcrypto} from 'node:crypto';
import {MessageChannel} from 'node:worker_threads';
// Real ports exercise structured cloning and asynchronous delivery; only DOM
// and upstream resources are synthetic. Close every port after each test.
const ports = new Set();
test.afterEach(() => { for (const p of ports) p.close(); ports.clear(); });
function channelPair() {
  const c = new MessageChannel(); ports.add(c.port1); ports.add(c.port2); return c;
}
const until = async predicate => {
  const end = Date.now() + 5000;
  while (!predicate()) { assert.ok(Date.now() < end, 'message transport did not settle'); await new Promise(r => setTimeout(r, 1)); }
};
const quiet = () => new Promise(r => setTimeout(r, 20));
const read = name => fs.readFileSync(new URL('../web/core/' + name, import.meta.url), 'utf8');
function fixture() {
  const events = new Map(), replies = [], upstream = [], sheets = [], loads = new Map();
  const location = new URL('https://box.example.test/wizard-os-home/');
  const catalog = [{id:'fixture', kind:'wizard', url:'/fixture/'}];
  const frame = {tagName:'IFRAME', src: new URL('/fixture/', location).href, isConnected:true,
    matches:()=>true, sandbox:{contains:()=>false}, hasAttribute:()=>false, closest:()=>null,
    getClientRects:()=>[{}], addEventListener(n,fn){const prior=loads.get(n);loads.set(n,prior?()=>{prior();fn();}:fn);}, removeEventListener:n=>loads.delete(n),
    contentWindow:{postMessage:(data,target)=>replies.push({data,target})}};
  const document = {hidden:false, readyState:'loading', addEventListener(){},
    querySelector:()=>({content:'a1'.repeat(32),remove(){}})};
  const ctx = {location, document, URL, Request, Headers, Blob, File, crypto:webcrypto,
    setTimeout, clearTimeout, setInterval(){}, CustomEvent:class{}, navigator:{},
    addEventListener(n,fn){if(!events.has(n))events.set(n,[]);events.get(n).push(fn);}, dispatchEvent(){}, fetch:async()=>new Response('{}'),
    WizCore:{apps:()=>({APPS:catalog})},
    WizConfig:{ready:Promise.resolve(), endpoint:()=>'/transcribe', transcribe:async(file,opts)=>{upstream.push({file,opts});return {text:' fixture words '};}},
    WizShareWizard:{valid:()=>{}, wizard:async(data,authorize,options)=>{sheets.push({data,authorize,options});return 'denied';}}};
  ctx.window=ctx;ctx.parent=ctx;
  vm.runInNewContext(read('browser-boundary.js'),ctx);
  vm.runInNewContext(read('app-services.js'),ctx);
  const detach=ctx.WizAppServices.attach(frame,{appId:'fixture',path:'/fixture/'});
  const channel=()=>replies.findLast(x=>x.data.op==='hello')?.data.channel;
  const emit=async(data,source=frame.contentWindow,origin='null',ports=[])=>{for(const fn of events.get('message')||[])await fn({data,source,origin,ports});};
  const documents = new Map();
  const ready=async(target=frame)=>{
    const generation=channel(), pair=channelPair(), st={port:pair.port1,connected:false,channel:generation};
    documents.set(target,st);
    st.port.onmessage=({data})=>{
      replies.push({data,port:true});
      if(data.op==='challenge') st.port.postMessage({...data,op:'challenge.reply'});
      if(data.op==='connected') st.connected=true;
    };
    st.port.start();
    await emit({type:'wizard:boundary',version:1,op:'ready',portRole:'document',channel:generation},target.contentWindow,'null',[pair.port2]);
    await until(()=>st.connected);
    assert.equal(ctx.WizBrowserBoundary.admits(target,target.contentWindow,generation),true);
  };
  let serial=0;
  const request=async(method,args={},extra={},target=frame)=>{
    const id='wbs-'+ ++serial, st=documents.get(target);
    st.port.postMessage({type:'wizard:boundary',version:1,op:'service.request',channel:st.channel,id,method,args,...extra});
    const reply=()=>replies.findLast(x=>x.data.op==='service.reply'&&x.data.id===id)?.data;
    await until(()=>reply() || !ctx.WizBrowserBoundary.admits(target,target.contentWindow,st.channel));
    await quiet();
    return reply();
  };
  return {ctx,frame,loads,detach,ready,request,emit,channel,replies,upstream,sheets,catalog,documents};
}
const audio=()=>new Blob(['synthetic audio'],{type:'audio/ogg'});
test('opaque registered source can transcribe without any child DOM access',async()=>{
  const f=fixture(); Object.defineProperty(f.frame.contentWindow,'document',{get(){throw Error('opaque');}});
  Object.defineProperty(f.frame.contentWindow,'location',{get(){throw Error('opaque');}});
  await f.ready();const r=await f.request('voice.transcribe',{file:audio(),language:'en'});
  assert.equal(r.value.text,'fixture words');assert.equal(f.upstream.length,1);
  assert.equal(f.ctx.WizAppServices.connect(f.frame.contentWindow,{}),null);
});
test('forged windows, wrong origin/channel, unregistered apps and legacy transport cannot call upstream',async()=>{
  const f=fixture();await f.ready();
  const d={type:'wizard:boundary',version:1,op:'service.request',channel:f.channel(),id:'forged',method:'voice.transcribe',args:{file:audio()}};
  await f.emit(d,{});await f.emit(d,f.frame.contentWindow,'https://box.example.test');
  await f.emit({...d,channel:'old'});
  await f.emit({type:'wizard:app:request',version:1,id:'legacy',op:'voice.transcribe',args:d.args});
  await f.emit({...d,id:'wbs-97'});
  f.documents.get(f.frame).port.postMessage({...d,channel:'old',id:'wbs-98'});await quiet();
  f.catalog.length=0;
  f.documents.get(f.frame).port.postMessage({...d,id:'wbs-99'});await quiet();
  assert.equal(f.upstream.length,0);assert.equal(f.sheets.length,0);
});
test('ten calls per app share one budget across reload and reattach; eleventh never goes upstream',async()=>{
  const f=fixture();await f.ready();
  for(let n=0;n<10;n++)assert.equal((await f.request('voice.transcribe',{file:audio()})).value.text,'fixture words');
  f.loads.get('load')();await f.ready();
  assert.equal((await f.request('voice.transcribe',{file:audio()})).error.code,'rate_limited');
  f.detach();f.ctx.WizAppServices.attach(f.frame,{appId:'fixture',path:'/fixture/'});await f.ready();
  assert.equal((await f.request('voice.transcribe',{file:audio()})).error.code,'rate_limited');
  assert.equal(f.upstream.length,10);
});
test('oversized calls return too_large without spending budget or calling upstream',async()=>{
  const f=fixture();await f.ready();
  const r=await f.request('voice.transcribe',{file:new Blob([new Uint8Array(25*1024*1024+1)])});
  assert.equal(r.error.code,'too_large');assert.equal(f.upstream.length,0);
  assert.equal((await f.request('voice.transcribe',{file:audio()})).value.text,'fixture words');
});
test('share opens the shared shell sheet with mandatory trusted-click confirmation, no gesture means denied',async()=>{
  const f=fixture();await f.ready();const r=await f.request('share.wizard',{text:'synthetic share'});
  assert.equal(r.value,'denied');assert.equal(f.sheets.length,1);
  assert.equal(f.sheets[0].options.requireTrusted,true);assert.equal(f.sheets[0].authorize(),true);
  f.loads.get('load')();assert.equal(f.sheets[0].authorize(),false);
});
test('detached and stale frames cannot share or transcribe or receive asynchronous results',async()=>{
  const f=fixture();await f.ready();f.frame.isConnected=false;
  assert.equal(await f.request('share.wizard',{text:'no'}),undefined);
  assert.equal(await f.request('voice.transcribe',{file:audio()}),undefined);
  assert.equal(f.upstream.length,0);assert.equal(f.sheets.length,0);
  const g=fixture();await g.ready();let resolve;
  g.ctx.WizConfig.ready=new Promise(r=>resolve=r);
  const p=g.request('voice.transcribe',{file:audio()});await until(()=>g.ctx.WizAppServices.inspect()[0].holds.length===1);g.loads.get('load')();resolve();
  assert.equal(await p,undefined);assert.equal(g.upstream.length,0);
});
test('unsupported capabilities never expose generic fetch/native/install through the boundary',async()=>{
  const f=fixture();await f.ready();
  for(const op of ['fetch','native','install','share.text','capture.pending'])assert.equal((await f.request(op,{})).error.code,'not_allowed');
  assert.equal(f.upstream.length,0);
});
function client(f) {
  const events=new Map(), outgoing=[];
  const parent={postMessage(data,target,ports=[]){outgoing.push(data);queueMicrotask(()=>f.emit(data,f.frame.contentWindow,'null',ports));}};
  class ClientChannel {
    constructor() {
      const c=channelPair();this.port1=c.port1;this.port2=c.port2;
      const post=c.port1.postMessage.bind(c.port1);
      c.port1.postMessage=data=>{outgoing.push(data);post(data);};
    }
  }
  const document={createElement:()=>({}),head:{appendChild(){}},addEventListener(){}};
  const ctx={parent,document,location:new URL('https://box.example.test/fixture/'),origin:'null',
    history:{pushState(){},replaceState(){}},setTimeout,clearTimeout,URL,Blob,File,crypto:webcrypto,
    navigator:{},console,Event,MessageChannel:ClientChannel,addEventListener(n,fn){if(!events.has(n))events.set(n,[]);events.get(n).push(fn);},dispatchEvent(){},CustomEvent:class{}};
  ctx.window=ctx;
  const deliver=(data,source=parent,origin='https://box.example.test')=>{for(const fn of events.get('message')||[])fn({data,source,origin});};
  f.frame.contentWindow.postMessage=data=>{f.replies.push({data,target:'*'});queueMicrotask(()=>deliver(data));};
  vm.runInNewContext(read('browser-boundary-client.js'),ctx);
  vm.runInNewContext(read('app-client.js'),ctx);
  deliver({type:'wizard:boundary',version:1,op:'hello',channel:f.channel()});
  return {ctx,deliver,outgoing,ready:()=>until(()=>ctx.WizBoundaryClient.ready),pagehide:()=>events.get('pagehide').forEach(fn=>fn())};
}
test('actual WizardApp facade routes opaque share and transcribe through the channel and preserves structured errors',async()=>{
  const f=fixture(),c=client(f);await c.ready();
  assert.equal((await c.ctx.WizardApp.voice.transcribe(audio())).text,'fixture words');
  assert.equal(await c.ctx.WizardApp.share.wizard({text:'synthetic'}),'denied');
  await assert.rejects(c.ctx.WizardApp.voice.transcribe(new Blob([new Uint8Array(25*1024*1024+1)])),e=>e.code==='too_large');
  for(let n=1;n<10;n++)await c.ctx.WizardApp.voice.transcribe(audio());
  await assert.rejects(c.ctx.WizardApp.voice.transcribe(audio()),e=>e.code==='rate_limited');
  assert.equal(f.upstream.length,10);
  assert.ok(c.outgoing.some(d=>d.op==='service.request'&&d.method==='share.wizard'));
  assert.ok(c.outgoing.some(d=>d.op==='service.request'&&d.method==='voice.transcribe'));
});
test('opaque client rejects forged replies and revokes all pending calls on new hello/pagehide',async()=>{
  const f=fixture(),c=client(f);await c.ready();
  f.ctx.WizConfig.ready=new Promise(()=>{});
  const p=c.ctx.WizBoundaryClient.request('voice.transcribe',{file:audio()});
  const req=c.outgoing.at(-1),fake={type:'wizard:boundary',version:1,op:'service.reply',channel:f.channel(),id:req.id,value:{text:'forged'}};
  c.deliver(fake,{});c.deliver({...fake,channel:'old'});c.deliver(fake,undefined,'https://foreign.example');c.deliver(fake);
  let settled=false;p.then(()=>settled=true,()=>settled=true);await quiet();assert.equal(settled,false);
  const rejected=assert.rejects(p,e=>e.code==='denied');
  f.loads.get('load')();await rejected;await c.ready();
  const q=c.ctx.WizBoundaryClient.request('share.wizard',{text:'synthetic'}),gone=assert.rejects(q,e=>e.code==='denied');c.pagehide();await gone;
  assert.equal(c.ctx.WizBoundaryClient.ready,false);
  await assert.rejects(c.ctx.WizBoundaryClient.request('fetch',{}),e=>e.code==='unavailable');
});
test('budget expires after ten minutes and simultaneous frames use the same app id budget',async()=>{
  const f=fixture();let now=1000;f.ctx.Date={now:()=>now};await f.ready();
  // Requests reserve slots synchronously before waiting for the transcriber.
  let release;f.ctx.WizConfig.ready=new Promise(r=>release=r);
  const pending=Promise.all(Array.from({length:10},()=>f.request('voice.transcribe',{file:audio()})));
  const firstChannel=f.channel();
  const second={...f.frame,contentWindow:{postMessage:data=>f.replies.push({data,target:'*'})}};
  const off=f.ctx.WizAppServices.attach(second,{appId:'fixture',path:'/fixture/'});
  await f.ready(second);
  await until(()=>f.ctx.WizAppServices.inspect().find(s=>s.appId==='fixture').holds.length===10);
  assert.equal((await f.request('voice.transcribe',{file:audio(),appId:'spoofed'},{},second)).error.code,'rate_limited');assert.equal(f.upstream.length,0);
  release();await pending;await until(()=>f.upstream.length===10);off();
  now+=10*60*1000;
  assert.equal((await f.request('voice.transcribe',{file:audio()},{channel:firstChannel})).value.text,'fixture words');
  assert.equal(f.upstream.length,11);
});
test('phone and desktop boundary watchers register installed app services but never grant link frames those services',()=>{
  for(const [path,name] of [['../app.js','watchFrames'],['../desktop/desktop.js','watchFrame']]) {
    const src=read(path),start=src.indexOf('  function '+name+'('),end=src.indexOf('\n  function ',start+10);
    const calls=[],frame={closest:()=>({dataset:{win:'fixture-win'}})};
    const ctx={W:{'fixture-win':{appId:'fixture'}},APP:{fixture:{id:'fixture',url:'/fixture/'}},$$:()=>[frame],
      window:{WizBrowserBoundary:{enabled:true,attach:f=>{calls.push(['boundary',f]);return ()=>{};}},
        WizAppServices:{attach:(f,opts)=>{calls.push(['services',f,opts]);return ()=>{};}}}};
    vm.runInNewContext(src.slice(start,end)+';this.watch='+name+';',ctx);
    const invoke=()=>name==='watchFrames'?ctx.watch({}):ctx.watch(frame,{dataset:{win:'fixture-win'}});
    invoke();assert.equal(calls[0][0],'services');assert.equal(calls[0][2].appId,'fixture');
    assert.equal(calls[0][2].path,'/fixture/');
    frame._watched=false;ctx.W['fixture-win'].appId='link';invoke();assert.equal(calls[1][0],'boundary');
  }
});
test('services require a document port and the exact nonce response, not window ready or a guessed nonce',async()=>{
  const f=fixture(),c=f.channel(),pair=channelPair(),incoming=[];
  pair.port1.onmessage=({data})=>incoming.push(data);pair.port1.start();
  const ready={type:'wizard:boundary',version:1,op:'ready',channel:c,portRole:'document'};
  await f.emit(ready);assert.equal(f.ctx.WizBrowserBoundary.admits(f.frame,f.frame.contentWindow,c),false);
  await f.emit(ready,f.frame.contentWindow,'null',[pair.port2]);
  await until(()=>incoming.some(d=>d.op==='challenge'));
  const challenge=incoming.find(d=>d.op==='challenge');
  pair.port1.postMessage({...challenge,op:'challenge.reply',nonce:'guessed'});
  pair.port1.postMessage({type:'wizard:boundary',version:1,channel:c,op:'service.request',id:'wbs-1',method:'voice.transcribe',args:{file:audio()}});
  await quiet();assert.equal(f.upstream.length,0);assert.equal(incoming.some(d=>d.op==='connected'),false);
  pair.port1.postMessage({...challenge,op:'challenge.reply'});await until(()=>incoming.some(d=>d.op==='connected'));
  assert.equal(f.ctx.WizBrowserBoundary.admits(f.frame,f.frame.contentWindow,c),true);
  await quiet();assert.equal(f.upstream.length,0); // no pre-auth request may be queued for later admission
});
test('navigation after upstream starts suppresses its result to the replacement document',async()=>{
  const f=fixture();await f.ready();let finish;
  f.ctx.WizConfig.transcribe=()=>new Promise(r=>finish=r);
  const p=f.request('voice.transcribe',{file:audio()});await until(()=>typeof finish==='function');
  f.loads.get('load')();finish({text:'old document words'});
  assert.equal(await p,undefined);
});
