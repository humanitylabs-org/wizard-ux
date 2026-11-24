import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// wizard-app-manager#789: the phone release workflow's output is what gets signed with the WizardOS key, so every
// action it runs is pinned by full commit SHA (a moved tag can't change what is built and signed).
test('every action in the phone release workflow is pinned by commit SHA', () => {
  const yml = fs.readFileSync(new URL('../.github/workflows/phone-release.yml', import.meta.url), 'utf8');
  const uses = [...yml.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1]);
  assert.ok(uses.length >= 5);
  for (const ref of uses) assert.match(ref, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, ref);
});
