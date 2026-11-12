import { modelContext } from './fixtures/chats-list-model.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// ux#1319: the agent writes its whole answer in a message that also carries a tool call (a notes patch), then ends
// the turn with a short postscript. The answer must stay the visible reply, never fold into the work log.
const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const ctx = { window: null, URL, Intl, Date, navigator: {}, location: { origin: 'https://wizard.example', href: 'https://wizard.example/' },
  document: { addEventListener() {}, querySelector() { return null; } }, addEventListener() {} };
ctx.window = ctx; modelContext(ctx); vm.runInContext(read('web/core/chat-kit.js'), ctx);
const KIT = ctx.WosChat;
const answer = `Here is the full answer.\n\n${Array.from({ length: 400 }, (_, i) => `point${i}`).join(' ')}`;
const ps = 'The reply above stands as written; I saved it to your notes.';
const call = [{ id: 'c1', function: { name: 'patch', arguments: '{}' } }];
const turn = rows => KIT.parseRows([{ role: 'user', timestamp: 1, content: 'Tell me' }, ...rows]).at(-1);

test('a long answer sent with a tool call stays the reply when a short postscript ends the turn', () => {
  const t = turn([{ role: 'assistant', timestamp: 2, content: answer, tool_calls: call },
    { role: 'tool', timestamp: 3, tool_call_id: 'c1', content: 'ok' },
    { role: 'assistant', timestamp: 4, id: 9, content: ps }]);
  assert.equal(t.a.text, `${answer}\n\n${ps}`);
  assert.equal(t.a.plainText, `${answer}\n\n${ps}`);
  assert.equal(t.a.final, true);
  assert.equal(t.a.id, 9);
  assert.equal(t.a.at, 4000);
  assert.ok(!t.notes.includes(answer), 'the answer is no longer only in the work log');
  assert.equal(t.said, undefined);
});

test('short interim lines still go to the work log; a long final reply is unchanged', () => {
  const t = turn([{ role: 'assistant', timestamp: 2, content: 'Let me check your notes.', tool_calls: call },
    { role: 'tool', timestamp: 3, tool_call_id: 'c1', content: 'ok' },
    { role: 'assistant', timestamp: 4, content: ps }]);
  assert.equal(t.a.text, ps);
  assert.deepEqual([...t.notes], ['Let me check your notes.']);
  const t2 = turn([{ role: 'assistant', timestamp: 2, content: answer, tool_calls: call },
    { role: 'tool', timestamp: 3, tool_call_id: 'c1', content: 'ok' },
    { role: 'assistant', timestamp: 4, content: `${answer} (revised)` }]);
  assert.equal(t2.a.text, `${answer} (revised)`);
  assert.deepEqual([...t2.notes], [answer]);
});

test('mid-run (last message still has a tool call) nothing is lifted', () => {
  const t = turn([{ role: 'assistant', timestamp: 2, content: answer, tool_calls: call },
    { role: 'tool', timestamp: 3, tool_call_id: 'c1', content: 'ok' },
    { role: 'assistant', timestamp: 4, content: 'One more step.', tool_calls: [{ id: 'c2', function: { name: 'patch' } }] }]);
  assert.equal(t.a.text, 'One more step.');
  assert.deepEqual([...t.notes], [answer]);
});

test('commentary is never lifted into the reply', () => {
  const t = turn([{ role: 'assistant', timestamp: 2, display_kind: 'commentary', content: answer },
    { role: 'assistant', timestamp: 4, content: ps }]);
  assert.equal(t.a.text, ps);
});
