import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../web/core/app-versions.js',import.meta.url),'utf8');
function fixture(keepable=true){
 let handler,calls=0,keeper,doc={};const strips=new Map(),dismissed=new Map(),reloading=new Map();
 const host={appendChild(el){el.parentElement=this}};const frame={parentElement:host};
 let live={frame,appId:'wisdom',holds:['Wisdom unsent request'],keepable};
 const el={dataset:{},setAttribute(){},addEventListener(n,fn){handler=fn},isConnected:true,remove(){}};
 const c={S:{update:{frames:()=>[live],keepDrafts:async f=>{assert.equal(f,frame);calls++;return keeper?.()}}},strips,dismissed,reloading,getComputedStyle:()=>({position:'relative'}),document:{createElement:()=>el},esc:String,appName:()=> 'Wisdom',note(){},clearStrip:f=>strips.delete(f),reload(f,how){c.reloaded={f,how}},docOf:()=>doc};
 vm.runInNewContext(source.slice(source.indexOf('  function paint('),source.indexOf('  let scanning')),c);c.showStrip(live,'synthetic-next');
 return{c,el,frame,live,setKeeper:fn=>keeper=fn,click:()=>handler({target:{closest:q=>q==='[data-go]'}}),hide:()=>handler({target:{closest:q=>q==='[data-x]'}}),replaceDoc:()=>doc={},get calls(){return calls}};
}
test('per-app Reload paints immediately, keeps only that frame and then reloads',async()=>{
 const f=fixture();let finish;f.setKeeper(()=>new Promise(r=>finish=()=>{f.live.holds=[];f.live.keepable=false;r()}));
 const click=f.click();assert.match(f.el.innerHTML,/Getting ready…/);assert.match(f.el.innerHTML,/disabled aria-busy/);assert.equal(f.calls,1);assert.equal(f.c.reloaded,undefined);
 await f.click();assert.equal(f.calls,1);finish();await click;assert.equal(f.c.reloaded.how,'tap');
});
for(const mode of ['denied','reject','new-edit'])test('per-app unconfirmed '+mode+' draft stays armed, not reloaded',async()=>{
 const f=fixture();f.setKeeper(()=>{if(mode==='reject')throw Error('storage denied');if(mode==='new-edit')f.live.holds=['newer draft'];});await f.click();assert.equal(f.c.reloaded,undefined);assert.equal(f.c.strips.get(f.frame).armed,true);
});
for(const mode of ['document','dismiss'])test('per-app pending keep cannot reload after '+mode,async()=>{
 const f=fixture();let finish;f.setKeeper(()=>new Promise(r=>finish=()=>{f.live.holds=[];r()}));const p=f.click();if(mode==='document')f.replaceDoc();else await f.hide();finish();await p;assert.equal(f.c.reloaded,undefined);
});
test('recording and sending holds never invoke a draft keeper',async()=>{
 const f=fixture(false);f.live.holds=['Recording','Sending'];await f.click();assert.equal(f.calls,0);assert.equal(f.c.reloaded,undefined);assert.equal(f.c.strips.get(f.frame).armed,true);
});
