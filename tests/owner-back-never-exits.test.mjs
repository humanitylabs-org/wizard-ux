// James: Back never exits, including the browser shell (not only native Android).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const src = fs.readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
test('James: browser Back consumes one nested layer, then repeated root Back stays home', () => {
  const body = src.slice(src.indexOf('  function onBack() {'), src.indexOf('  function makeWatcher('));
  const steps = ['settings-page', 'sheet', 'thread', 'home', null, null, null];
  const notices = [], window = {}, ctx = { window, backStep: () => steps.shift(), toast: (...a) => notices.push(a) };
  vm.runInNewContext(body + '\nthis.back = onBack;', ctx);
  assert.deepEqual(Array.from({ length: 7 }, () => ctx.back()), ['settings-page', 'sheet', 'thread', 'home', 'root', 'root', 'root']);
  assert.deepEqual([...window.__backLog], ['settings-page', 'sheet', 'thread', 'home', 'root', 'root', 'root']);
  assert.equal(notices.length, 3);
  assert.doesNotMatch(body, /history\.(?:back|go)|disarmAll|dropGuard|exitUntil/);
  assert.doesNotMatch(src, /Press back again to exit|second Back: leave/);
});
