# Chats notification badges: unread, not Ready

Base: exact current-live UX `2e53e76a7c7634fac49767737f2bf26ecc1f30d6` (immutable release, no live edits). Original six badge commits were cherry-picked onto this base without conflicts; the independently merged appearance changes remain untouched. Original baseline `ab22897411daac37808fb0b36b1666705ac3b79e` and its evidence remain historical, not current-live acceptance.

Reuse:
- unread state: REUSE WizLive.visibleUnread, unified, seenRecord and existing attended-read receipts; no new store/migration.
- badge projection: EXTEND WizCore.workspaceNav.refreshChats; both shells publish one rule to dock/orb/skin api.apps.badges. COMPONENTS row updated.
- app notifications: EXTEND WosBell.unreadCount solely for the existing Chats-routed badge contribution; retain readyCount and other app routes/policies.
- layouts: REUSE the shared badge feed for AI Apps menu and folded Orb conversations.
- new implementation: NEW none.

Visual: none (no style, token, layout or new visual changes; existing count changes and accessibility copy only). Browser acceptance must retain real in-shell phone-UA/touch and desktop captures on two skins, including live skin selection. Appearance v1 --wz-* tokens, live skin changes, dark standalone fallback and opaque text-bearing overlays remain unchanged.

Diagnosis: phone renderInbox and desktop paintBar publish workGroups().ready.length (read or unread) plus Bell.readyCount into the shared app registry. Every dock/orb/app badge inherits the wrong count. Orb layout separately counts Ready; AI Apps calls the badge "ready". Ready cards/section counts are intentionally separate and remain untouched. Page titles contain no notification count; native notification cleanup already uses canonical read receipts and is unchanged.

Acceptance: read Ready contributes 0; done/FYI unseen contributes 1 per thread, multiple replies still 1; reading clears while Ready persists, later activity restores. Hidden/archive/snooze, unified/agent/Space peek and attended-read semantics remain canonical. Preserve unrelated app badge and notification routing policies; read/snoozed routed notifications cease contributing, Ready inventory remains.

Orb cold-start audit: the real skin-host `apps.badges(watch)` registers a `wizard:app-counts` event listener and returns a snapshot; it does not invoke the watcher synchronously. The existing explicit startup `paint()` still paints both conversations and apps after state initialization. `tests/orb-badge-startup.test.mjs` executes that real host method, subscription, state and paint source in order, then delivers later count events. No speculative lifecycle/product change was needed.

Scope audit: `WizLive.sessionsFor('')` already uses `unified()` for the main Chats view; other-agent Focus uses its scoped list. The badge reuses canonical loaded unified visibility and qualified read receipts, does not hydrate agents/Spaces or change `live.js`, and does not change Ready inventory. Routed app unread contribution stays in the existing Bell inbox routing.

No merge/deployment authorized for this worker. Parent owns forum admission, screenshot inspection and eventual promotion. This reconciliation ran syntax/diff/source-closure checks only; all focused source tests and the unchanged browser harness are staged for forum admission, never run on the VPS.
