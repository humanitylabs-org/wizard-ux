// WizardApp.orb.claim: the app in front may wear the two-orb agent orb as its main button. The shell keeps a fixed
// icon set and a short clean label, tints with the app's own registry colour, and drops the claim when the frame resets.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../web/core/app-services.js',import.meta.url),'utf8');
function fixture(id='mizel') {
 const posted=[],events=[],location=new URL('https://wizard.example/wizard-os-home/');
 const child={location:new URL('/'+id+'/',location),document:{},addEventListener(){},postMessage:(m,o)=>posted.push([m,o])};
 const frame={tagName:'IFRAME',src:child.location.href,isConnected:true,contentWindow:child,hasAttribute:()=>false,addEventListener(){},removeEventListener(){}};
 const app={id,kind:'wizard',url:'/'+id+'/',name:'Mizel',colors:['#3fe0ff','#1a6bff']};
 const window={WizCore:{apps:()=>({APPS:[app]}),workspaceNav:{setCount(){}}},dispatchEvent:e=>events.push(e)};
 vm.runInNewContext(source,{window,location,URL,addEventListener(){},setInterval(){},setTimeout,clearTimeout,document:{hidden:false,readyState:'loading',addEventListener(){}},CustomEvent:class{constructor(t,o){this.type=t;this.detail=o?.detail;}},navigator:{}});
 const detach=window.WizAppServices.attach(frame,{appId:id,path:app.url,isVisible:()=>true});
 return {child,frame,posted,events,detach,S:window.WizAppServices,service:window.WizAppServices.connect(child,{})};
}
test('a claim shows the app icon, a clean label and the app colour only where the layout draws the orb',()=>{
 const f=fixture(); assert.equal(f.service.orb.set({icon:'plus',label:'New recording'}),false,'no presenter: not shown');
 f.S.orb.presenter(()=>true); assert.equal(f.service.orb.shown(),true);
 const o=f.S.orb.of(f.frame); assert.equal(o.icon,'plus'); assert.equal(o.label,'New recording'); assert.equal(o.name,'Mizel'); assert.deepEqual([...o.colors],['#3fe0ff','#1a6bff']);
 assert.ok(Object.isFrozen(o)); assert.equal(f.events.at(-1).type,'wizard:app-orb');
});
test('unknown icons are refused and labels are cleaned and capped',()=>{
 const f=fixture(); f.service.orb.set({icon:'<svg onload=x>',label:'x'}); assert.equal(f.S.orb.of(f.frame),null);
 f.service.orb.set({icon:'mic',label:'a\u0000b'.padEnd(80,'c')}); const o=f.S.orb.of(f.frame); assert.equal(o.label.length,40); assert.ok(!/\u0000/.test(o.label));
});
test('a tap reaches only the claiming frame, and only while it holds a claim',()=>{
 const f=fixture(); assert.equal(f.S.orb.tap(f.frame),false); assert.equal(f.posted.length,0);
 f.service.orb.set({icon:'plus'}); assert.equal(f.S.orb.tap(f.frame),true);
 assert.equal(f.posted.at(-1)[0].type,'wizard:app:orb'); assert.equal(f.posted.at(-1)[1],'https://wizard.example');
 f.service.orb.set(null); assert.equal(f.S.orb.tap(f.frame),false);
});
test('closing or reloading the app gives the orb back to the agent',()=>{
 const f=fixture(); f.service.orb.set({icon:'plus'}); f.detach(); assert.equal(f.S.orb.of(f.frame),null);
 const g=fixture(); g.service.orb.set({icon:'plus'}); g.child.document={}; assert.equal(g.S.orb.of(g.frame),null); assert.equal(g.S.orb.tap(g.frame),false);
});
test('orb.set is an admitted message op',()=>{ assert.match(source,/'orb\.set'/); assert.match(source,/d\.op === 'orb\.set'/); });
