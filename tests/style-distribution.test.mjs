import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

test('public style admission is the exact canonical distribution, not another policy', () => {
  assert.match(execFileSync('python3', ['tools/sync_wizard_style.py', '--check'], {encoding:'utf8'}), /PASS/);
  const pin = JSON.parse(readFileSync('tools/style/source.json', 'utf8'));
  assert.equal(pin.source, 'https://github.com/humanitylabs-org/wizard-os');
  assert.match(pin.revision, /^[a-f0-9]{40}$/);
});
