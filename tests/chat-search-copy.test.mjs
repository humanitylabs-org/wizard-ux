import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');

test('the chat-list field describes search while the dedicated plus starts chats', () => {
  assert.match(source, /const ph = filtered \? 'Search within' : 'Search chats and messages';/);
  assert.doesNotMatch(source, /type to start a chat/i);
  assert.match(source, /data-chfab aria-label=/);
});
