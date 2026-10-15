# Voice custody recovery — UX #13

## Contract

A submission owns its original audio, typed context, uploaded attachment references, sealed composer key, client ID, destination and model/provider/agent route. Navigation does not transfer that ownership to whichever screen happens to be open later.

- IndexedDB is primary. A complete per-item localStorage backup includes the audio bytes; text-only legacy rows with missing audio cannot silently send.
- If both stores fail, the complete Blob stays in RAM, retrying storage, with a persistent keep-open warning and unload guard. Upload precedes transcription. RAM is never described as saved.
- Browser MediaRecorder chunks are journaled during capture, with coalesced writes. Finish adopts that journal rather than leaving a second recovered recording.
- Compact terminal markers survive failed fallback cleanup, so dismissed/sent records do not resurrect. Initial IDB read failure remains retryable, even with an empty in-memory queue.
- Phone staging, empty speech and locally handled commands use awaited persisted transitions. Locally handled audio is retained but not queued to the agent. Delayed command follow-ups retain the original custody ID.
- Startup reconciles hidden sealed composers against outbox ownership before restoring text/files. An unavailable initial store does not justify restoring a duplicate composer.
- Transcription and route resolution have deadlines. Retries keep the same frozen admission body and idempotency key. A lost admission response reconciles through that key.
- Native notification/recovery reads validate completion and known byte length. Reading does not claim/hide the pending native owner; `recDone` follows durable web handoff or a confirmed server receipt, never a RAM-only enqueue. No Android ABI or Back-stack implementation is changed.
- Eight existing attachments plus audio exceed the current eight-file admission limit: retain all originals and report the limit rather than silently dropping an image.

### Explicit behavior and limits

The old direct steering path has no verified idempotent receipt contract. Voice/text submissions to a working thread now use the idempotent run queue for that same thread, not a non-idempotent steer followed by a duplicate fallback run. Restoring immediate steering requires a server-side idempotent steer/reconciliation contract; this tradeoff needs release-owner approval.

No browser can guarantee recovery of bytes MediaRecorder has not emitted, or RAM-only bytes after process death while both durable stores and upload are unavailable. The UI warns rather than claiming otherwise. The journal protects emitted chunks and the full submitted Blob after a successful store/backup handoff.

Audio upload and run admission receipts are checked independently. Synthetic tests prove the client request and recovery logic, not actual server disk durability or Android hardware behavior.

## Verification

All browser QA ran directly on Thales, with work/profile/scratch/evidence data under `/Volumes/ThalesMedia`. It did not wait on the Android/VM worker lock. No Android build, VM build, merge or deployment was performed.

Rebased onto daily `14068d1`. The evidence manifest pins the exact tested commit and runtime/harness hashes; compare these before release.

| Suite | Result | Evidence file |
| --- | --- | --- |
| `qa-voice-custody.cjs` | 46 passed, 0 failed | `outbox/receipt.json` |
| `qa-voice-custody-callers.cjs` | 36 passed, 0 failed | `callers/receipt.json` |
| `qa-recording-retention.cjs` | 52 passing gating assertions; 1 pre-existing known defect | `retention/results.json` |
| `qa-in-app-dictation.cjs` | 116 passed, 0 failed | `dictation.json` |

The retention suite's existing `known_defect` marks palette dictation inserting in the hidden palette rather than the previously focused field. It is not counted as a passing acceptance assertion here. Total: **250 passing gating assertions**, plus that separately reported defect.

Evidence root: `/Volumes/ThalesMedia/WizardUX/voice-custody-recovery-20261015/evidence/`. `source-and-results.json` records hashes for 119 runtime/harness files and the JSON receipts. These hashes were compared with the local committed tree: no mismatches. Logs sit beside the suite directories; `callers/phone-save-failed.png` is the phone warning screenshot.

A daily-source negative control failed 11 assertions before reaching its expected recovery timeout (5 assertions passed; exit 2). Its partial receipt and log are retained as `baseline/receipt.json` and `baseline.log`; it was not a completed baseline suite.

### Reproduction

Set `PLAYWRIGHT_MODULE` and `CHROMIUM` to installed tooling on the QA host, and use a checkout/evidence/scratch directory on the external work volume. Every endpoint in the two new harnesses is synthetic; no real agent messages are sent.

```sh
export TMPDIR=/Volumes/ThalesMedia/tmp
export QA_PLAYWRIGHT="$PLAYWRIGHT_MODULE" QA_CHROME="$CHROMIUM" PW="$PLAYWRIGHT_MODULE"
QA_OUT="$EVIDENCE/callers" node qa-voice-custody-callers.cjs
QA_OUT="$EVIDENCE/outbox" node qa-voice-custody.cjs
node qa-recording-retention.cjs web "$EVIDENCE/retention"
QA_EVIDENCE="$EVIDENCE/dictation.json" node -r ./qa-thales-loader.cjs qa-in-app-dictation.cjs
```

## Remaining release gates

1. Independent source review, including the run-queue-versus-steering tradeoff.
2. Actual Android device acceptance: notification Send, WebView restart/process restart, full device storage, native read interruption, original route and exactly one server run. Browser-native mocks are not this evidence. Use the existing Thales Android route if a build is required.
3. Authorized integration/live acceptance and release. This branch is not deployed. Minor web fixes do not require rebuilding the guest VM.
