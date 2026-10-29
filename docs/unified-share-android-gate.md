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
input-locator parsing, the fixture contract and VPS execution refusal. It starts
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
  logcat and visible thread title agree; notification has no filename/comment.

`<job>/android-evidence/acceptance.json` checkpoints each phase. Failures remain
FAIL/NOT_COVERED, never synthetic success. Logs include Gradle/JUnit counts, APK
hash, sender APK hash, network share requests, persistent queue, final fixture
state, screenshots, logcat and cleanup state. All fixture APIs bind loopback;
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
