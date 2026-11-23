import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import { createDocument } from './fixtures/mini-dom.mjs';
import { valueOf, px } from './fixtures/r7A-css.mjs';
const source=readFileSync(new URL('../web/core/single-app-session.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../web/core/home-screen-apps.css',import.meta.url),'utf8');
function session({top=36,cut=24,cover=false,sheets=[]}={}) {
  let frame,resolveApps; const hostStyles={},appStyles={},priority={},immersive=[];
  const appDoc={documentElement:{style:{setProperty(k,v,p){appStyles[k]=v;priority[k]=p;}}},querySelector:()=>cover?{}:null,styleSheets:sheets};
  const el=tag=>({tag,dataset:{},classList:{add(){},remove(){}},style:{setProperty(){}},events:{},setAttribute(){},append(){},replaceChildren(){},appendChild(child){if(child.tag==='iframe')frame=child;},addEventListener(k,fn){this.events[k]=fn;}});
  const host=el('host');const document={documentElement:{style:{setProperty(k,v){hostStyles[k]=v;}}},getElementById:()=>host,createElement:el,addEventListener(){}};
  // No last-known list: the frame mounts only when the box's list arrives (wizard-ux issue 1558 mounts a cached pin at once).
  const registry={APP:{}};const notes={id:'notes',name:'Notes',kind:'wizard',url:'/notes/'};
  const policy={mode:true,id:'notes',isShell:()=>false,displayName:a=>a.name,within:()=>true,key:()=> 'fixture'};
  const window={WizHomeScreenPolicy:policy,WizCore:{apps:()=>registry,appsLoaded:()=>new Promise(r=>resolveApps=r)},WizardOSNative:{immersive:v=>immersive.push(v),cutoutTop:()=>cut,insetTop:()=>top},WizAppServices:{attach:()=>()=>{},guardBack(){}},WosSelMenu:{back:()=>false}};
  vm.runInContext(source,vm.createContext({window,document,location:{origin:'https://fixture.test'},URL,localStorage:{getItem:()=>null,setItem(){}},addEventListener(){},setTimeout(){},setInterval(){}}));
  const load=()=>{frame.contentDocument=appDoc;frame.contentWindow={location:{href:'https://fixture.test/notes/'},document:appDoc,history:{state:null,pushState(){},replaceState(){}},WizardApp:{ready(){}},addEventListener(){}};frame.events.load();};
  return {hostStyles,appStyles,priority,window,sheets,immersive,get frame(){return frame;},load,async mount(){registry.APP.notes=notes;resolveApps();await Promise.resolve();load();}};
}
const sheet=(text,extra={})=>({cssRules:[{cssText:text}],...extra});
const cases={
  'Notes sticky-only CSS':[sheet('#sidebar,#canvas-tools,#search{padding-top:var(--wos-cutout)}')],
  'Wisdom cover CSS':[sheet('.wb-top{padding-top:var(--wos-cutout)}')],
  'kit-only app':[sheet('.wz-head{padding-top:var(--wos-cutout)}',{href:'/kit/wizard-ui.css'})],
  'nested imports':[{cssRules:[{styleSheet:{cssRules:[{styleSheet:sheet('header{padding:var(--wos-cutout)}')}]}}]}],
  'disabled CSS':[sheet('header{padding:var(--wos-cutout)}',{disabled:true})],
  'unreadable CSS':[{get cssRules(){throw Error('SecurityError');}}],
  'explicit cover app':[]
};
for(const [name,sheets] of Object.entries(cases)) {
  test(`James universal standalone rule: ${name} cannot give the visible status bar to child CSS`,async()=>{
    const f=session({sheets,cover:name==='explicit cover app'});await f.mount();
    assert.equal(f.hostStyles['--nat-t'],'36px');assert.equal(f.hostStyles['--cut-t'],'24px');
    assert.equal(f.appStyles['--wos-cutout'],'0px');assert.equal(f.priority['--wos-cutout'],'important');
    assert.deepEqual(f.immersive,[false],'status and navigation bars stay visible');
  });
}
for(const top of [0,36,48])for(const cut of [0,36,48]) {
  test(`James universal standalone rule: native status ${top} / notch ${cut}, before mount and after reload`,async()=>{
    const f=session({top,cut});assert.equal(f.frame,undefined);
    assert.equal(f.hostStyles['--nat-t'],`${top}px`);assert.equal(f.hostStyles['--cut-t'],`${cut}px`);
    f.window.__wosTop(48);f.window.__wosCutout(36);
    await f.mount();assert.equal(f.appStyles['--wos-cutout'],'0px');
    f.window.__wosTop(top);f.window.__wosCutout(cut);f.load();
    assert.equal(f.hostStyles['--nat-t'],`${top}px`);assert.equal(f.hostStyles['--cut-t'],`${cut}px`);
    assert.equal(f.appStyles['--wos-cutout'],'0px');
  });
}
test('James universal standalone rule: host CSS unions env/native/cutout once and does not sum toast margin',()=>{
  // The pinned app's host page (#singleApp with its frame, the toast, the update chip, the link sheet) on a device
  // whose browser safe area and native cutout differ; the shell sets --safe-t / --cut-t on <html>.
  const page=(safe,cut)=>{
    const doc=createDocument(); doc.documentElement.setAttribute('data-app-session','');
    doc.body.innerHTML='<div id="singleApp" class="win full"><iframe></iframe><div class="app-upd"></div></div><div id="toast"></div><div class="linksheet pane"><div class="ls-panel"></div></div><div class="linksheet sheet"><div class="ls-panel"></div></div>';
    const sheets=[`html { --safe-t: ${safe}px; --cut-t: ${cut}px; }`,css];
    const at=(sel,prop,i=0)=>valueOf(doc.querySelectorAll(sel)[i],sheets,prop);
    const len=v=>px(String(v).replace(/100%/g,'100px')); // a 100px-tall host stands in for 100%
    const first=v=>{let d=0,k=0;for(;k<v.length;k++){if(v[k]==='(')d++;else if(v[k]===')')d--;else if(v[k]===' '&&!d)break;}return v.slice(0,k);}; // inset's top value
    return {cut:len(at('#singleApp','--single-cut')),frameTop:len(first(at('#singleApp iframe','inset'))),frameH:len(at('#singleApp iframe','height')),
      toast:len(at('#toast','top')),toastMargin:at('#toast','margin-top'),upd:len(at('#singleApp .app-upd','top')),
      paneTop:len(at('.linksheet .ls-panel','top',0)),sheetH:len(at('.linksheet .ls-panel','height',1))};
  };
  for(const [safe,cut,want] of [[20,48,48],[47,24,47],[0,0,0]]){
    const p=page(safe,cut);
    assert.equal(p.cut,want,`safe ${safe} / cutout ${cut}: the larger, once (never the sum)`);
    assert.equal(p.frameTop,want); assert.equal(p.frameH,100-want,'the frame fills the rest');
    assert.equal(p.toast,want+12); assert.equal(p.toastMargin,'0','no extra toast margin on top');
    assert.equal(p.upd,want+8);
    assert.equal(p.paneTop,want); assert.equal(p.sheetH,100-want-6);
  }
  assert.doesNotMatch(source,/styleSheets|cssRules|wizard-os-edge/,'CSS/meta heuristic is forbidden in pinned host');
});
