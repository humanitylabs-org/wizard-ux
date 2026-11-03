// Real source registry regression for the failed Food picker fixture. No browser or private data.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
class FixtureCustomEvent extends Event {
 constructor(type,init={}) { super(type,init);this.detail=init.detail??null; }
}
async function registry({native=false,ids=['food']}={}) {
 const data=new Map(),target=new EventTarget(),document=Object.assign(new EventTarget(),{hidden:false});
 const apps=ids.map(id=>({id,name:id==='food'?'Food':'Usuals',url:'/fixture-app/'+id+'/',source:'apps.json'}));
 // Browser globals and window.* share listeners; document owns a separate target.
 const window=vm.createContext({WizCore:{norm:s=>String(s).toLowerCase()},WizConfig:{endpoint:()=>'/wizard/v1/apps'},
  addEventListener:target.addEventListener.bind(target),removeEventListener:target.removeEventListener.bind(target),dispatchEvent:target.dispatchEvent.bind(target),
  Event,CustomEvent:FixtureCustomEvent,document,localStorage:{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v)},
  fetch:async url=>({ok:true,json:async()=>url.includes('app-logos')?{logos:{}}:{apps}}),URL,location:{origin:'https://fixtures.invalid',href:'https://fixtures.invalid/'}});
 window.window=window;
 if(native)window.WizardOSNative={usuals:()=>JSON.stringify([])};
 vm.runInContext(read('web/core/voice-legacy.js'),window);
 vm.runInContext(read('web/core/apps.js'),window);
 await window.WizCore.appsLoaded();return window;
}
test('old fixture has no Food on either shell without the real legacy capability',async()=>{
 const w=await registry();
 for(const shell of ['mobile','desktop'])assert.equal(w.WizCore.apps(shell).APP.food,undefined);
 assert.equal(w.WizCore.appMetadata('food').id,'food');
});
test('synthetic empty native capability restores actual phone Food, never a desktop row',async()=>{
 const w=await registry({native:true}),events=[];
 const record=e=>events.push(e.detail);
 w.addEventListener('wizard:apps',record);
 const mobile=w.WizCore.apps('mobile'),desktop=w.WizCore.apps('desktop');
 w.removeEventListener('wizard:apps',record);
 assert.deepEqual(events.map(e=>e.shell),['mobile','desktop']);
 assert.equal(events[0].count,mobile.APPS.length);assert.equal(events[1].count,desktop.APPS.length);
 assert.equal(mobile.APP.food.id,'food');assert.equal(mobile.APP.food.name,'Food');
 assert.equal(desktop.APP.food,undefined);assert.equal(desktop.APPS.some(a=>a.id==='food'),false);
 const declaration=w.WizDeviceLegacy.find(d=>d.appId==='food');assert.equal(declaration.phoneOnly,true);assert.equal(declaration.probe,'usuals');
});
test('native compatibility records keep their real IDs even when lookup aliases exist',async()=>{
 const w=await registry({native:true,ids:['food','usuals']}),mobile=w.WizCore.apps('mobile');
 assert.equal(mobile.APP.usuals.id,'usuals');
 assert.equal(mobile.APP.food.id,'food');
 // Aliases fill missing lookups; they do not overwrite two present native records.
 if(w.WizCore.appIdAliases)assert.equal(w.WizCore.appIdAliases.usuals,'food');
 assert.equal(w.WizCore.apps('desktop').APP.usuals,undefined);
});
