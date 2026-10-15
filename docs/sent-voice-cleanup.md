# Sent voice-note bubble repair

The follow-up screenshot is a full transcribed voice note marked Sent inside Manager's hosted canonical thread. The earlier held/empty dismissal intentionally rejects sent notes. Manager also misses outbox repaint and forced post-send history refresh because shell listeners only recognize standalone Chats.

Bounded standard repair, direct implementation. Scope: shared Chats presentation, outbox presentation flag, phone/desktop hosted-thread listeners. No dispatch, deletion, TTL, native APK or server mutation changes.

Acceptance: while server transcript is delayed, a sent voice note offers Dismiss in Manager; a click immediately hides only that optimistic bubble, remains hidden after reload/reopen, preserves upload/run/destination receipts and never resubmits or cancels. Canonical history eventually shows the real message once. Undismissed sent bubble automatically reconciles when canonical history lands. Held/empty regressions remain green. Browser QA on Thales, exact served-asset replay and live shell read-only smoke, protected daily via PR. No guest rebuild.
