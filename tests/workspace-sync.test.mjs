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
function client(store, box, shell, desks, options = {}) {
  const events = new Map();
  const listen = (type, fn) => { if (!events.has(type)) events.set(type, new Set()); events.get(type).add(fn); };
  const unlisten = (type, fn) => events.get(type)?.delete(fn);
  const sb = { console, JSON, Map, Set, Math, Date, Promise, Error, AbortController, Event: class {}, document: { hidden: false, addEventListener: listen, removeEventListener: unlisten },
    navigator: { userAgent: options.ua || 'iPhone' }, addEventListener: listen, removeEventListener: unlisten, dispatchEvent() {}, setTimeout: (f, ms) => (ms > 1000 ? 0 : setTimeout(f, 0)), clearTimeout,
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)) },
    fetch: async (url, o = {}) => box.handle(url, o) };
  vm.runInNewContext(features, { window: sb });
  sb.window = sb; vm.runInNewContext(src, sb);
  const st = { desks };
  const api = sb.WosWorkspaceSync.create({ shell, read: () => st, apply: (s) => { if (s) st.desks = s.desks.map(d => ({ id: d.id, wins: d.wins })); } });
  return { api, st, document: sb.document, event: type => { for (const fn of events.get(type) || []) fn(); } };
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


test('two phones share open apps after the second phone resumes from its hidden wait', async () => {
  const box = fakeBox(), a = client(new Map(), box, 'phone', [D('chats', chats('chat'))]), b = client(new Map(), box, 'phone', []);
  try {
    await settle(() => b.st.desks.some(d => d.id === 'chats'));
    b.document.hidden = true;
    // A response received while hidden enters the 15s wait (held indefinitely by this test's clock).
    await tick(60);
    a.st.desks.push(D('notes', app('note', 'notes'))); a.api.changed();
    await settle(() => box.state.desks.some(d => d.id === 'notes'));
    assert.equal(b.st.desks.some(d => d.id === 'notes'), false);
    b.document.hidden = false; b.event('visibilitychange');
    await tick(80);
    assert.equal(b.st.desks.some(d => d.id === 'notes'), true, 'resume must not wait for the hidden-page timer');
  } finally { a.api.stop(); b.api.stop(); }
});

test('two phones share open apps even when a restored box reuses the checkpoint revision', async () => {
  const box = fakeBox(); box.rev = 12; box.state = { desks: [D('notes', app('note', 'notes'))] };
  const stale = { desks: [D('old', app('old-win', 'files'))] };
  const store = new Map([['wos.wsync.v2.phone', JSON.stringify({ rev: 12, base: stale, last: stale })]]);
  const phone = client(store, box, 'phone', stale.desks);
  try {
    await tick(80);
    assert.deepEqual(plain(phone.st), box.state, 'same revision is not proof of the same saved state');
    assert.equal(box.puts, 0, 'an unchanged stale checkpoint must not overwrite the restored box');
  } finally { phone.api.stop(); }
});

test('resume aborts a suspended poll and online interrupts retry backoff without adding readers', async () => {
  const box = fakeBox(), handle = box.handle;
  let active = 0, peak = 0, aborted = 0;
  box.handle = (url, o) => {
    if (/wait=[1-9]/.test(url) && o.method !== 'PUT') {
      active++; peak = Math.max(peak, active);
      return new Promise((resolve, reject) => o.signal.addEventListener('abort', () => { active--; aborted++; reject(new Error('aborted')); }, { once: true }));
    }
    return handle(url, o);
  };
  const phone = client(new Map(), box, 'phone', []);
  try {
    await settle(() => active === 1);
    box.rev++; box.state = { desks: [D('notes', app('note', 'notes'))] };
    phone.event('resume'); phone.event('focus'); phone.event('pageshow');
    await tick(80);
    assert.equal(phone.st.desks[0]?.id, 'notes'); assert.equal(aborted, 1); assert.equal(peak, 1);
    box.online = false; phone.event('online'); await tick(60);
    assert.equal(phone.api.ok, false);
    box.online = true; box.rev++; box.state = { desks: [D('files', app('file', 'files'))] };
    phone.event('online'); await tick(80);
    assert.equal(phone.st.desks[0]?.id, 'files', 'online cancels the failure backoff');
  } finally { phone.api.stop(); }
  assert.equal(active, 0);
});

test('a delayed GET cannot roll back the baseline of a completed local PUT', async () => {
  const box = fakeBox(), handle = box.handle;
  let release;
  box.handle = (url, o) => {
    if (/wait=[1-9]/.test(url) && o.method !== 'PUT') {
      const snapshot = plain(box.snap());
      return new Promise((resolve, reject) => {
        release = () => resolve({ status: 200, json: async () => snapshot });
        o.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    }
    return handle(url, o);
  };
  const phone = client(new Map(), box, 'phone', []);
  try {
    await settle(() => !!release);
    phone.st.desks.push(D('notes', app('note', 'notes'))); phone.api.changed();
    await settle(() => box.rev === 1);
    const afterPut = phone.api.rev; release(); await tick(60);
    assert.equal(phone.api.rev, afterPut);
    assert.equal(phone.st.desks[0]?.id, 'notes');
  } finally { phone.api.stop(); }
});

test('Android phone names include the model or a stable per-device short name', () => {
  const box = fakeBox();
  for (const model of ['Pixel 10 Pro XL', 'SM-S938B']) {
    const p = client(new Map(), box, 'phone', [], { ua: `Mozilla/5.0 (Linux; Android 16; ${model} Build/BP2A; wv)` });
    assert.equal(p.api.name, model); p.api.stop();
  }
  const store = new Map(), ua = 'Mozilla/5.0 (Linux; Android 10; K)';
  const one = client(store, box, 'phone', [], { ua }); const name = one.api.name; one.api.stop();
  const two = client(store, box, 'phone', [], { ua });
  assert.match(name, /^Android [a-z0-9]{6}$/); assert.equal(two.api.name, name); two.api.stop();
});
