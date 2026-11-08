import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../web/core/chat-kit.js', import.meta.url), 'utf8');
function bounded(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert(a >= 0 && b > a, 'production function anchors'); return source.slice(a, b);
}
function fitting(shell, W, H, r) {
  const V = { long: false, s: 1, x: 0, y: 0, el: { classList: { toggle() {} } } };
  const context = { V, document: { documentElement: { dataset: { shell } } }, dims: () => ({ W, H, r }), clampPan() {}, paint() {} };
  vm.runInNewContext(bounded('  function fit() {', '  function stopFling()'), context);
  context.fit(); return V;
}
test('desktop initial fit never opts into width-fit long reading, even on a narrow host', () => {
  for (const [W,H] of [[1440,760],[720,400],[360,500]]) for (const r of [2.168,20,1,.3]) assert.equal(fitting('desktop',W,H,r).long,false);
});
test('James correction, 6 Nov 2026: phone images always open contained within screen height', () => {
  for (const shell of ['phone', 'desktop', undefined])
    for (const [W,H] of [[393,720],[393,300],[852,300]])
      for (const r of [2340/1080,8000/1080,20,1,.4]) {
        const v = fitting(shell,W,H,r);
        assert.equal(v.long,false,`${shell}/${W}x${H}/${r}: never width-fit on open`);
        assert.equal(v.s,1); assert.equal(v.x,0); assert.equal(v.y,0);
      }
});
test('initial fit cannot re-enable the width-fit-on-open escape hatch', () => {
  const fit = bounded('  function fit() {', '  function stopFling()');
  assert.match(fit, /V\.long = false;/);
  assert.doesNotMatch(fit, /dataset\.shell|d\.r\s*>/);
});
test('gallery arrows consume browser/default/shell propagation but leave Escape and modifiers to existing owners', () => {
  let key, calls=[]; const V={el:{classList:{contains:()=>false}},long:false};
  const context={window:{addEventListener(type,fn,capture){assert.equal(type,'keydown');assert.equal(capture,true);key=fn;}},V,viewer:{isOpen:()=>true},go:d=>calls.push(d)};
  vm.runInNewContext(bounded("  window.addEventListener?.('keydown',", '  function menu(on)'),context);
  for(const [k,d] of [['ArrowRight',1],['ArrowLeft',-1]]) { let prevented=0,stopped=0; key({key:k,preventDefault(){prevented++},stopImmediatePropagation(){stopped++}});assert.equal(prevented,1);assert.equal(stopped,1);assert.equal(calls.at(-1),d); }
  const n=calls.length; for(const e of [{key:'Escape'},{key:'ArrowRight',altKey:true},{key:'ArrowRight',isComposing:true}])key(e);assert.equal(calls.length,n);
  V.el.classList.contains=()=>true; key({key:'ArrowRight',preventDefault(){},stopImmediatePropagation(){}});assert.equal(calls.length,n,'menu blocks underlying gallery movement');
  V.el.classList.contains=()=>false;
  for(const kind of ['video','audio']) for(const count of [1,3]) for(const composed of [false,true]) {
    V.items=Array.from({length:count},()=>({kind}));V.i=0;
    const media={matches:selector=>selector==='video, audio'};
    const target=composed?{matches:()=>false}:media;
    for(const k of ['ArrowRight','ArrowLeft']) {
      let prevented=0,stopped=0;
      key({key:k,target,...(composed?{composedPath:()=>[target,media]}:{}),preventDefault(){prevented++},stopImmediatePropagation(){stopped++}});
      assert.equal(prevented,0,`${kind}/${count}/${composed}: native seek default`);
      assert.equal(stopped,1,'block underlying shell propagation; native browser default is not cancelled');assert.equal(calls.length,n,'no gallery navigation');
    }
  }
});
