# Stop-only app capture recovery

REUSE/EXTEND `WizAppCapture`, exposed via verified `WizardApp.capture` only; no second recorder or custody store.

`current()` adds `appId`, `active`, `recording` and `startedAt` to the existing id/meta/phase. A recoverable native row is not active or recording. `recording` means the shell owns an acknowledged engine in phase recording, not stopped. Apps can decide synchronously whether to restore their own user-started UI before awaiting anything.

`settle(keepId = null)` is owner-scoped by app-services. It snapshots the current active take before awaits, stops/retains only that app's unmatched take, then salvages proven matching native rows under the shared lock. Device recovery receives `{stopOnly:true}` and uses recStop/claim/read, never recStart. A newer mic tap yields the recovery lease and is never stopped by the prior snapshot. `keepId` exempts a still-running explicit take in the current app document. Audio remains pending until the app acknowledges it. Uncertain ID-less native custody is not authority to stop another owner or delete audio. Existing attach/resume contracts remain for apps whose user explicitly resumes.

This accompanies Messenger 15.12: an opened chat never probes attach and never paints Starting. A fresh document token authorizes only its own mic taps; orphan audio becomes a quiet unsent-note chip or is silently acknowledged if empty/tiny. A real take from a previous document is stopped rather than resumed.

Tests (forum, no owner content):
- `qa-app-capture/orphan-settle.cjs`: real Chromium IDB/Web Locks and device mock; native live reload orphan stopped exactly once, no new start; retained audio ack; current explicit take and other app protected.
- `qa-app-capture/messenger-open-shell.cjs`: real hosted shell/client and exact Messenger composer; empty open, every-frame no-panel proof; real fake-device 5s audio and app document reload, stop/retain/quiet chip, Discard, enabled mic; Nebula/Grove in-shell screenshots and live Appearance v1 acknowledgement; per-app Reload strip; zero backend writes/external requests.
- Existing capture contracts, integration, outline PCM and immediate-start timing regressions remain unchanged.

These are controlled browser/native mocks, not a physical Samsung phone test. No phone current-state claim is made and no Messenger data/DB was opened.
