import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(path, 'utf8');

// This PR owns mobile portability; repository-wide web/QA portability is a separate change.
// Enumerate tracked files rather than silently skipping new source directories or file extensions.
const forbidden = /\/Volumes\/ThalesMedia\/|\/home\/telos\/|(?:[\w-]+\.)?tailc0f369\.ts\.net|\bssh\s+thales\b/;
test('tracked Android and iOS files contain no personal paths or hosts', () => {
  const files = execFileSync('git', ['ls-files', '-z', '--', 'android/', 'ios/'], { encoding: 'utf8' })
    .split('\0').filter(Boolean);
  assert.ok(files.length > 100, 'mobile file inventory must not be empty');
  const violations = [];
  for (const path of files) {
    read(path).split('\n').forEach((line, i) => {
      if (forbidden.test(line)) violations.push(`${path}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(violations, [], `Personal mobile configuration must be external:\n${violations.join('\n')}`);
});

test('Android derives home, trust origin and both app links from one build property', () => {
  const gradle = read('android/app/build.gradle');
  assert.match(gradle, /providers\.gradleProperty\('wizardOrigin'\)\s*\.orElse\(providers\.environmentVariable\('WIZARD_ORIGIN'\)\)/);
  assert.match(gradle, /buildConfigField 'String', 'ORIGIN', javaString\(wizardOrigin\)/);
  assert.match(gradle, /buildConfigField 'String', 'HOME_URL', javaString\(wizardOrigin \+ '\/wizard-os-home\/'\)/);
  assert.match(gradle, /manifestPlaceholders = \[wizardDeepLinkHost: originUri\.host\]/);
  assert.match(gradle, /groovy\.json\.JsonOutput\.toJson\(value\)/, 'BuildConfig strings must be escaped');
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  const links = [...manifest.matchAll(/<data android:scheme="https" android:host="([^"]+)" android:pathPrefix="([^"]+)"/g)];
  assert.deepEqual(links.map(([, host, path]) => [host, path]), [
    ['${wizardDeepLinkHost}', '/wizard-os-home/'],
    ['${wizardDeepLinkHost}', '/mizel-live/'],
  ]);
});

test('unconfigured debug has an invalid placeholder; release is gated before building', () => {
  const gradle = read('android/app/build.gradle');
  assert.match(gradle, /: 'https:\/\/wizard\.invalid'/);
  assert.match(gradle, /tasks\.register\('validateReleaseOrigin'\)/);
  assert.match(gradle, /if \(!configuredOrigin \|\| originUri\.host\.endsWith\('\.invalid'\)\)/);
  assert.match(gradle, /tasks\.matching \{ it\.name == 'preReleaseBuild' \}\.configureEach \{\s*dependsOn tasks\.named\('validateReleaseOrigin'\)/);
  for (const field of ['rawUserInfo', 'rawQuery', 'rawFragment', 'rawPath']) {
    assert.ok(gradle.includes(`originUri.${field}`), `origin must validate ${field}`);
  }
  assert.match(gradle, /originUri\.scheme != 'https'/);
  assert.match(gradle, /originUri\.port != -1/);
  const originTest = read('android/app/src/test/java/ai/wizards/os/OriginTest.java');
  assert.match(originTest, /URI\.create\(BuildConfig\.ORIGIN\)\.getHost\(\)/);
});

test('photo backup has no personal default and the switch can open server setup', () => {
  const gradle = read('android/app/build.gradle');
  assert.match(gradle, /providers\.gradleProperty\('photosServer'\)\.getOrElse\(''\)/);
  assert.match(gradle, /buildConfigField 'String', 'PHOTOS_SERVER', javaString\(photosServer\)/);
  const settings = read('android/app/src/main/java/ai/wizards/os/photos/BackupSettings.java');
  assert.match(settings, /getBoolean\("enabled", false\)/);
  assert.match(settings, /prefs\.getString\("server", BuildConfig\.PHOTOS_SERVER\)/);
  const activity = read('android/app/src/main/java/ai/wizards/os/photos/PhotosActivity.java');
  assert.match(activity, /putBoolean\("enable_after_signin",true\)\.commit\(\);\s*signIn\(\);/);
  assert.match(activity, /if\(!settings\.server\(\)\.isEmpty\(\)\) \{ startSignIn\(settings\.server\(\)\); return; \}/);
  assert.match(activity, /EditText url=input\(box,settings\.server\(\),"https:\/\/your-photo-server",false\)/);
});

test('iOS has empty defaults and forwards explicit origin to simulator and TestFlight', () => {
  const project = read('ios/native/App/App.xcodeproj/project.pbxproj');
  assert.deepEqual([...project.matchAll(/WIZARD_ORIGIN = (.*);/g)].map(m => m[1]), ['""', '""']);
  assert.match(read('ios/native/App/App/Info.plist'), /<key>WizardOrigin<\/key>\s*<string>\$\(WIZARD_ORIGIN\)<\/string>/);
  assert.match(read('ios/fastlane/.env.example'), /WIZARD_ORIGIN=https:\/\/wizard\.example\.ts\.net/);
  const fastlane = read('ios/fastlane/Fastfile');
  assert.match(fastlane, /"WIZARD_ORIGIN=#\{ENV\['WIZARD_ORIGIN'\]\}", "build"/);
  assert.match(fastlane, /Shellwords\.escape\("WIZARD_ORIGIN=#\{ENV\['WIZARD_ORIGIN'\]\}"\)/);
  assert.match(fastlane, /CURRENT_PROJECT_VERSION=#\{build\}#\{origin_arg\}/);
  const swift = read('ios/native/App/App/WizardViewController.swift');
  assert.match(swift, /UserDefaults\.standard\.string\(forKey: key\) \?\? bundled/);
});
