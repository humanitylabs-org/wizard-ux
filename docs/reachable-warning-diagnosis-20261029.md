# Repeated reachable warnings — bounded repair

## Reuse decision

REUSE `WosOutbox`/`WosCarry` for all durable message custody, recovery and retries. EXTEND the existing `WizCore.status` connection banner, `WizReach` failure-only diagnosis and Chats `sendPill`. NEW: regression/browser evidence only. No new delivery path, store, provider route or diagnosis poller.

## Proven causal chain

1. `web/outbox.js` keeps transient failures in `waiting` with capped retry backoff. This is independent of whether fresh chat reads succeed.
2. Before this repair `web/core/status.js` raised the global connection banner for any retryable waiting item, even with `WizLive.ok` and connection state `online`.
3. Chats `sendPill` independently rendered that same waiting item as a bottom card. Both renderers called `WizReach.failure()`.
4. If same-origin Troubleshooter ping/status found no failed infrastructure check and `overall !== down`, `reach.js` returned `layer=send`, message “Wizard is reachable but didn’t take the message. Retrying.”, short “Wizard reachable · retrying”. The top strip removed the retry suffix. This exactly explains the two different strings and their simultaneous display with working internet.
5. Those health probes do not inspect an outbox item, its upload, transcription, local storage, admission response or delivery receipt. The fallback was not evidence that Wizard rejected a message.

The exact underlying failure of James’s phone-local item is NOT established. No phone-local outbox, recording or private-agent data was read. In particular, the unreadable-recording fix already exists in the actually served `outbox.js`; the screenshot is not sufficient to blame missing audio.

## Live discovery / ownership

At investigation, `wizard-mobile` served its installed atomic-release symlink, resolving to release `aa788b5100075b3a0e1510b8d2c3fa94a0f2daa3`, not the clean source checkout HEAD `9b2f551a`. `SOURCE_REPO` is the canonical wizard-ux remote. Source/served `reach.js` and `outbox.js` hashes matched. Candidate branches from the actual live release to preserve all serving features.

Read-only main Hermes session metadata/limited prior assistant results found the 27 Oct Reconnecting pill task already complete; no other active warning repair. An active shell-reconstruction owner exists (`20261029_005423_6b44ba`, parent `wizard_1793185435149_48ac06184ee6`). Do not replace that owner’s shell build or deploy a stale whole-tree snapshot over it; coordinate the tiny delta. No private agent homes, containers, Messenger or recording contents inspected.

## Change and non-change

The global banner now follows actual connection evidence only. Chats retains the unsent card, item/count, Retry now, Troubleshooter and recovery controls. Healthy probes produce neutral request-retry copy; Chats supplies the precise saved-message label “Message not sent · retrying”. No `outbox.js`, persistence, retry/backoff, cancellation, authority, idempotency or receipt code changes.

## Failed forum run triage

The initial receipt retained 1506 passing tests and one failure: this change expanded `docs/COMPONENTS.md` to 14233 bytes against its unchanged 14000-byte ceiling. Shorten the changed row; do not weaken the inventory test. The upstream port had the same row expansion.

The browser stopped before Retry could be exercised. Its saved screenshot is Home, while the Chats send pill is mounted on a neighboring offscreen desk. The fixture used ignored shell/skin/state storage keys and checked DOM presence, not the current visible desk. Fix the fixture to use the real shell/skin keys, tap Chats in the dock, assert the applied skin and hit-test an in-viewport Retry, then use an ordinary click. No production layout or delivery-code change is warranted by that failure. Preserve all original phase logs and rerun only the inventory check and failed browser phase, with unchanged product/test source hash-bound to prior passes.

## Acceptance

- New assertions fail against the pre-fix source: healthy reads plus retryable waiting item must not raise a global connection warning; healthy health probes must not claim the server refused a message.
- Fixed source must pass status, reach, actual production sendPill renderer and existing outbox custody tests.
- Synthetic local-origin browser fixture must show one actionable delivery card, healthy top banner absent; Retry now preserves exact sealed envelope; real read failure still shows the connection banner; recovery clears only that banner, leaving saved-message custody intact. Screenshots on phone Nebula and Signal.
- Full suite and app-parity gate on forum before delivery. Main only via PR. Any deployment must recheck current release ownership and compare exact HTTP-served hashes, not merely checkout or symlink state.
