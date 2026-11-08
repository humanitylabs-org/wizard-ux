import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

// Exercise the actual device.js updater, isolated from owner data/native recording commands.
const source = readFileSync(new URL('../web/device.js', import.meta.url), 'utf8');
const block = source.slice(source.indexOf('  let upd = null, updHidden = 0;'), source.indexOf('  /* ================= #22 web hot-reload'));
function fixture(state = 'deferred', reason = 'take') {
  const f = {voice:'idle', capture:false, native:false, active:null, calls:[], timers:[], elements:new Map()};
  const el = () => ({dataset:{}, hidden:false, innerHTML:'', setAttribute(){}, addEventListener(n, fn) { this.click = fn; }});
  const document = {createElement:el, body:{appendChild(e){f.elements.set(e.id,e);}}};
  const device = {recActive:()=>JSON.stringify(f.active), updateRecording:()=>f.native, updateState:()=>JSON.stringify(f.upd), updateInstall(){f.calls.push('install'); f.paintAtInstall = f.html();}};
  const window = {WizAppCapture:{getState:()=>({recording:f.capture})}};
  const context = {window, document, DEV:()=>device, W$:()=>f, J:s=>s?JSON.parse(s):null, $:s=>f.elements.get(s.slice(1)), esc:s=>s, log(){},
    setTimeout(fn,ms){f.timers.push({fn,ms});return f.timers.length;}, clearTimeout(){}};
  vm.runInNewContext(block + '\n globalThis.api={onUpdate,installUpdate,renderUpdate};', context);
  f.upd={state,reason,version:'0.10.27',versionCode:91};
  f.show=()=>context.api.onUpdate(f.upd); f.tap=()=>context.api.installUpdate(); f.html=()=>f.elements.get('dvUpdate')?.innerHTML||'';
  f.show(); return f;
}
for(const state of ['ready','deferred']) for(const reason of ['take','music','mic',undefined]) {
  test(`${state}/${reason}: plain ready text and first idle tap calls native`,()=>{
    const f=fixture(state,reason);
    assert.match(f.html(),/Wizard OS 0.10.27 is ready/);assert.match(f.html(),/Install now/);
    assert.doesNotMatch(f.html(),/installs|by itself|restart|Tap again|recording/i);
    f.tap();assert.deepEqual(f.calls,['install']);assert.match(f.paintAtInstall,/Opening installer/);
  });
}
for(const kind of ['voice','paused','capture','active','native']) test(`${kind}: protects a genuine take without stop/cancel confirmation`,()=>{
  const f=fixture();if(kind==='voice')f.voice='listen';if(kind==='paused')f.voice='paused';if(kind==='capture')f.capture=true;if(kind==='active')f.active={id:'synthetic'};if(kind==='native')f.native=true;
  f.show();assert.match(f.html(),/Finish your recording first/);f.tap();f.tap();assert.deepEqual(f.calls,[]);assert.doesNotMatch(f.html(),/stop the recording|Tap again/);
  f.voice='idle';f.capture=false;f.active=null;f.native=false;f.show();f.tap();assert.deepEqual(f.calls,['install']);
});
test('processing is not recording and a legacy APK refusal gives an honest recovery path',()=>{
  const f=fixture();f.voice='think';f.tap();assert.deepEqual(f.calls,['install']);
  f.timers.find(t=>t.ms===2500).fn();assert.match(f.html(),/If no recording is active, force stop Wizard OS/);
  assert.doesNotMatch(f.html(),/installs after|installs by itself|Tap again/);
});
test('banner body is not consent; only Install now initiates installation',()=>{
  const f=fixture('ready'); const banner=f.elements.get('dvUpdate');
  banner.click({target:{closest:()=>null}}); assert.deepEqual(f.calls,[]);
  banner.click({target:{closest:s=>s==='[data-upd="go"]'}});assert.deepEqual(f.calls,['install']);
});
test('no updater APK-download/navigation escape hatch',()=>{
  assert.doesNotMatch(block,/fetch\(|location\.|window\.open|\.cancel\(|\.stop\(|command\(/);
});
