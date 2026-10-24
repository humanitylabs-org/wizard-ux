import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const js = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../web/core/chats.css', import.meta.url), 'utf8');

test('Chats list has no pull-to-refresh gesture or indicator (it refreshes itself)', () => {
  assert.ok(!/bindPull|pullRefresh|ptrState|ch-ptr|Pull to refresh/.test(js), 'no pull gesture in chats.js');
  assert.ok(!/\.ch-ptr/.test(css), 'no pull indicator styles');
});

test('the "Not up to date" bar stays', () => {
  assert.match(js, /<b>Not up to date<\/b>/);
});
