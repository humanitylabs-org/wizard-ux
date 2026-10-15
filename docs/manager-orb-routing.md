# Foreground Manager orb conversation contract

## Scope and route

Normal talk started with installed `wizard-manager` foreground goes to that Manager conversation on phone and desktop. Recording START seals the app frame/document/receiver and a copied `replyTo` (or null for generic Manager conversation). Switching focus during recording, transcription or POST cannot change it. Later Manager draft edits are neither consumed nor used for retargeting.

`WizardApp.conversation.register({snapshot, receive})` is synchronous shared-app-client registration. The host admits only the reviewed `wizard-manager` app ID through its existing installed registry, frame, same-origin/path and document checks. It passes a narrow reauthorization callback; Manager calls it after async state refresh immediately before POST. Apps cannot supply delivery endpoints. The existing Manager API, not the shell, owns Manager admission. There is no new service, core-Hermes change, WAS fork, global app-specific parent call or unacknowledged postMessage dispatch.

Commands, focused-field dictation, composer replies and explicit new-chat gestures keep their routes. An unavailable Manager capability still produces a sealed unavailable destination, never a null route that would fall back to Chats.

## Custody and receipts

The existing outbox stores conversation-kind items with original audio, transcript, sealed destination, attachments and stable item/request ID before dispatch. No ordinary Chat session, router/run request or Chat audio upload is used. Manager checks existing user turns by request identity, POSTs to its normal idempotent API if needed, then confirms admission through state readback before acknowledging.

Paused recipient, STT/network failure, uncertain/mismatched receipt, unsupported attachments, oversized text, replaced document and revoked frame admission retain the item visibly. There is no automatic generic-Chat retry. Copy/Transcribe never sends. The separate **Retry original to Manager** control retries the same item identity; duplicate admission is reconciled before another POST. Original audio is kept through durable app acceptance. Existing terminal-marker cleanup owns eventual deletion.

A frame/shell reload or navigation deliberately revokes the live capability. The retained transcript and audio remain copyable/downloadable, but retry cannot silently bind to a replacement document. Reopening Manager does not restore that capability. This fail-closed recovery is intentional; automatic cross-document rebinding is out of scope.

Manager does not support attachments. An attached file blocks the whole Manager dispatch, retaining audio/files rather than sending incomplete text or routing elsewhere.

## Verification

All browser and sustained tests run on Thales. The `qa-manager-orb.cjs` harness uses the real HTTPS shell/installed registry, candidate asset overlay and Chrome's fake microphone. Manager state, transcription and ALL mutation requests are explicit intercepted fixtures. This proves shell/client routing and custody, not real production Manager admission, physical microphone capture or the Android bridge.

Evidence from the candidate implementation:

- UX Node suite: 48 passing (includes route and registered-frame capability tests).
- Manager frontend suite: 20 passing (includes sealed target and pre-POST authorization).
- Foreground Manager browser suite: 35 passing, zero page errors on both shells.
- Untouched UX baseline: 2 reproductions, phone and desktop create ordinary sessions/runs instead of a Manager turn.
- Existing thread/list browser route suite: 15 passing.
- Existing held-command browser suite: 29 passing.
- Existing focused-field dictation browser suite: 116 passing.

Source suite: `node --test tests/*.test.mjs`.

Browser suite requires explicit environment:

```
PW=<playwright-module> CHROME=<chrome-executable> \
QA_URL=<actual-tailnet-shell-url> QA_WEB_DIR=<candidate-ux-repo> \
QA_MANAGER_DIR=<candidate-manager-repo> QA_OUT=<evidence-directory> \
TMPDIR=<external-volume-scratch> node qa-manager-orb.cjs
```

Use `QA_BASELINE=1` and `QA_WEB_DIR=<untouched-baseline>` for reproduction. The harness uses real start-button clicks for the candidate foreground case, subsequent shell control entry points for deterministic failure cases, and real recovery-button clicks for retry.

Existing suites run with `node -r ./qa-thales-loader.cjs <suite> "$QA_URL"`, explicit `PW`, `QA_CHROME`, `QA_WEB_DIR`, `QA_RESOLVE` (no incorrect loopback mapping), and `QA_BLOCK_WRITES=1`.

Manager suite: `CORE_CLIENT=<candidate-ux>/web/core/app-client.js PLAYWRIGHT_MODULE=<module> CHROMIUM_EXECUTABLE=<chrome> node --test tests/frontend.test.cjs` from the Manager tree.

## Release boundary

No deployment or merge is performed by this change. Release both companion repos; parent owns service-worker/cache-version release mechanics, public/live readback, and one real Manager conversation acceptance check on each surface. No APK or VM rebuild is needed. Shared appearance and Back contracts are unchanged. The existing desktop retained-recording overlay can cover part of the Manager pane while failures are held; this is the pre-existing recovery surface, not a new layout.
