import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { manifest } from './fixtures/r8C-manifest.mjs';

const read = path => readFileSync(path, 'utf8');

// This PR owns mobile portability; repository-wide web/QA portability is a separate change.
// Enumerate tracked files rather than silently skipping new source directories or file extensions.
// Split the private identifiers so this detector does not itself trip the repo-wide guard.
const forbidden = new RegExp(['\\/Volumes\\/' + 'ThalesMedia\\/', '\\/home\\/' + 'telos\\/', '(?:[\\w-]+\\.)?' + 'tailc0f369' + '\\.ts\\.net', '\\bssh\\s+' + 'thales\\b'].join('|'));
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

// static-rule: AndroidManifest.xml is declarative config: both app links take their host from the one build placeholder
test('Android app links take their host from the one build placeholder, plus the wizard://connect pairing link', () => {
  const m = manifest(read('android/app/src/main/AndroidManifest.xml'));
  const links = m.filter(e => e.tag === 'data' && e.attrs['android:scheme'] === 'https' && e.attrs['android:host']).map(e => [e.attrs['android:host'], e.attrs['android:pathPrefix']]);
  assert.deepEqual(links, [['${wizardDeepLinkHost}', '/wizard-os-home/'], ['${wizardDeepLinkHost}', '/mizel-live/']]);
  assert.ok(m.some(e => e.tag === 'data' && e.attrs['android:scheme'] === 'wizard' && e.attrs['android:host'] === 'connect'), 'wizard://connect pairing link');
});
// Not run here (wizard-ux issue 1674): this pinned Java/Swift source text and no JDK runs it in this suite. The Gradle origin derivation/validation (build.gradle) and ServerSettings; origin parsing runs in the JVM suite (ServerOriginTest).
// Not run here (wizard-ux issue 1674): this pinned Java/Swift source text and no JDK runs it in this suite. Photo backup server default (build.gradle, BackupSettings, PhotosActivity); the personal-path guard above still runs over every file.
// static-rule: Xcode build settings and Info.plist are declarative config: shipped iOS builds carry no owner origin
test('iOS ships empty WIZARD_ORIGIN build settings and reads the origin from Info.plist', () => {
  const project = read('ios/native/App/App.xcodeproj/project.pbxproj');
  assert.deepEqual([...project.matchAll(/WIZARD_ORIGIN = (.*);/g)].map(m => m[1]), ['""', '""']);
  assert.match(read('ios/native/App/App/Info.plist'), /<key>WizardOrigin<\/key>\s*<string>\$\(WIZARD_ORIGIN\)<\/string>/);
});
// Fastlane forwarding and the Swift lookup are not run here (wizard-ux issue 1674: no Ruby/Xcode in this suite).
