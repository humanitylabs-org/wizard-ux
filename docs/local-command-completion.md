# Complete locally executed voice commands

## Outcome
Successful synchronous shell commands (including opening Wisdom or Mizel.ai) finish their audio custody and disappear from Unsent & retained. No agent run or misleading Sent-to-agent event is created. Both phone and desktop callers use the same completion policy.

## Boundaries
- `WosCommands.completedLocally` identifies synchronous shell navigation. Music/ordering/search/app handoff acceptance is not proof of completion and keeps its recording.
- Outbox completion claims the item before persistence, revalidates within its write queue, writes a compact durable terminal marker, then releases browser bytes. Native IDs and seal ownership survive.
- Queued storage writes and late enqueue/transition attempts cannot overwrite the terminal marker or dispatch the already completed recording.
- If storage fails, original audio stays available with a specific cleanup-failure reason. A new explicit local-completion receipt can finish cleanup after recovery.
- Historic generic “Handled on this device” labels were also used for pending asynchronous commands. Existing legacy/unknown recordings remain intact. Do not infer completed execution from transcript wording.
- Draft text, photos, attachments, parked drafts, sealed agent requests and ambiguous steering remain protected.

## Focused verification
Run `QA_LOCAL_ONLY=1 node qa-voice-custody-callers.cjs` with `PLAYWRIGHT_MODULE`, `CHROMIUM`, and `QA_OUT` set for the available browser toolchain. Runs on the remote QA host; all network mutations are intercepted. 52 assertions passed: real phone/desktop callers open the requested app, zero recovery row, durable reload/reconnect, held-command path, ambiguous old rows retained, failed storage preserves bytes, accepted-only music retains audio, delayed storage retry and enqueue cannot resurrect completion.

`QA_RECOVERY_ONLY=1 node qa-voice-custody-callers.cjs`: 52 passed, covering real recovery controls, routing/model/file preservation, eligible-only retry, lost receipt identity and ambiguous steering.

Web-only update. No Android, native Mac or guest-image rebuild. Physical handset-local historic rows cannot be inspected or cleaned remotely; this is a forward fix rather than a bulk deletion of old recordings.
