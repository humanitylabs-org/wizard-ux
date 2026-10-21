// Keyboard dictation (Wispr Flow, Gboard voice) holds an input connection to the exact composer node.
// A live repaint of the same draft must keep that node, or a long take is silently lost.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../web/core/chats.js', import.meta.url), 'utf8');

test('thread repaint keeps the live composer textarea for the same draft, not only during in-app dictation', () => {
  const line = src.split('\n').find(l => l.includes('const keepTa ='));
  assert.ok(line, 'keepTa rule exists');
  assert.match(line, /el\.dataset\.draftFor === dkey/, 'only for the same draft (navigation still gets a fresh node)');
  assert.doesNotMatch(line, /H\.dictationField/, 'all same-draft composer input paths keep the node');
  assert.match(src, /fresh\.replaceWith\(keepTa\)/, 'kept node is swapped back into the new markup');
  assert.match(src, /keepTa\.scrollTop = keepScroll/, 'the upstream caret hardening also keeps the field scroll');
});
