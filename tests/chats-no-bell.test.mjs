import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The Notifications unread count lives on the app's dock/bar badge; the Chats panel carries no second bell.
test('Chats top row renders no Notifications bell', () => {
  const js = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
  assert.doesNotMatch(js, /WosBell\?\.html\(/);
  const css = readFileSync(new URL('../web/core/chats.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /\.ch-bell/);
});

test('Notifications count still feeds the app badge', () => {
  const js = readFileSync(new URL('../web/core/notif-bell.js', import.meta.url), 'utf8');
  assert.match(js, /workspaceNav\?\.setCount\('notifications', S\.unread\)/);
});
