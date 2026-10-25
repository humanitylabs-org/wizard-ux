import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('activation gets the same time budget as install (containerd reloads the verified archive)', () => {
  const src = readFileSync(new URL('../tools/wizard-alpha.mjs', import.meta.url), 'utf8');
  const install = src.match(/\['install',id\]\)\],\{env,timeout:(\d+)\}/);
  const activate = src.match(/'--receipt',receiptFile\],\{env,timeout:(\d+)\}/);
  assert.ok(install && activate);
  assert.ok(Number(activate[1]) >= Number(install[1]));
});
