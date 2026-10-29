# Shared capture resource v1 — focused QA and host handoff

Only `web/core/app-capture.js` and this QA directory belong to this slice. No live deployment, shell edits, app-client changes, app uploads, native Java changes or Hermes core changes.

## Interface

Load the module through its external script src in the shell before app-services, once. The same file registers its PCM processor when loaded by AudioWorklet, preserving shell script-src 'self' CSP; no blob/eval/CSP relaxation or extra worklet asset. Standalone app-client must import the **same** file rather than recreate recording code.

- `WizAppCapture.start(appId, opts)` -> Promise of Session `{id,onLevel(fn),stop(),cancel()}`. `onLevel` returns unsubscribe; `stop` resolves a Result after IndexedDB commits.
- Result `{id,blob,mime,durationMs,startedAt,meta,partial?}`.
- `pending(appId)` returns owned pending/recoverable takes, including interrupted zero-byte metadata; it does not delete them.
- `ack(appId,id)` deletes only after the task caller has verified backend durable readback. An upload response alone is not that proof. A new capture can continue while an older take is acked.
- `getState()` -> `{version,active,recording,appId,id,phase,native,hold,error}`. Window event `wizard-app-capture-state` carries this shape. The host's automatic update hold follows `hold`, not frame lifetime.
- `resume(appId,id,opts)` reconnects a frame to the shell-owned Session or resumes an existing native take. It rejects during startup. Starting a fresh take when the same app has a recoverable native take returns `resume_required` with its id. Session also has `pause()`/`resume()` to retain meeting/task controls.
- Trusted host-only seams: `configureNative(adapter)` and `configureNativeBridge(existingMeetingsBridge)`. Do **not** expose these to app RPC. Adapter signature: `{name,start(opts,{level,chunk},previousRow),recover(row)?,ack(row)?}`; start returns `{nativeId,mime,pcm?,stop,cancel,pause?,resume?,detach?}`, stop optionally returns `{blob,durationMs,meta,partial}`. `chunk(blob,source?,startMs?)` is raw persisted PCM for PCM adapters, otherwise encoded bytes.

## Meeting/song fidelity

Browser song capture uses MediaRecorder with supported codec selection. Browser meeting capture retains Mizel's mono 16 kHz box-filter PCM AudioWorklet, 250 ms live PCM (`opts.onPcm({pcm,startMs,source:'me'})`), RMS levels, and independent WAV task chunks (`opts.onChunk({source,seq,startMs,blob})`) after persistence, default 5s / bounded `chunkMs`. `offsetMs` and `{me,them}` `seqBase` preserve task continuation. `systemAudio:true` invokes display-media under the original gesture, preserving two separate tracks; Result.blob is mic and `meta.captureTracks` holds the separate computer-audio WAV. Rejection/no system audio warns via `onWarn`, never claims that track exists. PCM samples persisted every250ms even when upload chunks are5s. Back, frame reloads and hidden desks never stop capture. Closing an app's last window does: the shell reports its open windows (`WizAppServices.trackOpenApps`), and any app with no window left gets `WizAppCapture.closeApp(appId)`, which stops the mic at once and saves the take as pending for recovery on the next open (James, 19 Oct 2026: closed means closed).

Native song/voice capture reuses `WizardOSDevice`'s existing foreground recorder, recRead/recClaim recovery and recDone after ack. Native meeting capture reuses `wizardNative.meetings`, a host-supplied bridge, or the existing `wizardMizelPort` with bounded command waits. Never overwrite a port's existing listener: attach its wrapper. Native meeting bridge owns its original 5s uploads, meeting status and final_seq; `onNativeState` preserves those flows. Result has `partial:true`, `meta.native.backendOwned:true`, and only a **backup PCM tee**, not replacement full-quality audio. Do not re-upload this backup over native task audio; verify the original task backend before ack. Native bridge without PCM still exposes interrupted metadata rather than silently switching to browser/AAC. Late ambiguous stop errors reconcile native status before retrying. Existing device recorder without meeting bridge refuses simplified AAC meeting fallback.

## Explicit non-meeting PCM in Android WebView

`{kind:'outline', pcm:true}` selects the existing shared browser PCM engine when the DeviceBridge recorder is AAC-only. Ordinary device capture stays AAC; meetings keep their native bridge and backend ownership. Persisted native rows always use native recovery/resume/ack, even if a caller now requests PCM. No meeting is created for non-meeting capture.

Capabilities report browser PCM only when getUserMedia, AudioContext/AudioWorklet, AudioWorkletNode and the shared worklet script URL exist; permission is still required at start. The shared Web Lock, IndexedDB custody and shell hold remain authoritative. Browser admission rechecks native voice (including paused/unknown ownership), recovered meetings and ambiguous native reservations after acquiring the shared lock. App frames continue to use `WizardApp.capture`, never their own recorder.

Run the focused suite on the authorized browser worker, with Playwright/Chromium and temporary data configured there:

```sh
CAPTURE_EVIDENCE=/path/to/isolated/evidence SOURCE_SHA=$(git rev-parse HEAD) node qa-app-capture/outline-pcm.cjs
```

This uses real Chromium AudioWorklet, WAV encoding, IndexedDB, Web Locks and the hosted facade with fake microphone input and explicit native bridge fixtures. It checks PCM capability/streaming, native busy admission, native AAC recovery/ack, native meeting routing, denial, frame/shell reload, byte-identical pending readback and owner-only ack. Also run the existing `qa-app-capture/run.cjs` and `npm test`. This is not Android hardware or background-service acceptance: WebView PCM remains shell-bound and may suspend or lose an unflushed tail on OS process destruction, unlike native foreground recording.

## Durability and limits

Web Locks arbitrate one recorder across same-origin module contexts; no unsafe fallback when locks are missing. IDB persists individual pieces no larger than1MiB and an atomic row/chunk sequence. Storage-persistence request is advisory; IDB commits are mandatory. Default total threshold512MiB (caller can reduce maxBytes); reaching it automatically stops partially. Failures retain queued chunks and the owner/hold for explicit stop retry. Results persist until ack or explicit cancel. Startup recovery tolerates unavailable native bridges per-row; it does not block unrelated browser app takes. Native bridge must return before its row can be acknowledged. The host must also check shared capture state before starting the pre-existing shell orb recorder; this module cannot retrofit that caller in its owned scope.

An actual destroyed/reloaded browser shell cannot keep a web microphone physically running. Already committed chunks recover as partial; the unflushed tail can be lost on process kill. Frame reload/Back/background leave the shell recording intact. Native foreground service continues independently and can be reattached. Native start and JS metadata cannot be atomically committed across the existing bridge; a crash precisely between native start and native-id metadata commit leaves a native take discoverable by the shell's existing recorder UI, but not automatically owned by this app row. Native protocol changes to close this small crash window are outside scope.

## Execution

Source edits and syntax checks only on Telos. Copy these owned files to `$WIZARD_WORK_ROOT/WizardApps/shared-services/capture/source` on Thales; pass exact committed SHA and git tree SHA:

```sh
ssh "$WIZARD_BUILD_HOST" 'bash $WIZARD_WORK_ROOT/WizardApps/shared-services/capture/source/qa-app-capture/run-thales.sh SOURCE_SHA SOURCE_TREE'
```

Runner takes `$WIZARD_WORK_ROOT/AndroidBuilds/worker.lock` (shared heavy/browser lock), localhost test server only, no production task URLs or writes. Receipt/command log/screenshot/source manifest at `$WIZARD_WORK_ROOT/WizardApps/shared-services/capture/evidence`. Playwright and Chromium paths are explicitly overrideable; no new dependencies needed. Capture suite exercises Chromium's real getUserMedia/MediaRecorder/AudioWorklet with fake audio plus permission/storage injection, frame/Back/background events, reload recovery, busy across tabs, owner checks, delayed-commit partial races, concurrent stop flush, bounded pieces, ack concurrent with next take, and existing native signatures through mocks. Native hardware/permission dialogs/background-service OS survival and real backend durability are **not** claimed. Headless page background/visibility checks are not mobile OS process suspension testing.
