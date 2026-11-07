# Model selector trust-boundary hotfix

User job: every Wizard send uses the model/provider displayed at the send tap; an unavailable selection fails visibly, without silent substitution. This run is GPT-6.1 Sol. Private-agent work is paused.

Lane: consequential routing repair; direct implementation in isolated hotfix/model-route-contract from daily 762485d. No Hermes core changes, no Android build, no schema changes. Scoped production release authorized by the bug-fix request.

Acceptance:
- Typed, voice, attachments, new threads, replies, retry and recovery all seal the displayed model+provider in the durable outbox.
- Each run includes require_model_lock=true; transport retry retains the route and body bytes.
- Switching while a run is active never steers text into the old model; steer only after checking the run's actual runtime matches.
- Model-save errors/mismatched acknowledgements never falsely display the new selection.
- Synthetic live runs selecting GLM/Tinfoil and GPT/Codex return the requested runtime; unavailable route is rejected, never defaulted.

Evidence: negative-control UI tests, browser tests on both shells, existing outbox/chat regression suites, independent read-only review, committed live web-tree readback and real synthetic run receipts. Rollback: previous daily:web tree. Private real recordings are excluded from all probes.
