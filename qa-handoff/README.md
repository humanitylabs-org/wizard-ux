# Meeting microphone handoff — staged host candidate

The shell is now wired on this candidate; independent browser/host integration is staged while the **parent-owned native build/emulator gate remains pending**. Do not release this candidate without integrated native acceptance and consequential review. Do not duplicate the parent's native job.

## Browser host contract

`WizAppCapture.beginVoiceBorrow(eventId)` works only for the existing browser PCM meeting engine. It finalizes its partial WAV/upload chunk, drains IndexedDB writes, stops microphone **and** computer-audio tracks, and persists a boundary marker before returning `{id, meetingId, atMediaMs, pausedByHandoff, micReleased:true}`. Ownership/Web Lock/update hold remain with the same meeting. Other apps remain busy. This is a trusted host seam, not app RPC.

The caller must pin its route/target/model and its new voice take identity before starting B; keep B in the existing outbox. After B's microphone closes and **durable** custody is confirmed, call `endVoiceBorrow(id,{voiceTakeId,status})` without awaiting STT, upload or assistant work. Status may be `cancelled`; do not label cancellation as a sent request. The same meeting capture continues, preserving media offsets and upload sequence. An existing manual pause stays paused. Failed reacquisition stays paused and warns. Computer audio stays off until a fresh explicit gesture.

Local markers are retained in the capture row's `meta.handoffs`; `core/orb-handoff.js` journals and retries the matching backend events without submitting messages. The meeting-recorder repository's `adoptions/mizel-live` is the explicit projection of the actual dirty shared-capture UI/server, with durable events and deterministic transcript/recap projection. The app requires event readback before acknowledging/deleting the capture row. Recovery preserves a stopped partial meeting; it does not automatically resume a mic after browser process destruction.

## Native additive ABI (requires real native acceptance)

- `WizardOSDevice.recHandoffVersion()` → 1.
- `recHandoffBegin(eventId, meetingId)` → JSON receipt or `"null"`. The bridge waits for actual capture-thread completion, fsync/partial-chunk flush and physical mic release. A posted Pause intent is not authority.
  ABI v1's actual receipt is `{id,meetingId,status:'paused',open:true,...}`; it does not contain `micReleased`. The shared JS adapter validates status/open/exact identities and normalizes `micReleased:true` only after this synchronous receipt.
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
2. Host suite `qa-handoff/host.cjs` exercises actual shell admission/send/cancel/manual-pause, parked reply dictation/held command/recovery, resumed original audio, and native ABI adapter mocks. See `HOST-INTEGRATION.md` in the parent task directory for pinned receipts and remaining review.
3. Backend companion `adoptions/mizel-live/README.md` documents required issuing-service URL and allowed origins. Do not substitute the portable root UI or overwrite existing private Tinfoil configuration.
4. Parked replies are durably held and restored paused. Explicit Resume opens a fresh native segment on Android (not a browser-mic downgrade), or a fresh browser segment; final audio is decoded and joined as PCM WAV, with originals retained on decode failure. One-off New task remains out of scope.
5. Full hosted/browser and Android acceptance, then parent-owned integration/release authorization. No guest image rebuild for this minor change.
