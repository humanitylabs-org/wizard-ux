import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = f => fs.readFileSync(new URL(f, import.meta.url), 'utf8');
const OURS = ['obsidian', 'obsidian-light', 'landscapes', 'landscapes-light'];
const JAMES = ['nebula', 'grove', 'tide', 'ember', 'signal'];

// Evaluate live.js's chatLayout() in isolation with a given skin and stored choice.
function layoutFor(skin, stored, groupSwitch = false) {
  const src = read('../web/live.js');
  const start = src.indexOf("  const LAYOUT_KEY = 'wos.chats.layout.v1';");
  const end = src.indexOf('  const archiveAfterDays');
  assert.ok(start > 0 && end > start, 'chatLayout block found');
  const ctx = { document: { documentElement: { dataset: { skin } } }, localStorage: { getItem: () => stored }, ...(groupSwitch ? { getComputedStyle: () => ({ getPropertyValue: k => k === '--wos-chats-group-switch' ? ' on' : '' }) } : {}) };
  vm.createContext(ctx);
  return vm.runInContext(src.slice(start, end) + '; chatLayout()', ctx);
}

test('our skins always list chats by status (Working, Ready, Archive), whatever was stored', () => {
  for (const s of OURS) for (const v of [null, 'day', 'status']) assert.equal(layoutFor(s, v), 'status', `${s}/${v}`);
});

test('with the Group by day switch tweak, every skin follows the stored choice; our skins still start by status', () => {
  for (const s of OURS) { assert.equal(layoutFor(s, null, true), 'status', s); assert.equal(layoutFor(s, 'day', true), 'day', s); assert.equal(layoutFor(s, 'status', true), 'status', s); }
  for (const s of JAMES) { assert.equal(layoutFor(s, null, true), 'day', s); assert.equal(layoutFor(s, 'status', true), 'status', s); }
});

test("James's skins keep the stored layout and the By day default", () => {
  for (const s of JAMES) {
    assert.equal(layoutFor(s, null), 'day', s);
    assert.equal(layoutFor(s, 'day'), 'day', s);
    assert.equal(layoutFor(s, 'status'), 'status', s);
  }
});

test('our skins drop the Layout picker and the Yesterday filter', () => {
  const src = read('../web/core/chats.js');
  assert.match(src, /\$\{ourSkin\(\) \|\| LIVE\.groupSwitch \? '' : `<h5>Layout<\/h5>/);
  assert.match(src, /statusEntries = \(\) => Object\.entries\(STATUS\)\.filter\(\(\[k\]\) => !\(k === 'yesterday' && \['obsidian', 'obsidian-light', 'landscapes', 'landscapes-light'\]/);
  assert.doesNotMatch(src, /Object\.entries\(STATUS\)\.map/, 'every status list goes through statusEntries');
});

test('on our skins, leaving a desk returns its Chats window to the session list', () => {
  const src = read('../web/app.js');
  const go = src.slice(src.indexOf('  function goDesk(n, silent) {'), src.indexOf('  function announce(html) {'));
  assert.match(go, /if \(moved && from && \['obsidian', 'obsidian-light', 'landscapes', 'landscapes-light'\]\.includes\(document\.documentElement\.dataset\.skin \|\| ''\)\) for \(const id of from\.wins\) \{ const w = W\[id\]; if \(w\?\.app === 'chats' && w\.thread && !to\.wins\.includes\(id\) && !openedFrom\(to, id\)\) chatsBack\(w\); \}/);
  // A link opened from the chat (its own desk, or a bound review view) must not throw the chat back to the list.
  assert.match(src, /const openedFrom = \(desk, chatId\) => !!desk && desk\.wins\.some\(x => W\[x\]\?\.from\?\.win === chatId \|\| W\[x\]\?\.bound === chatId\);/);
});
