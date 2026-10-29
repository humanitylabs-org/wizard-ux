# Unified share Android gate (prepared, not executed)

REUSE `android-build-forum --prepare-only`, its hash-manifested `worker.py`, the
synthetic `tools/share-fixture.mjs` backend and the CDP reader in `qa_aa_lib.py`.
EXTEND coverage with `qa_unified_share_android.py`. NEW only a tiny separate
`unified-share-sender` fixture APK, compiled on the worker from SDK tools.

The coordinator, not a delegated builder, submits one sealed `host=forum`,
`lane=heavy` command. Never run this script over SSH or on the VPS. The wrapper
requires forum and an inherited heavy lease, validates every staged input and
archive member, invokes the prepared worker with its lease FD unchanged, then
uses its debug APK. Source version 0.10.20/84 is an old reserved candidate:
**do not publish, merge, sign a release or update a feed from this gate**.

## Controller-only checks

`python3 tools/test_qa_unified_share_android.py -v` exercises sealing refusals,
input-locator parsing, canonical web/Android orb byte parity, failed-build JUnit
diagnostics, verified-boot reporting, the fixture contract and VPS execution refusal. It starts
no build, browser or emulator and is not Android acceptance.

## Exact staging contract

1. Commit/push this tree; prepare it using `android-build-forum --project <tree>
   --gradle-dir android --java 21 --prepare-only --output <new-controller-evidence-dir>
   :app:testDebugUnitTest :app:assembleDebug`.
2. Copy the committed wrapper beside the returned job's `worker.py` (the source
   archive has **not** been extracted). Preserve existing source/manifests.
3. Write a sibling `android-seal.json` naming `revision`,
   `source_manifest_sha256`, `node` (forum's Node22 absolute executable), and
   SHA256 `files` for `source.tar.gz`, `job.json`, `worker.py`, and
   `qa_unified_share_android.py`. Read back these exact staged files and verify
   the wrapper equals its entry in `job.json.files` and the pushed source.
4. The exact argv is `/usr/bin/python3 <job>/qa_unified_share_android.py --seal
   <job>/android-seal.json --seal-sha256 <sha256-of-seal>`; cwd is `<job>`.
   Use an immutable key containing source revision and seal digest. Give the
   whole job 4200 seconds (build sub-timeout 1800, boot 360, bounded acceptance).
5. Leave a local `parent-handoff.json` with `status=PREPARED_NOT_SUBMITTED`, the
   exact spec, source/runner/seal hashes and expected evidence paths, so recurring
   follow-through does not spawn an equivalent job. Recheck the actual heavy
   registry before admission, not transcript mentions. The child never submits.

## QA-only rerun after the sender compile failure

Use `--reuse-build` with a **new sibling QA directory**, never mutate or rerun the
old product job. The sender calls `send.setClipData(...)` as a separate statement:
Android returns `void`, so it must not be chained into `addFlags`.

The new directory contains a separate `source/` copied from the original prepared
manifest (no generated build tree), with only the five paths in `QA_ONLY_DELTA`
overlaid from the pushed repair commit. Its `reuse-job.json` carries that exact
file inventory, candidate revision and SHA256 of sorted JSON `files`. The
`reuse-seal.json` carries `mode=reuse-build`, candidate `revision`, original
`build_root`, `build_revision`, `build_seal_sha256`, the exact `apk_sha256`, Node22
path, SHA256 `files` for the new runner and reuse-job, and `build_files` hashes for
the original receipt, acceptance, build log, every JUnit XML and generated debug
BuildConfig. Also retain prior browser evidence and old failure evidence unchanged.

Invoke `/usr/bin/python3 <qa>/qa_unified_share_android.py --reuse-build --seal
<qa>/reuse-seal.json --seal-sha256 <digest>` from `<qa>`, through the parent's
`host=forum`, `lane=heavy` queue only. The same host/lease guards apply. No
`worker.py`, Gradle, Wizard rebuild or unit-test rerun occurs in this mode. It
revalidates the original sealed archive/inputs, successful build/source identity,
381 tests with zero failures/errors/skips, exact APK package/hash, debug-empty
owner defaults, original source and unchanged Android/product tree. Missing or
mismatched evidence fails closed **before** starting the fixture/emulator. It then
runs the repaired sender compilation plus every original emulator phase below.
It rechecks custody after cleanup, records the reused product revision separately
from QA revision, and writes only the new directory's `android-evidence/`.

Cleanup waits up to 30 seconds for the exact owned ADB serial to disappear after
the owned emulator PID exits; an offline serial is still present. It never kills
another emulator or the shared ADB server. Controller-only tests cover delayed
serial disappearance and timeout, receipt omission/drift/wrong identity, APK/JUnit
and source drift, and a resealed Android-source change. These are not native proof.

## Sender selector regression (controller-only)

The saved real `failure-external-boilerplate.xml` from the first reuse job shows
`SHARE SYNTHETIC PDF`, because Android renders Button labels uppercase. Its
`resource-id` is empty. `native_sender_bounds` therefore uses **exact casefolded
text only inside `qa.unifiedshare.sender`**, requiring an enabled, clickable
`android.widget.Button` with positive bounds and no explicit hidden flag. Other
native text selectors remain case-sensitive. The controller suite embeds the
unaltered XML (SHA256 `520e6150fa7bb2ce13693cac756473e88d6336e283083d16d12106296d482fac`)
without adding sealed source members. It verifies the real tap coordinate,
wrong-package/hidden/disabled/non-button/nonexact-text refusals, and the actual
`Rig.share` tap path before receiver attachment. This is selector regression
proof, not evidence that a share completed. Restage a new sibling QA directory
with the same `--reuse-build` protocol; preserve all earlier failure evidence.

## Sender debug access and remaining native-contract audit

The next failed reuse run reached the real Wizard share sheet, then refused
`run-as qa.unifiedshare.sender sha256sum files/x.pdf`: signing a fixture with a
debug key does **not** make its manifest debuggable. Only the **test sender's**
manifest now declares `android:debuggable="true"`. The product manifest and APK
remain unchanged. Immediately after installing the sender, the rig checks its
actual `run-as ... id -u` access. The independent sender SHA256 assertion remains
mandatory, including a controller regression that refuses a mismatched hash.

Audit of the remaining harness operations against the real source found one
additional concrete harness-contract error, repaired without changing product code:
- UIAutomator cannot supply rendered WebView file text on this shell. Both real
  notification taps now require foreground native MainActivity, the native
  exact-thread handoff log, and a visible, focused Chats DOM for that exact
  thread containing its expected file. The final native-XML `x.pdf` lookup was
  an API mismatch, not product evidence. No app navigation/send call is injected.

Controller checks cover manifest/package/provider identity, sender debug-access
failure, independent hash mismatch, existing startup connection retries, native
short/full activity names, and focused DOM wrong-thread/background/missing-file
refusals. The DOM expression replay uses Node with small synthetic objects, not
a browser; it must not be reported as end-to-end acceptance.

The rest of the audit matched these concrete contracts without edits:

| Harness operation | Source contract checked |
| --- | --- |
| Explicit receiver, URI authority/read grant, PDF names/size | sender manifest/Java/provider; product manifest, ShareActivity/ShareStore |
| Debug-only origin files, component identity, CSS-to-device taps | AppState, MainActivity, qa_aa_lib.Page; edge-to-edge WebView top is unpadded |
| Notification runtime permission | product declares POST_NOTIFICATIONS; fresh debug APK install uses `adb install -r -g` on verified SDK 35 |
| Fixture startup readiness | existing bounded `wait(self.state, 20)` already retries `URLError`/connection refusal through `OSError`; regression-replayed, no source change needed |
| Agent/session query and picker selectors | share-wizard.js and Proxy private/default session responses |
| Share/upload routes, payload fields, chunk acknowledgments | ShareClient, ShareHttp, ShareService, ShareQueue and share-fixture.mjs |
| Queue custody, process restart and background resume | native files/share-out item schema, ShareUploader/ShareService and MainActivity resume hooks |
| Notification label, PendingIntent target and thread handoff | ShareNotifier and MainActivity ACTION_THREAD/queueHandoff |
| Cancellation and cleanup | device.js native finish callback, ShareStore, bounded exact emulator PID/ADB-serial cleanup |

These are source/controller findings only. Preserve every failed receipt and all
screenshots/logs; only the parent's new heavy run can establish the real phases.

## Real device phases and evidence

The separate synthetic source app generates a 24 MiB blank-page PDF fixture byte
payload, opens a content provider and grants a **real ACTION_SEND** read URI grant
to the actual debug ShareActivity. This is an explicit receiver test, **not** a
claim about Gmail, the OS chooser or third-party account integration. The sender
source screenshot, native activity state, native private staging metadata/hash,
network receipts and byte equality distinguish this path from JS share mocks.
CDP reads rendered state/locates controls; adb performs taps/Back/Home. CDP
`Input.insertText` supplies only the owner's synthetic comment, not bridge/send
calls. No fixture creates a JS File or calls open/send/queue on the app's behalf.

Required phases:

- `external-boilerplate`: `Emailing x.pdf` + filename subject, empty separate
  optional comment, no quote, read-only file card, Agent always present.
- `agent-and-chat`: Agent chooser includes a synthetic private secondary agent;
  stopped entry disabled; Chat puts New chat first; agent changes reset target;
  private-only existing chats and actual scoped API query; Back closes picker.
- `outside-cancel`: outside closes the sheet, native staging removed, no shares.
- `native-back`: real Android Back cancels without exiting Wizard's root;
  separate Cancel-button case, no server side effects.
- `existing-delivery`: genuine source text stays read-only, separate comment,
  selected private existing chat, native durable upload in background, exactly
  one fixture delivery and byte-for-byte source/server SHA256, actual
  notification opens that existing thread.
- `new-chat-resume`: private New chat + file/comment, UI closes immediately;
  proxy interrupts second native chunk; force-stop/reopen retains on-disk queue;
  Home/background resume uses nonzero Upload-Offset, one delivery and matching
  SHA256; old web upload count must remain zero.
- `notification-tap`: real System UI tap opens the newly returned thread id,
  native foreground/logcat and focused visible thread/file DOM agree;
  notification has no filename/comment.

`<job>/android-evidence/acceptance.json` checkpoints each phase. Failures remain
FAIL/NOT_COVERED, never synthetic success. Logs include Gradle/JUnit counts, APK
hash, sender APK hash, network share requests, persistent queue, final fixture
state, screenshots, logcat and cleanup state. Failed builds also retain JUnit
counts, failed test names/messages and XML hashes before the build refusal; a
private traceback gives even a message-less assertion a type and source line.
`actual_android` starts false and becomes true only after an owned emulator boots
with SDK 35 and an unlocked user, not merely because Gradle ran.
All fixture APIs bind loopback;
qa_home.txt and qa_origin.txt both point to the debug-only emulator fixture before
the first launch (including the updater/Everywhere clients). No private agent data, recordings,
Messenger unlock, owner origin, owner signing material or live endpoints.

Every owned emulator is stopped in `finally`, with PID exit and serial absence
recorded. SIGTERM/INT trigger the same cleanup. Controller/source files stay
immutable; retry after a terminal run needs a fresh prepared directory, while an
unstarted/cancelled receipt may reuse identical inputs under coordinator policy.

A green receipt is **PASS_SYNTHETIC_ANDROID_DEBUG_ONLY**, not owner-authenticated
release proof, correct-key upgrade proof, physical-device QA or permission to
publish. Preserve the prior 26-check `PASS_SYNTHETIC_WEB_ONLY` evidence separately.
