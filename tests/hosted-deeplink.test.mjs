import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../web/core/links.js',import.meta.url),'utf8');
function fixture(claim=true){
 const calls=[], handlers={}; const location=new URL('https://wizard.example/wizard-os-home/');
 const w={WizCore:{deeplink:{route:(url,frame)=>{calls.push(['deep',url,frame]);return claim;}}},open:(url)=>calls.push(['external',url])};
 vm.runInNewContext(source,{window:w,location,navigator:{userAgent:'fixture'},URL,console});
 const frame={id:'manager'};const win={frameElement:frame,document:{addEventListener:(name,fn)=>handlers[name]=fn},location:new URL('https://wizard.example/wizard-manager/'),open(){}};
 const sheet={route:(url)=>{calls.push(['route',url]);return false;},open:url=>calls.push(['sheet',url])};
 w.WizLinks.guardFrame(win,'/wizard-manager/',sheet);
 const click=(href,target='_top',overrides={})=>{const a={getAttribute:k=>k==='href'?href:k==='target'?target:null};const e={button:0,target:{closest:()=>a},preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...overrides};handlers.click(e);return e;};
 return {calls,click,win,frame};
}
test('Manager result opens the existing shell thread route, never a nested Wizard',()=>{const f=fixture();f.click('/wizard-os-home/?session=wizard_qa');assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],'deep');assert.equal(f.calls[0][2],f.frame);});
test('ordinary app link retains the existing sheet fallback',()=>{const f=fixture(false);f.click('/other-app/');assert.deepEqual(f.calls.map(x=>x[0]),['deep','route','sheet']);});
test('external links never reach the internal thread router',()=>{const f=fixture();f.click('https://outside.example/');assert.deepEqual(f.calls.map(x=>x[0]),['external']);});
test('an app-local navigation stays app-local',()=>{const f=fixture();const e=f.click('/wizard-manager/detail','');assert.equal(f.calls.length,0);assert(!e.defaultPrevented);});
test('a prevented or modified click keeps the existing browser/app handling',()=>{const f=fixture();f.click('/wizard-os-home/?session=wizard_qa','_top',{defaultPrevented:true});f.click('/wizard-os-home/?session=wizard_qa','_top',{ctrlKey:true});assert.equal(f.calls.length,0);});
test('window.open uses the same canonical thread route',()=>{const f=fixture();f.win.open('/wizard-os-home/?session=wizard_qa','_top');assert.deepEqual(f.calls.map(x=>x[0]),['deep']);});
