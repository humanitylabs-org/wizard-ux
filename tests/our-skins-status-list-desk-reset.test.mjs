import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = f => fs.readFileSync(new URL(f, import.meta.url), 'utf8');
const OURS = ['obsidian', 'obsidian-light', 'landscapes'];
const JAMES = ['nebula', 'grove', 'tide', 'ember', 'signal'];

// Evaluate live.js's chatLayout() in isolation with a given skin and stored choice.
function layoutFor(skin, stored, mine = OURS.includes(skin)) {
  const src = read('../web/live.js');
  const start = src.indexOf("  const LAYOUT_KEY = 'wos.chats.layout.v1';");
  const end = src.indexOf('  const archiveAfterDays');
  assert.ok(start > 0 && end > start, 'chatLayout block found');
  const ctx = { document: { documentElement: { dataset: mine ? { skin, mine: '' } : { skin } } }, localStorage: { getItem: () => stored } };
  vm.createContext(ctx);
  return vm.runInContext(src.slice(start, end) + '; chatLayout()', ctx);
}

test('my release always lists chats by status (Working, Ready, Archive) on every skin, whatever was stored', () => {
  for (const s of OURS.concat(JAMES)) for (const v of [null, 'day', 'status']) assert.equal(layoutFor(s, v, true), 'status', `${s}/${v}`);
});

test("without the release layer every skin keeps the stored layout and the By day default", () => {
  for (const s of OURS.concat(JAMES)) {
    assert.equal(layoutFor(s, null, false), 'day', s);
    assert.equal(layoutFor(s, 'day', false), 'day', s);
    assert.equal(layoutFor(s, 'status', false), 'status', s);
  }
});

test('my release drops the Layout picker and the Yesterday filter', () => {
  const src = read('../web/core/chats.js');
  assert.match(src, /\$\{mine\(\) \? '' : `<h5>Layout<\/h5>/);
  assert.match(src, /statusEntries = \(\) => Object\.entries\(STATUS\)\.filter\(\(\[k\]\) => !\(k === 'yesterday' && document\.documentElement\.dataset\.mine != null\)\)/);
  assert.doesNotMatch(src, /Object\.entries\(STATUS\)\.map/, 'every status list goes through statusEntries');
});

test('with my release, leaving a desk returns its Chats window to the session list', () => {
  const src = read('../web/app.js');
  const go = src.slice(src.indexOf('  function goDesk(n, silent) {'), src.indexOf('  function announce(html) {'));
  assert.match(go, /if \(moved && from && myRelease\(\)\) for \(const id of from\.wins\) \{ const w = W\[id\]; if \(w\?\.app === 'chats' && w\.thread && !to\.wins\.includes\(id\) && !openedFrom\(to, id\)\) chatsBack\(w\); \}/);
  // A link opened from the chat (its own desk, or a bound review view) must not throw the chat back to the list.
  assert.match(src, /const openedFrom = \(desk, chatId\) => !!desk && desk\.wins\.some\(x => W\[x\]\?\.from\?\.win === chatId \|\| W\[x\]\?\.bound === chatId\);/);
});
