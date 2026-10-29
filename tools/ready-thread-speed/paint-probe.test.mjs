import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { installPaintProbe } from './paint-probe.mjs';

const old='SYNTHETIC_CURRENT_ANSWER_1_v1',current=old+'793271678885000';
function probe(specs){
  const frame=[],rect={left:10,top:10,right:210,bottom:40};
  const nodes=specs.map(s=>{const el={parentElement:null,style:{visibility:'visible',display:'block',opacity:'1',...s.style},contains(hit){return hit===this}};return {textContent:s.text,parentElement:el,rect:s.rect||rect,occluded:s.occluded};});
  let selected;
  const root={getBoundingClientRect:()=>({left:0,top:0,right:400,bottom:800}),querySelectorAll:()=>[{}]};
  const ctx=vm.createContext({window:{},NodeFilter:{SHOW_TEXT:4},innerWidth:400,innerHeight:800,
    performance:{now:()=>100},requestAnimationFrame:fn=>(frame.push(fn),frame.length),cancelAnimationFrame:()=>{},
    getComputedStyle:el=>el.style,
    document:{querySelector:()=>root,createTreeWalker:()=>{let i=0;return {nextNode:()=>nodes[i++]||null}},
      createRange:()=>({setStart:n=>{selected=n},setEnd:()=>{},getClientRects:()=>[selected.rect]}),
      elementFromPoint:()=>selected.occluded?{}:selected.parentElement}});
  vm.runInContext(`(${installPaintProbe.toString()})(${JSON.stringify({wid:'owned',expected:current,staleMarker:old})})`,ctx);
  ctx.window.__speed.start=1;
  const tick=()=>{assert.ok(frame.length,'observer keeps polling before current paint');frame.shift()();};
  return {state:ctx.window.__speed,tick,nodes};
}
test('old revision prefix in visible current token is not stale; current needs two frames',()=>{
  const p=probe([{text:current}]);p.tick();assert.equal(p.state.first,null);p.tick();assert.equal(p.state.first,99);assert.equal(p.state.stale,false);
});
test('exact old token hidden in current answer DOM is not a stale paint',()=>{
  const p=probe([{text:old,style:{display:'none'}},{text:current}]);p.tick();p.tick();assert.equal(p.state.first,99);assert.equal(p.state.stale,false);
});
test('exact visible old current-answer token is still forbidden',()=>{
  const p=probe([{text:old}]);p.tick();assert.equal(p.state.stale,true);assert.equal(p.state.first,null);
});
test('occluded or clipped old DOM does not count as a paint',()=>{
  for(const extra of [{occluded:true},{rect:{left:500,top:10,right:700,bottom:40}},{style:{opacity:'0'}}]){
    const p=probe([{text:old,...extra},{text:current}]);p.tick();p.tick();assert.equal(p.state.stale,false);assert.equal(p.state.first,99);
  }
});
test('hidden/occluded current token cannot finish; intervening invisibility resets two-frame proof',()=>{
  const p=probe([{text:current,occluded:true}]);p.tick();p.tick();assert.equal(p.state.first,null);
  p.nodes[0].occluded=false;p.tick();assert.equal(p.state.first,null);
  p.nodes[0].parentElement.style.visibility='hidden';p.tick();assert.equal(p.state.first,null);
  p.nodes[0].parentElement.style.visibility='visible';p.tick();assert.equal(p.state.first,null);p.tick();assert.equal(p.state.first,99);
});
