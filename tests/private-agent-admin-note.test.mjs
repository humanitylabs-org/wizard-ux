import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// wizard-os#138: private agents are separated by the Agent Service, not encrypted. The note must say who can still read.
test('private agent note says box administrators and a host Hermes can read its data', () => {
  const src = readFileSync(new URL('../web/agents/agents.js', import.meta.url), 'utf8');
  const note = src.match(/'Sealed: no other agent[^']*'/)?.[0] || '';
  assert.match(note, /not encryption/);
  assert.match(note, /administrators/);
  assert.match(note, /Hermes/);
});
