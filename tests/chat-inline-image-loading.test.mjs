import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
const start = source.indexOf('  function mediaBtn(c, m) {');
const end = source.indexOf('  function mediaBlock(', start);
assert.ok(start >= 0 && end > start, 'exercise the actual shared renderer function');
const mediaBtn = vm.runInNewContext('(' + source.slice(start, end).trim() + ')', { esc:String });
for (const [label, media, expected] of [
  ['inline JPEG', { url:'data:image/jpeg;base64,/9j/AA==' }, 'eager'],
  ['inline PNG', { url:'data:image/png;base64,aGVsbG8=' }, 'eager'],
  ['inline thumbnail', { thumb:'data:image/png;base64,aGVsbG8=', url:'/wizard/files/test/content' }, 'eager'],
  ['Wizard attachment', { url:'/wizard/attachments/abc' }, 'lazy'],
  ['remote photo', { url:'https://example.invalid/photo.jpg' }, 'lazy'],
]) {
  test(`Chats ${label}: ${expected} decoding admission`, () => {
    const state = { media:[] }, image = { kind:'image', name:'Photo', ...media };
    const html = mediaBtn(state, image);
    assert.ok(html.includes(`loading="${expected}"`));
    assert.ok(html.includes(`src="${media.thumb || media.url}"`));
    assert.ok(html.includes('data-mi="0"'));
    assert.equal(state.media[0], image);
  });
}
