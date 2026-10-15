# Agent hats and Home identity

James requested the house restored for Home, the supplied company hat for Chats, purple for the main agent, green with a keyhole replacing the door for the private agent, and Messenger retaining speech bubbles.

The shared sigil registry maps Chats to the supplied hat; agents use hat/hat-private with their configured hue. Unknown future agents keep the same hat with a stable ID-derived fallback hue. Phone dock and overview Home, and desktop Home, use the house. Privacy/routing/model behavior is untouched. `tools/sigils/private_hat.py` reproducibly adapts only the inner doorway alpha; the outer silhouette is unchanged.

Thales browser evidence: `/Volumes/ThalesMedia/wizard-qa/agent-hat-icons-20261015/`. Same real HTTPS origin and read-only live APIs, candidate source overrides isolated to static assets. `qa-agent-hat-icons.cjs`: baseline 12 pass / 20 fail; candidate 32 pass / 0 fail. Covers UA-selected phone/desktop, actual asset masks and configured hues, private dock/badges/window/overview, Home, Messenger, future hue fallback, 360px containment, nested Back, real main chat rows and zero agent admissions/page errors. Expected read-state PUT is blocked. Inspected actual phone overview screenshot. Final no-source-override live result is recorded in the release receipt.

Web-only correction. No APK/native or VM rebuild. Next significant guest rebuild must take the current UX.
