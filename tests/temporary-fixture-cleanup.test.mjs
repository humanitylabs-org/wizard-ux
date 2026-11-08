// End-to-end filesystem ownership check for the npm fixtures that used to fill
// the worker's tmpfs. Assertions/setup failures still run the registered hooks;
// removing this test's sandbox must never hide leaked children from the check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
test('logo, device, Customize and asset-stamping fixtures leave no temporary directories', t => {
  const root = mkdtempSync(join(tmpdir(), 'ux-fixture-cleanup-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const files = ['app-logos', 'devices-groups', 'versioned-assets', 'wizard-customize'].map(name => new URL(`./${name}.test.mjs`, import.meta.url).pathname);
  const child = spawnSync(process.execPath, ['--test', ...files], {
    env: { ...process.env, TMPDIR: root, TMP: root, TEMP: root }, encoding: 'utf8', timeout: 60_000,
  });
  assert.equal(child.status, 0, child.error?.message || child.stdout + child.stderr);
  assert.deepEqual(readdirSync(root), [], 'fixture hooks must delete their own files, not rely on a worker sweep');
});
