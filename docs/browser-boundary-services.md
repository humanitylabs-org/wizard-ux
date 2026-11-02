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

## Notifications app over the boundary (card 2, wizard-os #385)

- REUSE the card-1 data path (`WizardApp.data.call/status` → shell → Agent Service → WAM grants). The reviewed ids gain `notifications.inbox` (read: view, counts, marks) and `notifications.mark` (write, compare-and-set, needs `operationKey`); both are refused in the shell unless listed and re-checked by the Service.
- EXTEND the unsent reply draft (`WizardApp.nav.openContextDraft`, same `contextDraft` validation and Chats owner as same-origin frames) to opaque frames as `nav.contextDraft`. The shell admits it only while the registered frame holds focus in a visible document, with exact keys `{id,title,message}`, at most once per 1.5 s and 20 per 10 minutes per app. Only `{kind, sent}` crosses back; nothing is sent.
- EXTEND the Notifications badge (`notif-bell.js`): opaque frames cannot post `wizard:notifications:count` (origin `null` never matches). After a proven write the shell dispatches `wizard:browser-data-written` with the registered app id and the bell re-reads its own count, so the badge keeps its one place.
- The frame watchers hand an opaque frame only `openContextDraft` and `isVisible` from the same-origin options; never `openThread`, Back callbacks or a document connection.
- Thumbnails still load as plain images from the app's `/notifications/media/*` route; a typed media adapter and server-side protection of `/notifications/api/*` are card 3 (#386).

## Shell model picker and the Troubleshooter (wizard-os #385/#386, spec #398 §6; default-off)

- Model picker: under the listener gate the Claude app's own `/api/accounts` answers only the Agent Service adapter. The shell now reads `POST /wizard/v1/browser-shell/call {operation:'models.claude_accounts', args:{}}` (shell token, owner, same-origin, not a frame; Service resolves the WAM `claude-subscription` installation and uses its listener credential). The reply is only `{state, accounts:[{id, source, status, usage:{fetchedAt, limits(session/weekly %)}}]}`. Limit note, "not answering" note and native Claude routes are unchanged. This is not the app-frame path (`browser-adapters/call` refuses it). Flag off: the direct read stays.
- Troubleshooter: the built-in `troubleshooter` window (apps.js, `/troubleshoot/`; an installed app can never take its id) is an opaque frame. `recovery.call` maps a closed list of ops to one fixed `/troubleshoot/api/` path each: `status`, `engines`, `engine.set`, `incidents`, `repairs`, `repair.read|start|stop|approve`, `action`. Plus `provider_run` (one boolean from the Agent Service), `cache.read|write` (picker display data, shape-checked, 8 KiB, shell storage) and `open_app` (wizard-claude/chatgpt/tinfoil or App Store, only while the owner is in that window). Every other window gets `not_allowed`.
- App Store (wizard-os 389 O1; a shell-controlled panel): only the built-in `app-store` window (apps.js, no `source`, `/wizard-os-home/store/index.html`) gets `store.call`. Each op maps to one fixed owner path with exact arguments: reads `catalog`, `installed.runtipi`, `installed.wizard`, `link`, `router.needs`, `install.status`, `remove.plan`, `remove.status`, `app.agents`; owner changes `install` (install/update/switch), `remove`, `router.approve` first need the owner's confirmation in shell UI (intent chip + dialog rules). The reply is `{status, value}` from that path. `web/store/store-bridge.js` maps the Store's own fetches onto these ops in the opaque frame and refuses anything else under `store-data/` and `store-install/`; it also takes the skin over the port. No WAM grant: shell power, not an app's.
- Recovery gate: a DISTINCT token (`WIZARD_RECOVERY_TOKEN_FILE`, injected by the same navigation-only template as `wizard-recovery-token`; empty when unset; must differ from the shell token). The fetch wrapper sends it only to same-origin `/troubleshoot/api/` (not `ping`), with `redirect:'error'`; the Troubleshooter never sees the shell token. The Troubleshooter verifies it itself (wizard-troubleshooter `feature/browser-trust-recovery-gate`), so recovery does not depend on the Agent Service. Real Chromium: `tools/qa-browser-recovery-surfaces.cjs` (also covers Secret Drop on its own origin).

## File Browser: reviewed separate-origin own tab (wizard-os #385, Files decision 2 Nov 2026; default-off)

- EXTEND `WizBrowserBoundary`: an app the Agent Service flags `own_tab` (WAM state, File Browser only) never gets a Wizard window. The shell checks its address is a different https origin and opens it with `noopener,noreferrer`; Back to Wizard stays in the shell. Flag off: unchanged frame.
- Real-Chromium QA: `tools/qa-browser-files-own-tab.cjs` (`QA_BASELINE=1` for the unmigrated before shot).

## Wizard Files in the opaque frame (wizard-os #385 card 2 / #386 card 3; default-off)

- REUSE the card-1 data path for `files.list`, `files.index`, `files.thumbnail` (reviewed ids; the Agent Service re-checks WAM grants per call).
- EXTEND `media.open`: `wizard-files` maps to `files.content` (purposes `read`/`play`; a closed inline MIME list, everything else an attachment ticket). Tickets come only from the dedicated content origin.
- EXTEND `WizardApp` / `WizBoundaryClient` with `upload.create|chunk|status|commit|abort` and `download.request`. The shell keeps the upload ticket (never sent to the frame), forwards one outstanding chunk of at most 1 MiB with its offset and sha256 to `POST /wizard/v1/browser-adapters/upload-chunk`, and the Service re-checks binding, generation, installation and the `files.upload` grant for every chunk. Downloads are shell save/open actions on a resource id, only during the owner's own user activation.
- Opaque frames load the shared kit by `location.href` (their origin is `null`) and get tokens only; skin layers stay same-origin-parent only.
- Real-Chromium QA: `tools/qa-browser-wizard-files.cjs` (`QA_BASELINE=1` for the unmigrated app).
