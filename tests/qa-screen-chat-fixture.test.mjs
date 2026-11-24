import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// This repo is public: the Screen-mode chat fixture must be invented text, never a pasted team conversation.
test('Screen chat QA fixture names no teammates or private setup', () => {
  const src = readFileSync(new URL('../tools/qa-screen-chat.cjs', import.meta.url), 'utf8');
  const start = src.indexOf('const MSGS'), end = src.indexOf('];', start) + 1;
  // The messages exactly as the QA script builds them (the array literal, evaluated).
  const msgs = vm.runInNewContext(src.slice(start, end).replace(/^const MSGS\s*=\s*/, '(') + ')', {});
  assert.ok(Array.isArray(msgs) && msgs.length >= 3, 'fixture messages found');
  for (const m of msgs) assert.equal(typeof m.text, 'string');
  const text = msgs.map(m => m.text).join('\n');
  assert.ok(text.length > 100, 'real-looking conversation text');
  assert.ok(msgs.some(m => m.out) && msgs.some(m => !m.out), 'both sides of a chat');
  assert.doesNotMatch(text, /Thales|Mac mini|VPS|SSH|tunnel|Archimedes|Miguel|Mizel|James|defleur|Oscar|datacenter/i);
  assert.doesNotMatch(text, /\bJan\b|Mesaric/, 'every teammate stays out, Jan included');
});
