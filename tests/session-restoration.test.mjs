import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const root=process.env.HOME_SCREEN_SOURCE || new URL('../',import.meta.url).pathname;
const read=p=>fs.readFileSync(root+'/web/core/'+p,'utf8');
// Explicit VM fixtures: domain states mirror the current Wisdom/Signal sources.
// They test shell reconstruction policy, not execution of those real frontends.
function fixture(id,save,utilities={}){
 const data=new Map(),key='wos.single.v1:'+JSON.stringify(['https://box.test',id]);
 if(save)data.set(key,JSON.stringify(save));
 const storage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)};
 const listeners={},frames=[],apps={APP:{[id]:{id,name:id==='wisdom'?'Wisdom':'Wizard Signal',kind:'wizard',url:id==='wisdom'?'/wisdom/':'/wizard-signal/'}}};
 const device={classList:{add(){}},appendChild(){}};
 const win={dataset:{},style:{setProperty(){}},replaceChildren(){},append(){},appendChild(f){f.isConnected=true;frames.push(f)},innerHTML:''};
 const rootDoc={documentElement:{style:{setProperty(){}}},styleSheets:[],querySelector:()=>null};
 const document={documentElement:{setAttribute(){}},getElementById:n=>n==='device'?device:{classList:{add(){},remove(){}}},addEventListener(){},createElement(tag){
  if(tag==='article')return win;
  if(tag!=='iframe')return {className:'',append(){}};
  const events={},wEvents={},w={document:rootDoc,location:{href:''},history:{state:{__wizardApp:{index:0}},replaceState(state,_title,url){this.state=state;if(url)w.location.href=new URL(url,w.location.href).href},pushState(state,title,url){this.replaceState(state,title,url)}},WizardApp:{ready(){}},
   addEventListener(t,f){wEvents[t]=f},dispatchEvent(e){this.dispatched=(this.dispatched||0)+1;this.restored=e.state},PopStateEvent:class{constructor(type,options){this.type=type;Object.assign(this,options)}}};
  Object.defineProperty(w.location,'hash',{get(){return new URL(this.href).hash}});
  return {className:'',contentWindow:w,contentDocument:rootDoc,set src(url){w.location.href=new URL(url,'https://box.test').href},setAttribute(){},addEventListener(t,f){events[t]=f},remove(){this.isConnected=false},events,wEvents};
 }};
 const window={WizCore:{apps:()=>apps,appsLoaded:()=>Promise.resolve()},WizAppServices:{attach:()=>()=>{},guardBack(){},back:()=> 'root'},WizAppReadingPosition:{flush(){}},...utilities};
 const ctx=vm.createContext({window,document,localStorage:storage,location:{origin:'https://box.test',search:'?app-session='+id},URL,URLSearchParams,JSON,Date,Object,Math,setTimeout(){},setInterval(fn){listeners.interval=fn},addEventListener(t,fn){listeners[t]=fn}});
 vm.runInContext(read('home-screen-policy.js'),ctx);vm.runInContext(read('single-app-session.js'),ctx);
 return {data,key,apps,frames,listeners,window,async ready(){await Promise.resolve();await Promise.resolve();return frames.at(-1)}};
}
test('Signal hash route reconstructs saved domain/filter state with fresh SDK history mark',async()=>{
 const f=fixture('wizard-signal',{v:1,base:'/wizard-signal/',href:'https://box.test/wizard-signal/#sources',state:{signal:true,domain:true,route:'sources',tab:'latest',source:'all',depth:5,__wizardApp:{index:7}}});
 const frame=await f.ready();frame.events.load();
 assert.equal(frame.contentWindow.history.state.route,'sources');
 assert.equal(frame.contentWindow.history.state.domain,false);assert.equal(frame.contentWindow.history.state.depth,0);
 assert.equal(frame.contentWindow.history.state.__wizardApp.index,0);
 assert.equal(frame.contentWindow.restored.route,'sources');assert.equal(frame.contentWindow.dispatched,1);
 assert.equal(frame.title,'Signal');
 // A later iframe refresh must consume the latest checkpoint, not initial mount's stale save.
 frame.contentWindow.location.href='https://box.test/wizard-signal/#saved';
 frame.contentWindow.history.state={signal:true,route:'saved',tab:'for-you',source:'all'};
 frame.wEvents.pagehide();
 const saved=f.data.get(f.key);frame.contentWindow.history.state=null;f.listeners.interval();
 assert.equal(f.data.get(f.key),saved,'loading cannot overwrite checkpoint with transient boot state');
 frame.events.load();assert.equal(frame.contentWindow.restored.route,'saved');assert.equal(frame.contentWindow.dispatched,2);
 assert.equal(JSON.parse(f.data.get(f.key)).state.route,'saved');
});
test('Wisdom hash startup is not synthetically rerendered after scoped reader restoration',async()=>{
 const f=fixture('wisdom',{v:1,base:'/wisdom/',href:'https://box.test/wisdom/#/read/actual-chapter',state:{wisdom:true,domain:true,depth:2}});
 const frame=await f.ready();frame.events.load();
 assert.equal(frame.contentWindow.dispatched,undefined);
 assert.equal(frame.contentWindow.history.state.wisdom,true);
 assert.equal(JSON.parse(f.data.get(f.key)).href,'https://box.test/wisdom/#/read/actual-chapter');
});
test('removed registry entry can recover and stale frame loads cannot reset the new task',async()=>{
 const f=fixture('wisdom');const first=await f.ready();first.events.load();
 delete f.apps.APP.wisdom;f.listeners['wizard:apps']();
 assert.equal(first.isConnected,false);
 f.apps.APP.wisdom={id:'wisdom',name:'Wisdom',kind:'wizard',url:'/wisdom/'};
 f.listeners['wizard:apps']();const second=f.frames.at(-1);second.events.load();
 const saved=f.data.get(f.key);first.events.load();first.wEvents.pagehide();
 assert.equal(f.data.get(f.key),saved);second.contentWindow.location.href='https://box.test/wisdom/#/collection/real';
 f.listeners.interval();assert.equal(JSON.parse(f.data.get(f.key)).href,second.contentWindow.location.href);
});
test('single task retains shared media/link Back and selection Search without a desk escape',async()=>{
 let options,guarded=0,media=true,open=true;
 const links={back(){if(!open)return false;open=false;return true}};
 const f=fixture('wisdom',null,{WizLinks:{mount(o){options=o;return links},guardFrame(){guarded++}},WosChat:{viewer:{close(){if(!media)return false;media=false;return true}}}});
 const frame=await f.ready();frame.events.load();assert.equal(guarded,1);
 assert.equal(f.window.__wos.links,links);
 assert.equal(options.allowURL(new URL('https://box.test/wizard-search/?q=actual')),true);
 for(const url of ['https://box.test/wizard-os-home/?open=chats','https://box.test/wizard-os-home/desktop.html','https://box.test/wizard-os-home-preview/','https://box.test/wisdom/%2Fwizard-os-home/'])assert.equal(options.allowURL(new URL(url)),false,url);
 assert.equal(f.window.__wosNativeBack(),'media');assert.equal(open,true);
 assert.equal(f.window.__wosNativeBack(),'link');assert.equal(open,false);
 assert.equal(f.window.__wosNativeBack(),'root');
});
test('route checkpoint is synchronous before immediate Home/process death, not timer-dependent',async()=>{
 const f=fixture('wizard-signal');const frame=await f.ready();frame.events.load();
 frame.contentWindow.history.pushState({signal:true,domain:true,route:'sources',tab:'latest',source:'all'},'','#sources');
 const saved=JSON.parse(f.data.get(f.key));assert.equal(saved.href,'https://box.test/wizard-signal/#sources');assert.equal(saved.state.route,'sources');
 assert.equal([...f.data.keys()].some(k=>/^wos\.(wins4|strip|idx4|recent)$/.test(k)),false);
});
