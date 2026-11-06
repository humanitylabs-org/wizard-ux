import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { fixture, read } from './fixtures/tweaks.mjs';

const key = 'wos.layout-fault.v1';
test('layout callback threshold preserves the stack AND the owner navigation (never disables layouts)', async () => {
  const f = fixture({ shell: 'desktop', initialStorage: { 'wos.desktop-view.v1': 'ai-apps' } });
  await f.host.whenLayoutReady();
  const errors = []; f.ctx.console = { warn() {}, error: (...args) => errors.push(args) };
  let tornDown = 0, healthy = 0, failing = true;
  f.host._test.setImporter(async () => ({ default: api => {
    api.mount(f.doc.createElement('aside'));
    api.on('render', () => { if (failing) throw new Error('late layout hook failed'); healthy++; });
    api.on('render', () => { healthy++; });
    return () => { tornDown++; };
  } }));
  await f.host._test.loadLayout('ai-apps');
  for (let i = 0; i < 20; i++) f.host.rendered('thread', f.thread);
  const record = JSON.parse(f.lsMap.get(key));
  assert.equal(record.layout, 'ai-apps'); assert.equal(record.reason, 'callback-error');
  assert.match(record.stack, /late layout hook failed/); assert.match(record.where, /render/);
  assert.equal(f.host.layoutState.active, true); assert.equal(f.host.layoutState.disabled, false);
  assert.equal(f.host.layoutState.mounts, 1); assert.equal(f.host.chatsClaimed(), true);
  assert.equal(tornDown, 0); assert.equal(healthy, 20, 'healthy hooks still run');
  failing = false; f.host.rendered('thread', f.thread);
  assert.equal(healthy, 22, 'the failing hook can recover on a later render');
  assert.equal(f.toasts.filter(t => t.includes('turned off')).length, 0);
  assert.ok(errors.some(args => args[0] === '[layout] callback-error:'));
  assert.equal(f.lsMap.get('wos.desktop-view.v1'), 'ai-apps');
  const reload = fixture({ shell: 'desktop', initialStorage: Object.fromEntries(f.lsMap) });
  await reload.host.whenLayoutReady();
  assert.equal(reload.boot.layout, 'ai-apps'); assert.equal(reload.host.layoutState.active, true);
  assert.equal(reload.host.layoutState.disabled, false); assert.equal(reload.host.chatsClaimed(), true);
});
test('rejected async layout hooks are contained without losing later hooks or navigation', async () => {
  const f = fixture({ shell: 'desktop', desktopView: null }); await f.host.whenLayoutReady();
  f.ctx.console = { warn() {}, error() {} };
  let calls = 0;
  f.host._test.setImporter(async () => ({ default: api => {
    api.on('render', async () => { throw new Error('async hook failed'); });
    api.on('render', () => { calls++; });
  } }));
  await f.host._test.loadLayout('ai-apps');
  for (let i = 0; i < 10; i++) f.host.rendered('thread', f.thread);
  await new Promise(r => setTimeout(r, 0));
  assert.equal(calls, 10); assert.equal(f.host.layoutState.active, true);
  assert.equal(f.host.layoutState.disabled, false);
  assert.match(JSON.parse(f.lsMap.get(key)).stack, /async hook failed/);
});
test('import failure is diagnosable and a normal switch cannot erase the last failure', async () => {
  const f = fixture({ shell: 'desktop', desktopView: null }); await f.host.whenLayoutReady();
  f.ctx.console = { warn() {}, error() {} };
  f.host._test.setImporter(async () => { throw new Error('chunk unavailable'); });
  await f.host._test.loadLayout('ai-apps');
  let rec = JSON.parse(f.lsMap.get(key));
  assert.equal(rec.reason, 'load-failed'); assert.equal(rec.where, 'import');
  assert.match(rec.stack, /chunk unavailable/);
  f.host._test.setImporter(async () => ({ default: () => () => {} }));
  await f.host._test.loadLayout('ai-apps'); await f.host._test.loadLayout('ai-apps');
  rec = JSON.parse(f.lsMap.get(key)); assert.equal(rec.reason, 'switch');
  assert.match(rec.lastFault.stack, /chunk unavailable/);
});
test('blocked diagnostic storage never prevents layout cleanup', async () => {
  const f = fixture({ shell: 'desktop', desktopView: null }); await f.host.whenLayoutReady();
  f.ctx.localStorage.setItem = () => { throw new Error('storage blocked'); };
  f.ctx.console = { warn() {}, error() {} };
  await f.host._test.loadLayout('ai-apps');
  assert.equal(f.host.layout, 'ai-apps');
});
test('tweak disposal never writes the layout diagnostic', async () => {
  const f = fixture(); await f.host.whenLayoutReady();
  assert.equal(f.lsMap.has(key), false, 'Classic has no layout module; it is not a load failure');
  f.host._test.setImporter(async () => ({ default: () => () => {} }));
  await f.mount('wizard/pin-buttons'); assert.ok(f.host.tweakState.includes('wizard/pin-buttons'), JSON.stringify(f.toasts)); await f.clear();
  assert.equal(f.lsMap.has(key), false);
});

test('AI apps render parts isolate session refresh from pane tools/chrome', () => {
  const src = read('web/layouts/ai-apps/desktop.js');
  const start = src.indexOf("  api.on('render', readSessions);");
  assert.ok(start >= 0, 'session refresh is an independent guarded render part');
  const code = src.slice(start, src.indexOf("  api.on('home'", start));
  const hooks = []; let chrome = 0;
  vm.runInNewContext(code, { api: { on: (name, fn) => hooks.push(fn) }, readSessions: () => { throw new Error('session refresh fault'); }, paintTop: () => chrome++ });
  assert.equal(hooks.length, 2);
  for (let i = 0; i < 12; i++) for (const hook of hooks) { try { hook(); } catch (_) {} }
  assert.equal(chrome, 12, 'pane chrome still paints while refresh fails persistently');
});

test('iframe focus refusal retries the browser only, not host focus (61 attempts)', () => {
  const src = read('web/layouts/ai-apps/desktop.js');
  const start = src.indexOf('  function focusFrame(');
  const body = src.slice(start, src.indexOf('\n  }', start) + 4);
  const queue = []; let hosted = 0, browser = 0;
  const ctx = { focusWant: 'app', focusing: true, focusGeneration: 0, focusHosted: null, pane: { id: 'app' }, paneFrame: () => frame,
    frameReady: () => true, panelWindow: () => ({ id: 'win' }), doc: { activeElement: null },
    host: { focus: () => { hosted++; } }, api: { after: (ms, fn) => queue.push(fn) } };
  const frame = { focus: () => browser++, contentWindow: { focus() {} } };
  vm.createContext(ctx); vm.runInContext(body + ';focusFrame();', ctx);
  while (queue.length) { assert.ok(browser < 100); queue.shift()(); }
  assert.equal(browser, 61); assert.equal(hosted, 1); assert.equal(ctx.focusWant, '');
  // An already queued retry from the old app must not consume a new request.
  ctx.focusWant = 'app'; ctx.focusing = true; ctx.focusGeneration = 1; ctx.focusHosted = null;
  vm.runInContext('focusFrame(1, 0)', ctx);
  assert.equal(hosted, 1); assert.equal(browser, 61); assert.equal(ctx.focusWant, 'app');
});
test('panel-mode focus updates only the panel front, never Classic desk/save/route', () => {
  const src = read('web/desktop/desktop.js');
  const code = src.slice(src.indexOf('  function focusWin('), src.indexOf('  function focusInside('));
  const calls = [], ctx = { hud: null, WosSkinHost: { panelMode: true }, panelHas: id => id === 'panel',
    panelFrontId: null, cur: 7, focusInside: id => calls.push(['inside', id]), CHATS: { markVisibleThreadsSeen: () => calls.push(['seen']) },
    wsOf: () => { throw new Error('Classic desk lookup'); }, save: () => { throw new Error('Classic save'); },
    goWs: () => { throw new Error('Classic route'); } };
  vm.createContext(ctx); vm.runInContext(code + ';focusWin("panel", {scroll:false});focusWin("hidden");', ctx);
  assert.equal(ctx.panelFrontId, 'panel'); assert.equal(ctx.cur, 7); assert.deepEqual(calls, [['seen']]);
});

test('adapter focus in an active layout never navigates/saves Classic; panel and Classic retain their own focus', () => {
  const src = read('web/desktop/desktop.js');
  const code = src.slice(src.indexOf('    focus: (id, opts) => {'), src.indexOf('    close: id => { closeWin(id);'));
  for (const layout of ['ai-apps', 'classic']) for (const panelMode of [false, true]) {
    const calls = [], host = { layout, panelMode, layoutState: { active: layout !== 'classic' } };
    const ctx = { WosSkinHost: host, desktopHost: { windows: () => [{ id: 'app', visible: true }] },
      focusInside: id => calls.push(['inside', id]), focusWin: id => calls.push(['classic-or-panel', id]), focused: () => ({ id: 'app' }) };
    const adapter = vm.runInNewContext('({' + code + '})', ctx);
    assert.equal(adapter.focus('app', { scroll: true }), true);
    assert.equal(calls.some(c => c[0] === 'classic-or-panel'), layout === 'classic' || panelMode);
    if (layout === 'ai-apps' && !panelMode) {
      assert.equal(adapter.focus('hidden', { scroll: true }), false);
      assert.deepEqual(calls, [['inside', 'app']]);
    }
  }
});
