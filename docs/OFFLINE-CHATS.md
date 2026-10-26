# Offline chats flight loop (staged, not promoted)

REUSE: Chats navigation, list snapshot/main-agent boundary, pending echoes, skin tokens, voice submission custody and Idempotency-Key in WosOutbox.
EXTEND: WizOffline with a transactional keyed collection; existing WosOutbox with explicit flight-held submissions and a two-upload landing batch; pin branch's scoped shell worker for opt-in Chats startup.
NEW: web/core/offline-chats.js is the shell adapter/landing view, not a second outbox or cache implementation (registered in COMPONENTS.md).

## Contract
- Explicit download: Ready union last 30 opened main-agent threads; text-only per-thread IDB. A committed manifest is the readiness receipt. No private/siloed bodies or media URLs.
- A saved copy is labelled, never live. Online reads are authoritative. No signal: saved thread, or Not saved for offline.
- Offline replies use the existing outbox, with frozen route, recordedOfflineAt and last-seen message id/preview beside the message. They stay held through reload/reconnect until Send all. Approval and external actions never queue.
- Batch uploads at most two; an interrupted/ambiguous admission returns to the tray, no automatic retry. Explicit retry preserves body and idempotency identity.
- Shell caches only wizard-os-home-*; no private media, no sibling-cache access/deletion, no forced reload.

## Verification and release
Use disposable HTTP fixtures only, on forum. qa-offline-chats.cjs covers offline launch/read/held replies/landing/dedupe/privacy/Back with a 412x892 touch profile. Existing chat/outbox/back regressions and npm test compare by failure name to the exact live base. Android airplane-mode proof uses the real Wizard APK and a disposable fixture, never the owner's server. Two skins: ready, saved banner, landing tray.

Live checkout is read-only throughout this task. Rebase on current live HEAD before staging, parity PASS, push branch and open PR only. Promotion/rollback are reported commands, not executed. Native release requirement depends on the pin worker's real emulator result.
