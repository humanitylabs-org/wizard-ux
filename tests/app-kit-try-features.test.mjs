// The shared "Try new features" section (wizard-os#627, ux#1455) is served from the shell kit at
// /wizard-os-home/kit/wizard-try-features.js, byte-identical to wizard-os style/try-features.js. The canonical
// style policy mirror (tools/style/style-policy.json) hash-locks that copy, so any edit here fails the ratchet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const kit = readFileSync(new URL('web/kit/wizard-try-features.js', root));
const policy = JSON.parse(readFileSync(new URL('tools/style/style-policy.json', root), 'utf8'));

// static-rule: the kit mirror and the canonical style policy must agree byte for byte (files that must agree).
test('kit copy matches the canonical hash in the style policy', () => {
  const pin = policy.assets['wizard-try-features.js'];
  assert.ok(pin, 'policy names the kit copy');
  assert.equal(pin.source, 'style/try-features.js');
  assert.equal(createHash('sha256').update(kit).digest('hex'), pin.sha256);
  assert.equal(policy.assets['try-features.js'].sha256, pin.sha256, 'kit and source names carry the same hash');
});

test('kit copy defines WzTryFeatures and does nothing on its own', () => {
  const window = {};
  vm.runInNewContext(kit.toString('utf8'), { window, globalThis: window, document: undefined });
  const api = window.WzTryFeatures;
  assert.ok(api && typeof api.mount === 'function', 'exposes WzTryFeatures.mount');
});
