import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const source = readFileSync(process.env.TITLEBAR_SOURCE || new URL('../web/layouts/ai-apps/desktop.js', import.meta.url), 'utf8');
// Execute the production header projection and host subscription unchanged.
const block = source.slice(source.indexOf('  function paintTools()'), source.indexOf('  let winsDesk'));
const subscription = source.split('\n').find(l => l.includes('const offHost ='));
function fixture() {
  const queued = [], window = {};
  vm.runInNewContext(read('web/core/desktop-host.js'), {window, queueMicrotask:fn=>queued.push(fn), console});
  const app = id => ({id, calls:[], ids:[], tools(ids=['settings']) {this.ids=ids;}});
  const a=app('messenger-fixture'), b=app('second-fixture'), apps=[a,b];
  const mirror={children:[], hidden:true, replaceChildren(...nodes){this.children=nodes;}};
  const controller=window.WizDesktop.attach({windows:()=>apps.map(a=>({id:a.id,kind:'frame'})), has:id=>apps.some(a=>a.id===id), frame:id=>apps.find(a=>a.id===id), openApp:()=>true, focus:()=>true, close:()=>false,
    renderTools(frame,slot) {slot.replaceChildren(...(frame?.ids || []).map(id=>({dataset:{tool:id}, click(){frame.calls.push(id);}}))); return !!slot.children.length;}});
  const context=vm.createContext({host:controller.host,pTools:mirror,pane:a,panelWindow:()=>context.pane,watchPaneWins(){}});
  vm.runInContext(block+'\nconst paintTop = paintTools;\n'+subscription+'\nglobalThis.paint = paintTools; globalThis.switchPane = app => {pane=app; paintTools();}; globalThis.dispose = offHost;',context);
  const mutate=()=>controller.changed();
  const drain=()=>{let n=0;while(queued.length){assert(++n<10,'no lifecycle feedback loop');queued.shift()();}};
  return {a,b,mirror,queued,paint:context.paint,switchPane:context.switchPane,dispose:context.dispose,mutate,drain,click:()=>mirror.children[0].click()};
}
test('cold header follows tools registered after held app initialization, without reopening',()=>{
  const f=fixture(); f.paint(); assert(f.mirror.hidden);
  f.a.tools(['qr','search','settings']); f.mutate(); f.drain();
  assert.deepEqual(f.mirror.children.map(n=>n.dataset.tool),['qr','search','settings']); assert(!f.mirror.hidden);
  f.click(); assert.deepEqual(f.a.calls,['qr']);
});
test('header follows removal, replacement and repeated rerenders without feedback',()=>{
  const f=fixture(); f.a.tools(); f.paint();
  for(let i=0;i<4;i++) {f.a.tools([]); f.mutate(); f.drain(); assert(f.mirror.hidden);
    f.a.tools(['settings']); f.mutate(); f.drain(); assert(!f.mirror.hidden);
    f.paint(); assert.equal(f.queued.length,0); f.click();}
  assert.deepEqual(f.a.calls,Array(4).fill('settings'));
});
test('focus switch and minimize/reopen retain exact app ownership, once per tap; teardown unsubscribes',()=>{
  const f=fixture(); f.a.tools(); f.b.tools(['search']); f.paint(); f.click();
  f.switchPane(f.b); f.click(); f.a.tools(['qr']); f.mutate(); f.drain();
  assert.deepEqual(f.mirror.children.map(n=>n.dataset.tool),['search'],'background app cannot replace front tools');
  f.switchPane(null); assert(f.mirror.hidden);
  f.switchPane(f.a); f.click(); assert.deepEqual(f.a.calls,['settings','qr']); assert.deepEqual(f.b.calls,['search']);
  f.dispose(); f.a.tools(['late']); f.mutate(); f.drain(); assert.equal(f.queued.length,0); assert.equal(f.mirror.children[0].dataset.tool,'qr');
});
