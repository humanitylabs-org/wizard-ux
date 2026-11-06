import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../web/core/chats-view.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('/* Owner-installed Ready extensions are')).replace('import(entry.module.href)','loadModule(entry.module.href)');
const declared=(patch={})=>({id:'sample-app',source:'apps.json',provides:['ready-extension'],url:'/sample/',...patch});
const digest='a'.repeat(64),descriptor=(patch={})=>({contract:'wizard.ready-extension/1',module_sha256:digest,style_sha256:digest,...patch});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
function fixture() {
 const modules=[],links=[],opened=[],toasts=[],html=[],instances=[],frames=[];let data=descriptor(),pending=false,metadata=null,importGate=null,listener;const replies=[];class NativeMessage {constructor(v){Object.assign(this,v);}};
 const root={querySelectorAll:s=>s==='iframe'?frames:[{parentNode:{querySelectorAll:()=>[]},insertAdjacentHTML:(_,s)=>html.push(s)}]};
 const wins={frame:{app:'frame',appId:'sample-app'}};
 const c={URL,AbortSignal,MessageEvent:NativeMessage,addEventListener:(t,fn)=>{if(t==='message')listener=fn;},location:{origin:'https://wizard.test',href:'https://wizard.test/shell/'},document:{createElement:()=>({remove(){this.removed=true;}}),head:{appendChild:l=>links.push(l)}},
  fetch:async()=>metadata?metadata.promise:{ok:true,json:async()=>data},
  loadModule:async u=>{modules.push(u);if(importGate)await importGate.promise;return{contract:'wizard.ready-extension/1',default:api=>{const i={api,disposed:false,html:()=>'<button>Task</button>',poll(){},write:(_s,k,input)=>({k,input}),handle:()=>true,busy:()=>pending,dispose(){i.disposed=true;}};instances.push(i);return i;}};}};
 c.window=c;vm.runInNewContext(code,c);c.WizAppExtensions.attach({root:()=>root,win:id=>wins[id],openApp:(...x)=>opened.push(x),toast:(...x)=>toasts.push(x)});
 const doc={},win={document:doc,location:{href:'https://wizard.test/sample/'},postMessage:m=>replies.push(m)};
 const frame={contentWindow:win,contentDocument:doc,src:'https://wizard.test/sample/',isConnected:true,hasAttribute:()=>false,closest:()=>({dataset:{win:'frame'}})};frames.push(frame);
 return{api:c.WizAppExtensions,replies,message:(extra={})=>listener(new NativeMessage({isTrusted:true,origin:'https://wizard.test',source:win,data:{type:'wizard:app:request',version:1,op:'ready.write',id:'request-1',args:{kind:'step',input:{id:1}}},...extra})),modules,links,instances,opened,html,frames,win,frame,wins,setData:d=>data=d,setPending:p=>pending=p,setMeta:g=>metadata=g,setImport:g=>importGate=g};
}
test('only an explicit installed same-origin app declaration admits Ready code',async()=>{
 const f=fixture();for(const a of [declared({source:'launcher.json'}),declared({provides:[]}),declared({provides:'ready-extension'}),declared({url:'https://elsewhere.test/sample/'}),declared({url:'/'}),declared({url:'/sample/%2e%2e/'}),declared({url:'/sample/?unsafe=1'})])assert.equal(f.api.moduleURL(a),null);
 await f.api.configure({apps:[declared()]});assert.equal(f.modules.length,1);assert.match(f.modules[0],/shell.js\?sha256=a{64}$/);assert.match(f.links[0].href,/shell.css\?sha256=a{64}$/);assert.match(f.api.html(),/data-app-ready="sample-app"/);
 await f.api.configure({apps:[declared(),declared()]});assert.equal(f.modules.length,1,'stable metadata does not remount app state');
});
test('exact live shell-owned frame/document/path grants writes; nested, navigated and destroyed callers do not',async()=>{
 const f=fixture();await f.api.configure({apps:[declared()]});assert.equal(f.api.call,undefined,'no caller-supplied source dispatch exists');await f.message();assert.equal(f.replies[0].type,'wizard:app:admitted');assert.equal(f.replies[1].value.k,'step');assert.equal(f.instances[0].api.authorize({}),false);
 f.win.location.href='https://wizard.test/other/';assert.equal(f.instances[0].api.authorize(f.win),false);f.win.location.href='https://wizard.test/sample/';
 f.win.document={};assert.equal(f.instances[0].api.authorize(f.win),false);f.win.document=f.frame.contentDocument;
 f.frame.isConnected=false;assert.equal(f.instances[0].api.authorize(f.win),false);f.frame.isConnected=true;
 f.wins.frame.appId='different-app';assert.equal(f.instances[0].api.authorize(f.win),false);
});
test('updates are content addressed and wait for app-owned pending custody; uninstall revokes immediately',async()=>{
 const f=fixture();await f.api.configure({apps:[declared()]});const old=f.instances[0];f.setData(descriptor({module_sha256:'b'.repeat(64)}));f.setPending(true);
 await f.api.configure({apps:[declared()]});assert.equal(f.modules.length,1);f.setPending(false);await f.api.configure({apps:[declared()]});assert.equal(f.modules.length,2);assert.ok(old.disposed);assert.ok(f.links[0].removed);assert.equal(old.api.installed(),false);
 old.api.open('target');assert.equal(f.opened.length,0,'revoked instances cannot navigate');
 await f.api.configure({apps:[]});assert.equal(f.api.html(),'');assert.equal(f.instances[0].api.authorize(f.win),false);
});
test('removed/overlapping metadata and imports cannot resurrect a revoked extension',async()=>{
 const f=fixture(),g=deferred();f.setMeta(g);const pending=f.api.configure({apps:[declared()]});await f.api.configure({apps:[]});g.resolve({ok:true,json:async()=>descriptor()});await pending;assert.equal(f.modules.length,0);
 f.setMeta(null);const importing=deferred();f.setImport(importing);const load=f.api.configure({apps:[declared()]});await Promise.resolve();await Promise.resolve();await Promise.resolve();await f.api.configure({apps:[]});importing.resolve();await load;assert.equal(f.instances.length,0);assert.equal(f.api.html(),'');
});
test('malformed metadata fails closed without admitting arbitrary paths or code',async()=>{
 const f=fixture();f.setData(descriptor({module_sha256:'../evil'}));await f.api.configure({apps:[declared()]});assert.equal(f.modules.length,0);
 f.setData(descriptor({contract:'not-supported'}));await f.api.configure({apps:[declared()]});assert.equal(f.modules.length,0);
});

test('write admission uses browser message source, ignores body source spoofing and rejects script-constructed messages',async()=>{
 const f=fixture();await f.api.configure({apps:[declared()]});
 await f.message({isTrusted:false});assert.equal(f.replies.length,0);
 await f.message({source:{},data:{type:'wizard:app:request',version:1,op:'ready.write',id:'spoof',source:f.win,args:{source:f.win,kind:'step'}}});assert.equal(f.replies.length,0);
 await f.message({origin:'https://elsewhere.test'});assert.equal(f.replies.length,0);
 const gate=deferred();f.instances[0].write=()=>gate.promise;const task=f.message();
 assert.equal(f.replies.length,1,'admission ack precedes backend settlement');assert.equal(f.replies[0].type,'wizard:app:admitted');
 f.frame.isConnected=false;gate.resolve({done:true});await task;assert.equal(f.replies.length,1,'destroyed caller gets no stale reply; app-owned work still settled');
});
test('Ready extensions remain root-only for default, host, container and restricted-agent contexts',()=>{
 const src=readFileSync(new URL('../web/core/chats.js',import.meta.url),'utf8');
 const a=src.indexOf("${k === 'ready'"),b=src.indexOf('}${list.length',a);assert.ok(a>0&&b>a);
 const expression=src.slice(a+2,b);const render=new Function('AGID','window',"const k='ready',n=0,filtered=false;return ("+expression+");");
 for(const agent of ['', 'host-agent','container-agent','restricted-agent'])assert.equal(render(agent,{WizAppExtensions:{html:()=>'<app-owned/>'}}).includes('<app-owned/>'),!agent);
 const poll=src.match(/if \(!AGID\) window\.WizAppExtensions\?\.poll\(\);/);assert.ok(poll);
 for(const agent of ['', 'host-agent','container-agent','restricted-agent']){let calls=0;new Function('AGID','window',poll[0])(agent,{WizAppExtensions:{poll:()=>calls++}});assert.equal(calls,agent?0:1);}
});

test('throwing app disposal cannot retain later revoked grants or styles', async () => {
  const f = fixture();
  await f.api.configure({ apps: [declared(), declared({ id: 'other', url: '/other/' })] });
  let disposed = false;
  f.instances[0].dispose = () => { throw Error('broken disposal'); };
  f.instances[1].dispose = () => { disposed = true; };
  await f.api.configure({ apps: [] });
  assert.equal(disposed, true);
  assert.equal(f.api.html(), '');
  assert.equal(f.links.filter(x => !x.removed).length, 0);
  assert.equal(await f.api.handle('sample:done'), false);
  assert.equal(await f.api.handle('other:done'), false);
});
test('sync and rejected async polling failures do not block other apps or Chats rendering', async () => {
  const f = fixture();
  await f.api.configure({ apps: [declared(), declared({ id: 'other', url: '/other/' }), declared({ id: 'third', url: '/third/' })] });
  let polled = 0;
  f.instances[0].poll = () => { throw Error('broken poll'); };
  f.instances[1].poll = () => Promise.reject(Error('unavailable'));
  f.instances[2].poll = () => { polled++; };
  assert.doesNotThrow(() => f.api.poll());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(polled, 1);
  assert.match(f.api.html(), /Task/);
});
