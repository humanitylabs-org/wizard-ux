import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import fixture from '../tools/qa-settings-fixture.cjs';
import { runSettingsParity } from './fixtures/s1-settings-parity.mjs';
let run;const parity=()=>run??=runSettingsParity();
const welcome = fs.readFileSync(new URL('../web/core/welcome.js', import.meta.url), 'utf8');
const harness = fs.readFileSync(new URL('../qa/scripts/qa-settings-component-parity.cjs', import.meta.url), 'utf8');
function slice(start, end) { const a=welcome.indexOf(start),b=welcome.indexOf(end,a);assert(a>=0&&b>a);return welcome.slice(a,b); }
async function boot(options, setup, state) {
  const tasks=[],opened=[],log=[],s={Promise,tsig:()=>({}),booted:false,H:null,acted:false,act(){},addEventListener(){},removeEventListener(){},seenPending:()=>false,markSeen(){},read:()=>state,log:x=>log.push(x),open:x=>opened.push(x),setTimeout:(f,ms)=>{if(!ms)tasks.push(f);},fetch:async url=>({ok:true,json:async()=>url.endsWith('/model/options')?options:setup})};
  s.window={WizCore:{appsLoaded:()=>Promise.resolve()},WizConfig:{ready:Promise.resolve()}};
  s.OPTIONS='/wizard/hermes/api/model/options';s.SETUP='/wizard/v1/setup';s.SUB='claude-subscription-directsdk-experimental';
  vm.runInNewContext(slice('  function aiConnected(j, slug)','\n  // slug:')+slice('  async function aiReady(slug)','\n  async function setupState()')+slice('  async function setupState()','\n  // The server')+slice('  function boot(h)','\n\n  // The first thread')+'\nthis.boot=boot;',s);
  s.boot({});assert.equal(tasks.length,1);await tasks.shift()();return{opened,log};
}
test('Settings init seeds the actual Welcome key persistently, preserves saved state and never touches frames',()=>{
  const saved=new Map(),s={navigator:{},localStorage:{getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v)}};s.window=s;s.top=s;
  vm.runInNewContext(`(${fixture.seedOwner})()`,s);assert.equal(saved.get('wos.welcome.v1'),'done');
  saved.set('wos.skin','obsidian-light');vm.runInNewContext(`(${fixture.seedOwner})()`,s);assert.equal(saved.get('wos.skin'),'obsidian-light');
  s.top={};s.localStorage.setItem=()=>{throw Error('frame write');};vm.runInNewContext(`(${fixture.seedOwner})()`,s);
});
test('actual Welcome boot accepts setup first_run:false plus authenticated synthetic model and done key',async()=>{
  const r=await boot(fixture.ownerRead('/wizard/hermes/api/model/options'),fixture.ownerRead('/wizard/v1/setup'),'done');
  assert.deepEqual(r.opened,[]);assert.deepEqual(r.log,['boot:true:done:false']);
  const bad=await boot({}, {}, '');assert.deepEqual(bad.opened,['ai']);assert.deepEqual(bad.log,['boot:false::false']);
});
test('Settings browser keeps original paths, real boot oracle and re-resolving trusted input',async()=>{
  const r=await parity();
  // whole-script run (fake Chromium, tests/fixtures/s1-settings-parity.mjs): every check the script promises ran and passed
  const names=r.report.checks.map(c=>c.name);
  assert.equal(r.exitCode,undefined,r.errors.join('\n'));assert.equal(r.report.failed,0);assert.deepEqual(r.report.errors,[]);
  for(const skin of ['nebula','obsidian-light']){
    for(const kind of ['desktop','phone'])for(const name of ['live skin change','nearest Back returns to categories','missing route visible and fail-closed','read-only retry recovers verified mode','no Ask me, always automatic readback','For testers / For everyone names','original Install action intercepted'])assert(names.includes(`${kind} ${skin}: ${name}`),`${kind} ${skin}: ${name}`);
    for(const name of ['existing native check action preserved','one outside tap dismisses Settings to Home','#1552 Settings centred over Home, no desk window'])assert(names.some(n=>n.startsWith(skin+': '+name)),skin+': '+name);
  }
  // the real seedOwner is the init script, and the real Welcome decision stays away because of it
  assert.equal(r.initScripts.length,2);assert(r.initScripts.every(f=>f===fixture.seedOwner));
  assert.deepEqual(r.report.contexts.map(c=>JSON.stringify(c.welcome)),Array(2).fill('{"log":["boot:true:done:false"],"active":false,"overlay":false}'));
  // the phone taps, the desktop clicks (or Escape); the second skin is reached through its family
  const how=phone=>[...new Set(r.actions.filter(a=>a.phone===phone).map(a=>a.how))].sort().join();
  assert.equal(how(true),'tap');assert.equal(how(false),'click,key');
  assert.deepEqual(r.actions.filter(a=>/skin(pick|family)/.test(a.sel)).map(a=>a.sel).join('|'),Array(2).fill('[data-skinfamily="obsidian"]:visible|[data-skinpick="obsidian-light"]:visible').join('|'));
  // and each of those checks fails when the page misbehaves
  const failed=async knob=>{const x=await runSettingsParity({[knob]:true});assert.equal(x.exitCode,1,knob);return x.report.checks.filter(c=>!c.pass).map(c=>c.name).join('|');};
  assert.match(await failed('backStays'),/nearest Back returns to categories/);
  assert.match(await failed('nativeDead'),/existing native check action preserved/);
  assert.match(await failed('retryWrites'),/retry is read-only/);
  await failed('dismissStuck');await failed('noTechnical');
  assert(!harness.includes('scrollIntoViewIfNeeded'));assert(!/wosWelcome[^\n]*remove\(/.test(harness));assert(!harness.includes('force:true'));assert(!harness.includes('force: true'));
  assert.equal(fixture.ownerRead('/wizard/v1/runs'),null);
});

test('category oracle awaits canonical state, selected navigation and matching heading, never invented data-page',()=>{
  const body=harness.match(/const categoryReady=entry=>\{([\s\S]*?)\n\};/)[1];
  const entry={id:'about',label:'About & updates'},heading={textContent:entry.label},pane={hidden:false,querySelector:()=>heading},root={dataset:{settingsPage:'about'},querySelector:s=>s==='.st-page'?pane:s==='[data-st-page="about"][aria-current="page"]'?{}:null};
  const ready=()=>vm.runInNewContext(`(entry=>{${body}})(entry)`,{entry,document:{querySelector:s=>s==='#settingsBody'?root:null}});
  assert.equal(ready(),true);root.dataset.settingsPage='look';assert.equal(ready(),false);root.dataset.settingsPage='about';
  heading.textContent='Look';assert.equal(ready(),false);heading.textContent=entry.label;pane.hidden=true;assert.equal(ready(),false);pane.hidden=false;
  const query=root.querySelector;root.querySelector=s=>s==='.st-page'?pane:null;assert.equal(ready(),false);root.querySelector=query;
  assert(!harness.includes("getAttribute('data-page')"));
});
test('the whole script waits on that category oracle for every category it opens',async()=>{
  // whole-script run: each tapped category is awaited with its own menu entry (and About once more at the end)
  const r=await parity();
  for(const c of r.report.contexts)for(const [skin,pg] of Object.entries(c.pages)){
    assert.deepEqual(Object.keys(c.pages),['nebula','obsidian-light'],skin);
    const awaited=r.waits.filter(x=>x.phone===(c.kind==='phone')&&x.arg?.id).map(x=>x.arg.id+'='+x.arg.label);
    for(const e of pg.menu)assert(awaited.includes(e.id+'='+e.label),c.kind+' '+e.id);
  }
  assert.equal(r.waits.filter(x=>x.arg?.id).length,2*(2+1)+2*(3+1),'desktop 2 categories, phone 3, plus About again, per skin');
});
test('phone outside dismissal sends one trusted tap and awaits closed sheet; nearest Back and native evidence remain',async()=>{
  // #880 supersedes the single-line model-only oracle with visual/interaction closure.
  const body=harness.match(/else \{\s*(await p\.locator\('#scrim'\)[\s\S]*?)\n    \}/)[1];
  const oracle=harness.match(/const phoneDismissed=\(\)=>\{([\s\S]*?)\n\};/)[1];
  let taps=0,waits=0,checks=0;const state={sheet:'settings'},visual={open:false,device:false,opacity:'0',pointerEvents:'none',top:900};
  const settings={classList:{contains:()=>visual.open},getBoundingClientRect:()=>({top:visual.top,bottom:visual.top+400,left:0,right:412,width:412,height:400})};
  const device={classList:{contains:()=>visual.device}},backdrop={};
  const context={__wos:state,innerWidth:412,innerHeight:892,document:{querySelector:s=>({'#settings':settings,'#device':device,'#scrim':backdrop})[s]},getComputedStyle:el=>el===settings?{opacity:visual.opacity}:{pointerEvents:visual.pointerEvents}};
  const phoneDismissed=vm.runInNewContext(`()=>{${oracle}}`,context);
  const p={locator:s=>({tap:async()=>{assert.equal(s,'#scrim');assert.equal(++taps,1);state.sheet=null;}}),waitForFunction:async predicate=>{++waits;const value=predicate();assert(value);return{jsonValue:async()=>value};}};
  await vm.runInNewContext(`(async()=>{${body}})()`,{p,__wos:state,phoneDismissed,skin:'fixture',ok:c=>{++checks;assert(c);}});
  assert.equal(taps,1);assert.equal(waits,2);assert.equal(checks,1);
  for(const [key,value] of [['open',true],['device',true],['opacity','1'],['pointerEvents','auto'],['top',100]]){
    const before=visual[key];visual[key]=value;assert.equal(phoneDismissed(),false,key+' must be fully dismissed');visual[key]=before;
  }
  state.sheet='settings';assert.equal(phoneDismissed(),false,'model must be closed too');
  // whole-script run: nearest Back is checked after every category, and the About / native evidence is captured
  const r=await parity();
  for(const kind of ['desktop','phone'])for(const skin of ['nebula','obsidian-light'])assert.equal(r.report.checks.filter(c=>c.name===`${kind} ${skin}: nearest Back returns to categories`&&c.pass).length,kind==='phone'?3:2);
  for(const skin of ['nebula','obsidian-light']){
    for(const f of [`desktop-${skin}-about.png`,`phone-${skin}-about.png`,`phone-${skin}-about-native.png`,`phone-${skin}-native-row.png`])assert(r.files.includes(f),f);
    assert(!r.files.includes(`desktop-${skin}-about-native.png`),'native evidence only on the phone');
  }
});
