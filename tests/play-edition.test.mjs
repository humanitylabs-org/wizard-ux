import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const root = 'android/app/src/';
test('Play removes installer permissions and every native installer component', () => {
  const manifest = read(root + 'play/AndroidManifest.xml');
  for (const permission of ['REQUEST_INSTALL_PACKAGES', 'UPDATE_PACKAGES_WITHOUT_USER_ACTION', 'ENFORCE_UPDATE_OWNERSHIP'])
    assert.match(manifest, new RegExp(permission + '" tools:node="remove"'));
  const direct = read(root + 'sideload/AndroidManifest.xml');
  const common = read(root + 'main/AndroidManifest.xml');
  for (const name of ['update.InstallReceiver', 'update.UpdateBoot', 'update.UpdateJob', 'update.ApkProvider', 'apps.AppsInstallReceiver', 'apps.AppsUpdateJob']) {
    assert.ok(direct.includes(`android:name=".${name}"`), name);
    assert.ok(!common.includes(`android:name=".${name}"`), name);
    assert.ok(!manifest.includes(`android:name=".${name}"`), name);
  }
  const play = ['apps/AppsDistribution.java', 'update/UpdateChannel.java'].map(p => read(root + 'play/java/ai/wizards/os/' + p)).join('\n');
  assert.doesNotMatch(play, /PackageInstaller|latest\.json|UPDATE_SIGNER|ACTION_MANAGE_UNKNOWN_APP_SOURCES/);
  assert.match(play, /bridge\.openPlay\(pkg\)/);
});
test('Play is generic even on an owner-configured worker, and sideload is default', () => {
  const gradle = read('android/app/build.gradle');
  const play = gradle.slice(gradle.indexOf('        play {'), gradle.indexOf('    buildFeatures'));
  for (const key of ['ORIGIN', 'HOME_URL', 'PHOTOS_SERVER']) assert.ok(play.includes(`'${key}', '\"\"'`));
  assert.match(play, /wizardDeepLinkHost: 'unconfigured\.invalid'/);
  assert.match(gradle, /sideload \{\s*dimension 'distribution'\s*isDefault = true/);
  assert.match(gradle, /alias\.setDependsOn\(\[target\]\)/);
});
test('flavor foreground service declarations exactly match shared service types', () => {
  const common = read(root + 'main/AndroidManifest.xml');
  for (const [name, type] of [['everywhere.EverywhereService', 'microphone|specialUse'],
    ['mizel.MeetingRecorderService', 'microphone'], ['recording.RecorderService', 'microphone'], ['share.ShareService', 'dataSync']]) {
    assert.ok(common.includes(`android:name=".${name}"`));
    for (const flavor of ['play', 'sideload']) assert.ok(read(root + flavor + '/AndroidManifest.xml')
      .includes(`android:name="ai.wizards.os.${name}" android:foregroundServiceType="${type}"`));
  }
});
test('Play preserves pending-share recovery without updater boot work', () => {
  const manifest = read(root + 'play/AndroidManifest.xml');
  assert.match(manifest, /\.share\.ShareRecoveryBoot/);
  assert.match(manifest, /android\.intent\.action\.BOOT_COMPLETED/);
  assert.match(manifest, /android\.intent\.action\.MY_PACKAGE_REPLACED/);
  const receiver = read(root + 'play/java/ai/wizards/os/share/ShareRecoveryBoot.java');
  assert.match(receiver, /ShareJob\.scheduleIfPending\(c\)/);
  assert.doesNotMatch(receiver, /Updater\.|UpdateJob\./);
});
test('Android smoke and CI use explicit flavor tasks and the right artifact path', () => {
  const smoke = read('.github/workflows/android-emulator.yml');
  assert.match(smoke, /apk\/sideload\/debug\/app-sideload-debug\.apk/);
  assert.match(smoke, /:app:connectedSideloadDebugAndroidTest/);
  assert.doesNotMatch(smoke, /:app:(?:assemble|connected)Debug/);
  const ci = read('.github/workflows/android.yml');
  assert.match(ci, /:app:testPlayDebugUnitTest/);
  assert.match(ci, /:app:testSideloadDebugUnitTest/);
});
const device = read('web/device.js');
const settings = device.slice(device.indexOf('    settingsHtml() {'), device.indexOf('    readRecording,')).replace(/,\s*$/, '');
for (const distribution of ['play', 'sideload']) test(`${distribution} settings only offer the distribution's update controls`, () => {
  const html = vm.runInNewContext(`({${settings}}).settingsHtml()`, {
    DEV: () => ({notifications: () => '{}', updateState: () => '{}'}),
    J: JSON.parse, upd: {distribution, state:'idle', installed:'0.10.5'},
    window: {WizConfig:{agent: () => 'an agent'}}, esc: String
  });
  assert.equal(html.includes('data-dvupd'), distribution === 'sideload');
  assert.equal(html.includes('Updates managed by Google Play'), distribution === 'play');
});
