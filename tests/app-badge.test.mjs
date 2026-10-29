import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../web/core/app-services.js',import.meta.url),'utf8');
function fixture(id='morning-report') {
 const counts={},location=new URL('https://wizard.example/wizard-os-home/');
 const child={location:new URL('/'+id+'/',location),document:{},addEventListener(){},postMessage(){}};
 const frame={tagName:'IFRAME',src:child.location.href,isConnected:true,contentWindow:child,hasAttribute:()=>false,addEventListener(){},removeEventListener(){}};
 const app={id,kind:'wizard',url:'/'+id+'/'};
 const window={WizCore:{apps:()=>({APPS:[app]}),workspaceNav:{setCount:(k,n)=>{counts[k]=n;}}},dispatchEvent(){}};
 vm.runInNewContext(source,{window,location,URL,addEventListener(){},setInterval(){},setTimeout,clearTimeout,document:{hidden:false,readyState:'loading',addEventListener(){}},CustomEvent:class{},navigator:{}});
 const detach=window.WizAppServices.attach(frame,{appId:id,path:app.url,isVisible:()=>true});
 return {child,counts,detach,service:window.WizAppServices.connect(child,{})};
}
test('an installed app sets its own badge count, keyed by its verified app id',()=>{
 const f=fixture(); assert.equal(f.service.badge.set(3),true); assert.equal(f.counts['morning-report'],3);
 f.service.badge.set(0); assert.equal(f.counts['morning-report'],0);
});
test('counts are clamped to whole non-negative numbers',()=>{
 const f=fixture(); f.service.badge.set(-4); assert.equal(f.counts['morning-report'],0);
 f.service.badge.set(2.7); assert.equal(f.counts['morning-report'],2);
 f.service.badge.set('x'); assert.equal(f.counts['morning-report'],0);
 f.service.badge.set(5000); assert.equal(f.counts['morning-report'],999);
});
test('closing the app clears its badge',()=>{
 const f=fixture(); f.service.badge.set(2); f.detach(); assert.equal(f.counts['morning-report'],0);
});
test('a closed app that never badged leaves counts untouched',()=>{
 const f=fixture(); f.detach(); assert.equal('morning-report' in f.counts,false);
});
test('a reloaded or foreign frame cannot badge',()=>{
 const f=fixture(); f.child.document={}; assert.throws(()=>f.service.badge.set(1));
 const g=fixture(); g.child.location=new URL('https://foreign.example/'); assert.throws(()=>g.service.badge.set(1));
});
for(const id of ['notifications','wizard']) test(id+' counts stay owned by the shell',()=>{
 const f=fixture(id); assert.throws(()=>f.service.badge.set(9)); assert.equal(id in f.counts,false);
});
