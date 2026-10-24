# Shared app setup checklist — verification

## Shipped surface

`WosAppSetup` (`web/core/app-setup.js` + `app-setup.css`) renders Connection Router owner needs for one app. The Store install sheet and its later **Models and connections** section use the same rendering/actions. Model/service rows include purpose, required/optional, private-data constraint, status, one primary setup/connect/approval action, and **Use another**.

The gate is at the start of `openApp` in **both** `web/app.js` and `web/desktop/desktop.js`, before app-window creation or existing-window focus. Launcher taps, `WizOpenApp`, trusted Store open requests, and `WizCore.deeplink`'s `?open=<id>` handler all converge there. The continuation carries a one-call `setupChecked` flag; it is not a persisted readiness bypass. Cancelling or a newer launch invalidates an in-flight needs read.

Required gaps never expose Continue. Optional-only gaps offer Continue anyway. Closing a connect page, window focus, document visibility return, approval, and Check again re-read the owner-needs proxy. Router 404/501/network failures fail open, including on recheck. The request has a five-second timeout. Back peels provider view → checklist, alternatives → checklist, checklist → the existing shell, never launches the blocked app or exits.

Recommended missing providers use `installRelease`, extracted unchanged in transaction semantics from the existing Store install function: exact source/repo/commit/operation, polling, selection verification. The gate checks a complete installed registry before installing and reads the exact registered release afterwards. No arbitrary install URL, inferred approval, key entry, or private-data override was added. Installed alternatives open their own connect page, not the recommended provider's fix URL. Service routing remains the Router's decision; no nonexistent service-selection endpoint is invented.

`WosAppRoute` retains private-agent setup. `WizLinks` hosts connect pages and the slot-filtered Store; only that exact nested Store frame may send hosted open requests. `WizAppearance` now includes registered apps in shared link sheets, so provider setup inherits the active skin. Styles use Wizard Appearance tokens.

## Reuse

- Owner routing: REUSE `routerNeeds` / `routerApprove` and existing model actions in `web/store/store-router.js`.
- Recommended provider installation: REUSE `installRelease` extracted from the Store's existing install path, including qualified-release checks.
- Private-agent setup: REUSE `WosAppRoute`.
- Connect-page browser: REUSE `WizLinks`.
- Service rows: EXTEND `serviceRow` with purpose, required/privacy status and actions.
- Nested provider appearance: EXTEND `WizAppearance` frame discovery; its installed-path and same-origin checks remain.
- Per-app setup gate: NEW `WosAppSetup`; no existing inventory row supplied this capability. Registered in COMPONENTS.md and the shared responsive inventory.

## Executed checks

- `npm test`: **757 passed**, zero failed/skipped. Includes 10 checklist unit tests covering ready, missing recommended required service, private-data blocked, optional-only, named model approvals/strict models, old/unreachable Router, exact install selection, in-flight cancellation, and shell hook placement.
- `node tests/qa-app-setup.cjs`: **108 passed**. Actual phone and desktop entrypoints, Nebula and Grove; 390 × 844 phone, 1280 × 844 desktop. Also covers the Store install sheet/later section, qualified provider install followed by connect, selected local alternative vs recommended fix URL, filtered nested Store, Appearance handshake, visible nested toolbar after scrolling, real shell Back, required/optional/private states, recheck triggers, compatibility fallbacks and zero page errors.
- `node tests/qa-store-router.cjs`: **64 passed**, zero failed. Existing 390/1280px model match/missing/swap regression harness extended for setup actions and shared install transaction.
- `git diff --check`: clean.

All browser APIs are isolated fixtures; screenshots are real Chromium renders, not live-provider attestations. No live shell deployment, owner data, provider credentials or live installation was used. The standalone Store fixtures retain the existing dark fallback; the nested Store screenshots below verify actual host-skin adoption.

## Phone screenshots (390 × 844)

| Surface | Nebula | Grove |
| --- | --- | --- |
| Required checklist | ![Nebula required](phone-nebula-required-checklist.png) | ![Grove required](phone-grove-required-checklist.png) |
| Use another | ![Nebula alternatives](phone-nebula-use-another.png) | ![Grove alternatives](phone-grove-use-another.png) |
| Slot-filtered Store in setup | ![Nebula nested Store](phone-nebula-hosted-store-alternative.png) | ![Grove nested Store](phone-grove-hosted-store-alternative.png) |

The browser runner accepts `QA_OUT` for additional screenshots; the committed set is fixture-only review evidence. This PR is not deployed or merged.
