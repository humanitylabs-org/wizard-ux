// Turning the browser boundary off and on again (wizard-ux#1434, after #1426 / wizard-os#133). The first turn-on copies
// a key an app wrote from its same-origin window into the app's own copy once (core/browser-boundary.js storeCarry),
// and notes it as carried. If the boundary is later turned off and the app's same-origin page sets or removes that key,
// the next turn-on must pick up that newer value (or the removal); before the fix the carried note skipped it, so the
// copy kept its older value. core/app-services.js marks such a key (lsChanged) and storeCarry copies it once more.
// Real code, sliced into a vm with a stand-in localStorage. Real-Chromium proof: tests/qa-browser-boundary-ls-carry.cjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { keptAppIds, sweepGone } from '../web/store/store-remove.js';

const read = p => fs.readFileSync(new URL('../web/core/' + p, import.meta.url), 'utf8');
const cut = (src, from, to) => {
  const a = src.indexOf(from), b = src.indexOf(to, a + 1);
  assert.ok(a >= 0 && b > a, `slice ${from.slice(0, 40)} .. ${to.slice(0, 40)}`);
  return src.slice(a, b);
};
const BB = read('browser-boundary.js'), AS = read('app-services.js');
const carrySrc = cut(BB, "  const STORE = 'wos.app-storage.v1.'", '  function storeApply(')
  + cut(BB, "  const LS_OWNERS = 'wos.app-ls-owners.v1'", "  // What a new app window starts with")
  + cut(BB, '  const readJson = k =>', '  async function idbCarry(');
const noteSrc = cut(AS, "  const LS_OWNERS = 'wos.app-ls-owners.v1'", "  // The page's localStorage.setItem notes the key");

function storage() {
  const m = new Map();
  return {
    m, get length() { return m.size; }, key: i => [...m.keys()][i] ?? null,
    full: false, getItem: k => (m.has(k) ? m.get(k) : null), removeItem: k => m.delete(k), clear: () => m.clear(),
    setItem(k, v) { if (this.full && k === 'wos.app-ls-changed.v1') throw new Error('QuotaExceededError'); m.set(k, String(v)); },
  };
}
// One device: the same localStorage; the shell tab with the boundary on (storeCarry) and one with it off (an app's
// same-origin page writes; the shell notes it). Each new tab is a fresh vm, like a reload.
function device() {
  const ls = storage();
  const onTab = () => { const c = vm.createContext({ localStorage: ls, JSON, Set, Map, Object, Array }); vm.runInContext(carrySrc + '\nthis.storeCarry = storeCarry;', c); return c; };
  const offTab = () => {
    const c = vm.createContext({ window: { localStorage: ls }, JSON, Set, Map, Object, Array });
    vm.runInContext(noteSrc + '\nthis.set = (app, k, v) => { window.localStorage.setItem(k, v); noteLs(app, k); lsChanged(app, k); };'
      + '\nthis.remove = (app, k) => { window.localStorage.removeItem(k); lsChanged(app, k); };'
      + '\nthis.clear = app => lsCleared(app, () => window.localStorage.clear());', c);
    return c;
  };
  const copy = id => JSON.parse(ls.getItem('wos.app-storage.v1.' + id) || '{}');
  const inBoundary = (id, o) => ls.setItem('wos.app-storage.v1.' + id, JSON.stringify({ ...copy(id), ...o }));
  return { ls, onTab, offTab, copy, inBoundary };
}

test('off -> change -> on: a value the app set again while the boundary was off wins over the older copy', () => {
  const d = device();
  // Boundary off: Music saves its volume and a recording, Other its own key.
  let off = d.offTab();
  off.set('music', 'wizard-music.volume', '7'); off.set('music', 'wizard-music.recording', 'cafe'); off.set('other', 'other.k', 'mine');
  // On: the first copy.
  assert.equal(d.onTab().storeCarry('music'), true);
  assert.deepEqual(d.copy('music'), { 'wizard-music.volume': '7', 'wizard-music.recording': 'cafe' });
  // Under the boundary Music changes its volume in its own copy.
  d.inBoundary('music', { 'wizard-music.volume': '8' });
  // Off again (a new tab): Music's same-origin page sets the volume and removes the recording.
  off = d.offTab();
  off.set('music', 'wizard-music.volume', '3');
  off.remove('music', 'wizard-music.recording');
  assert.deepEqual(JSON.parse(d.ls.getItem('wos.app-ls-changed.v1')), { music: ['wizard-music.volume', 'wizard-music.recording'] });
  // On again: the newer values come along.
  assert.equal(d.onTab().storeCarry('music'), true);
  assert.deepEqual(d.copy('music'), { 'wizard-music.volume': '3' }, 'the volume set while off, the removal too');
  assert.equal(d.ls.getItem('wos.app-ls-changed.v1'), null, 'the change note is used up');
  // Nothing changed while off since: the app's own newer value under the boundary wins again.
  d.inBoundary('music', { 'wizard-music.volume': '9' });
  assert.equal(d.onTab().storeCarry('music'), false);
  assert.equal(d.copy('music')['wizard-music.volume'], '9');
  assert.deepEqual(d.copy('other'), {}, 'Other was never opened with the boundary on: nothing copied for it yet');
});

test('only keys already copied are marked, never the shell\u2019s own keys, a shared key or another app\u2019s', () => {
  const d = device();
  let off = d.offTab();
  off.set('music', 'm.k', '1'); off.set('music', 'shared.k', 'a'); off.set('other', 'shared.k', 'b');
  d.onTab().storeCarry('music');
  off = d.offTab();
  off.set('music', 'm.new', 'x');          // never copied: the next copy takes it as it is then
  off.set('music', 'wos.theme', 'dark');   // a shell key
  off.set('music', 'shared.k', 'c');       // two apps wrote it: never copied
  off.set('other', 'm.k', 'z');            // another app's window
  assert.equal(d.ls.getItem('wos.app-ls-changed.v1'), null);
  d.onTab().storeCarry('music');
  assert.deepEqual(d.copy('music'), { 'm.k': '1', 'm.new': 'x' }, 'm.k now has two writers: left as copied');
});

test('a change while off waits for room and is not lost', () => {
  const d = device();
  let off = d.offTab();
  off.set('music', 'big', 'a');
  d.onTab().storeCarry('music');
  off = d.offTab();
  off.set('music', 'big', 'x'.repeat(600 * 1024));   // more than one app's copy may hold
  assert.equal(d.onTab().storeCarry('music'), false);
  assert.equal(d.copy('music').big, 'a');
  assert.deepEqual(JSON.parse(d.ls.getItem('wos.app-ls-changed.v1')), { music: ['big'] }, 'tried again next time');
  d.offTab().set('music', 'big', 'b');
  assert.equal(d.onTab().storeCarry('music'), true);
  assert.equal(d.copy('music').big, 'b');
});

// The first review finding on #1427: an app that only kept same-origin settings, removed some other way (the agent,
// another device) before the boundary was ever on, had no shell copy, so the sweep never saw it and its notes stayed.
test('remove before the boundary is on, then reinstall: the old installation\u2019s settings are never copied over', async () => {
  const d = device(), now = 1_800_000_000_000, day = 864e5;
  const off = d.offTab();
  off.set('ledger', 'ledger.theme', 'dark'); off.set('cards', 'cards.k', '1');
  assert.deepEqual([...await keptAppIds({ storage: d.ls, idb: undefined })].sort(), ['cards', 'ledger'], 'the owner notes count as kept data');
  // Ledger is gone from the box's list: 2 reads a day apart.
  assert.deepEqual(await sweepGone(['cards'], { storage: d.ls, now, idb: undefined }), []);
  assert.deepEqual(await sweepGone(['cards'], { storage: d.ls, now: now + day, idb: undefined }), ['ledger']);
  assert.deepEqual(JSON.parse(d.ls.getItem('wos.app-ls-owners.v1')), { 'cards.k': { app: 'cards' } });
  assert.equal(d.ls.getItem('ledger.theme'), 'dark', 'the old key itself stays (the boundary off shows it as before)');
  // Reinstalled under the same id, then the boundary is turned on: the new installation starts empty.
  assert.equal(d.onTab().storeCarry('ledger'), false);
  assert.deepEqual(d.copy('ledger'), {});
  assert.equal(d.onTab().storeCarry('cards'), true, 'a listed app keeps its settings');
  assert.deepEqual(d.copy('cards'), { 'cards.k': '1' });
});

test('a removed app\u2019s carried and changed notes go too, and keep it on the kept list until they do', async () => {
  const d = device(), now = 1_800_000_000_000, day = 864e5;
  d.ls.setItem('wos.app-ls-carried.v1', JSON.stringify({ ledger: ['a'], cards: ['b'] }));
  d.ls.setItem('wos.app-ls-changed.v1', JSON.stringify({ ledger: ['a'] }));
  d.ls.setItem('wos.app-idb-owners.v1', JSON.stringify({ 'notes-db': { app: 'notes' }, shared: { app: '' } }));
  assert.deepEqual([...await keptAppIds({ storage: d.ls, idb: undefined })].sort(), ['cards', 'ledger', 'notes']);
  await sweepGone(['cards'], { storage: d.ls, now, idb: undefined });
  assert.deepEqual((await sweepGone(['cards'], { storage: d.ls, now: now + day, idb: undefined })).sort(), ['ledger', 'notes']);
  assert.deepEqual(JSON.parse(d.ls.getItem('wos.app-ls-carried.v1')), { cards: ['b'] });
  assert.equal(d.ls.getItem('wos.app-ls-changed.v1'), null);
  assert.deepEqual(JSON.parse(d.ls.getItem('wos.app-idb-owners.v1')), { shared: { app: '' } });
  assert.deepEqual([...await keptAppIds({ storage: d.ls, idb: undefined })], ['cards']);
});

// Codex P2s on this PR: localStorage.clear() while off, and a change note that could not be written (storage full).
test('off -> clear() -> on: the reset comes along, and the shell\u2019s notes survive the clear', () => {
  const d = device();
  let off = d.offTab();
  off.set('music', 'a', '1'); off.set('music', 'b', '2'); off.set('other', 'o', '3');
  d.onTab().storeCarry('music'); d.onTab().storeCarry('other');
  off = d.offTab();
  off.clear('music');
  assert.deepEqual(JSON.parse(d.ls.getItem('wos.app-ls-changed.v1')), { music: ['a', 'b'] });
  assert.deepEqual(JSON.parse(d.ls.getItem('wos.app-ls-carried.v1')), { music: ['a', 'b'], other: ['o'] });
  off.set('music', 'b', 'new');
  assert.equal(d.onTab().storeCarry('music'), true);
  assert.deepEqual(d.copy('music'), { b: 'new' });
  // A same-origin clear() wipes the whole origin, the shell's copies too (as before this change): nothing comes back.
  assert.deepEqual(d.copy('other'), {});
  assert.equal(d.onTab().storeCarry('other'), false);
});

test('a change note that could not be written is tried again on the next write in the same tab', () => {
  const d = device();
  let off = d.offTab();
  off.set('music', 'a', '1');
  d.onTab().storeCarry('music');
  off = d.offTab();
  d.ls.full = true; off.set('music', 'a', '2'); d.ls.full = false;
  assert.equal(d.ls.getItem('wos.app-ls-changed.v1'), null);
  off.set('music', 'a', '3');
  assert.deepEqual(JSON.parse(d.ls.getItem('wos.app-ls-changed.v1')), { music: ['a'] });
  d.onTab().storeCarry('music');
  assert.equal(d.copy('music').a, '3');
});
