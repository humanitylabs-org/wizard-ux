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
| Debug-only origin files, component identity, compositor touch taps | AppState, MainActivity, qa_aa_lib.Page; CDP hit-tested CSS viewport coordinates |
| Notification runtime permission | product declares POST_NOTIFICATIONS; fresh debug APK install uses `adb install -r -g` on verified SDK 35 |
| Fixture startup readiness | existing bounded `wait(self.state, 20)` already retries `URLError`/connection refusal through `OSError`; regression-replayed, no source change needed |
| Agent/session query and picker selectors | share-wizard.js and Proxy private/default session responses |
| Share/upload routes, payload fields, chunk acknowledgments | ShareClient, ShareHttp, ShareService, ShareQueue and share-fixture.mjs |
| Queue custody, process restart and background resume | native files/share-out item schema, ShareUploader/ShareService and MainActivity resume hooks |
| Notification label, PendingIntent target and thread handoff | ShareNotifier and MainActivity ACTION_THREAD/queueHandoff |
| Cancellation and cleanup | device.js native finish callback, ShareStore, bounded exact emulator PID/ADB-serial cleanup |

These are source/controller findings only. Preserve every failed receipt and all
screenshots/logs; only the parent's new heavy run can establish the real phases.

## Asynchronous input regression (controller-only)

The `0446ac24290b` run passed external-boilerplate, then asserted the chat label
immediately after input. Its saved `failure-agent-and-chat-dom.json` already shows
`Trip planning` and a closed picker: input completion raced app event handling.
The QA runner now waits on that exact label **and** picker closure, with the
existing bounded predicate poll, not an added fixed delay or repeated tap.
The other post-input reads were audited: opening a picker, private-agent loading
and target reset, private chat selection, comment focus/value, and Back picker
closure now await their domain state before subsequent input/assertions. Existing
content, disabled-agent, scope, byte/hash, delivery and notification assertions
remain mandatory. Cancel/Send already wait for sheet closure; notifications
already wait for native foreground, handoff log and focused DOM.

WebView controls use `Input.synthesizeTapGesture` (50 ms, one touch tap) at a
hit-tested visible CSS point, recording selector/coordinate/method in `web_taps`.
No DOM `.click()`, event dispatch or application function substitutes input; CDP
errors fail closed, without a programmatic fallback. External sender and System
UI notification controls still use real adb taps. Controller tests prove delayed
state acceptance, bounded permanently-wrong refusal and the compositor command
contract; these are not native acceptance. Preserve the failed run; only the
parent's fresh immutable `--reuse-build` stage may run all emulator phases again.

## Real-touch regression: bounded diagnostic + acceptance

The `3b1fa525ff2e` run is **not** the previous assertion race. Its sole recorded
compositor tap was `.dv-chat` at CSS `(206.0952491760254, 698.2857055664062)`;
the first picker-open predicate timed out and the saved DOM still said New chat
with no picker. The earlier raw-touch run opened the picker and selected Trip
planning. Both ran the same product APK; the latter regression followed a QA-only
change. No crash was recorded. Do not label this a product bug from that evidence.

Source audit: `HomeScreenShortcuts.attach` observes native touch but returns false;
`qa_aa_lib.Page.call` returns the whole CDP response, not a delivery receipt;
`.dv-sheet` has a 260 ms transform transition. The old locator scrolled on each
poll and sampled a point just once, allowing a point to become stale while the
sheet/scroll moved. Those facts establish a missing stability gate and missing
delivery diagnostics, **not** proof that animation caused this particular miss.
The prior log has no event target, viewport/scale, prevention or cancellation
receipt. The exact compositor failure mechanism remains unproven.

The next QA-only stage therefore keeps one real compositor touch (no raw-touch
fallback, DOM click, repeated tap, JS application call or weakened assertion):

- Scroll only when the target has no hit-tested visible point, at most once.
  Require the same element, rectangle, viewport and hit point to settle within
  0.25 CSS px for at least 120 ms/three frames, with no running ancestor animation.
  Refuse replacement, disabled/hidden/occluded controls or instability at 3 s.
- Passive capture/bubble listeners observe trusted pointer/touch/mouse/click,
  cancellation/contextmenu, target/hit coordinates, default prevention, viewport,
  visual scale, DPR, focus and WebView UA. No handler is replaced or canceled.
  This adds observation, not activation; listeners themselves are a QA change.
- Write `web-tap-NNN.json` before dispatch, then store raw CDP response and command
  duration plus bounded frame/event journals (64/128 entries). An ACK alone is
  insufficient: require the ordered trusted target touchstart/end/click chain
  within 3 s or stop this run immediately with the same failure diagnostics.
- On any subsequent domain-wait failure, refresh that exact tap's journal and
  retain the failed predicate. All original picker/agent/comment/scope assertions
  and real APK/bridge/backend/hash/delivery/notification checks remain intact.

Interpret the next receipt without guessing: no events means dispatch/delivery;
wrong target/coordinates means hit mapping or movement; cancellation/contextmenu
means gesture semantics; correct trusted click with absent picker means investigate
the product event path using the retained capture/bubble prevention and DOM state.
Controller replay proves the bounds/refusals and passive code contract, not native
acceptance. Parent alone submits the frozen full-acceptance spec; it stops early
on missing delivery. Preserve every earlier log, screenshot, APK and JUnit XML.

## Warm sender-case regression (historical; subsequent native runs failed)

The `6d830a01a92d` run passed external boilerplate, private agent/chat scope,
outside cancellation with no backend write, and native Back/Cancel. Its
`existing-delivery` failed **before Send**, at `Rig.share('genuine')`'s staged
subject assertion. Saved `sender-3-genuine.png` visibly still says `x.pdf`;
`sender-3-genuine-activity.txt` shows the same resumed sender ActivityRecord.
Logcat records the sender restart attempt with `result code=3` (delivered to top).
The failure DOM also shows `x.pdf` and no genuine quote. The fixture previously
read `fixture_case` only in `onCreate`, capturing that name/text in its listener.
This is evidenced stale source-fixture state, not proof of a product defect.

Only the fixture now handles `onNewIntent`: call super, `setIntent(intent)`, then
rerender both title and button listener through the same `renderCase()` as cold
creation. No force-stop/new-task workaround, no product Android/web edit, no
assertion removal or input fallback. Both forward (`boilerplate → genuine`) and
reverse (`genuine → boilerplate`, needed for the resumed new-chat case) matter.

- Before each native source tap, retain the launch output, native XML, screenshot,
  activity and requested/actually rendered case. An exact package-scoped visible
  title must match the request; a stale title refuses **before tapping**.
- Save staged native metadata **before** subject/text/item/hash assertions, so a
  later stale payload remains diagnosable rather than disappearing at failure.
- Controller tests replay forward/reverse and stale native-XML transitions,
  refusal before tap, pre-assert payload persistence and original hash refusal.
  These tests use mocks/saved XML, not an emulator.
- Before compiling the sender APK, the parent's admitted forum run also compiles
  the **actual SenderActivity.java** against small host-JVM Android seam stubs.
  One Activity receives cold boilerplate → warm genuine → warm boilerplate; real
  generated button listeners must emit matching subjects/text, URI/ClipData,
  explicit receiver, MIME/read grant and source files. This executable regression
  is staged, **not run by the child**; `sender-lifecycle-replay.log` and the
  `PASS_HOST_JVM_SEAM_ONLY` checkpoint remain distinct from actual Android proof.

The remaining source-contract audit found no additional evidenced mismatch in
comment insertion/keyboard Back, native durable queue interruption/restart,
background resume or notification PendingIntent handling. The final notification
selector may still encounter grouping/order; only an actual System UI tap plus
exact foreground-thread DOM/log readback can pass, never a constructed intent.
The previous crash buffer contains a `UiAutomation` process `Bad file descriptor`
after failure diagnostics, not an identified product-process crash. Retain that
buffer and the existing fail-on-crash guard; do not convert the failed run to pass.

Stage a fresh sibling `--reuse-build` directory. Bind and preserve the original
381 JUnit tests, APK `0dc7751eaff2393b6939c1b1ee58feab8df670cb95a926ec9fd9a7abd51e15fd`,
all prior receipts and passed/failing proof bytes. Rerun every existing native
phase (including passed cases) without weakening their assertions or trusted tap
journals. The child does not compile, start an emulator or submit; the parent
alone admits the frozen forum/heavy spec once. Record the executed failed
`6d830a01a92d` job in the durable latest pointer so a schedule cannot replay it.
Recheck free space minus the 3 GiB job budget exceeds the 200 GiB reserve.

## UIAutomator freshness repair after executed `3026d7a33268` (also failed at `bed4183ad145`)

The failed run `heavy_017efda3e6794a9d8b6fb3f1ad3a5a0b` reached the
`existing-delivery` pre-tap check and requested genuine but observed boilerplate.
Direct inspection of **both** `sender-3-genuine.png` and
`failure-existing-delivery.png` shows the foreground source app rendering
`x.pdf`, agreeing with the saved XML. This is not proof of an XML-only stale
read or a product defect. `sender-lifecycle-replay.log` passed the actual Java
source's host-JVM boilerplate → genuine → boilerplate seam; `am start -W`
reported delivery to the top-most instance. That launch acknowledgment does not
establish that Android rendered the new case. Why this native observation still
shows the old case remains unproven.

The confirmed harness defect is independent: `Rig.ui` dumped to a fixed path,
suppressed every dump error with `|| true`, then consumed whatever XML remained.
That could mislabel earlier observations even though these screenshots agree.
The minimal QA-only repair now:

- Generates a unique path **per dump attempt**, requires it absent before dumping,
  successful command exit and an existing nonempty valid hierarchy afterward.
  No read of the legacy path or any failed attempt is allowed.
- Bounds a snapshot to three attempts and its caller's remaining deadline. Saves
  separate dump stdout/stderr, exit/error, timestamps, UUID/path and accepted XML
  SHA-256 in `native-ui-observations.jsonl`, with each accepted XML retained.
- Waits at most 30 seconds for the requested package-scoped visible title **and**
  actionable native button. Saves every case observation and freshness receipt,
  final XML/screenshot/activity and launch output. Permanent wrong case or dump
  failure refuses before the sole source tap; no relaunch, force-stop, repeated
  tap, DOM activation or fallback input.
- Adds controller negatives for stale legacy files plus failed dump, exit-zero
  missing/malformed file, path collision and timeout, and positive fresh retry
  hash binding. Delayed requested case waits; permanent wrong case and repeated
  snapshot failures stop at the bounded deadline.

Only the QA runner, controller regressions and this gate document change from
`3026d7a33268`. Product Android/web and SenderActivity source remain unchanged.
Keep the original APK hash and all 381 JUnit passes plus prior passed native
phases as inherited proof, not a native pass at the new source. A fresh frozen
sibling `--reuse-build` stage reruns the existing native phases under parent
forum/heavy admission only. Mark `3026d7a33268` executed-failed/do-not-resubmit in
the local and remote latest pointers; preserve its exact failure proof. Check
free space minus 3 GiB still exceeds 200 GiB. No rebuild/sign/deploy/merge.

## Explicit sender Intent delivery after executed `bed4183ad145`

`heavy_a490e9385d9144ef9cda980dc025e291` executed and failed before the
genuine source tap: requested `genuine`, actual native title `x.pdf`, including
fresh valid dumps throughout the existing 30-second bound. Its worker log SHA256
is `424e5c45eac64268c288968f80d71ac05b3aadfb288cde171bbcad75e01b9e7c`.
Passed file/comment display, private agent/chat scope, outside cancel and native
Back remain preserved. Delivery/recovery/notification acceptance is still open.

**Constant correction:** Android 15 AOSP
[ActivityManager.java](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/android15-release/core/java/android/app/ActivityManager.java)
defines `START_TASK_TO_FRONT = 2` and `START_DELIVERED_TO_TOP = 3` (base success
code is zero). The recorded `result code=3` and shell "delivered" warning are
consistent with framework delivery, **not** proof of task-front-only behavior.
The manifest has no `launchMode` override (default standard), and the staged
Activity and compiled DEX already contain `onNewIntent` and `setIntent`.
Consequently "the callback was never invoked" is unconfirmed; prior evidence
proves stale rendered fixture state, not the precise native mechanism.

The minimal fixture command now explicitly uses
`am start -W --activity-clear-top --activity-single-top -n
qa.unifiedshare.sender/.SenderActivity --es fixture_case <case> --es
fixture_launch <32-lowercase-hex-id>`.
[Intent.java](https://android.googlesource.com/platform/frameworks/base/+/refs/heads/android15-release/core/java/android/content/Intent.java)
documents that CLEAR_TOP alone can recreate a standard Activity, while combining
it with SINGLE_TOP delivers to its current instance; its shell parser maps both
literal options to those flags. This defines the fixture's launch semantics; it
does not retroactively establish the old failure's cause. It neither clears the
task nor force-stops Wizard to repair the sender (the existing deliberate
process-death upload recovery test is unchanged).

After rendering, `onCreate`/`onNewIntent` log only an allowlisted synthetic case,
event and launch ID read from the **stored** `getIntent()`. The pre-tap gate
requires one exact receipt for the current launch (`onCreate` cold,
`onNewIntent` warm) plus the requested visible case and scoped native button.
Old/missing/duplicate receipts, wrong lifecycle events and wrong cases
cannot authorize a tap, even when the shell ACK or old UI looks right. The
existing deadline, fresh XML files, screenshots, activity dumps, trusted touch,
staged payload and independent sender hash checks remain intact. No extra sleep,
relaunch, repeated tap, product/manifest change or wider acceptance bypass.

Controller transport regressions exercise cold boilerplate → warm genuine →
warm boilerplate through the real command builder, receipt parser and share
controller, plus missing flags, stale same-case receipts and wrong-case refusal.
These are **controller seam evidence**, not Android proof. The admitted worker
also replays the actual Java Activity with log stubs, explicitly labelled
`PASS_HOST_JVM_SEAM_ONLY`; it remains distinct from fresh real native receipts
and receiver metadata/hash proof in all the original emulator cases.

Stage a fresh immutable sibling with the same `--reuse-build` protocol and APK
`0dc7751eaff2393b6939c1b1ee58feab8df670cb95a926ec9fd9a7abd51e15fd` plus
381 unchanged JUnit passes. Preserve all previous attempts and mark `bed4183ad145`
executed-failed/do-not-resubmit in the latest pointer. Recheck the 200 GiB reserve
after the 3 GiB budget. Only the parent admits this stage; no child execution,
signing, release or merge. Native success and the old failure's exact mechanism
remain unproven until those new receipts execute.

## Actual Send failure: preserve the error before choosing a product fix

The executed `bb27f765e77e` run is **failed, never resubmit**. Its fresh native
`onNewIntent` receipt and visible genuine case agree with staged `genuine.pdf`,
source quote and independently checked SHA256. The real trusted Send tap selected
Private / Private notes with `Synthetic comment one`. The sheet reopened with
`Couldn’t send · check the connection and try again`. Retained network receipts
contain **no POST /wizard/v1/shares and no upload write**. This is not the old
sender lifecycle failure, and increasing the five-second deadline cannot fix it.

The current retained diagnostics do **not** contain the exception swallowed by
`deliver` or the native message-port error, nor the post-Send native queue files.
A fixture capability error, WebView fallback error and native queue failure are
not interchangeable diagnoses. Do not change product code on that evidence alone.

The next QA-only sibling uses the unchanged sealed APK/JUnit and full original
acceptance. Immediately before each sole real Send tap it installs source-hashed,
line-bound CDP **false conditional logpoints** in the existing port request,
port reply and share delivery catch. These only copy real locals into a QA-owned
array; they do not replace a bridge/handler, change a request/result, pause JS,
call a share method, synthesize success or retry ambiguous writes. An unbound
logpoint refuses input. Repeated sends reuse the same debugger points while
resetting their observation array. Controller checks are not native logpoint proof.

`<phase>-before/after-bridge.json` records actual capability/port presence and
request/reply/error observations. `<phase>-before/after-native-custody.txt`
records only this isolated synthetic app's staged/queue metadata and file inode,
link count and size, never raw payload bytes. Existing network, fixture, DOM and
logcat evidence remains independent. `send-observation-logpoints.json` records
exact source hashes and resolved debugger locations. The five-second sheet-close
deadline and every delivery/resume/notification assertion remain unchanged.

Only the parent may admit this bounded diagnostic. No native rebuild is justified
yet. After the captured error establishes a cause, fix that cause with a regression;
a native product correction requires a **new full sealed build**, never a QA-only
allowlist change. Until then, delivery, recovery and notification gates are unmet.

## KVM prerequisite failure: preserve attempted diagnostic, refresh only its group

The `ad7256a14620` diagnostic was attempted as
`heavy_05a635a235d64fc886be711506c4bc34` and failed **before Android boot**.
Its worker log SHA256 is
`b9a4ea7c455ffaaa47ff554f5e58cc4ff97e9d6640efb262289296fd874855bf`.
`actual_android=false`, all native cases are NOT_COVERED, and the Send logpoints
never ran. Preserve the failed directory/receipt; never resubmit that spec.

Read-only diagnosis establishes an identity inheritance failure, not a missing
host entitlement: `/dev/kvm` is root:kvm (gid 993), mode 0660; `james` (uid 1000)
is already a member. Fresh SSH opens KVM and gets API 12. The long-lived user
manager PID 1490 and worker PID 69436 instead retain supplemental groups
`24 27 29 44 46 100 101 1000` without 993. The worker has no private devices,
device-deny policy, seccomp or no-new-privileges restriction. A tiny transient
unit through that same user manager reproduces errno 13; its `sg kvm` child
stays uid 1000, changes its effective group to existing kvm, opens KVM/API 12
and preserves an inherited pipe FD. No emulator/VM or heavy work ran in that probe.
This does not establish when/why the manager's group set became stale, or mean
fresh SSH access proves the unspecialized daemon now has KVM access.

Use the existing forum runbook's **per-job** route, not a shared service restart:
parent submits the fresh sealed stage as `/usr/bin/sg kvm -c 'exec
/usr/bin/python3 <new-root>/qa_unified_share_android.py --reuse-build --seal
<new-root>/reuse-seal.json --seal-sha256 <digest>'` on forum/heavy. The queue and
inherited lease remain required. No global ACL/mode change, new group membership,
user-manager restart or shared-worker restart is performed by this diagnostic
preparation. A concurrent service configuration repair was subsequently observed: the
unit gained `20-kvm-group.conf`, wrapping its unchanged worker executable in
`sg kvm`, and restarted at 09:59:25 UTC. Its replacement PID 2350024 has uid 1000
and real/effective gid 993; the user manager is still PID 1490. Preserve that
separate observation rather than claiming this child performed the restart or
that the original worker PID stayed unchanged. The per-job route remains safe
and explicit; permanent service lifecycle changes belong to its release owner.

The runner now opens KVM and reads only its API before creating an AVD, retaining
the effective identity in the receipt. A terminal emulator exit escapes transient
boot polling immediately with its real return code, rather than consuming 360 s.
Cleanup skips `adb emu kill` only when the owned process already exited, still
reaps it and requires exact serial absence; live-process kill failures and stale
serials remain failures. Controller negatives cover those distinctions.

Keep the original APK/381 JUnit passes and **all original native cases**, trusted
single Send tap, unchanged five-second deadline and source-bound false logpoints.
Prepare a new immutable sibling and recheck free minus 3 GiB exceeds 200 GiB.
This scoped KVM route repair is not fresh Android/Send acceptance, a product fix,
or authority to rebuild/sign/publish/merge. The parent alone admits it once.

## Real device phases and evidence

The separate synthetic source app generates a 24 MiB blank-page PDF fixture byte
payload, opens a content provider and grants a **real ACTION_SEND** read URI grant
to the actual debug ShareActivity. This is an explicit receiver test, **not** a
claim about Gmail, the OS chooser or third-party account integration. The sender
source screenshot, native activity state, native private staging metadata/hash,
network receipts and byte equality distinguish this path from JS share mocks.
CDP reads rendered state/locates controls and supplies compositor touch taps;
adb performs native sender/notification taps and Back/Home. CDP
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
