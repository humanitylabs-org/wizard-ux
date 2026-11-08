# Recorder continuity through an Android app update

REUSE: `MizelJournal` / `MizelStore` remain the sole meeting, WAV sequence and media-time journal; `MizelUploader` keeps uploading to the existing configured origin. EXTEND: both existing package-replacement receivers and the existing visible-Activity/notification path. No second recorder, no new meeting, no new manifest receiver.

## Android decision

Target SDK is 35. `MY_PACKAGE_REPLACED` is an exemption from the general background foreground-service start ban, **not** an exemption from microphone while-in-use permission restrictions. Android 14+ checks microphone permission at service creation and a permission check returning granted does not authorize background microphone access. Use a high-importance notification whose PendingIntent opens the existing meeting Activity directly; its `onResume` resumes the microphone service without another prompt, provided microphone permission is still granted and the microphone is free. The existing updater attempts to reopen the app; when Android allows that, recording resumes automatically. When it refuses, a single notification tap (or the next ordinary app open) resumes the same meeting. This implementation deliberately does not depend on device-owner, VoiceInteractionService or overlay privileges.

Evidence, retrieved 2026-11-06:
- https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start#background-start-restriction-exemptions lists `ACTION_MY_PACKAGE_REPLACED`.
- https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start#wiu-restrictions explicitly says while-in-use restrictions apply even to general background-start exemptions and says to start with a visible Activity.
- https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start#wiu-restrictions-exemptions lists notification interaction; package replacement is absent.

## Persisted intent and safety

Only an explicit install tap interrupts an active native meeting. The updater waits for capture to stop, the last WAV to flush, and a durable `resumeAfterUpdate` journal write before bypassing the meeting hold. Manual pause, mic loans, ordinary crashes and user Stop do not opt in. The paused journal carries the existing meeting ID, next sequence, pending/acked chunks, media samples, capture binary version and upload origin. Authentication remains with the existing persisted installation configuration, never copied into the journal. A changed origin cannot start recording.

Package replacement also adopts an active old-version journal when the app was installed over itself outside this updater. Both existing receivers call the same idempotent handler; neither opens a microphone. Version mismatch protects against an upload job/Activity running before the package receiver on future updates. A legacy journal without version metadata is migrated only by a real replacement broadcast; an ordinary legacy crash is not guessed to be an update. On the **first install of this fix**, an older app that already sent a user stop/process-death stop cannot be resurrected. Likewise, an old journal lacks enough information to distinguish a pre-update unhandled crash from a take killed during replacement; it is treated as the existing journal's open recording, never as a new meeting.

The existing chunk-recovery path adopts the last partial WAV without closing the session. Resume refuses unadopted nonempty chunk files, preserving evidence rather than overwriting a sequence. A user Stop clears update intent before any queued resume command can admit the microphone. Update pauses do not run the ordinary 30-minute pause-to-stop timer. Native bridge status reports `recording:true`, `paused:true`, `phase:paused_for_update`; it returns to the normal state after successful microphone admission. No `/stop` is sent just for an app update. The server retains the active meeting; this patch does not add a new server-side paused status endpoint.

## Aborted installation

A durable update pause is rolled back if policy/permission changes prevent installation, the APK disappears or changes, a late recording hold wins, or session creation/copy/commit throws. The installer reports whether it actually accepted custody; every earlier exit runs the same rollback. Asynchronous installer failure (including user cancellation) and a missing confirmation Intent also enter that path. A visible app resumes the same meeting through the existing origin/Stop/mic-permission fences; a background app keeps the paused journal and tap-to-resume notification, never starting a microphone in the background.

The native rollback correction was added after the published 0.10.26 build (`build/meeting-resume-0.10.26`, `92555ed4`); it is not present in that APK. This PR repair does not rebuild, sign or republish the owner APK. The feature-reference ratchet admits only the exact native Recorder integration counts; web-shell limits remain unchanged.

## Verification

- `nice -n 19 timeout 120 node --test tests/meeting-update-wiring.test.mjs`: 11 passed, 0 failed, including aborted-install wiring regressions (source checks, not Android device execution).
- Focused `feature-ids-in-core.test.mjs` and `components-inventory.test.mjs`: 3 passed each; web-shell limits unchanged; inventory remains under its 14,000-byte cap.
- `node --check web/device.js` and `git diff --check` passed.
- Seven JVM tests added in `MizelUpdateResumeTest`: version mismatch vs crash; manual pause/Stop; acked sequence plus a torn final chunk across reload; origin/missing-meeting rejection; idempotent broadcasts; legacy defaults; journal write failure.
- JVM tests, Gradle compilation/lint, Android 14/15 update/reopen/notification behavior and phone/desktop skin screenshots **have not run**. They require the parent's queued forum build/QA. No APK has been built, submitted or published by this worker.

## Release custody

The requested `wizard-mobile` repository does not own this service/updater. The production implementation is `wizard-ux/android`, package `ai.wizards.os`; do not build the unrelated `wizard-mobile` app or use its signing key.

At preparation time the owner feed is 0.10.25 / 89. Candidate is 0.10.26 / 90; the parent must check the feed again before publication to avoid a concurrent-version collision. The feed APK SHA identifies signed forum receipt `/srv/work/AndroidBuilds/jobs/20261106T120240Z-1e156f28/receipt.json`, source `cdfd788dc2ee43ee8df06ed229b1e52d15933dfe`. Production Android sources contain features not yet on main. The build integration worktree therefore keeps that published Android source tree and applies this PR's focused changes on top; unaffected native sources must remain byte-for-byte identical. The focused PR remains based on fresh origin/main.

Use `android-build-forum --prepare-only`, host forum, `/srv/work`, WizardOS signing env `/home/james/.wizard-secure/wizard-os/signing.env`, certificate SHA-256 `3bf74d0b597bc170761079909d3692428702ba057f753ee1ffd62da3c76ed1fd`. Include the private owner Gradle properties from forum `/home/james/.wizard-secure/wizard-os/wizard-address.gradle.properties`; an origin-less APK is refused by the owner-feed publisher.

After the parent queues the returned spec and the successful receipt/tests are inspected, retrieve `artifacts/app-release.apk` and `receipt.json` from the prepared job. Audit with `python3 tools/publish_owner_phone.py --apk <artifact> --receipt <receipt> --notes 'Recorder keeps the same meeting through app updates; recording resumes on app reopen or one notification tap.'` (audit-only by default). Only the authorized publisher adds `--publish`, which stages the APK, backs up and updates the private `/reports/wizard-os/latest.json` feed last, then verifies exact artifact/feed bytes. Verify both through the served private URL afterwards. Never send an APK to sideload. Do not merge the focused PR or publish this candidate before review/build acceptance.
