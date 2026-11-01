import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = f => fs.readFileSync(new URL(f, import.meta.url), 'utf8');
const OURS = ['obsidian', 'obsidian-light', 'landscapes', 'landscapes-light'];
const JAMES = ['nebula', 'grove', 'tide', 'ember', 'signal'];

// Evaluate live.js's chatLayout() in isolation with a given skin and stored choice.
function layoutFor(skin, stored) {
  const src = read('../web/live.js');
  const start = src.indexOf("  const LAYOUT_KEY = 'wos.chats.layout.v1';");
  const end = src.indexOf('  const archiveAfterDays');
  assert.ok(start > 0 && end > start, 'chatLayout block found');
  const ctx = { document: { documentElement: { dataset: { skin } } }, localStorage: { getItem: () => stored } };
  vm.createContext(ctx);
  return vm.runInContext(src.slice(start, end) + '; chatLayout()', ctx);
}

test("James's skins keep the stored layout and the By day default", () => {
  for (const s of JAMES) {
    assert.equal(layoutFor(s, null), 'day', s);
    assert.equal(layoutFor(s, 'day'), 'day', s);
    assert.equal(layoutFor(s, 'status'), 'status', s);
  }
});
