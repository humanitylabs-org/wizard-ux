import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {launcherFixture} from './launcher-fixture.mjs';
import { withShellParts } from './fixtures/shell-parts.mjs';
import { partScope, runPartRecording } from './fixtures/r5A-parts.mjs';
import { between, runRecording } from './fixtures/source-slice.mjs';
const read = p => withShellParts(readFileSync(new URL('../web/' + p, import.meta.url), 'utf8'));
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
    // wizard-ux issue 1558: ui-preferences is read beside bootstrap, so the slow read the paint budget guards is that one.
    let resolvePrefs; const prefsSlow=new Promise(resolve=>{resolvePrefs=resolve;});
    h.ctx.fetch=async()=>{fetched++;await prefsSlow;return {ok:true,json:async()=>({migrations:{'launcher-seed-v1':'done'},launcher:{desktopQuick:['late-app'],autoOpen:[]}})};};
    const policy=launcherFixture(h.ctx);
    policy.onChange(()=>repaints++);
    // Execute the actual shell startup prefix, substituting only its DOM body.
    const prefix=read(shell).slice(0,read(shell).indexOf('  const $'));
    const boot=prefix.slice(0,prefix.indexOf('  await window.WizLauncher'))+'  await window.WizLauncher?.waitForShell?.(); window.shellPainted=true; window.WizCore.status.attach({}); })();';
    h.event('load');vm.runInNewContext(boot,h.ctx);
    h.advance(999);await tick();assert.equal(h.ctx.shellPainted,undefined);
    h.advance(1);await tick();assert.equal(h.ctx.shellPainted,true);assert.equal(fetched,1,'asked beside bootstrap, not after it');
    h.advance(3500);assert.equal(h.nodes.get('wxFatal'),undefined);assert.equal(h.reloads(),0);
    resolveBootstrap();resolvePrefs();await policy.ready;assert.equal(fetched,1);assert.equal(repaints,1);assert.deepEqual([...policy.get('desktopQuick')],['late-app']);
  }
  // the late preferences reach the shells: the app registry rebuilds on a launcher change and says so (wizard:apps)
  let changed = null; const events = [];
  const win = { WizCore: {}, location: { origin: 'https://box.example', pathname: '/' }, addEventListener() {}, removeEventListener() {}, dispatchEvent: e => { events.push(e.type); return true; },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, WizLauncher: { onChange: f => { changed = f; }, get: () => [], settled: true } };
  const actx = { window: win, document: { addEventListener() {}, hidden: false }, CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o?.detail; } },
    localStorage: win.localStorage, location: win.location, addEventListener() {}, fetch: async () => ({ ok: false }), setTimeout, clearTimeout, console };
  actx.self = win; actx.globalThis = actx;
  vm.createContext(actx); vm.runInContext(readFileSync(new URL('../web/core/apps.js', import.meta.url), 'utf8'), actx);
  win.WizCore.apps('desktop'); const before = events.filter(t => t === 'wizard:apps').length;
  assert.equal(typeof changed, 'function', 'the registry listens to the launcher'); changed();
  assert.equal(events.filter(t => t === 'wizard:apps').length, before + 1, 'a late launcher change rebuilds the apps (wizard:apps)');
  // and the desktop repaints its Home on wizard:apps (the phone: the seed test below)
  const on = {}, painted = [];
  const pal = readFileSync(new URL('../web/desktop/desktop-palopen.js', import.meta.url), 'utf8');
  runRecording(between(pal, "  window.addEventListener('wizard:apps', () => {", "\n  palIn.addEventListener('input'"), { window: { addEventListener: (t, f) => { on[t] = f; } },
    desktopVars: { homeOpen: true, cur: 0 }, pal: { hidden: true }, paintHome: (el, html) => painted.push(html), homeHtml: i => 'home:' + i, $: () => ({}), wsEl: () => null });
  on['wizard:apps'](); assert.deepEqual(painted, ['home:null'], 'the desktop Home repaints with the late apps');
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
test('a fresh layout waits for settled launcher preferences before persisting auto-open desks', async () => {
  let release; const ctx = {console, Event, AbortSignal, addEventListener() {}, dispatchEvent() {}};
  ctx.window = ctx;
  ctx.WizConfig = {ready: new Promise(resolve => { release = resolve; })};
  ctx.fetch = async () => ({ok: true, json: async () => ({migrations: {'launcher-seed-v1': 'done'}, launcher: {autoOpen: []}})});
  const policy = launcherFixture(ctx);
  assert.equal(policy.settled, false, 'compatibility defaults are not authoritative before the first load');
  release(); await policy.ready;
  assert.equal(policy.settled, true);
  assert.deepEqual([...policy.get('autoOpen')], [], 'the synced empty list replaces the defaults');
  // the real phone seed part (app-seed.js) on a fresh device: auto-open desks only from settled preferences
  const seed = async settled => {
    let release; const L = { settled, get: k => (k === 'autoOpen' ? ['notes'] : []), ready: new Promise(r => { release = r; }) };
    const kept = new Map(), store = { get: (k, d) => (kept.has(k) ? kept.get(k) : d), set: (k, v) => kept.set(k, v) };
    const appVars = { W: null, desks: null }, on = {}; let n = 0;
    const scope = partScope({ WizLauncher: L, WosFeatures: { pruneWindows() {} }, addEventListener: (t, f) => { on[t] = f; }, setTimeout: () => 0 });
    scope.WizCore.migrateChatsFocus = (W, d) => d;
    await runPartRecording('app-seed.js', 'appParts', 'seed', { APP: { notes: { id: 'notes' } }, appVars, blank: x => ({ wins: [], ...x }), MAXW: 4, newId: () => 'w' + ++n, store }, scope);
    return { L, kept, on, release, seeded: () => Object.values(appVars.W).filter(w => w.seed).map(w => w.appId) };
  };
  const cold = await seed(false);
  assert.deepEqual(cold.seeded(), [], 'nothing auto-opened from the defaults'); assert.equal(cold.kept.get('stripSeeded'), false);
  cold.on['wizard:apps'](); assert.deepEqual(cold.seeded(), [], 'a late app list before the preferences settle opens nothing either');
  cold.L.settled = true; cold.release(); await new Promise(r => setImmediate(r));
  assert.deepEqual(cold.seeded(), ['notes'], 'seeded once the first load has settled'); assert.equal(cold.kept.get('stripSeeded'), true);
  cold.on['wizard:apps'](); assert.deepEqual(cold.seeded(), ['notes'], 'once');
  const warm = await seed(true);
  assert.deepEqual(warm.seeded(), ['notes'], 'settled at boot: seeded at once'); assert.equal(warm.kept.get('stripSeeded'), true);
});
