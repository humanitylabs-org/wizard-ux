import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const source=readFileSync(new URL('../web/core/app-services.js',import.meta.url),'utf8');
function fixture({id='wizard-manager',installed=true,path='/wizard-manager/'}={}){
 const calls=[],doc={},location=new URL('https://wizard.example/wizard-os-home/');
 const child={location:new URL(path,location),document:doc,addEventListener(){},postMessage(){}};
 const frame={tagName:'IFRAME',src:child.location.href,isConnected:true,contentWindow:child,contentDocument:doc,hasAttribute:()=>false,addEventListener(){},removeEventListener(){}};
 const app={id,kind:'wizard',url:'/'+id+'/'};
 const window={WizCore:{apps:()=>({APPS:installed?[app]:[]})},dispatchEvent(){}};
 const context={window,location,URL,crypto:{randomUUID},addEventListener(){},setInterval(){},setTimeout,clearTimeout,document:{hidden:false,readyState:'loading',addEventListener(){}},CustomEvent:class{},navigator:{}};
 vm.runInNewContext(source,context); const host=window.WizAppServices,state={visible:true};
 const detach=host.attach(frame,{appId:id,path,openThread:sid=>{calls.push(sid);return true;},isVisible:()=>state.visible});
 const service=host.connect(child,{back:()=>false});
 return {calls,doc,child,frame,app,host,state,service,detach,context};
}
test('verified current Manager opens exact ID without normalizing it',()=>{const f=fixture();assert.equal(f.service.nav.openThread('thread/one'),true);assert.deepEqual(f.calls,['thread/one']);});
test('Manager owns only marked canonical links, preserving ordinary link handling',()=>{const f=fixture(),a={href:'https://wizard.example/wizard-os-home/?session=thread%2Fone',dataset:{wizardNativeThread:'thread/one'}};assert(f.host.ownsThreadLink(f.child,a));a.dataset.wizardNativeThread='thread/two';assert.equal(f.host.ownsThreadLink(f.child,a),false);a.dataset={};assert.equal(f.host.ownsThreadLink(f.child,a),false);});
for(const [name,alter] of [
 ['hidden app',f=>f.state.visible=false],['detached frame',f=>f.detach()],['closed frame',f=>f.frame.isConnected=false],['reloaded document',f=>f.child.document={}],['foreign navigation',f=>f.child.location=new URL('https://foreign.example/wizard-manager/')],['revoked catalog path',f=>f.app.url='/other/'],
])test(name+' cannot request a hosted thread',()=>{const f=fixture();alter(f);assert.throws(()=>f.service.nav.openThread('thread/one'));assert.deepEqual(f.calls,[]);});
for(const options of [{installed:false},{id:'other-app',path:'/other-app/'},{path:'/other-app/'}])test(JSON.stringify(options)+' cannot grant native Manager navigation',()=>{const f=fixture(options);assert.throws(()=>f.service.nav.openThread('thread/one'));assert.deepEqual(f.calls,[]);});
for(const id of ['', '__new__', 'thread one', 'x\n', 123, 'x'.repeat(513)])test('reject malformed/non-canonical ID '+JSON.stringify(id).slice(0,40),()=>{const f=fixture();assert.throws(()=>f.service.nav.openThread(id));assert.deepEqual(f.calls,[]);});
test('visibility is live and fails closed when the document changes',()=>{const f=fixture();assert(f.service.view.isVisible());f.state.visible=false;assert.equal(f.service.view.isVisible(),false);f.state.visible=true;f.context.document.hidden=true;assert.equal(f.service.view.isVisible(),false);f.child.document={};assert.throws(()=>f.service.view.isVisible());});
