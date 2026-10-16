import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
const require = createRequire(import.meta.url), F = require('../web/core/skin-frame.js');
const skins = [{id:'nebula'},{id:'grove',frame:{foundation:'borderless'}}];
test('foundations are reusable, backwards compatible and independently overridable', () => {
  assert.deepEqual(F.frame(), {foundation:'framed'});
  assert.deepEqual(F.frame({foundation:'borderless',border:1,radius:12}), {foundation:'borderless',border:1,radius:12,gutter:16,gap:8});
  assert.equal(F.composition({version:1,extends:'grove'},skins).frame.foundation,'borderless');
  assert.equal(F.composition({version:1,extends:'nebula'},skins).frame.foundation,'framed');
  assert.ok(Object.isFrozen(F.foundations.borderless));
});
test('reject executable/unknown fields, bad references, numeric ranges, malformed objects', () => {
  for (const value of [null,[],{version:2,extends:'grove'},{version:1,extends:'unknown'},
    {version:1,extends:'grove',css:'body{}'},{version:1,extends:'grove',frame:{script:'alert(1)'}},
    {version:1,extends:'grove',frame:{radius:29}}, {version:1,extends:'grove',frame:{gap:0}},
    {version:1,extends:'grove',frame:{border:'0'}},{version:1,extends:'grove',frame:{gutter:Infinity}},
    {version:1,extends:'grove',frame:{foundation:'__proto__'}},JSON.parse('{"version":1,"extends":"grove","frame":{"__proto__":{}}}')]) assert.throws(()=>F.composition(value,skins));
});
function runtime(preview = false, saved = null) {
  const store = new Map(saved ? Object.entries(saved) : []), props = new Map(), root = {dataset:{},style:{setProperty:(k,v)=>props.set(k,v),removeProperty:k=>props.delete(k)}};
  const ctx = vm.createContext({console,document:{readyState:'loading',addEventListener(){},getElementById(){return null;},documentElement:root,querySelector:q=>q.includes('wos-frame-preview') && preview ? {content:'borderless'} : null},localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},dispatchEvent(){},CustomEvent:class {},addEventListener(){},setTimeout(){},performance:{now:()=>0},Math});
  vm.runInContext('window = this',ctx);
  for (const f of ['skin-frame.js','skins.js']) vm.runInContext(fs.readFileSync(new URL('../web/core/'+f,import.meta.url),'utf8'),ctx);
  return {ctx,store,props,root};
}
test('preview default is isolated, persisted comparison wins and palette is preserved',()=>{
  assert.equal(runtime().ctx.WosSkin.frame.foundation,'framed');
  const {ctx,store,root} = runtime(true,{'wos.skin':'tide'}), S=ctx.WosSkin;
  assert.equal(S.frame.foundation,'borderless'); assert.equal(S.current,'tide');
  S.setFoundation('framed'); S.set('grove'); assert.equal(S.frame.foundation,'framed');
  assert.equal(runtime(true,Object.fromEntries(store)).ctx.WosSkin.frame.foundation,'framed');
  assert.equal(root.dataset.skinFrame,'framed');
});
test('invalid import is atomic; custom composition survives reload and reset',()=>{
  const {ctx,store}=runtime(true);
  vm.runInContext("WosSkin.compose({version:1,extends:'grove',frame:{foundation:'borderless',border:1,radius:12,gutter:6}})",ctx);
  const before=JSON.stringify(ctx.WosSkin.composition), stored=store.get('wos.skin.composition.v1');
  assert.throws(()=>vm.runInContext("WosSkin.compose({version:1,extends:'tide',frame:{radius:200}})",ctx));
  assert.equal(JSON.stringify(ctx.WosSkin.composition),before); assert.equal(store.get('wos.skin.composition.v1'),stored);
  assert.equal(runtime(true,Object.fromEntries(store)).ctx.WosSkin.frame.radius,12);
  ctx.WosSkin.resetFrame(); assert.equal(ctx.WosSkin.frame.foundation,'framed');
  assert.equal(runtime(false,{'wos.skin.composition.v1':'invalid'}).ctx.WosSkin.frame.foundation,'framed');
});
