import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('per-app PWA HTTP registry, identity, metadata and rejection contracts', () => {
  const result = spawnSync('python3', ['tests/app_install_test.py', '-v'], { cwd:new URL('..', import.meta.url), encoding:'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
