import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../web/core/'+p,import.meta.url),'utf8');
function fixture(id='usuals') {
  const origin='https://wizard.example', calls=[], listeners={};
  const source={location:new URL(origin+'/'+id+'/'),document:{documentElement:{}},addEventListener(){},postMessage(){}};
  const frame={tagName:'IFRAME',isConnected:true,src:source.location.href,contentWindow:source,addEventListener(){},removeEventListener(){},hasAttribute:()=>false,getAttribute:()=>frame.src};
  const app={id,kind:'wizard',name:'Fixture',url:'/'+id+'/'};
  const c={URL,console,location:new URL(origin+'/wizard-os-home/'),document:{readyState:'loading',querySelectorAll:()=>[frame],addEventListener(){}},WizCore:{apps:()=>({APPS:[app]})},
    navigator:{},dispatchEvent(){},CustomEvent:class{},setInterval(){},setTimeout(){},clearTimeout(){},addEventListener:(n,f)=>(listeners[n] ||= []).push(f),
    WizDeviceLegacy:[{appId:'usuals',path:'/usuals/',probe:'usuals',methods:['usuals','usualsTeach','usualsSave']}],
    WizardOSNative:{usuals:()=>{calls.push(['usuals']);return '{"list":[{"id":"same-native-id"}]}';},usualsTeach:(...a)=>{calls.push(['usualsTeach',...a]);return '';},usualsSave:(...a)=>{calls.push(['usualsSave',...a]);return true;}}};
  c.window=c;vm.createContext(c);vm.runInContext(read('app-services.js'),c);vm.runInContext(read('android-relay.js'),c);
  c.WizAppServices.attach(frame,{appId:id,path:app.url});const service=c.WizAppServices.connect(source,{});
  return {c,frame,source,app,calls,service};
}
test('Food reads the unchanged native JSON and preserves legacy mutation arguments',()=>{
 const f=fixture();assert.equal(f.service.device.legacy.available('usuals'),true);assert.equal(f.calls.length,0);
 assert.equal(f.service.device.legacy.call('usuals'),'{"list":[{"id":"same-native-id"}]}');
 assert.equal(f.service.device.legacy.call('usualsTeach',['']), '');
 assert.equal(f.service.device.legacy.call('usualsSave',['same-native-id','Kra pao',null]),true);
 assert.deepEqual(f.calls,[['usuals'],['usualsTeach',''],['usualsSave','same-native-id','Kra pao',null]]);
});
for(const change of [f=>f.frame.isConnected=false,f=>f.source.document={},f=>f.source.location=new URL('https://foreign.example/usuals/'),f=>f.source.location=new URL('https://wizard.example/adjacent/'),f=>f.frame.src='https://wizard.example/adjacent/',f=>f.app.url='/adjacent/'])test('legacy calls fail closed after '+change,()=>{
 const f=fixture();change(f);assert.throws(()=>f.service.device.legacy.call('usuals'));assert.equal(f.calls.length,0);
});
test('another installed app cannot borrow a legacy device capability',()=>{const f=fixture('another-app');assert.equal(f.service.device.legacy.available('usuals'),false);assert.throws(()=>f.service.device.legacy.call('usuals'));assert.equal(f.calls.length,0);});
test('unknown methods and structured or excess arguments never reach native',()=>{const f=fixture();for(const [m,args] of [['getClass',[]],['usualsSave',[{}]],['usualsSave',['a','b','c','d']]])assert.throws(()=>f.service.device.legacy.call(m,args));assert.equal(f.calls.length,0);});
