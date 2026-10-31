import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {launcherFixture} from './launcher-fixture.mjs';
const read = p => readFileSync(new URL('../web/' + p, import.meta.url), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const events = {}, nodes = new Map(), timers = new Map(), storage = new Map();
  let clock = 1000000, tid = 0, reloads = 0;
  const el = () => ({dataset: {}, classList: {toggle() {}}, style: {setProperty() {}}, setAttribute() {}, addEventListener() {}, querySelector() {return null;}, appendChild(n) {nodes.set(n.id, n);}});
  const ctx = {console, Event, AbortSignal, navigator: {onLine: true}, Date: {now: () => clock},
    document: {body: el(), documentElement: el(), getElementById: id => nodes.get(id), createElement: el},
    localStorage: {getItem: k => storage.get(k) || null, setItem: (k,v) => storage.set(k,v)},
    sessionStorage: {getItem: k => storage.get(k) || null, setItem: (k,v) => storage.set(k,v)},
    location: {reload() {reloads++;}},
    addEventListener(k,f) {(events[k] ||= []).push(f);}, dispatchEvent(e) {for (const f of events[e.type] || []) f(e);},
    setTimeout(f,ms=0) {timers.set(++tid,{f,at:clock+ms}); return tid;}, clearTimeout(id) {timers.delete(id);}, setInterval() {}};
  ctx.window = ctx;
  vm.runInNewContext(read('core/status.js'),ctx);
  return {ctx,nodes,timers,storage,event(k,e={}) {for (const f of events[k] || []) f(e);},
    advance(ms) {clock += ms; for (const [id,t] of [...timers]) if (t.at <= clock) {timers.delete(id); t.f();}}, reloads: () => reloads};
}
test('slow bootstrap cannot hold either shell past the cached launcher paint budget', async () => {
  for (const shell of ['app.js','desktop/desktop.js']) {
    const h=fixture(); let resolveBootstrap, fetched=0, repaints=0;
    h.ctx.WizConfig={ready:new Promise(resolve=>{resolveBootstrap=resolve;})};
    h.ctx.fetch=async()=>{fetched++;return {ok:true,json:async()=>({migrations:{'launcher-seed-v1':'done'},launcher:{desktopQuick:['late-app'],autoOpen:[]}})};};
    const policy=launcherFixture(h.ctx);
    policy.onChange(()=>repaints++);
    // Execute the actual shell startup prefix, substituting only its DOM body.
    assert.match(read(shell), /await window\.WizLauncher\?\.waitForShell\?\.\(\)/);
    const prefix=read(shell).slice(0,read(shell).indexOf('  const $'));
    const boot=prefix.slice(0,prefix.indexOf('  await window.WizLauncher'))+'  await window.WizLauncher?.waitForShell?.(); window.shellPainted=true; window.WizCore.status.attach({}); })();';
    h.event('load');vm.runInNewContext(boot,h.ctx);
    h.advance(999);await tick();assert.equal(h.ctx.shellPainted,undefined);
    h.advance(1);await tick();assert.equal(h.ctx.shellPainted,true);assert.equal(fetched,0);
    h.advance(3500);assert.equal(h.nodes.get('wxFatal'),undefined);assert.equal(h.reloads(),0);
    resolveBootstrap();await policy.ready;assert.equal(fetched,1);assert.equal(repaints,1);assert.deepEqual([...policy.get('desktopQuick')],['late-app']);
    assert.match(read('core/apps.js'),/WizLauncher\?\.onChange\(rebuild\)/);
    assert.match(read(shell),/addEventListener\('wizard:apps'/);
  }
});
test('network-only wait is not a fatal device error at 2.5 seconds; long absence can recover', () => {
  const h=fixture();h.event('load');h.advance(2500);assert.equal(h.nodes.get('wxFatal'),undefined);
  h.advance(12499);assert.equal(h.nodes.get('wxFatal'),undefined);h.advance(1);
  assert.equal(h.nodes.get('wxFatal').hidden,false);assert.match(h.ctx.WizCore.status.state.fatal,/taking longer/);
  h.ctx.__wos={};h.ctx.WizCore.status.attach({});assert.equal(h.nodes.get('wxFatal').hidden,true);assert.equal(h.ctx.WizCore.status.state.fatal,'');
});
test('real boot errors retain one reload then the useful error card; late desktop attach clears it', () => {
  const h=fixture();h.event('load');h.event('error',{message:'Uncaught broken shell'});h.advance(2500);assert.equal(h.reloads(),1);
  const next=fixture();next.storage.set('wos.bootReloadAt','1000000');next.event('load');next.event('unhandledrejection',{reason:Error('broken shell')});next.advance(2500);
  assert.match(next.ctx.WizCore.status.state.fatal,/couldn’t start on this device: broken shell/);
  next.ctx.WizCore.status.attach({});next.ctx.__wux={};assert.equal(next.nodes.get('wxFatal').hidden,true);
});
test('shell recovery does not dismiss an explicit runtime fatal card', () => {
  const h=fixture();h.ctx.WizCore.status.attach({});h.ctx.WizCore.status.fatal('Runtime failure');h.ctx.WizCore.status.attach({});
  assert.equal(h.ctx.WizCore.status.state.fatal,'Runtime failure');
});
