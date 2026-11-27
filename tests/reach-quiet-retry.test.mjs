import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// wizard-ux issue 2008: with Tailscale on, a load that fails fast (tunnel still waking after resume or a network change)
// retries quietly under Connecting; the Tailscale guide shows only at the give-up mark (rules: ReachPolicyTest).
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const main = read('android/app/src/main/java/ai/wizards/os/MainActivity.java');

test('a fast main-frame error or 5xx goes through the quiet-retry rule, never straight to the guide', () => {
  assert.match(main, /if \(req\.isForMainFrame\(\)\) \{ mainFailed = true; loadFailed\(String\.valueOf\(err\.getDescription\(\)\)\); \}/);
  assert.match(main, /mainFailed = true;\s+loadFailed\("Wizard answered " \+ resp\.getStatusCode\(\)\);/);
  assert.match(main, /ReachPolicy\.retryQuietly\(w, since, reach\.isOffline\(\)\)\) \{ showOffline\(why\); return; \}/);
});

test('quiet tries keep the first try’s give-up mark and stop on a paint or the offline screen', () => {
  const quiet = main.slice(main.indexOf('private final Runnable quietRetry'), main.indexOf('private void showOffline'));
  assert.doesNotMatch(quiet, /armReach|navStarted|go\(/, 'a quiet try never re-arms the marks');
  for (const fn of ['void landed()', 'private void showOffline(', 'void armReach()']) {
    const body = main.slice(main.indexOf(fn), main.indexOf('\n    }\n', main.indexOf(fn)));
    assert.match(body, /main\.removeCallbacks\(quietRetry\);/, fn);
  }
});
