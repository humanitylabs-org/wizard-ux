import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
function fixture() {
  const jobs = [], framesQueue = [], calls = [], errors = [];
  const window = {};
  vm.runInNewContext(read('web/core/desktop-host.js'), { window, queueMicrotask: fn => jobs.push(fn), requestAnimationFrame: fn => framesQueue.push(fn), console: { error: (...args) => errors.push(args) } });
  const frames = new Map([['app', { identity: 'retained iframe' }]]);
  const state = [{ id:'app', kind:'frame', appId:'recorder', desk:1, title:'Recorder', focused:false, visible:true, privateState:{ secret:true } }, { id:'chat', kind:'chats', desk:0, title:'Chats', thread:'thread', visible:false }];
  let refusal = false;
  const adapter = { panes:{ model:'shared' }, windows:() => state, has: id => state.some(w => w.id === id), frame:id => frames.get(id),
    openApp(id) { calls.push(['open', id]); return id === 'recorder'; },
    focus(id, opts) { calls.push(['focus', id, opts]); if (refusal) return false; for (const w of state) w.focused = w.id === id; return true; },
    close(id) { calls.push(['close', id]); if (refusal) return false; state.splice(state.findIndex(w => w.id === id), 1); controller.changed(); return true; } };
  const controller = window.WizDesktop.attach(adapter), host = controller.host;
  return { host, controller, api:window.WizDesktop, adapter, state, calls, errors, jobs, framesQueue, refuse:() => { refusal = true; }, flush:() => { let n = 0; while (jobs.length) { assert.ok(++n < 100, 'bounded microtasks'); jobs.shift()(); } } };
}
test('one explicit frozen host; immutable snapshots never expose mutable shell state', () => {
  const f = fixture(); assert.equal(f.api.host, f.host); assert.equal(f.host.panes, f.adapter.panes);
  assert.ok(Object.isFrozen(f.host)); const rows = f.host.windows(); assert.ok(Object.isFrozen(rows)); assert.ok(rows.every(Object.isFrozen));
  assert.equal(rows[0].privateState, undefined); assert.throws(() => { rows[0].title = 'changed'; }, TypeError);
  f.state[0].title = 'new title'; assert.equal(rows[0].title, 'Recorder'); assert.equal(f.host.windows()[0].title, 'new title');
  assert.throws(() => f.api.attach(f.adapter), /already attached/);
});
test('open/focus/close delegate to original lifecycle, preserve refusal and stay synchronous', () => {
  const f = fixture(); assert.equal(f.host.openApp('recorder'), true); assert.equal(f.host.openApp('missing'), false); assert.equal(f.host.openApp(''), false);
  assert.equal(f.host.focus('app', {scroll:false}), true); assert.equal(f.state[0].focused, true);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[2])), ['focus','app',{scroll:false}]);
  assert.equal(f.host.focus('missing'), false); assert.equal(f.host.close('missing'), false); assert.equal(f.host.focus('__proto__'), false);
  f.refuse(); assert.equal(f.host.close('app'), false); assert.equal(f.host.focus('app'), false); assert.equal(f.state.length, 2);
});
test('retained iframe handles are not recreated; chats and closed windows have no app frame', () => {
  const f = fixture(), frame = f.host.frame('app'); assert.ok(frame); assert.equal(f.host.frame('app'), frame); assert.equal(f.host.frame('chat'), null);
  assert.equal(f.host.close('app'), true); assert.equal(f.host.frame('app'), null); assert.equal(f.host.frame('missing'), null);
});
test('changes coalesce after synchronous paint; teardown and broken listeners do not affect the shell', () => {
  const f = fixture(), seen = []; const off = f.host.onChange(state => seen.push(state));
  f.host.onChange(() => { throw Error('broken layout'); }); f.controller.changed(); f.host.focus('app'); f.controller.changed();
  assert.equal(seen.length, 0); f.flush(); assert.equal(seen.length, 1); assert.equal(seen[0][0].focused, true); assert.equal(f.errors.length, 1);
  f.controller.changed(); off(); off(); f.flush(); assert.equal(seen.length, 1);
});
test('invalid subscriptions and idle changes are no-ops', () => {
  const f = fixture(); f.host.onChange(null)(); f.controller.changed(); f.flush(); assert.equal(f.errors.length, 0);
});
test('readiness follows the retained frame document and handles non-app surfaces', () => {
  const f = fixture(), frame = f.host.frame('app');
  assert.equal(f.host.frameReady('missing'), false); assert.equal(f.host.frameReady('chat'), true);
  frame.contentDocument = { readyState:'complete', URL:'about:blank' }; assert.equal(f.host.frameReady('app'), false);
  frame.contentDocument = { readyState:'loading', URL:'https://wizard.test/recorder/' }; assert.equal(f.host.frameReady('app'), false);
  frame.contentDocument.readyState = 'complete'; assert.equal(f.host.frameReady('app'), true);
  Object.defineProperty(frame, 'contentDocument', { get() { throw Error('cross-origin'); } }); assert.equal(f.host.frameReady('app'), true);
  f.adapter.frame = () => null; assert.equal(f.host.frameReady('app'), false);
});
test('tools use retained app frames; closed and non-app surfaces clear the projection', () => {
  const f = fixture(), seen = [], slot = { replaceChildren() {} }, frame = f.host.frame('app');
  f.adapter.renderTools = (frame, slot) => { seen.push([frame, slot]); return !!frame; };
  assert.equal(f.host.renderTools('app', slot), true); assert.equal(seen[0][0], frame); assert.equal(seen[0][1], slot);
  assert.equal(f.host.renderTools('chat', slot), false); assert.equal(seen.at(-1)[0], null);
  f.host.close('app'); assert.equal(f.host.renderTools('app', slot), false); assert.equal(seen.at(-1)[0], null);
  assert.equal(f.host.renderTools('app', null), false);
});
test('unchanged render-tools/focus echoes cannot re-enter or starve the host queue', () => {
  const f = fixture(); let count = 0;
  f.host.onChange(() => { count++; f.controller.changed(); f.host.focus('app', { scroll: false }); });
  f.controller.changed(); f.flush();
  assert.equal(count, 1); assert.equal(f.jobs.length, 0);
  assert.equal(f.framesQueue.length, 1); f.framesQueue.shift()(); f.flush();
  assert.equal(count, 2); assert.equal(f.framesQueue.length, 0);
});
test('focus adapter recursion is refused and no-op/failed focus never emits a new lifecycle change', () => {
  const f = fixture(); let updates = 0, nested;
  f.host.onChange(() => updates++);
  f.adapter.focus = () => { nested = f.host.focus('app'); return true; };
  assert.equal(f.host.focus('app'), true); assert.equal(nested, false);
  f.flush(); assert.equal(updates, 0);
  f.adapter.focus = () => { throw new Error('focus broke'); };
  assert.throws(() => f.host.focus('app'), /focus broke/);
  f.adapter.focus = () => false; assert.equal(f.host.focus('app'), false);
  f.flush(); assert.equal(updates, 0, 'focus latch is released even after an exception');
});
test('real mutation while delivering is deferred to a paint turn, not lost', () => {
  const f = fixture(); let n = 0;
  f.host.onChange(() => { if (++n === 1) { f.state[0].title = 'New'; f.controller.changed(); } });
  f.controller.changed(); f.flush(); assert.equal(n, 1); assert.equal(f.framesQueue.length, 1);
  f.framesQueue.shift()(); f.flush(); assert.equal(n, 2);
});

test('companion membership follows host group identity/count, ignores inactive windows and settles once', () => {
  const source = read('web/layouts/ai-apps/desktop.js'), calls = [];
  const state = [{id:'video',desk:2,tiled:true},{id:'feedback',desk:2,tiled:false},{id:'other',desk:3,tiled:true}];
  const context = vm.createContext({ host:{windows:()=>state}, pane:{desk:2,id:'video'}, applySizes:()=>calls.push('size'), retileSoon:()=>calls.push('tile') });
  const membership = source.slice(source.indexOf('  const appWindows ='), source.indexOf('  let pane ='));
  const watcher = source.slice(source.indexOf('  let winsDesk ='), source.indexOf('  const NOTE ='));
  vm.runInContext(membership + watcher + '\nglobalThis.watch = watchPaneWins;', context);
  context.watch(); assert.deepEqual(calls, ['size','tile']); calls.length=0;
  context.watch(); assert.equal(calls.length,0,'unrelated render does not resize');
  state[1].tiled=true; context.watch(); assert.deepEqual(calls,['size','tile'],'late companion resizes once'); calls.length=0;
  context.watch(); assert.equal(calls.length,0);
  state[1].tiled=false; context.watch(); assert.deepEqual(calls,['size','tile'],'closing or monocle-hiding companion resizes'); calls.length=0;
  context.pane={desk:3,id:'other'}; context.watch(); assert.deepEqual(calls,['size','tile'],'same count on a new group is still a change'); calls.length=0;
  context.pane=null; context.watch(); assert.deepEqual(calls,['size','tile'],'minimize releases the group');
});
test('desktop loads the adapter before boot; Classic controls and skin adapter reuse host lifecycle', () => {
  const html = read('web/desktop.html'), desktop = read('web/desktop/desktop.js');
  assert.ok(html.indexOf('core/desktop-host.js') < html.indexOf('desktop/desktop.js'));
  assert.equal(html.split('core/desktop-host.js').length, 2); assert.doesNotMatch(read('web/index.html'), /desktop-host/);
  assert.match(desktop, /openApp: id => desktopHost\.openApp\(id\)/);
  assert.match(desktop, /doc\.addEventListener\('pointerdown', \(\) => desktopHost\.focus\(el\.dataset\.win, \{ scroll: false \}\), true\)/);
  assert.match(desktop, /if \(act === 'close'\) return desktopHost\.close\(id\)/);
  assert.doesNotMatch(read('web/core/desktop-host.js'), /querySelector|localStorage|fetch\(/);
});
