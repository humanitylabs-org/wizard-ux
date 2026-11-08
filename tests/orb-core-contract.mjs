import assert from 'node:assert/strict';
export default function check(instance, window) {
  assert.equal(window.WosOrbSwitcher, instance);
  assert.equal(instance.active(), true);
  instance.dispose(); instance.dispose();
  assert.equal(instance.active(), false);
  assert.equal(window.WosOrbSwitcher, undefined);
}
