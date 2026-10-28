# Agent privilege notices (parallel development, not for deployment)

Companion to App Manager #282 and Wizard OS #285. Do not merge until James confirms the whole change breaks nothing.

REUSE: `WosSettings`, `WosResources`, `WizLinks`, the existing Store detail stack, and the shared skin tokens.
EXTEND: Store install/update results, Setup recommendations, chat work receipts, and Health/Settings rendering.
NEW: shared `web/core/privileges.js` and `privileges.css`, registered in COMPONENTS.md; fixed read-only `tools/privilege-status.mjs` projection.

## Data and authority

- An install/update response (including a polled job), or a chat tool receipt from an install/update/restore, carries `{error:"needs_owner_approval", app, risks, approve_url}`. The renderer accepts only the App Manager's exact local approval-page path, matching the app and a 64-character lowercase digest. It escapes names, translates host policy risks into everyday sentences, and deduplicates repeated risk sentences. Unknown risks direct the owner to review the exact request rather than pretending to understand it.
- One **Approve** link opens the App Manager's own confirmation page in the browser. No browser approval POST, token, server password, or inferred consent is introduced. App Manager pages disallow framing, so `WizLinks` sends these exact owner pages to the existing external-browser route instead of the embedded preview. Wizard's current nested view stays in place. The owner retries the original operation after confirming.
- The Agent Service normally removes raw tool results from chat history. Its companion change emits only a validated `owner_approval` display projection; it does not relay approval authority, commands, or other tool text. Tool cards remain visible outside collapsed activity.
- The existing Store data adapter adds only `GET/HEAD /wizard-os-home/store-data/wizard/v1/privilege-status`. It reads `GET /api/status` from the loopback origin in `$WIZARD_OS_HOME/client.json` and the `agent-token`, exactly like the thin `wam` client. The default home is `~/.wizard-os`. The token stays server-side; no redirect is followed. Errors are generic. This requires the shell adapter account to have its own unprivileged client settings; never give it manager/root credentials.
- The projection allowlists `enabled`, `return_pending`, and server access `active`, `severity`, `expires_at`, and drift presence. It drops source details, identity, raw drift paths, and helper errors.
- The shell reads immediately, on focus/visibility return, and every 30 seconds while visible. A failed read retains last-known warnings and labels them as old. No clock-based guess clears a server access grant; the manager's next authoritative reading does.

## Surfaces

- Personal-build banner in both phone and desktop shells while developer mode is on: **This box runs personal builds**, with **Return to release** linking to the App Manager developer page. It reserves room above content and has no dismiss action.
- Red row in Health and Settings → Resources only while server access is active, independent of developer mode (including migration grants). The expiry is formatted in the browser's locale/timezone. The **Turn off server access** link goes to the same manager-owned developer page. A plain-word warning appears when protections changed.
- Approval cards live within the existing app detail or chat view. No new modal or Back route is added. Setup uses the same card renderer.

## Acceptance

`npm test` is the repository's full JavaScript suite. There is no separate lint script; changed JavaScript files also receive `node --check`, and commits receive `git diff --check`.

`node tools/qa-privileges.cjs` runs a throwaway static origin and intercepts every backend call. No live or staging origin is touched. It tests dark/light skins on phone/desktop, owner-page GET navigation without approval writes, red-row/banner state transitions, opaque approval panel pixels, and nested Back behavior. Screenshots and machine-readable results land in ignored `qa/privsep/` by default (`QA_OUTPUT` overrides this). `QA_PLAYWRIGHT` and `QA_CHROME` select worker-installed browser tooling.

`tools/privilege-acceptance.py` compares the full suites against the exact captured main trees and runs the browser acceptance on Forum. The working directory must contain staged `ux`, `ux-main`, `service`, and `service-main` trees. Never run this sustained job on the control-plane host.
