# Shared capture integration (isolated candidate)

The integration branch starts from daily `903ec003b0c0a57e824dcb1012b1c6710aabbda9`, merges host `b0fb2ea228b5c34928c5dfdfb22ad3acd9fec19c`, and cherry-picks capture commits `041e7b`, `dc3e7b`, `21f194f`, `5748453`. The daily return-position repair and original model-route sealing remain in place. Recovery warms model authority just as a cold first recording does; unavailable routes still fail closed.

## Native ownership

- `getState()` exposes `nativeOwnershipReady` and all owned `nativeDeviceTakeIds`, including pending/recoverable copies until explicit durable ack. It reports confirmed physical recovery even without a logical active Session. Ambiguous reservations/unknown native owners remain held; no clock guesses ownership.
- Never call `recClaim` to discover ownership. An additive, read-only `recActive.kind` field supplies positive legacy `auto`/`command` provenance. Existing tracked app IDs work with the old kind-less signature. Older kind-less legacy takes require positive in-page/persisted voice-route provenance; otherwise the orb waits safely for the native Stop/pending metadata rather than adopting an unknown app take.
- Shared capture reserves neither `auto` nor `command`. The legacy importer filters exact kinds and exact owned native IDs. State/readiness changes dispatch `wizard-app-capture-state`.
- Emulator acceptance uncovered a real native admission hole: DeviceBridge's RecorderService bypassed the meeting MicOwner. Narrow admission guards now reject a live (including paused) meeting before a voice take is allocated, and the meeting service rechecks an existing Device recorder after its asynchronous start hop. No share-bridge redesign or new recorder framework.

## Capture/client extensions

`WizardApp.capture.prepare(opts)` is synchronous under activation and returns `{id,release()}`. Pass `preparedId` to start after domain requests; tokens are app-owned and have no time expiry. The verified facade exposes `capabilities(opts)`, `current()`, and owner-bound resume via `start({resumeId})`.

Session observers: `onLevel`, `onPcm`, `onChunk`, `onState`, `onWarn`; controls: `pause`, `resume`, `setSystemAudio`, `stop`, `cancel`; readbacks: `getInfo`, `chunks`. PCM/system audio stays wholly in shared core. Document-bound host wrappers revoke old observers on frame replacement and leave capture custody intact. New iframe observers receive live streaming and replay immutable source/seq/offset identities. System source re-enable never overlaps its prior flushed samples. External native notification Pause/Resume updates the owned Session phase.

Mizel uploads browser PCM through its existing domain Uploader. Native meeting uploads/final_seq/Stop stay native-owned. The task controller waits for its own backend stop/duration readback without expiring its save hold. Browser ack additionally compares the backend's stitched mono PCM against the exact shared Result. Mismatch, storage error, or reload retains custody; domain Retry saves the old take, never starts a second recorder.

## Exact Mizel adoption

`adoptions/mizel-live/manifest.json` and `mizel-live.patch` are the release inputs. They target exact base `215eee587cae70e3c105773698b29c42cdcf8a5b`, not the earlier partial patch in other-apps delivery. The patch removes app-owned browser/native recorder implementations and the local capture worklet, preserves existing routes/layout/backend APIs, and consumes the shared resources. The `.original` worklet is QA-only evidence for 48k/44.1k stereo-to-mono byte parity, never a served capture asset.

## Acceptance route

All builds/browsers run on Thales under `/usr/bin/lockf -k -t 5400 /Volumes/ThalesMedia/AndroidBuilds/worker.lock`. `qa-app-capture/run-integration-thales.py` invokes the existing capture, host, native-device, share A/B and Chats return-position suites plus seam-specific additions. Host SW/cache checks use actual disposable browser storage, not service-worker blocking. Other suites fence writes. The native runner uses the already-held external lease and creates a fresh, snapshot-disabled, unlocked API35 guest; exact debug APK only, no physical installation.

Final receipt target: `/Volumes/ThalesMedia/WizardApps/shared-services/integration/r7/evidence/receipt.json`. Acceptance is the receipt's actual command exits and exact source/app hashes, not this document. No handset was attached; acoustic calibration/physical-device acceptance and actual Mac-native bridge behavior remain separate. Native chooser tests require real Android text/file chooser launch but retain `unsupported` for the existing void bridge outcome and assert zero duplicate browser fallback.

No daily checkout, live app, gateway, registry, publication state or Hermes core is changed. Parent owns review/release and the separate gateway installer-injection/global-app gates described in OTHER-APPS-STATUS.md. Native safety changes require a matching parent-built release APK/version slot; this slice does not publish/sign a release.
