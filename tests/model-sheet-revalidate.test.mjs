import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Opening the model sheet must refetch the catalogue (a newly entitled model like Astra appears without a
// Wizard reload) and repaint only when the list actually changed.
test('model sheet revalidates the catalogue on every open', () => {
  const src = readFileSync(new URL('../web/core/chat-power.js', import.meta.url), 'utf8');
  const open = src.slice(src.indexOf("openSheet({ type: 'model'"), src.indexOf('function openFiles'));
  assert.match(open, /M\.load\(M\.ready\)/, 'forces a refresh once the cache is warm');
  assert.doesNotMatch(open, /if \(!M\.ready\) M\.load\(\)/, 'no longer loads only on a cold cache');
  assert.match(open, /key\(\) !== before/, 'repaints only on change');
  const key = new Function('M', `return (${open.match(/const key = (.*);/)[1]})();`);
  const M = { options: [{ value: 'first', provider: 'fixture', isGlobalDefault: true }], privateOptions: () => [] };
  const before = key(M); // options is the documented array, never a function
  assert.equal(key(M), before);
  M.options.push({ value: 'second', provider: 'fixture' });
  assert.notEqual(key(M), before, 'new catalogue rows trigger repaint');
});
