# Opaque app sharing and transcription (draft slice)

Default-off under the existing browser-boundary switch. No release, installation, live service change or native change is part of this slice.

## Component plan

- REUSE `WizShareWizard` and its existing shell-owned Send to Wizard sheet, attachment upload and Chats send path. No second confirmation UI.
- EXTEND `WizBrowserBoundary` / `WizBoundaryClient`, `WizAppServices` and `WizardApp` with only `ready`, confirmed `share.wizard`, and bounded `voice.transcribe` messages. The phone and desktop frame watchers register installed apps with the same service owner.
- NEW none. The added files are Node regression fixtures, not another runtime component.

## Ownership check

Checked open wizard-ux PR file lists before editing. PRs 447, 454, 467 and 472 also touch `app-services.js` for different phone/vault/orb/reconciliation work, but do not own this opaque-frame share/voice protocol. The original shared share/transcription work (PRs 460 and 471) was already merged into this draft's baseline; this slice extends it without cherry-picking or overwriting those implementations.

## Contract

- Opaque app messages carry Origin `null`. Admission requires the registered iframe's exact `contentWindow`, an installed registry identity and the current boundary channel/load; `null` alone grants nothing. Direct legacy `connect` and legacy service messages remain closed with the boundary enabled.
- The shared shell sheet requires an `isTrusted` click on its connected, shell-document destination button. Synthetic clicks, revoked authorization and an unattended 60-second confirmation resolve `denied`; no upload/send occurs without that click. Navigation and detach revoke confirmation. Delayed upload completions cannot close a replacement sheet or send after revocation.
- `TRANSCRIBE_LIMITS` in `app-services.js` is the shell-owned configuration: 25 MiB per call, 10 admitted calls per 10-minute sliding window per registered app id. App-supplied identity/limits are ignored. Reservations happen before asynchronous provider work. Frames and reloads share the budget; detach does not reset it. A shell document reload creates a new budget (this is not a server-wide quota).
- Oversize and exhausted calls return structured `too_large` / `rate_limited` errors without upstream calls. Request channels are revoked on document change and provider results are not delivered to replacement frames. No generic fetch, native, install or other legacy capability is added.
- Flag-off retains the existing synchronous share/voice paths and shared sheet behavior. Opaque clients explicitly adopt `browser-boundary-client.js` before `app-client.js`; this is not an automatic daily-app compatibility claim.

## Verification and still-required evidence

Node tests use synthetic audio, synthetic destinations and VM DOM fixtures. They cover the actual WizardApp/client/service protocol and actual shared sheet handler, but a VM event with `isTrusted: true` is a branch test, not a real browser user-gesture receipt.

The existing Forum hostile-browser evidence for the prior exact draft revisions remains reusable baseline evidence (22/22); it is not presented as a new-head browser run. Native main-frame isolation, app-storage paths, actual browser/handset confirmation and daily-app QA remain enablement gates. The separate WAM storage-test fixture import failure `@/common/helpers/app-helpers` remains outside this slice. Link installs remain off.
