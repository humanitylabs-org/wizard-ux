import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const c = vm.createContext({});
vm.runInContext(fs.readFileSync(new URL('../web/core/pane-layout.js', import.meta.url), 'utf8'), c);
const p = c.WizCore.panes, plain = o => JSON.parse(JSON.stringify(o));
const viewport = { width: 1440, height: 900 }, env = { appOn: true, chatOn: true, appWidth: 576 };
test('mode normalization upgrades legacy saves without changing tiled geometry', () => {
  assert.equal(p.normalize({ ratio: '1/3' }).mode, 'tiled');
  assert.equal(p.normalize({ mode: 'unknown', focus: 'missing' }).mode, 'tiled');
  assert.equal(p.normalize({ mode: 'unknown', focus: 'missing' }).focus, 'chats');
  for (const W of [800, 1280, 1440, 1920]) for (const ratio of [null, '1/3', '2/3']) {
    const v = { width: W, height: 900 }, state = { ratio };
    assert.deepEqual(plain(p.geometry({ ...state, mode: 'tiled' }, v, env)), plain(p.geometry(state, v, env)));
  }
});
test('centre is capped, centred and inset; full fills stage and hides rails', () => {
  const g = p.geometry({ mode: 'centre' }, viewport, env);
  assert.deepEqual(plain(g.panes.chats), { x: 300, y: 32, width: 840, height: 836 });
  assert.equal(g.panes.app.width, 0); assert.equal(g.dock.width, 200); assert.equal(g.sidebar.width, 288);
  const full = p.geometry({ mode: 'full', focus: 'app', dock: { insets: { start: 10, end: 20, top: 30, bottom: 40 } } }, viewport, env);
  assert.deepEqual(plain(full.panes.app), { x: 10, y: 30, width: 1410, height: 830 });
  assert.equal(full.panes.chats.width, 0); assert.equal(full.dock.width, 0); assert.equal(full.sidebar.width, 0);
});
test('pair selects two active slots and reuses ratio presets with exact shared seam', () => {
  for (const ratio of ['1/2', '1/3', '2/3']) for (const side of ['start', 'end']) {
    const g = p.geometry({ mode: 'pair', ratio, side, slots: ['chats', 'app', 'app2'], weights: { chats: 10 } }, viewport, { ...env, app2On: true });
    assert.equal(g.panes.chats.width, Math.round(g.content.width * p.PRESETS[ratio]));
    assert.equal(g.panes.app2.width, 0);
    const boxes = [g.panes.chats, g.panes.app].sort((a,b) => a.x-b.x);
    assert.equal(boxes[0].x, g.content.x); assert.equal(boxes[0].x + boxes[0].width, boxes[1].x);
    assert.equal(boxes[1].x + boxes[1].width, g.content.x + g.content.width);
  }
  const g = p.geometry({ mode: 'pair', focus: 'app2', slots: ['app', 'chats', 'app2'] }, viewport, { ...env, app2On: true });
  assert.ok(g.panes.app2.width > 0); assert.ok(g.panes.app.width > 0); assert.equal(g.panes.chats.width, 0);
});
test('non-tiled modes clamp on tiny viewports and unavailable focus falls back', () => {
  for (const mode of ['centre', 'pair', 'full']) for (const width of [0, 1, 127, 320, 801]) for (const height of [0, 1, 200, 600]) {
    const g = p.geometry({ mode, focus: 'app2' }, { width, height }, env);
    for (const b of [...Object.values(g.panes), g.sidebar, g.dock]) {
      for (const n of Object.values(b)) assert.ok(Number.isFinite(n) && n >= 0);
      assert.ok(b.x + b.width <= width + 1e-8); assert.ok(b.y + b.height <= height + 1e-8);
    }
  }
  for (const mode of ['centre', 'full']) {
    assert.ok(p.geometry({ mode, focus: 'app2' }, viewport, env).panes.chats.width > 0);
    const appOnly = p.geometry({ mode, focus: 'chats', slots: ['app'] }, viewport, env);
    assert.ok(appOnly.panes.app.width > 0); assert.equal(appOnly.panes.chats.width, 0);
    const empty = p.geometry({ mode }, viewport, {});
    assert.ok(Object.values(empty.panes).every(b => b.width === 0 && b.height === 0));
  }
});
test('mode switching persists and notifies, then restores exact previous tiled ratios', () => {
  const map = new Map(), storage = { getItem: k => map.get(k), setItem: (k,v) => map.set(k,v) };
  const a = p.create(storage); let calls = 0; a.subscribe(() => calls++);
  a.set({ ratio: '2/3', side: 'end', weights: { chats: 2, app: 3 }, dock: { edge: 'start' } });
  const before = plain(a.get()), boxes = plain(a.geometry(before, viewport, env));
  for (const mode of ['centre', 'pair', 'full']) {
    a.set({ mode }); assert.equal(p.create(storage).get().mode, mode);
    a.set({ mode: 'tiled' }); assert.deepEqual(plain(a.get()), before);
    assert.deepEqual(plain(a.geometry(a.get(), viewport, env)), boxes);
  }
  assert.equal(calls, 7);
});
