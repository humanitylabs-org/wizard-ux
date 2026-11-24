// The app panel on the left (wizard-os#639, switch wizard/app-panel-left, off by default). The pane model keeps the
// owner's choice per device (appSide); the geometry puts the app at the start of the main area and a docked chat
// after it, while the sidebar and the open-apps column stay where they are. Browser proof: tests/qa-desktop-app-panel-left.cjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import { withWebParts } from './fixtures/web-parts.mjs';
const read = p => withWebParts(fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8'));
const load = (storage) => { const c = vm.createContext({ localStorage: storage }); vm.runInContext(read('web/core/pane-layout.js'), c); return c.WizCore.panes; };
const plain = o => JSON.parse(JSON.stringify(o));
const p = load(), viewport = { width: 1440, height: 900 };
const ID = 'wizard/app-panel-left';

test('appSide defaults to end and only "start" is kept', () => {
  assert.equal(p.normalize({}).appSide, 'end');
  assert.equal(p.normalize({ appSide: 'start' }).appSide, 'start');
  for (const v of ['left', 'END', 1, null]) assert.equal(p.normalize({ appSide: v }).appSide, 'end');
});

test('appSide end is the arrangement as before, for every case', () => {
  for (const chatOn of [false, true]) for (const extra of [{}, { ratio: '1/3' }, { mode: 'pair' }, { mode: 'centre' }]) {
    const env = { appOn: true, chatOn, appWidth: 560, sideWidth: 288, dockWidth: 200 };
    assert.deepEqual(plain(p.geometry({ ...extra, appSide: 'end' }, viewport, env)), plain(p.geometry(extra, viewport, env)));
  }
});

test('appSide start: the app next to the sidebar, a chat after it, sidebar and dock unchanged', () => {
  for (const chatOn of [false, true]) {
    const env = { appOn: true, chatOn, appWidth: 560, sideWidth: 288, dockWidth: 200 };
    const before = p.geometry({}, viewport, env), g = p.geometry({ appSide: 'start' }, viewport, env);
    assert.deepEqual(plain(g.sidebar), plain(before.sidebar)); assert.deepEqual(plain(g.dock), plain(before.dock));
    assert.equal(g.panes.app.x, g.content.x); assert.equal(g.panes.app.width, before.panes.app.width);
    if (chatOn) {
      assert.equal(g.panes.chats.x, g.panes.app.x + g.panes.app.width);
      assert.equal(g.panes.chats.x + g.panes.chats.width, g.content.x + g.content.width);
    }
  }
  // explicit ratios and Side by side put the chat last too
  for (const model of [{ ratio: '1/3' }, { mode: 'pair' }]) {
    const g = p.geometry({ ...model, appSide: 'start' }, viewport, { appOn: true, chatOn: true, sideWidth: 288, dockWidth: 200 });
    assert.ok(g.panes.app.x + g.panes.app.width <= g.panes.chats.x, JSON.stringify(plain(g.panes)));
    assert.equal(g.panes.app.x, g.content.x);
  }
});

test('the choice is saved on this device and survives a reload', () => {
  const store = new Map(), storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  const a = load(storage);
  a.set({ appSide: 'start' });
  assert.equal(JSON.parse(store.get(a.KEY)).appSide, 'start');
  assert.equal(load(storage).get().appSide, 'start');
  a.set({ mode: 'pair' }); assert.equal(a.get().appSide, 'start', 'other changes keep it');
});

test('switch: listed, off by default, linked to its issue, CSS scoped to it', () => {
  const cat = JSON.parse(read('web/tweaks/catalog.json'));
  assert.ok(cat.tweaks.includes(ID)); assert.ok(!cat.defaults.includes(ID));
  const man = JSON.parse(read('web/tweaks/wizard/app-panel-left/manifest.json'));
  assert.equal(man.id, ID); assert.deepEqual(man.issues, ['humanitylabs-org/wizard-os#639']);
  const css = read('web/tweaks/wizard/app-panel-left/tweak.css').replace(/\/\*[\s\S]*?\*\//g, '').replace(/@keyframes[^{]*\{[^{}]*\{[^}]*\}\s*\}/g, '');
  for (const rule of css.split('}').map(r => r.trim()).filter(Boolean)) for (const sel of rule.split('{')[0].split(',')) assert.match(sel.trim(), /^html\[data-tweaks~="wizard\/app-panel-left"\]\[data-shell="desktop"\]\[data-layout="ai-apps"\]\[data-aad-app-side="start"\]/);
});

test('AI apps view: the saved side counts only while the switch is on and the window is wide', () => {
  const js = read('web/layouts/ai-apps/desktop.js');
  assert.match(js, /const leftOn = \(\) => \{ try \{ return String\(root\.dataset\.tweaks \|\| ''\)\.split\(' '\)\.includes\('wizard\/app-panel-left'\)/);
  const src = js.slice(js.indexOf('  const appSideOf = '), js.indexOf('\n', js.indexOf('  const appSideOf = ')));
  const appSideOf = (on, narrow) => vm.runInContext(src + '; appSideOf', vm.createContext({ leftOn: () => on, one: () => narrow }));
  assert.equal(appSideOf(true, false)({ appSide: 'start' }), 'start');
  assert.equal(appSideOf(false, false)({ appSide: 'start' }), 'end', 'switch off: the panel stays on the right');
  assert.equal(appSideOf(true, true)({ appSide: 'start' }), 'end', 'narrow one-app window: the usual layout');
  assert.equal(appSideOf(true, false)({ appSide: 'end' }), 'end');
  assert.match(js, /panes\.geometry\(\{ \.\.\.m, appSide: appSideOf\(m\),/);
  assert.match(js, /if \(sh && code === 'KeyM' && leftOn\(\) && !one\(\)\) return once\(flipAppSide\);/);
});
