# Chats notification badges: unread, not Ready

Base: serving UX `ab22897411daac37808fb0b36b1666705ac3b79e` (immutable release, no live edits).

Reuse:
- unread state: REUSE WizLive.visibleUnread, unified, seenRecord and existing attended-read receipts; no new store/migration.
- badge projection: EXTEND WizCore.workspaceNav.refreshChats; both shells publish one rule to dock/orb/skin api.apps.badges. COMPONENTS row updated.
- app notifications: EXTEND WosBell.unreadCount solely for the existing Chats-routed badge contribution; retain readyCount and other app routes/policies.
- layouts: REUSE the shared badge feed for AI Apps menu and folded Orb conversations.
- new implementation: NEW none.

Visual: none (no style, token, layout or new visual changes; existing count changes and accessibility copy only). Browser acceptance must retain real in-shell phone-UA/touch and desktop captures on two skins, including live skin selection. Appearance v1 --wz-* tokens, live skin changes, dark standalone fallback and opaque text-bearing overlays remain unchanged.

Diagnosis: phone renderInbox and desktop paintBar publish workGroups().ready.length (read or unread) plus Bell.readyCount into the shared app registry. Every dock/orb/app badge inherits the wrong count. Orb layout separately counts Ready; AI Apps calls the badge "ready". Ready cards/section counts are intentionally separate and remain untouched. Page titles contain no notification count; native notification cleanup already uses canonical read receipts and is unchanged.

Acceptance: read Ready contributes 0; done/FYI unseen contributes 1 per thread, multiple replies still 1; reading clears while Ready persists, later activity restores. Hidden/archive/snooze, unified/agent/Space peek and attended-read semantics remain canonical. Preserve unrelated app badge and notification routing policies; read/snoozed routed notifications cease contributing, Ready inventory remains.

No merge/deployment authorized for this worker. Parent owns forum admission, screenshot inspection and eventual promotion. Local source-execution tests are narrow VM/Node checks only; browser tests are staged, never run on the VPS.
