import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
test('both Android distributions target API36 with separate monotonic allocations', () => {
  const gradle = read('android/app/build.gradle');
  assert.match(gradle, /compileSdk 36/); assert.match(gradle, /targetSdk 36/);
  assert.match(gradle, /versionCode 1000070/); assert.match(gradle, /versionCode 70\b/);
  assert.match(read('android/build.gradle'), /8\.10\.1/);
  assert.match(read('android/gradle/wrapper/gradle-wrapper.properties'), /gradle-8\.11\.1-bin/);
});
test('API36 predictive Back stays enabled and activity domain handlers are registered', () => {
  const root = 'android/app/src/main/';
  assert.match(read(root + 'AndroidManifest.xml'), /android:enableOnBackInvokedCallback="true"/);
  for (const file of ['MainActivity', 'ConnectActivity', 'photos/PhotosActivity', 'share/ShareActivity', 'assist/AssistLockActivity']) {
    const src = read(root + 'java/ai/wizards/os/' + file + '.java');
    assert.match(src, /registerOnBackInvokedCallback/);
    assert.doesNotMatch(src, /super\.onBackPressed\(|moveTaskToBack\(/);
  }
  const assist = read(root + 'java/ai/wizards/os/assist/AssistLockActivity.java');
  assert.match(assist, /PRIORITY_DEFAULT, this::handleBack/);
  assert.match(assist, /public void onBackPressed\(\) \{ handleBack\(\); \}/);
});
test('API36 regression opens nested views, uses system Back, and asserts foreground and inset geometry', () => {
  const testSrc = read('android/app/src/androidTest/java/ai/wizards/os/ConnectE2eTest.java');
  for (const check of ['device.pressBack()', 'device.swipe(', 'visible("Fixture nested")', 'foreground()', 'root-back-twice', 'assist-nested-back', 'shell-composer-ime-insets', 'bounds.top >= bars[0].top']) assert.ok(testSrc.includes(check), check);
  const connect = read('android/app/src/main/java/ai/wizards/os/ConnectActivity.java');
  assert.match(connect, /setOnApplyWindowInsetsListener/); assert.match(connect, /WindowInsets\.Type\.ime\(\)/);
});
