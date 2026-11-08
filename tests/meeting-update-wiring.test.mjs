import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const java = p => read('android/app/src/main/java/ai/wizards/os/' + p + '.java');

test('both replacement receivers preserve the meeting before ordinary crash recovery', () => {
  for (const p of ['update/UpdateBoot', 'everywhere/EverywhereBoot'])
    assert.match(java(p), /ACTION_MY_PACKAGE_REPLACED[\s\S]*afterPackageReplaced\(c\)/);
  assert.match(read('android/app/src/main/AndroidManifest.xml'), /android.intent.action.MY_PACKAGE_REPLACED/);
});
test('replacement handler never starts the microphone or a foreground service', () => {
  const body = java('mizel/MeetingRecorderService').split('public static void afterPackageReplaced')[1].split('public static void resumeUpdateFromActivity')[0];
  assert.doesNotMatch(body, /startForegroundService|startCapture|ACTION_RESTORE/);
  assert.match(body, /!j.paused && j.stopReason == null && !j.stopSent/);
});
test('visible activity resumes before WebView native-resume events', () => {
  const s = java('MainActivity').split('protected void onResume()')[1];
  assert.ok(s.indexOf('resumeUpdateFromActivity(this)') < s.indexOf("wos-native-resume"));
});
test('update pause is a journal field and paused bridge state, not an ended meeting', () => {
  assert.match(java('mizel/MizelJournal'), /put\("resumeAfterUpdate", resumeAfterUpdate\)/);
  assert.match(java('mizel/MizelHub'), /MizelUpdatePolicy.pending\(last\)[\s\S]*state\(true, true,[^;]*"paused_for_update"/);
  assert.match(java('mizel/MizelStore'), /recover\(id, now, false\); \/\/ adopt the final partial WAV without sending \/stop/);
});
test('notification opens the meeting Activity directly, not a receiver trampoline', () => {
  const s = java('mizel/MeetingRecorderService');
  assert.match(s, /Recording paused for the app update/);
  assert.match(s, /setContentIntent\(openMeeting\(c, id, 6\)\)/);
  assert.match(s, /PendingIntent.getActivity\(c, req, i,/);
});
test('server origin and the user stop fence recovery', () => {
  assert.match(java('mizel/MizelUpdatePolicy'), /j.stopReason == null && !j.stopSent/);
  assert.match(java('mizel/MizelUpdatePolicy'), /j.uploadOrigin.equals\(origin\)/);
  assert.match(java('mizel/MizelStore'), /j.recording = false;\s*j.resumeAfterUpdate = false;/);
});
test('updater only bypasses the meeting hold after durable preparation', () => {
  const s = java('update/Updater');
  assert.match(s, /if \(tapped && ok && app.getPackageManager\(\).canRequestPackageInstalls\(\)/);
  assert.ok(s.indexOf('prepareForUpdate()') < s.indexOf('UpdatePolicy.Step step ='));
  assert.match(s, /!ai.wizards.os.mizel.MeetingRecorderService.updatePending\(c\)/);
});

test('every post-preparation exit rolls back unless the installer accepted custody', () => {
  const s = java('update/Updater').split('private static void stepNow(Context app, boolean tapped, Activity act)')[1].split('private static final Runnable deferred')[0];
  assert.match(s, /prepared = ai.wizards.os.mizel.MeetingRecorderService.prepareForUpdate\(\)/);
  assert.match(s, /boolean committed = false;\s*try \{/);
  assert.match(s, /committed = commit\(app, r, verified,/);
  assert.match(s, /finally \{[\s\S]*if \(prepared && !committed\) ai.wizards.os.mizel.MeetingRecorderService.resumeAfterFailedUpdate\(app\)/);
  assert.ok(s.indexOf('try {') < s.indexOf('UpdatePolicy.Hold hold'));
});

test('installer reports failed custody on missing/hash-changed files, late holds and exceptions', () => {
  const s = java('update/Updater').split('private static boolean commit(')[1].split('/** STATUS_*')[0];
  assert.match(s, /if \(f == null \|\| !f.isFile\(\)\)[^\n]*return false;/);
  assert.match(s, /The download changed after it was checked[\s\S]*?return false;/);
  assert.match(s, /UpdatePolicy.Hold currentHold[\s\S]*?s.abandon\(\);[\s\S]*?return false;/);
  assert.match(s, /s.commit\(cb.getIntentSender\(\)\);\s*return true;/);
  assert.match(s, /catch \(IOException \| NoSuchAlgorithmException \| RuntimeException e\)[\s\S]*return false;/);
  assert.doesNotMatch(s, /return;/);
  assert.equal((s.match(/return true;/g) || []).length, 1);
});

test('asynchronous install failure and missing confirmation also restore the meeting', () => {
  const s = java('update/Updater').split('static void onStatus(')[1].split('/** MY_PACKAGE_REPLACED')[0];
  assert.match(s, /if \(confirm == null\) \{[^}]*resumeAfterFailedUpdate\(app\);[^}]*return;/);
  assert.match(s, /if \(status == PackageInstaller.STATUS_SUCCESS\) \{[^}]*return;/);
  const failure = s.slice(s.indexOf('String why = UpdatePolicy.failureMessage'));
  assert.match(failure, /resumeAfterFailedUpdate\(app\)/);
});

test('failed update uses the existing visible resume path; background stays paused with a notice', () => {
  const s = java('mizel/MeetingRecorderService');
  assert.match(s, /resumeUpdateFromActivity\(android.app.Activity a\) \{ resumeUpdate\(a\); \}/);
  const body = s.split('public static void resumeAfterFailedUpdate(Context c)')[1].split('private void restoreUpdate')[0];
  assert.match(body, /onMain\(\(\) -> \{/);
  assert.match(body, /if \(ai.wizards.os.device.AppState.front\(\)\) resumeUpdate\(c\);\s*else for[\s\S]*if \(MizelUpdatePolicy.pending\(j\)\) notifyUpdatePaused/);
  assert.match(body, /if \(!MizelUpdatePolicy.canResume\(j, MizelConfig.origin\(a\)\)\) continue;/);
  assert.match(body, /if \(canStart\(a\) != null\) \{ notifyUpdatePaused/);
  assert.match(body, /send\(a, ACTION_RESTORE, j.meetingId/);
});
