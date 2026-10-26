import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanFeatureIds, compareFeatureIds } from './feature-id-scan.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
test('feature app references in the shells never grow beyond the explicit allowlist', () => {
  const allowed = JSON.parse(readFileSync(new URL('./feature-id-allowlist.json', import.meta.url), 'utf8'));
  for (const [key, count] of Object.entries(allowed)) {
    assert.ok(Number.isInteger(count) && count > 0, `Invalid allowlist entry ${key}`);
  }
  const { growth, shrinking } = compareFeatureIds(scanFeatureIds(root), allowed);
  if (shrinking.length) console.info(`Feature references removed; lower tests/feature-id-allowlist.json counts (delete zero entries):\n${shrinking.join('\n')}`);
  assert.deepEqual(growth, [], `New feature app references belong in registry/owner preferences, not the shells.\n${growth.join('\n')}`);
});

test('feature reference scanner covers both shells, ignores skins/tests and counts occurrences, not lines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'feature-id-guard-'));
  const put = (path, text) => { const full = join(dir, path); mkdirSync(join(full, '..'), { recursive: true }); writeFileSync(full, text); };
  try {
    put('web/core/apps.js', 'usuals usuals Usuals mizel Mizel photos Immich');
    put('web/core/skins.js', 'mizel');
    put('web/core/skins-mizel.css', 'mizel');
    put('web/skins/miguel/skin.css', 'mizel');
    put('web/tests/fixture.js', 'usuals');
    put('android/app/src/main/java/ai/wizards/App.java', 'wizard-recorder wizard-music');
    assert.deepEqual(scanFeatureIds(dir), {
      'android/app/src/main/java/ai/wizards/App.java:wizard-music': 1,
      'android/app/src/main/java/ai/wizards/App.java:wizard-recorder': 1,
      'web/core/apps.js:Immich': 1,
      'web/core/apps.js:mizel': 1,
      'web/core/apps.js:Mizel': 1,
      'web/core/apps.js:photos': 1,
      'web/core/apps.js:usuals': 2,
      'web/core/apps.js:Usuals': 1,
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('feature reference ratchet rejects new paths and increments but permits reductions', () => {
  assert.deepEqual(compareFeatureIds({ 'web/core/a.js:topics': 2, 'web/new.js:wisdom': 1 }, { 'web/core/a.js:topics': 1 }).growth,
    ['web/core/a.js:topics: 2 > 1', 'web/new.js:wisdom: 1 > 0']);
  assert.deepEqual(compareFeatureIds({}, { 'web/core/a.js:topics': 1 }), { growth: [], shrinking: ['web/core/a.js:topics: 1 -> 0'] });
});
