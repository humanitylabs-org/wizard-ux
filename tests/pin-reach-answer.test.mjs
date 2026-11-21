// Connecting only while the Wizard hasn't answered (wizard-ux issue 1607). Approved at show-and-tell, so the switch
// wizard/pin-reach-answer is gone and this is the only behaviour. The native rules are JVM tests (ReachPolicyTest); the
// wiring is checked from source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const exists = p => existsSync(new URL('../' + p, import.meta.url));
const SWITCH = 'wizard/pin-reach-answer';

test('Android: an answer always stops only the connecting mark; a paint still ends both', () => {
  const src = read('android/app/src/main/java/ai/wizards/os/MainActivity.java');
  const body = src.slice(src.indexOf('    void answered(String url) {'), src.indexOf('    private void showOffline(String why) {'));
  assert.match(body, /ReachPolicy\.answerDisarms\(isWeb\(url\), mainFailed, sameHost\(url, wantUrl\)\)/);
  assert.ok(body.includes('main.removeCallbacks(reachMark);'));
  assert.ok(!body.includes('reachGiveUp'), 'the give-up mark stays armed until a page paints');
  const started = src.slice(src.indexOf('public void onPageStarted(WebView view, String url'), src.indexOf('public void onPageFinished('));
  assert.ok(!started.includes('answered('), 'onPageStarted can fire before any response, so it is never an answer');
  const hist = src.slice(src.indexOf('public void doUpdateVisitedHistory('), src.indexOf('public void onPageCommitVisible('));
  assert.ok(hist.includes('answered(url);'));
  assert.ok(!hist.includes('landed()'), 'the old off path (hide only on a commit while Connecting shows) is gone');
  const painted = src.slice(src.indexOf('public void onPageCommitVisible('), src.indexOf('public void onPageStarted('));
  assert.ok(painted.includes('landed();'), 'a paint still clears both marks');
});

test('the switch is gone everywhere, and the phone clears its stored copy', () => {
  const src = read('android/app/src/main/java/ai/wizards/os/MainActivity.java');
  assert.ok(!src.includes('ReachAnswer'), 'no native switch read left');
  assert.ok(!src.includes('reachAnswerSwitch'), 'no bridge for the page to copy the switch');
  assert.ok(src.includes('deleteSharedPreferences("reach-answer")'), 'the old stored value is cleared');
  assert.ok(!exists('android/app/src/main/java/ai/wizards/os/ReachAnswer.java'));
  const relay = read('web/core/android-relay.js');
  assert.ok(!relay.includes(SWITCH) && !relay.includes('reachAnswerSwitch'));
  assert.ok(!JSON.stringify(JSON.parse(read('web/tweaks/catalog.json'))).includes(SWITCH));
  assert.ok(!exists('web/tweaks/wizard/pin-reach-answer/manifest.json'));
});
