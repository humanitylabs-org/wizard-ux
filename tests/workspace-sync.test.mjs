// Workspace sync (core/workspace-sync.js): per-desk three-way merge and reconcile onto a device's own desks.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const features = fs.readFileSync(new URL('../web/core/features.js', import.meta.url), 'utf8');
const src = fs.readFileSync(new URL('../web/core/workspace-sync.js', import.meta.url), 'utf8');
function load() {
  const sb = { console, JSON, Map, Set, Math, Date, setTimeout() {}, clearTimeout() {}, addEventListener() {}, navigator: { userAgent: 'iPhone' }, localStorage: { getItem: () => null, setItem() {} } };
  vm.runInNewContext(features, { window: sb });
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
  assert.deepEqual(plain(S.norm({ desks: [D('retired', { id: 'old-review', app: 'review' }, { id: 'old-maps', app: 'maps' }, app('old-system', 'system'), { id: 'old-command', app: 'feature', featureId: 'command' })] })).desks, []);
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
  const retired = S.reconcile([], {}, { desks: [D('retired', { id: 'old-review', app: 'review' }, app('old-system', 'system'))] }, { fresh: id => ({ id, wins: [] }) });
  assert.deepEqual(plain(retired.desks), [], 'old box checkpoints cannot revive removed views');
});

// Client sync loop against a fake box: per-shell checkpoints and offline edits that survive a reload.
function client(store, box, shell, desks) {
  const sb = { console, JSON, Map, Set, Math, Date, Promise, Error, Event: class {}, document: { hidden: false },
    navigator: { userAgent: 'iPhone' }, addEventListener() {}, dispatchEvent() {}, setTimeout: (f, ms) => (ms > 1000 ? 0 : setTimeout(f, 0)), clearTimeout,
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)) },
    fetch: async (url, o = {}) => box.handle(url, o) };
  vm.runInNewContext(features, { window: sb });
  sb.window = sb; vm.runInNewContext(src, sb);
  const st = { desks };
  const api = sb.WosWorkspaceSync.create({ shell, read: () => st, apply: (s) => { if (s) st.desks = s.desks.map(d => ({ id: d.id, wins: d.wins })); } });
  return { api, st };
}
function fakeBox() {
  const box = { rev: 0, state: { desks: [] }, online: true, puts: 0,
    async handle(url, o) {
      if (!box.online) throw new Error('offline');
      const body = o.body ? JSON.parse(o.body) : null;
      if (o.method === 'PUT') { box.puts++; if (body.baseRev !== box.rev) return res(409, box.snap()); box.rev++; box.state = JSON.parse(JSON.stringify(body.state)); return res(200, box.snap()); }
      if (/wait=[1-9]/.test(url)) await new Promise(r => setTimeout(r, 20)); // a long-poll waits; never spin
      return res(200, box.snap());
    },
    snap() { return { rev: box.rev, state: box.state, closed: [], device: '', at: '' }; } };
  const res = (status, j) => ({ status, json: async () => JSON.parse(JSON.stringify(j)) });
  return box;
}
const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));
async function settle(cond, n = 100) { for (let i = 0; i < n && !cond(); i++) await tick(); }

test('phone and desktop on one origin keep separate checkpoints', async () => {
  const store = new Map(), box = fakeBox();
  const desk = client(store, box, 'desktop', [D('a', chats('w1'))]);
  await settle(() => box.rev >= 1); desk.api.stop();
  const keys = [...store.keys()].filter(k => k.startsWith('wos.wsync.v2.'));
  assert.deepEqual(keys, ['wos.wsync.v2.desktop']);
  // The phone joins later from the same browser: it starts from its own (empty) checkpoint and never pushes stale
  // desktop-era edits over the box.
  const phone = client(store, box, 'phone', [D('p', chats('w9'))]);
  await settle(() => phone.st.desks.some(d => d.id === 'a')); phone.api.stop();
  assert.deepEqual(plain(box.state.desks.map(d => d.id)), ['a']);
  assert.ok(store.has('wos.wsync.v2.phone'));
});

test('an edit made offline survives a reload and is pushed when the box answers', async () => {
  const store = new Map(), box = fakeBox();
  const one = client(store, box, 'phone', [D('a', chats('w1'))]);
  await settle(() => box.rev >= 1); await tick(100); one.api.stop();
  box.online = false;
  // Offline: open a desk, then the page reloads before it reconnects.
  const saved = [D('a', chats('w1')), D('b', app('w2', 'files'))];
  // Meanwhile another device changed something else on the box.
  box.state = { desks: [D('a', chats('w1')), D('c', app('w3', 'wisdom'))] }; box.rev = 2;
  box.online = true;
  const two = client(store, box, 'phone', saved);
  await settle(() => box.state.desks.some(d => d.id === 'b')); await tick(100); two.api.stop();
  assert.deepEqual(plain(box.state.desks.map(d => d.id)).sort(), ['a', 'b', 'c']);
  assert.deepEqual(plain(two.st.desks.map(d => d.id)).sort(), ['a', 'b', 'c']);
});
