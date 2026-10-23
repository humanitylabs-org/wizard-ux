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
  for (const name of ['update.InstallReceiver', 'update.UpdateBoot', 'update.UpdateJob', 'update.ApkProvider', 'apps.AppsInstallReceiver', 'apps.AppsUpdateJob'])
    assert.ok(manifest.includes(`android:name=".${name}" tools:node="remove"`), name);
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
