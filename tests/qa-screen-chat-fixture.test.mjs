import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// This repo is public: the Screen-mode chat fixture must be invented text, never a pasted team conversation.
test('Screen chat QA fixture names no teammates or private setup', () => {
  const src = readFileSync(new URL('../tools/qa-screen-chat.cjs', import.meta.url), 'utf8');
  const msgs = src.slice(src.indexOf('const MSGS'), src.indexOf('];', src.indexOf('const MSGS')));
  assert.ok(msgs.length > 100, 'fixture messages found');
  assert.doesNotMatch(msgs, /Thales|Mac mini|VPS|SSH|tunnel|Archimedes|Miguel|James|Oscar|datacenter/i);
});
