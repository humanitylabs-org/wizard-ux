import { modelContext, runWithChatsModel } from './fixtures/chats-list-model.mjs';
// Skins are colours only (2 Nov 2026: Miguel's old Mizel layout is retired). The chat list layout, its Layout picker
// and Yesterday filter, and what Chats shows when you come back to its desk are the same on every skin.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { withParts } from './fixtures/chats-parts.mjs'; // chats.js parts moved out verbatim (issue 1665)
import { retryWithStubs } from './fixtures/source-slice.mjs';
import { withLiveParts } from './fixtures/live-parts.mjs'; // live.js parts moved out verbatim (issue 1665)
import { withShellParts } from './fixtures/shell-parts.mjs';

const read = f => withShellParts(fs.readFileSync(new URL(f, import.meta.url), 'utf8'));
const SKINS = ['obsidian', 'obsidian-light', 'landscapes', 'landscapes-light', 'nebula', 'grove', 'tide', 'ember', 'signal'];

// Evaluate live.js's chatLayout() in isolation with a given skin and stored choice.
function layoutFor(skin, stored, groupSwitch = false) {
  const src = withLiveParts(read('../web/live.js'));
  const start = src.indexOf("  const LAYOUT_KEY = 'wos.chats.layout.v1';");
  const end = src.indexOf('  const archiveAfterDays');
  assert.ok(start > 0 && end > start, 'chatLayout block found');
  const ctx = { document: { documentElement: { dataset: { skin, tweaks: 'miguel/layout miguel/model-pills' } } }, localStorage: { getItem: () => stored }, ...(groupSwitch ? { getComputedStyle: () => ({ getPropertyValue: k => k === '--wos-chats-group-switch' ? ' on' : '' }) } : {}) };
  modelContext(ctx);
  return vm.runInContext(src.slice(start, end) + '; chatLayout()', ctx);
}

test('every skin keeps the stored layout and the By day default (an old miguel/layout switch changes nothing)', () => {
  for (const s of SKINS) {
    assert.equal(layoutFor(s, null), 'day', s);
    assert.equal(layoutFor(s, 'day'), 'day', s);
    assert.equal(layoutFor(s, 'status'), 'status', s);
  }
});

test('the Filter sheet always offers the Yesterday filter (its Layout picker went with the Channels switch, issue 1258)', () => {
  const src = withParts(read('../web/core/chats.js'));
  assert.doesNotMatch(src, /<h5>Layout<\/h5>/, 'Channels are on for everyone: the Filter sheet has no Layout picker');
  // the real statusEntries: every status filter (Yesterday included); Snoozed drops out only while snooze sorts last
  const i = src.indexOf('statusEntries = () =>'), line = src.slice(i, src.indexOf(';', i) + 1);
  const STATUS = { errors: {}, working: {}, ready: {}, yesterday: {}, deferred: {} };
  const keys = last => vm.runInNewContext(`(() => { const ${line} return statusEntries().map(([k]) => k); })()`, { STATUS, snoozeLast: () => last, Object });
  assert.deepEqual([...keys(false)], ['errors', 'working', 'ready', 'yesterday', 'deferred']);
  assert.deepEqual([...keys(true)], ['errors', 'working', 'ready', 'yesterday']);
  assert.doesNotMatch(src, /Object\.entries\(STATUS\)\.map/, 'every status list goes through statusEntries');
});

test('leaving a desk keeps its Chats window on the open thread', () => {
  // the real goDesk (app-desks.js) with a Chats window open on a thread on desk 1, then a move to desk 2
  const desks = fs.readFileSync(new URL('../web/app-desks.js', import.meta.url), 'utf8');
  const go = desks.slice(desks.indexOf('  function goDesk('), desks.indexOf('  function announce(html) {'));
  const env = retryWithStubs(names => {
    const W = { c1: { id: 'c1', app: 'chats', thread: 't9' } }, calls = [];
    const ctx = { appVars: { idx: 1, desks: [{ home: true, wins: [] }, { wins: ['c1'] }, { wins: ['x'] }], W, sheet: null },
      CHATS: { beforeNavigate: () => true, CH: { c1: {} }, setFilter() {} }, window: {}, HOME: 0,
      chatsBack: () => calls.push('chatsBack'), threadBack: () => calls.push('threadBack') };
    for (const n of names) ctx[n] = () => {};
    vm.createContext(ctx); vm.runInContext(`${go}\nthis.goDesk = goDesk;`, ctx);
    return { ctx, W, calls, run: () => ctx.goDesk(2) };
  });
  const { ctx: deskWorld, W, calls } = env;
  assert.equal(deskWorld.appVars.idx, 2);
  assert.equal(W.c1.thread, 't9', 'the Chats window is still on its thread');
  assert.deepEqual(calls, []);
});
