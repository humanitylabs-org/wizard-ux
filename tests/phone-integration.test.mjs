import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('combined phone is 0.10.9/73 and preserves 0.10.8 vault storage names', () => {
  const gradle = read('android/app/build.gradle');
  assert.match(gradle, /versionCode 73\b/);
  assert.match(gradle, /versionName '0\.10\.9'/);
  const vault = read('android/app/src/main/java/ai/wizards/os/vault/VaultBridge.java');
  assert.match(vault, /KEY_PREFIX = "wos-vault-v1-"/);
  assert.match(vault, /getSharedPreferences\("wizard-vault",/);
});

test('one device port dispatches vault and identity independently and revokes both on navigation', () => {
  const apps = read('android/app/src/main/java/ai/wizards/os/apps/AppsBridge.java');
  assert.match(apps, /DeviceMessageProtocol.NAME, allow, b::onDeviceMessage/);
  assert.match(apps, /VaultPolicy.method\(request.method\)/);
  assert.match(apps, /device.dispatchIdentity\(request.method/);
  const main = read('android/app/src/main/java/ai/wizards/os/MainActivity.java');
  const started = main.slice(main.indexOf('public void onPageStarted('), main.indexOf('public void onPageFinished('));
  assert.match(started, /device.onPageStarted\(\)/);
  assert.match(started, /apps.onVaultPageStarted\(\)/);
  assert.match(main, /UA_TAG \+ " WizardOS-DocScroll"/);
  assert.match(main, /ScrollCaptureCrashGuard.install\(\)/);
});
