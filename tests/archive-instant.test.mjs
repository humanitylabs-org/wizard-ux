// Archive and other one-tap list actions paint on the tap's own frame, never after the backend (James, 7 Nov 2026).
// The browser proof is tests/qa-archive-instant.cjs (held backend, stale poll, failure restore; phone + desktop, two skins).
// Runs it when QA_PLAYWRIGHT points at a playwright module; the tests below run the real code in a vm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
const live = readFileSync(new URL('../web/live.js', import.meta.url), 'utf8');
const read = p => readFileSync(new URL('../web/' + p, import.meta.url), 'utf8');
const cut = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i + 1); assert.ok(i >= 0 && j > i, a); return src.slice(i, j); };

test('threadAct starts the write, paints every list, and only then awaits', async () => {
  // The real row actions part (core/chats-rowacts.js) with a held backend write.
  const log = [], W = { w1: { id: 'w1', thread: null } }, CH = { w1: {} };
  let settle; const window = { WizCore: {} };
  vm.runInNewContext(read('core/chats-rowacts.js'), { window });
  const part = window.WizCore.chatsParts.rowacts({ ACT: { done: {}, file: {}, restore: {} }, actRestore() {}, actUndo: null, BOOM: () => null, ch: () => ({}), CH, closeRowSheet() {},
    followUpActive: () => false, H: { changed: () => log.push('changed') }, keepThreadOpen: () => true, leaveFinishedThread() {}, markDone() {}, notifAct() {}, openChannelSheet() {}, openRowSheet() {},
    LIVE: { archive: sid => { log.push('write:' + sid); return new Promise(r => { settle = r; }); } }, owner: w => w, paintListsNow: () => log.push('paint'), rowOf: () => ({ id: 's1', title: 'T' }),
    threadBack() {}, toast: (i, t) => log.push('toast:' + t), vib() {}, W });
  part.bindLate({ renderChats: x => log.push('render:' + x.id) });
  const p = part.threadAct('w1', 's1', 'done');
  assert.deepEqual(log, ['toast:Archived', 'write:s1', 'paint'], 'the write starts and every list paints on the tap itself');
  await Promise.resolve();
  assert.deepEqual(log.slice(3), [], 'nothing else until the backend answers');
  settle(true); await p;
  assert.deepEqual(log.slice(3), ['render:w1', 'changed']);
  // The forced paint is never held by an open sheet or a finger mid-press (core/chats-bind.js holdList).
  const hold = vm.runInNewContext(cut(read('core/chats-bind.js'), '  const holdList = id => {', '  // Back / Esc:') + '\nholdList', {
    chatVars: { paintForced: true, rowSheet: { wid: 'w1' } }, elOf: () => null, PW: null, ch: () => ({}), readingIn: () => false });
  assert.equal(hold('w1'), false);
});

test('Archive row action in the AI apps sidebar repaints before its 120 ms pass', () => {
  const src = read('layouts/ai-apps/desktop.js');
  const log = [], clicks = [], later = [];
  const el = () => ({ style: {}, classList: { add() {}, remove() {} }, append() {}, remove() {}, querySelector: () => null, hasAttribute: () => false });
  const ctx = vm.createContext({ ACTS: [['done', 'Archive']], icon: () => ({}), el, scene: { append() {} }, globalThis: {},
    api: { listen: (n, t, fn) => clicks.push(fn), after: (ms, fn) => later.push([ms, fn]), back: { push: () => () => {} }, sessions: { act: (id, k) => log.push('act:' + id + ':' + k) } },
    readSessions: () => log.push('read'), paintList: f => log.push('paint:' + f) });
  vm.runInContext(cut(src, '  let menu = null, offMenuBack = null;', '  function closeMenu() {') + '\nfunction closeMenu() { log.push("close"); }\nthis.openMenu = openMenu;', Object.assign(ctx, { log }));
  ctx.openMenu({ getBoundingClientRect: () => ({ right: 300, bottom: 40, top: 0 }), classList: { add() {} } }, { id: 's1', title: 'T', actions: ['done'] });
  later.length = 0; log.length = 0;
  clicks[0]();
  assert.deepEqual(log, ['close', 'act:s1:done', 'read', 'paint:true'], 'the row goes on this frame');
  assert.equal(later.length, 1); assert.equal(later[0][0], 120);
  later[0][1](); assert.deepEqual(log.slice(4), ['read', 'paint:true'], 'the later pass reconciles');
});

test('a write that never answers cannot pin a thread out of its list', async () => {
  // The real LIVE._act and archive (web/live.js) with fake timers: the write is held forever.
  const timers = [];
  const src = cut(live, '    busy(id) {', '    // Stop exactly the watcher');
  const s = { id: 's1', archived: false };
  const ctx = { OVER: new Map(), timers, hasNew: () => false, setTimeout: (fn, ms) => (timers.push([ms, fn]), timers.length), clearTimeout() {} };
  const L = vm.runInNewContext(`({ session: () => S, emit() {}, refresh() {}, seenOf() {},\n${src} })`, Object.assign(ctx, { S: s }));
  const p = L._act('s1', { archived: true }, () => new Promise(() => {}), 60000);
  assert.equal(s.archived, true, 'out of the list at once');
  const cap = timers.find(([ms]) => ms === 60000); assert.ok(cap);
  cap[1]();
  assert.equal(await p, false); assert.equal(s.archived, false, 'restored to its list'); assert.equal(L.busy('s1'), false, 'the next tap is not blocked');
  // Close & file polls for up to 10 minutes: its cap outlasts that.
  const caps = []; L._act = (id, patch, write, ms) => (caps.push(ms), Promise.resolve(true));
  L.archive('s1'); L.archive('s1', { file: true });
  assert.deepEqual(caps, [60000, 11 * 60000]);
});
test('browser regression (held backend, stale poll, failure)', { skip: !process.env.QA_PLAYWRIGHT }, () => {
  const r = spawnSync(process.execPath, [new URL('./qa-archive-instant.cjs', import.meta.url).pathname], { encoding: 'utf8', env: { ...process.env, QA_SKINS: 'nebula' } });
  assert.equal(r.status, 0, r.stdout.slice(-3000));
});
