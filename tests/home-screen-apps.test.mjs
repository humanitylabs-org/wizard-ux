import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = process.env.HOME_SCREEN_SOURCE || new URL('../',import.meta.url).pathname;
const read = path => fs.readFileSync(root + '/web/' + path,'utf8');
function policy(search='') {
  const attributes = {}, window = {};
  const ctx = vm.createContext({ window, document:{documentElement:{setAttribute:(k,v)=>attributes[k]=v}}, location:{origin:'https://box.example',search}, URL, URLSearchParams, Object, Proxy, Reflect });
  vm.runInContext(read('core/home-screen-policy.js'),ctx);
  return {p:window.WizHomeScreenPolicy,ctx,attributes};
}
function storage() {
  const data = new Map();
  return {getItem:k=>data.get(String(k))??null,setItem:(k,v)=>data.set(String(k),String(v)),removeItem:k=>data.delete(String(k)),get length(){return data.size},key:n=>[...data.keys()][n]??null,data};
}
test('normal launcher does not opt into pinned session',()=>{ const {p,attributes}=policy(); assert.equal(p.mode,false); assert.deepEqual(attributes,{}); });
test('Signal shortcut/task name is independent of unchanged registry/workspace labels',()=>{
  const {p}=policy(),app={id:'wizard-signal',name:'Wizard Signal'};
  assert.equal(p.displayName(app),'Signal');assert.equal(app.name,'Wizard Signal');
});
test('index, desktop and preview shell routes cannot masquerade as frontend apps',()=>{
 const {p}=policy();for(const path of ['/wizard-os-home/','/wizard-os-home/index.html','/wizard-os-home/desktop.html','/wizard-os-home-preview/','/wizard-os-home'])assert.equal(p.isShell(path),true,path);
 assert.equal(p.isShell('/wizard-signal/'),false);assert.equal(p.isShell('/wizard-wisdom/'),false);
});
test('canonical stable IDs and malformed links fail closed',()=>{
  const {p,attributes}=policy('?app-session=wizard-signal'); assert.equal(p.id,'wizard-signal'); assert.equal(attributes['data-app-session'],'wizard-signal');
  for (const bad of ['','../wisdom','a/b','x.y','x?open=chats','a'.repeat(97)]) assert.equal(p.validId(bad),false);
  assert.equal(policy('?app-session=..%2Fchats').attributes['data-app-session'],'unavailable');
});
test('session checkpoint identity separates box, app and workspace',()=>{ const {p}=policy(); assert.notEqual(p.key('https://a','wisdom'),p.key('https://b','wisdom')); assert.notEqual(p.key('https://a','wisdom'),p.key('https://a','wizard-signal')); assert.notEqual(p.key('https://a','wisdom'),'wos.wins4'); });
test('saved route remains within current registered view',()=>{
  const {p}=policy(); for (const good of ['/wisdom/','#/read/chapter','/wisdom/?view=mine#/read/a']) assert.equal(p.within(good.startsWith('#')?'/wisdom/'+good:good,'/wisdom/'),true);
  for (const bad of ['/wizard-os-home/?open=chats','/wisdom-other/','https://evil.example/wisdom/','/wisdom/%2e%2e/wizard-os-home/','/wisdom/%252e%252e/','/']) assert.equal(p.within(bad,'/wisdom/'),false);
  assert.equal(p.within('/','/'),false); assert.equal(p.within('/wisdom/','https://evil.example/wisdom/'),false);
});
test('Wisdom page presentation is durable and isolated; preferences/content remain shared',()=>{
  const shared=storage(), {p}=policy('?app-session=wisdom');
  shared.setItem('wisdom:/wisdom/:pos:chapter','.7'); shared.setItem('wisdom:/wisdom/:size','2'); shared.setItem('content:read:chapter','1');
  const frame={localStorage:shared,location:{origin:'https://box.example'}}; p.installPresentationStorage(frame);
  assert.equal(frame.localStorage.getItem('wisdom:/wisdom/:pos:chapter'),null,'never copy normal desk position');
  frame.localStorage.setItem('wisdom:/wisdom/:pos:chapter','.2');
  assert.equal(shared.getItem('wisdom:/wisdom/:pos:chapter'),'.7'); assert.equal(frame.localStorage.getItem('wisdom:/wisdom/:pos:chapter'),'.2');
  assert.equal(frame.localStorage.getItem('wisdom:/wisdom/:size'),'2'); frame.localStorage.setItem('content:read:chapter','0'); assert.equal(shared.getItem('content:read:chapter'),'0');
  const recreated={localStorage:shared,location:{origin:'https://box.example'}}; policy('?app-session=wisdom').p.installPresentationStorage(recreated); assert.equal(recreated.localStorage.getItem('wisdom:/wisdom/:pos:chapter'),'.2');
});
test('single-app entry never initializes workspace or honors sticky desktop preference',()=>{
  const {p,ctx}=policy('?app-session=wisdom&shell=desktop'); ctx.localStorage=storage(); ctx.localStorage.setItem('wux.shell','desktop'); ctx.window.WizHomeScreenPolicy=p; ctx.document.documentElement.dataset={shell:'phone'};
  ctx.navigator={userAgent:'WizardOS-Android/preview'};ctx.matchMedia=()=>({matches:false});
  vm.runInContext(read('core/shell.js'),ctx); assert.equal(ctx.window.WIZ_SHELL,'phone');assert.equal(ctx.localStorage.getItem('wux.shell'),'desktop');
  vm.runInContext(read('app.js'),ctx); assert.equal(ctx.window.__wos,undefined); assert.equal(ctx.localStorage.getItem('wos.wins4'),null);
});
test('normal app-services storage stays sessionStorage unless caller selects durable storage',()=>{
  const source=read('core/app-reading-position.js'); assert.match(source,/storage = sessionStorage/); assert.doesNotMatch(source,/sessionStorage\.setItem/);
  assert.match(read('core/single-app-session.js'),/readingStorage:localStorage/);
});

test('unavailable session consumes repeated root Back; selection closes first',async()=>{
  const {p}=policy('?app-session=wisdom'); let mounted;
  const attrs={}; const element=()=>({classList:{add(){},remove(){}},dataset:{},style:{setProperty(){}},appendChild(e){mounted=e},replaceChildren(){},append(){},setAttribute(){},addEventListener(){}});
  const host=element(); const document={getElementById:()=>host,createElement:()=>element(),addEventListener(){},title:''};
  const window={WizHomeScreenPolicy:p,WizCore:{apps:()=>({APP:{}}),appsLoaded:()=>Promise.resolve()},WosSelMenu:{back:()=>false},WizAppServices:{guardBack(){}},WizardOSNative:{immersive(){}}};
  const ctx=vm.createContext({window,document,location:{origin:'https://box.example'},URL,localStorage:storage(),addEventListener(){},setInterval(){},setTimeout(){}});
  vm.runInContext(read('core/single-app-session.js'),ctx);
  assert.equal(window.__wosNativeBack(),'root');assert.equal(window.__wosNativeBack(),'root'); window.WosSelMenu.back=()=>true; assert.equal(window.__wosNativeBack(),'selection');
  await Promise.resolve(); assert.ok(mounted,'one app surface mounted');
});

function pinFixture(status='ready',withPort=true) {
  class Element {
    constructor(){this.events=new Map();this.children=[];this.classList={contains:()=>true};this.dataset={};this.isConnected=true;this.style={};}
    addEventListener(t,fn){const list=this.events.get(t)||[];list.push(fn);this.events.set(t,list);}
    emit(t,event={}){for(const fn of this.events.get(t)||[])fn(event);return event;}
    append(...els){this.children.push(...els);} appendChild(el){this.append(el);} remove(){this.isConnected=false;}
    setAttribute(){} querySelector(sel){if(sel==='.sgi')return null;return this.children.find(e=>e.tag===sel)||this.children.map(e=>e.querySelector(sel)).find(Boolean);}
  }
  const document=new Element(), body=new Element(), menu=new Element(), row=new Element(); row.dataset.app='wisdom'; row.closest=()=>row; document.body=body;
  document.createElement=tag=>{const e=new Element();e.tag=tag;if(tag==='canvas'){e.getContext=()=>({fillRect(){},fillText(){}});e.toDataURL=()=> 'data:image/png;base64,fixture';}return e;};
  const timers=new Map();let serial=0,now=0,actualStatus=status;const messages=[];
  const window={WizHomeScreenPolicy:policy().p,WizSigil:{box:()=>'',of:()=>({color:'#FEC25D',letter:'W'})}};
  if(withPort)window.wizardHomeScreenPort={postMessage(raw){const d=JSON.parse(raw);messages.push(d);this.onmessage({data:JSON.stringify({requestId:d.requestId,status:d.op==='pin'?'pending':actualStatus})});}};
  const ctx=vm.createContext({window,document,URL,location:{origin:'https://box.example'},performance:{now:()=>now},navigator:{userActivation:{isActive:true},vibrate(){}},setTimeout:(fn,ms)=>{const id=++serial;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),addEventListener:(t,fn)=>window[t]=fn});
  vm.runInContext(read('core/home-screen-apps.js'),ctx);
  window.WizHomeScreenApps.attach(menu,()=>({id:'wisdom',name:'Wisdom',kind:'wizard',url:'/wisdom/'}));
  const event=(extra={})=>({target:row,isTrusted:true,isPrimary:true,button:0,pointerId:1,clientX:50,clientY:50,detail:1,preventDefault(){this.prevented=true;},stopPropagation(){},stopImmediatePropagation(){this.stopped=true;},...extra});
  const tick=ms=>{now+=ms;for(const [id,t] of [...timers])if(t.ms===ms){timers.delete(id);t.fn();}};
  return {window,document,body,menu,event,tick,messages,ctx,setStatus:s=>actualStatus=s};
}
test('without native bridge long-press offers browser install without sending native requests',()=>{
  const f=pinFixture('ready',false);f.menu.emit('pointerdown',f.event());f.tick(450);
  assert.equal(f.window.WizHomeScreenApps.state.open,true);
  assert.equal(f.body.children[0].querySelector('button').textContent,'Add to home screen');
  assert.equal(f.body.children[0].querySelector('input').value,'https://box.example/wizard-os-home/install/wisdom/');
  assert.equal(f.messages.length,0);
  assert.equal(f.window.WizHomeScreenApps.back(),true);
  assert.equal(f.window.WizHomeScreenApps.state.open,false);
});
test('long-press cancels on move, scroll, pointercancel and second pointer; ordinary tap survives',()=>{
  for (const action of ['move','scroll','cancel','second']) {
    const f=pinFixture();f.menu.emit('pointerdown',f.event());
    if(action==='move')f.menu.emit('pointermove',f.event({clientX:70}));
    if(action==='scroll')f.menu.emit('scroll',f.event());
    if(action==='cancel')f.document.emit('pointercancel',f.event());
    if(action==='second')f.document.emit('pointerdown',f.event({pointerId:2}));
    f.tick(450);assert.equal(f.window.WizHomeScreenApps.state.open,false,action);
  }
  const f=pinFixture();f.menu.emit('pointerdown',f.event());f.document.emit('pointerup',f.event());f.tick(450);const click=f.menu.emit('click',f.event());assert.equal(click.stopped,undefined);
});
test('opening release cannot activate action; dispatch stays pending until confirmed readback',async()=>{
  const f=pinFixture();f.menu.emit('pointerdown',f.event());f.tick(450);await Promise.resolve();await Promise.resolve();await Promise.resolve();
  assert.equal(f.window.WizHomeScreenApps.state.open,true);
  const overlay=f.body.children[0], opening=overlay.emit('click',f.event());assert.equal(opening.stopped,true);assert.equal(f.messages.filter(d=>d.op==='pin').length,0);
  const button=overlay.querySelector('button');assert.equal(button.disabled,false);
  overlay.emit('pointerdown',f.event());const fresh=overlay.emit('click',f.event({target:button}));assert.equal(fresh.stopped,undefined);button.onclick(f.event());await Promise.resolve();
  assert.equal(f.window.WizHomeScreenApps.state.pending,true);assert.equal(button.textContent,'Adding…');assert.equal(f.messages.filter(d=>d.op==='pin').length,1);
  f.setStatus('pinned');await f.window['wos-native-resume']();assert.equal(button.textContent,'Added to home screen');f.tick(1200);assert.equal(f.window.WizHomeScreenApps.state.open,false);
});
test('already pinned/unsupported state disables action and canceled OS sheet has no success',async()=>{
  for(const status of ['pinned','unsupported']){const f=pinFixture(status);f.menu.emit('pointerdown',f.event());f.tick(450);await Promise.resolve();await Promise.resolve();await Promise.resolve();assert.equal(f.body.children[0].querySelector('button').disabled,true);assert.equal(f.messages.filter(d=>d.op==='pin').length,0);}
  const f=pinFixture();f.menu.emit('pointerdown',f.event());f.tick(450);await Promise.resolve();await Promise.resolve();await Promise.resolve();f.body.children[0].querySelector('button').onclick(f.event());await Promise.resolve();await f.window['wos-native-resume']();assert.equal(f.window.WizHomeScreenApps.state.open,false);
});

test('action requires active intentional gesture; canceled action press and port failure fail closed',async()=>{
  const f=pinFixture();f.menu.emit('pointerdown',f.event());f.tick(450);
  await Promise.resolve();await Promise.resolve();await Promise.resolve();
  const overlay=f.body.children[0],button=overlay.querySelector('button');
  f.ctx.navigator.userActivation.isActive=false;button.onclick(f.event());
  assert.equal(f.messages.filter(d=>d.op==='pin').length,0);
  f.ctx.navigator.userActivation.isActive=true;button.onclick(f.event({isTrusted:false}));
  assert.equal(f.messages.filter(d=>d.op==='pin').length,0);
  overlay.emit('pointerdown',f.event());overlay.emit('pointercancel',f.event());
  assert.equal(overlay.emit('click',f.event({target:button})).stopped,true);
  f.window.wizardHomeScreenPort.postMessage=()=>{throw new Error('closed port')};
  button.onclick(f.event());await Promise.resolve();await Promise.resolve();
  assert.equal(f.window.WizHomeScreenApps.state.pending,false);
  assert.equal(button.textContent,"Couldn't add. Try again");
});
test('native screen sampling ignores hidden workspace dock but preserves ordinary shell crop',()=>{
  for (const [rect,height] of [[{top:0,width:0,height:0},892],[{top:800,width:412,height:64},800]]) {
    const window={wizardScreenPort:{postMessage(id){window.id=id}}};
    const ctx=vm.createContext({window,navigator:{userActivation:{isActive:true}},crypto:{randomUUID:()=> 'fixture'},
      document:{getElementById:()=>({getBoundingClientRect:()=>rect})},innerWidth:412,innerHeight:892,
      setTimeout:()=>1,clearTimeout(){},Promise,Map});
    vm.runInContext(read('core/screen-capture.js'),ctx);
    window.WosScreenCapture.capture().catch(()=>{});
    assert.equal(window.__wosScreenSample(window.id).contentHeight,height);
    window.__wosScreenResult(window.id,'','test cleanup');
  }
});
test('mounted session Back consumes app overlay, safe in-app history and forever at root',async()=>{
  const {p}=policy('?app-session=wisdom');const store=storage();let frame,serviceStep='handled',traversals=0,flushes=0;
  const rootDoc={documentElement:{style:{setProperty(){}}},querySelector:()=>null,styleSheets:[]};
  function el(tag){return {tag,dataset:{},style:{setProperty(){}},classList:{add(){},remove(){}},children:[],events:{},setAttribute(){},appendChild(child){this.children.push(child);if(child.tag==='iframe')frame=child;},replaceChildren(){this.children=[];},addEventListener(type,fn){this.events[type]=fn;}};}
  const host=el('host'),document={getElementById:()=>host,addEventListener(){},createElement:el};
  const app={id:'wisdom',name:'Wisdom',kind:'wizard',url:'/wisdom/'};
  const w={location:{href:'https://box.example/wisdom/#/read/chapter'},history:{state:{wisdom:true},back(){traversals++;w.location.href='https://box.example/wisdom/';}},navigation:{currentEntry:{index:1},entries:()=>[{url:'https://box.example/wisdom/'}]},document:rootDoc,WizardApp:{ready(){}},addEventListener(){}};
  const window={WizHomeScreenPolicy:p,WizCore:{apps:()=>({APP:{wisdom:app}}),appsLoaded:()=>Promise.resolve()},WosSelMenu:{back:()=>false},WizAppReadingPosition:{flush(){flushes++;}},WizAppServices:{attach:()=>()=>{},guardBack(){},back:()=>serviceStep}};
  const ctx=vm.createContext({window,document,localStorage:store,location:{origin:'https://box.example'},URL,addEventListener(){},setInterval(){},setTimeout(){}});
  vm.runInContext(read('core/single-app-session.js'),ctx);await Promise.resolve();frame.contentWindow=w;frame.contentDocument=rootDoc;frame.events.load();
  assert.equal(window.__wosNativeBack(),'app');assert.equal(traversals,0);
  serviceStep='atRoot';assert.equal(window.__wosNativeBack(),'root');assert.equal(window.__wosNativeBack(),'root');assert.equal(traversals,0,'connected app root is authoritative even with older history');
  serviceStep='notReady';assert.equal(window.__wosNativeBack(),'history');assert.equal(traversals,1,'generic history is only a fallback without a connected client');
  w.navigation.currentEntry.index=0;assert.equal(window.__wosNativeBack(),'root');assert.equal(window.__wosNativeBack(),'root');assert.equal(traversals,1);
  assert.equal(store.getItem('wos.wins4'),null);assert.ok(store.getItem(p.key('https://box.example','wisdom')));assert.ok(flushes>0);
});

test('pinned app keeps Android status bar and navigation buttons; content starts below the status bar',async()=>{
  const {p}=policy('?app-session=wisdom'); const calls=[]; const winStyle={};
  const element=()=>({classList:{add(){},remove(){}},dataset:{},style:{setProperty(k,v){winStyle[k]=v}},appendChild(){},replaceChildren(){},append(){},setAttribute(){},addEventListener(){}});
  const host=element(); const document={getElementById:()=>host,createElement:()=>element(),addEventListener(){},title:''};
  const window={WizHomeScreenPolicy:p,WizCore:{apps:()=>({APP:{}}),appsLoaded:()=>Promise.resolve()},WosSelMenu:{back:()=>false},WizAppServices:{guardBack(){}},
    WizardOSNative:{immersive(on){calls.push(on)},cutoutTop:()=>24,insetTop:()=>36}};
  const ctx=vm.createContext({window,document,location:{origin:'https://box.example'},URL,localStorage:storage(),addEventListener(){},setInterval(){},setTimeout(){}});
  vm.runInContext(read('core/single-app-session.js'),ctx);
  assert.deepEqual(calls,[false],'never asks Android to hide its bars');
  assert.equal(typeof window.__wosTop,'function'); window.__wosTop(40);
  const java=fs.readFileSync(root+'android/app/src/main/java/ai/wizards/os/AppSessionActivity.java','utf8');
  assert.doesNotMatch(java,/applyImmersive\(true\)/); assert.match(java,/super\.applyImmersive\(false\)/);
});

// Every surface that lists apps to open offers the same long-press. Miguel's skins replaced swipe-up Apps with
// Desks → New desk on 22 Oct 2026 and the long-press silently vanished for their users; this pins both pickers.
test('Apps sheet and New desk grid both carry the Add to home screen long-press', () => {
  const app = read('app.js');
  assert.match(app, /WizHomeScreenApps\?\.attach\(launcher,/);
  assert.match(app, /WizHomeScreenApps\?\.attach\(track,[^\n]*rows: '\.new-desk \[data-app\]'/);
  assert.match(read('core/home-screen-apps.js'), /function attach\(menu, appFor, opts = \{\}\)/);
});

// Desks overview: hold a one-app desk and let go in place → the same sheet; a drag still reorders (James, 24 Oct).
test('Desks overview hold-and-release offers Add to home screen; drag keeps reordering', () => {
  const app = read('app.js');
  assert.match(app, /OV\.drag && !OV\.reordered[\s\S]{0,900}WizHomeScreenApps\?\.offer\(a\)/);
  assert.match(app, /insertBefore\(OV\.card, before\); OV\.reordered = true;/);
  assert.match(read('core/home-screen-apps.js'), /Object\.freeze\(\{ attach, offer,/);
});

// A home-screen app window is not "Wizard OS in front": the floating orb stays over it (James, 24 Oct).
test('Pinned home-screen apps keep the floating orb', async () => {
  const { readFileSync } = await import('node:fs');
  const j = f => readFileSync(new URL('../android/app/src/main/java/ai/wizards/os/' + f, import.meta.url), 'utf8');
  assert.match(j('device/AppState.java'), /static synchronized boolean shellFront\(\)[\s\S]{0,160}instanceof ai\.wizards\.os\.AppSessionActivity/);
  assert.equal((j('MainActivity.java').match(/setAppInFront\(this, ai\.wizards\.os\.device\.AppState\.shellFront\(\)\)/g) || []).length, 2);
});
