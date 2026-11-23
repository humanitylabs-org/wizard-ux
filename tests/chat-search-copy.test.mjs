// The chat-list field describes search while the dedicated plus starts chats. Rendered by the real Chats list
// (tests/fixtures/chats-list-render.mjs runs renderChatList from web/core/chats.js; wizard-ux issue 1674).
import test from 'node:test';
import assert from 'node:assert/strict';
import { listFixture } from './fixtures/chats-list-render.mjs';

const field = html => /<input data-chsearch placeholder="([^"]*)" aria-label="([^"]*)"/.exec(html)?.slice(1);

test('the chat-list field describes search while the dedicated plus starts chats', () => {
  const f = listFixture();
  const html = f.render('');
  assert.deepEqual(field(html), ['Search chats and messages', 'Search chats and messages']);
  assert.doesNotMatch(html, /type to start a chat/i);
  assert.match(html, /<button type="button" class="ch-fab" data-chnew data-chfab aria-label="New chat">/);
  // With a status filter on, the field searches within it.
  f.ctx.STATUS.errors = { label: 'Errors', test: () => true };
  f.state.filter = 'errors';
  assert.equal(field(f.render(''))[0], 'Search within');
});
