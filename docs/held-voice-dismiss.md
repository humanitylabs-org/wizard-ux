# Retained voice-note dismissal

James reports a voice note labelled “Kept on this device · not queued” without a dismiss action. The previous empty-transcript fix covers `empty`; this screenshot is `held`.

Standard bounded UX repair; no deletion, dispatch, routing, or schema change. Shared Chats and outbox presentation only. Direct implementation.

Acceptance: held and empty recordings expose Dismiss on phone and desktop; dismissal survives reload and thread reopen, hides the list pill, preserves exact audio/route/receipt, and never sends a message. Other threads and active/uncertain submissions remain unchanged. Existing empty-note retry keeps original destination. Browser QA executes on Thales; live asset hash and served-shell replay verify delivery. Minor web release only, no guest rebuild.
