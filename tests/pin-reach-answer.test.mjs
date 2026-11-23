// Connecting only while the Wizard hasn't answered (wizard-ux issue 1607). Approved at show-and-tell, so the switch
// wizard/pin-reach-answer is gone and this is the only behaviour. The native rules are JVM tests (ReachPolicyTest); the
// wiring is checked from source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const exists = p => existsSync(new URL('../' + p, import.meta.url));
const SWITCH = 'wizard/pin-reach-answer';

// Not run here (wizard-ux issue 1674): this pinned Java/Swift source text and no JDK runs it in this suite. The answer/paint wiring in MainActivity; the rules run in the JVM suite (ReachPolicyTest).
test('the switch is gone everywhere', () => {
  const src = read('android/app/src/main/java/ai/wizards/os/MainActivity.java');
  assert.ok(!src.includes('ReachAnswer'), 'no native switch read left');
  assert.ok(!src.includes('reachAnswerSwitch'), 'no bridge for the page to copy the switch');
  assert.ok(!exists('android/app/src/main/java/ai/wizards/os/ReachAnswer.java'));
  const relay = read('web/core/android-relay.js');
  assert.ok(!relay.includes(SWITCH) && !relay.includes('reachAnswerSwitch'));
  assert.ok(!JSON.stringify(JSON.parse(read('web/tweaks/catalog.json'))).includes(SWITCH));
  assert.ok(!exists('web/tweaks/wizard/pin-reach-answer/manifest.json'));
});
