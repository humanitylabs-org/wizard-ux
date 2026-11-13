// A reload keeps the app open beside a chat opened from the sidebar (wizard-ux issue 1368). Opening a chat from the
// Activity list puts the Chats desk in front, so the app panel lived only in memory and a reload dropped it. The AI apps
// layout now saves the panel ({ id, desk }) and, with the Chats desk in front at boot, makes that app's desk the panel
// again. Sliced from the real layouts/ai-apps/desktop.js and run in a vm. Browser proof: tests/qa-desktop-reload-app-beside.cjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const js = fs.readFileSync(new URL('../web/layouts/ai-apps/desktop.js', import.meta.url), 'utf8');
const block = (a, b) => { const i = js.indexOf(a), j = js.indexOf(b, i + 1); assert.ok(i >= 0 && j > i, a); return js.slice(i, j); };

function boot(saved, { desks = [{ desk: 0, id: 'chats' }, { desk: 1, id: 'wizard-music' }], drawn = [0, 1] } = {}) {
  const data = saved === undefined ? {} : { beside: JSON.stringify(saved) }, timers = [];
  const ctx = {
    data, timers, pane: null, CHATS: 'chats', drawn: [...drawn], deskList: desks,
    api: { storage: { get: k => (k in data ? JSON.parse(data[k]) : null), set: (k, v) => { data[k] = JSON.stringify(v); } }, after: (ms, fn) => timers.push(fn) },
  };
  vm.createContext(ctx);
  vm.runInContext([
    'var desks = () => deskList;',
    'var onMainChats = r => r.desk === 0;',
    "var placementOf = d => drawn.includes(d) ? { desk: d, isConnected: true } : null;",
    'var painted = 0; var paintTop = () => { painted++; };',
    block('  let besideWant = api.storage.get(', '  function paintSplit(chatOn) {'),
    // paintSplit's own two lines around the panel check, as in the real function
    'this.paint = h => { if (besideWant) { if (pane) besideWant = null; else restoreBeside(h); } if (!besideWant) keepBeside(); return pane; };',
    'this.setPane = p => { pane = p; }; this.paints = () => painted;',
  ].join('\n'), ctx);
  return ctx;
}
const onChats = { app: '', r: { desk: 0, view: 'thread', thread: 'qa-g1' } };
const onApp = { app: 'wizard-music', r: { desk: 1 } };
const plain = v => JSON.parse(JSON.stringify(v));

test('the app beside the chat comes back after a reload with the Chats desk in front', () => {
  const x = boot({ id: 'wizard-music', desk: 1 });
  assert.deepEqual(plain(x.paint(onChats)), { id: 'wizard-music', el: { desk: 1, isConnected: true }, desk: 1 });
  assert.equal(x.data.beside, JSON.stringify({ id: 'wizard-music', desk: 1 }), 'saved again as it was');
});

test('the boot paint never wipes the saved app before it is restored (desk not drawn yet: look again shortly)', () => {
  const x = boot({ id: 'wizard-music', desk: 1 }, { drawn: [0] });
  assert.equal(x.paint(onChats), null);
  assert.equal(x.data.beside, JSON.stringify({ id: 'wizard-music', desk: 1 }), 'still saved while the desk is drawn');
  assert.equal(x.timers.length, 1, 'a repaint is asked for');
  x.drawn.push(1); x.timers.shift()(); assert.equal(x.paints(), 1);
  assert.equal(x.paint(onChats)?.id, 'wizard-music');
});

test('a hidden app stays hidden, and a new panel is saved', () => {
  const x = boot(undefined);
  assert.equal(x.paint(onChats), null);
  assert.equal(x.data.beside, undefined, 'nothing to save: nothing written');
  x.setPane({ id: 'wizard-music', el: {}, desk: 1 }); x.paint(onApp);
  assert.equal(x.data.beside, JSON.stringify({ id: 'wizard-music', desk: 1 }));
  x.setPane(null); x.paint(onChats);
  assert.equal(x.data.beside, 'null', 'Hide (Esc) is saved: the next reload shows the chat alone');
});

test('nothing is forced back when the page opens elsewhere or the app is gone', () => {
  for (const [why, saved, h, opts] of [
    ['an app in front: the route decides', { id: 'wizard-music', desk: 1 }, onApp],
    ['Home in front', { id: 'wizard-music', desk: 1 }, { app: '', r: { desk: 0, home: true } }],
    ['another Chats window in front', { id: 'wizard-music', desk: 1 }, { app: '', r: { desk: 2, view: 'thread' } }],
    ['the app was closed', { id: 'wizard-music', desk: 1 }, onChats, { desks: [{ desk: 0, id: 'chats' }] }],
    ['the Chats desk itself', { id: 'chats', desk: 0 }, onChats],
  ]) {
    const x = boot(saved, opts);
    assert.equal(x.paint(h), null, why);
    assert.equal(x.data.beside, 'null', why + ': cleared once given up');
  }
});

test('a moved desk is found by its app, and a damaged saved value is ignored, never thrown on', () => {
  const moved = boot({ id: 'wizard-music', desk: 4 });
  assert.equal(moved.paint(onChats)?.desk, 1);
  for (const bad of ['x', 3, [], {}, { id: 7 }, { desk: 1 }]) {
    const x = boot(bad);
    assert.equal(x.paint(onChats), null, JSON.stringify(bad));
  }
});

test('another app opened before the restore lands wins, and is the one saved', () => {
  const x = boot({ id: 'wizard-music', desk: 1 }, { desks: [{ desk: 0, id: 'chats' }, { desk: 1, id: 'wizard-music' }, { desk: 2, id: 'pages' }], drawn: [0, 2] });
  assert.equal(x.paint(onChats), null, 'the saved desk is not drawn yet');
  x.setPane({ id: 'pages', el: {}, desk: 2 }); x.paint({ app: 'pages', r: { desk: 2 } });
  assert.equal(x.data.beside, JSON.stringify({ id: 'pages', desk: 2 }));
  x.drawn.push(1); x.paint(onChats);
  assert.equal(x.data.beside, JSON.stringify({ id: 'pages', desk: 2 }), 'the old app never comes back over it');
});

test('gives up after a few tries when the desk is never drawn', () => {
  const x = boot({ id: 'wizard-music', desk: 1 }, { drawn: [0] });
  for (let i = 0; i < 25; i++) x.paint(onChats);
  assert.equal(x.timers.length, 20);
  assert.equal(x.data.beside, 'null');
});
