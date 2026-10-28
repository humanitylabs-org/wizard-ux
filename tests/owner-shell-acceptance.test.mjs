import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import predicates from '../tools/qa-shell-state.cjs';
const { shellPath, inViewport } = predicates;
test('acceptance recognizes phone and desktop Wizard entrypoints, not other apps', () => {
  for (const p of ['/wizard-os-home/', '/wizard-os-home/index.html', '/wizard-os-home/desktop.html']) assert.ok(shellPath(p));
  for (const p of ['/', '/notes/', '/wizard-os-home/not-a-shell.html', '/wizard-os-home/desktop.html/evil']) assert.ok(!shellPath(p));
});
test('closed translated Settings is offscreen, not a visible nested page', () => {
  assert.equal(inViewport({width:394,height:774,left:9,right:403,top:-795,bottom:-21},412,892), false);
  assert.equal(inViewport({width:394,height:774,left:9,right:403,top:63,bottom:837},412,892), true);
  assert.equal(inViewport({width:394,height:774,left:824,right:1218,top:63,bottom:837},412,892), false);
});
test('James: shared browser guard consumes nested and repeated root Back without an exit window', () => {
  const source = fs.readFileSync(new URL('../web/core/app-services.js', import.meta.url),'utf8');
  const body = source.slice(source.indexOf('  function guardBack('), source.indexOf('  // Only a trusted installed catalog'));
  const events = {}, gestures = {}, timers = [], notices = [], steps = ['category','settings','thread',false,false,false];
  let traversals = 0, pushes = 0, calls = 0;
  class CloseWatcher { constructor() { CloseWatcher.last = this; } }
  const history = { state:{}, pushState(s){this.state=s;pushes++;},back(){traversals++;} };
  const ctx = {window:{CloseWatcher},CloseWatcher,history,navigator:{userActivation:{isActive:true}},document:{addEventListener:(k,f)=>gestures[k]=f},addEventListener:(k,f)=>events[k]=f,setTimeout:f=>timers.push(f),VERSION:1};
  vm.runInNewContext('let rootArm;'+body+';this.start=guardBack',ctx);
  ctx.start(()=>{calls++;return steps.shift();},(...a)=>notices.push(a));
  gestures.pointerdown();
  for(let i=0;i<6;i++)events.popstate({state:{}});
  assert.equal(calls,6);assert.equal(pushes,7);assert.equal(notices.length,3);assert.equal(traversals,0);
  events.popstate({state:{__wizardApp:{version:1}}});assert.equal(calls,6,'app navigation owns its own popstate');
  CloseWatcher.last.onclose();timers.shift()();assert.equal(calls,7);assert.equal(traversals,0);
  assert.doesNotMatch(body,/exitUntil|Press back again to exit|history\.back/);
});
