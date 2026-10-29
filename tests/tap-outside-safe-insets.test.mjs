import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../web/core/single-app-session.js',import.meta.url),'utf8');
function mounted({sheets=[],cover=false}={}) {
  let frame; const styles={}; const appStyles={};
  const appDoc={documentElement:{style:{setProperty(k,v){appStyles[k]=v;}}},querySelector:()=>cover?{}:null,styleSheets:sheets};
  const el=tag=>({tag,dataset:{},classList:{add(){},remove(){}},style:{setProperty(k,v){styles[k]=v;}},events:{},setAttribute(){},append(){},replaceChildren(){},appendChild(child){if(child.tag==='iframe')frame=child;},addEventListener(k,fn){this.events[k]=fn;}});
  const host=el('host');const document={getElementById:()=>host,createElement:el,addEventListener(){}};
  const policy={mode:true,id:'notes',resolve:()=>({id:'notes',name:'Notes',url:'/notes/'}),registered:()=>true,isShell:()=>false,displayName:a=>a.name,within:()=>true,key:()=> 'fixture'};
  const window={WizHomeScreenPolicy:policy,WizCore:{apps:()=>({APP:{notes:{id:'notes',name:'Notes',kind:'wizard',url:'/notes/'}}}),appsLoaded:()=>Promise.resolve()},WizardOSNative:{immersive(){},cutoutTop:()=>24,insetTop:()=>36},WizAppServices:{attach:()=>()=>{},guardBack(){}},WosSelMenu:{back:()=>false}};
  const ctx=vm.createContext({window,document,location:{origin:'https://fixture.test'},URL,localStorage:{getItem:()=>null,setItem(){}},addEventListener(){},setTimeout(){},setInterval(){}});
  vm.runInContext(source,ctx);
  return Promise.resolve().then(()=>{
    frame.contentDocument=appDoc;frame.contentWindow={location:{href:'https://fixture.test/notes/'},document:appDoc,history:{state:null,pushState(){},replaceState(){}},WizardApp:{ready(){}},addEventListener(){}};
    frame.events.load();return {styles,appStyles,window,sheets,frame};
  });
}
const css=(href,text,extra={})=>({href,cssRules:[{cssText:text}],...extra});
for(const href of ['/kit/wizard-ui.css','https://fixture.test/notes/wizard-ui.css?v=live#skin']) {
  test(`tap outside / pinned app: shared kit ${href} is not app-owned status-bar padding`,async()=>{
    const f=await mounted({sheets:[css(href,'.wz-head {padding:calc(var(--wos-cutout,0px) + 18px)}')]});
    assert.equal(f.styles['--single-cut'],'36px');assert.equal(f.appStyles['--wos-cutout'],'0px');
  });
}
test('pinned Notes: app-owned sidebar/canvas/search use exactly one status-bar inset',async()=>{
  const f=await mounted({sheets:[css('/notes/wizard-ui.css','.wz-head {padding:var(--wos-cutout)}'),css('/notes/styles.css','#sidebar,#canvas-tools,#search {padding-top:var(--wos-cutout)}')]});
  assert.equal(f.styles['--single-cut'],'0px');assert.equal(f.appStyles['--wos-cutout'],'36px');
});
test('pinned app: explicit cover meta opts in without CSS detection',async()=>{
  const f=await mounted({cover:true});assert.equal(f.styles['--single-cut'],'0px');
});
test('pinned app: inline app-owned rules count, marked inline kit and disabled rules do not',async()=>{
  const shared=css(null,'.wz-head {padding:var(--wos-cutout)}',{ownerNode:{dataset:{wzShared:'kit'}}});
  const disabled=css('/styles.css','header {padding:var(--wos-cutout)}',{disabled:true});
  const f=await mounted({sheets:[shared,disabled]});assert.equal(f.styles['--single-cut'],'36px');
  f.sheets.push(css(null,'header {padding:var(--wos-cutout)}'));f.window.__wosTop(40);assert.equal(f.styles['--single-cut'],'0px');assert.equal(f.appStyles['--wos-cutout'],'40px');
});
test('pinned app: @import shared kit is excluded; imported app rule still owns inset',async()=>{
  const wrapper={cssRules:[{cssText:'@import kit;',styleSheet:css('/kit/wizard-ui.css','header {padding:var(--wos-cutout)}')}]};
  const f=await mounted({sheets:[wrapper]});assert.equal(f.styles['--single-cut'],'36px');
  wrapper.cssRules.push({styleSheet:css('/notes/styles.css','header {padding:var(--wos-cutout)}')});f.window.__wosTop(36);assert.equal(f.styles['--single-cut'],'0px');
});
test('pinned app: unreadable cross-origin CSS fails closed and kit swap keeps frame inset',async()=>{
  const unreadable={get cssRules(){throw Error('SecurityError');}};
  const f=await mounted({sheets:[unreadable,css('/notes/wizard-ui.css?old','.wz-head {padding:var(--wos-cutout)}')]});
  f.sheets[1]=css('/kit/wizard-ui.css?live','.wz-head {padding:var(--wos-cutout)}');f.window.__wosTop(48);
  assert.equal(f.styles['--single-cut'],'48px');assert.equal(f.appStyles['--wos-cutout'],'0px');assert.ok(f.frame);
});
