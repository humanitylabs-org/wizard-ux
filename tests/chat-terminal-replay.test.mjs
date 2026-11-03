import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(process.env.CHAT_SOURCE || new URL('../web/core/chats.js', import.meta.url), 'utf8');
const start = source.indexOf('  const assistantStamp =');
const end = source.indexOf('  function closeStream(c)', start);
assert.ok(start >= 0 && end > start);
const context = {};
vm.runInNewContext(source.slice(start, end) + ';this.shown = streamShown;', context);
const turns = [
  { notes: [], a: { text: 'Yes.', final: true } },
  { notes: [], a: { text: 'A later answer.', final: true } }
];

for (const text of ['Yes.', 'A later answer.']) test(`matching partial '${text}' hides duplicates without closing the real subscription`, () => {
  const w = { id: 'w', thread: 'sid' }, c = {};
  let callback, closed = 0;
  const ctx = {
    LIVE: { pendingRun: () => 'run', session: () => ({}), openRunStream: (_s, _a, _r, cb) => (callback = cb, { close: () => closed++ }) },
    W: { w }, elOf: () => ({}), agentRec: () => ({ privacy: 'standard' }),
    esc: value => value, md: value => `<p>${value}</p>`, renderThreadLive() {}, loadThread: async () => {}, setTimeout: () => 1, clearTimeout() {}
  };
  vm.runInNewContext(source.slice(start, source.indexOf('  function renderThread(w, el, keep)')), ctx);
  ctx.syncStream(w, c, turns, '');
  callback({ text, steps: [], terminal: false });
  assert.equal(ctx.syncStream(w, c, turns, ''), '', 'already displayed words stay hidden');
  assert.equal(c.stream.landed, false);
  assert.equal(closed, 0, 'partial matching words must not close a new answer');
  callback({ text: text + ' More new words.', steps: [], terminal: false });
  assert.match(ctx.syncStream(w, c, turns, ''), /More new words/);
  assert.equal(closed, 0);
});
test('a completed replay of an older displayed final is recognized', () => {
  assert.equal(context.shown({ text: 'Yes.', terminal: true }, turns), true);
});
test('a completed replay of the latest displayed final is recognized', () => {
  assert.equal(context.shown({ text: 'A later answer.', terminal: true }, turns), true);
});
test('new text ending with an old answer remains visible', () => {
  assert.equal(context.shown({ text: 'Extra new words. Yes.', terminal: true }, turns), false);
});
test('an unfinished transcript row cannot acknowledge a terminal replay', () => {
  assert.equal(context.shown({ text: 'Yes.', terminal: true }, [{ notes: [], a: { text: 'Yes.', final: false } }]), false);
});
