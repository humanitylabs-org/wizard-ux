# Voice custody recovery — UX #13

## Contract

A submission owns its original audio, typed context, uploaded attachment references, sealed composer key, client ID, destination and model/provider/agent route. Navigation does not transfer ownership to the screen opened later.

- IndexedDB is primary. Per-item localStorage backups include the original audio bytes. RAM-only custody is labelled honestly, warns before unload, and retries storage.
- Capture journals protect emitted MediaRecorder chunks. Finish transfers the same owner instead of creating a second recovered recording.
- Terminal markers prevent replay of dismissed/sent items. Recovered rows are quarantined until both stores can be read and terminal records reconciled. Retry cannot bypass quarantine or overwrite an unread terminal marker. Unrelated fresh submissions are not blocked.
- Locally handled audio is retained without delivery intent. It cannot mark a completed thread Sending or mask an older genuine pending delivery. Compact terminal markers release pending ownership.
- Transcription and route resolution are bounded. Audio upload and run admission receipts are validated separately. Attachment overflow retains originals instead of silently dropping a photo.

### Immediate active-run steering

Working-thread text, attachments and voice steer the captured run immediately; they do **not** create an extra queued run. The destination, run, model/provider/agent, input and file IDs are frozen before dispatch. A run ending or being replaced never silently retargets the request.

The service's ordinary steer proxy forwards the idempotency header without a durable replay ledger; its queued-run steering branch appends guidance without deduplication. Therefore the client does not assume steer idempotency:

1. Persist a dispatch journal before the mutation. If storage cannot preserve the journal, do not dispatch.
2. Accept only an explicit boolean `accepted: true` receipt. If `run_id` is supplied, it must equal the captured target. Preserve `steered` and queued-steer status on success.
3. Lost, malformed or server-error responses become **Could not confirm steering**. Keep original bytes, text, files and the frozen request. Reload, Retry and automatic retry cannot repeat this unknown mutation or fall back to new-run admission.
4. An explicit client rejection retains an editable/retryable original. Retry uses the same target and request bytes; it does not switch to a replacement run.
5. Transcript absence is not proof of rejection. It cannot trigger a second admission after accepted steering.

This is a bounded client-only repair. No companion service change or core runtime change is required for this protocol. Unknown delivery requires human reconciliation, not automatic replay.

### Native custody

Active finish and recovered/notification Send share a validated reader. It requires an explicit final chunk marker, monotonic exact chunk offsets and the exact positive byte count from native metadata. Partial reads never enter web custody or call `recDone`.

Already-stopped takes are inspected without `recClaim`. Shipped bridges implicitly claim in `recStop`; before invoking that ABI, the web caller persists a reload-visible exact-ID recovery marker and records returned metadata before reading bytes. On read failure the native original and route pin remain discoverable after a same-process WebView reload. `recDone` is deduplicated and follows exact durable web custody or a confirmed server receipt, never a RAM-only enqueue.

No Android ABI or Back-stack implementation is changed. Browser-native fixtures are not actual Android acceptance.

## Verification and reproduction

Run browser QA on the designated external-volume QA host, not behind an Android/VM worker lock. Supply installed tooling and an external-volume evidence directory:

```sh
export QA_PLAYWRIGHT="$PLAYWRIGHT_MODULE" QA_CHROME="$CHROMIUM" PW="$PLAYWRIGHT_MODULE"
QA_REPAIR_ONLY=1 QA_OUT="$EVIDENCE/focused" node qa-voice-custody-callers.cjs
QA_OUT="$EVIDENCE/outbox" node qa-voice-custody.cjs
QA_OUT="$EVIDENCE/callers" node qa-voice-custody-callers.cjs
node qa-recording-retention.cjs web "$EVIDENCE/retention"
QA_EVIDENCE="$EVIDENCE/dictation.json" node -r ./qa-thales-loader.cjs qa-in-app-dictation.cjs
```

`qa-voice-custody-repairs.cjs` runs through normal caller-suite discovery and through the focused command. It covers confirmed steering from phone/desktop text and voice callers; exact routing and photos/files/audio; lost/malformed response plus reload/Retry; rejected-run retry/edit; journal storage failure; active native partial/short/missing-marker/complete reads; implicitly claimed Stop and same-process reload recovery; primary failure **after successful dismissal** with stale fallback; unrelated fresh sends; and held/compact pending ownership.

The outbox suite's unavailable-primary test now requires quarantine followed by authoritative storage recovery before delivery. This is an intentional protocol correction, not a weakened assertion permitting replay while terminal reconciliation is unavailable.

Final PR evidence includes source/harness hashes, suite JSON receipts and explicit process exit codes. The independent review harness is rerun unchanged. The retention suite separately reports its pre-existing palette-focus defect; that assertion is not counted as a passing gate.

## Remaining release gates

1. Independent source review of the repair and its exact-head evidence.
2. Actual Android acceptance: notification Send, WebView/process restart, storage exhaustion, interrupted reads, exact pinned route and no duplicate server admission. Native mocks do not satisfy this gate. Use the designated remote Android build/QA route if needed; do not install on a personal device without authorization.
3. Authorized integration/live acceptance and release. This branch is not merged or deployed. Minor web changes do not require a guest VM rebuild.

No browser can recover bytes MediaRecorder has not emitted, or RAM-only bytes after process death when every durable store and upload is unavailable. The UI warns rather than claiming that guarantee.
