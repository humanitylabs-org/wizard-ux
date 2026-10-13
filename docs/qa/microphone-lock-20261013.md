# Microphone lock hotfix — isolated verification

Base: `daily` at `9983350` (full SHA recorded in artifact metadata). Branch: `hotfix/microphone-lock-20261013`. Worktree: `/home/telos/worktrees/wos-microphone-lock-20261013`.

## Repair

- Long-press release pauses capture before route/model resolution or upload readiness. An unavailable route leaves the take paused, retained, and controllable; it cannot silently keep recording.
- Pointer-ID custody, lost-capture handling, and window release/cancel/blur/hidden fallbacks preserve a take on gesture loss instead of implicitly discarding it. Tap-toggle and navigation remain separate.
- Commands expose the ordinary timer/Cancel/Pause dock. Paused command feedback states explicitly that the recording is kept.
- Capture generations fence late permission and recorder callbacks. Stale streams stop themselves, never a newer stream; cancelled long browser takes own their final chunk locally.
- Read-only voice provenance restores controls on the published kind-less `recActive` ABI without requiring a model route. Unknown legacy recorder custody gets an explicit **Show recording controls** action; activation rereads the exact native ID and the ready shared-app registry. App-owned, changed-ID, unready and ambiguous shared-app ownership never authorize adoption.
- Native Pause/Resume, finish and Cancel check shared ownership; Pause/Resume also reread the active native ID. Existing durable capture/ack, service adapter, Send-time model route and cancelled-take storage contracts are retained.

No Android/native files, version feed, deployment, daily merge, task close, or agent backend changes. No APK build was needed or performed. All sustained suites ran on **thales.local**, serialized under `/usr/bin/lockf -t 120 /Volumes/ThalesMedia/wizard-os/worker.lock`; API writes were intercepted.

## Evidence and rerun

Remote artifacts: `/Volumes/ThalesMedia/wizard-os/microphone-lock-20261013/evidence/`.
Local artifact mirror: `/home/telos/.hermes/state/wos-microphone-lock-20261013/evidence/`.

- `regressions.json`: exact baseline/candidate results and log paths.
- `baseline-qa-microphone-lock-cjs.log`: RED on unchanged baseline, **10 pass / 11 fail**. The failures include route-blocked native release, hidden command controls, real capture loss, stale permission stream custody, late permission grant, route-less command recovery and absent unknown-recorder control. Conditional recovery activation tests cannot execute on baseline when the recovery button is absent.
- `candidate-qa-microphone-lock-cjs.log`: GREEN, **24 pass / 0 fail**. Real CDP touches cover long hold/release, immersive transition, capture loss and permission startup. Legacy kind-less fixtures cover saved route, route-less command provenance, unknown explicit recovery, changed ID, ownership changing between paint and action, and another app's durable native take.
- Regression suites: awake **11/0**, device **89/0**, dock-morph **30/0**, hold-command **29/0**, cancel-recover **22/0**, model-route contract exit **0**, app-capture **19 contracts / 0 errors**.
- `qa-voice-nav.cjs`: baseline and candidate both **22 pass / 1 fail**, identical pre-existing stale app-label assertion (`Home` versus expected `Chats`). No new regression failures.
- `qa-microphone-lock-fixtures.cjs` supplies explicit synthetic model/options authority for the older awake and hold-command suites. Their original generic `{}` fallback causes unavailable-route failures on both baseline and candidate; the same fixture is used for both. Production routes are never exercised.
- `remote-hashes.json`: hostname and SHA-256 of the complete web snapshots and the new harness files. Verify the committed source against this manifest before release.
- Screenshots: `candidate/qa-microphone-lock-cjs/native-release.png` and `candidate/qa-microphone-lock-cjs/legacy-controls.png`. Reviewed directly: timer and all five dock controls visible, no overlap or clipping; paused release uses the amber Resume control.

Run the remote driver with `PW=$HOME/workspace/wizard-mobile-link-candidate/node_modules/playwright`, `QA_CHROME` set to that installation's Chromium executable, and `SOURCE_SHA` set to the committed candidate SHA. Invoke through the shared worker lock. `QA_TREES=baseline,candidate` and optional comma-separated `QA_SUITES` bound reruns. The baseline web tree must remain untouched; sync only the test harnesses into it.

This proves the web implementation and shipped-ABI bridge seam, **not** a physical phone installation or Android hardware/audio-route test. Parent owns final served-source verification and release. An early orchestration SSH call timed out after the tool's 420-second ceiling; the lock-held remote worker continued normally, completed, and was read back before any resync. No worker was killed.
