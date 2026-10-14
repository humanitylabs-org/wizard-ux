# Topics chat app-icon MVP

Request: reuse an app's existing icon on its automated output in Chats; Topics first, other apps as recommendations only.

## Staged implementation

- `wizard_topics` is the exact legacy Topics roundup thread. Its normalized `appId` is `topics`; thread names, subject labels and message mentions do not imply routing.
- Explicit `wizard_app_id` session metadata also flows into normalized `appId`. Future integrations should emit this exact app-registry ID as part of actual routing. The frontend MVP allowlist remains Topics only. General app-routing metadata producers/backend work are outside this MVP.
- Topics output renders with `WizSigil.box`, resolving the same installed registry record and glyph/colour as the launcher: currently the teal eye, `#0ED8BB`.
- Needs-you, review, approval, errors, working/offline and deferred preserve existing status glyphs as small corner badges; app identity stays visible through status transitions. Done/FYI outcome text, unread/read weight, ordering and row-click destination are unchanged.
- Async app-registry refresh repaints list-only views; it does not replace thread/composer contents. Missing icon support falls back to the existing status icon.

## Preview

https://topic-icons.staging.wizard001.com/wizard-os-home/?open=chats

`wizard-stage-topic-icons.service`: enabled durable service on loopback 9518, real reads from the existing Agent Service; mutation requests refused. Preview-specific entry script narrows Chats to “Wizard Topics” and opens its containing section. It never alters production sessions or cron jobs. Remove `web/preview-topic-icons.js` and its two HTML script tags before production integration.

## Verification

- Pure-render test failed first on the original dot; implemented source passes 17/17 contracts.
- Thales `thales.local`, actual HTTPS desktop and Android-UA touch browsers: 35/35 checks, zero page errors, exact four changed asset hashes, real Topics thread open → browser Back → list, reload, readable on-screen entry and narrow-width icon fit.
- Evidence: `/home/telos/.hermes/data/releases/topic-icons/evidence/result.json`, desktop and phone screenshots. Remote working evidence: `/Volumes/ThalesMedia/WizardQA/topic-icons-20261014/result`.
- Independent review identified an unsafe app-registry repaint during rename/touch interaction. The listener now uses the shared `holdList` guard and held-list flushing on both shell hosts, including desktop `::list` rows. Remote red test recreates the lost rename input using the previous listener; fixed candidate preserves rename/actions sheets and actual CDP touch-scrolling nodes, then flushes the new glyph after release. Both independent receipts reviewed pre-fix commit `96e169f` and found the same repaint blocker; parent closed it in `1cb2e28`, backed by the failing old-listener browser regression and 35/35 repaired HTTPS checks, including an intact open thread/composer. No other blocker was reported.
- No APK/native change; no Hermes core change; daily remains unchanged.

## Recommended next app mappings (not implemented)

1. Movies (`cinequeue`): added-to-watchlist and watched confirmations.
2. Shopping (`shopping`): saved item / shortlist and purchase-research results.
3. Calendar (`calendar`): calendar task confirmations and reminders.
4. Music (`wizard-music`): library and playlist additions.
5. Mizel.ai (`mizel`): finished recording/transcript and notes.
6. Wisdom (`wisdom`): imported collection / finished compression.
7. Signal (`wizard-signal`) and Search (`wizard-search`): explicitly app-routed digests / saved research.

These are app-provenance labels on actual app actions, rather than labels inferred from a conversational topic. Expansion is a separate accepted slice.
