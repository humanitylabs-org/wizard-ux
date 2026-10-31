# Unified share: sealed forum release packet (not a release)

## Source and identity

- Candidate: the approved opaque `Send to <agent>` sheet, reconciled onto live `c36f0748` (branch `integration/unified-share-reconcile-20261031`, draft PR against `live/agent-parity-20261022`).
- Version: **0.10.22 / versionCode 86**. 82 is published, 84 is staged by PR681 and 85 is in live but unpublished. Never relabel an APK or reuse a staged code.
- REUSE:
  - UI and bridge: `WizShareWizard`, `WizAttachChip`, `WosDevicePort`
  - forum Android worker: `android-build-forum --prepare-only`
  - native-share rig: `qa_unified_share_android.py`
  - Connect upgrade runner: `qa_android_connect.py --upgrade-only`
  - browser checks: `qa-opaque-overlays.cjs`, `tests/app-share-wizard.browser.cjs`
- EXTEND: the Connect runner gains an explicit `synthetic-fixture-paired` mode. `tools/qa_unified_share_release_packet.py` is only the sealed coordinator that runs these gates in order.
- Published baseline: **0.10.18 / code82**, SHA-256 `5e8be00bd7161e07786e7d716698d4c12cc8450f12c8ab7f3906a97009d3161d`, signer `3bf74d0b597bc170761079909d3692428702ba057f753ee1ffd62da3c76ed1fd`. Its encoded ORIGIN/HOME_URL are empty. The job re-fetches it from the feed and refuses to run if the feed has moved.
- The private owner config is generated from the forum address properties and never committed. The signed artifact must encode exactly that origin.

## The one forum job

The parent admits it with `wizard_heavy_submit(host="forum")`. The queue lease is the approval boundary.

The coordinator refuses to start on:
- a VPS or any other non-forum host, or the wrong lease inode
- seal drift: archives, manifests, job configs, workers, the coordinator, owner config or pinned browser dependency files
- reused job directories
- a signing env that is missing, not mode 600, or lacks the `WOS_*` names (only the names are checked; values are never printed)
- less than 200 GiB free plus the 20 GiB peak footprint (two Gradle working sets, two unretained AVDs, logs, browser package)

It never submits, publishes, changes a feed or deploys web source.

Gates, in order:

1. **Baseline.** Re-fetch the 82 APK from the feed. Its hash, size and signer must match.
2. **Signed build.** `:app:testReleaseUnitTest :app:assembleRelease` in a job-scoped Gradle home. The signing env is sourced inside the worker. Exactly **392** JUnit tests must run, with no failures, errors or skips.
3. **Signer and package.**
   - `apksigner verify --print-certs` must show exactly `3bf74d0b…d1fd`.
   - `aapt2` must show `ai.wizards.os` 86 / 0.10.22.
   - The DEX origin must equal the sealed owner origin.
   - The legacy Mobile key is never used.
4. **Browser.** On the exact source, run `app-share-wizard.browser.cjs` (synthetic loopback), then `qa-opaque-overlays.cjs`. Every share panel, row and option must be pixel-identical over loud text and over an empty canvas, on every skin. The job saves in-shell share sheet and picker screenshots on nebula and grove.
5. **Signed upgrade** on a fresh owned emulator.
   - 82 installs and naturally shows Connect.
   - It then gets a **synthetic paired fixture**: a persisted origin plus a data marker.
   - `adb install -r` the signed 86.
   - Checks: same UID and first-install time, marker and preferences kept, notification grant kept, non-debuggable, DEX origin recovered, no Connect screen, natural launch, Back stays inside Wizard, owned serial absent at the end.
   - This is not authenticated-owner proof.
6. **Native share** from an origin-less debug build of the same head. A synthetic independent sender sends ACTION_SEND URI grants with two exact large PDFs. Covered:
   - comment, cancel and Back
   - Agent routing, including a private-style second agent
   - existing-chat routing
   - resumable upload after force-stop
   - notification tap
7. **Cleanup.** Stop owned emulators and delete the job-scoped AVD, emulator, user and Gradle homes. Keep the signed APK, phase logs, screenshots and `acceptance.json`.

## Limits and prior visual note

Not proven: a physical handset, Gmail or the OS chooser, and authenticated sessions.

The prior notification screenshot seemed to show an earlier synthetic thread, while the receipt asserted the new thread ID. Inspect the fresh notification screenshot and readback before promotion. Don't treat it as passing by inference.

A pass still leaves these for the parent:
- review the screenshots
- publish through the checked-in owner publisher and the shared web release
- check the feed assets
- check the phones with `wizard_phone_status.py`
