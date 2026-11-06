# Retained voice recovery

## State is not a delivery diagnosis

- `failed` / `waiting`: a deliberate retry may queue the original message. A synchronous `queued` claim prevents a second tap from rearming the same attempt. Retry returns a boolean; bulk retry returns the number actually queued.
- `empty`: explicit per-recording retry only. Bulk retry never sends silent takes.
- `held`: retained custody, not a failed-send assertion. It may be a local command, unmatched command or an outcome without delivery proof. Show the stored reason. Do not promote it via retry, reconnect or bulk operations.
- `unconfirmed` / unreconciled storage: not permission to replay a possibly accepted mutation. Preserve the journal and original audio. Settings offers inspection, not resubmission.
- `sent`: disappears from Unsent only through the existing receipt/terminal protocol; no inference from text, age, or an empty server attention list.

A common eligibility predicate gates queue retry and the delivery pump. Reconnect/foreground wake only existing waiting work; it does not call manual Retry all. Manual bulk covers failed/waiting `new`/`reply` records and skips held commands, dictation, app conversation recovery, empty speech and uncertain steering. Commands can acquire explicit delivery authorization only through the existing enqueue caller (e.g. the user choosing Send to agent), never through recovery.

Chats' local recovery pill is independent of search results, empty lists, server connection and Errors expansion. A mixed uncertain/failed list still exposes Retry eligible without replaying the uncertain item. Agent-window bulk retry remains scoped to that original agent. Settings bulk no longer invokes a native wildcard recovery command.

## Inspecting held audio

Settings says **Unsent & retained**, shows the saved reason, and replaces unusable audio Edit/future-send promises with Play audio, Save audio, Transcribe only and Copy transcript. Transcribe only writes a separate `recoveryText`; it does not change the sealed send text/body, state, route, attachments or receipt. Newly processed orb notes preserve the transcript before local routing. Unknown outcomes say delivery is not confirmed rather than claiming nothing was sent.

This does not invent a destination/model for old recordings. Where intent cannot be proven, no Send button is manufactured. The original remains available for inspection/export and human reconciliation.

## Focused verification

Run on the designated browser QA host with isolated browser storage and all agent writes intercepted:

```sh
QA_RECOVERY_ONLY=1 QA_OUT="$EVIDENCE/recovery" node qa-voice-custody-callers.cjs
QA_OUT="$EVIDENCE/outbox" node qa-voice-custody.cjs
```

Use `PLAYWRIGHT_MODULE` and `CHROMIUM` for installed tools. The recovery suite covers both real shell renderers, Settings clicks, filtered/empty/disconnected lists, mixed eligibility, touch targets, double tap, lost receipt/reload/reconnect, original envelopes, held transcription persistence and no replay of unknown steering. Empty/disconnected view branches include explicit local live-state injection; admission/upload/STT are intercepted fixtures. These are browser tests, not a handset acceptance claim. They cannot identify the cause or reconcile receipts for an owner's inaccessible local recordings.

Broader caller/native/device verification and authorized integration remain separate release gates. No APK ABI change or guest image rebuild is required by this client repair.
