import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const id = read('android/app/src/main/java/ai/wizards/os/identity/WizardId.java');
const look = read('android/app/src/main/java/ai/wizards/os/WizardLook.java');
const bridge = read('android/app/src/main/java/ai/wizards/os/device/DeviceBridge.java');
const method = (name, next) => id.slice(id.indexOf(name), id.indexOf(next, id.indexOf(name)));

test('ID sheets reuse the Connect skin resolver, including overlay and quiet text roles', () => {
  assert.match(bridge, /evaluateJavascript\(ai\.wizards\.os\.WizardLook\.READ_JS/);
  assert.match(bridge, /WizardLook\.save\(activity, encoded\)/);
  assert.match(bridge, /wizardId\.colors\(ai\.wizards\.os\.WizardLook\.identityColors\(activity\)\)/);
  for (const role of ['wz-text-secondary', 'wz-text-muted', 'wz-overlay', 'wz-border', 'wz-accent']) assert.ok(look.includes(role), role);
  assert.doesNotMatch(id, /Color\.rgb\(/); // fallback palette belongs to the shared native adapter
});
test('chrome has a handle, rounded material, accessible fixed close/back and resizing content', () => {
  const sheet = method('private LinearLayout sheet(', 'private int dp(');
  for (const part of ['setCornerRadii', 'Close Wizard ID', '"Back"', 'SOFT_INPUT_ADJUST_RESIZE', 'KEYCODE_BACK', 'back.run()', 'setCanceledOnTouchOutside(false)']) assert.ok(sheet.includes(part), part);
  assert.ok(sheet.indexOf('root.addView(head)') < sheet.indexOf('ScrollView scroll'));
  assert.match(id, /setMinimumHeight\(dp\(72\)\)/);
  assert.match(id, /setMinHeight\(dp\(52\)\)/);
  assert.doesNotMatch(id, /new Button|button\(b,\s*"(?:Cancel|Close|Back)"/);
});
test('onboarding presents Settings choices; names and keys use labelled rounded filled fields', () => {
  const onboarding = method('private void onboarding()', 'private void createScreen()');
  assert.match(onboarding, /row\(b,"Use my existing Nostr key","Import the nsec you already use"/);
  assert.match(onboarding, /row\(b,"Create a new key","A fresh ID made on this phone"/);
  const input = method('private EditText input(', 'private void onboarding()');
  for (const part of ['setLabelFor', 'setContentDescription', 'round(fill,border,14)', 'IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS', 'IME_FLAG_NO_PERSONALIZED_LEARNING']) assert.ok(input.includes(part), part);
});
test('the visual rewrite keeps native key custody, event-derived sentences and fresh crypto-bound authentication', () => {
  for (const part of ['FLAG_SECURE', 'setFilterTouchesWhenObscured(true)', 'NostrEvent.sentence(event)', 'NostrEvent.encryptionSentence(data, pubkey, vault.publicKey())', 'vault.newSigningCipher()', 'new BiometricPrompt.CryptoObject(cipher)', 'bound != cipher', 'clearPrimaryClip()', 'current != generation']) assert.ok(id.includes(part), part);
  assert.ok(id.includes('title.split(" · ", 2)[0]'));
  assert.doesNotMatch(id, /params\.optString\("description"\)/);
});
test('native QA covers nested Back and both dark/light Settings and form screenshots', () => {
  const qa = read('android/app/src/androidTest/java/ai/wizards/os/identity/WizardIdFlowTest.java');
  const wrapper = read('tools/qa-wizard-id-thales.py');
  for (const name of ['onboarding-dark.png','onboarding-light.png','create-dark.png','create-light.png','settings-dark.png','settings-light.png','backup-options-dark.png']) {
    assert.ok(qa.includes(name), name); assert.ok(wrapper.includes(name), name);
  }
  assert.match(qa, /By\.desc\("Back"\)/);
  assert.match(qa, /assertEquals\("#fff2edf7",paper\.getString\("sheet"\)\)/);
});
