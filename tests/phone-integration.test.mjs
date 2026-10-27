import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('phone version stays at or above the Settings-style ID release (0.10.15/79) and preserves published vault storage names', () => {
  const gradle = read('android/app/build.gradle');
  assert.ok(Number(gradle.match(/versionCode (\d+)/)[1]) >= 79);
  const vault = read('android/app/src/main/java/ai/wizards/os/vault/VaultBridge.java');
  assert.match(read('android/app/src/main/java/ai/wizards/os/vault/VaultSlots.java'), /KEY_PREFIX = "wos-vault-v1-"/);
  assert.match(vault, /getSharedPreferences\("wizard-vault",/);
});

test('published agent-name identity and owner signing identity have distinct storage', () => {
  const agent = read('android/app/src/main/java/ai/wizards/os/device/WizardIdentity.java');
  const owner = read('android/app/src/main/java/ai/wizards/os/identity/KeyVault.java');
  assert.match(agent, /package ai\.wizards\.os\.device;/);
  assert.match(agent, /PREFS = "wizard-identity"/);
  assert.match(agent, /fromBootstrap\(JSONObject bootstrap\)/);
  assert.match(owner, /package ai\.wizards\.os\.identity;/);
  assert.match(owner, /getSharedPreferences\("wizard-id-v1",/);
  assert.match(owner, /ALIAS = "wizard-id-owner-wrap-v1"/);
  assert.doesNotMatch(owner, /"wizard-identity"|"wizard-vault"|"wos-vault-v1-"/);
});

test('signed release gate pins the published upgrade baseline and Wizard OS signing env', () => {
  const gate = read('tools/qa_phone_release.py');
  assert.match(gate, /OLD_SHA = '643a68d497166ed5c4164b65f9bc1c1d06cb65c42d156ab78df7baa65ca5d76b'/);
  assert.match(gate, /signed-upgrade-0\.10\.11-to-0\.10\.12/);
  assert.match(gate, /metadata\['version_name'\] == '0\.10\.12'/);
  assert.match(gate, /metadata\['version_code'\]\) == '76'/);
  assert.ok(gate.includes("Path(config.get('signing_env', '')).resolve() != Path.home() / '.hermes/secure/wizard-os/signing.env'"));
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
