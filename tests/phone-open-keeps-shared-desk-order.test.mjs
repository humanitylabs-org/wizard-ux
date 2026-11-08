// Phone: opening an app that is already open moves its desk beside Home (James, 11 Oct 2026). With workspace sync
// on, desk order is shared, so that move reshuffled every device (Miguel, 1 Nov 2026: Backup and Calendar kept
// landing on desktops 1 and 2). With sync on the phone now goes to the desk where it is; without sync, unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const syncSrc = fs.readFileSync(new URL('../web/core/workspace-sync.js', import.meta.url), 'utf8');
const features = fs.readFileSync(new URL('../web/core/features.js', import.meta.url), 'utf8');
const grab = (re, what) => { const m = app.match(re); assert.ok(m, `${what} not found in app.js`); return m[0]; };
const helper = grab(/const sharedDeskOrder = [^\n]+\n  function insertPos\(\) \{[^\n]+\n/, 'sharedDeskOrder + insertPos');
const bring = grab(/function bringBeside\(id\) \{[\s\S]*?\n  \}\n/, 'bringBeside');

function phone(sync) {
  const ctx = {
    window: { WosWorkspaceSync: sync === undefined ? undefined : { current: sync } },
    idx: 0,
    desks: [{ id: 'home', home: true, wins: [] }, { id: 'd1', wins: ['w1'] }, { id: 'd2', wins: ['w2'] }, { id: 'd3', wins: ['w3'] }],
  };
  vm.runInNewContext(`
    function deskOf(id) { return desks.findIndex(d => d.wins.includes(id)); }
    function syncDesks() {} function save() {} function renderDesk() {}
    function blank(o) { return { id: 'dn', wins: [], focus: null, full: false, ...o }; }
    ${helper}${bring}
    this.bringBeside = bringBeside; this.insert = () => desks.splice(insertPos(), 0, blank({ wins: ['wn'] })); this.order = () => desks.map(d => d.id);`, ctx);
  return ctx;
}

test('without workspace sync the phone still brings an open app beside Home', () => {
  const p = phone(undefined); p.bringBeside('w3');
  assert.deepEqual(p.order(), ['home', 'd3', 'd1', 'd2']);
  const off = phone({ on: false, ok: null }); off.bringBeside('w3');
  assert.deepEqual(off.order(), ['home', 'd3', 'd1', 'd2']);
});

test('with workspace sync on the phone leaves the shared desk order alone', () => {
  for (const ok of [true, false, null]) { // in sync, or offline with edits still to send
    const p = phone({ on: true, ok }); p.bringBeside('w3');
    assert.deepEqual(p.order(), ['home', 'd1', 'd2', 'd3']);
  }
});

test('with workspace sync on a new app opens on a new desk at the end, not beside Home', () => {
  const p = phone({ on: true, ok: true }); p.insert();
  assert.deepEqual(p.order(), ['home', 'd1', 'd2', 'd3', 'dn']);
  const off = phone(undefined); off.insert();
  assert.deepEqual(off.order(), ['home', 'dn', 'd1', 'd2', 'd3']);
});

test('the box with a confirmed absent sync API keeps the old phone behaviour', () => {
  const p = phone({ on: true, ok: null, absent: true }); p.bringBeside('w3');
  assert.deepEqual(p.order(), ['home', 'd3', 'd1', 'd2']);
});

test('why it matters: a phone-only reorder is replayed onto every device by the sync merge', () => {
  const sb = { console, JSON, Map, Set, Math, Date, setTimeout() {}, clearTimeout() {}, addEventListener() {}, navigator: { userAgent: 'iPhone' }, localStorage: { getItem: () => null, setItem() {} } };
  vm.runInNewContext(features, { window: sb }); sb.window = sb; vm.runInNewContext(syncSrc, sb);
  const D = (id, appId) => ({ id, wins: [{ id: 'w' + id, app: 'frame', appId }] });
  const box = { desks: [D('a', 'messenger'), D('b', 'money'), D('c', 'backup')] };
  const phoneMoved = { desks: [D('c', 'backup'), D('a', 'messenger'), D('b', 'money')] };
  assert.deepEqual(sb.WosWorkspaceSync.merge(box, phoneMoved, box).desks.map(d => d.id), ['c', 'a', 'b']);
});
