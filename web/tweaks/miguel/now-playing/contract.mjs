import assert from 'node:assert/strict';
// Minimal Now playing: the package only holds the shell's media watcher and ships the css for the bars the AI apps
// view draws on a playing app's icon. It mounts nothing anywhere (no pill, no list, no top-bar control), playing or not.
export default async function check(f) {
  assert.ok(f.doc.head.children.some(n => n.href?.endsWith('now-playing/tweak.css')));
  const slotted = () => ['dock-end', 'home-top', 'list-top', 'composer-end', 'thread-header-actions', 'thread-switch-row-end', 'bar-start']
    .reduce((n, k) => n + (f.doc.body.querySelector(`[data-slot="${k}"]`)?.children.length || 0), 0);
  const dock = f.doc.body.querySelector('[data-slot="dock-end"]');
  const subs = new Set();
  let items = [];
  const push = l => { items = l; for (const fn of [...subs]) fn(items); };
  f.ctx.window.WosMedia = { watch(fn) { subs.add(fn); fn(items); return () => subs.delete(fn); }, list: () => items, pause: () => true, play: () => true, pauseAll: () => true, toggle: () => true };
  await f.mount('miguel/now-playing');
  assert.equal(subs.size, 1, 'watching while on (so the view hears what plays)');
  assert.equal(dock.children.length, 0, 'idle: nothing in the page');
  push([{ key: 'm:1', appId: 'music', kind: 'audio', playing: true, at: 2, title: 'Song', artist: '' }]);
  assert.equal(dock.children.length, 0, 'playing: still no pill in the bar'); assert.equal(slotted(), 0, 'nor in any slot');
  push([]);
  await f.clear(); assert.equal(subs.size, 0, 'teardown stops watching'); assert.equal(f.doc.head.children.length, 0);
  // the phone: the same (the AI apps view draws the bars on its Home icons); still nothing mounted in any slot
  f.doc.documentElement.dataset.shell = 'phone'; await f.mount('miguel/now-playing');
  assert.equal(subs.size, 1, 'phone: watching while on');
  push([{ key: 'm:1', appId: 'music', kind: 'audio', playing: true, at: 2, title: 'Song', artist: '' }]);
  assert.equal(slotted(), 0, 'phone: no pill, no chrome inside an app'); push([]);
  await f.clear(); assert.equal(subs.size, 0, 'phone teardown stops watching'); f.doc.documentElement.dataset.shell = 'desktop';
  delete f.ctx.window.WosMedia;
}
