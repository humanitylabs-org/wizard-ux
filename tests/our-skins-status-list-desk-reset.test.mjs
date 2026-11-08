import { modelContext, runWithChatsModel } from './fixtures/chats-list-model.mjs';
// Skins are colours only (2 Nov 2026: Miguel's old Mizel layout is retired). The chat list layout, its Layout picker
// and Yesterday filter, and what Chats shows when you come back to its desk are the same on every skin.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = f => fs.readFileSync(new URL(f, import.meta.url), 'utf8');
const SKINS = ['obsidian', 'obsidian-light', 'landscapes', 'landscapes-light', 'nebula', 'grove', 'tide', 'ember', 'signal'];

// Evaluate live.js's chatLayout() in isolation with a given skin and stored choice.
function layoutFor(skin, stored, groupSwitch = false) {
  const src = read('../web/live.js');
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

test('the Filter sheet always offers the Layout picker and the Yesterday filter', () => {
  const src = read('../web/core/chats.js');
  assert.match(src, /\$\{LIVE\.groupSwitch \? '' : `<h5>Layout<\/h5>/);
  assert.match(src, /statusEntries = \(\) => Object\.entries\(STATUS\)\.filter\(\(\[k\]\) => !\(snoozeLast\(\) && k === 'deferred'\)\);/);
  assert.doesNotMatch(src, /Object\.entries\(STATUS\)\.map/, 'every status list goes through statusEntries');
});

test('leaving a desk keeps its Chats window on the open thread', () => {
  const src = read('../web/app.js');
  const go = src.slice(src.indexOf('  function goDesk('), src.indexOf('  function announce(html) {'));
  assert.ok(go.length > 100, 'goDesk found');
  assert.doesNotMatch(go, /chatsBack\(/);
});
