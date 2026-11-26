import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { java, method } from './fixtures/s1-java-slice.mjs';
import { launcherFixture } from './launcher-fixture.mjs';
import { withShellParts } from './fixtures/shell-parts.mjs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { cascade } from './fixtures/mini-css.mjs';
import { runRecording } from './fixtures/source-slice.mjs';
import { overview } from './fixtures/r5A-overview.mjs';

const root = process.env.HOME_SCREEN_SOURCE || new URL('../',import.meta.url).pathname;
const read = path => withShellParts(fs.readFileSync(root + '/web/' + path,'utf8'));
function policy(search='') {
  const attributes = {}, window = {};
  const ctx = vm.createContext({ window, document:{documentElement:{setAttribute:(k,v)=>attributes[k]=v}}, location:{origin:'https://box.example',search}, URL, URLSearchParams, Object, Proxy, Reflect });
  launcherFixture(ctx); vm.runInContext(read('core/home-screen-policy.js'),ctx);
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
  const shared=storage(), {p,ctx}=policy('?app-session=wisdom');
  // The app declares which keys hold screen position; the shell names no app (home_screen.position_keys).
  vm.runInContext(read('core/home-screen-capabilities.js'),ctx); ctx.window.WizHomeScreenCapabilities=ctx.WizHomeScreenCapabilities; p.configure({position_keys:['wisdom:*:pos:*']});
  shared.setItem('wisdom:/wisdom/:pos:chapter','.7'); shared.setItem('wisdom:/wisdom/:size','2'); shared.setItem('content:read:chapter','1');
  const frame={localStorage:shared,location:{origin:'https://box.example'}}; p.installPresentationStorage(frame);
  assert.equal(frame.localStorage.getItem('wisdom:/wisdom/:pos:chapter'),null,'never copy normal desk position');
  frame.localStorage.setItem('wisdom:/wisdom/:pos:chapter','.2');
  assert.equal(shared.getItem('wisdom:/wisdom/:pos:chapter'),'.7'); assert.equal(frame.localStorage.getItem('wisdom:/wisdom/:pos:chapter'),'.2');
  assert.equal(frame.localStorage.getItem('wisdom:/wisdom/:size'),'2'); frame.localStorage.setItem('content:read:chapter','0'); assert.equal(shared.getItem('content:read:chapter'),'0');
  const recreated={localStorage:shared,location:{origin:'https://box.example'}}; (()=>{const r=policy('?app-session=wisdom');vm.runInContext(read('core/home-screen-capabilities.js'),r.ctx);r.ctx.window.WizHomeScreenCapabilities=r.ctx.WizHomeScreenCapabilities;r.p.configure({position_keys:['wisdom:*:pos:*']});r.p.installPresentationStorage(recreated);})(); assert.equal(recreated.localStorage.getItem('wisdom:/wisdom/:pos:chapter'),'.2');
});
test('single-app entry never initializes workspace or honors sticky desktop preference',()=>{
  const {p,ctx}=policy('?app-session=wisdom&shell=desktop'); ctx.localStorage=storage(); ctx.localStorage.setItem('wux.shell','desktop'); ctx.window.WizHomeScreenPolicy=p; ctx.document.documentElement.dataset={shell:'phone'};
  ctx.navigator={userAgent:'WizardOS-Android/preview'};ctx.matchMedia=()=>({matches:false});
  vm.runInContext(read('core/shell.js'),ctx); assert.equal(ctx.window.WIZ_SHELL,'phone');assert.equal(ctx.localStorage.getItem('wux.shell'),'desktop');
  vm.runInContext(read('app.js'),ctx); assert.equal(ctx.window.__wos,undefined); assert.equal(ctx.localStorage.getItem('wos.wins4'),null);
});
test('normal app-services storage stays sessionStorage unless caller selects durable storage', async () => {
  // the real reading-position module: an app frame's place is read from (and kept in) sessionStorage by default
  const readFrom = opts => {
    const reads = [], mk = name => ({ getItem: k => (reads.push(name), null), setItem: () => reads.push(name + ':write'), removeItem() {} });
    const sessionStorage = mk('session'), localStorage = mk('local');
    const body = {}, doc = { body, documentElement: {}, scrollingElement: null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} };
    const frame = { closest: () => null, isConnected: true, contentWindow: { document: doc, location: { pathname: '/notes/', search: '', hash: '' }, addEventListener() {}, removeEventListener() {} }, addEventListener() {}, removeEventListener() {} };
    const ctx = runRecording(read('core/app-reading-position.js'), { sessionStorage, localStorage, window: {}, document: { addEventListener() {}, hidden: false }, addEventListener() {}, JSON, Object, Number, Array, Set, Math, Date });
    ctx.window.WizAppReadingPosition.attach(frame, { appId: 'notes', authorize: () => true, ...opts(localStorage) });
    return reads;
  };
  assert.ok(readFrom(() => ({})).includes('session') && !readFrom(() => ({})).includes('local'), 'sessionStorage unless asked');
  assert.ok(readFrom(local => ({ storage: local })).includes('local'), 'durable when the caller asks');
  // app-services hands its readingStorage through only when given; the pinned single-app session gives localStorage
  const services = read('core/app-services.js');
  const handed = given => {
    const got = [], line = services.slice(services.indexOf('const detachReading = window.WizAppReadingPosition?.attach('), services.indexOf('\n', services.indexOf('const detachReading = window.WizAppReadingPosition?.attach(')));
    vm.runInNewContext(line, { window: { WizAppReadingPosition: { attach: (f, o) => (got.push(o), () => {}) } }, frame: {}, appId: 'notes', valid: () => true, st: {}, readingStorage: given });
    return got[0];
  };
  assert.equal('storage' in handed(undefined), false); assert.equal(handed('LS').storage, 'LS');
  // the pinned single-app session (core/single-app-session.js run, its app mounted) asks for durable storage
  const pinned = await pinnedAttach();
  assert.equal(pinned.opts.readingStorage, pinned.store, 'the session\'s localStorage');
});

// core/single-app-session.js mounting Wisdom: the options it hands WizAppServices.attach, and its localStorage.
async function pinnedAttach() {
  const { p } = policy('?app-session=wisdom'), store = storage(), got = [];
  function el(tag) { return { tag, dataset: {}, style: { setProperty() {} }, classList: { add() {}, remove() {} }, children: [], setAttribute() {}, appendChild(c) { this.children.push(c); }, replaceChildren() { this.children = []; }, addEventListener() {} }; }
  const host = el('host'), document = { documentElement: el('html'), getElementById: () => host, addEventListener() {}, createElement: el };
  const window = { WizHomeScreenPolicy: p, WizCore: { apps: () => ({ APP: { wisdom: { id: 'wisdom', name: 'Wisdom', kind: 'wizard', url: '/wisdom/' } } }), appsLoaded: () => Promise.resolve() },
    WosSelMenu: { back: () => false }, WizAppServices: { attach: (f, o) => { got.push(o); return () => {}; }, guardBack() {} } };
  vm.runInContext(read('core/single-app-session.js'), vm.createContext({ window, document, localStorage: store, location: { origin: 'https://box.example' }, URL, addEventListener() {}, setInterval() {}, setTimeout() {} }));
  await new Promise(setImmediate);
  return { opts: got[0], store };
}

test('unavailable session consumes repeated root Back; selection closes first',async()=>{
  const {p}=policy('?app-session=wisdom'); let mounted;
  const attrs={}; const element=()=>({classList:{add(){},remove(){}},dataset:{},style:{setProperty(){}},appendChild(e){mounted=e},replaceChildren(){},append(){},setAttribute(){},addEventListener(){}});
  const host=element(); const document={documentElement:element(),getElementById:()=>host,createElement:()=>element(),addEventListener(){},title:''};
  const window={WizHomeScreenPolicy:p,WizCore:{apps:()=>({APP:{}}),appsLoaded:()=>Promise.resolve()},WosSelMenu:{back:()=>false},WizAppServices:{guardBack(){}},WizardOSNative:{immersive(){}}};
  const ctx=vm.createContext({window,document,location:{origin:'https://box.example'},URL,localStorage:storage(),addEventListener(){},setInterval(){},setTimeout(){}});
  vm.runInContext(read('core/single-app-session.js'),ctx);
  assert.equal(window.__wosNativeBack(),'root');assert.equal(window.__wosNativeBack(),'root'); window.WosSelMenu.back=()=>true; assert.equal(window.__wosNativeBack(),'selection');
  await Promise.resolve(); assert.ok(mounted,'one app surface mounted');
});

function pinFixture(status='ready',withPort=true,opts={}) {
  class Element {
    constructor(){this.events=new Map();this.children=[];this.classList={contains:()=>true,add(){}};this.dataset={};this.isConnected=true;this.style={};}
    addEventListener(t,fn){const list=this.events.get(t)||[];list.push(fn);this.events.set(t,list);}
    emit(t,event={}){for(const fn of this.events.get(t)||[])fn(event);return event;}
    append(...els){this.children.push(...els);} appendChild(el){this.append(el);} remove(){this.isConnected=false;}
    setAttribute(){} querySelector(sel){if(sel==='.sgi')return null;return this.children.find(e=>e.isConnected && e.tag===sel)||this.children.map(e=>e.querySelector(sel)).find(Boolean);}
  }
  const document=new Element(), body=new Element(), menu=new Element(), row=new Element(); row.dataset.app='wisdom'; row.closest=()=>row; document.body=body;
  document.createElement=tag=>{const e=new Element();e.tag=tag;if(tag==='canvas'){e.getContext=()=>({fillRect(){},fillText(){}});e.toDataURL=()=> 'data:image/png;base64,fixture';}return e;};
  const timers=new Map();let serial=0,now=0,actualStatus=status;const messages=[];
  const window={WizHomeScreenPolicy:policy().p,WizSigil:{box:()=>'',of:()=>({color:'#FEC25D',letter:'W'})}};
  if(withPort)window.wizardHomeScreenPort={postMessage(raw){const d=JSON.parse(raw);messages.push(d);this.onmessage({data:JSON.stringify({requestId:d.requestId,status:d.op==='pin'?'pending':actualStatus})});}};
  const ctx=vm.createContext({window,document,URL,location:{origin:'https://box.example'},performance:{now:()=>now},navigator:{userActivation:{isActive:true},vibrate(){}},setTimeout:(fn,ms)=>{const id=++serial;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),addEventListener:(t,fn)=>window[t]=fn});
  vm.runInContext(read('core/home-screen-apps.js'),ctx);
  window.WizHomeScreenApps.attach(menu,()=>({id:'wisdom',name:'Wisdom',kind:'wizard',url:'/wisdom/'}),opts);
  const event=(extra={})=>({target:row,isTrusted:true,isPrimary:true,button:0,pointerId:1,clientX:50,clientY:50,detail:1,preventDefault(){this.prevented=true;},stopPropagation(){},stopImmediatePropagation(){this.stopped=true;},...extra});
  const tick=ms=>{now+=ms;for(const [id,t] of [...timers])if(t.ms===ms){timers.delete(id);t.fn();}};
  return {window,document,body,menu,event,tick,messages,ctx,setStatus:s=>actualStatus=s};
}
test('tweak availability is live and rechecked when a pending hold fires',()=>{
  let enabled=false; const f=pinFixture('ready',false,{available:()=>enabled});
  f.menu.emit('pointerdown',f.event());f.tick(450);assert.equal(f.window.WizHomeScreenApps.state.open,false);
  enabled=true;f.menu.emit('pointerdown',f.event());enabled=false;f.tick(450);assert.equal(f.window.WizHomeScreenApps.state.open,false);
  enabled=true;f.menu.emit('pointerdown',f.event());f.tick(450);assert.equal(f.window.WizHomeScreenApps.state.open,true);
});
test('without native bridge long-press offers browser install without sending native requests',()=>{
  const f=pinFixture('ready',false);f.menu.emit('pointerdown',f.event());f.tick(450);
  assert.equal(f.window.WizHomeScreenApps.state.open,true);
  assert.equal(f.body.children[0].querySelector('button').textContent,'Copy link');
  assert.equal(f.body.children[0].querySelector('textarea').value,'https://box.example/wisdom/');
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

test('selection control bypasses canceled-pointer action guard, but actions still fail closed',async()=>{
  const f=pinFixture(); f.menu.emit('pointerdown',f.event()); f.tick(450);
  const overlay=f.body.children[0];
  overlay.emit('pointercancel',f.event());
  const selected=overlay.emit('click',f.event({target:{dataset:{installLink:''}}}));
  assert.equal(selected.stopped,undefined);
  const action=overlay.emit('click',f.event({target:{dataset:{}}}));
  assert.equal(action.stopped,true);
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
  const host=el('host'),document={documentElement:el('html'),getElementById:()=>host,addEventListener(){},createElement:el};
  const app={id:'wisdom',name:'Wisdom',kind:'wizard',url:'/wisdom/'};
  const w={location:{href:'https://box.example/wisdom/#/read/chapter'},history:{state:{wisdom:true},back(){traversals++;w.location.href='https://box.example/wisdom/';}},navigation:{currentEntry:{index:1},entries:()=>[{url:'https://box.example/wisdom/'}]},document:rootDoc,WizardApp:{ready(){}},addEventListener(){}};
  const window={WizHomeScreenPolicy:p,WizCore:{apps:()=>({APP:{wisdom:app}}),appsLoaded:()=>Promise.resolve()},WosSelMenu:{back:()=>false},WizAppReadingPosition:{flush(){flushes++;}},WizAppServices:{attach:()=>()=>{},guardBack(){},back:()=>serviceStep}};
  const ctx=vm.createContext({window,document,localStorage:store,location:{origin:'https://box.example'},URL,addEventListener(){},setInterval(){},setTimeout(){}});
  vm.runInContext(read('core/single-app-session.js'),ctx);await new Promise(setImmediate);frame.contentWindow=w;frame.contentDocument=rootDoc;frame.events.load();
  assert.equal(window.__wosNativeBack(),'app');assert.equal(traversals,0);
  serviceStep='atRoot';assert.equal(window.__wosNativeBack(),'root');assert.equal(window.__wosNativeBack(),'root');assert.equal(traversals,0,'connected app root is authoritative even with older history');
  serviceStep='notReady';assert.equal(window.__wosNativeBack(),'history');assert.equal(traversals,1,'generic history is only a fallback without a connected client');
  w.navigation.currentEntry.index=0;assert.equal(window.__wosNativeBack(),'root');assert.equal(window.__wosNativeBack(),'root');assert.equal(traversals,1);
  assert.equal(store.getItem('wos.wins4'),null);assert.ok(store.getItem(p.key('https://box.example','wisdom')));assert.ok(flushes>0);
});

test('pinned app keeps Android status bar and navigation buttons; content starts below the status bar',async()=>{
  const {p}=policy('?app-session=wisdom'); const calls=[]; const winStyle={};
  const element=()=>({classList:{add(){},remove(){}},dataset:{},style:{setProperty(k,v){winStyle[k]=v}},appendChild(){},replaceChildren(){},append(){},setAttribute(){},addEventListener(){}});
  const host=element(); const document={documentElement:element(),getElementById:()=>host,createElement:()=>element(),addEventListener(){},title:''};
  const window={WizHomeScreenPolicy:p,WizCore:{apps:()=>({APP:{}}),appsLoaded:()=>Promise.resolve()},WosSelMenu:{back:()=>false},WizAppServices:{guardBack(){}},
    WizardOSNative:{immersive(on){calls.push(on)},cutoutTop:()=>24,insetTop:()=>36}};
  const ctx=vm.createContext({window,document,location:{origin:'https://box.example'},URL,localStorage:storage(),addEventListener(){},setInterval(){},setTimeout(){}});
  vm.runInContext(read('core/single-app-session.js'),ctx);
  assert.deepEqual(calls,[false],'never asks Android to hide its bars');
  assert.equal(typeof window.__wosTop,'function'); window.__wosTop(40);
  // the real AppSessionActivity.applyImmersive override, run: whatever the shell asks, Android keeps its bars
  const asked=[]; const Main=class { applyImmersive(on){ asked.push(on); } };
  for(const on of [true,false]) method(java('AppSessionActivity.java'),'void applyImmersive(boolean ignored)',{args:{ignored:on},base:Main});
  assert.deepEqual(asked,[false,false]);
});

// Every surface that lists apps to open offers the same long-press. Miguel's skins replaced swipe-up Apps with
// Desks → New desk on 22 Oct 2026 and the long-press silently vanished for their users; this pins both pickers.
test('Apps sheet and New desk grid both carry the Add to home screen long-press', () => {
  // the phone's real wiring lines (app-deskbar.js), run: both menus are attached, the New desk grid by its rows
  const bar = read('app-deskbar.js'), attached = [];
  for (const line of bar.split('\n').filter(l => /window\.WizHomeScreenApps\?\.attach\((launcher|track),/.test(l)))
    vm.runInNewContext(line, { window: { WizHomeScreenApps: { attach: (menu, appFor, opts) => attached.push({ menu, app: appFor('notes'), opts }) } }, launcher: 'launcher', track: 'track', APP: { notes: { id: 'notes' } }, overviewMode: () => ({}) });
  assert.deepEqual(attached.map(a => a.menu), ['launcher', 'track']);
  assert.ok(attached.every(a => a.app?.id === 'notes'), 'each resolves the app by id');
  assert.equal(attached[1].opts.rows, '.new-desk [data-app]');
  assert.ok(attached.every(a => a.opts.available() === true), 'offered unless the overview mode turns app holds off');
  // the module's attach takes those three arguments
  const ctx = runRecording(read('core/home-screen-apps.js'), { window: {}, document: { addEventListener() {} }, Object, Set, Map, Array, JSON, Promise });
  assert.equal(typeof ctx.window.WizHomeScreenApps?.attach, 'function'); assert.equal(ctx.window.WizHomeScreenApps.attach.length, 2, 'attach(menu, appFor, opts = {})');
});

// Desks overview: hold a one-app desk and let go in place → the same sheet; a drag still reorders (James, 24 Oct).
// A phone with Notes alone on desk 1, Chats on desk 2, Health and Chats together on desk 3, and an empty desk 4.
const ovWorld = (mode = {}) => ({ mode, desks: [{ id: 'd1', wins: ['a'] }, { id: 'd2', wins: ['b'] }, { id: 'd3', wins: ['c', 'e'] }, { id: 'd4', wins: [] }],
  W: { a: { id: 'a', app: 'frame', appId: 'notes' }, b: { id: 'b', app: 'chats' }, c: { id: 'c', app: 'frame', appId: 'health' }, e: { id: 'e', app: 'chats' } },
  APP: { notes: { id: 'notes', name: 'Notes', url: '/notes/' }, health: { id: 'health', name: 'Health', url: '/health/' } } });

test('Desks overview hold-and-release offers Add to home screen; drag keeps reordering', async () => {
  // The real overview: hold a one-app desk and let go in place: the Add to home screen offer for that app.
  const o = await overview(ovWorld());
  o.hold('d1'); assert.deepEqual(o.offers, ['notes']);
  const chats = await overview(ovWorld()); chats.hold('d2'); assert.deepEqual(chats.offers, [], 'not for a desk without one frontend app');
  const two = await overview(ovWorld()); two.hold('d3'); assert.deepEqual(two.offers, [], 'nor for a desk with two windows');
  // Hold and drag onto another desk: it reorders, and offers nothing.
  const r = await overview(ovWorld());
  r.hold('d2', 'd3');
  assert.deepEqual(r.offers, []);
  assert.deepEqual([...r.appVars.desks.map(d => d.id)], ['d1', 'd3', 'd2', 'd4']);
});


// A home-screen app window is not "WizardOS in front": the floating orb stays over it (James, 24 Oct).
test('Pinned home-screen apps keep the floating orb', async () => {
  // the real AppState.shellFront and MainActivity.onStart/onStop, run: a pinned app window alone is not the shell in front
  class AppSessionActivity {} class MainActivity {}
  const visible = new Set();
  const shellFront = () => method(java('device/AppState.java'), 'public static synchronized boolean shellFront()', { scope: { visible, ai: { wizards: { os: { AppSessionActivity } } } } }).value;
  assert.equal(shellFront(), false, 'nothing visible');
  visible.add(new AppSessionActivity()); assert.equal(shellFront(), false, 'only a pinned app window: the orb stays');
  visible.add(new MainActivity()); assert.equal(shellFront(), true, 'the shell itself is visible');
  // both lifecycle edges tell the floating orb what is in front, and say so with shellFront()
  const main = java('MainActivity.java'), told = [];
  const ai = { wizards: { os: { AppSessionActivity, device: { AppState: { shellFront } }, everywhere: { EverywhereService: { setAppInFront: (a, front) => told.push(front) }, EverywhereOutbox: { get: () => ({ pump() {} }) } }, mizel: { MeetingRecorderService: { recoverFromActivity() {} } }, StartGuard: { paused: () => false } } } };
  const Base = class { onStart() {} onStop() {} };
  method(main, 'protected void onStart()', { scope: { ai, AppSessionActivity, device: { onStart() {} } }, base: Base });
  visible.clear(); visible.add(new AppSessionActivity());
  method(main, 'protected void onStop()', { scope: { ai, device: { onStop() {} } }, base: Base });
  assert.deepEqual(told, [true, false]);
});

 test('browser offer rejects unsafe destinations and preserves exact registered route',()=>{
  const f=pinFixture('ready',false);
  for(const url of ['/', '/wizard-os-home/', '/wizard-os-home/install/wisdom/', 'https://evil.example/wisdom/', 'javascript:alert(1)', '/wisdom/%252e%252e/']) {
    assert.equal(f.window.WizHomeScreenApps.offer({id:'wisdom',name:'Wisdom',kind:'wizard',url}),false,url);
  }
  for(const url of ['/actual-view/?tab=read#chapter','https://box.example/another-view/']) {
    assert.equal(f.window.WizHomeScreenApps.offer({id:'wisdom',name:'Wisdom',kind:'wizard',url}),true);
    assert.equal(f.body.children.at(-1).querySelector('textarea').value,new URL(url,'https://box.example').href);
  }
 });

// Overview arrange mode (a package holds api.overview.use({hold:'arrange', appAction:'home-screen'})): hold = arrange
// (drag to reorder, ✕ to close), never the copy-link sheet. A small download button beside ✕ (one-app desks only)
// opens the same Add to home screen flow. The shared shell owns this; no shipped package asks for it now.
test('Overview arrange mode: hold arranges desks; download button beside ✕ opens Add to home screen', async () => {
  const mode = { hold: 'arrange', appAction: 'home-screen' };
  const o = await overview(ovWorld(mode));
  // Download only for a one-app desk whose window is a registered frontend that passes the pin policy, beside ✕.
  const dl = o.el.querySelector('[data-ovdl="d1"]');
  assert.ok(dl); assert.equal(dl.getAttribute('aria-label'), 'Add Notes to home screen');
  assert.equal(dl.nextSibling?.getAttribute?.('data-ovx') ?? dl.parentNode.querySelector('[data-ovx]')?.getAttribute('data-ovx'), 'd1', 'next to ✕');
  for (const id of ['d2', 'd3', 'd4']) assert.equal(o.el.querySelector(`[data-ovdl="${id}"]`), null, id);
  const blocked = await overview({ ...ovWorld(mode), canOffer: () => false });
  assert.equal(blocked.el.querySelector('[data-ovdl]'), null, 'the pin policy decides');
  assert.equal((await overview(ovWorld({ hold: 'arrange' }))).el.querySelector('[data-ovdl]'), null, 'only when the tweak asks for it');
  // Hold and release in place arranges (editing), no sheet; the stock offer does not run.
  o.hold('d1'); assert.deepEqual(o.offers, []); assert.ok(o.el.classList.contains('editing'));
  // The download tap offers the app and neither closes the desk nor opens it.
  o.appVars.ovTapBlock = 0;
  o.tap('[data-ovdl="d1"]');
  assert.deepEqual(o.offers, ['notes']); assert.deepEqual([...o.appVars.desks.map(d => d.id)], ['d1', 'd2', 'd3', 'd4']);
  assert.ok(o.el.classList.contains('open'), 'the overview stays open');
  // Its touch never starts a drag.
  const t = await overview(ovWorld(mode));
  const b = t.el.querySelector('[data-ovdl="d1"]');
  b.dispatchEvent({ type: 'touchstart', bubbles: true, touches: [{ clientX: 1, clientY: 1 }] });
  assert.equal(t.appVars.OV.hold, undefined, 'no hold timer from the download button');
  // The launcher and the new-desk track keep their own hold-to-add, unless a layout turns app holds off.
  const deskbar = read('app-deskbar.js');
  const attached = [];
  for (const line of deskbar.split('\n').filter(l => l.includes('window.WizHomeScreenApps?.attach('))) {
    runRecording(line, { window: { WizHomeScreenApps: { attach: (el, find, o) => attached.push([el, o.available()]) } }, launcher: 'launcher', track: 'track', APP: {}, overviewMode: () => ({ appHold: false }) });
  }
  assert.deepEqual(attached, [['launcher', false], ['track', false]]);
});

test('canOffer accepts registered frontends only (multi-app/system/shell items get no download button)', () => {
  const f = pinFixture('ready', false), can = f.window.WizHomeScreenApps.canOffer;
  assert.equal(can({ id:'wisdom', name:'Wisdom', kind:'wizard', url:'/wisdom/' }), true);
  for (const bad of [null, undefined, { id:'settings', kind:'system', url:'/wizard-os-home/' }, { id:'home', kind:'wizard', url:'/wizard-os-home/' }, { id:'x', kind:'wizard', url:'https://evil.example/x/' }, { id:'../x', kind:'wizard', url:'/x/' }, { id:'nourl', kind:'wizard' }])
    assert.equal(can(bad), false, JSON.stringify(bad));
  assert.equal(f.window.WizHomeScreenApps.state.open, false, 'canOffer never opens the sheet');
});
test('pinned single-app session keeps the shared media viewer visible over the app (#1520)',()=>{
  // the real stylesheet on a pinned single-app page: the app, the toast and the photo viewer stay; the rest is hidden
  const css = read('core/home-screen-apps.css'), d = createDocument();
  d.documentElement.setAttribute('data-app-session', '');
  d.body.innerHTML = '<div id="device"><div id="singleApp"></div><div id="toast"></div><div class="mviewer"></div><div class="dock"></div></div>';
  const display = sel => cascade(d.querySelector(sel), css).display?.value;
  assert.equal(display('.dock'), 'none', 'the shell is hidden');
  for (const sel of ['#singleApp', '#toast', '.mviewer']) assert.notEqual(display(sel), 'none', `${sel} stays visible (tapped photos must not open invisibly)`);
  const viewer = d.querySelector('.mviewer'); viewer.setAttribute('hidden', '');
  assert.equal(cascade(viewer, read('core/chats.css')).display?.value, 'none', 'a closed viewer still stays hidden');
});
