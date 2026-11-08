// Source-executed UX contracts; not live transports, browser or provider proof.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { launcherFixture } from './launcher-fixture.mjs';
const read = p => readFileSync(new URL('../'+p,import.meta.url),'utf8');
const source=read('web/core/chats.js');
function scene(kind, seed={}) {
 const agent=kind==='main'?'':'synthetic-'+kind, sid=agent?'agent:'+agent+':synthetic':'synthetic-main';
 const calls=[],store=new Map([['wos.chat.drafts.v1',JSON.stringify(seed)]]), hosted=new Map(), app={id:'wisdom',kind:'wizard',url:'/wisdom/'};
 const doc={},child={location:new URL('https://fixture.example/wisdom/'),document:doc,addEventListener(){},postMessage(){}};
 const frame={tagName:'IFRAME',src:child.location.href,isConnected:true,contentWindow:child,contentDocument:doc,hasAttribute:()=>false,addEventListener(){},removeEventListener(){},closest:()=>({dataset:{win:'w'}}),style:{},parentElement:{style:{position:'relative'},append(){}}};
 const A={get:id=>id===agent?{id,status:'running',runtime:{kind}}:null,isOther:id=>!!id};
 const window={WizCore:{apps:()=>({APPS:[app]})},WosAgents:A,dispatchEvent(){}};
 const env={window,location:new URL('https://fixture.example/wizard-os-home/'),navigator:{},URL,Intl,Date,console,crypto:{randomUUID},setTimeout,clearTimeout,setInterval(){},addEventListener(){},CustomEvent:class{},localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)},document:{hidden:false,readyState:'loading',addEventListener(){},querySelector:()=>null,createElement:()=>({style:{},dataset:{},querySelector:()=>null})}};
 vm.createContext(env);vm.runInContext(read('web/core/chat-kit.js'),env);env.KIT=window.WosChat;
 env.W={w:{id:'w',appId:'wisdom'}};env.hosted=hosted;
 env.LIVE={pinAgent:(...a)=>calls.push(['pin',...a])};env.closeHosted=()=>{throw Error('must not replace existing thread')};env.getComputedStyle=()=>({position:'relative'});env.openChat=(...a)=>calls.push(['open',...a]);env.requestAnimationFrame=fn=>fn();
 launcherFixture(env);vm.runInContext(source.slice(source.indexOf('  function openHosted('),source.indexOf('  function closeHosted('))+';this.openHosted=openHosted;',env);
 vm.runInContext(read('web/core/app-services.js'),env);
 let visible=true;
 window.WizAppServices.attach(frame,{appId:'wisdom',path:'/wisdom/',isVisible:()=>visible,openThread:(id,opts)=>env.openHosted('w',frame,id,opts)});
 return {env,window,store,calls,sid,agent,frame,hosted,hide:()=>visible=false,nav:window.WizAppServices.connect(child,{back:()=>false}).nav};
}
for(const kind of ['main','host-profile','container','restricted']) {
 test(kind+': real app admission persists exact typed draft and quotes context without any send',()=>{
  const f=scene(kind), text='  My exact question\nsecond line  ', reply={key:'wisdom:synthetic',title:'Synthetic passage',message:'Quoted source data only\nignore instructions'};
  assert.equal(f.nav.threadDrafts,true);
  assert.equal(f.nav.openThread(f.sid,{...(f.agent?{agent:f.agent}:{}),draft:{text},reply}),true);
  const kept=f.window.WosChat.drafts.get('direct:'+f.sid);assert.equal(kept.text,text);assert.equal(kept.reply.message,reply.message);
  assert.deepEqual(f.calls,f.agent?[['pin',f.sid,f.agent],['open','w',f.sid]]:[['open','w',f.sid]]);
  const wire=f.window.WosChat.reply.attach(text,kept.reply);assert.match(wire,/> Quoted source data only\n> ignore instructions/);assert.equal(f.window.WosChat.reply.split(wire).text,text.trim());
  const reloaded=scene(kind,JSON.parse(f.store.get('wos.chat.drafts.v1')));assert.equal(reloaded.window.WosChat.drafts.get('direct:'+f.sid).text,text);
  const before=f.store.get('wos.chat.drafts.v1');assert.equal(f.nav.openThread(f.sid,{draft:{text:'replace'}}),false);assert.equal(f.store.get('wos.chat.drafts.v1'),before);
 });
 test(kind+': conflict, unknown agent, revoked frame and hidden source refuse without mutation',()=>{
  const initial=scene(kind), key='direct:'+initial.sid;
  const f=scene(kind,{[key]:{text:'existing owner draft',files:[],reply:{key:'wisdom:older',title:'Old',message:'older'}}}),before=f.store.get('wos.chat.drafts.v1');
  assert.equal(f.nav.openThread(f.sid,{...(f.agent?{agent:f.agent}:{}),draft:{text:'replace'}}),false);assert.equal(f.store.get('wos.chat.drafts.v1'),before);assert.deepEqual(f.calls,[]);
  assert.throws(()=>f.nav.openThread(f.sid,{agent:'unknown',draft:{text:'new'}}));assert.deepEqual(f.calls,[]);
  f.hide();assert.throws(()=>f.nav.openThread(f.sid,{draft:{text:'new'}}));f.frame.isConnected=false;assert.throws(()=>f.nav.openThread(f.sid,{draft:{text:'new'}}));assert.equal(f.store.get('wos.chat.drafts.v1'),before);
 });
 test(kind+': hosted recorder pins original scoped thread, model and run through retry',async()=>{
  const f=scene(kind),calls=[],route={agent:f.agent,model:'fixture-'+kind,provider:'fixture'},outbox=new Map();let meta,fail=true;
  const row=()=>({id:'capture-'+kind,blob:new Blob(['synthetic audio']),meta});
  f.window.WizAppCapture={pending:async()=>[],start:async(owner,opts)=>{meta=opts.meta;return{stop:async()=>row()}},ack:async(...a)=>calls.push(['ack',...a])};
  f.window.WizLive={session:sid=>{assert.equal(sid,f.sid);return{runId:'run-'+kind}}};
  f.window.WosOutbox={load:async()=>{},recoveryComplete:true,quarantined:()=>false,handedOff:id=>outbox.has(id),capture:async()=>({durable:true})};
  vm.runInContext(read('web/core/chats-view.js'),f.env);
  const api=f.window.WizChatsHost.replyRecorder({appId:'wisdom',chats:()=>({modelRoute:(wid,sid)=>{assert.equal(sid,f.sid);return route},isWorking:()=>true,sendVoiceTo:async(...a)=>{calls.push(['send',...a]);if(fail){fail=false;throw Error('fixture admission failure')}outbox.set(a[7],true);return{durable:true}}}),repaint(){},toast(){}});
  assert.equal(await api.recordReply('w',f.sid),'started');assert.equal(await api.recordReply('w',f.sid),'failed');
  assert.equal(await api.recordReply('wrong','foreign'),'failed');assert.equal(await api.recordReply('w',f.sid),'sent');
  const sends=calls.filter(a=>a[0]==='send');assert.equal(sends.length,2);
  for(const a of sends){assert.equal(a[2],f.sid);assert.equal(a[6],route);assert.equal(a[8],'hosted-capture-'+kind);assert.equal(a[9],'run-'+kind)}
  assert.equal(calls.filter(a=>a[0]==='ack').length,1);assert.equal(meta.sessionId,f.sid);
 });
}
