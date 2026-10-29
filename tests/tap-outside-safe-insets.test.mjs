import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../web/core/single-app-session.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../web/core/home-screen-apps.css',import.meta.url),'utf8');
function session({top=36,cut=24,cover=false,sheets=[]}={}) {
  let frame,resolveApps; const hostStyles={},appStyles={},priority={},immersive=[];
  const appDoc={documentElement:{style:{setProperty(k,v,p){appStyles[k]=v;priority[k]=p;}}},querySelector:()=>cover?{}:null,styleSheets:sheets};
  const el=tag=>({tag,dataset:{},classList:{add(){},remove(){}},style:{setProperty(){}},events:{},setAttribute(){},append(){},replaceChildren(){},appendChild(child){if(child.tag==='iframe')frame=child;},addEventListener(k,fn){this.events[k]=fn;}});
  const host=el('host');const document={documentElement:{style:{setProperty(k,v){hostStyles[k]=v;}}},getElementById:()=>host,createElement:el,addEventListener(){}};
  const policy={mode:true,id:'notes',isShell:()=>false,displayName:a=>a.name,within:()=>true,key:()=> 'fixture'};
  const window={WizHomeScreenPolicy:policy,WizCore:{apps:()=>({APP:{notes:{id:'notes',name:'Notes',kind:'wizard',url:'/notes/'}}}),appsLoaded:()=>new Promise(r=>resolveApps=r)},WizardOSNative:{immersive:v=>immersive.push(v),cutoutTop:()=>cut,insetTop:()=>top},WizAppServices:{attach:()=>()=>{},guardBack(){}},WosSelMenu:{back:()=>false}};
  vm.runInContext(source,vm.createContext({window,document,location:{origin:'https://fixture.test'},URL,localStorage:{getItem:()=>null,setItem(){}},addEventListener(){},setTimeout(){},setInterval(){}}));
  const load=()=>{frame.contentDocument=appDoc;frame.contentWindow={location:{href:'https://fixture.test/notes/'},document:appDoc,history:{state:null,pushState(){},replaceState(){}},WizardApp:{ready(){}},addEventListener(){}};frame.events.load();};
  return {hostStyles,appStyles,priority,window,sheets,immersive,get frame(){return frame;},load,async mount(){resolveApps();await Promise.resolve();load();}};
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
test('James universal standalone rule: late styles and native callbacks never transfer frame ownership',async()=>{
  const f=session();await f.mount();const original=f.frame;
  f.sheets.push(sheet(':root{--wos-cutout:48px!important} header{padding:var(--wos-cutout)}'));
  f.window.__wosTop(48);assert.equal(f.hostStyles['--nat-t'],'48px');assert.equal(f.appStyles['--wos-cutout'],'0px');
  assert.equal(f.priority['--wos-cutout'],'important');assert.equal(f.frame,original,'no remount or keyboard/scroll reset');
  f.window.__wosTop(0);f.window.__wosCutout(0);assert.equal(f.hostStyles['--nat-t'],'0px');assert.equal(f.hostStyles['--cut-t'],'0px');
});
test('James universal standalone rule: host CSS unions env/native/cutout once and does not sum toast margin',()=>{
  assert.match(css,/--single-cut:max\(var\(--safe-t, env\(safe-area-inset-top, 0px\)\), var\(--cut-t, 0px\)\)/);
  assert.match(css,/#singleApp iframe[^}]*inset:var\(--single-cut, 0px\)[^}]*height:calc\(100% - var\(--single-cut, 0px\)\)/);
  assert.match(css,/#toast[^}]*top:calc\(var\(--single-cut\) \+ 12px\); margin-top:0/);
  assert.match(css,/#singleApp \.app-upd[^}]*top:calc\(var\(--single-cut\) \+ 8px\)/);
  assert.match(css,/\.linksheet\.pane \.ls-panel[^}]*top:var\(--single-cut\)/);
  assert.match(css,/\.linksheet\.sheet:not\(\.peek\) \.ls-panel[^}]*height:calc\(100% - var\(--single-cut\) - 6px\)/);
  assert.doesNotMatch(source,/styleSheets|cssRules|wizard-os-edge/,'CSS/meta heuristic is forbidden in pinned host');
});
