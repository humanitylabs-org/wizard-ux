import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const src = readFileSync(new URL('../web/core/chat-kit.js', import.meta.url), 'utf8');
function fixture(fileResult = 'shared') {
  const listeners = new Map(), timers = new Map(), calls = [], tasks = [];
  let seq = 0;
  const root = { addEventListener(t, f) { listeners.set(t, f); }, removeEventListener(t) { listeners.delete(t); } };
  const window = { WizardOSNative: { shareText: t => { calls.push(['native', t]); return 'shared'; }, shareFile: (b,n,t) => { calls.push(['file',b,n,t]); return fileResult; } }, WosShareSheet: { show: (p) => { calls.push(['sheet', p]); return 'shared'; } } };
  class Reader { readAsDataURL() { this.result = 'data:image/png;base64,Ynl0ZXM='; this.onload(); } }
  vm.runInNewContext(src, {window, document: {}, navigator: {}, location: {href: 'https://wizard.test/'}, URL, Blob, File, FileReader: Reader,
    setTimeout: (fn, ms) => { const id=++seq; timers.set(id,{fn,ms}); return id; }, clearTimeout: id => timers.delete(id) });
  const kit = window.WosChat, off = kit.bindSharePress(root);
  const button = { isConnected: true, closest: () => button, click() { const e=emit('click'); if (!e.stopped) tasks.push(kit.shareText('hello')); } };
  function emit(type, extra={}) { const e={ target: button, button: 0, isPrimary: true, pointerId: 1, clientX: 10, clientY: 10, preventDefault() { this.prevented=true; }, stopImmediatePropagation() { this.stopped=true; }, ...extra }; listeners.get(type)?.(e); return e; }
  function hold() { const t=[...timers.values()].find(x=>x.ms===500); if(t) t.fn(); }
  return {kit, button, emit, hold, calls, tasks, timers, off, listeners};
}
test('tap opens Wizard sheet; early release cancels the hold', async () => {
  const f=fixture(); f.emit('pointerdown'); f.emit('pointerup'); f.hold(); f.button.click(); await Promise.all(f.tasks);
  assert.equal(f.calls.length,1); assert.equal(f.calls[0][0],'sheet'); f.off(); assert.equal(f.listeners.size,0);
});
for (const pointerType of ['mouse','touch']) test(`${pointerType} hold invokes native once and suppresses release click/context menu`, async () => {
  const f=fixture(); f.emit('pointerdown',{pointerType}); assert.equal(f.calls.length,0);
  f.hold(); const up=f.emit('pointerup'); f.button.click(); await Promise.all(f.tasks);
  assert.equal(up.wosShareHeld,true); assert.deepEqual(f.calls,[['native','hello']]);
  assert.equal(f.emit('contextmenu').prevented,true);
  f.emit('pointerdown'); f.emit('pointerup'); f.button.click(); await Promise.all(f.tasks);
  assert.equal(f.calls.at(-1)[0],'sheet','next real tap is not swallowed');
});
test('move over 10px and pointercancel cancel a hold; 10px stays armed', async () => {
  const f=fixture(); f.emit('pointerdown'); f.emit('pointermove',{clientX:21}); f.hold(); assert.equal(f.calls.length,0);
  f.emit('pointerdown'); f.emit('pointercancel'); f.hold(); assert.equal(f.calls.length,0);
  f.emit('pointerdown'); f.emit('pointermove',{clientX:20}); f.hold(); await Promise.all(f.tasks); assert.equal(f.calls[0][0],'native');
});
test('file receipts preserve native outcomes; old bridge opened is not claimed as shared', async () => {
  for (const [native, receipt] of [['shared','shared'],['cancelled','cancelled'],[undefined,'unsupported'],['unsupported','unsupported']]) {
    const f=fixture(native === undefined ? null : native);
    assert.equal(await f.kit.shareFile(new File(['x'],'test.bin'),{direct:true}),receipt);
  }
  const f=fixture();
  assert.equal(await f.kit.shareFile(new Blob([new Uint8Array(32*1024*1024+1)]),{direct:true}),'unsupported');
  assert.equal(f.calls.length,0);
});
test('file hold captures direct mode before async work; normal file tap uses sheet', async () => {
  const f=fixture(), file=new File(['bytes'],'photo.png',{type:'image/png'});
  f.button.click=()=>{ const e=f.emit('click'); if (!e.stopped) f.tasks.push(f.kit.shareFile(file)); };
  f.emit('pointerdown'); f.hold(); f.emit('pointerup'); f.button.click(); await Promise.all(f.tasks);
  assert.deepEqual(f.calls,[['file','Ynl0ZXM=','photo.png','image/png']]);
  assert.equal(await f.kit.shareFile(file),'shared'); assert.equal(f.calls.at(-1)[0],'sheet');
  assert.equal(f.calls.at(-1)[1].file,file);
  assert.equal(await f.kit.sharePayload({text:'explicit',direct:true}),'shared'); assert.equal(f.calls.at(-1)[0],'native');
});
