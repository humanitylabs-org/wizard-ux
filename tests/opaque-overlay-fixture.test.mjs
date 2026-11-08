import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('../tools/qa-opaque-overlays.cjs',import.meta.url),'utf8');
test('nested opacity fixture keeps production ancestry but normalizes only geometry',()=>{
  assert.match(source,/name:'share-option'.*wrap:'wz-share dv-wrap open'.*middle:'dv-picker'/);
  assert.match(source,/<div data-qa-middle class=/);
  const rule=source.match(/\[data-qa-middle\]\s*\{([^}]*)\}/)?.[1];
  assert.ok(rule);assert.match(rule,/inset:0!important/);
  assert.doesNotMatch(rule,/background|opacity|filter|color|border/);
  assert.match(source,/test:test.name,box:b,clip/);
  assert.match(source,/translate:none!important;rotate:none!important;scale:1!important/);
});
test('opacity browser closes even if a screenshot or assertion fails',()=>{
  assert.match(source,/finally\s*\{\s*await browser.close\(\)/);
  assert.match(source,/opaque:over.equals\(bare\)/);
  assert.match(source,/assert.equal\(failed.length,0/);
});
