import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../web/core/chats.js',import.meta.url),'utf8');
function scene(){
  const listeners={};let closed=0;
  const env={rowSheet:{},root:{addEventListener(k,fn){listeners[k]=fn;}},closeRowSheet(){closed++;},justPressed:()=>true};
  vm.createContext(env);
  const start=src.indexOf("    root.addEventListener('pointerdown', e => { if (rowSheet) rowSheet.outsidePress");
  vm.runInContext(src.slice(start,src.indexOf("    root.addEventListener('submit'",start)),env);
  const condition=src.match(/if \(rowSheet && e.target.closest\('\.ch-sheet'\).*?return true; }/)[0];
  const outside={classList:{contains:k=>k==='ch-sheet'},closest:s=>s==='.ch-sheet'?{}:null};
  return {env,listeners,outside,get closed(){return closed;},click(detail=1){env.e={target:outside,detail};return vm.runInContext('(function(){'+condition+'})()',env);}};
}
test('Chats row hold release cannot close its new actions menu',()=>{
  const s=scene();s.click();assert.equal(s.closed,0);
});
test('Chats first fresh outside tap closes immediately without waiting for hold cooldown',()=>{
  const s=scene();s.listeners.pointerdown({isTrusted:true,target:s.outside});s.click();assert.equal(s.closed,1);
});
test('Chats drag from panel or cancelled pointer cannot become outside Back',()=>{
  const s=scene();s.listeners.pointerdown({isTrusted:true,target:{classList:{contains:()=>false}}});s.click();assert.equal(s.closed,0);
  s.listeners.pointerdown({isTrusted:true,target:s.outside});s.listeners.pointercancel();s.click();assert.equal(s.closed,0);
});
test('Chats keyboard backdrop action remains Back',()=>{
  const s=scene();s.click(0);assert.equal(s.closed,1);
});
