import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createDocument } from './fixtures/mini-dom.mjs';
import { withShellParts } from './fixtures/shell-parts.mjs';
import { desktopPartBody } from './fixtures/desktop-parts.mjs';
import { pageAssets } from './fixtures/w1-pages.mjs';
import { block, runRecording } from './fixtures/source-slice.mjs';
const read = file => withShellParts(readFileSync(new URL('../' + file, import.meta.url), 'utf8'));
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
test('Chats bodies and Settings parts delegate without renderer selectors or another lifecycle store', () => {
  const f = fixture(), surface = { mount() {}, composer: {} }, closePart = {};
  let open = true, overlays = 0;
  f.adapter.chats = id => { assert.equal(id, 'chat'); return surface; };
  f.adapter.settings = () => ({ isOpen: open, closePart });
  f.adapter.closeSettings = () => { if (!open) return false; open = false; return true; };
  f.adapter.settingsOverlay = () => { overlays++; return () => overlays--; };
  assert.equal(f.host.chats('chat'), surface);
  assert.equal(f.host.chats('app'), null); assert.equal(f.host.chats('missing'), null);
  assert.equal(f.host.settings.isOpen(), true); assert.equal(f.host.settings.closePart(), closePart);
  const release = f.host.settings.overlay(); assert.equal(overlays, 1); release(); assert.equal(overlays, 0);
  assert.equal(f.host.settings.close(), true); assert.equal(f.host.settings.isOpen(), false); assert.equal(f.host.settings.close(), false);
  f.host.close('chat'); assert.equal(f.host.chats('chat'), null);
  assert.equal(f.jobs.length, 0, 'part reads/mount leases do not create a focus/notification echo');
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
  const context = vm.createContext({ host:{windows:()=>state}, pane:{desk:2,id:'video'}, wide:false, setWide:v=>{ context.wide=v; }, applySizes:()=>calls.push('size'), retileSoon:()=>calls.push('tile') });
  const membership = source.slice(source.indexOf('  const appWindows ='), source.indexOf('  let pane ='));
  const watcher = source.slice(source.indexOf('  let winsDesk ='), source.indexOf('  const NOTE ='));
  vm.runInContext(membership + watcher + '\nglobalThis.watch = watchPaneWins;', context);
  context.watch(); assert.deepEqual(calls, ['size','tile']); calls.length=0;
  context.watch(); assert.equal(calls.length,0,'unrelated render does not resize');
  state[1].tiled=true; context.watch(); assert.deepEqual(calls,['size','tile'],'late companion resizes once'); calls.length=0;
  assert.equal(context.wide, true, 'an app with its companion goes full width (James, 6 Nov 2026)');
  context.watch(); assert.equal(calls.length,0);
  state[1].tiled=false; context.watch(); assert.deepEqual(calls,['size','tile'],'closing or monocle-hiding companion resizes'); calls.length=0;
  assert.equal(context.wide, false, 'and goes back to the side when the companion closes');
  context.pane={desk:3,id:'other'}; context.watch(); assert.deepEqual(calls,['size','tile'],'same count on a new group is still a change'); calls.length=0;
  context.pane=null; context.watch(); assert.deepEqual(calls,['size','tile'],'minimize releases the group');
});
// The real host (fixture above) driven through the real Classic code that reaches it: the page's script order
// (tests/fixtures/w1-pages.mjs parses desktop.html), the skin adapter desktop-boot.js hands WosSkinHost, the frame
// hook in desktop-frames.js and the window close button in desktop-steps.js (slices run in node:vm).
test('desktop loads the adapter before boot; Classic controls and skin adapter reuse host lifecycle', () => {
  const desk = pageAssets('desktop.html').srcs;
  assert.equal(desk.filter(s => s === 'core/desktop-host.js').length, 1, 'desktop.html loads the host once');
  assert.ok(desk.indexOf('core/desktop-host.js') < desk.indexOf('desktop/desktop.js'), 'before the shell boots');
  assert.ok(!pageAssets('index.html').srcs.includes('core/desktop-host.js'), 'the phone has no desktop host');
  const f = fixture();
  // Skin adapter: WosSkinHost.attach({ openApp }) opens through the host.
  let skinAdapter;
  runRecording(block(desktopPartBody('boot'), '  window.WosSkinHost?.attach({') + ');', { window: { WosSkinHost: { attach: a => { skinAdapter = a; } } }, desktopHost: f.host });
  assert.equal(skinAdapter.openApp('recorder'), true); assert.equal(skinAdapter.openApp('missing'), false);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.filter(c => c[0] === 'open'))), [['open', 'recorder'], ['open', 'missing']]);
  // A click inside a same-origin app frame focuses its window through the host, without scrolling.
  const w = { WizCore: {} };
  vm.runInNewContext(read('web/desktop/desktop-frames.js'), { window: w });
  const { watchFrame } = w.WizCore.desktopParts.frames({ APP: {}, desktopHost: f.host, desktopVars: { W: { app: { id: 'app', appId: 'recorder' } } }, fields: () => ({ bind() {} }) });
  const listeners = {}, doc = { URL: 'https://box.test/recorder/', addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); }, defaultView: { addEventListener() {} } };
  let load; watchFrame({ addEventListener: (t, fn) => { if (t === 'load') load = fn; }, getAttribute: () => '/recorder/', hasAttribute: () => false, contentDocument: doc, contentWindow: { location: {} } }, { dataset: { win: 'app' }, querySelector: () => null });
  load(); f.calls.length = 0;
  for (const fn of listeners.pointerdown) fn({});
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)), [['focus', 'app', { scroll: false }]]);
  assert.equal(f.state[0].focused, true);
  // The window's close button closes through the host (which keeps the adapter's refusal).
  let click;
  runRecording(block(desktopPartBody('steps'), "  stage.addEventListener('click', e => {\n    const el = e.target.closest('.win')") + ');',
    { stage: { addEventListener: (t, fn) => { click = fn; } }, desktopHost: f.host, W: { app: f.state[0] }, hud: null });
  const target = { closest: sel => sel === '.win' ? { dataset: { win: 'app' } } : sel === '[data-wact]' ? { dataset: { wact: 'close' } } : null };
  f.calls.length = 0; assert.equal(click({ target }), true);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls)), [['close', 'app']]);
  assert.equal(f.host.windows().some(x => x.id === 'app'), false);
});
test('desktop host reads no page, storage or network on its own', () => {
  assert.doesNotMatch(read('web/core/desktop-host.js'), /querySelector|localStorage|fetch\(/);
});

test('desktop host: layout toolbars never crash a shell whose app services lack titlebar.render (James, 6 Nov 2026)', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = withShellParts(await readFile(new URL('../web/desktop/desktop.js', import.meta.url), 'utf8'));
  // the Classic adapter's own renderTools (its line in desktop.js, run): false without titlebar.render, never a throw
  const tools = services => adapterProp(src, 'renderTools: (frame, slot) =>', { window: { WizAppServices: services } }).renderTools;
  for (const s0 of [undefined, {}, { titlebar: {} }]) assert.equal(tools(s0)('f', 's'), false, JSON.stringify(s0));
  const seen = []; assert.equal(tools({ titlebar: { render: (...a) => (seen.push(a), true) } })('f', 's'), true); assert.deepEqual(seen, [['f', 's']]);
});

// One property of the desktop shell's host adapter (a single line in desktop.js), run as an object literal in `scope`.
function adapterProp(src, head, scope) {
  const at = src.indexOf(head); assert.ok(at >= 0, head);
  const line = src.slice(at, src.indexOf('\n', at)).replace(/,\s*$/, '');
  return vm.runInNewContext(`({ ${line} })`, scope);
}

test('placement containers: the host hands a layout frozen { desk, node, shown } rows from the shell adapter, never its markup', () => {
  const f = fixture(); assert.deepEqual(JSON.parse(JSON.stringify(f.host.placements())), [], 'no adapter placements: none');
  const a = { id: 'desk-a' }, b = { id: 'desk-b' };
  f.adapter.placements = () => [{ desk: 0, node: a, shown: true }, { desk: NaN, node: b, shown: 0 }, { desk: 2, node: null, shown: true }, null];
  const rows = f.host.placements();
  assert.ok(Object.isFrozen(rows) && rows.every(Object.isFrozen));
  assert.equal(rows.length, 2, 'rows without a container are dropped');
  assert.equal(rows[0].node, a); assert.equal(rows[0].desk, 0); assert.equal(rows[0].shown, true);
  assert.equal(rows[1].node, b); assert.equal(rows[1].desk, null, 'an unnumbered container never matches a desk'); assert.equal(rows[1].shown, false);
  // the Classic adapter is where the shell's own container markup is read
  const desktop = read('web/desktop/desktop.js');
  const doc = createDocument(); doc.body.innerHTML = '<div id="stage"><div class="wsp" data-ws="0"></div><div class="hud"></div><div class="wsp" data-ws="1" hidden></div></div>';
  const stage = doc.querySelector('#stage'), got = adapterProp(desktop, 'placements: () =>', { stage }).placements();
  assert.deepEqual(JSON.parse(JSON.stringify(got.map(r => [r.desk, r.node.className, r.shown]))), [[0, 'wsp', true], [1, 'wsp', false]], 'each desk container, its number and whether it shows');
  const ai = read('web/layouts/ai-apps/desktop.js');
  assert.doesNotMatch(ai, /dataset\.ws\b|#stage|\.wsp\b/, 'AI apps reads placement only from the host');
});
