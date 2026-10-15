# Meeting microphone handoff — staged capture seam

This branch is **not the complete orb feature**. Shell `web/app.js` admission is deliberately unchanged until the real native A → B → C gate passes. Do not release this seam independently as a working handoff.

## Browser host contract

`WizAppCapture.beginVoiceBorrow(eventId)` works only for the existing browser PCM meeting engine. It finalizes its partial WAV/upload chunk, drains IndexedDB writes, stops microphone **and** computer-audio tracks, and persists a boundary marker before returning `{id, meetingId, atMediaMs, pausedByHandoff, micReleased:true}`. Ownership/Web Lock/update hold remain with the same meeting. Other apps remain busy. This is a trusted host seam, not app RPC.

The caller must pin its route/target/model and its new voice take identity before starting B; keep B in the existing outbox. After B's microphone closes and **durable** custody is confirmed, call `endVoiceBorrow(id,{voiceTakeId,status})` without awaiting STT, upload or assistant work. Status may be `cancelled`; do not label cancellation as a sent request. The same meeting capture continues, preserving media offsets and upload sequence. An existing manual pause stays paused. Failed reacquisition stays paused and warns. Computer audio stays off until a fresh explicit gesture.

Local markers are retained in the capture row's `meta.handoffs`. They are **not yet backend events or linked thread markers**. The app must upload/read back those events before acknowledging/deleting the capture row. Recovery currently preserves a stopped partial meeting; it does not automatically resume a mic after browser process destruction.

## Native additive ABI (requires real native acceptance)

- `WizardOSDevice.recHandoffVersion()` → 1.
- `recHandoffBegin(eventId, meetingId)` → JSON receipt or `"null"`. The bridge waits for actual capture-thread completion, fsync/partial-chunk flush and physical mic release. A posted Pause intent is not authority.
- `recStartBorrowed(kind,eventId)` is the only new admission path. Normal `recStart` still rejects a live meeting. Wrong/stale/duplicate loans allocate no voice take.
- Normal `recStop` / native notification stop closes the original voice file, syncs it, preserves metadata, releases `MicOwner.ORB`, and returns the meeting mic if the loan paused it. STT need not finish first. Cancelled linked originals remain in native recovery, even when short.
- `recHandoffEnd(eventId)` abandons a loan that never started; it refuses while another recorder owns the mic.
- `recHandoffEvents()` returns durable local receipts. A service/process restart does not reconstruct recording authority from these receipts.

Stop/manual-pause ownership beats automatic resume. Meeting/orb foreground notifications use distinct IDs. The foreground orb now participates in the same MicOwner arbitration as the meeting/side/floating recorder.

## Tests

Run only on Thales; all profiles, temporary files and evidence must be on its external volume. Set `TMPDIR`, `PLAYWRIGHT_MODULE`, `CHROMIUM`, `SOURCE_SHA`, and `HANDOFF_EVIDENCE`, then run `node qa-handoff/run.cjs`. It uses only generated oscillator streams through real AudioWorklet/MediaRecorder and the real IndexedDB capture/outbox implementations. A=440Hz, B=880Hz, C=660Hz; spectral assertions reject B contamination in the meeting and reload verifies both separate originals. No real speech, credentials, STT or backend is involved. Also run `node qa-app-capture/run.cjs` with `CAPTURE_EVIDENCE`.

Android: use `android-build-thales --project <checkout> --gradle-dir android --wait-for-lock --output <new-evidence> -- :app:testDebugUnitTest :app:assembleDebug`. This is a **plain native Gradle project**, not Capacitor: omit `--cap-sync` (no package.json/Capacitor configuration). No local SDK/build fallback. Browser checks do not queue behind Android/VM worker.lock.

## Remaining gates

1. Native compile/unit tests and emulator A/B/C retained originals, exact same meeting, notification controls, failed permission, interrupted process, storage failure and Back. Do not substitute the native adapter mocks for this.
2. Wire shell handoff and explicit older-ABI refusal; reconcile shared-capture native ownership without making unrelated app-owned takes admissible.
3. Durable idempotent backend event/route/delivery correlation, inline transcript marker and deterministic linked recap; Tinfoil-only automatic meeting processing.
4. Parked reply borrowing (dictation and held command preserve the exact existing reply target/model/draft/audio and remain paused). One-off New task remains out of scope.
5. Full hosted/browser and Android acceptance, then parent-owned integration/release authorization. No guest image rebuild for this minor change.
