// Workspace sync (core/workspace-sync.js): per-desk three-way merge and reconcile onto a device's own desks.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../web/core/workspace-sync.js', import.meta.url), 'utf8');
function load() {
  const sb = { console, JSON, Map, Set, Math, Date, setTimeout() {}, clearTimeout() {}, addEventListener() {}, navigator: { userAgent: 'iPhone' }, localStorage: { getItem: () => null, setItem() {} } };
  sb.window = sb; vm.runInNewContext(src, sb); return sb.WosWorkspaceSync;
}
const S = load();
const chats = id => ({ id, app: 'chats' }), app = (id, appId) => ({ id, app: 'frame', appId });
const D = (id, ...wins) => ({ id, wins });
const plain = x => JSON.parse(JSON.stringify(x));

test('an edit here and a different edit on another device both survive', () => {
  const base = { desks: [D('a', chats('w1')), D('b', app('w2', 'files'))] };
  const local = { desks: [D('a', chats('w1')), D('b', app('w2', 'files')), D('c', app('w3', 'wisdom'))] }; // opened here
  const remote = { desks: [D('a', chats('w1'))] };                                                        // b closed there
  assert.deepEqual(plain(S.merge(base, local, remote)).desks.map(d => d.id), ['a', 'c']);
});

test('closing a desk here closes it on the box; a desk changed elsewhere meanwhile is kept', () => {
  const base = { desks: [D('a', chats('w1')), D('b', app('w2', 'files'))] };
  assert.deepEqual(plain(S.merge(base, { desks: [D('a', chats('w1'))] }, base)).desks.map(d => d.id), ['a']);
  const remote = { desks: [D('a', chats('w1')), D('b', app('w2', 'files'), app('w4', 'notifications'))] };
  assert.deepEqual(plain(S.merge(base, { desks: [D('a', chats('w1'))] }, remote)).desks.map(d => d.id), ['a', 'b']);
});

test('a window moved to another desk here is not duplicated', () => {
  const base = { desks: [D('a', chats('w1'), app('w2', 'files')), D('b', app('w3', 'wisdom'))] };
  const local = { desks: [D('a', chats('w1')), D('b', app('w3', 'wisdom'), app('w2', 'files'))] };
  const out = plain(S.merge(base, local, base));
  assert.deepEqual(out.desks.map(d => [d.id, d.wins.map(w => w.id)]), [['a', ['w1']], ['b', ['w3', 'w2']]]);
});

test('bound views, review peeks and New chat drafts never travel', () => {
  const n = plain(S.norm({ desks: [D('a', { id: 'w1', app: 'chats', thread: '__new__' }, { id: 'w2', app: 'frame', appId: 'x', bound: 's1' }, { id: 'w3', app: 'frame', appId: 'y', from: { sid: 's' } }, { id: 'w4', app: 'usuals' })] }));
  assert.deepEqual(n.desks[0].wins, [{ id: 'w1', app: 'chats' }]);
});

test('reconcile keeps local window objects and layout, adds new desks, closes removed ones, caps per device', () => {
  const W = { w1: { id: 'w1', app: 'chats', thread: 't-here' }, w9: { id: 'w9', app: 'usuals' }, w5: { id: 'w5', app: 'frame', appId: 'files' } };
  const local = [{ id: 'a', wins: ['w1', 'w9'], focus: 'w9', full: true }, { id: 'z', wins: ['w5'], focus: 'w5' }];
  const state = { desks: [D('a', { id: 'w1', app: 'chats', thread: 't-there' }), D('n', app('n1', 'a'), app('n2', 'b'), app('n3', 'c'))] };
  const r = S.reconcile(local, W, state, { fresh: id => ({ id, wins: [], focus: null }), max: 2 });
  assert.deepEqual(plain(r.desks.map(d => [d.id, d.wins])), [['a', ['w1', 'w9']], ['n', ['n1', 'n2']]]);
  assert.equal(W.w1.thread, 't-here', 'an app open here keeps its own page');
  assert.equal(r.desks[0].full, true, 'layout stays per device');
  assert.deepEqual(plain(r.desks[1].more), [{ id: 'n3', app: 'frame', appId: 'c' }], 'over-cap windows stay in the shared copy');
  assert.deepEqual(plain(r.removed), ['w5'], 'desk z was closed on another device');
});
