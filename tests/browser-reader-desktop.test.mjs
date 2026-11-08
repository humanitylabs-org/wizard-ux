// Execute the production desktop/layout open path, including an asynchronous app admission.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const desktop = readFileSync(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../web/layouts/ai-apps/desktop.js', import.meta.url), 'utf8');
const links = readFileSync(new URL('../web/core/links.js', import.meta.url), 'utf8');
const fn = (source, name) => { const start = source.indexOf(`  function ${name}(`); assert.ok(start >= 0); return source.slice(start, source.indexOf('\n  }', start) + 4); };
function desktopReader({existing = false, checkedLink = false} = {}) {
  const location = new URL('https://wizard.example/wizard-os-home/desktop.html');
  const app = {id:'browser', name:'Browser', kind:'wizard', url:'/browser/'};
  const W = {search:{id:'search',app:'frame',appId:'wizard-search'}}, ws = [{wins:['search'], focus:'search'}], gates = [], navigations = [];
  if (existing) { W.reader = {id:'reader', app:'frame', appId:'browser', url:'/browser/?url=https%3A%2F%2Fold.example%2F'}; ws.push({wins:['reader'], focus:'reader'}); }
  let holder, routing = false, count = 0;
  const context = {URL, location, W, ws, cur:0, APP:{browser:app}, CHATS:{}, console,
    findWin: predicate => Object.values(W).find(predicate),
    appAt: path => new URL(path, location).pathname.startsWith('/browser/') ? app : null,
    focusWin: id => { context.cur=ws.findIndex(d=>d.wins.includes(id)); ws[context.cur].focus = id; }, save(){}, render(){}, freshDesk:()=>({wins:[],focus:null}),
    newWin: (obj,opts={}) => { const w = {id:'new'+(++count), ...obj}, desk=opts.ws ?? context.cur; W[w.id] = w; ws[desk].wins.push(w.id); ws[desk].focus = w.id; return w; },
    goWs: i => {context.cur=i;},
    winEl: id => ({querySelector:()=>({contentWindow:{location:{pathname:'/browser/',search:'',hash:'',replace:url=>navigations.push([id,url])}}})}),
    WosAppSetup:{gate:(_app,resume)=>{gates.push(resume);return true;}},
<<<<<<< HEAD
    // The layout's goApp now asks the shared panes owner to focus the app pane.
    panes:(()=>{let state={focus:'chats'};return {get:()=>state,set:next=>{state={...state,...next};}};})(),
    unpeek(){}, closeAll(){}, loading(){}, want:'', focusWant:'', wantAppFocus: id => { context.focusWant = id; }, CHATS_ID:'wizard', chatsFresh:true, chatThread:null, mainChats:()=>null,
=======
    unpeek(){}, closeAll(){}, loading(){}, want:'', focusWant:'', wantAppFocus: id => { context.focusWant = id; }, panes:{get:()=>({mode:'tiled',focus:'chats',slots:['chats']}),set(){}}, CHATS_ID:'wizard', chatsFresh:true, chatThread:null, mainChats:()=>null,
>>>>>>> origin/main
  };
  context.window = context;
  context.WosSkinHost = {routeOpen(kind, detail, go) { if (routing) return null; routing=true; try { return holder.open(kind,detail,go) ? {value:true} : null; } finally {routing=false;} }};
  vm.createContext(context);
  vm.runInContext(['framePage','openApp','openAppLink'].map(name=>fn(desktop,name)).join('\n'),context);
  const adapterStart = desktop.indexOf('    openAppDesk: (id, place = null) =>');
  const adapterEnd = desktop.indexOf('    openLinkDesk:', adapterStart);
  vm.runInContext(`adapter = {${desktop.slice(adapterStart,adapterEnd)}}`,context);
  context.api = {apps:{
    openDesk:(...args)=>context.adapter.openAppDesk(...args),
    path:(...args)=>context.adapter.showAppPath(...args),
    routeOpens:h=>{holder=h;},
  },nav:{goDesk:i=>context.goWs(i)},sessions:{newChat(){}}};
  context.desks = ()=>ws.map((d,i)=>({desk:i,id:W[d.focus]?.appId || ''}));
  const goStart=layout.indexOf('  const goApp = '), goEnd=layout.indexOf('  let chatsFresh =',goStart);
  const routeStart=layout.indexOf('  api.apps.routeOpens?.({'), routeEnd=layout.indexOf('    // the app panel',routeStart);
  vm.runInContext(`const CHATS = 'wizard';\n${layout.slice(goStart,goEnd)}\n${layout.slice(routeStart,routeEnd)} });`,context);
  // Use the real desktop WizLinks mount and hosted Search guard, not a direct opener call.
  class El {
    constructor(){this.handlers={};this.nodes={};this.style={};this.classList={add(){},remove(){},contains(){return false;},toggle(){return false;}};}
    setAttribute(){} appendChild(){} querySelector(s){return this.nodes[s] ||= new El();}
    addEventListener(n,fn){(this.handlers[n] ||= []).push(fn);}
  }
  context.document={body:new El(),createElement:()=>new El()};context.navigator={userAgent:'fixture'};
  context.setTimeout=setTimeout;context.clearTimeout=clearTimeout;context.performance={now:()=>0};
  vm.runInContext(links,context);
  const mountStart=desktop.indexOf('window.WizLinks.mount({',desktop.indexOf('  const LINKS ='));
  const mountEnd=desktop.indexOf('  }) : null;',mountStart);
  vm.runInContext('LINKS = '+desktop.slice(mountStart,mountEnd)+'  });',context);
  const doc=new El(), win={document:doc, location:new URL('/search/',location), frameElement:{}};
  context.WizLinks.guardFrame(win,'/search/',context.LINKS);
  const url='https://example.com/new-story?q=1#section';
  const a={getAttribute:k=>k==='href'?url:k==='target'?'_blank':null,hasAttribute:()=>false};
  const e={button:0,target:{closest:()=>a},preventDefault(){this.defaultPrevented=true;},stopPropagation(){}};
  if (checkedLink) context.openAppLink('/browser/?url='+encodeURIComponent(url),'Browser');
  else for(const handler of doc.handlers.click || [])handler(e);
  return {W,ws,gates,navigations,url,event:e};
}
for(const existing of [false,true])test(`desktop Search result preserves Reader URL (${existing?'already open':'cold open with deferred setup'})`,()=>{
  const f=desktopReader({existing});
  assert.equal(f.event.defaultPrevented,true,'hosted Search never navigates away');
  while(f.gates.length)f.gates.shift()();
  const windows=Object.values(f.W).filter(w=>w.appId==='browser');
  assert.equal(windows.length,1,'one Browser window');
  const expected='/browser/?url='+encodeURIComponent(f.url);
  assert.equal(windows[0].url,expected,'the destination survives in persisted window state');
  assert.deepEqual(f.ws[0].wins,['search'],'Reader respects layout placement on its own desk');
  if(existing)assert.deepEqual(f.navigations,[[windows[0].id,expected]],'reused frame navigates, not just focuses');
});
test('desktop checked Reader opener retains destination and placement across deferred admission',()=>{
  const f=desktopReader({checkedLink:true});
  assert.equal(f.gates.length,1);assert.equal(Object.values(f.W).filter(w=>w.appId==='browser').length,0);
  f.gates.shift()();
  assert.equal(f.gates.length,0,'layout must not replace the checked opener with another generic admission');
  const windows=Object.values(f.W).filter(w=>w.appId==='browser');
  assert.equal(windows.length,1);assert.equal(windows[0].url,'/browser/?url='+encodeURIComponent(f.url));
  assert.deepEqual(f.ws[0].wins,['search']);
});
